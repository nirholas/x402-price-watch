/**
 * Full x402 flow against x402-price-watch, EVM rail (primary).
 *
 * The paid route is DUAL RAIL: the 402 challenge lists USDC on Base and USDC on
 * Solana at the same price, and you pay with whichever you hold. This example
 * uses `x402-fetch` + `viem`, which handles the Base rail. See the "Solana rail"
 * note at the bottom of this file for the SVM path.
 *
 * Flow:
 *   1. GET /sources     (free)  — will these be live prices or fixtures?
 *   2. GET /watch-key   (free)  — what watch do my parameters normalize to?
 *   3. GET /check       (paid)  — first poll, no cursor
 *   4. GET /check       (paid)  — same watch WITH the cursor → deltas appear
 *   5. GET /check       (paid)  — flights, to show the second market
 *   6. POST /verify     (free)  — re-check the signature on what we bought
 *
 * Usage:
 *   PRIVATE_KEY=0x... BASE_URL=http://localhost:4044 npm run client
 *
 * PRIVATE_KEY must hold Base Sepolia USDC (faucet: https://faucet.circle.com).
 */
import { config } from "dotenv";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";

config();

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4044";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error("Set PRIVATE_KEY (0x… key of a wallet holding Base Sepolia USDC).");
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
const payFetch = wrapFetchWithPayment(fetch, account);

function url(params: Record<string, string>): string {
  const u = new URL(`${BASE_URL}/check`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

function printReceiptHeader(res: Response, label: string): void {
  const header = res.headers.get("x-payment-response");
  if (header) {
    console.log(`  ${label} X-PAYMENT-RESPONSE:`, JSON.stringify(decodeXPaymentResponse(header)));
  }
}

/** Print the parts of a check an agent actually branches on. */
function summarize(payload: any): void {
  console.log(`  source: ${payload.source} (live: ${payload.live}) · watch: ${payload.watchKey}`);
  console.log(
    "  prices: " + payload.snapshot.items.map((i: any) => `${i.id}=$${i.priceUsd}`).join(", ") +
      (payload.snapshot.missing.length ? ` · missing: ${payload.snapshot.missing.join(", ")}` : ""),
  );
  console.log(`  cursorStatus: ${payload.delta.cursorStatus}` +
    (payload.delta.elapsedSeconds !== null ? ` (${payload.delta.elapsedSeconds}s since your cursor)` : ""));
  for (const c of payload.delta.changes) {
    console.log(
      c.direction === "new"
        ? `    ${c.id}: ${c.currentUsd} (new — no previous price in your cursor)`
        : `    ${c.id}: ${c.previousUsd} → ${c.currentUsd}  ${c.absUsd >= 0 ? "+" : ""}${c.absUsd} (${c.pct}%) ${c.direction}`,
    );
  }
  if (payload.delta.summary) console.log(`  summary: ${JSON.stringify(payload.delta.summary)}`);
  console.log(`  trend: ${payload.trend.direction} (${payload.trend.basis}) ${payload.trend.pct ?? "—"}%`);
  for (const n of payload.notes) console.log(`  note: ${n}`);
}

async function verifySignature(artifact: unknown): Promise<void> {
  const res = await fetch(`${BASE_URL}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(artifact),
  });
  console.log("  signature valid:", (await res.json()).valid);
}

async function main(): Promise<void> {
  console.log(`agent wallet: ${account.address}`);

  // 1. Free: which sources are live here?
  const sources = await (await fetch(`${BASE_URL}/sources`)).json();
  console.log("\n1) price sources:");
  for (const [market, info] of Object.entries<any>(sources)) {
    console.log(`  ${market.padEnd(7)} ${info.live ? "LIVE" : "fixture"} — ${info.provider}`);
  }

  // 2. Free: confirm the watch identity before spending.
  const cryptoParams = { market: "crypto", ids: "bitcoin,ethereum" };
  const keyRes = await fetch(`${BASE_URL}/watch-key?${new URLSearchParams(cryptoParams)}`);
  console.log("\n2) watch key:", JSON.stringify(await keyRes.json()));

  // 3. Paid: first poll. No cursor, so no deltas — every change is "new".
  const firstRes = await payFetch(url(cryptoParams));
  const first = await firstRes.json();
  console.log("\n3) first poll (no cursor):");
  summarize(first.check.payload);
  printReceiptHeader(firstRes, "poll#1");

  // 4. Paid: same watch, this time carrying the cursor from poll #1.
  //    In a real loop these are minutes or hours apart; back to back the moves
  //    will be tiny or zero, which is itself a useful thing to see.
  const cursor: string = first.check.payload.cursor;
  const secondRes = await payFetch(url({ ...cryptoParams, cursor }));
  const second = await secondRes.json();
  console.log("\n4) second poll (cursor applied):");
  summarize(second.check.payload);
  printReceiptHeader(secondRes, "poll#2");
  await verifySignature(second.check);

  // 5. Paid: the other market. Flights track cheapest and cheapest-nonstop
  //    separately, because they move independently.
  const flightRes = await payFetch(
    url({ market: "flight", origin: "JFK", destination: "LAX", departureDate: "2026-09-14" }),
  );
  const flight = await flightRes.json();
  console.log("\n5) flight poll:");
  summarize(flight.check.payload);
  printReceiptHeader(flightRes, "flight");

  console.log(
    "\nDone. Three polls, $0.006 total.\n" +
      "The loop is: check → keep check.payload.cursor → check again with it.",
  );
}

main().catch((err) => {
  console.error("agent-client failed:", err);
  process.exit(1);
});

/* ---------------------------------------------------------------------------
 * Solana rail — the same route, paid with USDC on Solana.
 *
 * The 402 body's `accepts` array has a second entry with `network: "solana"`, a
 * base58 `payTo`, the USDC mint as `asset`, and `extra.feePayer` — the
 * facilitator account that sponsors the SOL network fee, so your wallet needs
 * only USDC. Note the two rails settle through DIFFERENT facilitators: the
 * reference x402.org facilitator does not settle Solana mainnet, so this server
 * routes the Solana rail to PayAI by default (SOLANA_FACILITATOR_URL).
 *
 * Build a fee-sponsored SPL `transferChecked` for `maxAmountRequired`, sign it,
 * and send it base64-encoded as `X-PAYMENT`:
 *
 *   const challenge = await (await fetch(url({ market: "crypto", ids: "bitcoin" }))).json();
 *   const solana = challenge.accepts.find((a: any) => a.network.startsWith("solana"));
 *
 *   //   import { prepareSolanaCheckout, encodeX402Payment }
 *   //     from "@three-ws/x402-payment-modal/server";
 *   //   const { tx_base64 } = await prepareSolanaCheckout({ accept: solana, buyer: myPubkey });
 *   //   const signed = await wallet.signTransaction(tx_base64);
 *   //   const { x_payment } = encodeX402Payment({
 *   //     accept: solana, signedTxBase64: signed, resourceUrl: solana.resource,
 *   //   });
 *   //   await fetch(url({ market: "crypto", ids: "bitcoin" }), {
 *   //     headers: { "X-PAYMENT": x_payment },
 *   //   });
 *
 * And the raw dual-rail 402 body, for reference:
 *
 *   curl -s "http://localhost:4044/check?market=crypto&ids=bitcoin" \\
 *     | jq '.accepts[] | {network, payTo, maxAmountRequired}'
 *
 *   { "network": "base-sepolia", "payTo": "0x4025…2402", "maxAmountRequired": "2000" }
 *   { "network": "solana",       "payTo": "Wwwu…T3WwW", "maxAmountRequired": "2000" }
 * ------------------------------------------------------------------------- */
