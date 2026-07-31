export const SERVER_NAME = "tossinvest-mcp-server";
export const SERVER_VERSION = "1.0.0";

/** Canonical Toss Securities Open API host. Overridable for testing only. */
export const API_BASE_URL = process.env.TOSSINVEST_API_BASE_URL ?? "https://openapi.tossinvest.com";

/** Maximum characters in a single tool response before truncation kicks in. */
export const CHARACTER_LIMIT = 25_000;

export const REQUEST_TIMEOUT_MS = 30_000;

/** Attempts for retryable failures (429 / 5xx). 1 = no retry. */
export const MAX_ATTEMPTS = 3;

/** Refresh the access token this many seconds before it actually expires. */
export const TOKEN_REFRESH_MARGIN_SEC = 60;

/**
 * Market indicator symbol catalog. The Market Indicators endpoints reject
 * anything outside this list with `400 unsupported-symbol`.
 */
export const MARKET_INDICATOR_SYMBOLS = [
    "KOSPI",
    "KOSDAQ",
    "KR_BOND_2Y",
    "KR_BOND_3Y",
    "KR_BOND_5Y",
    "KR_BOND_10Y",
    "KR_BOND_20Y",
    "KR_BOND_30Y"
] as const;

/** When true, order-placing / order-mutating tools are not registered at all. */
export const READ_ONLY_MODE = /^(1|true|yes)$/i.test(process.env.TOSSINVEST_READ_ONLY ?? "");
