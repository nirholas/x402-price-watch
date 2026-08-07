# API reference

Base URL: your deployment (default `http://localhost:4044`). Machine-readable: [`openapi.json`](https://github.com/nirholas/x402-price-watch/blob/main/openapi.json) · [`/.well-known/x402`](https://github.com/nirholas/x402-price-watch/blob/main/public/.well-known/x402).

All paid routes follow x402: unpaid request → `402` + `PaymentRequirements`; request with a valid `X-PAYMENT` header → `200` + artifact + `X-PAYMENT-RESPONSE`.

## Payment rails

Every paid route is **dual rail** — the 402 body's `accepts[]` holds one entry per rail at the same price, and the server settles whichever one your `X-PAYMENT` payload names in its `network` field.

| Rail | `network` | Asset | payTo | Facilitator |
|---|---|---|---|---|
| EVM | `base-sepolia` (default), `base` | USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` | `https://x402.org/facilitator` |
| Solana | `solana` (default), `solana-devnet` | USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` | `https://facilitator.payai.network` |

The two rails use **different facilitators** because the reference x402.org facilitator does not settle Solana mainnet. Override either with `FACILITATOR_URL` / `SOLANA_FACILITATOR_URL`. The Solana entry carries `extra.feePayer` — the facilitator account that sponsors the SOL network fee, so payers need only USDC.

**402 body**

```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    { "scheme": "exact", "network": "base-sepolia", "maxAmountRequired": "2000",
      "resource": "https://host/check", "description": "…", "mimeType": "application/json",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402", "maxTimeoutSeconds": 60,
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "extra": { "name": "USDC", "version": "2" } },
    { "scheme": "exact", "network": "solana", "maxAmountRequired": "2000",
      "resource": "https://host/check", "description": "…", "mimeType": "application/json",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW", "maxTimeoutSeconds": 60,
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "extra": { "name": "USD Coin", "decimals": 6, "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4" } }
  ]
}
```

**`X-PAYMENT-RESPONSE`** (on every paid `200`) is base64 JSON, also echoed in the body as `payment`:

```json
{ "success": true, "rail": "solana", "network": "solana",
  "facilitator": "https://facilitator.payai.network",
  "transaction": "5xY…", "payer": "7hF…", "amount": "2000", "asset": "USDC" }
```

---

## GET /check — $0.002

One price poll.

**Query parameters**

| Param | Applies to | Required | Notes |
|---|---|---|---|
| `market` | both | yes | `crypto` \| `flight` |
| `ids` | crypto | yes | Comma-separated CoinGecko ids, max 25, deduplicated and lowercased |
| `vs` | crypto | no | Quote currency, default `usd` |
| `origin` | flight | yes | IATA airport code |
| `destination` | flight | yes | IATA airport code |
| `departureDate` | flight | yes | `YYYY-MM-DD` |
| `returnDate` | flight | no | `YYYY-MM-DD` |
| `adults` | flight | no | Default `1` |
| `cabin` | flight | no | `ECONOMY` \| `PREMIUM_ECONOMY` \| `BUSINESS` \| `FIRST` |
| `cursor` | both | no | The `cursor` from your previous `/check` |

**200** — real output (CoinGecko is live, so these are actual prices):

```json
{
  "check": {
    "payload": {
      "checkId": "chk_89eefe6c652f7fdd",
      "market": "crypto",
      "watchKey": "crypto:bitcoin,ethereum:usd",
      "source": "coingecko",
      "live": true,
      "observedAt": "2026-08-07T03:35:51.712Z",
      "snapshot": {
        "items": [
          { "id": "bitcoin", "label": "bitcoin", "priceUsd": 64305,
            "extra": { "vsCurrency": "usd", "marketCapUsd": 1290340356886.7793,
                       "volume24hUsd": 18427348583.483917, "change24hPct": -0.2691,
                       "lastUpdatedAt": "2026-08-07T03:34:30.000Z" } },
          { "id": "ethereum", "label": "ethereum", "priceUsd": 1899.4,
            "extra": { "vsCurrency": "usd", "marketCapUsd": 229220263185.29047,
                       "volume24hUsd": 6848410359.832356, "change24hPct": 0.2242,
                       "lastUpdatedAt": "2026-08-07T03:34:20.000Z" } }
        ],
        "missing": []
      },
      "delta": {
        "hasCursor": true,
        "cursorStatus": "applied",
        "since": "2026-08-07T02:35:51.529Z",
        "elapsedSeconds": 3600,
        "changes": [
          { "id": "bitcoin", "label": "bitcoin", "previousUsd": 64266, "currentUsd": 64305,
            "absUsd": 39, "pct": 0.0607, "direction": "up" },
          { "id": "ethereum", "label": "ethereum", "previousUsd": 1898.95, "currentUsd": 1899.4,
            "absUsd": 0.45, "pct": 0.0237, "direction": "up" }
        ],
        "summary": { "up": 2, "down": 0, "flat": 0, "new": 0,
                     "biggestMoverId": "bitcoin", "biggestMovePct": 0.0607 }
      },
      "trend": {
        "direction": "up", "basis": "cursor", "pct": 0.0422,
        "note": "Average move of 2 tracked item(s) since your cursor (3600s ago)."
      },
      "cursor": "eyJrIjoiY3J5cHRvOmJpdGNvaW4sZXRoZXJldW06dXNkIiwicCI6…",
      "notes": []
    },
    "signature": "hex", "algorithm": "HMAC-SHA256", "canonicalization": "sorted-json"
  },
  "payment": { "success": true, "rail": "solana", "network": "solana",
               "facilitator": "https://facilitator.payai.network",
               "transaction": "5xY…", "amount": "2000", "asset": "USDC" }
}
```

On a **first** poll (no cursor) the same shape comes back with `delta.hasCursor: false`, `delta.summary: null`, every change marked `direction: "new"`, and the trend taken from the provider instead:

```json
{
  "delta": { "hasCursor": false, "cursorStatus": "none", "since": null, "elapsedSeconds": null,
             "changes": [ { "id": "bitcoin", "previousUsd": null, "currentUsd": 64305,
                            "absUsd": null, "pct": null, "direction": "new" } ],
             "summary": null },
  "trend": { "direction": "down", "basis": "provider_24h", "pct": -0.0225,
             "note": "No usable cursor, so the trend is CoinGecko's own 24h move averaged across the basket. …" }
}
```

### Field semantics

| Field | Meaning |
|---|---|
| `watchKey` | Normalized identity of the thing being watched. Cursors are scoped to it |
| `source` | `coingecko` / `amadeus` when live, `fixture` otherwise |
| `live` | `true` only when prices came from a real provider call |
| `snapshot.missing` | Ids you asked for that the provider did not return (unknown CoinGecko ids) |
| `delta.cursorStatus` | `none`, `applied`, `malformed`, `bad_signature`, `wrong_watch`, `unsupported_version` |
| `delta.elapsedSeconds` | Wall-clock gap between your cursor's snapshot and this one |
| `changes[].direction` | `up`, `down`, `flat`, or `new` (no price for this id in your cursor) |
| `trend.basis` | `cursor` (measured against your own last poll), `provider_24h` (CoinGecko's 24h move), or `none` |
| `cursor` | Opaque signed string. Send it next time |

### Cursors

The service keeps no watch history. Each response hands you a signed cursor encoding the prices in that snapshot; you send it back on the next call and get the delta.

- **Opaque, not secret.** base64url JSON plus an HMAC. It contains the watch key, a timestamp, and id→price. Nothing about the payer.
- **Signed** with `SIGNING_SECRET`. A tampered cursor is rejected — you cannot fabricate a previous price. Rotating the secret invalidates all issued cursors.
- **Scoped** to `watchKey`. Send a bitcoin cursor to a flight watch and you get `cursorStatus: "wrong_watch"`.
- **Never fatal.** A rejected cursor produces a snapshot with no delta plus an explanatory note, not an error. You get what you paid for either way.

### Flight snapshots

Two items are tracked, because they move independently:

| id | Meaning |
|---|---|
| `cheapest` | Lowest fare on the route/date, any number of stops |
| `cheapest_nonstop` | Lowest nonstop fare. Omitted (with a note) when the route has no nonstop |

`extra` carries the carrier, stops, times, duration, remaining seats, and how many offers were scanned.

**Errors**: `400` invalid query (names the bad parameter, includes worked examples), `402` unpaid, `500` `check_failed`.

---

## GET /watch-key — free

Same parameters as `/check`. Tells you what your parameters normalize to, so you can confirm a cursor will apply before spending anything.

```json
{
  "watchKey": "crypto:bitcoin,ethereum:usd",
  "watchId": "watch_1a2b3c4d5e6f7a8b",
  "note": "Cursors are scoped to this key. Change any parameter and your old cursor no longer applies."
}
```

## GET /sources — free

```json
{
  "crypto": { "provider": "CoinGecko — /simple/price", "live": true, "keyless": true,
              "note": "Always live. COINGECKO_API_KEY is optional and only raises rate limits." },
  "flight": { "provider": "Amadeus Self-Service — /v2/shopping/flight-offers", "live": false,
              "unlock": "AMADEUS_CLIENT_ID + AMADEUS_CLIENT_SECRET (free at developers.amadeus.com)",
              "fallback": "deterministic drifting fixtures, labeled source: \"fixture\"" }
}
```

## POST /verify — free

Body: `{"payload": …, "signature": "hex"}` → `{"valid": true|false}`. Works on any check artifact this server signed.

## GET /healthz — free

```json
{ "ok": true, "service": "x402-price-watch",
  "rails": [{ "rail": "evm", "network": "base-sepolia" }, { "rail": "solana", "network": "solana" }],
  "live": { "coingecko": true, "amadeus": false } }
```

## Signature scheme

`signature = HMAC-SHA256(SIGNING_SECRET, canonicalJson(payload))` where `canonicalJson` recursively sorts object keys and strips `undefined`. See `src/sign.ts`. The same primitive signs cursors — see `src/cursor.ts`.

## Error codes

| Status | Meaning |
|---|---|
| 400 | Invalid query — names the bad parameter and includes worked examples |
| 402 | Payment required, or the payment failed verification/settlement. Body carries the dual-rail `accepts[]` and an `error` reason |
| 500 | `check_failed`, or `no_payment_rail` when neither rail is configured |
| 502 | `facilitator_unreachable` / `settlement_error` — the rail's facilitator failed; nothing was charged |
