// The cursor: the client's memory, carried in the client's hands.
//
// This service is stateless. Rather than keeping a watch history server-side
// (which would mean accounts, retention, and a database), each /check response
// hands back a compact **signed cursor** encoding the prices you just saw. Send
// it on your next /check and the response includes the delta since then.
//
// The cursor is opaque but not secret — it is base64url JSON plus an HMAC, so
// it cannot be forged into a fake "previous price", and anyone holding it can
// decode their own price history. Nothing about the payer is in it.

import { canonicalize, sign, verify } from "./sign.js";

/** Cursor version. Bumped if the payload shape changes incompatibly. */
const CURSOR_VERSION = 1;

export interface CursorPayload {
  v: number;
  /** Watch key — the normalized market + parameters. A cursor is only valid for the same watch. */
  k: string;
  /** ISO timestamp of the snapshot this cursor encodes. */
  t: string;
  /** id → price at that moment. */
  p: Record<string, number>;
}

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function fromBase64Url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

/** Encode a snapshot into an opaque, signed, self-describing cursor string. */
export function encodeCursor(key: string, observedAt: string, prices: Record<string, number>): string {
  const payload: CursorPayload = { v: CURSOR_VERSION, k: key, t: observedAt, p: prices };
  const { signature } = sign(payload);
  return `${toBase64Url(canonicalize(payload))}.${signature}`;
}

export type CursorResult =
  | { ok: true; payload: CursorPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "wrong_watch" | "unsupported_version" };

/**
 * Decode and authenticate a cursor. `expectedKey` guards against comparing a
 * bitcoin snapshot to a flight snapshot — a cursor is scoped to one watch.
 */
export function decodeCursor(cursor: string, expectedKey: string): CursorResult {
  const dot = cursor.lastIndexOf(".");
  if (dot <= 0) return { ok: false, reason: "malformed" };

  const encoded = cursor.slice(0, dot);
  const signature = cursor.slice(dot + 1);

  let payload: CursorPayload;
  try {
    payload = JSON.parse(fromBase64Url(encoded)) as CursorPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!payload || typeof payload !== "object" || typeof payload.k !== "string" || typeof payload.t !== "string") {
    return { ok: false, reason: "malformed" };
  }
  if (payload.v !== CURSOR_VERSION) return { ok: false, reason: "unsupported_version" };
  if (!verify({ payload, signature })) return { ok: false, reason: "bad_signature" };
  if (payload.k !== expectedKey) return { ok: false, reason: "wrong_watch" };

  return { ok: true, payload };
}
