# For AI agents

x402-price-watch exists for the polling case. An agent that wants to know "did anything move?" pays a fifth of a cent, gets a complete answer, and keeps a cursor so the next answer is a diff rather than a snapshot.

**Pay in USDC on Base or Solana — your client picks the rail.** Every 402 challenge carries both requirements at the same price; send `X-PAYMENT` for whichever wallet you hold.

## Discovery

Two machine-readable entry points, served by every deployment:

1. **`/skill.md`** (also at the repo root) — a human-and-agent-readable skill file describing every endpoint, price, parameter, and response schema, following the agentres.dev skill.md pattern. Feed it to your agent as context and it knows how to use the service.
2. **`GET /.well-known/x402`** — a JSON manifest (`x402Version`, `payment.rails[]`, and `resources[]` with prices, both networks, per-rail `accepts`, and output schemas) in the discovery format indexed by [x402scan.com](https://x402scan.com), the x402 Bazaar, and [agentic.market](https://agentic.market).

`GET /sources` and `GET /watch-key` are both free — use them to check whether a deployment will give you live prices, and what watch key your parameters normalize to, before spending anything.

**Operators:** after deploying, submit your base URL to those indexes so agents can find you — x402scan crawls `/.well-known/x402` automatically once listed.

### Protocol version

This service speaks **x402 v1**: the challenge body is `{ x402Version: 1, error, accepts[] }`, and
every entry in `accepts` carries `outputSchema.input` / `outputSchema.output`, so you can build a
valid request and know the response shape before you spend anything.

x402 **v2** — CAIP-2 network identifiers and `extensions.bazaar.schema` — is a planned upgrade for
[agentcash](https://x402scan.com/discovery/spec) compatibility. It changes the shape of the
challenge, so it will arrive as a deliberate version bump rather than silently; until then, pin an
x402 v1 client such as `x402-fetch`.

## The polling loop

This is the entire integration:

```ts
import { wrapFetchWithPayment } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";

const payFetch = wrapFetchWithPayment(fetch, privateKeyToAccount(process.env.PRIVATE_KEY));
let cursor: string | undefined;

async function poll() {
  const url = new URL("https://watch.example/check");
  url.searchParams.set("market", "crypto");
  url.searchParams.set("ids", "bitcoin,ethereum");
  if (cursor) url.searchParams.set("cursor", cursor);

  const { check } = await (await payFetch(url)).json();
  cursor = check.payload.cursor;          // ← carry it forward, that is the whole trick
  return check.payload;
}

// every 5 minutes, $0.002 a look
setInterval(async () => {
  const p = await poll();
  const mover = p.delta.summary?.biggestMoverId;
  if (mover && Math.abs(p.delta.summary.biggestMovePct) > 2) await alert(p.delta.changes);
}, 5 * 60_000);
```

Persist `cursor` wherever you persist anything else. It is a short opaque string, it contains nothing about the payer, and it is the only state the integration has.

`x402-fetch` handles the 402 → sign → retry loop and enforces a max payment cap (default 0.10 USDC) so a misconfigured server can't drain the wallet. It selects the EVM entry from `accepts[]`.

### Solana rail

Read the entry whose `network` starts with `solana`, build a fee-sponsored SPL `transferChecked` for `maxAmountRequired` to the base58 `payTo`, sign it, and send the base64 x402 envelope as `X-PAYMENT`. `extra.feePayer` sponsors the SOL network fee, so a USDC balance is sufficient — no SOL required.

```ts
import { prepareSolanaCheckout, encodeX402Payment } from "@three-ws/x402-payment-modal/server";

const res = await fetch(url);                              // → 402
const accept = (await res.json()).accepts.find((a) => a.network.startsWith("solana"));
const { tx_base64 } = await prepareSolanaCheckout({ accept, buyer: myPublicKey });
const { x_payment } = encodeX402Payment({
  accept, signedTxBase64: await wallet.signTransaction(tx_base64), resourceUrl: accept.resource,
});
const paid = await fetch(url, { headers: { "X-PAYMENT": x_payment } });
```

### Reading the settlement receipt

Every paid `200` carries `X-PAYMENT-RESPONSE`, base64 JSON: `{success, rail, network, facilitator, transaction, payer, amount, asset}` — also echoed in the body as `payment`. Use `rail` to record which chain your budget was drawn on; the two rails settle through different facilitators, and `facilitator` names the one that handled yours.

## What to branch on

| Field | Use it for |
|---|---|
| `delta.summary.biggestMovePct` | The "is this worth waking someone up?" number |
| `delta.changes[].direction` | `up` / `down` / `flat` / `new` per tracked id |
| `trend.basis` | `cursor` means measured against *your* last poll. `provider_24h` means you sent no usable cursor |
| `live` | `false` means fixtures (flights without Amadeus credentials). Never act on a fixture price |
| `delta.cursorStatus` | If this is not `applied` or `none`, your cursor handling has a bug |

`cursorStatus` is worth logging. `wrong_watch` means you changed a parameter without resetting the cursor; `bad_signature` means the string was corrupted in storage or the operator rotated `SIGNING_SECRET`. Neither fails the call — you get the snapshot regardless — but both mean you paid for a diff you didn't get.

## Cursor rules

- One cursor per **watch key**, not per market. `crypto:bitcoin:usd` and `crypto:bitcoin,ethereum:usd` are different watches. Reset the cursor whenever you change parameters, or call `GET /watch-key` (free) to see what a parameter set maps to.
- Cursors are signed by the server, so you cannot forge a previous price — and neither can anyone who intercepts one.
- There is no expiry, but a very old cursor gives you a very long `elapsedSeconds`. Read it before interpreting a percentage.

## Budgeting

At $0.002 a poll, $1 buys 500 checks. Two ways to keep that bounded:

1. Poll on an interval proportional to how fast the thing moves — a fare once an hour, a token once a minute during a move and not at all otherwise.
2. Wrap your fetch with [`x402-agent-wallet`](https://github.com/nirholas/x402-agent-wallet)'s policy checks for hard per-call and per-day caps.

## MCP integration

To give Claude this capability as a tool, see [`examples/mcp-tool.md`](https://github.com/nirholas/x402-price-watch/blob/main/examples/mcp-tool.md) — a minimal MCP server exposing `price_check`, which threads the cursor across calls so the model never has to hold it.

## Composing with the suite

- `x402-price-watch` detects the move; `x402-rebooker` turns it into an ordered set of rebooking actions.
- `x402-concierge` can run a check as one step of a bigger plan, returning it with its own receipt inline.
- `x402-flight-search` finds the route in the first place; this service watches it afterwards.

Questions or integration help: **nichxbt@gmail.com**
