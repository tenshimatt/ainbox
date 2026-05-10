/**
 * AINBOX-28 — Classification engine (edge function)
 * PRD §7.9
 *
 * Verifies the queue-aware classify processor (`src/lib/classify/queue.ts`):
 *   - Fetches pending classify tasks from email_queue
 *   - Claims each task (status → 'processing')
 *   - Fetches email from emails table and classifies it
 *   - Persists ai_classification + ai_processed=true on the email row
 *   - Writes an audit_logs entry with event_type='classification'
 *   - Marks each queue task 'completed' on success
 *   - On failure: increments attempts; marks 'failed' when attempts >= max_attempts
 *   - Returns { total, classified, failed } counts
 *
 * All fixtures use synthesised @ainbox.test addresses — no real email content.
 */

import { test, expect } from '@playwright/test';
import { processClassifyQueue } from '../../src/lib/classify/queue';
import type { ClassificationResult } from '../../src/lib/classify/classify';

// ---------------------------------------------------------------------------
// Fake Supabase store (mirrors the FakeStore pattern from auto-send.spec.ts)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface FakeTable {
  rows: Row[];
}

class FakeQuery {
  private conditions: Array<(r: Row) => boolean> = [];
  private _updatePatch: Row | null = null;
  private _insertRows: Row[] | null = null;
  private _select = false;
  private _single = false;
  private _maybeSingle = false;
  private _orderBy: Array<{ col: string; ascending: boolean }> = [];
  private _limit: number | null = null;

  constructor(private store: FakeStore, private table: string) {}

  select(_cols?: string) {
    this._select = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this._insertRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(patch: Row) {
    this._updatePatch = patch;
    return this;
  }
  eq(col: string, val: unknown) {
    this.conditions.push((r) => r[col] === val);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this._orderBy.push({ col, ascending: opts?.ascending ?? true });
    return this;
  }
  limit(n: number) {
    this._limit = n;
    return this;
  }
  single() {
    this._single = true;
    return this.execute();
  }
  maybeSingle() {
    this._maybeSingle = true;
    return this.execute();
  }
  then<T>(resolve: (v: { data: unknown; error: null | { message: string } }) => T) {
    return this.execute().then(resolve);
  }

  private async execute(): Promise<{ data: unknown; error: null | { message: string } }> {
    const t = (this.store.tables[this.table] ??= { rows: [] });

    if (this._insertRows) {
      for (const r of this._insertRows) t.rows.push({ ...r });
      return { data: this._insertRows, error: null };
    }

    let matched = t.rows.filter((r) => this.conditions.every((f) => f(r)));

    if (this._updatePatch) {
      for (const r of matched) Object.assign(r, this._updatePatch);
      return { data: matched, error: null };
    }

    // Apply ordering
    for (const { col, ascending } of this._orderBy) {
      matched = matched.sort((a, b) => {
        const av = a[col] as string | number;
        const bv = b[col] as string | number;
        return ascending ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0);
      });
    }

    if (this._limit !== null) matched = matched.slice(0, this._limit);

    if (this._single) return { data: matched[0] ?? null, error: null };
    if (this._maybeSingle) return { data: matched[0] ?? null, error: null };

    return { data: matched, error: null };
  }
}

