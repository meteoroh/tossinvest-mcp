/**
 * Ranking tool — most-traded / biggest-moving stock leaderboards.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ResponseFormatSchema, buildToolResult, mdTable, section, show } from "../format.js";
import { MarketCountrySchema } from "../schemas/common.js";
import { RankingsOutput } from "../schemas/outputs.js";
import { apiRequest } from "../services/client.js";
import { defineTool } from "./registry.js";

interface RankingItem {
    rank: number;
    symbol: string;
    currency: string;
    price: { lastPrice: string; basePrice: string; changeRate?: string | null };
    tradingVolume: string;
    tradingAmount: string;
}

interface RankingPayload {
    rankedAt?: string | null;
    rankings: RankingItem[];
}

export function registerRankingTools(server: McpServer): void {
    defineTool(
        server,
        "tossinvest_get_rankings",
        {
            title: "Get stock rankings",
            description: `Get a top-100 stock leaderboard by traded value, traded volume, or price change, for the Korean or US market over a chosen period.

This is the discovery tool: "what is moving today", "most actively traded Korean stocks this week", "biggest losers this month".

Args:
  - type: which leaderboard, and implicitly which metric it is sorted by:
      MARKET_TRADING_AMOUNT — highest traded value, whole market
      MARKET_TRADING_VOLUME — highest traded volume, whole market
      TOP_GAINERS — largest price gain (does NOT support duration='realtime')
      TOP_LOSERS — largest price drop (does NOT support duration='realtime')
      TOSS_SECURITIES_TRADING_AMOUNT — highest traded value among Toss Securities fills only
      TOSS_SECURITIES_TRADING_VOLUME — highest traded volume among Toss Securities fills only
  - market_country ('KR' | 'US'): which market.
  - duration ('realtime' | '1d' | '1w' | '1mo' | '3mo' | '6mo' | '1y'): ranking period, in trading days.
  - exclude_investment_caution (boolean): default false. Filter out symbols under a caution designation.
  - count (number): 1-100, default 100.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { type, marketCountry, duration, count, rankedAt, rankings: [{ rank, symbol, currency, price: { lastPrice, basePrice, changeRate }, tradingVolume, tradingAmount }] }.

Reading the numbers correctly:
  - tradingVolume / tradingAmount are cumulative over 'duration'. For TOSS_SECURITIES_* they count Toss Securities fills only; otherwise the whole market.
  - price.basePrice and price.changeRate are measured from the START of 'duration' for TOP_GAINERS/TOP_LOSERS, but against the PREVIOUS CLOSE for every other type.
  - Fewer than 'count' items can come back (symbols whose quote lookup failed are dropped).
  - An uncomputed combination returns an empty list with rankedAt null — not an error.

Symbols come back without names; pass them to tossinvest_get_stocks to resolve company names.

Errors: 400 unsupported-ranking-duration for TOP_GAINERS/TOP_LOSERS with duration='realtime'.`,
            inputSchema: {
                type: z
                    .enum([
                        "MARKET_TRADING_AMOUNT",
                        "MARKET_TRADING_VOLUME",
                        "TOP_GAINERS",
                        "TOP_LOSERS",
                        "TOSS_SECURITIES_TRADING_AMOUNT",
                        "TOSS_SECURITIES_TRADING_VOLUME"
                    ])
                    .describe("Which leaderboard. TOP_GAINERS/TOP_LOSERS cannot be combined with duration='realtime'."),
                market_country: MarketCountrySchema.describe("'KR' for Korean stocks, 'US' for US stocks."),
                duration: z
                    .enum(["realtime", "1d", "1w", "1mo", "3mo", "6mo", "1y"])
                    .describe("Ranking period in trading days. 'realtime' is unavailable for TOP_GAINERS/TOP_LOSERS."),
                exclude_investment_caution: z.boolean().default(false).describe("Exclude symbols under an investment-caution designation."),
                count: z.number().int().min(1).max(100).default(100).describe("Number of ranked entries to return (max 100)."),
                response_format: ResponseFormatSchema
            },
            outputSchema: RankingsOutput,
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
        },
        async ({ type, market_country, duration, exclude_investment_caution, count, response_format }) => {
            const payload = await apiRequest<RankingPayload>("/api/v1/rankings", {
                query: {
                    type,
                    marketCountry: market_country,
                    duration,
                    excludeInvestmentCaution: exclude_investment_caution,
                    count
                }
            });
            return buildToolResult({
                format: response_format,
                structured: {
                    type,
                    marketCountry: market_country,
                    duration,
                    count: payload.rankings.length,
                    rankedAt: payload.rankedAt ?? null,
                    rankings: payload.rankings
                },
                truncatableKey: "rankings",
                truncationHint: "Lower `count` to stay under the limit.",
                renderMarkdown: (data) =>
                    section(
                        `${type} — ${market_country}, ${duration} (${data.count})`,
                        [
                            `Ranked at: ${show(data.rankedAt)}`,
                            "",
                            mdTable(
                                [
                                    { header: "#", get: (row: RankingItem) => row.rank },
                                    { header: "Symbol", get: (row: RankingItem) => row.symbol },
                                    { header: "Last", get: (row: RankingItem) => row.price?.lastPrice },
                                    { header: "Base", get: (row: RankingItem) => row.price?.basePrice },
                                    { header: "Change rate", get: (row: RankingItem) => row.price?.changeRate },
                                    { header: "Volume", get: (row: RankingItem) => row.tradingVolume },
                                    { header: "Amount", get: (row: RankingItem) => row.tradingAmount },
                                    { header: "Cur", get: (row: RankingItem) => row.currency }
                                ],
                                data.rankings
                            )
                        ].join("\n")
                    )
            });
        }
    );
}
