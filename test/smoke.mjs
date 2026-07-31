/**
 * Smoke test: spawn the built server over stdio, initialize, list tools,
 * and verify schemas/annotations. Uses a dummy token — no API calls are made.
 */
import { spawn } from "node:child_process";

const env = { ...process.env, TOSSINVEST_ACCESS_TOKEN: "dummy-token" };
if (process.argv.includes("--read-only")) env.TOSSINVEST_READ_ONLY = "true";

const child = spawn("node", ["dist/index.js"], { env, stdio: ["pipe", "pipe", "pipe"] });

let buffer = "";
const pending = new Map();

child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        const resolve = pending.get(message.id);
        if (resolve) {
            pending.delete(message.id);
            resolve(message);
        }
    }
});
child.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

let nextId = 1;
function send(method, params) {
    const id = nextId++;
    return new Promise((resolve) => {
        pending.set(id, resolve);
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
}

const init = await send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "1.0.0" }
});
console.log("server:", init.result.serverInfo.name, init.result.serverInfo.version);
console.log("instructions present:", Boolean(init.result.instructions));

child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

const list = await send("tools/list", {});
const tools = list.result.tools;
console.log(`\ntools: ${tools.length}\n`);

let problems = 0;
for (const tool of tools) {
    const issues = [];
    if (!tool.description || tool.description.length < 100) issues.push("thin description");
    if (!tool.inputSchema) issues.push("no inputSchema");
    if (!tool.outputSchema) issues.push("no outputSchema");
    if (!tool.annotations || tool.annotations.readOnlyHint === undefined) issues.push("no annotations");
    if (!tool.title) issues.push("no title");
    const flag = tool.annotations?.readOnlyHint ? "read " : "WRITE";
    console.log(
        `${flag} ${tool.name.padEnd(45)} in:${Object.keys(tool.inputSchema.properties ?? {}).length} out:${Object.keys(tool.outputSchema?.properties ?? {}).length} desc:${tool.description.length}` +
            (issues.length ? `  ⚠ ${issues.join(", ")}` : "")
    );
    if (issues.length) problems++;
}

// Exercise the error path: a bogus token must yield a readable message, not a crash.
const call = await send("tools/call", { name: "tossinvest_get_prices", arguments: { symbols: "005930" } });
console.log("\nerror-path isError:", call.result?.isError);
console.log("error-path text:\n" + (call.result?.content?.[0]?.text ?? JSON.stringify(call)));

// Client-side validation must reject a bad symbol before any network call.
const bad = await send("tools/call", { name: "tossinvest_get_prices", arguments: { symbols: "005930 AAPL!" } });
console.log("\nvalidation isError:", bad.result?.isError ?? Boolean(bad.error));
console.log("validation text:", (bad.result?.content?.[0]?.text ?? bad.error?.message ?? "").slice(0, 200));

console.log(`\nproblem tools: ${problems}`);
child.kill();
process.exit(problems === 0 ? 0 : 1);
