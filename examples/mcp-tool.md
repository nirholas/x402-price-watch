# Expose x402-price-watch as an MCP tool for Claude

[MCP](https://modelcontextprotocol.io) lets Claude call your services as tools. This implementation wraps `x402-fetch`, so every call pays its own way with USDC.

The service is **dual rail** — its 402 challenges accept USDC on Base *and* USDC on Solana. `x402-fetch` pays the Base rail; to pay from a Solana wallet instead, swap the fetch wrapper for an x402 Solana client (see [`docs/agents.md`](../docs/agents.md#solana-rail)). Everything below is otherwise identical.

The one design decision worth copying: **the MCP server holds the cursor, not the model.** Cursors are long opaque strings scoped to a watch key; threading them through the model's context wastes tokens and invites corruption. Keep them in a map keyed by watch key and the model never has to see one.

## The server

```ts
// price-watch-mcp.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { wrapFetchWithPayment } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

const BASE = process.env.PRICE_WATCH_URL ?? "http://localhost:4044";
const payFetch = wrapFetchWithPayment(
  fetch,
  privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`),
);

// watchKey → cursor. The model never sees these.
const cursors = new Map<string, string>();

const server = new McpServer({ name: "x402-price-watch", version: "0.1.0" });

server.tool(
  "price_check",
  "Poll a price and get what changed since the last poll ($0.002). Crypto is always live (CoinGecko); flights need Amadeus credentials on the server. The cursor is threaded automatically — call this repeatedly and each result includes the delta since your previous call.",
  {
    market: z.enum(["crypto", "flight"]),
    ids: z.string().optional().describe("crypto only. Comma-separated CoinGecko ids, e.g. bitcoin,ethereum"),
    vs: z.string().optional().describe("crypto only. Quote currency, default usd"),
    origin: z.string().optional().describe("flight only. IATA airport code, e.g. JFK"),
    destination: z.string().optional().describe("flight only. IATA airport code"),
    departureDate: z.string().optional().describe("flight only. YYYY-MM-DD"),
    adults: z.number().optional().describe("flight only. Default 1"),
    reset: z.boolean().optional().describe("Forget the stored cursor and start a fresh baseline."),
  },
  async ({ reset, ...params }) => {
    // Ask the server what watch these parameters normalize to (free), so the
    // cursor map is keyed exactly the way the server scopes cursors.
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]),
    );
    const { watchKey } = await (await fetch(`${BASE}/watch-key?${qs}`)).json();

    if (reset) cursors.delete(watchKey);
    const cursor = cursors.get(watchKey);
    if (cursor) qs.set("cursor", cursor);

    const res = await payFetch(`${BASE}/check?${qs}`);
    const body = await res.json();
    const payload = body.check.payload;

    cursors.set(watchKey, payload.cursor);

    // Hand the model the decision-shaped fields, not the cursor.
    const { cursor: _omit, ...visible } = payload;
    return { content: [{ type: "text", text: JSON.stringify({ ...visible, payment: body.payment }, null, 2) }] };
  },
);

server.tool(
  "price_watch_sources",
  "Check whether this deployment returns live prices or fixtures, per market. Free.",
  {},
  async () => {
    const res = await fetch(`${BASE}/sources`);
    return { content: [{ type: "text", text: JSON.stringify(await res.json(), null, 2) }] };
  },
);

await server.connect(new StdioServerTransport());
```

```bash
npm install @modelcontextprotocol/sdk x402-fetch viem zod tsx
```

## Wire it into Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "x402-price-watch": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/price-watch-mcp.ts"],
      "env": {
        "PRICE_WATCH_URL": "http://localhost:4044",
        "PRIVATE_KEY": "0x…wallet with Base Sepolia USDC…"
      }
    }
  }
}
```

Give the wallet a small, capped balance — every `price_check` call spends real (testnet) USDC. At $0.002 a call, $1 is 500 polls. The tool result includes `payment.rail` and `payment.facilitator`, so the agent can report what it spent and where it settled.

## Prompting notes

- The **first** call on a new watch has no baseline: `delta.hasCursor` is `false` and every change is `direction: "new"`. Tell the agent to say "baseline set" rather than reporting a move.
- From the second call on, `delta.summary.biggestMovePct` is the number to react to. `trend.basis: "cursor"` confirms the comparison is against your own previous poll rather than the provider's 24h window.
- Have the agent check `live` before quoting a flight price. `false` means Amadeus credentials are unset and the number is a fixture.
- If the agent wants a fresh baseline (the user changed their mind about what to watch), pass `reset: true` rather than mutating the parameters and hoping — a parameter change already invalidates the cursor, which shows up as `cursorStatus: "wrong_watch"`.
- Artifacts are signed. Store `check.payload` + `check.signature` if you need to prove later what the price was at a given moment; `POST /verify` re-checks it for free.
