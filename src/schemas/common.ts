/**
 * Input schema fragments reused across tools.
 */

import { z } from "zod";
import { MARKET_INDICATOR_SYMBOLS } from "../constants.js";

const SYMBOL_PATTERN = /^[A-Za-z0-9.\-]+$/;
const SYMBOL_LIST_PATTERN = /^[A-Za-z0-9.,\-]+$/;

export const SymbolSchema = z
    .string()
    .min(1)
    .max(32)
    .regex(SYMBOL_PATTERN, "Symbol may contain only letters, digits, '.' and '-'")
    .describe("Stock symbol. KRX: 6 digits (e.g. '005930' for Samsung Electronics). US: ticker (e.g. 'AAPL').");

export const SymbolListSchema = z
    .string()
    .min(1)
    .regex(SYMBOL_LIST_PATTERN, "Symbols must be comma-separated letters, digits, '.' and '-'")
    .describe("Comma-separated stock symbols, up to 200 (e.g. '005930,000660' or 'AAPL,MSFT'). No spaces.");

export const OptionalSymbolSchema = SymbolSchema.optional();

export const AccountSeqSchema = z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
        "accountSeq of the account to act on (the `X-Tossinvest-Account` header). Optional: falls back to TOSSINVEST_ACCOUNT_SEQ, then to the sole account on the credentials. Get valid values from tossinvest_list_accounts."
    );

export const CurrencySchema = z.enum(["KRW", "USD"]);

export const MarketCountrySchema = z.enum(["KR", "US"]);

export const IntervalSchema = z.enum(["1m", "1d"]).describe("Candle interval: '1m' = 1-minute bars, '1d' = daily bars.");

export const MarketIndicatorSymbolSchema = z
    .enum(MARKET_INDICATOR_SYMBOLS)
    .describe("Market indicator symbol. Indices: KOSPI, KOSDAQ. Korean treasury yields: KR_BOND_2Y/3Y/5Y/10Y/20Y/30Y.");

export const DateSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .describe("Date in YYYY-MM-DD format.");

export const DateTimeSchema = z
    .string()
    .min(4)
    .describe("ISO 8601 timestamp, e.g. '2026-03-25T09:00:00+09:00'. Pass it verbatim — URL encoding is handled for you.");

/** Decimal amounts travel as strings so precision is never lost to float rounding. */
export const DecimalSchema = z
    .string()
    .regex(/^\d+(\.\d+)?$/, "Must be a non-negative decimal written as a string, e.g. '70000' or '100.50'")
    .max(30);

export const ClientOrderIdSchema = z
    .string()
    .max(36)
    .regex(/^[a-zA-Z0-9\-_]+$/, "client_order_id may contain only letters, digits, '-' and '_'")
    .optional()
    .describe(
        "Idempotency key, max 36 chars. Re-sending the same value within 10 minutes returns the original order instead of creating a second one. Strongly recommended so a retry never double-fills."
    );

export const ConfirmHighValueSchema = z
    .boolean()
    .default(false)
    .describe(
        "Set true to acknowledge an order of ₩100,000,000 or more; such orders are rejected with `confirm-high-value-required` otherwise. Only set this after the user has confirmed the amount."
    );
