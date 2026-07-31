/**
 * Order tools.
 *
 * Read tools (list/get) are always registered. The three mutating tools place,
 * change and cancel REAL orders with REAL money, so they are skipped entirely
 * when TOSSINVEST_READ_ONLY is set.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { READ_ONLY_MODE } from "../constants.js";
import { TossConfigError } from "../errors.js";
import { ResponseFormatSchema, buildToolResult, mdFields, mdTable, section, show } from "../format.js";
import {
    AccountSeqSchema,
    ClientOrderIdSchema,
    ConfirmHighValueSchema,
    DateSchema,
    DecimalSchema,
    OptionalSymbolSchema,
    SymbolSchema
} from "../schemas/common.js";
import { OrderOperationOutput, OrderOutput, OrdersOutput } from "../schemas/outputs.js";
import { resolveAccountSeq } from "../services/account.js";
import { apiRequest } from "../services/client.js";
import { defineTool } from "./registry.js";

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

interface OrderExecution {
    filledQuantity: string;
    averageFilledPrice: string | null;
    filledAmount: string | null;
    commission: string | null;
    tax: string | null;
    filledAt: string | null;
    settlementDate: string | null;
}

interface Order {
    orderId: string;
    symbol: string;
    side: string;
    orderType: string;
    timeInForce: string;
    status: string;
    price?: string | null;
    quantity: string;
    orderAmount?: string | null;
    currency: string;
    orderedAt: string;
    canceledAt?: string | null;
    execution: OrderExecution;
}

interface OrderPage {
    orders: Order[];
    nextCursor?: string | null;
    hasNext: boolean;
}

const orderColumns = [
    { header: "orderId", get: (row: Order) => row.orderId },
    { header: "Symbol", get: (row: Order) => row.symbol },
    { header: "Side", get: (row: Order) => row.side },
    { header: "Type", get: (row: Order) => row.orderType },
    { header: "Status", get: (row: Order) => row.status },
    { header: "Qty", get: (row: Order) => row.quantity },
    { header: "Price", get: (row: Order) => row.price },
    { header: "Filled", get: (row: Order) => row.execution?.filledQuantity },
    { header: "Avg fill", get: (row: Order) => row.execution?.averageFilledPrice },
    { header: "Ordered at", get: (row: Order) => row.orderedAt }
];

export function registerOrderTools(server: McpServer): void {
    defineTool(
        server,
        "tossinvest_list_orders",
        {
            title: "List orders",
            description: `List the account's orders, filtered by lifecycle group.

Args:
  - status ('OPEN' | 'CLOSED'): OPEN returns still-working orders (individual status PENDING, PARTIAL_FILLED, PENDING_CANCEL, PENDING_REPLACE). CLOSED returns finished ones (FILLED, CANCELED, REJECTED, REPLACED, CANCEL_REJECTED, REPLACE_REJECTED, PARTIAL_FILLED).
  - symbol (string, optional): restrict to one symbol.
  - from / to (string, optional): YYYY-MM-DD inclusive bounds on order creation time (orderedAt, KST). Omit for all time.
  - cursor (string, optional): pagination cursor from a previous nextCursor. CLOSED only.
  - limit (number): 1-100, default 20. CLOSED only.
  - account_seq (number, optional): resolved automatically for single-account credentials.
  - response_format ('markdown' | 'json'): default 'markdown'.

Paging differs by status: OPEN returns every working order in one shot and ignores cursor/limit (nextCursor is always null, hasNext always false); CLOSED honours cursor and limit.

Returns { accountSeq, status, count, orders: [...], nextCursor, hasNext }. Each order carries an 'execution' object: { filledQuantity, averageFilledPrice, filledAmount, commission, tax, filledAt, settlementDate }. filledQuantity is 0 when nothing has filled — check it on CANCELED and REJECTED orders too, since those can be partially filled.

Note the two status vocabularies: the 'status' argument is a GROUP label, while 'orders[].status' is the individual order state.`,
            inputSchema: {
                status: z.enum(["OPEN", "CLOSED"]).describe("'OPEN' for working orders, 'CLOSED' for finished orders."),
                symbol: OptionalSymbolSchema.describe("Restrict to one symbol. Omit for all symbols."),
                from: DateSchema.optional().describe("Inclusive start date (YYYY-MM-DD, KST) on order creation time."),
                to: DateSchema.optional().describe("Inclusive end date (YYYY-MM-DD, KST) on order creation time."),
                cursor: z.string().optional().describe("Pagination cursor from a previous nextCursor. Ignored when status='OPEN'."),
                limit: z.number().int().min(1).max(100).default(20).describe("Page size (max 100). Ignored when status='OPEN'."),
                account_seq: AccountSeqSchema,
                response_format: ResponseFormatSchema
            },
            outputSchema: OrdersOutput,
            annotations: readOnly
        },
        async ({ status, symbol, from, to, cursor, limit, account_seq, response_format }) => {
            const accountSeq = await resolveAccountSeq(account_seq);
            const page = await apiRequest<OrderPage>("/api/v1/orders", {
                accountSeq,
                query: { status, symbol, from, to, cursor, limit }
            });
            return buildToolResult({
                format: response_format,
                structured: {
                    accountSeq,
                    status,
                    count: page.orders.length,
                    orders: page.orders,
                    nextCursor: page.nextCursor ?? null,
                    hasNext: page.hasNext
                },
                truncatableKey: "orders",
                truncationHint: "Lower `limit`, narrow the date range, or filter by `symbol`.",
                renderMarkdown: (data) =>
                    section(
                        `Orders — account ${accountSeq}, ${status} (${data.count})`,
                        [mdTable(orderColumns, data.orders), "", `hasNext: ${show(data.hasNext)} · nextCursor: ${show(data.nextCursor)}`].join("\n")
                    )
            });
        }
    );

    defineTool(
        server,
        "tossinvest_get_order",
        {
            title: "Get order detail",
            description: `Get the full detail of one order by id, in any state.

Use this to confirm what happened after placing, modifying or cancelling — especially to read the fill result.

Args:
  - order_id (string): the orderId returned by a create/modify/cancel call or by tossinvest_list_orders.
  - account_seq (number, optional): resolved automatically for single-account credentials.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { accountSeq, order: { orderId, symbol, side, orderType, timeInForce, status, price, quantity, orderAmount, currency, orderedAt, canceledAt, execution } }.
execution = { filledQuantity, averageFilledPrice, filledAmount, commission, tax, filledAt, settlementDate }.

Errors: 404 order-not-found for an unknown id.`,
            inputSchema: {
                order_id: z.string().min(1).describe("Order identifier (opaque server-issued token)."),
                account_seq: AccountSeqSchema,
                response_format: ResponseFormatSchema
            },
            outputSchema: OrderOutput,
            annotations: readOnly
        },
        async ({ order_id, account_seq, response_format }) => {
            const accountSeq = await resolveAccountSeq(account_seq);
            const order = await apiRequest<Order>(`/api/v1/orders/${encodeURIComponent(order_id)}`, { accountSeq });
            return buildToolResult({
                format: response_format,
                structured: { accountSeq, order },
                renderMarkdown: (data) => section(`Order ${order_id}`, mdFields(data.order))
            });
        }
    );

    if (READ_ONLY_MODE) return;

    defineTool(
        server,
        "tossinvest_create_order",
        {
            title: "Place a stock order",
            description: `Place a REAL buy or sell order for a Korean or US stock. This spends or liquidates actual money — confirm the symbol, side, quantity and price with the user before calling.

Args:
  - symbol (string): KRX 6 digits or US ticker.
  - side ('BUY' | 'SELL').
  - order_type ('LIMIT' | 'MARKET').
  - quantity (string, optional): number of shares as a decimal string. Whole numbers only, except US market sells, which allow up to 6 decimal places.
  - order_amount (string, optional): US MARKET orders only — spend this many dollars and let the filled quantity float. Regular US session hours only.
  - price (string, optional): REQUIRED for LIMIT, forbidden for MARKET. KR: whole won, and it must land on the tick size for the price band. US: up to 4 decimals below $1, 2 decimals at or above $1.
  - time_in_force ('DAY' | 'CLS'): default DAY. CLS (at-the-close, i.e. LOC when combined with LIMIT) currently works only for US LIMIT orders.
  - client_order_id (string, optional): idempotency key, max 36 chars of [A-Za-z0-9_-]. Re-sending the same value within 10 minutes returns the original order rather than creating a second one. Strongly recommended.
  - confirm_high_value_order (boolean): default false. Required true for orders of ₩100,000,000 or more.
  - account_seq (number, optional): resolved automatically for single-account credentials.
  - response_format ('markdown' | 'json'): default 'markdown'.

Supply exactly one of quantity or order_amount.

Returns { accountSeq, orderId, operation: 'created' }. The response confirms acceptance, NOT execution — call tossinvest_get_order with the returned orderId to see the fill.

Before ordering it is worth checking tossinvest_get_buying_power (buys), tossinvest_get_sellable_quantity (sells) and tossinvest_get_price_limits (limit prices).

Errors: 422 insufficient-buying-power, 422 order-hours-closed, 422 price-out-of-range, 422 opposite-pending-order-exists, 400 confirm-high-value-required, 400 invalid-request with the correct tick size in 'data'.`,
            inputSchema: {
                symbol: SymbolSchema,
                side: z.enum(["BUY", "SELL"]).describe("Order direction."),
                order_type: z.enum(["LIMIT", "MARKET"]).describe("'LIMIT' needs `price`; 'MARKET' must omit it."),
                quantity: DecimalSchema.optional().describe(
                    "Share count as a decimal string. Whole numbers only, except US market sells (up to 6 decimals). Mutually exclusive with order_amount."
                ),
                order_amount: DecimalSchema.optional().describe(
                    "US MARKET orders only: dollar amount to trade, with quantity floating. Regular session hours only. Mutually exclusive with quantity."
                ),
                price: DecimalSchema.optional().describe(
                    "Limit price. Required for LIMIT, forbidden for MARKET. KR must match the band's tick size; US allows 4 decimals under $1, 2 decimals at or above."
                ),
                time_in_force: z.enum(["DAY", "CLS"]).default("DAY").describe("'DAY' expires at the close. 'CLS' is at-the-close, US LIMIT orders only."),
                client_order_id: ClientOrderIdSchema,
                confirm_high_value_order: ConfirmHighValueSchema,
                account_seq: AccountSeqSchema,
                response_format: ResponseFormatSchema
            },
            outputSchema: OrderOperationOutput,
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
        },
        async (args) => {
            const { symbol, side, order_type, quantity, order_amount, price, time_in_force } = args;

            if ((quantity === undefined) === (order_amount === undefined)) {
                throw new TossConfigError("Supply exactly one of `quantity` or `order_amount`.");
            }
            if (order_type === "LIMIT" && price === undefined) {
                throw new TossConfigError("`price` is required for LIMIT orders. Use tossinvest_get_orderbook or tossinvest_get_prices to pick one.");
            }
            if (order_type === "MARKET" && price !== undefined) {
                throw new TossConfigError("`price` must be omitted for MARKET orders.");
            }
            if (order_amount !== undefined && order_type !== "MARKET") {
                throw new TossConfigError("`order_amount` is only valid with order_type='MARKET' (US stocks only).");
            }

            const accountSeq = await resolveAccountSeq(args.account_seq);
            const body: Record<string, unknown> = {
                symbol,
                side,
                orderType: order_type,
                confirmHighValueOrder: args.confirm_high_value_order
            };
            if (args.client_order_id !== undefined) body["clientOrderId"] = args.client_order_id;
            if (order_amount !== undefined) {
                body["orderAmount"] = order_amount;
            } else {
                body["quantity"] = quantity;
                body["timeInForce"] = time_in_force;
                if (price !== undefined) body["price"] = price;
            }

            const result = await apiRequest<{ orderId: string }>("/api/v1/orders", { method: "POST", accountSeq, body });
            return buildToolResult({
                format: args.response_format,
                structured: {
                    accountSeq,
                    orderId: result.orderId,
                    operation: "created",
                    note: "Accepted, not necessarily filled. Call tossinvest_get_order with this orderId to check the execution."
                },
                renderMarkdown: (data) =>
                    section(
                        "Order placed",
                        mdFields({
                            orderId: data.orderId,
                            account: accountSeq,
                            symbol,
                            side,
                            orderType: order_type,
                            quantity: quantity ?? null,
                            orderAmount: order_amount ?? null,
                            price: price ?? null,
                            note: data.note
                        })
                    )
            });
        }
    );

    defineTool(
        server,
        "tossinvest_modify_order",
        {
            title: "Modify an open order",
            description: `Change the price (and, for Korean stocks, the quantity) of a working order. This alters a REAL order — confirm the new terms with the user first.

Args:
  - order_id (string): the order to modify. Must still be working; get it from tossinvest_list_orders with status='OPEN'.
  - order_type ('LIMIT' | 'MARKET'): the resulting order type.
  - quantity (string, optional): REQUIRED for Korean stocks, whole numbers only. MUST BE OMITTED for US stocks, which reject it with 400 us-modify-quantity-not-supported. US modifications can only change price.
  - price (string, optional): REQUIRED for LIMIT, forbidden for MARKET. Same tick/decimal rules as placing an order.
  - confirm_high_value_order (boolean): default false. Required true at ₩100,000,000 or more. Orders of ₩3,000,000,000 or more are rejected regardless.
  - account_seq (number, optional): resolved automatically for single-account credentials.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { accountSeq, orderId, operation: 'modified' }.

Errors: 409 already-filled / already-canceled / already-modified / already-processing, 422 modify-restricted, 404 order-not-found.`,
            inputSchema: {
                order_id: z.string().min(1).describe("Identifier of the working order to modify."),
                order_type: z.enum(["LIMIT", "MARKET"]).describe("Resulting order type. 'LIMIT' needs `price`; 'MARKET' must omit it."),
                quantity: DecimalSchema.optional().describe("New share count. Required for KR (whole numbers); must be omitted for US."),
                price: DecimalSchema.optional().describe("New limit price. Required for LIMIT, forbidden for MARKET."),
                confirm_high_value_order: ConfirmHighValueSchema,
                account_seq: AccountSeqSchema,
                response_format: ResponseFormatSchema
            },
            outputSchema: OrderOperationOutput,
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
        },
        async ({ order_id, order_type, quantity, price, confirm_high_value_order, account_seq, response_format }) => {
            if (order_type === "LIMIT" && price === undefined) {
                throw new TossConfigError("`price` is required when modifying to a LIMIT order.");
            }
            if (order_type === "MARKET" && price !== undefined) {
                throw new TossConfigError("`price` must be omitted when modifying to a MARKET order.");
            }

            const accountSeq = await resolveAccountSeq(account_seq);
            const body: Record<string, unknown> = { orderType: order_type, confirmHighValueOrder: confirm_high_value_order };
            if (quantity !== undefined) body["quantity"] = quantity;
            if (price !== undefined) body["price"] = price;

            const result = await apiRequest<{ orderId: string }>(`/api/v1/orders/${encodeURIComponent(order_id)}/modify`, {
                method: "POST",
                accountSeq,
                body
            });
            return buildToolResult({
                format: response_format,
                structured: {
                    accountSeq,
                    orderId: result.orderId,
                    operation: "modified",
                    note: "Call tossinvest_get_order with this orderId to confirm the new terms."
                },
                renderMarkdown: (data) => section("Order modified", mdFields(data))
            });
        }
    );

    defineTool(
        server,
        "tossinvest_cancel_order",
        {
            title: "Cancel an open order",
            description: `Cancel a working order. This cancels a REAL order — confirm with the user first.

Args:
  - order_id (string): the order to cancel. Get it from tossinvest_list_orders with status='OPEN'.
  - account_seq (number, optional): resolved automatically for single-account credentials.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { accountSeq, orderId, operation: 'canceled' }.

A partially filled order can still be cancelled — the unfilled remainder is withdrawn and the filled part stands. Read execution.filledQuantity on the order afterwards to see what actually traded.

Errors: 409 already-filled (nothing left to cancel), 409 already-canceled, 409 already-processing, 422 cancel-restricted, 404 order-not-found.`,
            inputSchema: {
                order_id: z.string().min(1).describe("Identifier of the working order to cancel."),
                account_seq: AccountSeqSchema,
                response_format: ResponseFormatSchema
            },
            outputSchema: OrderOperationOutput,
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
        },
        async ({ order_id, account_seq, response_format }) => {
            const accountSeq = await resolveAccountSeq(account_seq);
            const result = await apiRequest<{ orderId: string }>(`/api/v1/orders/${encodeURIComponent(order_id)}/cancel`, {
                method: "POST",
                accountSeq,
                body: {}
            });
            return buildToolResult({
                format: response_format,
                structured: {
                    accountSeq,
                    orderId: result.orderId,
                    operation: "canceled",
                    note: "Check execution.filledQuantity via tossinvest_get_order — part of the order may have filled before cancellation."
                },
                renderMarkdown: (data) => section("Order canceled", mdFields(data))
            });
        }
    );
}
