/**
 * TASKRESPONSE-5: AES-256-GCM per-user encryption helpers.
 *
 * PRD anchors:
 *   §4.2 OAuth token storage — refresh tokens stored encrypted (Supabase Vault in prod;
 *        this helper is the application-layer fallback / body encryption).
 *   §4.3 Email content handling — bodies encrypted at rest in `email_messages.body_encrypted`.
 *
 * Threat model:
 *   - Master key `TASKRESPONSE_ENC_MASTER_KEY` lives only in the edge-function / server runtime
 *     (Supabase secrets, Vercel server env). Never shipped to the browser.
 *   - Per-user data key derived via HKDF-SHA256(master, salt=user_id). This means a leak of
 *     a single ciphertext never directly exposes the master, and tenants are cryptographically
 *     scoped (an attacker with another tenant's user_id cannot decrypt this tenant's bodies
 *     without also having the master).
 *   - AES-256-GCM provides confidentiality + integrity. We bind `user_id` as AAD so a
 *     ciphertext copy-pasted across tenant rows cannot be decrypted under the wrong key.
 *
 * Output format: a versioned, opaque string `v1.<iv_b64>.<tag_b64>.<ct_b64>` so we can
 * rotate algorithms later without a column-type migration.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const KEY_LEN = 32; // 256-bit
const IV_LEN = 12; // GCM standard
const TAG_LEN = 16;

function getMasterKey(): Buffer {
  const raw = process.env.TASKRESPONSE_ENC_MASTER_KEY;
  if (!raw || raw.length < 32) {
    throw new Error('TASKRESPONSE_ENC_MASTER_KEY must be set to a base64 or hex string of >=32 bytes');
  }
  // Accept hex, base64, or raw — normalise to a Buffer of >=32 bytes.
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0) {
    return Buffer.from(raw, 'hex');
  }
  try {
    const b = Buffer.from(raw, 'base64');
    if (b.length >= KEY_LEN) return b;
  } catch {
    /* fallthrough */
  }
  return Buffer.from(raw, 'utf8');
}

/**
 * Derive a per-user 256-bit key from the master via HKDF-SHA256.
 * `userId` acts as the salt — same user always derives the same key.
 */
function deriveUserKey(userId: string): Buffer {
  const master = getMasterKey();
  // hkdfSync returns ArrayBuffer; wrap in Buffer for convenience.
  const okm = hkdfSync('sha256', master, Buffer.from(userId, 'utf8'), Buffer.from('taskresponse-v1'), KEY_LEN);
  return Buffer.from(okm);
}

/**
 * Encrypt `plaintext` for `userId`. Returns an opaque `v1.<iv>.<tag>.<ct>` string.
 *
 * The `userId` is bound as AAD so ciphertexts are not portable across tenant rows.
 */
export function encryptForUser(userId: string, plaintext: string): string {
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error('encryptForUser: userId required');
  }
  const key = deriveUserKey(userId);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  cipher.setAAD(Buffer.from(userId, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

/**
 * Decrypt a value previously produced by `encryptForUser` for the same `userId`.
 * Throws on tampering, wrong user, or unknown version.
 */
export function decryptForUser(userId: string, payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('decryptForUser: unknown ciphertext format');
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const key = deriveUserKey(userId);
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  decipher.setAAD(Buffer.from(userId, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Test predicate: is a string a v1 ciphertext envelope from `encryptForUser`? */
export function isCiphertext(value: string): boolean {
  return typeof value === 'string' && value.startsWith(`${VERSION}.`) && value.split('.').length === 4;
}
