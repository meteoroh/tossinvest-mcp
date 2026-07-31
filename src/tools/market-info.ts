/**
 * Market Info tools — FX rate and trading-session calendars.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResponseFormatSchema, buildToolResult, mdFields, section } from "../format.js";
import { CurrencySchema, DateSchema, DateTimeSchema, MarketCountrySchema } from "../schemas/common.js";
import { ExchangeRateOutput, MarketCalendarOutput } from "../schemas/outputs.js";
import { apiRequest } from "../services/client.js";
import { defineTool } from "./registry.js";

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

interface ExchangeRatePayload {
    baseCurrency: string;
    quoteCurrency: string;
    rate: string;
    midRate: string;
    basisPoint: string;
    rateChangeType: string;
    validFrom: string;
    validUntil: string;
}

interface CalendarPayload {
    today: Record<string, unknown>;
    previousBusinessDay: Record<string, unknown>;
    nextBusinessDay: Record<string, unknown>;
}

export function registerMarketInfoTools(server: McpServer): void {
    defineTool(
        server,
        "tossinvest_get_exchange_rate",
        {
            title: "Get KRW/USD exchange rate",
            description: `Get the KRW <-> USD exchange rate, refreshed once a minute.

Use this to convert between the KRW and USD figures that holdings and orders report separately.

Args:
  - base_currency ('KRW' | 'USD'): the currency being priced.
  - quote_currency ('KRW' | 'USD'): the currency it is priced in. E.g. base='USD', quote='KRW' gives won per dollar.
  - date_time (string, optional): ISO 8601 instant for a historical rate. Omit for the current rate.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { baseCurrency, quoteCurrency, rate, midRate, basisPoint, rateChangeType, validFrom, validUntil }.
rateChangeType is UP, EQUAL or DOWN. validFrom/validUntil bound the ~1-minute window this quote applies to.

This is an indicative display rate — the rate actually applied when an order settles can differ.

Errors: 404 exchange-rate-not-found when no rate exists for the requested instant.`,
            inputSchema: {
                base_currency: CurrencySchema.describe("Base currency — the one being priced."),
                quote_currency: CurrencySchema.describe("Quote currency — the one it is priced in."),
                date_time: DateTimeSchema.optional().describe("Historical instant (ISO 8601). Omit for the current rate."),
                response_format: ResponseFormatSchema
            },
            outputSchema: ExchangeRateOutput,
            annotations: readOnly
        },
        async ({ base_currency, quote_currency, date_time, response_format }) => {
            const rate = await apiRequest<ExchangeRatePayload>("/api/v1/exchange-rate", {
                query: { baseCurrency: base_currency, quoteCurrency: quote_currency, dateTime: date_time }
            });
            return buildToolResult({
                format: response_format,
                structured: { ...rate },
                renderMarkdown: (data) => section(`Exchange rate — ${base_currency}/${quote_currency}`, mdFields(data))
            });
        }
    );

    defineTool(
        server,
        "tossinvest_get_market_calendar",
        {
            title: "Get market trading hours",
            description: `Get trading-session hours for the Korean or US market across three business days: previous, current and next.

Use this to answer "is the market open?", "when does it open?", or to explain an order-hours-closed rejection. All times are ISO 8601 in KST (+09:00) for BOTH markets — US session times are already converted to Korean time.

Args:
  - country ('KR' | 'US'): which market.
  - date (string, optional): YYYY-MM-DD reference date. Omit for today. For US, this is the US local date.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns { country, previousBusinessDay, today, nextBusinessDay }, each { date, ...sessions }.
  - KR: an 'integrated' object (KRX + NXT combined) holding preMarket / regularMarket / afterMarket, each { startTime, endTime }. After-hours single-price and closing-price sessions are excluded.
  - US: dayMarket, preMarket, regularMarket, afterMarket, each { startTime, endTime } or null. On a holiday all four are null.

Errors: none specific; an invalid date format returns 400 invalid-request.`,
            inputSchema: {
                country: MarketCountrySchema.describe("'KR' for the Korean market (KRX/NXT), 'US' for the US market."),
                date: DateSchema.optional().describe("Reference date (YYYY-MM-DD). Omit for today."),
                response_format: ResponseFormatSchema
            },
            outputSchema: MarketCalendarOutput,
            annotations: readOnly
        },
        async ({ country, date, response_format }) => {
            const calendar = await apiRequest<CalendarPayload>(`/api/v1/market-calendar/${country}`, { query: { date } });
            return buildToolResult({
                format: response_format,
                structured: {
                    country,
                    previousBusinessDay: calendar.previousBusinessDay,
                    today: calendar.today,
                    nextBusinessDay: calendar.nextBusinessDay
                },
                renderMarkdown: (data) =>
                    section(
                        `${country} market calendar`,
                        [
                            "All times are KST (+09:00).",
                            "",
                            "## Previous business day",
                            mdFields(data.previousBusinessDay),
                            "",
                            "## Today",
                            mdFields(data.today),
                            "",
                            "## Next business day",
                            mdFields(data.nextBusinessDay)
                        ].join("\n")
                    )
            });
        }
    );
}
