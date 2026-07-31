import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { READ_ONLY_MODE, SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { registerAccountTools } from "./tools/account.js";
import { registerConditionalOrderTools } from "./tools/conditional-orders.js";
import { registerMarketDataTools } from "./tools/market-data.js";
import { registerMarketIndicatorTools } from "./tools/market-indicators.js";
import { registerMarketInfoTools } from "./tools/market-info.js";
import { registerOrderTools } from "./tools/orders.js";
import { registerRankingTools } from "./tools/ranking.js";
import { registerStockInfoTools } from "./tools/stock-info.js";

const INSTRUCTIONS = `Tools for the Toss Securities (토스증권) Open API: Korean (KRX) and US market data, plus account holdings and order management.

Symbols: KRX uses 6 digits ('005930' = Samsung Electronics); US uses tickers ('AAPL'). There is no name-to-symbol search — resolve symbols from tossinvest_get_rankings, tossinvest_get_holdings, or knowledge of the ticker, then confirm with tossinvest_get_stocks.

Numbers: prices, quantities and amounts are decimal STRINGS, to preserve precision. Do not reformat them before sending them back to the API. KRW and USD figures are reported separately and never summed — convert with tossinvest_get_exchange_rate when a single figure is needed.

Accounts: holdings and order tools need an accountSeq. It resolves automatically when the credentials hold exactly one account; otherwise pass account_seq, from tossinvest_list_accounts.

Rate limits are per API group and low (the account group allows 1 request/second). Batch symbols instead of looping, and prefer one call with many symbols over many calls.

${
    READ_ONLY_MODE
        ? "This server is running in READ-ONLY mode: order placement, modification and cancellation tools are not available."
        : "Order tools place, modify and cancel REAL orders with REAL money. Confirm symbol, side, quantity and price with the user before calling them, and pass client_order_id on creation so a retry cannot double-fill. A successful create means accepted, not filled — read the fill with tossinvest_get_order."
}`;

export function createServer(): McpServer {
    const server = new McpServer(
        { name: SERVER_NAME, version: SERVER_VERSION },
        { instructions: INSTRUCTIONS, capabilities: { tools: {} } }
    );

    registerMarketDataTools(server);
    registerStockInfoTools(server);
    registerMarketInfoTools(server);
    registerRankingTools(server);
    registerMarketIndicatorTools(server);
    registerAccountTools(server);
    registerOrderTools(server);
    registerConditionalOrderTools(server);

    return server;
}
