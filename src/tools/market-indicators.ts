/**
 * Market Indicators tools — KOSPI/KOSDAQ indices, Korean treasury yields, and
 * KRX investor-flow data. These cover the eight catalog symbols only.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ResponseFormatSchema, buildToolResult, mdFields, mdTable, section, show } from "../format.js";
import { DateSchema, DateTimeSchema, IntervalSchema, MarketIndicatorSymbolSchema } from "../schemas/common.js";
import { InvestorTradingOutput, MarketIndicatorCandlesOutput, MarketIndicatorPricesOutput } from "../schemas/outputs.js";
import { apiRequest } from "../services/client.js";
import { defineTool } from "./registry.js";

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

interface IndicatorPrice {
    symbol: string;
    lastPrice: string;
    timestamp?: string | null;
}

interface IndicatorCandle {
    timestamp: string;
    openPrice: string;
    highPrice: string;
    lowPrice: string;
    closePrice: string;
    volume: string;
}

interface IndicatorCandlePage {
    candles: IndicatorCandle[];
    nextBefore?: string | null;
}

interface InvestorAmount {
    buyAmount: string;
    sellAmount: string;
}

interface InvestorRecord {
    date: string;
    updatedAt: string;
    individual: InvestorAmount;
    foreigner: InvestorAmount;
    institution: InvestorAmount & { breakdown?: Record<string, InvestorAmount> };
    otherCorporation: InvestorAmount;
}

interface InvestorTradingPayload {
    records: InvestorRecord[];
    nextUntil?: string | null;
}

/** buy - sell as a decimal string, tolerating oversized values via BigInt. */
function netAmount(entry: InvestorAmount | undefined): string {
    if (!entry) return "—";
    try {
        return (BigInt(entry.buyAmount) - BigInt(entry.sellAmount)).toString();
    } catch {
        return "—";
    }
}

