import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activeRails, paymentReceipt, paywall, usingSuiteDefaultPayTo } from "./payments.js";
import { ROUTE_SCHEMAS } from "./schemas.js";
import { amadeusConfigured } from "./amadeus.js";
import { check, validateCheck, watchId, watchKeyFor } from "./service.js";
import { usingDevSecret, verify } from "./sign.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

const PORT = Number(process.env.PORT ?? 4044);

const PRICES: Record<string, string> = {
  "GET /check": "$0.002",
};

const DESCRIPTIONS: Record<string, string> = {
  "GET /check":
    "One price poll: fresh snapshot, delta vs your cursor, trend, and a new cursor for the next check",
};

const rails = activeRails();

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(paywall(PRICES, { service: "x402-price-watch", descriptions: DESCRIPTIONS, schemas: ROUTE_SCHEMAS }));

// ---------- paid routes ----------

app.get("/check", async (req, res) => {
  const { error, query } = validateCheck(req.query as Record<string, unknown>);
  if (error || !query) {
    res.status(400).json({
      error,
      hint:
        "GET /check?market=crypto&ids=bitcoin,ethereum  ·  " +
        "GET /check?market=flight&origin=JFK&destination=LAX&departureDate=2026-09-14  " +
        "(add &cursor=… from your previous check to get the delta)",
    });
    return;
  }
  try {
    const result = await check(query);
    res.status(200).json({ check: result, payment: paymentReceipt(res) });
  } catch (err) {
    res.status(500).json({
      error: "check_failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

// ---------- free routes ----------

/** Preview the watch key + id for a set of parameters without paying. */
app.get("/watch-key", (req, res) => {
  const { error, query } = validateCheck(req.query as Record<string, unknown>);
  if (error || !query) {
    res.status(400).json({ error });
    return;
  }
  const key = watchKeyFor(query);
  res.json({
    watchKey: key,
    watchId: watchId(key),
    note: "Cursors are scoped to this key. Change any parameter and your old cursor no longer applies.",
  });
});

app.get("/sources", (_req, res) => {
  res.json({
    crypto: {
      provider: "CoinGecko — /simple/price",
      live: true,
      keyless: true,
      note: "Always live. COINGECKO_API_KEY is optional and only raises rate limits.",
    },
    flight: {
      provider: "Amadeus Self-Service — /v2/shopping/flight-offers",
      live: amadeusConfigured(),
      unlock: "AMADEUS_CLIENT_ID + AMADEUS_CLIENT_SECRET (free at developers.amadeus.com)",
      fallback: 'deterministic drifting fixtures, labeled source: "fixture"',
    },
  });
});

app.post("/verify", (req, res) => {
  const { payload, signature } = req.body ?? {};
  if (payload === undefined || typeof signature !== "string") {
    res.status(400).json({ error: "body must be {payload, signature}" });
    return;
  }
  res.json({ valid: verify({ payload, signature }) });
});

app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    service: "x402-price-watch",
    rails: rails.map((r) => ({ rail: r.rail, network: r.network })),
    live: { coingecko: true, amadeus: amadeusConfigured() },
  });
});

app.get("/.well-known/x402", (_req, res) => {
  res.type("application/json");
  res.sendFile(path.join(PUBLIC_DIR, ".well-known", "x402"));
});

// Agent-facing skill file lives at the repo root; serve it alongside the manifest.
app.get("/skill.md", (_req, res) => {
  res.type("text/markdown");
  res.sendFile(path.resolve(__dirname, "..", "skill.md"));
});

app.use(express.static(PUBLIC_DIR));

app.listen(PORT, () => {
  console.log(`x402-price-watch listening on http://localhost:${PORT}`);
  console.log("  Payment rails (client picks one):");
  for (const rail of rails) {
    console.log(`    ${rail.rail.padEnd(7)} ${rail.network.padEnd(14)} USDC → ${rail.payTo}`);
    console.log(`            facilitator: ${rail.facilitator}`);
  }
  if (usingSuiteDefaultPayTo()) {
    console.log(
      "  NOTE: using suite default payTo — set PAY_TO_ADDRESS / SOLANA_PAY_TO_ADDRESS to receive funds yourself.",
    );
  }
  console.log("  Price sources:");
  console.log("    coingecko (crypto)  LIVE — keyless");
  console.log(`    amadeus   (flights) ${amadeusConfigured() ? "LIVE" : "fixture — set AMADEUS_CLIENT_ID/SECRET"}`);
  if (usingDevSecret()) {
    console.log("  WARNING: using built-in dev SIGNING_SECRET — set SIGNING_SECRET in production.");
    console.log("           Cursors are signed with it, so changing it invalidates issued cursors.");
  }
  console.log("  Paid routes:");
  for (const [route, price] of Object.entries(PRICES)) {
    console.log(`    ${route.padEnd(26)} ${price}`);
  }
  console.log("  Free routes: GET /watch-key, GET /sources, POST /verify, GET /healthz, GET /.well-known/x402");
});
