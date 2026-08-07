# curl walkthrough — raw 402 → pay → 200

Start the server:

```bash
npm run dev        # boots with the suite's default receive addresses, on :4044
```

Every paid route is **dual rail**: the 402 lists USDC on Base *and* USDC on Solana at the same price, and you pay with whichever wallet you have.

## 0. Free reconnaissance

```bash
# Will these be live prices?
curl -s http://localhost:4044/sources | jq

# What watch key do my parameters normalize to?
curl -s "http://localhost:4044/watch-key?market=crypto&ids=bitcoin,ethereum" | jq
# { "watchKey": "crypto:bitcoin,ethereum:usd", "watchId": "watch_…" }
```

Crypto is always `live: true` — CoinGecko needs no key. Flights are `live: false` until Amadeus credentials are set.

## 1. Hit the paid route without payment → 402

```bash
curl -si "http://localhost:4044/check?market=crypto&ids=bitcoin,ethereum"
```

Response (trimmed):

```
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-sepolia",
      "maxAmountRequired": "2000",
      "resource": "http://localhost:4044/check",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "extra": { "name": "USDC", "version": "2" }
    },
    {
      "scheme": "exact",
      "network": "solana",
      "maxAmountRequired": "2000",
      "resource": "http://localhost:4044/check",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "extra": { "name": "USD Coin", "decimals": 6, "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4" }
    }
  ]
}
```

The `accepts` array is the machine-readable price sheet, one entry per rail: `maxAmountRequired` is in USDC base units (6 decimals), so `"2000"` is $0.002. Pick one:

```bash
curl -s "http://localhost:4044/check?market=crypto&ids=bitcoin,ethereum" \
  | jq '.accepts[] | {network, payTo, asset, maxAmountRequired}'
```

## 2. Pay — on either rail

The `X-PAYMENT` header is a base64-encoded, wallet-signed authorization matching one of those entries. Hand-rolling it means EIP-712 (Base) or SPL transaction building (Solana) — use a client:

**Base / EVM**

```bash
PRIVATE_KEY=0x... npm run client       # examples/agent-client.ts does the full loop
```

Under the hood: parse the 402 → sign an EIP-3009 `transferWithAuthorization` for the exact amount → retry with `X-PAYMENT: <base64 payload>`.

**Solana**

Use any x402 Solana client, or `@three-ws/x402-payment-modal` in a browser. Under the hood: build a fee-sponsored SPL `transferChecked` for `maxAmountRequired` to the base58 `payTo`, have the wallet sign it, base64-encode the x402 envelope, retry with `X-PAYMENT`. `extra.feePayer` sponsors the SOL network fee, so your wallet needs only USDC.

The server reads `network` off your payload, picks the matching requirement, and settles through **that rail's** facilitator — the two differ, and the receipt names the one that handled yours.

## 3. Paid retry → 200 with the snapshot in-body

```
HTTP/1.1 200 OK
X-PAYMENT-RESPONSE: <base64 of {"success":true,"rail":"solana","network":"solana","facilitator":"https://facilitator.payai.network","transaction":"5xY…","payer":"7hF…","amount":"2000","asset":"USDC"}>

{
  "check": {
    "payload": {
      "checkId": "chk_…",
      "watchKey": "crypto:bitcoin,ethereum:usd",
      "source": "coingecko", "live": true,
      "snapshot": { "items": [ { "id": "bitcoin", "priceUsd": 64305 } ], "missing": [] },
      "delta": { "hasCursor": false, "cursorStatus": "none", "summary": null },
      "trend": { "direction": "down", "basis": "provider_24h", "pct": -0.0225 },
      "cursor": "eyJrIjoiY3J5cHRvOmJpdGNvaW4sZXRoZXJldW06dXNkIiwicCI6…"
    },
    "signature": "…"
  },
  "payment": { "success": true, "rail": "solana", "transaction": "5xY…" }
}
```

Decode the header to see which rail settled:

```bash
echo "<header value>" | base64 -d | jq
```

## 4. The second poll — this is the point

Grab the cursor and send it back:

```bash
CURSOR=$(curl -s … | jq -r '.check.payload.cursor')
curl -s "http://localhost:4044/check?market=crypto&ids=bitcoin,ethereum&cursor=$CURSOR" \
  | jq '.check.payload | {cursorStatus: .delta.cursorStatus, elapsed: .delta.elapsedSeconds, changes: .delta.changes, trend}'
```

```json
{
  "cursorStatus": "applied",
  "elapsed": 3600,
  "changes": [
    { "id": "bitcoin", "previousUsd": 64266, "currentUsd": 64305, "absUsd": 39, "pct": 0.0607, "direction": "up" },
    { "id": "ethereum", "previousUsd": 1898.95, "currentUsd": 1899.4, "absUsd": 0.45, "pct": 0.0237, "direction": "up" }
  ],
  "trend": { "direction": "up", "basis": "cursor", "pct": 0.0422 }
}
```

Keep the **new** cursor from this response for the poll after that.

### Cursor mishaps are non-fatal

```bash
# A cursor from a different watch
curl -s "http://localhost:4044/check?market=crypto&ids=solana&cursor=$CURSOR" \
  | jq '.check.payload | {cursorStatus: .delta.cursorStatus, notes}'
```

```json
{ "cursorStatus": "wrong_watch",
  "notes": ["The cursor you sent belongs to a different watch — deltas are omitted. …"] }
```

You still get the snapshot you paid for. Same for a truncated or tampered cursor (`bad_signature`).

## 5. Flights

```bash
curl -s "http://localhost:4044/check?market=flight&origin=JFK&destination=LAX&departureDate=2026-09-14" \
  | jq '.check.payload | {source, live, items: .snapshot.items}'
```

```json
{
  "source": "fixture", "live": false,
  "items": [
    { "id": "cheapest", "priceUsd": 248.52, "extra": { "carrier": "WN", "stops": 0, "offersScanned": 6 } },
    { "id": "cheapest_nonstop", "priceUsd": 248.52, "extra": { "carrier": "WN" } }
  ]
}
```

`cheapest` and `cheapest_nonstop` are tracked separately because they move independently. `live: false` means Amadeus credentials are unset and these are fixtures.

## 6. Free routes need no payment

```bash
curl -s http://localhost:4044/sources | jq
curl -s "http://localhost:4044/watch-key?market=crypto&ids=bitcoin" | jq
curl -s http://localhost:4044/healthz
curl -s http://localhost:4044/.well-known/x402 | jq
curl -s -X POST http://localhost:4044/verify \
  -H 'content-type: application/json' -d '{"payload":{…},"signature":"…"}'
```
