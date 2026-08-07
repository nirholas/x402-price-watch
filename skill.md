# x402-price-watch — agent skill

Pay-per-poll price watching. Every `GET /check` is a complete purchase: a fresh snapshot, the **delta against the opaque cursor you sent**, a trend read, and a new cursor for next time. The service is stateless — there are no watches to create, no subscriptions to cancel, and no server-side history. The cursor is your memory, and you carry it.

Crypto prices come from CoinGecko, which is keyless, so `market=crypto` is **always live**. Flight prices come from Amadeus when credentials are configured, deterministic fixtures otherwise.

**Pay in USDC on Base or Solana — your client picks the rail.** Every 402 challenge lists both.

**Base URL**: `{BASE_URL}` (self-hosted; default `http://localhost:4044`)

## Endpoints

### GET /check — $0.002

One poll.

| Param | Applies to | Required | Notes |
|---|---|---|---|
| `market` | both | yes | `crypto` \| `flight` |
| `ids` | crypto | yes | Comma-separated CoinGecko ids, max 25. e.g. `bitcoin,ethereum` |
| `vs` | crypto | no | Quote currency, default `usd` |
| `origin` | flight | yes | IATA airport code, e.g. `JFK` |
| `destination` | flight | yes | IATA airport code |
| `departureDate` | flight | yes | `YYYY-MM-DD` |
| `returnDate` | flight | no | `YYYY-MM-DD` |
| `adults` | flight | no | Default `1` |
| `cabin` | flight | no | `ECONOMY` \| `PREMIUM_ECONOMY` \| `BUSINESS` \| `FIRST` |
| `cursor` | both | no | The `cursor` from your previous `/check`. Omit on the first poll |

```
GET /check?market=crypto&ids=bitcoin,ethereum
GET /check?market=crypto&ids=bitcoin,ethereum&cursor=eyJrIjoi…
GET /check?market=flight&origin=JFK&destination=LAX&departureDate=2026-09-14&cursor=eyJrIjoi…
```

