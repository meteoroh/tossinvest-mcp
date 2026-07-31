/**
 * Stock Info tools — symbol master data and purchase warnings.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResponseFormatSchema, buildToolResult, mdTable, section } from "../format.js";
import { SymbolListSchema, SymbolSchema } from "../schemas/common.js";
import { StockWarningsOutput, StocksOutput } from "../schemas/outputs.js";
import { apiRequest } from "../services/client.js";
import { defineTool } from "./registry.js";

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

interface StockInfo {
    symbol: string;
    name: string;
    englishName: string;
    market: string;
    securityType: string;
    isCommonShare: boolean;
    status: string;
    currency: string;
    listDate?: string | null;
    sharesOutstanding: string;
    koreanMarketDetail?: { krxTradingSuspended?: boolean; liquidationTrading?: boolean } | null;
}

interface StockWarning {
    warningType: string;
    exchange?: string | null;
    startDate?: string | null;
    endDate?: string | null;
}

export function registerStockInfoTools(server: McpServer): void {
    defineTool(
        server,
        "tossinvest_get_stocks",
        {
            title: "Get stock reference data",
            description: `Get reference/master data for one or more symbols: names, listing market, security type, currency, listing status and shares outstanding.

Use this to resolve what a symbol actually is, to check a symbol is still listed and tradable before ordering, or to get the shares-outstanding figure needed for a market-cap calculation (market cap = lastPrice x sharesOutstanding).

Args:
  - symbols (string): Comma-separated symbols, max 200, no spaces.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { count, stocks: [{ symbol, name, englishName, isinCode, market, securityType, isCommonShare, status, currency, listDate, delistDate, sharesOutstanding, leverageFactor, koreanMarketDetail }] }.
  - market: KOSPI, KOSDAQ, NYSE, NASDAQ, AMEX, KR_ETC, US_ETC
  - securityType: STOCK, FOREIGN_STOCK, DEPOSITARY_RECEIPT, INFRASTRUCTURE_FUND, REIT, ETF, FOREIGN_ETF, ETN, STOCK_WARRANTS
  - status: SCHEDULED (not yet listed), ACTIVE, DELISTED
  - isCommonShare: false for preferred shares
  - koreanMarketDetail (KR symbols only): { liquidationTrading, nxtSupported, krxTradingSuspended, nxtTradingSuspended }

This does NOT search by company name — it takes symbols only. It also returns no prices; use tossinvest_get_prices for those.

Errors: 404 stock-not-found when a symbol does not exist.`,
            inputSchema: { symbols: SymbolListSchema, response_format: ResponseFormatSchema },
            outputSchema: StocksOutput,
            annotations: readOnly
        },
        async ({ symbols, response_format }) => {
            const stocks = await apiRequest<StockInfo[]>("/api/v1/stocks", { query: { symbols } });
            return buildToolResult({
                format: response_format,
                structured: { count: stocks.length, stocks },
                truncatableKey: "stocks",
                truncationHint: "Request fewer symbols per call.",
                renderMarkdown: (data) =>
                    section(
                        `Stock reference data (${data.count})`,
                        mdTable(
                            [
                                { header: "Symbol", get: (row: StockInfo) => row.symbol },
                                { header: "Name", get: (row: StockInfo) => row.name },
                                { header: "English", get: (row: StockInfo) => row.englishName },
                                { header: "Market", get: (row: StockInfo) => row.market },
                                { header: "Type", get: (row: StockInfo) => row.securityType },
                                { header: "Status", get: (row: StockInfo) => row.status },
                                { header: "Currency", get: (row: StockInfo) => row.currency },
                                { header: "Common", get: (row: StockInfo) => row.isCommonShare },
                                { header: "Listed", get: (row: StockInfo) => row.listDate },
                                { header: "Shares out.", get: (row: StockInfo) => row.sharesOutstanding }
                            ],
                            data.stocks
                        )
                    )
            });
        }
    );

    defineTool(
        server,
        "tossinvest_get_stock_warnings",
        {
            title: "Get stock purchase warnings",
            description: `Get the currently active trading warnings and volatility-interruption (VI) flags for one symbol.

Check this before buying anything unfamiliar — these flags mark designations that restrict or endanger trading.

Args:
  - symbol (string): One symbol.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { symbol, count, warnings: [{ warningType, exchange, startDate, endDate }] }, sorted by startDate descending.
warningType values:
  - LIQUIDATION_TRADING (정리매매) — delisting liquidation period
  - OVERHEATED (단기과열)
  - INVESTMENT_WARNING (투자경고) / INVESTMENT_RISK (투자위험)
  - VI_STATIC / VI_DYNAMIC / VI_STATIC_AND_DYNAMIC — volatility interruption triggered
  - STOCK_WARRANTS (신주인수권)
endDate is null while a designation is still open-ended.

An existing symbol with no active warnings returns count 0 and an empty list — that is a clean result, not an error. VI flags update within seconds; exchange designations update on a daily batch.

Errors: 404 stock-not-found when the symbol does not exist.`,
            inputSchema: { symbol: SymbolSchema, response_format: ResponseFormatSchema },
            outputSchema: StockWarningsOutput,
            annotations: readOnly
        },
        async ({ symbol, response_format }) => {
            const warnings = await apiRequest<StockWarning[]>(`/api/v1/stocks/${encodeURIComponent(symbol)}/warnings`);
            return buildToolResult({
                format: response_format,
                structured: { symbol, count: warnings.length, warnings },
                renderMarkdown: (data) =>
                    section(
                        `Warnings — ${symbol}`,
                        data.count === 0
                            ? "No active warnings for this symbol."
                            : mdTable(
                                  [
                                      { header: "Type", get: (row: StockWarning) => row.warningType },
                                      { header: "Exchange", get: (row: StockWarning) => row.exchange },
                                      { header: "Start", get: (row: StockWarning) => row.startDate },
                                      { header: "End", get: (row: StockWarning) => row.endDate }
                                  ],
                                  data.warnings
                              )
                    )
            });
        }
    );
}
