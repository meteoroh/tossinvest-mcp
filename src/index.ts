#!/usr/bin/env node
/**
 * MCP server for the Toss Securities (토스증권) Open API.
 *
 * Transport is stdio by default; set TRANSPORT=http for a stateless streamable
 * HTTP endpoint at POST /mcp (see src/http.ts).
 *
 * Environment:
 *   TOSSINVEST_CLIENT_ID       OAuth2 client id      (required unless TOSSINVEST_ACCESS_TOKEN is set)
 *   TOSSINVEST_CLIENT_SECRET   OAuth2 client secret  (required unless TOSSINVEST_ACCESS_TOKEN is set)
 *   TOSSINVEST_ACCESS_TOKEN    Pre-issued token, bypassing the client-credentials flow
 *   TOSSINVEST_ACCOUNT_SEQ     Default accountSeq for account-scoped tools
 *   TOSSINVEST_READ_ONLY       'true' to omit all order-mutating tools
 *   TRANSPORT                  'stdio' (default) or 'http'
 *   PORT                       HTTP port when TRANSPORT=http (default 3000)
 *   HOST                       HTTP bind address    (default 0.0.0.0)
 *   MCP_AUTH_TOKEN             Bearer token clients must present (required for TRANSPORT=http)
 *   MCP_ALLOW_ANONYMOUS        'true' to run HTTP without authentication (not recommended)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { READ_ONLY_MODE, SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { runHttp } from "./http.js";
import { createServer } from "./server.js";
import { tokenManager } from "./services/auth.js";

function checkCredentials(): void {
    if (tokenManager.isConfigured()) return;
    console.error(
        `ERROR: no Toss Securities credentials found.\n` +
            `Set TOSSINVEST_CLIENT_ID and TOSSINVEST_CLIENT_SECRET (issue them in the Toss Securities WTS under 설정 > Open API),\n` +
            `or set TOSSINVEST_ACCESS_TOKEN to a pre-issued access token.`
    );
    process.exit(1);
}

async function runStdio(): Promise<void> {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio${READ_ONLY_MODE ? " (read-only mode)" : ""}`);
}

checkCredentials();

if ((process.env.TRANSPORT ?? "stdio") === "http") {
    runHttp();
} else {
    runStdio().catch((error: unknown) => {
        console.error("Fatal server error:", error);
        process.exit(1);
    });
}
