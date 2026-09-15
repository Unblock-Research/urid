/**
 * did-sig.ts — parsing and canonicalisation for DIDSig request authentication.
 *
 * Pure functions only: no NestJS, no Prisma, no I/O. A client can import this
 * module verbatim to produce signatures, which is the point — the signed bytes
 * must be constructed identically on both sides or every request fails.
 *
 * WIRE FORMAT
 *   Authorization: DIDSig did="did:ub:z6Mk…",ts="1757900000",nonce="a3f2…",sig="<base64>"
 *
 * SIGNED MESSAGE (UTF-8, literal \n separators)
 *   METHOD \n path \n sha256hex(rawBody) \n ts \n nonce
 *
 * Every component is there for a reason:
 *   METHOD + path  — stop a signature captured on a read being replayed onto a
 *                    write, or against a different resource. `path` is the full
 *                    request target including any query string, so filters and
 *                    pagination parameters cannot be swapped after signing.
 *   body hash      — binds the exact request body. Hashing rather than signing
 *                    the body keeps the signed message a fixed size.
 *   ts             — bounds how long a captured request stays usable.
 *   nonce          — makes each signature single-use within that window; the
 *                    server records it and rejects a second appearance.
 *
 * ts and nonce are inside the signed bytes, so neither can be altered to dodge
 * the freshness or replay checks without invalidating the signature.
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

/** Authorization scheme token (compared case-insensitively). */
export const DIDSIG_SCHEME = 'DIDSig';

/** How far a request timestamp may sit from server time, in seconds. */
export const DEFAULT_MAX_SKEW_SECONDS = 120;

/** Parsed components of a DIDSig Authorization header. */
export interface DidSigHeader {
  /** Signer's DID, e.g. "did:ub:z6Mk…". */
  did: string;
  /** Unix timestamp in SECONDS, as sent. */
  ts: number;
  /** Single-use token, 8–128 chars of [A-Za-z0-9_-]. */
  nonce: string;
  /** Raw 64-byte Ed25519 signature. */
  signature: Uint8Array;
}

/** Why a header was rejected. Kept coarse — never echo attacker-controlled input. */
export type DidSigParseError =
  | 'missing'
  | 'wrong-scheme'
  | 'malformed'
  | 'bad-timestamp'
  | 'bad-nonce'
  | 'bad-signature';

export type DidSigParseResult =
  | { ok: true; value: DidSigHeader }
  | { ok: false; error: DidSigParseError };

/** Extract key="value" pairs, tolerating whitespace around separators. */
function parseParams(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z][A-Za-z0-9_-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

/** Decode standard base64 to bytes, returning null on malformed input. */
function base64ToBytes(b64: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  try {
    const buf = Buffer.from(b64, 'base64');
    // Buffer.from is lenient; round-trip to reject silently-truncated input.
    if (buf.toString('base64').replace(/=+$/, '') !== b64.replace(/=+$/, '')) {
      return null;
    }
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/**
 * Parse an Authorization header value into its DIDSig components.
 *
 * Validates shape only — it does not check the signature, the clock, or whether
 * the DID exists. Those are the guard's job.
 */
export function parseDidSigHeader(
  header: string | undefined | null,
): DidSigParseResult {
  if (typeof header !== 'string' || header.trim() === '') {
    return { ok: false, error: 'missing' };
  }

  const trimmed = header.trim();
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx < 0) return { ok: false, error: 'wrong-scheme' };

  const scheme = trimmed.slice(0, spaceIdx);
  if (scheme.toLowerCase() !== DIDSIG_SCHEME.toLowerCase()) {
    return { ok: false, error: 'wrong-scheme' };
  }

  const params = parseParams(trimmed.slice(spaceIdx + 1));
  const { did, ts, nonce, sig } = params;
  if (!did || !ts || !nonce || !sig) return { ok: false, error: 'malformed' };

  // DID: shape-checked here; decoded to a public key by the caller.
  if (!did.startsWith('did:ub:') || did.length > 200) {
    return { ok: false, error: 'malformed' };
  }

  // Timestamp: plain integer seconds. Reject anything else outright rather than
  // letting Number() coerce "1e9" or " 12 " into something surprising.
  if (!/^\d{1,15}$/.test(ts)) return { ok: false, error: 'bad-timestamp' };
  const tsNum = Number(ts);
  if (!Number.isSafeInteger(tsNum)) return { ok: false, error: 'bad-timestamp' };

  // Nonce: bounded and charset-restricted so it is safe to store and index.
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(nonce)) {
    return { ok: false, error: 'bad-nonce' };
  }

  const signature = base64ToBytes(sig);
  if (!signature || signature.length !== 64) {
    return { ok: false, error: 'bad-signature' };
  }

  return { ok: true, value: { did, ts: tsNum, nonce, signature } };
}

/** SHA-256 of raw bytes as lowercase hex. Empty input hashes to e3b0c442…. */
export function sha256Hex(body: Uint8Array | Buffer | undefined | null): string {
  const bytes =
    body == null
      ? new Uint8Array(0)
      : body instanceof Uint8Array
        ? body
        : new Uint8Array(body);
  return bytesToHex(sha256(bytes));
}

/**
 * Build the exact bytes a client signs and the server verifies.
 *
 * @param method    HTTP method; upper-cased so casing cannot split the two sides.
 * @param path      Full request target including query string (e.g. "/api/zk/prove").
 * @param bodyHash  sha256Hex of the raw request body ("" body for GET/DELETE).
 * @param ts        Unix timestamp in seconds, exactly as sent in the header.
 * @param nonce     Nonce, exactly as sent in the header.
 */
export function buildSignedMessage(
  method: string,
  path: string,
  bodyHash: string,
  ts: number | string,
  nonce: string,
): Uint8Array {
  const message = [
    method.toUpperCase(),
    path,
    bodyHash,
    String(ts),
    nonce,
  ].join('\n');
  return new TextEncoder().encode(message);
}

/**
 * Is `ts` within `maxSkewSeconds` of `nowSeconds`?
 *
 * Symmetric: a future-dated timestamp is as suspect as a stale one, and allowing
 * it would let a captured request stay usable far beyond the window.
 */
export function isTimestampFresh(
  ts: number,
  nowSeconds: number,
  maxSkewSeconds: number = DEFAULT_MAX_SKEW_SECONDS,
): boolean {
  return Math.abs(nowSeconds - ts) <= maxSkewSeconds;
}
