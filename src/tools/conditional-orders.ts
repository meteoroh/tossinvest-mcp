/**
 * Conditional Order tools — price-triggered automatic orders (SINGLE / OCO / OTO).
 *
 * As with plain orders, the mutating tools are omitted under TOSSINVEST_READ_ONLY.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { READ_ONLY_MODE } from "../constants.js";
import { TossConfigError } from "../errors.js";
import { ResponseFormatSchema, buildToolResult, mdFields, mdTable, section, show } from "../format.js";
import { AccountSeqSchema, ClientOrderIdSchema, ConfirmHighValueSchema, DateSchema, DecimalSchema, OptionalSymbolSchema, SymbolSchema } from "../schemas/common.js";
import { ConditionalOrderOperationOutput, ConditionalOrderOutput, ConditionalOrdersOutput } from "../schemas/outputs.js";
import { resolveAccountSeq } from "../services/account.js";
import { apiRequest } from "../services/client.js";
import { defineTool } from "./registry.js";

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const mutating = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } as const;

interface ConditionalOrderDetail {
    conditionalOrderId: string;
    type: string;
    status: string;
    symbol: string;
    market: string;
    quantity: string;
    orderType: string;
    expireDate?: string;
    first: Record<string, unknown>;
    second?: Record<string, unknown> | null;
    createdAt: string;
}

interface ConditionalOrderPage {
    conditionalOrders: ConditionalOrderDetail[];
    nextCursor?: string | null;
    hasNext: boolean;
}

const ConditionSchema = z
    .object({
        order_side: z.enum(["BUY", "SELL"]).describe("Direction of the order this condition places when it triggers."),
        trigger_price: DecimalSchema.describe("Watch price. The condition fires when the market price reaches this level."),
        order_price: DecimalSchema.optional().describe("Limit price used for the order placed on trigger. Required when order_type='LIMIT'; must be omitted for 'MARKET'.")
    })
    .describe("A watched condition: when price reaches trigger_price, place an order_side order.");

type Condition = z.infer<typeof ConditionSchema>;

/** Maps the tool's snake_case condition onto the API's camelCase leg object. */
function toConditionBody(condition: Condition): Record<string, unknown> {
    const body: Record<string, unknown> = {
        orderSide: condition.order_side,
        triggerPrice: condition.trigger_price
    };
    if (condition.order_price !== undefined) body["orderPrice"] = condition.order_price;
    return body;
}

/** Shared validation for the create and modify request shapes. */
function validateConditionalOrder(type: "SINGLE" | "OCO" | "OTO", orderType: "LIMIT" | "MARKET", first: Condition, second?: Condition): void {
    if (type === "SINGLE" && second !== undefined) {
        throw new TossConfigError("`second` must be omitted for type='SINGLE'.");
    }
    if (type !== "SINGLE" && second === undefined) {
        throw new TossConfigError(`\`second\` is required for type='${type}'.`);
    }
    if (type !== "SINGLE" && orderType !== "LIMIT") {
        throw new TossConfigError("OCO and OTO conditional orders support order_type='LIMIT' only.");
    }
    if (type === "OCO" && (first.order_side !== "SELL" || second?.order_side !== "SELL")) {
        throw new TossConfigError("OCO requires both conditions to be SELL (typically a take-profit above and a stop-loss below the current price).");
    }
    if (type === "OTO" && (first.order_side !== "BUY" || second?.order_side !== "SELL")) {
        throw new TossConfigError("OTO requires the first condition to be BUY and the second to be SELL.");
    }

    for (const [label, condition] of [["first", first], ["second", second]] as const) {
        if (!condition) continue;
        if (orderType === "LIMIT" && condition.order_price === undefined) {
            throw new TossConfigError(`\`${label}.order_price\` is required when order_type='LIMIT'.`);
        }
        if (orderType === "MARKET" && condition.order_price !== undefined) {
            throw new TossConfigError(`\`${label}.order_price\` must be omitted when order_type='MARKET'.`);
        }
    }
}

