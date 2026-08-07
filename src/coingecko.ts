// CoinGecko adapter — keyless and live by default.
//
// The public /simple/price endpoint needs no API key, so crypto watches are
// always real. Set COINGECKO_API_KEY to use a demo/pro key (higher rate limits);
// the request shape is otherwise identical.

const BASE_URL = (process.env.COINGECKO_BASE_URL ?? "https://api.coingecko.com/api/v3").replace(/\/$/, "");
const TIMEOUT_MS = 10_000;

export interface CoinQuote {
  id: string;
  priceUsd: number;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  /** CoinGecko's own 24h percentage move — a trend signal independent of your cursor. */
  change24hPct: number | null;
  lastUpdatedAt: string | null;
}

interface SimplePriceResponse {
  [id: string]: {
    [key: string]: number | undefined;
  };
}

/** Live spot prices for up to 25 CoinGecko coin ids. */
export async function fetchCoinPrices(ids: string[], vsCurrency = "usd"): Promise<CoinQuote[]> {
  const vs = vsCurrency.toLowerCase();
  const params = new URLSearchParams({
    ids: ids.join(","),
    vs_currencies: vs,
    include_market_cap: "true",
    include_24hr_vol: "true",
    include_24hr_change: "true",
    include_last_updated_at: "true",
  });

  const headers: Record<string, string> = { accept: "application/json" };
  const key = process.env.COINGECKO_API_KEY;
  if (key) headers["x-cg-demo-api-key"] = key;

  const res = await fetch(`${BASE_URL}/simple/price?${params}`, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`CoinGecko /simple/price returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const body = (await res.json()) as SimplePriceResponse;

  const out: CoinQuote[] = [];
  for (const id of ids) {
    const entry = body[id];
    if (!entry || typeof entry[vs] !== "number") continue; // unknown id — omitted, reported in `missing`
    out.push({
      id,
      priceUsd: entry[vs] as number,
      marketCapUsd: entry[`${vs}_market_cap`] ?? null,
      volume24hUsd: entry[`${vs}_24h_vol`] ?? null,
      change24hPct: entry[`${vs}_24h_change`] ?? null,
      lastUpdatedAt: entry.last_updated_at ? new Date(entry.last_updated_at * 1000).toISOString() : null,
    });
  }
  return out;
}
