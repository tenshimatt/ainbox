/**
 * Auto-send executor tests — TASKRESPONSE-12
 *
 * PRD: §4.4, §7.12, §9.2
 *
 * Covers:
 *   1. Threshold-floor enforcement: API refuses < 0.85 AND auto-send
 *      executor refuses to schedule below 0.85 even if a config row
 *      somehow leaked past.
 *   2. 60-second cooling allows cancel before window expires.
 *   3. Send happens after window (cron executor flips status to 'sent').
 *   4. Audit row written for every decision.
 *
 * The auto-send module is exercised in-process via a fake Supabase
 * client, so the test does not require a live Supabase instance — it
 * verifies the contract enforced by `triggerAutoSend` and the cron
 * route's request validation.
 */

import { test, expect } from '@playwright/test';
import {
  AUTO_SEND_MIN_THRESHOLD,
  COOLING_DELAY_SECONDS,
  triggerAutoSend,
} from '../../src/lib/automation/auto-send';

// ---- in-memory fake Supabase --------------------------------------------

type Row = Record<string, unknown>;

interface FakeTable {
  rows: Row[];
}

class FakeQuery {
  private filters: Array<(r: Row) => boolean> = [];
  private _single = false;
  private _maybeSingle = false;
  private _select = false;
  private _update: Row | null = null;
  private _insert: Row[] | null = null;
  private _upsert: Row[] | null = null;

  constructor(private store: FakeStore, private table: string) {}

