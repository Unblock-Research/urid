/**
 * did:ub multibase DID encode / decode helpers.
 *
 * Identifier format: did:ub:<base58btc-multibase-encoded(ed25519-pub-multicodec-header + publicKey)>
 *
 * The ed25519-pub multicodec code is 0xed (237).  Varint-encoded that is
 * [0xed, 0x01] — two bytes.  Prepending those to the 32-byte public key gives
 * a 34-byte buffer; base58btc multibase encoding (leading 'z') of that buffer
 * always starts with "z6Mk", matching did:key semantics under the did:ub method.
 *
 * multiformats v13 is pure ESM.  Under the CommonJS build target used by this
 * package the static top-level import is not supported at compile-time, so
 * base58btc is loaded via a dynamic import() that is cached at module scope.
 */

const DID_METHOD_PREFIX = 'did:ub:';

// Varint-encoded ed25519-pub multicodec header: varint(0xed) = [0xed, 0x01]
const ED25519_PUB_HEADER = new Uint8Array([0xed, 0x01]);

// Module-level cache for the base58btc codec (loaded once on first use)
let _base58btcCache: {
  encode: (bytes: Uint8Array) => string;
  decode: (str: string) => Uint8Array;
} | null = null;

async function getBase58Btc() {
  if (_base58btcCache) return _base58btcCache;
  const mod = await import('multiformats/bases/base58');
  _base58btcCache = mod.base58btc;
  return _base58btcCache;
}

/**
 * Encode an Ed25519 public key as a did:ub DID.
 *
 * @param publicKey  32-byte Ed25519 public key
 * @returns          "did:ub:z6Mk…" string
 */
export async function encodeDid(publicKey: Uint8Array): Promise<string> {
  const base58btc = await getBase58Btc();

  // [0xed, 0x01, ...publicKey] — 34 bytes total
  const payload = new Uint8Array(ED25519_PUB_HEADER.length + publicKey.length);
  payload.set(ED25519_PUB_HEADER, 0);
  payload.set(publicKey, ED25519_PUB_HEADER.length);

  // base58btc.encode returns a string with the 'z' multibase prefix
  const encoded = base58btc.encode(payload);
  return DID_METHOD_PREFIX + encoded;
}

/**
 * Decode a did:ub DID back to its raw 32-byte Ed25519 public key.
 *
 * Throws if:
 *   - the input does not start with "did:ub:"
 *   - the multibase remainder cannot be decoded
 *   - the first two decoded bytes are not the ed25519-pub multicodec header
 *
 * @param did  "did:ub:z6Mk…" string
 * @returns    32-byte Uint8Array (the original public key)
 */
export async function decodeDid(did: string): Promise<Uint8Array> {
  if (!did.startsWith(DID_METHOD_PREFIX)) {
    throw new Error(
      `Invalid DID: expected method "ub" but got "${did.slice(0, 20)}"`,
    );
  }

  const base58btc = await getBase58Btc();
  const multibaseStr = did.slice(DID_METHOD_PREFIX.length);

  let decoded: Uint8Array;
  try {
    decoded = base58btc.decode(multibaseStr);
  } catch (err) {
    throw new Error(`Invalid DID: base58btc decode failed — ${(err as Error).message}`);
  }

  if (
    decoded.length < ED25519_PUB_HEADER.length + 32 ||
    decoded[0] !== ED25519_PUB_HEADER[0] ||
    decoded[1] !== ED25519_PUB_HEADER[1]
  ) {
    throw new Error(
      'Invalid DID: multicodec header is not ed25519-pub (0xed 0x01)',
    );
  }

  return decoded.slice(ED25519_PUB_HEADER.length);
}
