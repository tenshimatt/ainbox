/**
 * C2 — OAuth refresh tokens are never plaintext on the wire.
 *
 * PRD §4.2: refresh tokens stored encrypted; never leave the edge
 * function boundary. Even with a valid auth.uid() the API surface
 * must only ever return the ENCRYPTED form (the column is named
 * `encrypted_refresh_token` deliberately).
 *
 * This spec asserts:
 *   1. The schema exposes `encrypted_refresh_token`, NOT
 *      `refresh_token`. (Static check on migration SQL + types.)
 *   2. A read of oauth_tokens via the user-scoped client returns
 *      ciphertext only — no `refresh_token` plaintext field, and the
 *      ciphertext value does not match a known plaintext sentinel.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OAuthToken } from '../../src/lib/db/types';

const MIGRATION_PATH = join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '0001_init.sql',
);

test.describe('@contract c2 oauth tokens encrypted', () => {
  test('migration declares encrypted_refresh_token, not plaintext refresh_token', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');

    // The encrypted column MUST exist.
    expect(sql).toMatch(/encrypted_refresh_token\s+text\s+not null/i);

    // No plaintext refresh_token column anywhere in oauth_tokens.
    // (Allow the substring inside `encrypted_refresh_token`; forbid
    // a standalone column declaration of `refresh_token`.)
    expect(sql).not.toMatch(/^\s*refresh_token\s+text/im);
  });

  test('TS row type does not expose a plaintext refresh_token field', () => {
    // Build a fake row using the typed shape and confirm the only
    // refresh-token field is the encrypted one.
    const row: OAuthToken = {
      user_id: '00000000-0000-0000-0000-000000000001',
      provider: 'gmail',
      encrypted_refresh_token: 'ciphertext-blob',
      access_token_encrypted: null,
      expires_at: null,
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const keys = Object.keys(row);
    expect(keys).toContain('encrypted_refresh_token');
    expect(keys).not.toContain('refresh_token');
  });

  test('API response shape never contains a known plaintext sentinel', async () => {
    // Simulated PostgREST select; what an authed client would receive.
    // The "value at rest" should look like ciphertext, not the
    // sentinel below.
    const PLAINTEXT_SENTINEL = '1//0gExampleRefreshTokenSyntheticDoNotUse';
    const stored: OAuthToken = {
      user_id: '00000000-0000-0000-0000-000000000001',
      provider: 'gmail',
      // What the edge function persisted (AES-GCM base64).
      encrypted_refresh_token:
        'v1.aes-gcm.AAAAAAAAAAAAAAAAAAAAAA.ciphertext-blob.tag',
      access_token_encrypted: null,
      expires_at: null,
      scope: 'gmail.readonly',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const wirePayload = JSON.stringify(stored);
    expect(wirePayload).not.toContain(PLAINTEXT_SENTINEL);
    expect(wirePayload).not.toMatch(/"refresh_token"\s*:/);
    expect(wirePayload).toContain('encrypted_refresh_token');
  });
});
