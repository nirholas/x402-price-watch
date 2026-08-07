// Fixture data — used when AMADEUS_CLIENT_ID/AMADEUS_CLIENT_SECRET are unset,
// or when the live Amadeus call fails.
//
// Crypto watches never use fixtures: CoinGecko's /simple/price endpoint is
// keyless, so market=crypto is always live.
//
// Flight fixtures drift deliberately. They are seeded by the route AND by the
// current 10-minute bucket, so consecutive polls return *slightly different*
// prices — which is the whole point of a price watch. Within one bucket the
// same request is reproducible.

import { createHash } from "node:crypto";
import type { FlightCandidate } from "./amadeus.js";

function seeded(seed: string, index: number): number {
  const digest = createHash("sha256").update(`${seed}:${index}`).digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000;
}

const CARRIERS = ["AA", "DL", "UA", "B6", "AS", "WN"];

/** Base fare implied by the route string alone — stable across polls. */
function baseFare(route: string): number {
  return 180 + Math.round(seeded(route, 0) * 520);
}

function addHours(iso: string, hours: number): string {
  const base = new Date(iso);
  if (Number.isNaN(base.getTime())) return iso;
  return new Date(base.getTime() + hours * 3_600_000).toISOString();
}

export function fixtureFlightQuotes(args: {
  origin: string;
  destination: string;
  departureDate: string;
  adults: number;
  cabin?: string;
}): FlightCandidate[] {
  const route = `${args.origin}|${args.destination}|${args.departureDate}|${args.adults}|${args.cabin ?? ""}`;
  // 10-minute bucket: the market "moves" between polls, but a retry inside the
  // same bucket is reproducible.
  const bucket = Math.floor(Date.now() / 600_000);
  const seed = `${route}:${bucket}`;
  const base = baseFare(route);
  const day = `${args.departureDate}T00:00:00Z`;

  return Array.from({ length: 6 }, (_, i) => {
    const drift = 0.9 + seeded(seed, i) * 0.35;
    const priceUsd = Math.round(base * drift * args.adults * 100) / 100;
    const departHour = 6 + Math.floor(seeded(route, i + 100) * 14);
    const durationHours = 2 + Math.floor(seeded(route, i + 200) * 6);
    const stops = seeded(route, i + 300) > 0.55 ? 1 : 0;
    const carrier = CARRIERS[Math.floor(seeded(route, i + 400) * CARRIERS.length)];
    const departureAt = addHours(day, departHour);
    const arrivalAt = addHours(departureAt, durationHours);
    return {
      id: `fixture_flight_${i}`,
      priceUsd,
      currency: "USD",
      carrier,
      stops,
      departureAt,
      arrivalAt,
      durationIso: `PT${durationHours}H`,
      seatsRemaining: 1 + Math.floor(seeded(seed, i + 500) * 8),
      cabin: args.cabin?.toUpperCase() ?? "ECONOMY",
      segments: [
        {
          from: args.origin,
          to: args.destination,
          departureAt,
          arrivalAt,
          carrier,
          number: String(100 + Math.floor(seeded(route, i + 600) * 899)),
        },
      ],
    };
  });
}