export function registerMarketIndicatorTools(server: McpServer): void {
    defineTool(
        server,
        "tossinvest_get_market_indicator_prices",
        {
            title: "Get index and bond yield prices",
            description: `Get the current level of Korean market indices and treasury yields.

Supported symbols (this catalog and nothing else):
  - KOSPI, KOSDAQ — index level in points
  - KR_BOND_2Y, KR_BOND_3Y, KR_BOND_5Y, KR_BOND_10Y, KR_BOND_20Y, KR_BOND_30Y — yield in percent ('3.25' means 3.25%)

Args:
  - symbols (string): Comma-separated catalog symbols, e.g. 'KOSPI,KOSDAQ'.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { count, prices: [{ symbol, lastPrice, timestamp }] }.

For individual stocks use tossinvest_get_prices — this endpoint rejects stock symbols.

Errors: 400 unsupported-symbol for anything outside the catalog.`,
            inputSchema: {
                symbols: z
                    .string()
                    .regex(/^[A-Za-z0-9_,]+$/, "Symbols must be comma-separated catalog symbols")
                    .describe("Comma-separated catalog symbols, e.g. 'KOSPI,KOSDAQ' or 'KR_BOND_3Y,KR_BOND_10Y'."),
                response_format: ResponseFormatSchema
            },
            outputSchema: MarketIndicatorPricesOutput,
            annotations: readOnly
        },
        async ({ symbols, response_format }) => {
            const prices = await apiRequest<IndicatorPrice[]>("/api/v1/market-indicators/prices", { query: { symbols } });
            return buildToolResult({
                format: response_format,
                structured: { count: prices.length, prices },
                renderMarkdown: (data) =>
                    section(
                        `Market indicators (${data.count})`,
                        mdTable(
                            [
                                { header: "Symbol", get: (row: IndicatorPrice) => row.symbol },
                                { header: "Value", get: (row: IndicatorPrice) => row.lastPrice },
                                { header: "As of", get: (row: IndicatorPrice) => row.timestamp }
                            ],
                            data.prices
                        )
                    )
            });
        }
    );

    defineTool(
        server,
        "tossinvest_get_market_indicator_candles",
        {
            title: "Get index or bond yield candles",
            description: `Get OHLCV history for a Korean index or treasury yield, newest bar first. Max 200 bars per call.

Args:
  - symbol: one of KOSPI, KOSDAQ, KR_BOND_2Y, KR_BOND_3Y, KR_BOND_5Y, KR_BOND_10Y, KR_BOND_20Y, KR_BOND_30Y.
  - interval ('1m' | '1d'): '1m' is supported for KOSPI and KOSDAQ ONLY. KR_BOND_* support '1d' only and reject '1m' with 400 invalid-request.
  - count (number): 1-200, default 100.
  - before (string, optional): ISO 8601 inclusive upper bound. Pass the previous response's nextBefore to page backwards.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { symbol, interval, count, candles: [{ timestamp, openPrice, highPrice, lowPrice, closePrice, volume }], nextBefore }.
For KR_BOND_* the OHLC values are yields in percent, not prices.

Errors: 400 unsupported-symbol outside the catalog; 400 invalid-request for '1m' on a bond symbol.`,
            inputSchema: {
                symbol: MarketIndicatorSymbolSchema,
                interval: IntervalSchema.describe("'1d' for all symbols; '1m' only for KOSPI and KOSDAQ."),
                count: z.number().int().min(1).max(200).default(100).describe("Number of bars to return (max 200)."),
                before: DateTimeSchema.optional().describe("Inclusive upper bound (ISO 8601). Use the previous response's nextBefore to page backwards."),
                response_format: ResponseFormatSchema
            },
            outputSchema: MarketIndicatorCandlesOutput,
            annotations: readOnly
        },
        async ({ symbol, interval, count, before, response_format }) => {
            const page = await apiRequest<IndicatorCandlePage>(`/api/v1/market-indicators/${encodeURIComponent(symbol)}/candles`, {
                query: { interval, count, before }
            });
            return buildToolResult({
                format: response_format,
                structured: {
                    symbol,
                    interval,
                    count: page.candles.length,
                    candles: page.candles,
                    nextBefore: page.nextBefore ?? null
                },
                truncatableKey: "candles",
                truncationHint: "Lower `count`, or page with `before`.",
                renderMarkdown: (data) =>
                    section(
                        `${symbol} candles (${interval}, ${data.count} bars)`,
                        [
                            mdTable(
                                [
                                    { header: "Time", get: (row: IndicatorCandle) => row.timestamp },
                                    { header: "Open", get: (row: IndicatorCandle) => row.openPrice },
                                    { header: "High", get: (row: IndicatorCandle) => row.highPrice },
                                    { header: "Low", get: (row: IndicatorCandle) => row.lowPrice },
                                    { header: "Close", get: (row: IndicatorCandle) => row.closePrice },
                                    { header: "Volume", get: (row: IndicatorCandle) => row.volume }
                                ],
                                data.candles
                            ),
                            "",
                            `nextBefore: ${show(data.nextBefore)}`
                        ].join("\n")
                    )
            });
        }
    );

    defineTool(
        server,
        "tossinvest_get_investor_trading",
        {
            title: "Get investor-type trading flows",
            description: `Get KRX buy/sell value broken down by investor type for KOSPI or KOSDAQ, newest period first.

This answers "are foreigners buying or selling?" — the classic Korean-market flow question. Net flow = buyAmount - sellAmount.

Args:
  - symbol ('KOSPI' | 'KOSDAQ'): only these two are supported here.
  - interval ('1d' | '1w' | '1mo' | '1y'): the period each record aggregates.
  - count (number): 1-100, default 10.
  - until (string, optional): YYYY-MM-DD inclusive upper bound. Pass the previous response's nextUntil to page backwards.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { symbol, interval, count, records: [{ date, updatedAt, individual, foreigner, institution, otherCorporation }], nextUntil }.
Each investor entry is { buyAmount, sellAmount }; institution additionally carries a 'breakdown' with seven sub-categories (financialInvestment, insurance, trust, privateEquityFund, bank, otherFinancialInstitution, pensionFund) that sum to the institution totals.

All amounts are KRW integers as strings — there is no currency field. 'foreigner' is the total across registered and unregistered foreign investors. Buy totals across the four categories equal sell totals market-wide. The current day's record is provisional until the close; check updatedAt.

Errors: 400 unsupported-symbol for anything other than KOSPI/KOSDAQ.`,
            inputSchema: {
                symbol: z.enum(["KOSPI", "KOSDAQ"]).describe("Only KOSPI and KOSDAQ have investor flow data."),
                interval: z.enum(["1d", "1w", "1mo", "1y"]).describe("Aggregation period per record: daily, weekly, monthly or yearly."),
                count: z.number().int().min(1).max(100).default(10).describe("Number of records to return (max 100)."),
                until: DateSchema.optional().describe("Inclusive upper bound (YYYY-MM-DD). Use the previous response's nextUntil to page backwards."),
                response_format: ResponseFormatSchema
            },
            outputSchema: InvestorTradingOutput,
            annotations: readOnly
        },
        async ({ symbol, interval, count, until, response_format }) => {
            const payload = await apiRequest<InvestorTradingPayload>(
                `/api/v1/market-indicators/${encodeURIComponent(symbol)}/investor-trading`,
                { query: { interval, count, until } }
            );
            return buildToolResult({
                format: response_format,
                structured: {
                    symbol,
                    interval,
                    count: payload.records.length,
                    records: payload.records,
                    nextUntil: payload.nextUntil ?? null
                },
                truncatableKey: "records",
                truncationHint: "Lower `count`, or page with `until`.",
                renderMarkdown: (data) =>
                    section(
                        `Investor trading — ${symbol} (${interval}, ${data.count} records)`,
                        [
                            "Net = buy - sell, in KRW.",
                            "",
                            mdTable(
                                [
                                    { header: "Date", get: (row: InvestorRecord) => row.date },
                                    { header: "Individual net", get: (row: InvestorRecord) => netAmount(row.individual) },
                                    { header: "Foreigner net", get: (row: InvestorRecord) => netAmount(row.foreigner) },
                                    { header: "Institution net", get: (row: InvestorRecord) => netAmount(row.institution) },
                                    { header: "Other corp. net", get: (row: InvestorRecord) => netAmount(row.otherCorporation) },
                                    { header: "Updated", get: (row: InvestorRecord) => row.updatedAt }
                                ],
                                data.records
                            ),
                            "",
                            data.records[0]
                                ? `## Gross amounts — most recent period (${show(data.records[0].date)})\n${mdFields({
                                      individual: data.records[0].individual,
                                      foreigner: data.records[0].foreigner,
                                      institution: data.records[0].institution,
                                      otherCorporation: data.records[0].otherCorporation
                                  })}`
                                : "",
                            "",
                            `nextUntil: ${show(data.nextUntil)}`
                        ].join("\n")
                    )
            });
        }
    );
}
