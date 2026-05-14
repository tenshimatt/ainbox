/**
 * Provider draft creation — placeholder for TASKRESPONSE-10.
 *
 * The real implementations of Gmail draft + MS Graph draft are
 * scoped to TASKRESPONSE-5 / TASKRESPONSE-6 sync libs and have not landed yet.
 * This module exposes a stable signature so the drafting worker
 * (src/lib/draft/draft.ts) and the API route (src/app/api/drafts)
 * can call it today and be wired to the real provider calls later.
 *
 * PRD: §7.10 Reply drafting — "Store as a Gmail/Outlook draft via the
 * API + locally." This helper is the API-side piece.
 */

export type EmailProvider = 'gmail' | 'outlook';

export interface ProviderDraftResult {
  provider_draft_id: string;
  provider: EmailProvider;
  /** Set true once the real provider call replaces this placeholder. */
  is_placeholder: boolean;
}

/**
 * Create a draft at the user's email provider.
 *
 * Placeholder behaviour: returns a deterministic-ish fake id so the
 * outer flow (persist row, return JSON) can be exercised end-to-end
 * without an outbound network call. The real implementation will
 * delegate to a Gmail or MS Graph client built in TASKRESPONSE-5/6.
 */
export async function createProviderDraft(
  userId: string,
  provider: EmailProvider,
  body: string,
): Promise<ProviderDraftResult> {
  if (!userId) throw new Error('createProviderDraft: userId required');
  if (provider !== 'gmail' && provider !== 'outlook') {
    throw new Error(`createProviderDraft: unsupported provider "${provider}"`);
  }
  if (typeof body !== 'string' || body.length === 0) {
    throw new Error('createProviderDraft: body required');
  }

  // Stable-ish fake id — userId prefix + provider + short hash of body length.
  const fakeId = `placeholder-${provider}-${userId.slice(0, 8)}-${body.length}`;
  return {
    provider_draft_id: fakeId,
    provider,
    is_placeholder: true,
  };
}
