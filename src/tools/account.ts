/**
 * Account and Asset tools — account list, holdings, and the pre-trade
 * information endpoints (buying power, sellable quantity, commissions).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResponseFormatSchema, buildToolResult, mdFields, mdTable, section } from "../format.js";
import { AccountSeqSchema, CurrencySchema, OptionalSymbolSchema, SymbolSchema } from "../schemas/common.js";
import {
    AccountsOutput,
    BuyingPowerOutput,
    CommissionsOutput,
    HoldingsOutput,
    SellableQuantityOutput
} from "../schemas/outputs.js";
import { listAccounts, resolveAccountSeq } from "../services/account.js";
import { apiRequest } from "../services/client.js";
import { defineTool } from "./registry.js";

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

interface HoldingsItem {
    symbol: string;
    name: string;
    marketCountry: string;
    currency: string;
    quantity: string;
    lastPrice: string;
    averagePurchasePrice: string;
    marketValue: { purchaseAmount: string; amount: string; amountAfterCost: string };
    profitLoss: { amount: string; amountAfterCost: string; rate: string; rateAfterCost: string };
    dailyProfitLoss: { amount: string; rate: string };
    cost: { commission: string; tax?: string | null };
}

interface HoldingsPayload {
    totalPurchaseAmount: Record<string, unknown>;
    marketValue: Record<string, unknown>;
    profitLoss: Record<string, unknown>;
    dailyProfitLoss: Record<string, unknown>;
    items: HoldingsItem[];
}

interface Commission {
    marketCountry: string;
    commissionRate: string;
    startDate?: string | null;
    endDate?: string | null;
}

export function registerAccountTools(server: McpServer): void {
    defineTool(
        server,
        "tossinvest_list_accounts",
        {
            title: "List brokerage accounts",
            description: `List the Toss Securities accounts reachable with the configured credentials.

Call this first when you do not know which account to act on. The 'accountSeq' in the response is what every account-scoped tool takes as 'account_seq'.

Args:
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { count, accounts: [{ accountNo, accountSeq, accountType }] }.
Only BROKERAGE (종합매매) accounts are exposed today; child accounts are not usable. An empty list means the credentials have no brokerage account.

When exactly one account exists, other tools resolve it automatically, so you rarely need to pass account_seq by hand.

Rate limit: the ACCOUNT group allows only 1 request per second.`,
            inputSchema: { response_format: ResponseFormatSchema },
            outputSchema: AccountsOutput,
            annotations: readOnly
        },
        async ({ response_format }) => {
            const accounts = await listAccounts(true);
            return buildToolResult({
                format: response_format,
                structured: { count: accounts.length, accounts },
                renderMarkdown: (data) =>
                    section(
                        `Accounts (${data.count})`,
                        mdTable(
                            [
                                { header: "accountSeq", get: (row: { accountSeq: number }) => row.accountSeq },
                                { header: "Account no.", get: (row: { accountNo: string }) => row.accountNo },
                                { header: "Type", get: (row: { accountType: string }) => row.accountType }
                            ],
                            data.accounts
                        )
                    )
            });
        }
    );

    defineTool(
        server,
        "tossinvest_get_holdings",
        {
            title: "Get portfolio holdings",
            description: `Get the account's stock holdings with per-symbol detail and aggregate valuation.

This is the portfolio tool: what is owned, at what average cost, worth how much, up or down how much.

Args:
  - account_seq (number, optional): which account. Resolved automatically when the credentials have one account.
  - symbol (string, optional): restrict to one symbol. The summary totals are recomputed for just that symbol.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { accountSeq, count, totalPurchaseAmount, marketValue, profitLoss, dailyProfitLoss, items }.
  - Summary objects carry per-currency amounts as { krw, usd } — KRW and USD are reported separately, never summed. Convert with tossinvest_get_exchange_rate if a single figure is wanted.
  - profitLoss has both 'amount'/'rate' (gross) and 'amountAfterCost'/'rateAfterCost' (net of commission and tax). Use the AfterCost variants for realistic returns.
  - Each item: { symbol, name, marketCountry, currency, quantity, lastPrice, averagePurchasePrice, marketValue: { purchaseAmount, amount, amountAfterCost }, profitLoss, dailyProfitLoss, cost: { commission, tax } }, priced in the symbol's own currency.

Covers KR and US stocks only — overseas derivatives and bonds are excluded. No holdings gives zeroed totals and an empty item list.`,
            inputSchema: {
                account_seq: AccountSeqSchema,
                symbol: OptionalSymbolSchema.describe("Restrict to one symbol; totals are recomputed for it. Omit for the whole portfolio."),
                response_format: ResponseFormatSchema
            },
            outputSchema: HoldingsOutput,
            annotations: readOnly
        },
        async ({ account_seq, symbol, response_format }) => {
            const accountSeq = await resolveAccountSeq(account_seq);
            const holdings = await apiRequest<HoldingsPayload>("/api/v1/holdings", { accountSeq, query: { symbol } });
            return buildToolResult({
                format: response_format,
                structured: {
                    accountSeq,
                    count: holdings.items.length,
                    totalPurchaseAmount: holdings.totalPurchaseAmount,
                    marketValue: holdings.marketValue,
                    profitLoss: holdings.profitLoss,
                    dailyProfitLoss: holdings.dailyProfitLoss,
                    items: holdings.items
                },
                truncatableKey: "items",
                truncationHint: "Pass `symbol` to inspect individual positions.",
                renderMarkdown: (data) =>
                    section(
                        `Holdings — account ${accountSeq}${symbol ? ` (${symbol})` : ""}`,
                        [
                            "## Summary",
                            mdFields({
                                totalPurchaseAmount: data.totalPurchaseAmount,
                                marketValue: data.marketValue,
                                profitLoss: data.profitLoss,
                                dailyProfitLoss: data.dailyProfitLoss
                            }),
                            "",
                            `## Positions (${data.count})`,
                            mdTable(
                                [
                                    { header: "Symbol", get: (row: HoldingsItem) => row.symbol },
                                    { header: "Name", get: (row: HoldingsItem) => row.name },
                                    { header: "Market", get: (row: HoldingsItem) => row.marketCountry },
                                    { header: "Qty", get: (row: HoldingsItem) => row.quantity },
                                    { header: "Avg cost", get: (row: HoldingsItem) => row.averagePurchasePrice },
                                    { header: "Last", get: (row: HoldingsItem) => row.lastPrice },
                                    { header: "Value", get: (row: HoldingsItem) => row.marketValue?.amount },
                                    { header: "P/L", get: (row: HoldingsItem) => row.profitLoss?.amount },
                                    { header: "P/L %", get: (row: HoldingsItem) => row.profitLoss?.rate },
                                    { header: "Cur", get: (row: HoldingsItem) => row.currency }
                                ],
                                data.items
                            )
                        ].join("\n")
                    )
            });
        }
    );

    defineTool(
        server,
        "tossinvest_get_buying_power",
        {
            title: "Get available buying power",
            description: `Get how much cash is available to buy with, in KRW or USD.

Check this before placing a buy order — an order beyond it fails with 422 insufficient-buying-power.

Args:
  - currency ('KRW' | 'USD'): KRW for Korean stocks, USD for US stocks.
  - account_seq (number, optional): resolved automatically for single-account credentials.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { accountSeq, currency, cashBuyingPower }.
cashBuyingPower is cash-settled buying power only — margin (미수) is excluded, so this is the amount that can be spent without incurring a margin position.`,
            inputSchema: {
                currency: CurrencySchema.describe("'KRW' for Korean stocks, 'USD' for US stocks."),
                account_seq: AccountSeqSchema,
                response_format: ResponseFormatSchema
            },
            outputSchema: BuyingPowerOutput,
            annotations: readOnly
        },
        async ({ currency, account_seq, response_format }) => {
            const accountSeq = await resolveAccountSeq(account_seq);
            const power = await apiRequest<{ currency: string; cashBuyingPower: string }>("/api/v1/buying-power", {
                accountSeq,
                query: { currency }
            });
            return buildToolResult({
                format: response_format,
                structured: { accountSeq, ...power },
                renderMarkdown: (data) => section(`Buying power — account ${accountSeq}`, mdFields(data))
            });
        }
    );

    defineTool(
        server,
        "tossinvest_get_sellable_quantity",
        {
            title: "Get sellable quantity",
            description: `Get how many shares of one symbol can be sold right now.

This can be lower than the holding quantity — shares tied up in an open sell order or not yet settled are excluded. Check it before selling; exceeding it fails with 422 insufficient-sellable-quantity.

Args:
  - symbol (string): the symbol to check.
  - account_seq (number, optional): resolved automatically for single-account credentials.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { accountSeq, symbol, sellableQuantity }.
KR quantities are whole shares; US quantities can be fractional.`,
            inputSchema: {
                symbol: SymbolSchema,
                account_seq: AccountSeqSchema,
                response_format: ResponseFormatSchema
            },
            outputSchema: SellableQuantityOutput,
            annotations: readOnly
        },
        async ({ symbol, account_seq, response_format }) => {
            const accountSeq = await resolveAccountSeq(account_seq);
            const result = await apiRequest<{ sellableQuantity: string }>("/api/v1/sellable-quantity", {
                accountSeq,
                query: { symbol }
            });
            return buildToolResult({
                format: response_format,
                structured: { accountSeq, symbol, sellableQuantity: result.sellableQuantity },
                renderMarkdown: (data) => section(`Sellable quantity — ${symbol}`, mdFields(data))
            });
        }
    );

    defineTool(
        server,
        "tossinvest_get_commissions",
        {
            title: "Get trading commission rates",
            description: `Get the account's trading commission rates for the Korean and US markets.

Use this to estimate trading costs before ordering, or to explain the gap between gross and after-cost profit in holdings.

Args:
  - account_seq (number, optional): resolved automatically for single-account credentials.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { accountSeq, count, commissions: [{ marketCountry, commissionRate, startDate, endDate }] }.
commissionRate is a PERCENT: '0.015' means 0.015% of notional, i.e. multiply notional by 0.00015. startDate/endDate bound a promotional rate; both are null for US, and endDate is null for an open-ended rate.`,
            inputSchema: { account_seq: AccountSeqSchema, response_format: ResponseFormatSchema },
            outputSchema: CommissionsOutput,
            annotations: readOnly
        },
        async ({ account_seq, response_format }) => {
            const accountSeq = await resolveAccountSeq(account_seq);
            const commissions = await apiRequest<Commission[]>("/api/v1/commissions", { accountSeq });
            return buildToolResult({
                format: response_format,
                structured: { accountSeq, count: commissions.length, commissions },
                renderMarkdown: (data) =>
                    section(
                        `Commission rates — account ${accountSeq}`,
                        mdTable(
                            [
                                { header: "Market", get: (row: Commission) => row.marketCountry },
                                { header: "Rate (%)", get: (row: Commission) => row.commissionRate },
                                { header: "From", get: (row: Commission) => row.startDate },
                                { header: "To", get: (row: Commission) => row.endDate }
                            ],
                            data.commissions
                        )
                    )
            });
        }
    );
}
