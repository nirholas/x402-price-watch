# Tutorial — from clone to a polling loop

This walkthrough takes you from `git clone` to a two-poll loop where the second call tells you what moved since the first.

Every paid route here accepts **USDC on Base or USDC on Solana** — the 402 challenge lists both and the client picks. The walkthrough uses the Base Sepolia testnet rail because it is the easiest to fund; step 7 covers the Solana rail and mainnet.

## 1. Install

```bash
git clone https://github.com/nirholas/x402-price-watch
cd x402-price-watch
npm install
```

Requires Node 18+.

## 2. Configure

```bash
cp .env.example .env
```

`.env.example` ships pre-filled with the x402 Suite's public receive addresses, so **the server runs with no edits**. To receive the money yourself, replace both:

```
# EVM (Base / Base Sepolia) USDC receive address
PAY_TO_ADDRESS=0xYourReceivingWallet
# Solana USDC receive address
SOLANA_PAY_TO_ADDRESS=YourBase58SolanaWallet
```

The server logs a note at startup while the suite defaults are still in use.

Crypto needs **no key at all** — CoinGecko's `/simple/price` is public, so `market=crypto` is live from the first minute. Flights are the optional part:

| Var | Get it at | Unlocks |
|---|---|---|
| `AMADEUS_CLIENT_ID` + `AMADEUS_CLIENT_SECRET` | [developers.amadeus.com](https://developers.amadeus.com) (free) | live flight fares |

One more variable matters more here than in most services: `SIGNING_SECRET` signs the **cursors** as well as the artifacts. Rotate it and every cursor you have issued stops validating, which clients see as `cursorStatus: "bad_signature"`.

## 3. Run the server

```bash
npm run dev
```

The startup banner lists both payment rails and which price sources are live:

```
  Payment rails (client picks one):
    evm     base-sepolia   USDC → 0x40252CFDF8B20Ed757D61ff157719F33Ec332402
            facilitator: https://x402.org/facilitator
    solana  solana         USDC → WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW
            facilitator: https://facilitator.payai.network
  Price sources:
    coingecko (crypto)  LIVE — keyless
    amadeus   (flights) fixture — set AMADEUS_CLIENT_ID/SECRET
```

Note the two facilitators. The reference x402.org facilitator does not settle Solana mainnet, so the Solana rail defaults to PayAI's public facilitator — no key needed for either.

## 4. Your first 402

```bash
curl -si "http://localhost:4044/check?market=crypto&ids=bitcoin,ethereum"
```

You get `HTTP/1.1 402 Payment Required` and a JSON body whose `accepts[]` array holds **two** x402 `PaymentRequirements` — one per rail, same price:

```bash
curl -s "http://localhost:4044/check?market=crypto&ids=bitcoin,ethereum" \
  | jq '.accepts[] | {network, payTo, asset, maxAmountRequired}'
```

```json
{ "network": "base-sepolia", "payTo": "0x4025…2402", "asset": "0x036C…CF7e", "maxAmountRequired": "2000" }
{ "network": "solana",       "payTo": "Wwwu…T3WwW", "asset": "EPjF…TDt1v", "maxAmountRequired": "2000" }
```

`maxAmountRequired` is USDC base units (6 decimals), so `"2000"` = $0.002. Nothing was charged; this is the price quote.

Before paying, you can also ask what watch your parameters map to — free:

```bash
curl -s "http://localhost:4044/watch-key?market=crypto&ids=bitcoin,ethereum" | jq
# { "watchKey": "crypto:bitcoin,ethereum:usd", "watchId": "watch_…" }
```

## 5. A paid call

Fund a wallet with Base Sepolia USDC from https://faucet.circle.com, then:

```bash
PRIVATE_KEY=0xThatWalletsKey npm run client
```

`examples/agent-client.ts` wraps `fetch` with `x402-fetch`, which intercepts the 402, picks the EVM entry from `accepts[]`, signs an EIP-3009 USDC transfer authorization for exactly $0.002, retries with the `X-PAYMENT` header, and hands you the 200. It polls twice — the second time with the cursor from the first — so you can watch the delta appear.

## 6. Reading the artifact — and the cursor

The first poll has no history to compare against:

```json
{
  "delta": { "hasCursor": false, "cursorStatus": "none", "summary": null,
             "changes": [ { "id": "bitcoin", "previousUsd": null, "currentUsd": 64305, "direction": "new" } ] },
  "trend": { "direction": "down", "basis": "provider_24h", "pct": -0.0225 },
  "cursor": "eyJrIjoiY3J5cHRvOmJpdGNvaW4sZXRoZXJldW06dXNkIiwicCI6…"
}
```

Note `trend.basis`. With no cursor there is nothing of *yours* to measure against, so the trend falls back to CoinGecko's own 24h move averaged across the basket. Flights have no such provider signal, so a first flight poll returns `basis: "none"`.

**Keep that `cursor` string.** Send it on the next call:

```bash
curl -s "http://localhost:4044/check?market=crypto&ids=bitcoin,ethereum&cursor=eyJrIjoi…"
```

```json
{
  "delta": {
    "hasCursor": true, "cursorStatus": "applied",
    "since": "2026-08-07T02:35:51.529Z", "elapsedSeconds": 3600,
    "changes": [
      { "id": "bitcoin", "previousUsd": 64266, "currentUsd": 64305, "absUsd": 39, "pct": 0.0607, "direction": "up" },
      { "id": "ethereum", "previousUsd": 1898.95, "currentUsd": 1899.4, "absUsd": 0.45, "pct": 0.0237, "direction": "up" }
    ],
    "summary": { "up": 2, "down": 0, "flat": 0, "new": 0, "biggestMoverId": "bitcoin", "biggestMovePct": 0.0607 }
  },
  "trend": { "direction": "up", "basis": "cursor", "pct": 0.0422 },
  "cursor": "eyJrIjoi…"   ← a NEW cursor. Keep this one now.
}
```

That is the whole loop: **check → keep the cursor → check again with it**.

### What can go wrong with a cursor (and why it won't cost you)

Try sending the bitcoin cursor to a different watch:

```bash
curl -s "http://localhost:4044/check?market=crypto&ids=solana&cursor=<the bitcoin cursor>"
```

```json
{ "delta": { "cursorStatus": "wrong_watch", "hasCursor": false },
  "notes": ["The cursor you sent belongs to a different watch — deltas are omitted. …"] }
```

You still get the solana snapshot. A cursor mismatch, a truncated string, or a tampered signature all degrade the same way: the delta is omitted, a note explains why, and the snapshot you paid for is still in the body. There is no failure mode where payment settles and you receive nothing.

### Is a flight price real?

```json
{ "source": "fixture", "live": false,
  "notes": ["AMADEUS_CLIENT_ID/AMADEUS_CLIENT_SECRET unset — flight quotes are deterministic fixtures."] }
```

Flight fixtures drift in ten-minute buckets, so a polling client sees plausible movement — useful for building against, never for booking. Crypto is never a fixture.

### Verify the signature

```bash
curl -s -X POST http://localhost:4044/verify \
  -H 'content-type: application/json' -d "$(jq -c '.check' out.json)"
# {"valid":true}
```

## 7. Paying on the Solana rail

The second `accepts[]` entry is the Solana rail. Its `extra.feePayer` is the facilitator account that sponsors the SOL network fee, so a payer needs **only USDC** — no SOL for gas.

Build a fee-sponsored SPL `transferChecked` for `maxAmountRequired` to the base58 `payTo`, sign it, and send the base64 x402 envelope as `X-PAYMENT`. The payment modal's server helpers do the building and encoding:

```ts
import { prepareSolanaCheckout, encodeX402Payment } from "@three-ws/x402-payment-modal/server";

const url = `${BASE}/check?market=crypto&ids=bitcoin`;
const accept = (await (await fetch(url)).json()).accepts.find((a) => a.network.startsWith("solana"));

const { tx_base64 } = await prepareSolanaCheckout({ accept, buyer: myPublicKey });
const { x_payment } = encodeX402Payment({
  accept, signedTxBase64: await wallet.signTransaction(tx_base64), resourceUrl: accept.resource,
});
const paid = await fetch(url, { headers: { "X-PAYMENT": x_payment } });
```

To test on devnet instead of mainnet, set `SOLANA_NETWORK=devnet`.

## 8. Going live

1. **Flights**: set `AMADEUS_CLIENT_ID` / `AMADEUS_CLIENT_SECRET`. `test.api.amadeus.com` is the free sandbox; set `AMADEUS_BASE_URL=https://api.amadeus.com` for production inventory. Crypto is already live.
2. **EVM rail**: set `NETWORK=base` and point `FACILITATOR_URL` at a mainnet-capable facilitator (the default x402.org facilitator settles testnets).
3. **Solana rail**: already mainnet by default (`SOLANA_NETWORK=mainnet-beta`, PayAI facilitator). Nothing to change.
4. Set a strong `SIGNING_SECRET` — and set it **once**, before clients start holding cursors.
5. Use real receiving wallets for `PAY_TO_ADDRESS` / `SOLANA_PAY_TO_ADDRESS`.

Want a single rail? Unset the other rail's `payTo`; it is dropped from `accepts` with a startup warning and the remaining rail keeps working.

Prices stay in dollar strings (`$0.002`); the middleware converts to USDC base units per network, so both rails always quote the same price.
