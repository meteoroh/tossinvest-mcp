/**
 * Error types and agent-facing error rendering.
 *
 * Every tool funnels failures through `formatToolError` so that the model gets a
 * consistent, actionable message instead of a raw stack trace.
 */

import { REQUEST_TIMEOUT_MS } from "./constants.js";

export interface TossErrorPayload {
    requestId?: string;
    code?: string;
    message?: string;
    data?: unknown;
}

export class TossApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly requestId: string | undefined;
    readonly data: unknown;

    constructor(status: number, payload: TossErrorPayload, fallbackMessage?: string) {
        super(payload.message ?? fallbackMessage ?? `Toss API request failed with status ${status}`);
        this.name = "TossApiError";
        this.status = status;
        this.code = payload.code ?? "unknown-error";
        this.requestId = payload.requestId;
        this.data = payload.data;
    }
}

/** Raised for problems we can detect without calling the API (missing config, bad combos). */
export class TossConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TossConfigError";
    }
}

/**
 * Guidance keyed by the `code` field of the Toss error envelope. These are the
 * "what should the agent do next" hints — the API already supplies a human
 * message, so these only add the recovery step.
 */
const ERROR_CODE_HINTS: Record<string, string> = {
    "invalid-token": "The access token was rejected. It is refreshed automatically; if this repeats, verify TOSSINVEST_CLIENT_ID / TOSSINVEST_CLIENT_SECRET.",
    "expired-token": "The access token expired and the automatic refresh did not take effect. Retry the call once.",
    "edge-blocked": "The request was blocked at the edge. Most often the calling IP is not on the allow-list — register it under 설정 > Open API > 허용 IP 관리 in the Toss Securities WTS.",
    "login-user-not-found": "No login user maps to this token. Re-issue credentials in the Toss Securities WTS.",
    forbidden: "The credentials lack permission for this endpoint.",
    "account-header-required": "This endpoint is account-scoped. Pass `account_seq`, or set TOSSINVEST_ACCOUNT_SEQ. Use tossinvest_list_accounts to find the value.",
    "account-not-found": "The given accountSeq does not exist. Call tossinvest_list_accounts and use an `accountSeq` from the response.",
    "stock-not-found": "No such symbol. KRX symbols are 6 digits (e.g. 005930); US symbols are tickers (e.g. AAPL).",
    "order-not-found": "No order with that orderId. Use tossinvest_list_orders to get valid ids.",
    "conditional-order-not-found": "No conditional order with that id. Note that modifying a conditional order issues a NEW id and invalidates the old one — use the id from the most recent modify response.",
    "exchange-rate-not-found": "No exchange rate for that instant. Omit `date_time` to get the current rate.",
    "unsupported-symbol": "Market Indicators only accept the 8 catalog symbols (KOSPI, KOSDAQ, KR_BOND_2Y/3Y/5Y/10Y/20Y/30Y). Investor trading additionally accepts only KOSPI and KOSDAQ. For individual stocks use tossinvest_get_prices / tossinvest_get_candles.",
    "unsupported-ranking-duration": "TOP_GAINERS and TOP_LOSERS do not support duration='realtime'. Use '1d' or longer.",
    "confirm-high-value-required": "Orders of ₩100,000,000 or more require confirm_high_value_order=true. Confirm the amount with the user before retrying.",
    "insufficient-buying-power": "Not enough cash. Check tossinvest_get_buying_power for the available amount.",
    "insufficient-sellable-quantity": "Not enough sellable shares. Check tossinvest_get_sellable_quantity.",
    "order-hours-closed": "The market is not accepting orders right now. Check tossinvest_get_market_calendar for session times.",
    "amount-order-outside-regular-hours": "Amount-based orders (order_amount) are accepted only during US regular market hours.",
    "price-out-of-range": "The price is outside the daily limit. Check tossinvest_get_price_limits.",
    "invalid-tick-size": "The KR price does not match the tick size for that price band. The correct tick size is in the `data` field below.",
    "opposite-pending-order-exists": "There is an open order on the opposite side for this symbol. Cancel it first (tossinvest_list_orders with status='OPEN').",
    "stock-restricted": "This symbol is currently restricted from trading. See tossinvest_get_stock_warnings.",
    "already-filled": "The order was already filled and can no longer be modified or canceled.",
    "already-canceled": "The order was already canceled.",
    "already-modified": "The order was already modified. Fetch the current order first with tossinvest_list_orders.",
    "already-rejected": "The order was already rejected.",
    "already-processing": "Another modify/cancel for this order is still in flight. Wait and re-check tossinvest_get_order.",
    "request-in-progress": "An order with the same client_order_id is still being processed. Wait, then check the result rather than re-sending.",
    "idempotency-key-conflict": "The same client_order_id was reused with different order contents. Use a fresh client_order_id.",
    "duplicate-conditional-order": "This symbol already has a group conditional order. OCO/OTO are limited to one per symbol (SINGLE is unlimited).",
    "condition-already-met": "The trigger price has already been reached. Choose a different trigger price.",
    "prerequisite-required": "Terms of service or risk disclosures have not been accepted for this product. The user must complete them in the Toss Securities app.",
    "account-restricted": "The account type does not permit this order (e.g. RIA / pension accounts).",
    "market-not-supported-for-stock": "This symbol cannot be traded on the requested market.",
    "investor-exchange-not-integrated": "The account's exchange routing is not set to integrated (SOR). Change it in the Toss Securities app.",
    "order-limit-exceeded": "The configured order limit was exceeded.",
    "modify-restricted": "This order cannot be modified. Cancel it and place a new one instead.",
    "cancel-restricted": "This order cannot be canceled.",
    "order-type-not-allowed": "That order type is not available in the current session.",
    "unsupported-content-type": "Request body content type was rejected — this is a bug in the MCP server, please report it.",
    "rate-limit-exceeded": "Rate limit exceeded even after automatic retries. Space out calls; the ACCOUNT group allows only 1 request/second.",
    "edge-rate-limit-exceeded": "Rate limit exceeded even after automatic retries. Space out calls; the ACCOUNT group allows only 1 request/second.",
    maintenance: "The Toss Securities API is under maintenance. Retry later.",
    "internal-error": "Transient server error on the Toss side. Retry in a few seconds."
};

