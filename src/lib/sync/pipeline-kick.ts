/**
 * TASK7544-79: Parallel pipeline kick — triggers classify then draft immediately
 * after the first sync batch lands, bypassing the pg_cron cycle to meet
 * 4-min time-to-first-draft target.
 *
 * PRD anchors: §7.3 (first sync), §7.9 (classify), §7.10 (draft).
 *
 * Usage:
 *   const kick = makePipelineKick({ supabaseUrl, cronSecret });
 *   // inject as deps.pipelineKick in runGmailBackfill / runOutlookBackfill
 *
 * The returned function is fire-and-forget at the call site — it swallows
 * errors internally so a classify or draft failure never aborts the sync.
 */

export interface PipelineKickDeps {
  supabaseUrl: string;
  cronSecret: string;
  /** Injectable fetch — defaults to global fetch. Override in tests. */
  fetchFn?: typeof fetch;
}

export interface PipelineKickResult {
  classifyOk: boolean;
  draftOk: boolean;
}

/**
 * Call the classify edge function then the draft edge function sequentially.
 * Returns a result summary; never throws.
 */
export async function kickPipeline(
  userId: string,
  deps: PipelineKickDeps,
): Promise<PipelineKickResult> {
  const { supabaseUrl, cronSecret } = deps;
  const fetchFn = deps.fetchFn ?? fetch;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cronSecret}`,
    'Content-Type': 'application/json',
  };

  let classifyOk = false;
  let draftOk = false;

  // Step 1: classify — pull up to 50 unclassified messages for this run.
  try {
    const cr = await fetchFn(`${supabaseUrl}/functions/v1/classify`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ limit: 50 }),
    });
    classifyOk = cr.ok;
    if (!cr.ok) {
      console.error(`[pipeline-kick/${userId}] classify HTTP ${cr.status}`);
    }
  } catch (err) {
    console.error(`[pipeline-kick/${userId}] classify threw:`, (err as Error).message);
  }

  // Step 2: draft — generate up to 25 drafts from newly classified messages.
  // Runs regardless of classify outcome so a partial classify still produces drafts.
  try {
    const dr = await fetchFn(`${supabaseUrl}/functions/v1/draft`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ limit: 25 }),
    });
    draftOk = dr.ok;
    if (!dr.ok) {
      console.error(`[pipeline-kick/${userId}] draft HTTP ${dr.status}`);
    }
  } catch (err) {
    console.error(`[pipeline-kick/${userId}] draft threw:`, (err as Error).message);
  }

  return { classifyOk, draftOk };
}

/**
 * Build a production pipeline kick function from environment deps.
 * Returns a `(userId) => Promise<void>` suitable for injection into
 * `SyncDeps.pipelineKick` or `OutlookSyncDeps.pipelineKick`.
 */
export function makePipelineKick(
  deps: PipelineKickDeps,
): (userId: string) => Promise<void> {
  return async (userId: string): Promise<void> => {
    await kickPipeline(userId, deps);
  };
}
