/**
 * File: apps/web/src/server/calldata/crypto.ts
 * Purpose: Encrypts and decrypts synced call data (ADR-0049) with AES-256-GCM. The keys come from
 *          environment variables KITE_DATA_KEY_V1, KITE_DATA_KEY_V2, … (32 random bytes, base64),
 *          created by the developer with `vercel env add` and never stored in code, logs or chat.
 *          New data uses the highest version; each row records the version that encrypted it, so a
 *          new key can be added later without re-encrypting old rows at once.
 * Used by: src/server/calldata/store.ts
 * Depends on: node:crypto
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.1; ADR-0049
 *
 * Each ciphertext is bound to its row (account, kind, id, key version) as GCM additional data, so a
 * copied or moved ciphertext fails to decrypt instead of showing up in another account or record.
 * Losing a key makes the rows it encrypted unreadable: the developer keeps a copy in the company
 * password manager.
 */
import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** The cipher. */
const ALGORITHM = 'aes-256-gcm';

/** Bytes of the random IV per record (the size GCM is designed for). */
const IV_BYTES = 12;

/** Bytes of the authentication tag. */
const TAG_BYTES = 16;

/** Bytes of a key. */
const KEY_BYTES = 32;

/** The highest key version read from the environment (KITE_DATA_KEY_V1 … V<this>). */
const MAX_KEY_VERSION = 20;

/** The data keys: every version available, and the one new data uses. */
export interface DataKeys {
  /** The version new data is encrypted with (the highest one set). */
  current: number;
  /** Each version's key. */
  keys: ReadonlyMap<number, Buffer>;
}

/** Thrown when no usable data key is set; the sync routes answer 503 instead of storing anything. */
export class DataKeyError extends Error {
  /**
   * @param message What is wrong (names the variable, never its value).
   */
  constructor(message: string) {
    super(message);
    this.name = 'DataKeyError';
  }
}

/**
 * Reads the data keys from the environment.
 *
 * @param env The environment (default process.env; tests pass their own).
 * @returns The keys.
 * @throws DataKeyError when none is set, or one is not 32 bytes of base64.
 * Called from: dataKeys() below; tests
 */
export function loadDataKeys(env: Record<string, string | undefined> = process.env): DataKeys {
  const keys = new Map<number, Buffer>();
  for (let version = 1; version <= MAX_KEY_VERSION; version += 1) {
    const value = env[`KITE_DATA_KEY_V${version}`]?.trim();
    if (!value) continue;
    const key = Buffer.from(value, 'base64');
    // Never echo the value: only the variable's name.
    if (key.length !== KEY_BYTES) {
      throw new DataKeyError(`KITE_DATA_KEY_V${version} must be 32 bytes, base64-encoded.`);
    }
    keys.set(version, key);
  }
  if (keys.size === 0) throw new DataKeyError('KITE_DATA_KEY_V1 is not set.');
  return { current: Math.max(...keys.keys()), keys };
}

/** The keys, read once per server instance. */
let cached: DataKeys | null = null;

/**
 * The data keys for this server, read from the environment on first use.
 *
 * @returns The keys.
 * @throws DataKeyError as loadDataKeys().
 * Called from: src/server/calldata/api.ts
 */
export function dataKeys(): DataKeys {
  cached ??= loadDataKeys();
  return cached;
}

/** What a record's ciphertext is bound to. */
export interface RecordBinding {
  /** The owning account. */
  userId: string;
  /** The record's kind. */
  kind: string;
  /** The record's id. */
  id: string;
}

/**
 * The GCM additional data for a row: its account, kind, id and key version.
 *
 * @param binding The row.
 * @param version The key version.
 * @returns The bytes.
 */
function additionalData(binding: RecordBinding, version: number): Buffer {
  // JSON keeps the parts apart, so no id can be crafted to look like another row's binding.
  return Buffer.from(
    JSON.stringify(['kite-calldata', binding.userId, binding.kind, binding.id, version]),
  );
}

/**
 * Encrypts a record's JSON with the current key.
 *
 * @param keys      The data keys.
 * @param binding   The row the ciphertext belongs to.
 * @param plaintext The record as JSON.
 * @returns The key version and base64 of IV + tag + ciphertext.
 * Called from: store.ts (put, insert)
 */
export function seal(
  keys: DataKeys,
  binding: RecordBinding,
  plaintext: string,
): { keyVersion: number; content: string } {
  const version = keys.current;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keys.keys.get(version)!, iv);
  cipher.setAAD(additionalData(binding, version));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    keyVersion: version,
    content: Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64'),
  };
}

/**
 * Decrypts a record's content.
 *
 * @param keys       The data keys.
 * @param binding    The row the ciphertext belongs to.
 * @param keyVersion The version that encrypted it.
 * @param content    Base64 of IV + tag + ciphertext.
 * @returns The record as JSON.
 * @throws DataKeyError when that key version is not set; Error when the content was changed or
 *         belongs to another row (GCM authentication fails).
 * Called from: store.ts (conflicts, pulls, single reads)
 */
export function open(
  keys: DataKeys,
  binding: RecordBinding,
  keyVersion: number,
  content: string,
): string {
  const key = keys.keys.get(keyVersion);
  if (!key) throw new DataKeyError(`KITE_DATA_KEY_V${keyVersion} is not set.`);
  const bytes = Buffer.from(content, 'base64');
  const iv = bytes.subarray(0, IV_BYTES);
  const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(additionalData(binding, keyVersion));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString('utf8');
}