/** Fallback guidance by HTTP status, used when the error code is unrecognized. */
function hintForStatus(status: number): string {
    if (status === 401) return "Authentication failed. Check TOSSINVEST_CLIENT_ID / TOSSINVEST_CLIENT_SECRET.";
    if (status === 403) return "Access denied. The calling IP may not be on the Open API allow-list.";
    if (status === 404) return "The requested resource does not exist. Double-check identifiers.";
    if (status === 409) return "Conflicting request state. Re-read the current state before retrying.";
    if (status === 422) return "The request was well-formed but cannot be processed in the current state.";
    if (status === 429) return "Rate limited. Wait before issuing further calls.";
    if (status >= 500) return "Toss Securities server error. Retry in a few seconds.";
    return "Check the parameters against the tool description.";
}

/** Renders any thrown value into the text an agent will see. */
export function formatToolError(error: unknown): string {
    if (error instanceof TossApiError) {
        const lines = [`Error ${error.status} (${error.code}): ${error.message}`];
        const hint = ERROR_CODE_HINTS[error.code] ?? hintForStatus(error.status);
        lines.push(`Next step: ${hint}`);
        if (error.data !== undefined && error.data !== null) {
            lines.push(`Details: ${JSON.stringify(error.data)}`);
        }
        if (error.requestId) {
            lines.push(`Request id: ${error.requestId} (include this when contacting Toss support)`);
        }
        return lines.join("\n");
    }

    if (error instanceof TossConfigError) {
        return `Configuration error: ${error.message}`;
    }

    if (error instanceof Error) {
        if (error.name === "TimeoutError" || error.name === "AbortError") {
            return `Error: request to the Toss Securities API timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s. Retry, or reduce the requested count.`;
        }
        return `Error: ${error.message}`;
    }

    return `Error: ${String(error)}`;
}