export function registerConditionalOrderTools(server: McpServer): void {
    defineTool(
        server,
        "tossinvest_list_conditional_orders",
        {
            title: "List conditional orders",
            description: `List the account's conditional (price-triggered) orders.

This returns conditional orders from every channel, including ones set up in the Toss Securities app — not just those created through this API.

Args:
  - status ('OPEN' | 'CLOSED'): OPEN covers WATCHING, PAUSED, ORDERING and ORDERED. CLOSED covers COMPLETED and EXPIRED.
  - symbol (string, optional): restrict to one symbol.
  - cursor (string, optional): pagination cursor from a previous nextCursor.
  - limit (number): 1-100, default 20.
  - account_seq (number, optional): resolved automatically for single-account credentials.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { accountSeq, status, count, conditionalOrders: [{ conditionalOrderId, type, status, symbol, market, quantity, orderType, expireDate, createdAt, first, second }], nextCursor, hasNext }.
type is SINGLE, OCO or OTO; there is no server-side type filter, so filter on this field yourself. Each condition leg carries { type, status, triggerPrice, targetProfitRate, orderPrice, triggeredOrderId }; triggeredOrderId links to the real order created on trigger, which you can then read with tossinvest_get_order.`,
            inputSchema: {
                status: z.enum(["OPEN", "CLOSED"]).describe("'OPEN' for active conditional orders, 'CLOSED' for completed or expired ones."),
                symbol: OptionalSymbolSchema.describe("Restrict to one symbol. Omit for all."),
                cursor: z.string().optional().describe("Pagination cursor from a previous nextCursor."),
                limit: z.number().int().min(1).max(100).default(20).describe("Page size (max 100)."),
                account_seq: AccountSeqSchema,
                response_format: ResponseFormatSchema
            },
            outputSchema: ConditionalOrdersOutput,
            annotations: readOnly
        },
        async ({ status, symbol, cursor, limit, account_seq, response_format }) => {
            const accountSeq = await resolveAccountSeq(account_seq);
            const page = await apiRequest<ConditionalOrderPage>("/api/v1/conditional-orders", {
                accountSeq,
                query: { status, symbol, cursor, limit }
            });
            return buildToolResult({
                format: response_format,
                structured: {
                    accountSeq,
                    status,
                    count: page.conditionalOrders.length,
                    conditionalOrders: page.conditionalOrders,
                    nextCursor: page.nextCursor ?? null,
                    hasNext: page.hasNext
                },
                truncatableKey: "conditionalOrders",
                truncationHint: "Lower `limit` or filter by `symbol`.",
                renderMarkdown: (data) =>
                    section(
                        `Conditional orders — account ${accountSeq}, ${status} (${data.count})`,
                        [
                            mdTable(
                                [
                                    { header: "id", get: (row: ConditionalOrderDetail) => row.conditionalOrderId },
                                    { header: "Symbol", get: (row: ConditionalOrderDetail) => row.symbol },
                                    { header: "Type", get: (row: ConditionalOrderDetail) => row.type },
                                    { header: "Status", get: (row: ConditionalOrderDetail) => row.status },
                                    { header: "Qty", get: (row: ConditionalOrderDetail) => row.quantity },
                                    { header: "Order type", get: (row: ConditionalOrderDetail) => row.orderType },
                                    { header: "Expires", get: (row: ConditionalOrderDetail) => row.expireDate },
                                    { header: "1st trigger", get: (row: ConditionalOrderDetail) => row.first?.["triggerPrice"] },
                                    { header: "2nd trigger", get: (row: ConditionalOrderDetail) => row.second?.["triggerPrice"] }
                                ],
                                data.conditionalOrders
                            ),
                            "",
                            `hasNext: ${show(data.hasNext)} · nextCursor: ${show(data.nextCursor)}`
                        ].join("\n")
                    )
            });
        }
    );

    defineTool(
        server,
        "tossinvest_get_conditional_order",
        {
            title: "Get conditional order detail",
            description: `Get the full detail of one conditional order by id, active or finished.

Args:
  - conditional_order_id (string): id from a create/modify response or from tossinvest_list_conditional_orders.
  - account_seq (number, optional): resolved automatically for single-account credentials.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { accountSeq, conditionalOrder: { conditionalOrderId, type, status, symbol, market, quantity, orderType, expireDate, createdAt, first, second } }.
Each leg has { type, status, triggerPrice, targetProfitRate, orderPrice, triggeredOrderId }. Leg status values: WATCHING, HOLDING, PAUSED, ORDERING, ORDERED, COMPLETED, EXPIRED, CANCELED.

Errors: 404 conditional-order-not-found — note that modifying a conditional order issues a NEW id and voids the old one, so always use the most recently returned id.`,
            inputSchema: {
                conditional_order_id: z.string().min(1).describe("Conditional order identifier."),
                account_seq: AccountSeqSchema,
                response_format: ResponseFormatSchema
            },
            outputSchema: ConditionalOrderOutput,
            annotations: readOnly
        },
        async ({ conditional_order_id, account_seq, response_format }) => {
            const accountSeq = await resolveAccountSeq(account_seq);
            const detail = await apiRequest<ConditionalOrderDetail>(
                `/api/v1/conditional-orders/${encodeURIComponent(conditional_order_id)}`,
                { accountSeq }
            );
            return buildToolResult({
                format: response_format,
                structured: { accountSeq, conditionalOrder: detail },
                renderMarkdown: (data) => section(`Conditional order ${conditional_order_id}`, mdFields(data.conditionalOrder))
            });
        }
    );

    if (READ_ONLY_MODE) return;

    defineTool(
        server,
        "tossinvest_create_conditional_order",
        {
            title: "Create a conditional order",
            description: `Register a REAL price-triggered order: watch a symbol and automatically place a buy or sell when the price reaches a trigger. Confirm every parameter with the user first.

Types:
  - SINGLE — watch one condition ('first'). Either side. LIMIT or MARKET. No per-symbol limit.
  - OCO (one-cancels-the-other) — watch two conditions at once; when one fires the other is cancelled. Both must be SELL, LIMIT only, and first.trigger_price > current price > second.trigger_price. This is the take-profit / stop-loss bracket on an existing position.
  - OTO (one-triggers-the-other) — 'second' only starts being watched after 'first' fills. first must be BUY, second must be SELL, LIMIT only. This is buy-then-auto-exit.
OCO and OTO are limited to one per symbol; a second one fails with 422 duplicate-conditional-order.

Args:
  - symbol (string): the symbol to watch.
  - type ('SINGLE' | 'OCO' | 'OTO').
  - quantity (string): share count, shared by every leg in the group.
  - order_type ('LIMIT' | 'MARKET'): shared by every leg. LIMIT requires order_price on each condition; MARKET forbids it. OCO/OTO accept LIMIT only.
  - expire_date (string): YYYY-MM-DD. The conditional order auto-expires unfired on this date.
  - first (object): { order_side, trigger_price, order_price? } — the first watched condition.
  - second (object, optional): same shape. Omit for SINGLE, required for OCO and OTO.
  - client_order_id (string, optional): idempotency key.
  - confirm_high_value_order (boolean): default false. Required true at ₩100,000,000 or more.
  - account_seq (number, optional): resolved automatically for single-account credentials.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { accountSeq, conditionalOrderId, clientOrderId, operation: 'created' }.

Errors: 422 condition-already-met when the trigger price has already been reached (pick another price), 422 duplicate-conditional-order, 400 invalid-request for a bad leg combination.`,
            inputSchema: {
                symbol: SymbolSchema,
                type: z.enum(["SINGLE", "OCO", "OTO"]).describe("SINGLE = one condition; OCO = two SELL conditions, one cancels the other; OTO = BUY then auto-SELL."),
                quantity: DecimalSchema.describe("Share count, shared by every leg of the group."),
                order_type: z.enum(["LIMIT", "MARKET"]).describe("Shared by every leg. OCO and OTO accept 'LIMIT' only."),
                expire_date: DateSchema.describe("Expiry date (YYYY-MM-DD). The conditional order is dropped if it has not fired by then."),
                first: ConditionSchema.describe("First watched condition. For OTO this is the parent BUY leg."),
                second: ConditionSchema.optional().describe("Second condition. Omit for SINGLE; required for OCO and OTO."),
                client_order_id: ClientOrderIdSchema,
                confirm_high_value_order: ConfirmHighValueSchema,
                account_seq: AccountSeqSchema,
                response_format: ResponseFormatSchema
            },
            outputSchema: ConditionalOrderOperationOutput,
            annotations: mutating
        },
        async (args) => {
            validateConditionalOrder(args.type, args.order_type, args.first, args.second);
            const accountSeq = await resolveAccountSeq(args.account_seq);

            const body: Record<string, unknown> = {
                symbol: args.symbol,
                type: args.type,
                quantity: args.quantity,
                orderType: args.order_type,
                expireDate: args.expire_date,
                first: toConditionBody(args.first),
                confirmHighValueOrder: args.confirm_high_value_order
            };
            if (args.second !== undefined) body["second"] = toConditionBody(args.second);
            if (args.client_order_id !== undefined) body["clientOrderId"] = args.client_order_id;

            const result = await apiRequest<{ conditionalOrderId: string; clientOrderId?: string | null }>("/api/v1/conditional-orders", {
                method: "POST",
                accountSeq,
                body
            });
            return buildToolResult({
                format: args.response_format,
                structured: {
                    accountSeq,
                    conditionalOrderId: result.conditionalOrderId,
                    clientOrderId: result.clientOrderId ?? null,
                    operation: "created",
                    note: "The condition is now being watched. Nothing has traded yet."
                },
                renderMarkdown: (data) => section("Conditional order created", mdFields({ ...data, symbol: args.symbol, type: args.type }))
            });
        }
    );

    defineTool(
        server,
        "tossinvest_modify_conditional_order",
        {
            title: "Modify a conditional order",
            description: `Replace an existing conditional order's settings. This changes a REAL standing order — confirm with the user first.

IMPORTANT: modification works by cancelling and recreating, so a NEW conditionalOrderId is issued and the old one stops working. Use the id from this response for every later read, modify or cancel.

The whole conditional order is re-specified, so pass every leg you want to keep — anything omitted is dropped. The symbol cannot change (it is fixed by the id), and switching type (e.g. SINGLE to OCO) is allowed.

Args:
  - conditional_order_id (string): the conditional order to replace.
  - type ('SINGLE' | 'OCO' | 'OTO'): the resulting type.
  - quantity (string): share count, shared by every leg.
  - order_type ('LIMIT' | 'MARKET'): shared by every leg. OCO/OTO accept LIMIT only.
  - expire_date (string): YYYY-MM-DD. Required here even though it is optional in some clients.
  - first (object): { order_side, trigger_price, order_price? }.
  - second (object, optional): omit for SINGLE, required for OCO and OTO.
  - confirm_high_value_order (boolean): default false.
  - account_seq (number, optional): resolved automatically for single-account credentials.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { accountSeq, conditionalOrderId, operation: 'modified' } — with the NEW id.

Errors: 404 conditional-order-not-found, 422 condition-already-met.`,
            inputSchema: {
                conditional_order_id: z.string().min(1).describe("Identifier of the conditional order to replace."),
                type: z.enum(["SINGLE", "OCO", "OTO"]).describe("Resulting type. Switching type is allowed."),
                quantity: DecimalSchema.describe("Share count, shared by every leg of the group."),
                order_type: z.enum(["LIMIT", "MARKET"]).describe("Shared by every leg. OCO and OTO accept 'LIMIT' only."),
                expire_date: DateSchema.describe("Expiry date (YYYY-MM-DD). Required when modifying."),
                first: ConditionSchema.describe("First watched condition."),
                second: ConditionSchema.optional().describe("Second condition. Omit for SINGLE; required for OCO and OTO."),
                confirm_high_value_order: ConfirmHighValueSchema,
                account_seq: AccountSeqSchema,
                response_format: ResponseFormatSchema
            },
            outputSchema: ConditionalOrderOperationOutput,
            annotations: mutating
        },
        async (args) => {
            validateConditionalOrder(args.type, args.order_type, args.first, args.second);
            const accountSeq = await resolveAccountSeq(args.account_seq);

            const body: Record<string, unknown> = {
                type: args.type,
                quantity: args.quantity,
                orderType: args.order_type,
                expireDate: args.expire_date,
                first: toConditionBody(args.first),
                confirmHighValueOrder: args.confirm_high_value_order
            };
            if (args.second !== undefined) body["second"] = toConditionBody(args.second);

            const result = await apiRequest<{ conditionalOrderId: string }>(
                `/api/v1/conditional-orders/${encodeURIComponent(args.conditional_order_id)}/modify`,
                { method: "POST", accountSeq, body }
            );
            return buildToolResult({
                format: args.response_format,
                structured: {
                    accountSeq,
                    conditionalOrderId: result.conditionalOrderId,
                    operation: "modified",
                    note: `New identifier issued. The previous id (${args.conditional_order_id}) is no longer valid.`
                },
                renderMarkdown: (data) => section("Conditional order modified", mdFields(data))
            });
        }
    );

    defineTool(
        server,
        "tossinvest_cancel_conditional_order",
        {
            title: "Cancel a conditional order",
            description: `Cancel a standing conditional order so it stops watching the price. This cancels a REAL standing order — confirm with the user first.

Args:
  - conditional_order_id (string): the conditional order to cancel.
  - account_seq (number, optional): resolved automatically for single-account credentials.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { accountSeq, conditionalOrderId, operation: 'canceled' }.

This only removes the watcher. Any real order already placed by a fired condition is untouched — cancel that separately with tossinvest_cancel_order.

Errors: 404 conditional-order-not-found.`,
            inputSchema: {
                conditional_order_id: z.string().min(1).describe("Identifier of the conditional order to cancel."),
                account_seq: AccountSeqSchema,
                response_format: ResponseFormatSchema
            },
            outputSchema: ConditionalOrderOperationOutput,
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
        },
        async ({ conditional_order_id, account_seq, response_format }) => {
            const accountSeq = await resolveAccountSeq(account_seq);
            const result = await apiRequest<{ conditionalOrderId: string }>(
                `/api/v1/conditional-orders/${encodeURIComponent(conditional_order_id)}`,
                { method: "DELETE", accountSeq }
            );
            return buildToolResult({
                format: response_format,
                structured: {
                    accountSeq,
                    conditionalOrderId: result?.conditionalOrderId ?? conditional_order_id,
                    operation: "canceled",
                    note: "Only the watcher was removed. An order already placed by a fired condition must be canceled separately."
                },
                renderMarkdown: (data) => section("Conditional order canceled", mdFields(data))
            });
        }
    );
}