class FakeStore {
  tables: Record<string, FakeTable> = {};
  from(name: string) {
    return new FakeQuery(this, name);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(): FakeStore {
  return new FakeStore();
}

function fixedClock(iso = '2026-05-10T12:00:00.000Z') {
  return () => new Date(iso);
}

function stubClassifier(
  map: Record<string, { category: string; confidence: number }>,
) {
  return async (email: { subject?: string | null }): Promise<ClassificationResult> => {
    const entry = map[email.subject ?? ''] ?? { category: 'other', confidence: 0.5 };
    return entry as ClassificationResult;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('@feature §7.9 classify-queue (AINBOX-28)', () => {
  test('processes pending tasks and marks them completed', async () => {
    const store = makeStore();

    store.tables.email_queue = {
      rows: [
        {
          id: 'q1',
          email_id: 'e1',
          user_id: 'u1',
          task_type: 'classify',
          status: 'pending',
          priority: 0,
          attempts: 0,
          max_attempts: 3,
          created_at: '2026-05-10T11:00:00Z',
        },
        {
          id: 'q2',
          email_id: 'e2',
          user_id: 'u1',
          task_type: 'classify',
          status: 'pending',
          priority: 0,
          attempts: 0,
          max_attempts: 3,
          created_at: '2026-05-10T11:01:00Z',
        },
      ],
    };

    store.tables.emails = {
      rows: [
        {
          id: 'e1',
          user_id: 'u1',
          subject: 'Pricing enquiry for 100 seats',
          body_plain_preview: 'Hi, we need enterprise pricing.',
          from_address: 'buyer@ainbox.test',
          ai_processed: false,
          ai_classification: null,
        },
        {
          id: 'e2',
          user_id: 'u1',
          subject: 'Login issue',
          body_plain_preview: 'Cannot sign in.',
          from_address: 'user@ainbox.test',
          ai_processed: false,
          ai_classification: null,
        },
      ],
    };

    store.tables.audit_logs = { rows: [] };

    const result = await processClassifyQueue(store as never, 25, {
      classifier: stubClassifier({
        'Pricing enquiry for 100 seats': { category: 'sales', confidence: 0.91 },
        'Login issue': { category: 'support', confidence: 0.78 },
      }),
      now: fixedClock(),
    });

    expect(result.total).toBe(2);
    expect(result.classified).toBe(2);
    expect(result.failed).toBe(0);

    // Both emails updated with ai_classification + ai_processed
    const e1 = store.tables.emails.rows.find((r) => r.id === 'e1');
    expect(e1?.ai_classification).toBe('sales');
    expect(e1?.ai_processed).toBe(true);

    const e2 = store.tables.emails.rows.find((r) => r.id === 'e2');
    expect(e2?.ai_classification).toBe('support');
    expect(e2?.ai_processed).toBe(true);

    // Both queue tasks marked completed
    const q1 = store.tables.email_queue.rows.find((r) => r.id === 'q1');
    expect(q1?.status).toBe('completed');
    expect(q1?.completed_at).toBe('2026-05-10T12:00:00.000Z');

    const q2 = store.tables.email_queue.rows.find((r) => r.id === 'q2');
    expect(q2?.status).toBe('completed');
  });

  test('audit_logs entry written for each classified email', async () => {
    const store = makeStore();

    store.tables.email_queue = {
      rows: [
        {
          id: 'q3',
          email_id: 'e3',
          user_id: 'u2',
          task_type: 'classify',
          status: 'pending',
          priority: 0,
          attempts: 0,
          max_attempts: 3,
          created_at: '2026-05-10T11:02:00Z',
        },
      ],
    };

    store.tables.emails = {
      rows: [
        {
          id: 'e3',
          user_id: 'u2',
          subject: 'Invoice overdue',
          body_plain_preview: 'Payment reminder.',
          from_address: 'billing@ainbox.test',
          ai_processed: false,
          ai_classification: null,
        },
      ],
    };

    store.tables.audit_logs = { rows: [] };

    await processClassifyQueue(store as never, 25, {
      classifier: stubClassifier({
        'Invoice overdue': { category: 'invoice', confidence: 0.88 },
      }),
      now: fixedClock(),
    });

    expect(store.tables.audit_logs.rows).toHaveLength(1);
    const audit = store.tables.audit_logs.rows[0];
    expect(audit.user_id).toBe('u2');
    expect(audit.event_type).toBe('classification');
    expect(audit.entity_type).toBe('email');
    expect(audit.entity_id).toBe('e3');
    expect(audit.action).toBe('classify');
    expect((audit.details as { category: string }).category).toBe('invoice');
    expect(typeof (audit.details as { confidence: number }).confidence).toBe('number');
  });

  test('task claimed (status=processing) before classifier runs', async () => {
    const store = makeStore();
    const statusSeen: string[] = [];

    store.tables.email_queue = {
      rows: [
        {
          id: 'q4',
          email_id: 'e4',
          user_id: 'u1',
          task_type: 'classify',
          status: 'pending',
          priority: 0,
          attempts: 0,
          max_attempts: 3,
          created_at: '2026-05-10T11:03:00Z',
        },
      ],
    };

    store.tables.emails = {
      rows: [
        {
          id: 'e4',
          user_id: 'u1',
          subject: 'Meeting request',
          body_plain_preview: 'Can we schedule a call?',
          from_address: 'partner@ainbox.test',
          ai_processed: false,
          ai_classification: null,
        },
      ],
    };

    store.tables.audit_logs = { rows: [] };

    await processClassifyQueue(store as never, 25, {
      classifier: async (email) => {
        // Observe the queue status at the moment the classifier runs.
        const task = store.tables.email_queue.rows.find((r) => r.id === 'q4');
        if (task) statusSeen.push(task.status as string);
        return {
          category: 'meeting' as const,
          confidence: 0.85,
        };
      },
      now: fixedClock(),
    });

    // At classifier run time the task should already be 'processing'.
    expect(statusSeen).toContain('processing');
  });

  test('on classifier failure: increments attempts and resets to pending (not exhausted)', async () => {
    const store = makeStore();

    store.tables.email_queue = {
      rows: [
        {
          id: 'q5',
          email_id: 'e5',
          user_id: 'u1',
          task_type: 'classify',
          status: 'pending',
          priority: 0,
          attempts: 1,
          max_attempts: 3,
          created_at: '2026-05-10T11:04:00Z',
        },
      ],
    };

    store.tables.emails = {
      rows: [
        {
          id: 'e5',
          user_id: 'u1',
          subject: 'Test fail',
          body_plain_preview: 'body',
          from_address: 'x@ainbox.test',
          ai_processed: false,
          ai_classification: null,
        },
      ],
    };

    store.tables.audit_logs = { rows: [] };

    const result = await processClassifyQueue(store as never, 25, {
      classifier: async () => {
        throw new Error('LiteLLM timeout');
      },
      now: fixedClock(),
    });

    expect(result.total).toBe(1);
    expect(result.classified).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.results[0].ok).toBe(false);
    if (!result.results[0].ok) {
      expect(result.results[0].error).toMatch(/LiteLLM timeout/);
    }

    const task = store.tables.email_queue.rows[0];
    expect(task.attempts).toBe(2);
    expect(task.status).toBe('pending');   // still retryable
    expect(task.error_message).toMatch(/LiteLLM timeout/);
    expect(task.started_at).toBeNull();
  });

  test('on exhausted attempts: marks task failed', async () => {
    const store = makeStore();

    store.tables.email_queue = {
      rows: [
        {
          id: 'q6',
          email_id: 'e6',
          user_id: 'u1',
          task_type: 'classify',
          status: 'pending',
          priority: 0,
          attempts: 2,      // max_attempts=3, so one more try exhausts it
          max_attempts: 3,
          created_at: '2026-05-10T11:05:00Z',
        },
      ],
    };

    store.tables.emails = {
      rows: [
        {
          id: 'e6',
          user_id: 'u1',
          subject: 'Exhausted',
          body_plain_preview: 'body',
          from_address: 'x@ainbox.test',
          ai_processed: false,
          ai_classification: null,
        },
      ],
    };

    store.tables.audit_logs = { rows: [] };

    await processClassifyQueue(store as never, 25, {
      classifier: async () => {
        throw new Error('permanent error');
      },
      now: fixedClock(),
    });

    const task = store.tables.email_queue.rows[0];
    expect(task.attempts).toBe(3);
    expect(task.status).toBe('failed');
  });

  test('returns { total: 0 } when no pending tasks', async () => {
    const store = makeStore();
    store.tables.email_queue = { rows: [] };
    store.tables.emails = { rows: [] };
    store.tables.audit_logs = { rows: [] };

    const result = await processClassifyQueue(store as never, 25, {
      now: fixedClock(),
    });

    expect(result.total).toBe(0);
    expect(result.classified).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  test('limit parameter caps the number of tasks processed', async () => {
    const store = makeStore();

    store.tables.email_queue = {
      rows: Array.from({ length: 10 }, (_, i) => ({
        id: `qL${i}`,
        email_id: `eL${i}`,
        user_id: 'u1',
        task_type: 'classify',
        status: 'pending',
        priority: 0,
        attempts: 0,
        max_attempts: 3,
        created_at: `2026-05-10T10:0${i}:00Z`,
      })),
    };

    store.tables.emails = {
      rows: Array.from({ length: 10 }, (_, i) => ({
        id: `eL${i}`,
        user_id: 'u1',
        subject: `Subject ${i}`,
        body_plain_preview: 'body',
        from_address: `sender${i}@ainbox.test`,
        ai_processed: false,
        ai_classification: null,
      })),
    };

    store.tables.audit_logs = { rows: [] };

    const result = await processClassifyQueue(store as never, 3, {
      classifier: async () => ({ category: 'other' as const, confidence: 0.5 }),
      now: fixedClock(),
    });

    expect(result.total).toBe(3);
    expect(result.classified).toBe(3);
  });
});
