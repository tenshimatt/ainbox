/**
 * AINBOX-18 — Microsoft Graph OAuth: real token exchange + refresh
 *
 * PRD §4.2 OAuth token storage — refresh tokens stored encrypted; access tokens
 *          minted in-memory only and never persisted.
 * PRD §3.9 Auth stack — Microsoft OAuth via Supabase Auth (Azure provider).
 * PRD §7.2 Provider OAuth — Microsoft.
 *
 * Exchanges the stored encrypted refresh token for a fresh Microsoft access
 * token. Must be called server-side only — never from the browser.
 *
 * If Microsoft issues a new refresh token (sliding-window rotation), the
 * returned `newEncryptedRefreshToken` must be persisted by the caller.
 *
 * Required env vars (server-side):
 *   AZURE_CLIENT_ID     — Azure app registration client ID
 *   AZURE_CLIENT_SECRET — Azure app registration client secret (never shipped to browser)
 */

import { decryptForUser, encryptForUser } from '@/lib/crypto';

const MS_TOKEN_ENDPOINT =
  'https://login.microsoftonline.com/common/oauth2/v2.0/token';

/** Scopes requested for Outlook access (must match the original consent). */
const MS_SCOPES = 'Mail.Read Mail.Send User.Read offline_access';

export interface MicrosoftTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  /** Present when Microsoft rotates the refresh token (sliding-window). */
  refresh_token?: string;
}

export interface RefreshResult {
  /** Fresh Microsoft access token — use for this request scope only, do not persist. */
  accessToken: string;
  /**
   * Re-encrypted refresh token, present only when Microsoft issued a new one.
   * Caller must persist this to `oauth_tokens.encrypted_refresh_token` to keep
   * the session alive.
   */
  newEncryptedRefreshToken?: string;
}

/**
 * Exchange an encrypted stored refresh token for a fresh Microsoft access token.
 *
 * @param encryptedRefreshToken - Ciphertext from `oauth_tokens.encrypted_refresh_token`
 * @param userId - Auth user ID (bound as AAD in AINBOX-5 crypto)
 */
export async function refreshMicrosoftToken(
  encryptedRefreshToken: string,
  userId: string,
): Promise<RefreshResult> {
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'AZURE_CLIENT_ID and AZURE_CLIENT_SECRET must be set (server env)',
    );
  }

  // Decrypt the stored refresh token in-memory. The key is per-user so a
  // ciphertext from another tenant cannot be decrypted here.
  const refreshToken = decryptForUser(userId, encryptedRefreshToken);

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: MS_SCOPES,
  });

  const res = await fetch(MS_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `microsoft_token_refresh_failed: HTTP ${res.status} — ${detail}`,
    );
  }

  const json = (await res.json()) as MicrosoftTokenResponse;
  if (!json.access_token) {
    throw new Error(
      'microsoft_token_refresh_failed: no access_token in response',
    );
  }

  const result: RefreshResult = { accessToken: json.access_token };

  // Microsoft may rotate the refresh token. Re-encrypt and surface it so the
  // caller can update storage and keep the session alive indefinitely.
  if (json.refresh_token) {
    result.newEncryptedRefreshToken = encryptForUser(userId, json.refresh_token);
  }

  return result;
}
