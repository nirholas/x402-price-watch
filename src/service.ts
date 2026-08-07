// Pay-per-poll price watching.
//
// Every /check is a complete purchase: a fresh snapshot, the delta against the
// cursor you sent, a trend read, and a new cursor for next time. There is no
// subscription to manage and no server-side watch state — the cursor carries
// your history, so the artifact you pay for is always in the response body.

import { createHash, randomBytes } from "node:crypto";
import { fetchCoinPrices } from "./coingecko.js";
import { amadeusConfigured, searchFlights } from "./amadeus.js";
import { fixtureFlightQuotes } from "./fixtures.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { sign, type SignedArtifact } from "./sign.js";

export type Market = "crypto" | "flight";
export type Source = "coingecko" | "amadeus" | "fixture";
export type Direction = "up" | "down" | "flat";

export interface CheckQuery {
  market: Market;
  /** crypto: comma-separated CoinGecko ids. */
  ids?: string;
  vs?: string;
  /** flight: route + date. */
  origin?: string;
  destination?: string;
  departureDate?: string;
  returnDate?: string;
  adults?: string;
  cabin?: string;
  /** Opaque signed cursor from your previous /check. */
  cursor?: string;
}

export interface SnapshotItem {
  id: string;
  label: string;
  priceUsd: number;
  extra: Record<string, unknown>;
}

export interface Change {
  id: string;
  label: string;
  previousUsd: number | null;
  currentUsd: number;
  absUsd: number | null;
  pct: number | null;
  direction: Direction | "new";
}

export interface CheckResult {
  checkId: string;
  market: Market;
  /** Normalized watch key. A cursor is only valid for the same key. */
  watchKey: string;
  source: Source;
  live: boolean;
  observedAt: string;
  snapshot: {
    items: SnapshotItem[];
    /** Ids you asked for that the provider did not return. */
    missing: string[];
  };
  delta: {
    hasCursor: boolean;
    /** Why a supplied cursor was ignored, if it was. */
    cursorStatus: "none" | "applied" | "malformed" | "bad_signature" | "wrong_watch" | "unsupported_version";
    since: string | null;
    elapsedSeconds: number | null;
    changes: Change[];
    summary: {
      up: number;
      down: number;
      flat: number;
      new: number;
      biggestMoverId: string | null;
      biggestMovePct: number | null;
    } | null;
  };
  trend: {
    /** Direction of the basket since your cursor (or over 24h when no cursor and the provider reports it). */
    direction: Direction | "unknown";
    basis: "cursor" | "provider_24h" | "none";
    pct: number | null;
    note: string;
  };
  /** Pass this to your next /check to get the delta from right now. */
  cursor: string;
  notes: string[];
}