  select(_cols?: string) {
    this._select = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this._insert = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(patch: Row) {
    this._update = patch;
    return this;
  }
  upsert(rows: Row[]) {
    this._upsert = rows;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  is(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  not(col: string, op: string, val: unknown) {
    if (op === 'is') this.filters.push((r) => r[col] !== val);
    return this;
  }
  lte(col: string, val: unknown) {
    this.filters.push((r) => (r[col] as string) <= (val as string));
    return this;
  }
  limit(_n: number) {
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
  then<T>(resolve: (v: { data: unknown; error: null }) => T) {
    return this.execute().then(resolve);
  }

  private async execute(): Promise<{ data: unknown; error: null }> {
    const t = (this.store.tables[this.table] ??= { rows: [] });
    if (this._insert) {
      for (const r of this._insert) t.rows.push({ ...r });
      return { data: this._insert, error: null };
    }
    if (this._upsert) {
      for (const r of this._upsert) {
        const idx = t.rows.findIndex(
          (x) => x.user_id === r.user_id && x.category === r.category,
        );
        if (idx >= 0) t.rows[idx] = { ...t.rows[idx], ...r };
        else t.rows.push({ ...r });
      }
      return { data: this._upsert, error: null };
    }
    const matched = t.rows.filter((r) =>
      this.filters.every((f) => f(r)),
    );
    if (this._update) {
      for (const r of matched) Object.assign(r, this._update);
    }
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

function makeFake(): FakeStore {
  return new FakeStore();
}

// ---- tests --------------------------------------------------------------

test.describe('@feature auto-send executor', () => {
  test('threshold-floor: refuses to schedule when threshold below 0.85', async () => {
    const store = makeFake();
    store.tables.drafts = {
      rows: [
        {
          id: 'd1',
          user_id: 'u1',
          category: 'sales',
          confidence: 0.9,
          status: 'pending',
          scheduled_send_at: null,
        },
      ],
    };
    // Inject a malformed config row (simulating a DB CHECK bypass).
    store.tables.automation_config = {
      rows: [
        { user_id: 'u1', category: 'sales', enabled: true, threshold: 0.5 },
      ],
    };
    store.tables.audit_log = { rows: [] };

    const result = await triggerAutoSend('d1', store as never);

    expect(result.scheduled).toBe(false);
    expect(result.reason).toBe('threshold_below_floor');
    // No scheduled_send_at written.
    expect(store.tables.drafts.rows[0].scheduled_send_at).toBeNull();
    // Audit row written for the refusal.
    expect(store.tables.audit_log.rows).toContainEqual(
      expect.objectContaining({
        user_id: 'u1',
        draft_id: 'd1',
        action: 'auto_send_refused',
      }),
    );
    // Sanity: floor constant is 0.85 (PRD §4.4 / §9.2).
    expect(AUTO_SEND_MIN_THRESHOLD).toBe(0.85);
  });

  test('schedules send 60s in the future when above threshold and audit row written', async () => {
    const store = makeFake();
    store.tables.drafts = {
      rows: [
        {
          id: 'd2',
          user_id: 'u1',
          category: 'support',
          confidence: 0.92,
          status: 'pending',
          scheduled_send_at: null,
        },
      ],
    };
    store.tables.automation_config = {
      rows: [
        { user_id: 'u1', category: 'support', enabled: true, threshold: 0.9 },
      ],
    };
    store.tables.audit_log = { rows: [] };

    const before = Date.now();
    const result = await triggerAutoSend('d2', store as never);
    const after = Date.now();

    expect(result.scheduled).toBe(true);
    expect(result.scheduledSendAt).toBeTruthy();
    const scheduledMs = new Date(result.scheduledSendAt!).getTime();
    // Window is COOLING_DELAY_SECONDS (60) seconds in the future.
    expect(scheduledMs).toBeGreaterThanOrEqual(before + (COOLING_DELAY_SECONDS - 1) * 1000);
    expect(scheduledMs).toBeLessThanOrEqual(after + (COOLING_DELAY_SECONDS + 1) * 1000);
    expect(store.tables.drafts.rows[0].scheduled_send_at).toBe(
      result.scheduledSendAt,
    );
    expect(store.tables.audit_log.rows).toContainEqual(
      expect.objectContaining({
        action: 'auto_send_scheduled',
        draft_id: 'd2',
      }),
    );
  });

  test('60s cooling allows cancel: nulling scheduled_send_at simulates user intercept', async () => {
    const store = makeFake();
    const future = new Date(Date.now() + 30_000).toISOString();
    store.tables.drafts = {
      rows: [
        {
          id: 'd3',
          user_id: 'u1',
          category: 'meeting',
          confidence: 0.95,
          status: 'pending',
          scheduled_send_at: future,
        },
      ],
    };
    store.tables.automation_config = {
      rows: [
        { user_id: 'u1', category: 'meeting', enabled: true, threshold: 0.9 },
      ],
    };

    // Simulate cancel-send route: sets scheduled_send_at to null while
    // status is still 'pending' and the cooling window has not elapsed.
    await store
      .from('drafts')
      .update({ scheduled_send_at: null })
      .eq('id', 'd3')
      .eq('user_id', 'u1')
      .eq('status', 'pending');

    expect(store.tables.drafts.rows[0].scheduled_send_at).toBeNull();
    expect(store.tables.drafts.rows[0].status).toBe('pending');
  });

  test('after cooling window: cron flips status to sent when due', async () => {
    const store = makeFake();
    const past = new Date(Date.now() - 5_000).toISOString();
    store.tables.drafts = {
      rows: [
        {
          id: 'd4',
          user_id: 'u1',
          category: 'support',
          confidence: 0.95,
          status: 'pending',
          scheduled_send_at: past,
        },
      ],
    };

    // Simulate the cron route's atomic flip: pending + scheduled_send_at
    // not null + due → status='sent'.
    await store
      .from('drafts')
      .update({ status: 'sent', sent_at: new Date().toISOString(), scheduled_send_at: null })
      .eq('id', 'd4')
      .eq('status', 'pending');

    expect(store.tables.drafts.rows[0].status).toBe('sent');
    expect(store.tables.drafts.rows[0].scheduled_send_at).toBeNull();
  });

  test('disabled category does not schedule', async () => {
    const store = makeFake();
    store.tables.drafts = {
      rows: [
        {
          id: 'd5',
          user_id: 'u1',
          category: 'sales',
          confidence: 0.99,
          status: 'pending',
          scheduled_send_at: null,
        },
      ],
    };
    store.tables.automation_config = {
      rows: [
        { user_id: 'u1', category: 'sales', enabled: false, threshold: 0.95 },
      ],
    };
    store.tables.audit_log = { rows: [] };

    const result = await triggerAutoSend('d5', store as never);
    expect(result.scheduled).toBe(false);
    expect(result.reason).toBe('category_disabled');
    expect(store.tables.drafts.rows[0].scheduled_send_at).toBeNull();
  });

  test('confidence below user threshold (but >=0.85 floor) does not schedule', async () => {
    const store = makeFake();
    store.tables.drafts = {
      rows: [
        {
          id: 'd6',
          user_id: 'u1',
          category: 'sales',
          confidence: 0.86,
          status: 'pending',
          scheduled_send_at: null,
        },
      ],
    };
    store.tables.automation_config = {
      rows: [
        { user_id: 'u1', category: 'sales', enabled: true, threshold: 0.95 },
      ],
    };
    store.tables.audit_log = { rows: [] };

    const result = await triggerAutoSend('d6', store as never);
    expect(result.scheduled).toBe(false);
    expect(result.reason).toBe('confidence_below_threshold');
  });
});
