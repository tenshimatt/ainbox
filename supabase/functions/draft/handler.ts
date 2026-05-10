/**
 * Edge function HTTP handler — AINBOX-29: §7.10 Reply drafting (edge function).
 *
 * PRD: §7.10 Reply drafting
 *      §4.4  Confidence model
 *
 * Pure handler over injected deps — no Deno-specific APIs so this module
 * can be imported and tested from Node.js via Playwright, while the Deno
 * entry point (index.ts) wires up the real Supabase client and LiteLLM.
 *
 * Categories excluded from drafting per PRD §7.10:
 *   spam, escalation, urgent
 */

/** Categories that must not receive an auto-draft (PRD §7.10). */
export const SKIP_CATEGORIES = new Set(['spam', 'escalation', 'urgent']);

// ---- Shared types -------------------------------------------------------

export interface EmailRow {
  id: string;
  user_id: string;
  subject: string | null;
  body: string | null;
  from_address: string | null;
  category: string | null;
  provider: string | null;
}

export interface DraftResult {
  body: string;
  retrieval_score: number;
  generation_score: number;
  confidence: number;
  kb_items_used: string[];
}

export interface ProviderDraftResult {
  provider_draft_id: string;
  is_placeholder: boolean;
}

export interface AuditEntry {
  user_id: string;
  action: string;
  email_id: string;
  draft_id: string;
  metadata: Record<string, unknown>;
}

/**
 * Injectable dependencies. Production wiring is in index.ts.
 * Tests inject mocks to run without network or DB.
 */
export interface HandlerDeps {
  /** Verify the JWT and return the authenticated user id, or null. */
  getUser: (jwt: string) => Promise<{ id: string } | null>;
  /** Load an email row by id, scoped to userId (RLS enforced). */
  getEmail: (userId: string, emailId: string) => Promise<EmailRow | null>;
  /** Run the reply-drafting worker (KB retrieval + LLM call + scoring). */
  draftFn: (email: {
    id: string;
    user_id: string;
    subject: string;
    body: string;
    from?: string;
    category?: string;
  }) => Promise<DraftResult>;
  /** Persist a new draft row; return its generated id. */
  insertDraft: (row: {
    user_id: string;
    email_id: string;
    body: string;
    retrieval_score: number;
    generation_score: number;
    confidence: number;
    kb_items_used: string[];
    status: string;
  }) => Promise<{ id: string }>;
  /** Update draft row with the provider-side draft id. */
  updateDraftProvider: (draftId: string, providerDraftId: string) => Promise<void>;
  /** Create a draft at the email provider (placeholder until AINBOX-5/6). */
  createProviderDraft: (
    userId: string,
    provider: 'gmail' | 'outlook',
    body: string,
  ) => Promise<ProviderDraftResult>;
  /** Append an audit_log row — metadata only, NO email body. */
  logAudit: (entry: AuditEntry) => Promise<void>;
}

// ---- Helper -------------------------------------------------------------

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---- Handler ------------------------------------------------------------

/**
 * Handle a POST /functions/v1/draft request.
 *
 * Flow (PRD §7.10):
 *  1. Auth via Authorization: Bearer <jwt>.
 *  2. Parse + validate { email_id }.
 *  3. Load the inbound email row (RLS enforced by getEmail dep).
 *  4. Skip spam / escalation / urgent.
 *  5. Run the draft worker (draftFn dep).
 *  6. Persist draft row.
 *  7. Create provider-side draft (placeholder — AINBOX-5/6 will replace).
 *  8. Append audit_log (metadata only).
 *  9. Return 201 with scores + ids.
 */
export async function handleDraftRequest(
  req: Request,
  deps: HandlerDeps,
): Promise<Response> {
  // CORS preflight (Supabase Edge Functions receive these from the browser).
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }

  // -- Auth ---------------------------------------------------------------
  const authHeader = req.headers.get('authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!jwt) {
    return jsonResponse({ error: 'unauthenticated' }, 401);
  }

  const user = await deps.getUser(jwt);
  if (!user) {
    return jsonResponse({ error: 'unauthenticated' }, 401);
  }

  // -- Input validation ---------------------------------------------------
  let body: { email_id?: unknown };
  try {
    body = (await req.json()) as { email_id?: unknown };
  } catch {
    return jsonResponse({ error: 'invalid json' }, 400);
  }
  if (!body?.email_id || typeof body.email_id !== 'string') {
    return jsonResponse({ error: 'email_id required' }, 400);
  }

  // -- Load email ---------------------------------------------------------
  const emailRow = await deps.getEmail(user.id, body.email_id);
  if (!emailRow) {
    return jsonResponse({ error: 'email not found' }, 404);
  }

  // -- Skip excluded categories (PRD §7.10) -------------------------------
  const category = emailRow.category ?? null;
  if (category !== null && SKIP_CATEGORIES.has(category)) {
    return jsonResponse(
      { skipped: true, reason: `category '${category}' excluded from drafting` },
      200,
    );
  }

  // -- Draft --------------------------------------------------------------
  const emailInput = {
    id: emailRow.id,
    user_id: emailRow.user_id,
    subject: emailRow.subject ?? '',
    body: emailRow.body ?? '',
    ...(emailRow.from_address ? { from: emailRow.from_address } : {}),
    ...(category ? { category } : {}),
  };

  const draftResult = await deps.draftFn(emailInput);

  // -- Persist ------------------------------------------------------------
  const draftRow = await deps.insertDraft({
    user_id: user.id,
    email_id: emailInput.id,
    body: draftResult.body,
    retrieval_score: draftResult.retrieval_score,
    generation_score: draftResult.generation_score,
    confidence: draftResult.confidence,
    kb_items_used: draftResult.kb_items_used,
    status: 'pending',
  });

  const provider: 'gmail' | 'outlook' =
    emailRow.provider === 'outlook' ? 'outlook' : 'gmail';

  const providerDraft = await deps.createProviderDraft(
    user.id,
    provider,
    draftResult.body,
  );

  await deps.updateDraftProvider(draftRow.id, providerDraft.provider_draft_id);

  // Audit log — metadata only, NO body content (factory-rules §8 / CLAUDE.md).
  await deps.logAudit({
    user_id: user.id,
    action: 'draft.created',
    email_id: emailInput.id,
    draft_id: draftRow.id,
    metadata: {
      model: 'deepseek-v4-pro',
      retrieval_score: draftResult.retrieval_score,
      generation_score: draftResult.generation_score,
      confidence: draftResult.confidence,
      kb_items_used: draftResult.kb_items_used,
      provider,
      provider_draft_id: providerDraft.provider_draft_id,
    },
  });

  return jsonResponse(
    {
      draft_id: draftRow.id,
      retrieval_score: draftResult.retrieval_score,
      generation_score: draftResult.generation_score,
      confidence: draftResult.confidence,
      kb_items_used: draftResult.kb_items_used,
      provider_draft_id: providerDraft.provider_draft_id,
    },
    201,
  );
}
