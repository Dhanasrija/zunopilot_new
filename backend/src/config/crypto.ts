import crypto from 'node:crypto';
import { env } from './env.js';

// Encryption for integration credentials at rest.
//
// Connectors are the point where tenants hand us *their* secrets — an LMS API
// key, a CRM token. Those are not ours to store in plaintext the way the
// inherited `WhatsappAccount.accessToken` is, so everything written through
// here is sealed first.
//
// AES-256-GCM, because authenticated encryption means a tampered ciphertext
// fails to decrypt rather than decrypting to something attacker-chosen. The
// stored form carries its version, so a future key rotation or algorithm change
// can recognise old values instead of guessing.

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12; // 96 bits, the GCM standard — never reused with one key.
const KEY_BYTES = 32;

export class MissingEncryptionKeyError extends Error {
  constructor() {
    super(
      'ENCRYPTION_KEY is not set, so integration credentials cannot be stored. '
      + 'Generate one with: openssl rand -base64 32',
    );
    this.name = 'MissingEncryptionKeyError';
  }
}

export class DecryptionFailedError extends Error {
  constructor(reason: string) {
    super(`Could not decrypt a stored secret: ${reason}`);
    this.name = 'DecryptionFailedError';
  }
}

/**
 * The key, derived once and cached.
 *
 * Accepts base64 or hex, and requires exactly 32 bytes — a short key is not
 * silently padded, because a padded key looks like it works and halves the
 * strength of everything encrypted with it.
 */
let cachedKey: Buffer | null = null;

const key = (): Buffer => {
  if (cachedKey) return cachedKey;

  // `process.env` first, `env` second. The env module snapshots values at
  // import time, which is right for everything else but wrong here: a key
  // rotation (and every test that exercises one) changes the variable after
  // that snapshot was taken.
  const raw = process.env.ENCRYPTION_KEY || env.encryptionKey;
  if (!raw) throw new MissingEncryptionKeyError();

  const decoded = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');

  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${decoded.length}. `
      + 'Generate one with: openssl rand -base64 32',
    );
  }

  cachedKey = decoded;
  return decoded;
};

/** True when secrets can be stored at all. Checked before offering the UI. */
export const encryptionAvailable = (): boolean => {
  try {
    key();
    return true;
  } catch {
    return false;
  }
};

/** Seal a value. Output is `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
export const encryptSecret = (plaintext: string): string => {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
  const sealed = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    sealed.toString('base64url'),
  ].join('.');
};

/** Open a sealed value. Throws rather than returning a partial result. */
export const decryptSecret = (stored: string): string => {
  const [version, iv, tag, payload] = stored.split('.');
  if (version !== VERSION || !iv || !tag || !payload) {
    throw new DecryptionFailedError('unrecognised format');
  }

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(payload, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch (err) {
    // A GCM tag mismatch means the ciphertext or the key is wrong. Either way
    // the useful signal is "this secret is unusable", not the raw crypto error.
    throw new DecryptionFailedError(
      err instanceof Error && err.message.includes('auth') ? 'wrong key or tampered value' : 'malformed value',
    );
  }
};

/**
 * What a secret looks like to anyone reading it back through the API.
 *
 * Secrets are write-only from the outside: an operator can replace one, never
 * retrieve it. This is what the UI shows instead.
 */
export const maskSecret = (plaintext: string): string => {
  if (plaintext.length <= 4) return '••••';
  return `••••${plaintext.slice(-4)}`;
};

/** Only for tests that need to reset after changing the env. */
export const resetKeyCache = (): void => { cachedKey = null; };
