# tossinvest-mcp-server

An MCP server for the [Toss Securities (토스증권) Open API](https://developers.tossinvest.com/) — Korean (KRX) and US market data, portfolio holdings, order management and price-triggered conditional orders.

28 tools cover every documented endpoint of the Open API (v1.2.5).

## Requirements

- Node.js 18+
- Toss Securities Open API credentials: log into the Toss Securities WTS, go to **설정 › Open API**, issue a `client_id` / `client_secret`, and register the calling IP under **허용 IP 관리**. Calls from an unregistered IP are rejected with `403 edge-blocked`.

## Install

```bash
npm install && npm run build
```

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `TOSSINVEST_CLIENT_ID` | yes¹ | OAuth 2.0 client id |
| `TOSSINVEST_CLIENT_SECRET` | yes¹ | OAuth 2.0 client secret |
| `TOSSINVEST_ACCESS_TOKEN` | no | Pre-issued access token; bypasses the client-credentials flow |
| `TOSSINVEST_ACCOUNT_SEQ` | no | Default `accountSeq` for account-scoped tools |
| `TOSSINVEST_READ_ONLY` | no | `true` omits every order-mutating tool (see [Safety](#safety)) |
| `TRANSPORT` | no | `stdio` (default) or `http` |
| `PORT` | no | HTTP port when `TRANSPORT=http` (default `3000`) |

¹ Required unless `TOSSINVEST_ACCESS_TOKEN` is set.

Tokens are issued, cached and refreshed automatically. Toss keeps exactly one valid token per client, so the server collapses concurrent refreshes into a single request and retries once on a rejected token.

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "tossinvest": {
      "command": "node",
      "args": ["/absolute/path/to/tossinvest-mcp/dist/index.js"],
      "env": {
        "TOSSINVEST_CLIENT_ID": "c_...",
        "TOSSINVEST_CLIENT_SECRET": "...",
        "TOSSINVEST_READ_ONLY": "true"
      }
    }
  }
}
```

### Remote / self-hosted (streamable HTTP)

Serves stateless JSON-RPC at `POST /mcp`, plus an unauthenticated `GET /health` for container probes.

Bearer authentication is **mandatory** in this mode — the process refuses to start without `MCP_AUTH_TOKEN`, because the endpoint exposes credentials that can read your account and place orders. Set `MCP_ALLOW_ANONYMOUS=true` to override, only when the port is genuinely unreachable from outside a trusted network.

```bash
MCP_AUTH_TOKEN=$(openssl rand -hex 32) TRANSPORT=http npm start
```

| Variable | Purpose |
| --- | --- |
| `MCP_AUTH_TOKEN` | Bearer token clients must present. Minimum 16 chars; compared in constant time |
| `MCP_ALLOW_ANONYMOUS` | `true` disables auth (prints a warning) |
| `HOST` | Bind address, default `0.0.0.0` |
| `PORT` | Default `3000` |

#### Docker / NAS

```bash
cp .env.example .env   # fill in credentials + MCP_AUTH_TOKEN, then:
docker compose up -d --build
```

CI publishes a multi-arch image (`linux/amd64` + `linux/arm64`) to GHCR on every push to `main`. To use it instead of building on the NAS, drop the `build:` line from `docker-compose.yml` and set:

```yaml
image: ghcr.io/meteoroh/tossinvest-mcp:latest
```

The bundled `docker-compose.yml` defaults to the conservative setup: read-only mode on, port published to `127.0.0.1` only, container runs unprivileged with a read-only root filesystem and all capabilities dropped. Reach it over a VPN (Tailscale/WireGuard), a Cloudflare Tunnel, or a TLS-terminating reverse proxy rather than publishing it to the internet.

Note that the Toss API allow-lists by IP, so the NAS's public IP must be registered under **허용 IP 관리** — a different IP than your laptop's. Fronting the server with a tunnel or proxy does not change this: outbound calls to Toss still leave from the NAS.

#### Nginx Proxy Manager

`docker-compose.npm.yml` overlays the networking needed to sit behind an existing NPM instance.

```bash
docker compose -f docker-compose.yml -f docker-compose.npm.yml up -d --build
```

The base file publishes `127.0.0.1:3000`, which NPM **cannot** reach — inside NPM's container, `127.0.0.1` is NPM itself. The overlay drops the host port and joins NPM's network instead, so NPM reaches the server by container name. Find that network with:

```bash
docker inspect <npm-container> -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}'
```

and set it in `.env` as `NPM_NETWORK` (commonly `npm_default`).

Then in **Proxy Hosts › Add Proxy Host**:

| Field | Value |
| --- | --- |
| Domain Names | `mcp.yourdomain.com` |
| Scheme | `http` |
| Forward Hostname | `tossinvest-mcp` |
| Forward Port | `3000` |
| Block Common Exploits | on |
| SSL | Let's Encrypt cert, **Force SSL** on |

Two things to get right:

- **Do not attach an Access List.** NPM's Access Lists use HTTP Basic Auth, which occupies the same `Authorization` header this server reads its bearer token from. NPM overwrites the header and every request fails with 401. Use `MCP_AUTH_TOKEN` as the gate instead — or, if you want a second layer, add it as a custom header check in the Advanced tab rather than an Access List.
- **Cloudflare SSL/TLS mode must be Full (strict)** if the DNS record is proxied (orange cloud). `Flexible` would leave the Cloudflare→NAS hop unencrypted, which is where your bearer token travels. For the Let's Encrypt cert, use NPM's **DNS challenge with a Cloudflare API token** — HTTP-01 validation is unreliable through the Cloudflare proxy.

Unlike a tunnel, this needs ports 80 and 443 forwarded to the NAS.

#### Cloudflare Tunnel (alternative)

`docker-compose.cloudflared.yml` overlays a `cloudflared` sidecar, giving you a hostname on your own domain with no inbound port, no port forwarding and no certificate to manage. It also works behind CGNAT.

1. Zero Trust dashboard → **Networks › Tunnels › Create a tunnel** (Cloudflared). Copy the token into `.env` as `TUNNEL_TOKEN`.
2. Add a **Public Hostname** on the tunnel: subdomain `mcp`, your domain, service `HTTP` → `tossinvest-mcp:3000`.
3. Start both containers:

```bash
docker compose -f docker-compose.yml -f docker-compose.cloudflared.yml up -d --build
```

The overlay clears the host port mapping — cloudflared reaches the server over the internal compose network, so nothing is exposed on the NAS at all.

**Add Cloudflare Access in front.** Zero Trust → **Access › Applications › Self-hosted**, covering `mcp.yourdomain.com`, with a **service token** policy. Requests without a valid service token are rejected at Cloudflare's edge and never reach your NAS. Clients then send three headers:

```json
{
  "mcpServers": {
    "tossinvest": {
      "url": "https://mcp.yourdomain.com/mcp",
      "headers": {
        "CF-Access-Client-Id": "....access",
        "CF-Access-Client-Secret": "...",
        "Authorization": "Bearer YOUR_MCP_AUTH_TOKEN"
      }
    }
  }
}
```

`MCP_AUTH_TOKEN` stays in place as the origin-level gate, so a Cloudflare misconfiguration alone does not expose the server.

If you enable Access, exclude `/health` from the policy (or drop your container health check) — otherwise the probe gets a login redirect instead of a 200.

#### Connecting a client

```bash
claude mcp add --transport http tossinvest https://your-host/mcp --header "Authorization: Bearer $MCP_AUTH_TOKEN"
```

Cursor and other `mcp.json`-based clients take the equivalent:

```json
{
  "mcpServers": {
    "tossinvest": {
      "url": "https://your-host/mcp",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}
```

For clients that only speak stdio, bridge with `npx mcp-remote https://your-host/mcp --header "Authorization: Bearer YOUR_TOKEN"`.

## Tools

### Market data — no account required

| Tool | Purpose |
| --- | --- |
| `tossinvest_get_prices` | Last traded price, up to 200 symbols per call |
| `tossinvest_get_orderbook` | Bid/ask ladder for one symbol |
| `tossinvest_get_trades` | Today's most recent executions |
| `tossinvest_get_price_limits` | Daily upper/lower price band |
| `tossinvest_get_candles` | OHLCV history, 1-minute or daily, max 200 bars |
| `tossinvest_get_stocks` | Symbol master data: names, market, type, status, shares outstanding |
| `tossinvest_get_stock_warnings` | Active trading warnings and VI flags |
| `tossinvest_get_exchange_rate` | KRW ↔ USD rate |
| `tossinvest_get_market_calendar` | KR or US session hours for 3 business days |
| `tossinvest_get_rankings` | Top-100 by traded value, volume or price change |
| `tossinvest_get_market_indicator_prices` | KOSPI/KOSDAQ levels, Korean treasury yields |
| `tossinvest_get_market_indicator_candles` | Index / bond-yield OHLCV history |
| `tossinvest_get_investor_trading` | KRX buy/sell value by investor type |

### Account and portfolio

| Tool | Purpose |
| --- | --- |
| `tossinvest_list_accounts` | Accounts and their `accountSeq` |
| `tossinvest_get_holdings` | Positions with valuation and P/L |
| `tossinvest_get_buying_power` | Cash available to buy with |
| `tossinvest_get_sellable_quantity` | Shares available to sell |
| `tossinvest_get_commissions` | Per-market commission rates |

### Orders

| Tool | Purpose | Mutating |
| --- | --- | --- |
| `tossinvest_list_orders` | Working or finished orders | |
| `tossinvest_get_order` | One order with its fill detail | |
| `tossinvest_create_order` | Place a buy or sell order | ✅ |
| `tossinvest_modify_order` | Change price / quantity | ✅ |
| `tossinvest_cancel_order` | Cancel a working order | ✅ |

### Conditional orders

| Tool | Purpose | Mutating |
| --- | --- | --- |
| `tossinvest_list_conditional_orders` | Active or finished conditional orders | |
| `tossinvest_get_conditional_order` | One conditional order in detail | |
| `tossinvest_create_conditional_order` | Register a SINGLE / OCO / OTO trigger | ✅ |
| `tossinvest_modify_conditional_order` | Replace a conditional order | ✅ |
| `tossinvest_cancel_conditional_order` | Stop watching | ✅ |

## Safety

The five mutating tools place, change and cancel **real orders with real money**.

- Set `TOSSINVEST_READ_ONLY=true` to drop them entirely — the server then exposes 22 read-only tools and cannot trade at all. This is the recommended default for research and analysis.
- They are annotated `readOnlyHint: false, destructiveHint: true`, so MCP clients that gate destructive tools will prompt before running them.
- `tossinvest_create_order` and `tossinvest_create_conditional_order` accept `client_order_id` as an idempotency key. Pass one: a retried request then returns the original order instead of filling twice.
- A successful create means the order was **accepted**, not filled. Read the outcome with `tossinvest_get_order`.

## Conventions

- **Symbols** — KRX uses 6 digits (`005930`), US uses tickers (`AAPL`). There is no name-to-symbol search endpoint.
- **Numbers** — prices, quantities and amounts are decimal **strings**, so precision survives round-tripping. Don't reformat them before sending them back.
- **Currencies** — KRW and USD amounts are always reported separately and never summed. Convert with `tossinvest_get_exchange_rate` when one figure is wanted.
- **Time** — all timestamps are KST (+09:00), including US session times.
- **Output** — every tool takes `response_format`: `markdown` (default, compact) or `json` (complete payload). Structured content is returned either way. Oversized list responses are shortened with an explicit `truncation_message`.

## Rate limits

Limits are per client × API group and low — the account group allows **1 request per second**. The client retries `429` and `5xx` automatically, honouring `Retry-After` with exponential backoff and jitter (3 attempts). Batch symbols instead of looping; one call with 200 symbols beats 200 calls.

## Errors

Failures come back as readable text with a recovery step rather than a stack trace:

```
Error 422 (insufficient-buying-power): 주문 가능 금액이 부족합니다.
Next step: Not enough cash. Check tossinvest_get_buying_power for the available amount.
Request id: 01HXYZABCDEFG123456789 (include this when contacting Toss support)
```

## Development

```bash
npm run dev        # watch mode
npm run typecheck  # strict type check
npm test           # build + output schema validation + stdio protocol smoke test
```

`npm test` makes one deliberately unauthenticated API call to confirm the error path renders correctly; it never places orders.

## License

MIT. Not affiliated with or endorsed by Toss Securities. Using the trading tools is at your own risk.
