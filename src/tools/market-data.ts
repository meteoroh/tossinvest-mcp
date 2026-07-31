/**
 * Market Data tools — quotes, order book, trades, price limits and candles.
 * All are token-only (no account context required).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ResponseFormatSchema, buildToolResult, mdFields, mdTable, section, show } from "../format.js";
import { DateTimeSchema, IntervalSchema, SymbolListSchema, SymbolSchema } from "../schemas/common.js";
import { CandlesOutput, OrderbookOutput, PriceLimitsOutput, PricesOutput, TradesOutput } from "../schemas/outputs.js";
import { apiRequest } from "../services/client.js";
import { defineTool } from "./registry.js";

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

interface PriceEntry {
    symbol: string;
    lastPrice: string;
    currency: string;
    timestamp?: string | null;
}

interface OrderbookLevel {
    price: string;
    volume: string;
}

interface OrderbookPayload {
    timestamp?: string | null;
    currency: string;
    asks: OrderbookLevel[];
    bids: OrderbookLevel[];
}

interface TradeEntry {
    price: string;
    volume: string;
    timestamp: string;
    currency: string;
}

interface PriceLimitPayload {
    timestamp?: string | null;
    upperLimitPrice?: string | null;
    lowerLimitPrice?: string | null;
    currency: string;
}

interface CandleEntry {
    timestamp: string;
    openPrice: string;
    highPrice: string;
    lowPrice: string;
    closePrice: string;
    volume: string;
    currency: string;
}

interface CandlePage {
    candles: CandleEntry[];
    nextBefore?: string | null;
}

export function registerMarketDataTools(server: McpServer): void {
    defineTool(
        server,
        "tossinvest_get_prices",
        {
            title: "Get current prices",
            description: `Get the latest traded price for one or more Korean (KRX) or US stocks.

This is the cheapest way to answer "what is X trading at". Up to 200 symbols in one call, so batch rather than looping.

Args:
  - symbols (string): Comma-separated symbols, max 200, no spaces. KRX = 6 digits ('005930'), US = ticker ('AAPL').
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { count, prices: [{ symbol, lastPrice, currency, timestamp }] }.
lastPrice is a decimal string in the symbol's own currency (KRW for KRX, USD for US). timestamp is null when the symbol has not traded yet today.

Examples:
  - "How much is Samsung Electronics?" -> symbols='005930'
  - "Compare Apple and Microsoft" -> symbols='AAPL,MSFT'
  - Don't use for indices (KOSPI/KOSDAQ) or bond yields — use tossinvest_get_market_indicator_prices.

Errors: 404 stock-not-found when a symbol does not exist.`,
            inputSchema: { symbols: SymbolListSchema, response_format: ResponseFormatSchema },
            outputSchema: PricesOutput,
            annotations: readOnly
        },
        async ({ symbols, response_format }) => {
            const prices = await apiRequest<PriceEntry[]>("/api/v1/prices", { query: { symbols } });
            return buildToolResult({
                format: response_format,
                structured: { count: prices.length, prices },
                truncatableKey: "prices",
                truncationHint: "Request fewer symbols per call.",
                renderMarkdown: (data) =>
                    section(
                        `Current prices (${data.count})`,
                        mdTable(
                            [
                                { header: "Symbol", get: (row: PriceEntry) => row.symbol },
                                { header: "Last price", get: (row: PriceEntry) => row.lastPrice },
                                { header: "Currency", get: (row: PriceEntry) => row.currency },
                                { header: "As of", get: (row: PriceEntry) => row.timestamp }
                            ],
                            data.prices
                        )
                    )
            });
        }
    );

    defineTool(
        server,
        "tossinvest_get_orderbook",
        {
            title: "Get order book",
            description: `Get the current bid/ask ladder (호가) for one stock.

Use this to judge liquidity and spread before choosing a limit price. For the single last-traded price use tossinvest_get_prices instead — it is cheaper and supports batching.

Args:
  - symbol (string): One symbol. KRX = 6 digits, US = ticker.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { symbol, currency, timestamp, asks: [{ price, volume }], bids: [{ price, volume }] }.
asks are ascending by price (best ask first), bids descending (best bid first). Both arrays may be empty outside trading hours.

Errors: 404 stock-not-found for unknown symbols.`,
            inputSchema: { symbol: SymbolSchema, response_format: ResponseFormatSchema },
            outputSchema: OrderbookOutput,
            annotations: readOnly
        },
        async ({ symbol, response_format }) => {
            const book = await apiRequest<OrderbookPayload>("/api/v1/orderbook", { query: { symbol } });
            return buildToolResult({
                format: response_format,
                structured: { symbol, ...book },
                renderMarkdown: (data) => {
                    const levels = [
                        { header: "Side", get: (row: OrderbookLevel & { side: string }) => row.side },
                        { header: "Price", get: (row: OrderbookLevel & { side: string }) => row.price },
                        { header: "Volume", get: (row: OrderbookLevel & { side: string }) => row.volume }
                    ];
                    const rows = [
                        ...[...data.asks].reverse().map((level) => ({ ...level, side: "ask" })),
                        ...data.bids.map((level) => ({ ...level, side: "bid" }))
                    ];
                    return section(
                        `Order book — ${symbol}`,
                        [`Currency: ${show(data.currency)} · As of: ${show(data.timestamp)}`, "", mdTable(levels, rows)].join("\n")
                    );
                }
            });
        }
    );

    defineTool(
        server,
        "tossinvest_get_trades",
        {
            title: "Get recent trades",
            description: `Get today's most recent executed trades (체결 내역) for one stock, newest first.

Useful for gauging very recent momentum and actual traded sizes. Only covers the current session — it is not a historical trade archive.

Args:
  - symbol (string): One symbol.
  - count (number): 1-50, default 50.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { symbol, count, trades: [{ price, volume, timestamp, currency }] }.
Returns an empty list before the session's first trade.

Errors: 404 stock-not-found for unknown symbols.`,
            inputSchema: {
                symbol: SymbolSchema,
                count: z.number().int().min(1).max(50).default(50).describe("Number of trades to return (max 50)."),
                response_format: ResponseFormatSchema
            },
            outputSchema: TradesOutput,
            annotations: readOnly
        },
        async ({ symbol, count, response_format }) => {
            const trades = await apiRequest<TradeEntry[]>("/api/v1/trades", { query: { symbol, count } });
            return buildToolResult({
                format: response_format,
                structured: { symbol, count: trades.length, trades },
                truncatableKey: "trades",
                truncationHint: "Lower `count` to stay under the limit.",
                renderMarkdown: (data) =>
                    section(
                        `Recent trades — ${symbol} (${data.count})`,
                        mdTable(
                            [
                                { header: "Time", get: (row: TradeEntry) => row.timestamp },
                                { header: "Price", get: (row: TradeEntry) => row.price },
                                { header: "Volume", get: (row: TradeEntry) => row.volume }
                            ],
                            data.trades
                        )
                    )
            });
        }
    );

    defineTool(
        server,
        "tossinvest_get_price_limits",
        {
            title: "Get daily price limits",
            description: `Get today's upper and lower price limits (상한가/하한가) for one stock.

Check this before placing a limit order: a price outside the band is rejected with 422 price-out-of-range.

Args:
  - symbol (string): One symbol.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { symbol, currency, timestamp, upperLimitPrice, lowerLimitPrice }.
Limits are decimal strings; either can be null for markets without a daily band (US stocks generally have none).

Errors: 404 stock-not-found for unknown symbols.`,
            inputSchema: { symbol: SymbolSchema, response_format: ResponseFormatSchema },
            outputSchema: PriceLimitsOutput,
            annotations: readOnly
        },
        async ({ symbol, response_format }) => {
            const limits = await apiRequest<PriceLimitPayload>("/api/v1/price-limits", { query: { symbol } });
            return buildToolResult({
                format: response_format,
                structured: { symbol, ...limits },
                renderMarkdown: (data) => section(`Price limits — ${symbol}`, mdFields(data))
            });
        }
    );

    defineTool(
        server,
        "tossinvest_get_candles",
        {
            title: "Get candle chart data",
            description: `Get OHLCV candles for one stock, newest bar first. Max 200 bars per call.

This is the tool for historical price analysis: trends, ranges, moving averages, "how did X do last month".

Args:
  - symbol (string): One symbol.
  - interval ('1m' | '1d'): 1-minute or daily bars.
  - count (number): 1-200, default 100.
  - before (string, optional): ISO 8601 upper bound, inclusive — only bars at or before this instant. Pass the previous response's nextBefore to page backwards in time. Omit for the newest bars.
  - adjusted (boolean): default true. Adjust for splits/dividends. Set false for raw prices.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { symbol, interval, count, candles: [{ timestamp, openPrice, highPrice, lowPrice, closePrice, volume, currency }], nextBefore }.
timestamp is the bar's OPEN time. nextBefore is null when no older data exists.

Examples:
  - "Samsung's last 30 trading days" -> symbol='005930', interval='1d', count=30
  - "Apple intraday today" -> symbol='AAPL', interval='1m', count=200
  - For indices use tossinvest_get_market_indicator_candles instead.`,
            inputSchema: {
                symbol: SymbolSchema,
                interval: IntervalSchema,
                count: z.number().int().min(1).max(200).default(100).describe("Number of bars to return (max 200)."),
                before: DateTimeSchema.optional().describe(
                    "Inclusive upper bound (ISO 8601). Only bars at or before this instant. Use the previous response's nextBefore to page backwards."
                ),
                adjusted: z.boolean().default(true).describe("Apply split/dividend adjustment. Default true."),
                response_format: ResponseFormatSchema
            },
            outputSchema: CandlesOutput,
            annotations: readOnly
        },
        async ({ symbol, interval, count, before, adjusted, response_format }) => {
            const page = await apiRequest<CandlePage>("/api/v1/candles", {
                query: { symbol, interval, count, before, adjusted }
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
                        `Candles — ${symbol} (${interval}, ${data.count} bars)`,
                        [
                            mdTable(
                                [
                                    { header: "Time", get: (row: CandleEntry) => row.timestamp },
                                    { header: "Open", get: (row: CandleEntry) => row.openPrice },
                                    { header: "High", get: (row: CandleEntry) => row.highPrice },
                                    { header: "Low", get: (row: CandleEntry) => row.lowPrice },
                                    { header: "Close", get: (row: CandleEntry) => row.closePrice },
                                    { header: "Volume", get: (row: CandleEntry) => row.volume }
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
}
