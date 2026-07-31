/**
 * OAuth 2.0 client-credentials token management.
 *
 * Toss keeps exactly one valid access token per client — re-issuing invalidates
 * the previous one — so the token is cached in memory and reused until shortly
 * before expiry. Concurrent callers share a single in-flight issue request.
 */

import { API_BASE_URL, REQUEST_TIMEOUT_MS, TOKEN_REFRESH_MARGIN_SEC } from "../constants.js";
import { TossApiError, TossConfigError, type TossErrorPayload } from "../errors.js";

interface OAuth2TokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
}

interface CachedToken {
    accessToken: string;
    /** Epoch milliseconds at which the token should no longer be used. */
    expiresAt: number;
}

export class TokenManager {
    private cached: CachedToken | undefined;
    private inFlight: Promise<string> | undefined;

    constructor(
        private readonly clientId: string | undefined,
        private readonly clientSecret: string | undefined,
        /** A pre-issued token, bypassing the client-credentials flow entirely. */
        private readonly staticToken: string | undefined
    ) {}

    /** True when the manager has enough configuration to produce a token. */
    isConfigured(): boolean {
        return Boolean(this.staticToken || (this.clientId && this.clientSecret));
    }

    /**
     * Returns a usable access token, issuing or refreshing one if needed.
     * @param forceRefresh discard the cached token first (used after a 401)
     */
    async getAccessToken(forceRefresh = false): Promise<string> {
        if (this.staticToken) return this.staticToken;

        if (!this.clientId || !this.clientSecret) {
            throw new TossConfigError(
                "Missing credentials. Set TOSSINVEST_CLIENT_ID and TOSSINVEST_CLIENT_SECRET (issue them in the Toss Securities WTS under 설정 > Open API), or set TOSSINVEST_ACCESS_TOKEN to a pre-issued token."
            );
        }

        if (forceRefresh) {
            this.cached = undefined;
        }

        const cached = this.cached;
        if (cached && cached.expiresAt > Date.now()) {
            return cached.accessToken;
        }

        // Collapse concurrent refreshes into one request — the AUTH rate limit
        // group allows only 5 req/s and re-issuing invalidates prior tokens.
        this.inFlight ??= this.issueToken().finally(() => {
            this.inFlight = undefined;
        });

        return this.inFlight;
    }

    private async issueToken(): Promise<string> {
        const body = new URLSearchParams({
            grant_type: "client_credentials",
            client_id: this.clientId as string,
            client_secret: this.clientSecret as string
        });

        const response = await fetch(`${API_BASE_URL}/oauth2/token`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Accept: "application/json"
            },
            body,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });

        const raw: unknown = await response.json().catch(() => undefined);

        if (!response.ok) {
            throw new TossApiError(response.status, toTokenErrorPayload(raw), "OAuth token issuance failed");
        }

        const token = raw as OAuth2TokenResponse | undefined;
        if (!token?.access_token) {
            throw new TossApiError(response.status, { code: "invalid-token-response" }, "Token endpoint returned no access_token");
        }

        const ttlSec = Math.max(token.expires_in - TOKEN_REFRESH_MARGIN_SEC, 30);
        this.cached = {
            accessToken: token.access_token,
            expiresAt: Date.now() + ttlSec * 1000
        };
        return token.access_token;
    }

    /** Drops the cached token so the next call re-issues. */
    invalidate(): void {
        this.cached = undefined;
    }
}

/** The token endpoint answers with the OAuth2 error shape, not the BFF envelope. */
function toTokenErrorPayload(raw: unknown): TossErrorPayload {
    if (raw && typeof raw === "object") {
        const record = raw as Record<string, unknown>;
        const envelope = record["error"];
        // Some gateway-level failures still use the BFF envelope.
        if (envelope && typeof envelope === "object") {
            const nested = envelope as Record<string, unknown>;
            return {
                code: typeof nested["code"] === "string" ? nested["code"] : undefined,
                message: typeof nested["message"] === "string" ? nested["message"] : undefined,
                requestId: typeof nested["requestId"] === "string" ? nested["requestId"] : undefined,
                data: nested["data"]
            };
        }
        return {
            code: typeof envelope === "string" ? envelope : undefined,
            message: typeof record["error_description"] === "string" ? record["error_description"] : undefined
        };
    }
    return {};
}

export const tokenManager = new TokenManager(
    process.env.TOSSINVEST_CLIENT_ID,
    process.env.TOSSINVEST_CLIENT_SECRET,
    process.env.TOSSINVEST_ACCESS_TOKEN
);
