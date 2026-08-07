# x402-price-watch

> Pay-per-poll price watching — every check returns a fresh snapshot plus delta vs your cursor (flights via Amadeus, crypto via CoinGecko).

![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![x402](https://img.shields.io/badge/payments-x402%20%2F%20USDC-0052ff)
![rails](https://img.shields.io/badge/rails-Base%20%2B%20Solana-9945ff)
![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)

> **Pay in USDC on Base or Solana — your client picks the rail.** Every 402 challenge lists both.

One `GET /check` is one complete purchase: a fresh snapshot, the **delta against the cursor you sent**, a trend read, and a new cursor for next time. There is no watch to create and no subscription to cancel — the service is stateless, and the cursor is your memory.

Crypto is always live (CoinGecko is keyless). Flights are live when free Amadeus credentials are set, and deterministic, clearly labeled fixtures otherwise.

## Why x402 for this

Watching is bursty. You check a fare twice a day for a fortnight and then never again; you check a token every minute for an hour during a move. A subscription gets that wrong in both directions — you pay through the quiet weeks and hit a rate limit in the busy hour. Per-request payment matches the shape of the need exactly: $0.002 when you look, nothing when you don't, and no account to provision before an agent can start.

## Quickstart

```bash
git clone https://github.com/nirholas/x402-price-watch && cd x402-price-watch
npm install
cp .env.example .env        # pre-filled — runs with no edits
npm run dev                 # server on http://localhost:4044
```

Then run the full paid flow with a wallet holding [Base Sepolia USDC](https://faucet.circle.com):

```bash
PRIVATE_KEY=0x... npm run client   # two polls: first, then the same watch with the cursor
```

To receive the fees yourself, set `PAY_TO_ADDRESS` (Base) and `SOLANA_PAY_TO_ADDRESS` (Solana) in `.env` — the server logs a note while the suite defaults are in use.

## API

| Route | Price | What you get back |
|---|---|---|
| `GET /check` | $0.002 | Signed snapshot + delta vs your cursor + trend + a fresh cursor |
| `GET /watch-key` | free | The normalized watch key your parameters map to |
| `GET /sources` | free | Which price sources are live on this deployment |
| `POST /verify` | free | Signature check for any check artifact issued here |
| `GET /healthz` | free | Liveness + the rails this deployment accepts |

```bash
# First poll — no cursor
curl "http://localhost:4044/check?market=crypto&ids=bitcoin,ethereum"

# Next poll — pass the cursor you got back
curl "http://localhost:4044/check?market=crypto&ids=bitcoin,ethereum&cursor=eyJrIjoi…"

# Flights
curl "http://localhost:4044/check?market=flight&origin=JFK&destination=LAX&departureDate=2026-09-14"
```

## The cursor is the whole idea

A subscription price-watcher needs an account, a database of your watches, and a retention policy. This one needs none of that, because **the client carries the state**. Each response hands back an opaque, HMAC-signed cursor encoding the prices you just saw; send it next time and you get the delta.

```json
{
  "delta": {
    "hasCursor": true, "cursorStatus": "applied", "elapsedSeconds": 3600,
    "changes": [
      { "id": "bitcoin", "previousUsd": 64266, "currentUsd": 64305,
        "absUsd": 39, "pct": 0.0607, "direction": "up" }
    ],
    "summary": { "up": 2, "down": 0, "flat": 0, "new": 0, "biggestMoverId": "bitcoin" }
  },
  "trend": { "direction": "up", "basis": "cursor", "pct": 0.0422 },
  "cursor": "eyJrIjoiY3J5cHRvOmJpdGNvaW4…"
}
```

Two properties make this safe to hand out:

- **Signed.** A tampered cursor is rejected with `cursorStatus: "bad_signature"` — a client cannot invent a "previous price" that never happened.
- **Scoped.** A cursor belongs to one `watchKey` (the normalized market + parameters), so a bitcoin cursor can never be diffed against a JFK→LAX snapshot.

A rejected cursor never fails the call. You still get the snapshot you paid for, plus a note saying why the delta is missing.

## How x402 works — two rails, one flow

1. Client calls a paid route → server responds `402 Payment Required` with an `accepts` array holding **both** payment requirements: USDC on Base (EVM) and USDC on Solana (SVM), same price, same resource.
2. Client picks the rail its wallet supports and authorizes exactly that amount — an EIP-3009 transfer authorization on Base, or a fee-sponsored SPL `transferChecked` on Solana — then retries with the `X-PAYMENT` header.
3. The server reads `network` off the payload, selects the matching requirement, and verifies + settles through that rail's facilitator (x402.org for Base, PayAI for Solana by default — the reference facilitator does not settle Solana mainnet).
4. Server responds `200` with the artifact in-body and an `X-PAYMENT-RESPONSE` header carrying the settlement receipt (`rail`, `network`, `facilitator`, `transaction`, `payer`).

Solana buyers need no SOL: the facilitator's `feePayer` sponsors the network fee, so a USDC balance is enough. `x402-fetch` does steps 2–3 automatically — see [`examples/agent-client.ts`](examples/agent-client.ts) and [`examples/curl.md`](examples/curl.md).

## Real backend / API keys

| Market | Provider | Live when | Otherwise |
|---|---|---|---|
| crypto | [CoinGecko](https://www.coingecko.com/en/api) `/simple/price` | **always** — keyless | n/a |
| flight | [Amadeus Self-Service](https://developers.amadeus.com) `/v2/shopping/flight-offers` | `AMADEUS_CLIENT_ID` + `AMADEUS_CLIENT_SECRET` | deterministic drifting fixtures, `source: "fixture"`, `live: false` |

CoinGecko needs no key at all, so crypto watches are real out of the box; `COINGECKO_API_KEY` only raises rate limits. Amadeus is free and optional. Flight fixtures drift in ten-minute buckets so a polling client sees movement, and they are labeled in three places (`source`, `live`, `notes`) — you will never mistake one for a real quote. A live Amadeus call that fails degrades to fixtures with a note rather than failing the paid call.

Flight snapshots track `cheapest` and `cheapest_nonstop` as separate items, because they move independently and an agent usually cares about one of them specifically.

Payment envs: `PAY_TO_ADDRESS`, `SOLANA_PAY_TO_ADDRESS`, `NETWORK`/`FACILITATOR_URL` (EVM rail), `SOLANA_NETWORK`/`SOLANA_FACILITATOR_URL` (Solana rail). A rail whose address is missing or malformed is dropped from `accepts` with a startup warning — the other rail keeps working. `SIGNING_SECRET` signs both the artifacts **and the cursors**, so rotating it invalidates every cursor already issued.

## For AI agents

- **[skill.md](skill.md)** — agent-facing skill file: endpoints, prices, schemas, payment instructions.
- **`GET /.well-known/x402`** — machine-readable manifest, both rails per resource, indexable by [x402scan.com](https://x402scan.com), the x402 Bazaar, and [agentic.market](https://agentic.market).
- **MCP**: [`examples/mcp-tool.md`](examples/mcp-tool.md) exposes `price_check` as a Claude tool that pays per call and threads the cursor for you.

The polling loop is three lines: check, keep the cursor, check again with it.

## Docs

Full docs on GitHub Pages: **https://nirholas.github.io/x402-price-watch/** — [tutorial](https://nirholas.github.io/x402-price-watch/tutorial), [API reference](https://nirholas.github.io/x402-price-watch/api), [agents guide](https://nirholas.github.io/x402-price-watch/agents).

Part of the [x402 Suite](https://github.com/nirholas/x402-suite).

## Support

Questions, deployments, or a rail you want added: **nichxbt@gmail.com**

## License

[Apache-2.0](LICENSE)
