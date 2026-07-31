/**
 * HTTP client for the Toss Securities Open API.
 *
 * Responsibilities kept here so no tool has to repeat them:
 *   - attach the bearer token and the `X-Tossinvest-Account` header
 *   - unwrap the `{ result: ... }` success envelope
 *   - turn the `{ error: {...} }` failure envelope into a TossApiError
 *   - retry 429 (honouring Retry-After) and 5xx with backoff + jitter
 *   - retry once on 401 after forcing a token refresh
 */

import { API_BASE_URL, MAX_ATTEMPTS, REQUEST_TIMEOUT_MS } from "../constants.js";
import { TossApiError, type TossErrorPayload } from "../errors.js";
import { tokenManager } from "./auth.js";

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
    method?: "GET" | "POST" | "DELETE";
    /** Query parameters; undefined/null entries are dropped. */
    query?: Record<string, QueryValue>;
    /** JSON request body. */
    body?: unknown;
    /** accountSeq for the `X-Tossinvest-Account` header on account-scoped endpoints. */
    accountSeq?: number;
}

/** Sleep helper used between retries. */
function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Backoff with full jitter: 1s, 2s, 4s ... capped at 8s. */
function backoffMs(attempt: number): number {
    const base = Math.min(1000 * 2 ** (attempt - 1), 8000);
    return base / 2 + Math.random() * (base / 2);
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(path, API_BASE_URL);
    for (const [key, value] of Object.entries(query ?? {})) {
        if (value === undefined || value === null) continue;
        // URLSearchParams percent-encodes `+` in ISO timestamps, as the API requires.
        url.searchParams.set(key, String(value));
    }
    return url.toString();
}

function toErrorPayload(raw: unknown): TossErrorPayload {
    if (raw && typeof raw === "object") {
        const envelope = (raw as Record<string, unknown>)["error"];
        if (envelope && typeof envelope === "object") {
            const error = envelope as Record<string, unknown>;
            return {
                requestId: typeof error["requestId"] === "string" ? error["requestId"] : undefined,
                code: typeof error["code"] === "string" ? error["code"] : undefined,
                message: typeof error["message"] === "string" ? error["message"] : undefined,
                data: error["data"]
            };
        }
    }
    return {};
}

/** Seconds to wait per the Retry-After header, or undefined when absent/unparseable. */
function retryAfterMs(response: Response): number | undefined {
    const header = response.headers.get("retry-after");
    if (!header) return undefined;
    const seconds = Number(header);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

/**
 * Performs one authenticated request and returns the unwrapped `result` payload.
 *
 * Retries are transparent to callers; a `TossApiError` surfaces only once the
 * request is definitively unrecoverable.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = "GET", query, body, accountSeq } = options;
    const url = buildUrl(path, query);

    // A rejected token buys exactly one forced refresh for the whole request.
    let tokenRefreshUsed = false;
    let forceRefresh = false;

    for (let attempt = 1; ; attempt++) {
        const accessToken = await tokenManager.getAccessToken(forceRefresh);
        forceRefresh = false;

        const headers: Record<string, string> = {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json"
        };
        if (accountSeq !== undefined) {
            headers["X-Tossinvest-Account"] = String(accountSeq);
        }
        if (body !== undefined) {
            headers["Content-Type"] = "application/json";
        }

        const response = await fetch(url, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });

        if (response.ok) {
            if (response.status === 204) return undefined as T;
            const raw: unknown = await response.json().catch(() => undefined);
            if (raw && typeof raw === "object" && "result" in (raw as Record<string, unknown>)) {
                return (raw as { result: T }).result;
            }
            return raw as T;
        }

        const raw: unknown = await response.json().catch(() => undefined);
        const payload = toErrorPayload(raw);

        const tokenRejected = response.status === 401 && payload.code !== "edge-blocked";
        if (tokenRejected && !tokenRefreshUsed) {
            tokenRefreshUsed = true;
            forceRefresh = true;
            tokenManager.invalidate();
            continue;
        }

        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < MAX_ATTEMPTS) {
            await delay(retryAfterMs(response) ?? backoffMs(attempt));
            continue;
        }

        throw new TossApiError(response.status, payload);
    }
}