const round = (n: number, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;

// ---------------------------------------------------------------------------
// Watch keys
// ---------------------------------------------------------------------------

/**
 * A stable identifier for "the thing being watched". Cursors are scoped to it,
 * so a bitcoin cursor can never be compared against a JFK→LAX snapshot.
 */
export function watchKeyFor(q: CheckQuery): string {
  if (q.market === "crypto") {
    const ids = normalizeIds(q.ids ?? "").join(",");
    return `crypto:${ids}:${(q.vs ?? "usd").toLowerCase()}`;
  }
  const parts = [
    (q.origin ?? "").toUpperCase(),
    (q.destination ?? "").toUpperCase(),
    q.departureDate ?? "",
    q.returnDate ?? "",
    q.adults ?? "1",
    (q.cabin ?? "").toUpperCase(),
  ];
  return `flight:${parts.join("|")}`;
}

function normalizeIds(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, 25);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IATA_RE = /^[A-Za-z]{3}$/;

export function validateCheck(query: Record<string, unknown>): { error?: string; query?: CheckQuery } {
  const q = query as unknown as CheckQuery;
  if (q.market !== "crypto" && q.market !== "flight") {
    return { error: 'market must be "crypto" or "flight"' };
  }
  if (q.market === "crypto") {
    const ids = normalizeIds(q.ids ?? "");
    if (ids.length === 0) {
      return { error: 'ids is required for market=crypto (comma-separated CoinGecko ids, e.g. "bitcoin,ethereum")' };
    }
  } else {
    if (!IATA_RE.test(q.origin ?? "")) return { error: "origin must be a 3-letter IATA airport code" };
    if (!IATA_RE.test(q.destination ?? "")) return { error: "destination must be a 3-letter IATA airport code" };
    if (!DATE_RE.test(q.departureDate ?? "")) return { error: "departureDate must be YYYY-MM-DD" };
    if (q.returnDate && !DATE_RE.test(q.returnDate)) return { error: "returnDate must be YYYY-MM-DD" };
  }
  return { query: q };
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

interface SnapshotOutcome {
  items: SnapshotItem[];
  missing: string[];
  source: Source;
  live: boolean;
  notes: string[];
  /** Provider-reported 24h move for the basket, when available. */
  provider24hPct: number | null;
}

async function cryptoSnapshot(q: CheckQuery): Promise<SnapshotOutcome> {
  const ids = normalizeIds(q.ids ?? "");
  const vs = (q.vs ?? "usd").toLowerCase();
  const quotes = await fetchCoinPrices(ids, vs);
  const returned = new Set(quotes.map((c) => c.id));

  const changes = quotes.map((c) => c.change24hPct).filter((c): c is number => typeof c === "number");
  return {
    items: quotes.map((c) => ({
      id: c.id,
      label: c.id,
      priceUsd: c.priceUsd,
      extra: {
        vsCurrency: vs,
        marketCapUsd: c.marketCapUsd,
        volume24hUsd: c.volume24hUsd,
        change24hPct: c.change24hPct === null ? null : round(c.change24hPct, 4),
        lastUpdatedAt: c.lastUpdatedAt,
      },
    })),
    missing: ids.filter((id) => !returned.has(id)),
    source: "coingecko",
    live: true,
    notes:
      returned.size < ids.length
        ? ["Some ids were not recognized by CoinGecko — check them against /coins/list."]
        : [],
    provider24hPct: changes.length > 0 ? round(changes.reduce((a, b) => a + b, 0) / changes.length, 4) : null,
  };
}

async function flightSnapshot(q: CheckQuery): Promise<SnapshotOutcome> {
  const args = {
    origin: (q.origin ?? "").toUpperCase(),
    destination: (q.destination ?? "").toUpperCase(),
    departureDate: q.departureDate ?? "",
    returnDate: q.returnDate,
    adults: Number(q.adults ?? 1) || 1,
    cabin: q.cabin,
    max: 20,
  };

  const notes: string[] = [];
  let offers;
  let source: Source = "fixture";
  let live = false;

  if (amadeusConfigured()) {
    try {
      offers = await searchFlights(args);
      source = "amadeus";
      live = true;
    } catch (err) {
      notes.push(
        `Amadeus lookup failed (${err instanceof Error ? err.message : String(err)}) — fell back to deterministic fixtures.`,
      );
    }
  } else {
    notes.push("AMADEUS_CLIENT_ID/AMADEUS_CLIENT_SECRET unset — flight quotes are deterministic fixtures.");
  }
  if (!offers) offers = fixtureFlightQuotes(args);

  if (offers.length === 0) {
    return { items: [], missing: [], source, live, notes: [...notes, "No offers returned for that route and date."], provider24hPct: null };
  }

  // The watched price is the cheapest available fare; the cheapest nonstop is
  // tracked alongside it because "cheapest" and "cheapest you'd actually take"
  // move independently.
  const cheapest = offers.reduce((a, b) => (b.priceUsd < a.priceUsd ? b : a));
  const nonstops = offers.filter((o) => o.stops === 0);
  const cheapestNonstop = nonstops.length > 0 ? nonstops.reduce((a, b) => (b.priceUsd < a.priceUsd ? b : a)) : null;

  const items: SnapshotItem[] = [
    {
      id: "cheapest",
      label: `cheapest ${args.origin}→${args.destination} ${args.departureDate}`,
      priceUsd: round(cheapest.priceUsd, 2),
      extra: {
        carrier: cheapest.carrier,
        stops: cheapest.stops,
        departureAt: cheapest.departureAt,
        arrivalAt: cheapest.arrivalAt,
        duration: cheapest.durationIso,
        seatsRemaining: cheapest.seatsRemaining,
        offersScanned: offers.length,
      },
    },
  ];
  if (cheapestNonstop) {
    items.push({
      id: "cheapest_nonstop",
      label: `cheapest nonstop ${args.origin}→${args.destination} ${args.departureDate}`,
      priceUsd: round(cheapestNonstop.priceUsd, 2),
      extra: {
        carrier: cheapestNonstop.carrier,
        departureAt: cheapestNonstop.departureAt,
        arrivalAt: cheapestNonstop.arrivalAt,
        duration: cheapestNonstop.durationIso,
        seatsRemaining: cheapestNonstop.seatsRemaining,
      },
    });
  } else {
    notes.push("No nonstop offers on this route/date — only the cheapest overall fare is tracked.");
  }

  return { items, missing: [], source, live, notes, provider24hPct: null };
}

// ---------------------------------------------------------------------------
// Delta + trend
// ---------------------------------------------------------------------------

function directionOf(pct: number): Direction {
  if (pct > 0.0001) return "up";
  if (pct < -0.0001) return "down";
  return "flat";
}

function computeChanges(items: SnapshotItem[], previous: Record<string, number> | null): Change[] {
  return items.map((item) => {
    const prev = previous?.[item.id];
    if (prev === undefined || !Number.isFinite(prev) || prev === 0) {
      return {
        id: item.id,
        label: item.label,
        previousUsd: prev ?? null,
        currentUsd: item.priceUsd,
        absUsd: null,
        pct: null,
        direction: "new" as const,
      };
    }
    const absUsd = round(item.priceUsd - prev, 6);
    const pct = round((absUsd / prev) * 100, 4);
    return {
      id: item.id,
      label: item.label,
      previousUsd: prev,
      currentUsd: item.priceUsd,
      absUsd,
      pct,
      direction: directionOf(pct),
    };
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function check(q: CheckQuery): Promise<SignedArtifact<CheckResult>> {
  const watchKey = watchKeyFor(q);
  const observedAt = new Date().toISOString();

  const outcome = q.market === "crypto" ? await cryptoSnapshot(q) : await flightSnapshot(q);
  const notes = [...outcome.notes];

  // --- apply the caller's cursor ---
  let cursorStatus: CheckResult["delta"]["cursorStatus"] = "none";
  let previous: Record<string, number> | null = null;
  let since: string | null = null;

  if (q.cursor) {
    const decoded = decodeCursor(q.cursor, watchKey);
    if (decoded.ok) {
      cursorStatus = "applied";
      previous = decoded.payload.p;
      since = decoded.payload.t;
    } else {
      cursorStatus = decoded.reason;
      notes.push(
        decoded.reason === "wrong_watch"
          ? "The cursor you sent belongs to a different watch — deltas are omitted. Cursors are scoped to the exact market and parameters."
          : `Cursor rejected (${decoded.reason}) — deltas are omitted. Use the cursor from your previous /check verbatim.`,
      );
    }
  }

  const changes = computeChanges(outcome.items, previous);
  const priced = changes.filter((c) => c.pct !== null);
  const summary =
    previous === null
      ? null
      : {
          up: changes.filter((c) => c.direction === "up").length,
          down: changes.filter((c) => c.direction === "down").length,
          flat: changes.filter((c) => c.direction === "flat").length,
          new: changes.filter((c) => c.direction === "new").length,
          biggestMoverId:
            priced.length > 0
              ? priced.reduce((a, b) => (Math.abs(b.pct!) > Math.abs(a.pct!) ? b : a)).id
              : null,
          biggestMovePct:
            priced.length > 0 ? priced.reduce((a, b) => (Math.abs(b.pct!) > Math.abs(a.pct!) ? b : a)).pct : null,
        };

  const elapsedSeconds = since ? Math.max(0, Math.round((Date.parse(observedAt) - Date.parse(since)) / 1000)) : null;

  // --- trend ---
  let trend: CheckResult["trend"];
  if (priced.length > 0) {
    const avg = round(priced.reduce((sum, c) => sum + (c.pct ?? 0), 0) / priced.length, 4);
    trend = {
      direction: directionOf(avg),
      basis: "cursor",
      pct: avg,
      note: `Average move of ${priced.length} tracked item(s) since your cursor${elapsedSeconds !== null ? ` (${elapsedSeconds}s ago)` : ""}.`,
    };
  } else if (outcome.provider24hPct !== null) {
    trend = {
      direction: directionOf(outcome.provider24hPct),
      basis: "provider_24h",
      pct: outcome.provider24hPct,
      note: "No usable cursor, so the trend is CoinGecko's own 24h move averaged across the basket. Send the returned cursor next time for a delta measured from this exact snapshot.",
    };
  } else {
    trend = {
      direction: "unknown",
      basis: "none",
      pct: null,
      note: "First observation for this watch. Send the returned cursor on your next /check to get a delta.",
    };
  }

  const nextCursor = encodeCursor(
    watchKey,
    observedAt,
    Object.fromEntries(outcome.items.map((i) => [i.id, i.priceUsd])),
  );

  const result: CheckResult = {
    checkId: `chk_${randomBytes(8).toString("hex")}`,
    market: q.market,
    watchKey,
    source: outcome.source,
    live: outcome.live,
    observedAt,
    snapshot: { items: outcome.items, missing: outcome.missing },
    delta: { hasCursor: previous !== null, cursorStatus, since, elapsedSeconds, changes, summary },
    trend,
    cursor: nextCursor,
    notes,
  };

  return sign(result);
}

/** Stable short id for a watch key — handy for client-side bookkeeping. */
export function watchId(key: string): string {
  return `watch_${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}
