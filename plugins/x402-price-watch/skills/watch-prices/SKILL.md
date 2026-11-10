---
name: watch-prices
description: Run the x402-price-watch HTTP service and poll crypto (CoinGecko) or flight (Amadeus) prices, carrying the returned cursor between polls to get deltas. Use when an agent must track price changes without server-side subscriptions and can pay per poll in USDC over x402.
---

# x402-price-watch

x402-price-watch is stateless. Each paid `GET /check` returns a snapshot, the delta against the cursor you sent, a trend read and a new cursor. The cursor is your memory: keep it and send it next time. Crypto is live via keyless CoinGecko. Flights come from Amadeus when configured and labelled fixtures otherwise.

Paying is irreversible. Before any paid call, show the user the route, price, network and payTo address from the 402 response, and wait for an explicit yes.

## Run the service

From a clone (Node 18+):

```bash
git clone https://github.com/nirholas/x402-price-watch
cd x402-price-watch && npm install
npm run dev        # tsx src/server.ts, listens on :4044 (PORT overrides)
```

Environment (see `.env.example`): `SIGNING_SECRET` (HMAC key for artifacts and cursors, set it in production; rotating it invalidates issued cursors), `COINGECKO_API_KEY` (optional, raises rate limits), `AMADEUS_CLIENT_ID`, `AMADEUS_CLIENT_SECRET`, `AMADEUS_BASE_URL` (sandbox `https://test.api.amadeus.com` by default). Payment settings: `PAY_TO_ADDRESS` (Base receive address), `SOLANA_PAY_TO_ADDRESS`, `NETWORK` (`base-sepolia` default, or `base`), `SOLANA_NETWORK`, `FACILITATOR_URL`, `PUBLIC_BASE_URL`. Set your own pay-to addresses to be paid yourself. `npm run build` then `npm start` runs the compiled server.

## Routes

| Route | Price | Params |
|---|---|---|
| `GET /check` | $0.002 | `market` required (`crypto` or `flight`). Crypto: `ids` (comma-separated CoinGecko ids, max 25), `vs` (default `usd`). Flight: `origin`, `destination` (IATA), `departureDate` (`YYYY-MM-DD`), optional `returnDate`, `adults`, `cabin` (`ECONOMY`, `PREMIUM_ECONOMY`, `BUSINESS`, `FIRST`). Both: optional `cursor` |
| `GET /watch-key` | free | same params as `/check`; shows the normalized `watchKey` before you spend |
| `GET /sources` | free | which price sources are reachable live |
| `POST /verify` | free | `{payload, signature}` returns `{valid}` |
| `GET /healthz`, `GET /skill.md` | free | status and capability sheet |

## Paying

An unpaid request to a paid route returns 402 with an `accepts` array listing both rails (USDC on Base or Solana). Sign the entry your wallet supports and retry with the base64 `X-PAYMENT` header. The settlement receipt is in the `X-PAYMENT-RESPONSE` header. The reference client is `examples/agent-client.ts` (`npm run client`), which uses `x402-fetch` with `PRIVATE_KEY` for a Base Sepolia wallet and `BASE_URL` (default `http://localhost:4044`).

Polling loop: first call without `cursor`; keep `check.payload.cursor`; pass it as `cursor` on the next call. A cursor is bound to its watch key, so changing any parameter gives `cursorStatus: "wrong_watch"` and a snapshot with no delta. A rejected cursor never fails the call. Other `cursorStatus` values: `none`, `applied`, `malformed`, `bad_signature`, `unsupported_version`.

## Example

```bash
curl -i "localhost:4044/watch-key?market=crypto&ids=bitcoin,ethereum"   # free
curl -i "localhost:4044/check?market=crypto&ids=bitcoin,ethereum"        # 402, pay, keep the cursor
curl -i "localhost:4044/check?market=crypto&ids=bitcoin,ethereum&cursor=<cursor>"
```
