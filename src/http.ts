/**
 * Streamable HTTP transport for remote/self-hosted deployments.
 *
 * Unlike stdio — where the OS process boundary is the security boundary — an
 * HTTP endpoint is reachable by anything that can route to it, while holding
 * credentials that can trade. So bearer authentication is mandatory here unless
 * it is explicitly waived.
 */

import { timingSafeEqual } from "node:crypto";
import { type IncomingMessage, type ServerResponse, createServer as createHttpServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { READ_ONLY_MODE, SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { createServer } from "./server.js";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;
const ALLOW_ANONYMOUS = /^(1|true|yes)$/i.test(process.env.MCP_ALLOW_ANONYMOUS ?? "");

function sendJson(res: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(payload));
}

/** Length-safe constant-time comparison; never short-circuits on length. */
function secretsMatch(provided: string, expected: string): boolean {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) {
        // Still burn a comparison so timing does not leak the expected length.
        timingSafeEqual(b, b);
        return false;
    }
    return timingSafeEqual(a, b);
}

function isAuthorized(req: IncomingMessage): boolean {
    if (!AUTH_TOKEN) return ALLOW_ANONYMOUS;
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return false;
    return secretsMatch(header.slice("Bearer ".length).trim(), AUTH_TOKEN);
}

/** Reads and JSON-parses a request body, rejecting anything oversized. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = chunk as Buffer;
        size += buffer.length;
        if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
        chunks.push(buffer);
    }
    if (size === 0) return undefined;
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Refuses to start unauthenticated unless the operator opted in explicitly.
 * Exits rather than degrading quietly — a silently open trading endpoint is the
 * one failure mode worth being loud about.
 */
function checkTransportSecurity(): void {
    if (AUTH_TOKEN) {
        if (AUTH_TOKEN.length < 16) {
            console.error("ERROR: MCP_AUTH_TOKEN is too short. Use at least 16 characters (e.g. `openssl rand -hex 32`).");
            process.exit(1);
        }
        return;
    }
    if (ALLOW_ANONYMOUS) {
        console.error(
            "WARNING: running with MCP_ALLOW_ANONYMOUS=true. Anyone who can reach this port can use your Toss Securities credentials" +
                (READ_ONLY_MODE ? " to read your account." : " TO PLACE ORDERS.")
        );
        return;
    }
    console.error(
        "ERROR: TRANSPORT=http requires MCP_AUTH_TOKEN.\n" +
            "This endpoint exposes credentials that can read your account and place orders.\n" +
            "Generate a token with `openssl rand -hex 32` and set MCP_AUTH_TOKEN,\n" +
            "or set MCP_ALLOW_ANONYMOUS=true if the port is genuinely unreachable from outside a trusted network."
    );
    process.exit(1);
}

export function runHttp(): void {
    checkTransportSecurity();

    const httpServer = createHttpServer((req, res) => {
        void (async () => {
            const path = (req.url ?? "").split("?")[0];

            // Unauthenticated liveness probe for NAS / container health checks.
            // Deliberately reveals nothing beyond up-ness and mode.
            if (req.method === "GET" && path === "/health") {
                sendJson(res, 200, { status: "ok", server: SERVER_NAME, version: SERVER_VERSION, readOnly: READ_ONLY_MODE });
                return;
            }

            if (!isAuthorized(req)) {
                sendJson(res, 401, { error: "Unauthorized. Send `Authorization: Bearer <MCP_AUTH_TOKEN>`." }, { "WWW-Authenticate": "Bearer" });
                return;
            }

            if (req.method !== "POST" || path !== "/mcp") {
                sendJson(res, 404, { error: "Not found. POST JSON-RPC requests to /mcp." });
                return;
            }

            // A fresh stateless server + transport per request keeps request ids from colliding.
            const server = createServer();
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
                enableJsonResponse: true
            });
            res.on("close", () => {
                void transport.close();
                void server.close();
            });

            try {
                const body = await readJsonBody(req);
                await server.connect(transport);
                await transport.handleRequest(req, res, body);
            } catch (error) {
                if (!res.headersSent) {
                    sendJson(res, 400, { error: error instanceof Error ? error.message : "Bad request" });
                }
            }
        })();
    });

    const port = Number.parseInt(process.env.PORT ?? "3000", 10);
    // Defaults to all interfaces because the usual deployment is a container,
    // where the port is only as public as the port mapping makes it.
    const host = process.env.HOST ?? "0.0.0.0";

    httpServer.listen(port, host, () => {
        const mode = [READ_ONLY_MODE ? "read-only" : "TRADING ENABLED", AUTH_TOKEN ? "auth required" : "ANONYMOUS"].join(", ");
        console.error(`${SERVER_NAME} v${SERVER_VERSION} listening on http://${host}:${port}/mcp (${mode})`);
    });

    const shutdown = (signal: string): void => {
        console.error(`Received ${signal}, shutting down.`);
        httpServer.close(() => process.exit(0));
        // Don't let a hung connection block container restarts.
        setTimeout(() => process.exit(0), 5000).unref();
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
}