Response 200 (real output — CoinGecko is live, so these are actual prices):

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
          {
            "id": "bitcoin",
            "label": "bitcoin",
            "priceUsd": 64305,
            "extra": {
              "vsCurrency": "usd",
              "marketCapUsd": 1290340356886.7793,
              "volume24hUsd": 18427348583.483917,
              "change24hPct": -0.2691,
              "lastUpdatedAt": "2026-08-07T03:34:30.000Z"
            }
          },
          {
            "id": "ethereum",
            "label": "ethereum",
            "priceUsd": 1899.4,
            "extra": {
              "vsCurrency": "usd",
              "marketCapUsd": 229220263185.29047,
              "volume24hUsd": 6848410359.832356,
              "change24hPct": 0.2242,
              "lastUpdatedAt": "2026-08-07T03:34:20.000Z"
            }
          }
        ],
        "missing": []
      },
      "delta": {
        "hasCursor": true,
        "cursorStatus": "applied",
        "since": "2026-08-07T02:35:51.529Z",
        "elapsedSeconds": 3600,
        "changes": [
          {
            "id": "bitcoin",
            "label": "bitcoin",
            "previousUsd": 64266,
            "currentUsd": 64305,
            "absUsd": 39,
            "pct": 0.0607,
            "direction": "up"
          },
          {
            "id": "ethereum",
            "label": "ethereum",
            "previousUsd": 1898.95,
            "currentUsd": 1899.4,
            "absUsd": 0.45,
            "pct": 0.0237,
            "direction": "up"
          }
        ],
        "summary": { "up": 2, "down": 0, "flat": 0, "new": 0, "biggestMoverId": "bitcoin", "biggestMovePct": 0.0607 }
      },
      "trend": {
        "direction": "up",
        "basis": "cursor",
        "pct": 0.0422,
        "note": "Average move of 2 tracked item(s) since your cursor (3600s ago)."
      },
      "cursor": "eyJrIjoiY3J5cHRvOmJpdGNvaW4sZXRoZXJldW06dXNkIiwicCI6…",
      "notes": []
    },
    "signature": "hex-hmac-sha256",
    "algorithm": "HMAC-SHA256",
    "canonicalization": "sorted-json"
  },
  "payment": {
    "success": true, "rail": "solana", "network": "solana",
    "facilitator": "https://facilitator.payai.network",
    "transaction": "5xY…", "payer": "7hF…", "amount": "2000", "asset": "USDC"
  }
}
```

On the **first** poll (no cursor) the shape is the same but `delta.hasCursor` is `false`, `delta.summary` is `null`, every change has `direction: "new"`, and `trend.basis` is `provider_24h`:

```json
{
  "delta": { "hasCursor": false, "cursorStatus": "none", "since": null, "elapsedSeconds": null,
             "changes": [ { "id": "bitcoin", "previousUsd": null, "currentUsd": 64305, "pct": null, "direction": "new" } ],
             "summary": null },
  "trend": { "direction": "down", "basis": "provider_24h", "pct": -0.0225,
             "note": "No usable cursor, so the trend is CoinGecko's own 24h move averaged across the basket. …" }
}
```

**The polling loop**

1. First call: omit `cursor`. `delta.hasCursor` is `false`, `trend.basis` is `provider_24h` (crypto) or `none` (flight).
2. Keep `check.payload.cursor`.
3. Next call: pass it as `cursor`. `delta.changes` is now populated and `trend.basis` becomes `cursor`.
4. Keep the new cursor. Repeat.

**Cursors**

- Opaque but not secret: base64url JSON plus an HMAC. Nothing about the payer is in it.
- **Scoped to a watch key.** `watchKey` is the normalized market + parameters. Change any parameter and the old cursor no longer applies — you get `cursorStatus: "wrong_watch"` and a snapshot with no delta, not an error.
- **Signed.** A tampered cursor yields `cursorStatus: "bad_signature"`; you cannot invent a previous price.
- A rejected cursor never fails the call. You always get the snapshot you paid for, plus a note saying why the delta is missing.
- Cursors are signed with `SIGNING_SECRET`. If an operator rotates it, previously issued cursors stop validating.

**`cursorStatus` values**: `none` (you sent none), `applied`, `malformed`, `bad_signature`, `wrong_watch`, `unsupported_version`.

**`direction` values**: `up`, `down`, `flat`, and `new` (this id had no price in your cursor).

**Flight snapshots** track two items, because they move independently:

| id | Meaning |
|---|---|
| `cheapest` | Lowest fare on the route/date, any number of stops |
| `cheapest_nonstop` | Lowest nonstop fare. Absent (with a note) when no nonstop exists |

### GET /watch-key — free
Same parameters as `/check`. Returns the normalized `watchKey` and a stable `watchId`, so you can see what your parameters map to before spending anything.

### GET /sources — free
Which price sources this deployment can reach live.

### POST /verify — free
Body `{payload, signature}` → `{valid: true|false}` for any check artifact this server signed.

### GET /healthz — free

## Payment — dual rail

Protocol: **x402** (HTTP 402). Asset: **USDC** on both rails. A 402 response carries an `accepts` array with two entries; send `X-PAYMENT` for whichever you can pay.

| Rail | `network` | Asset address | payTo | Facilitator |
|---|---|---|---|---|
| EVM | `base-sepolia` (`base` via `NETWORK`) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` | `https://x402.org/facilitator` |
| Solana | `solana` (`solana-devnet` via `SOLANA_NETWORK`) | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` | `https://facilitator.payai.network` |

Flow: request → `402` with `accepts[]` → pick your rail → sign the USDC authorization (EIP-3009 on Base, fee-sponsored SPL `transferChecked` on Solana; `extra.feePayer` sponsors the SOL fee so you need no SOL) → retry with `X-PAYMENT` → `200` with the artifact in-body plus an `X-PAYMENT-RESPONSE` header, echoed in the body as `payment`.

At $0.002 a poll, a 500-call budget is one dollar. Poll as often as the question deserves.

## Data sources

| Market | Provider | Live when | Otherwise |
|---|---|---|---|
| crypto | CoinGecko `/simple/price` | **always** — keyless | n/a |
| flight | Amadeus `/v2/shopping/flight-offers` | `AMADEUS_CLIENT_ID` + `AMADEUS_CLIENT_SECRET` | deterministic drifting fixtures, `source: "fixture"`, `live: false` |

A live Amadeus lookup that fails degrades to fixtures with a `notes` entry rather than failing your paid call. Check `live` before acting on a flight price.

## Error codes

| Status | Meaning |
|---|---|
| 400 | Invalid query — names the bad parameter and includes worked examples |
| 402 | Payment required, or the payment failed verification/settlement. Body carries the dual-rail `accepts[]` |
| 500 | `check_failed`, or `no_payment_rail` when neither rail is configured |
| 502 | `facilitator_unreachable` / `settlement_error` — the rail's facilitator failed; nothing was charged |

Machine-readable manifest (lists both rails per resource): `{BASE_URL}/.well-known/x402`

Contact: **nichxbt@gmail.com**
