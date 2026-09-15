/**
 * did-sig.spec.ts — DIDSig header parsing and canonical message construction.
 *
 * These are the bytes both sides must agree on. Every assertion here is really a
 * statement about the wire contract: if one of them changes, existing clients
 * stop being able to sign requests this server will accept.
 */

import { describe, it, expect } from 'vitest';

import {
  DEFAULT_MAX_SKEW_SECONDS,
  buildSignedMessage,
  isTimestampFresh,
  parseDidSigHeader,
  sha256Hex,
} from './did-sig';

const VALID_DID = 'did:ub:z6MkvzfFyj1kfkgDURK94niA399F4yiKU89y1hakav5UT4Kw';
const VALID_NONCE = 'a3f2c1d4e5b60789';
const VALID_SIG = Buffer.alloc(64, 7).toString('base64');

function header(overrides: Record<string, string> = {}) {
  const parts = {
    did: VALID_DID,
    ts: '1757900000',
    nonce: VALID_NONCE,
    sig: VALID_SIG,
    ...overrides,
  };
  return `DIDSig did="${parts.did}",ts="${parts.ts}",nonce="${parts.nonce}",sig="${parts.sig}"`;
}

describe('parseDidSigHeader', () => {
  it('parses a well-formed header', () => {
    const r = parseDidSigHeader(header()) as any;
    expect(r.ok).toBe(true);
    expect(r.value.did).toBe(VALID_DID);
    expect(r.value.ts).toBe(1757900000);
    expect(r.value.nonce).toBe(VALID_NONCE);
    expect(r.value.signature).toHaveLength(64);
  });

  it('accepts the scheme case-insensitively', () => {
    expect(parseDidSigHeader(header().replace('DIDSig', 'didsig')).ok).toBe(true);
    expect(parseDidSigHeader(header().replace('DIDSig', 'DIDSIG')).ok).toBe(true);
  });

  it('tolerates whitespace around parameter separators', () => {
    const h = `DIDSig did = "${VALID_DID}" , ts = "1757900000" , nonce = "${VALID_NONCE}" , sig = "${VALID_SIG}"`;
    expect(parseDidSigHeader(h).ok).toBe(true);
  });

  it('reports a missing header distinctly from a malformed one', () => {
    for (const v of [undefined, null, '', '   ']) {
      const r = parseDidSigHeader(v as string | undefined) as any;
      expect(r.ok).toBe(false);
      expect(r.error).toBe('missing');
    }
  });

  it('rejects a non-DIDSig scheme — a Bearer token is not a signature', () => {
    const r = parseDidSigHeader('Bearer eyJhbGciOiJIUzI1NiJ9.abc.def') as any;
    expect(r.ok).toBe(false);
    expect(r.error).toBe('wrong-scheme');
  });

  it('rejects a header missing any required parameter', () => {
    const base = { did: VALID_DID, ts: '1757900000', nonce: VALID_NONCE, sig: VALID_SIG };
    for (const omit of ['did', 'ts', 'nonce', 'sig'] as const) {
      const parts = { ...base };
      delete (parts as Record<string, string>)[omit];
      const h =
        'DIDSig ' +
        Object.entries(parts)
          .map(([k, v]) => `${k}="${v}"`)
          .join(',');
      const r = parseDidSigHeader(h);
      expect(r.ok, `expected rejection when ${omit} is absent`).toBe(false);
    }
  });

  it('rejects a DID that is not did:ub', () => {
    expect(parseDidSigHeader(header({ did: 'did:key:z6Mkabc' })).ok).toBe(false);
  });

  describe('timestamp', () => {
    it('rejects non-integer forms rather than coercing them', () => {
      // Number('1e9') and Number(' 12 ') both "work" — which is exactly why the
      // parser must not use Number() as its validator.
      for (const ts of ['1e9', ' 12 ', '17579000.5', '-1757900000', 'abc', '']) {
        expect(parseDidSigHeader(header({ ts })).ok, `ts=${ts}`).toBe(false);
      }
    });

    it('bounds the digit count, so no timestamp can reach the unsafe-integer range', () => {
      // 15 digits is ~1e15, comfortably inside Number.MAX_SAFE_INTEGER (~9.0e15),
      // so the length cap — not the safe-integer check — is what rejects absurd
      // values. The safe-integer guard is belt-and-braces behind it.
      expect(parseDidSigHeader(header({ ts: '9'.repeat(15) })).ok).toBe(true);
      expect(parseDidSigHeader(header({ ts: '9'.repeat(16) })).ok).toBe(false);
    });
  });

  describe('nonce', () => {
    it('rejects one that is too short to be unguessable', () => {
      expect(parseDidSigHeader(header({ nonce: 'abc123' })).ok).toBe(false);
    });

    it('rejects one longer than the bound', () => {
      expect(parseDidSigHeader(header({ nonce: 'a'.repeat(129) })).ok).toBe(false);
    });

    it('rejects characters outside [A-Za-z0-9_-]', () => {
      for (const nonce of ['abcdefgh!', 'abcdefg h', "abcdefg'h", 'abcdefg/h']) {
        expect(parseDidSigHeader(header({ nonce })).ok, nonce).toBe(false);
      }
    });
  });

  describe('signature', () => {
    it('rejects a signature that is not 64 bytes', () => {
      expect(
        parseDidSigHeader(header({ sig: Buffer.alloc(32, 1).toString('base64') })).ok,
      ).toBe(false);
      expect(
        parseDidSigHeader(header({ sig: Buffer.alloc(65, 1).toString('base64') })).ok,
      ).toBe(false);
    });

    it('rejects non-base64 input instead of silently truncating it', () => {
      // Buffer.from(..., 'base64') is lenient and would happily drop junk.
      expect(parseDidSigHeader(header({ sig: 'not base64!!' })).ok).toBe(false);
    });
  });
});

