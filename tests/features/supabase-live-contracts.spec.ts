/**
 * TASKRESPONSE-34: Layer B — live Supabase test-project contract tests.
 *
 * PRD anchors: §4.1 (RLS), §4.2 (OAuth encryption), §4.4 (auto-send floor).
 *
 * Layer A (tests/contracts/c1–c8) verifies that the application CODE expects
 * the architectural contracts to hold — using mocks. Layer B (this file) wires
 * a real `@supabase/supabase-js` client to a live test project and verifies
 * the DATABASE itself enforces those same contracts.
 *
 * Required env vars (tests skip gracefully when absent):
 *   SUPABASE_URL              — test project REST URL
 *   SUPABASE_ANON_KEY         — low-privilege anon/public key
 *   SUPABASE_SERVICE_ROLE_KEY — high-privilege key (used for seeding only)
 *
 * Synthetic users only:
 *   Two fixture users are created via `auth.admin.createUser` with @taskresponse.test
 *   sentinel addresses. They are deleted in `afterAll`; cascade deletes remove
 *   all associated rows.
 *
 * PRD §4.1, §4.2, §4.4 — see also tests/contracts/README.md for contract list.
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { TENANT_TABLES } from '../../src/lib/db/types';

// ---------------------------------------------------------------------------
// Env-var guards
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const LIVE = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_KEY);
const SKIP_REASON =
  'Skipping Layer B live contract: set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY to run against a real Supabase test project.';

// ---------------------------------------------------------------------------
// Fixture identities — synthetic @taskresponse.test sentinel domain.
// ---------------------------------------------------------------------------

const LB_ALICE_EMAIL = 'lb-alice@taskresponse.test';
const LB_BOB_EMAIL = 'lb-bob@taskresponse.test';

// Populated in beforeAll once admin.createUser resolves.
let ALICE_ID = '';
let BOB_ID = '';
let ALICE_PWD = '';
let BOB_PWD = '';

// ---------------------------------------------------------------------------
// Client factories — no persistent sessions, no token refresh side-effects.
// ---------------------------------------------------------------------------

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function anonClient() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function userClient(email: string, password: string) {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signInWithPassword(${email}): ${error.message}`);
  return client;
}

function synthPwd(): string {
  // Meets typical Supabase password requirements: 8+ chars, mixed.
  return `Lb1-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('@feature TASKRESPONSE-34 Layer B live Supabase contract tests', () => {
  // ---- lifecycle: create / destroy synthetic fixture users ---------------

  test.beforeAll(async () => {
    if (!LIVE) return;

    const admin = adminClient();
    ALICE_PWD = synthPwd();
    BOB_PWD = synthPwd();

    // Idempotent: remove leftovers from a previous interrupted run.
    const { data: listData } = await admin.auth.admin.listUsers();
    for (const email of [LB_ALICE_EMAIL, LB_BOB_EMAIL]) {
      const stale = listData?.users?.find((u) => u.email === email);
      if (stale) await admin.auth.admin.deleteUser(stale.id);
    }

    const { data: aData, error: aErr } = await admin.auth.admin.createUser({
      email: LB_ALICE_EMAIL,
      password: ALICE_PWD,
      email_confirm: true,
    });
    if (aErr) throw new Error(`beforeAll createUser alice: ${aErr.message}`);
    ALICE_ID = aData.user.id;

    const { data: bData, error: bErr } = await admin.auth.admin.createUser({
      email: LB_BOB_EMAIL,
      password: BOB_PWD,
      email_confirm: true,
    });
    if (bErr) throw new Error(`beforeAll createUser bob: ${bErr.message}`);
    BOB_ID = bData.user.id;
  });

  test.afterAll(async () => {
    if (!LIVE) return;
    const admin = adminClient();
    if (ALICE_ID) await admin.auth.admin.deleteUser(ALICE_ID);
    if (BOB_ID) await admin.auth.admin.deleteUser(BOB_ID);
  });

  // =========================================================================
  // C1 — Tenant isolation (§4.1)
  // =========================================================================

  test.describe('C1 RLS — unauthenticated access returns no rows', () => {
    for (const table of TENANT_TABLES) {
      test(`${table}: anon client reads 0 rows`, async () => {
        test.skip(!LIVE, SKIP_REASON);
        const client = anonClient();
        const { data, error } = await client.from(table).select('*').limit(10);
        if (error) {
          // RLS may surface as a 403/permission-denied for some configurations.
          // Either an empty result or an access-denied error satisfies the contract.
          expect(error.message).toBeTruthy();
        } else {
          // auth.uid() = null never matches any user_id — result must be empty.
          expect(data).toEqual([]);
        }
      });
    }
  });

  test.describe('C1 RLS — cross-tenant isolation', () => {
    test("alice cannot read bob's kb_items", async () => {
      test.skip(!LIVE, SKIP_REASON);
      const admin = adminClient();

      // Seed a kb_item for Bob via service role (bypasses RLS for setup).
      const { error: insertErr } = await admin.from('kb_items').insert({
        user_id: BOB_ID,
        kb_type: 'signature',
        content: 'Bob private KB item — Layer B synthetic fixture',
        confidence: 0.99,
        verified: true,
      });
      expect(insertErr).toBeNull();

      // Alice queries kb_items — must not see Bob's row.
      const alice = await userClient(LB_ALICE_EMAIL, ALICE_PWD);
      const { data, error: readErr } = await alice.from('kb_items').select('*');
      expect(readErr).toBeNull();
      const bobRows = (data ?? []).filter(
        (r: { user_id: string }) => r.user_id === BOB_ID,
      );
      expect(bobRows).toHaveLength(0);
    });

    test("bob cannot read alice's email_sync_state", async () => {
      test.skip(!LIVE, SKIP_REASON);
      const admin = adminClient();

      // Seed an email_sync_state for Alice via service role.
      const { error: insertErr } = await admin.from('email_sync_state').insert({
        user_id: ALICE_ID,
        provider: 'gmail',
        sync_type: 'incremental',
        status: 'complete',
        history_id: 'lb-test-history-001',
      });
      // Ignore conflict if row already exists from a previous run.
      if (insertErr && insertErr.code !== '23505') {
        expect(insertErr).toBeNull();
      }

      // Bob queries email_sync_state — must not see Alice's row.
      const bob = await userClient(LB_BOB_EMAIL, BOB_PWD);
      const { data, error: readErr } = await bob.from('email_sync_state').select('*');
      expect(readErr).toBeNull();
      const aliceRows = (data ?? []).filter(
        (r: { user_id: string }) => r.user_id === ALICE_ID,
      );
      expect(aliceRows).toHaveLength(0);
    });

    test("cross-tenant insert forging another user's user_id is rejected", async () => {
      test.skip(!LIVE, SKIP_REASON);

      // Alice attempts to write a kb_item with Bob's user_id.
      const alice = await userClient(LB_ALICE_EMAIL, ALICE_PWD);
      const { error } = await alice.from('kb_items').insert({
        user_id: BOB_ID, // forged
        kb_type: 'faq',
        content: 'Alice forging Bob — should be rejected by RLS WITH CHECK',
        confidence: 0.5,
        verified: false,
      });
      // RLS WITH CHECK(auth.uid() = user_id) must reject this.
      expect(error).not.toBeNull();
    });
  });

  test.describe('C1 RLS — service role bypass (data actually exists)', () => {
    test('service role can select from every TENANT_TABLE without error', async () => {
      test.skip(!LIVE, SKIP_REASON);
      const admin = adminClient();
      for (const table of TENANT_TABLES) {
        const { error } = await admin.from(table).select('*').limit(0);
        expect(error).toBeNull();
      }
    });

    test("service role sees bob's kb_items (confirms RLS is the suppression mechanism)", async () => {
      test.skip(!LIVE, SKIP_REASON);
      const admin = adminClient();

      // Seed via admin, then verify admin can read it back.
      await admin.from('kb_items').insert({
        user_id: BOB_ID,
        kb_type: 'policy',
        content: 'Bob policy item — service-role readback fixture',
        confidence: 0.80,
        verified: false,
      });

      const { data, error } = await admin
        .from('kb_items')
        .select('*')
        .eq('user_id', BOB_ID);
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // C2 — OAuth token encryption contract (§4.2)
  // =========================================================================

  test.describe('C2 schema — oauth_tokens column shape', () => {
    test('encrypted_refresh_token column exists (select returns no error)', async () => {
      test.skip(!LIVE, SKIP_REASON);
      const admin = adminClient();
      // Selecting a valid column on an empty result set returns no error.
      const { error } = await admin
        .from('oauth_tokens')
        .select('encrypted_refresh_token')
        .limit(0);
      expect(error).toBeNull();
    });

    test('no plaintext refresh_token column (select returns PostgREST error)', async () => {
      test.skip(!LIVE, SKIP_REASON);
      const admin = adminClient();
      // PostgREST / Postgres returns an error when the requested column
      // does not exist (error code 42703 "undefined_column").
      const { error } = await admin
        .from('oauth_tokens')
        .select('refresh_token')
        .limit(0);
      expect(error).not.toBeNull();
    });

    test('encrypted_access_token column exists', async () => {
      test.skip(!LIVE, SKIP_REASON);
      const admin = adminClient();
      const { error } = await admin
        .from('oauth_tokens')
        .select('encrypted_access_token')
        .limit(0);
      expect(error).toBeNull();
    });
  });

  // =========================================================================
  // C4 — Auto-send confidence floor = 0.85 enforced at DB level (§4.4)
  // =========================================================================

  test.describe('C4 schema — automation_config threshold constraint', () => {
    // handle_new_user trigger bootstraps automation_config for every new user,
    // so Alice already has a row with threshold=0.85 after beforeAll.

    test('UPDATE to threshold 0.80 is rejected by check constraint', async () => {
      test.skip(!LIVE, SKIP_REASON);
      const admin = adminClient();
      const { error } = await admin
        .from('automation_config')
        .update({ threshold: 0.80 })
        .eq('user_id', ALICE_ID);
      expect(error).not.toBeNull();
      // Postgres check_violation error code.
      expect(error!.code).toBe('23514');
    });

    test('UPDATE to threshold 0.90 succeeds (above floor)', async () => {
      test.skip(!LIVE, SKIP_REASON);
      const admin = adminClient();
      const { error } = await admin
        .from('automation_config')
        .update({ threshold: 0.90 })
        .eq('user_id', ALICE_ID);
      expect(error).toBeNull();
      // Restore to 0.85 so subsequent tests start from a known state.
      await admin
        .from('automation_config')
        .update({ threshold: 0.85 })
        .eq('user_id', ALICE_ID);
    });

    test('UPDATE to threshold 0.84 is rejected (below floor by 0.01)', async () => {
      test.skip(!LIVE, SKIP_REASON);
      const admin = adminClient();
      const { error } = await admin
        .from('automation_config')
        .update({ threshold: 0.84 })
        .eq('user_id', BOB_ID);
      expect(error).not.toBeNull();
      expect(error!.code).toBe('23514');
    });
  });

  test.describe('C4 schema — automation_rules confidence_threshold constraint', () => {
    // handle_new_user also bootstraps automation_rules rows for all categories.

    test('UPDATE confidence_threshold to 0.84 is rejected', async () => {
      test.skip(!LIVE, SKIP_REASON);
      const admin = adminClient();
      const { error } = await admin
        .from('automation_rules')
        .update({ confidence_threshold: 0.84 })
        .eq('user_id', ALICE_ID)
        .eq('category', 'support');
      expect(error).not.toBeNull();
      expect(error!.code).toBe('23514');
    });

    test('UPDATE confidence_threshold to 0.95 succeeds', async () => {
      test.skip(!LIVE, SKIP_REASON);
      const admin = adminClient();
      const { error } = await admin
        .from('automation_rules')
        .update({ confidence_threshold: 0.95 })
        .eq('user_id', ALICE_ID)
        .eq('category', 'support');
      expect(error).toBeNull();
      // Restore.
      await admin
        .from('automation_rules')
        .update({ confidence_threshold: 0.85 })
        .eq('user_id', ALICE_ID)
        .eq('category', 'support');
    });
  });

  // =========================================================================
  // C5 — All TENANT_TABLES exist in the live schema
  // =========================================================================

  test.describe('C5 schema — all TENANT_TABLES are reachable', () => {
    for (const table of TENANT_TABLES) {
      test(`${table} responds to service-role select (table exists)`, async () => {
        test.skip(!LIVE, SKIP_REASON);
        const admin = adminClient();
        const { error } = await admin.from(table).select('*').limit(0);
        expect(error).toBeNull();
      });
    }

    test('TENANT_TABLES constant enumerates exactly 7 tables', () => {
      // Static — no live DB needed. Documents the expected count.
      expect(TENANT_TABLES).toHaveLength(7);
    });
  });
});