describe('sha256Hex', () => {
  it('hashes an absent body to the empty-string digest', () => {
    const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    expect(sha256Hex(undefined)).toBe(EMPTY);
    expect(sha256Hex(null)).toBe(EMPTY);
    expect(sha256Hex(Buffer.alloc(0))).toBe(EMPTY);
  });

  it('agrees between Buffer and Uint8Array inputs', () => {
    const bytes = Buffer.from('{"a":1}', 'utf8');
    expect(sha256Hex(bytes)).toBe(sha256Hex(new Uint8Array(bytes)));
  });

  it('distinguishes byte-level differences that JSON.parse would erase', () => {
    // Whitespace and key order do not survive a parse/re-serialise round trip,
    // which is why the guard hashes req.rawBody rather than the parsed object.
    expect(sha256Hex(Buffer.from('{"a":1}'))).not.toBe(
      sha256Hex(Buffer.from('{ "a": 1 }')),
    );
    expect(sha256Hex(Buffer.from('{"a":1,"b":2}'))).not.toBe(
      sha256Hex(Buffer.from('{"b":2,"a":1}')),
    );
  });
});

describe('buildSignedMessage', () => {
  const decode = (b: Uint8Array) => new TextDecoder().decode(b);

  it('joins the five components with newlines in a fixed order', () => {
    const msg = decode(buildSignedMessage('POST', '/api/zk/prove', 'abc123', 42, 'n0nce123'));
    expect(msg).toBe('POST\n/api/zk/prove\nabc123\n42\nn0nce123');
  });

  it('upper-cases the method so casing cannot split the two sides', () => {
    expect(decode(buildSignedMessage('post', '/x', 'h', 1, 'n'))).toBe(
      decode(buildSignedMessage('POST', '/x', 'h', 1, 'n')),
    );
  });

  it('accepts ts as a number or string identically', () => {
    expect(decode(buildSignedMessage('GET', '/x', 'h', 1757900000, 'n'))).toBe(
      decode(buildSignedMessage('GET', '/x', 'h', '1757900000', 'n')),
    );
  });

  it('binds the method — a GET signature does not transfer to a POST', () => {
    expect(decode(buildSignedMessage('GET', '/x', 'h', 1, 'n'))).not.toBe(
      decode(buildSignedMessage('POST', '/x', 'h', 1, 'n')),
    );
  });

  it('binds the path, including its query string', () => {
    expect(decode(buildSignedMessage('GET', '/x?a=1', 'h', 1, 'n'))).not.toBe(
      decode(buildSignedMessage('GET', '/x?a=2', 'h', 1, 'n')),
    );
  });
});

describe('isTimestampFresh', () => {
  const NOW = 1_757_900_000;

  it('accepts a timestamp inside the window', () => {
    expect(isTimestampFresh(NOW, NOW)).toBe(true);
    expect(isTimestampFresh(NOW - DEFAULT_MAX_SKEW_SECONDS, NOW)).toBe(true);
    expect(isTimestampFresh(NOW + DEFAULT_MAX_SKEW_SECONDS, NOW)).toBe(true);
  });

  it('rejects a stale timestamp', () => {
    expect(isTimestampFresh(NOW - DEFAULT_MAX_SKEW_SECONDS - 1, NOW)).toBe(false);
  });

  it('rejects a future-dated timestamp — the window is symmetric', () => {
    // An unbounded future timestamp would let a captured request stay usable
    // indefinitely, defeating the point of the freshness check.
    expect(isTimestampFresh(NOW + DEFAULT_MAX_SKEW_SECONDS + 1, NOW)).toBe(false);
    expect(isTimestampFresh(NOW + 86_400, NOW)).toBe(false);
  });

  it('honours a custom skew', () => {
    expect(isTimestampFresh(NOW - 10, NOW, 5)).toBe(false);
    expect(isTimestampFresh(NOW - 10, NOW, 30)).toBe(true);
  });
});
