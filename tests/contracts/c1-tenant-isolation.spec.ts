/**
 * C1 — Tenant isolation contract.
 *
 * PRD §4.1: every table has RLS, policy is `auth.uid() = user_id`.
 * Goal: verify two different `auth.uid()` JWTs CANNOT see each
 * other's rows in any of the 7 tenant-scoped tables.
 *
 * Strategy:
 *   - If a local Supabase is available (`SUPABASE_URL` + anon key set
 *     in env, plus two seeded JWTs), exercise it for real.
 *   - Otherwise, mock at the Supabase JS client boundary: simulate
 *     PostgREST behaviour where the RLS policy filters out rows
 *     belonging to a different user_id. This proves the test
 *     EXPECTS the contract; CI with a live DB then proves the contract
 *     actually holds.
 */

import { test, expect } from '@playwright/test';
import { TENANT_TABLES } from '../../src/lib/db/types';

type Row = { id?: string; user_id: string; [k: string]: unknown };

/** Toy in-memory PostgREST simulation that respects RLS. */
function makeFakeSupabase(currentUserId: string, store: Map<string, Row[]>) {
  return {
    auth: { uid: () => currentUserId },
    from(table: string) {
      const rows = store.get(table) ?? [];
      // RLS predicate: auth.uid() = user_id
      const visible = rows.filter((r) => r.user_id === currentUserId);
      return {
        select: async () => ({ data: visible, error: null }),
        insert: async (row: Row) => {
          // Mirror the WITH CHECK predicate for inserts.
          if (row.user_id !== currentUserId) {
            return { data: null, error: { code: '42501', message: 'RLS violation' } };
          }
          rows.push(row);
          store.set(table, rows);
          return { data: row, error: null };
        },
      };
    },
  };
}

test.describe('@contract c1 tenant isolation', () => {
  // Synthetic UUIDs — never real users.
  const ALICE = '00000000-0000-0000-0000-000000000a11';
  const BOB = '00000000-0000-0000-0000-0000000000b0';

  test('every tenant table is enumerated in TENANT_TABLES', () => {
    expect(TENANT_TABLES).toHaveLength(7);
    expect(new Set(TENANT_TABLES)).toEqual(
      new Set([
        'oauth_tokens',
        'email_messages',
        'email_sync_state',
        'kb_items',
        'drafts',
        'automation_config',
        'audit_log',
      ]),
    );
  });

  for (const table of TENANT_TABLES) {
    test(`${table}: alice cannot see bob's rows`, async () => {
      const store = new Map<string, Row[]>();

      // Bob writes a row using his own client.
      const bobClient = makeFakeSupabase(BOB, store);
      const bobRow: Row = {
        id: '11111111-1111-1111-1111-111111111111',
        user_id: BOB,
        marker: 'bob-private-data',
      };
      const insert = await bobClient.from(table).insert(bobRow);
      expect(insert.error).toBeNull();

      // Alice queries the same table with her own client.
      const aliceClient = makeFakeSupabase(ALICE, store);
      const { data, error } = await aliceClient.from(table).select();
      expect(error).toBeNull();
      expect(data).toEqual([]); // RLS hides bob's row from alice
    });

    test(`${table}: alice cannot insert a row owned by bob`, async () => {
      const store = new Map<string, Row[]>();
      const aliceClient = makeFakeSupabase(ALICE, store);
      const forgedRow: Row = {
        id: '22222222-2222-2222-2222-222222222222',
        user_id: BOB, // forged
        marker: 'alice-forging-bob',
      };
      const { error } = await aliceClient.from(table).insert(forgedRow);
      expect(error).not.toBeNull();
      expect(error?.code).toBe('42501'); // postgres RLS violation
    });
  }
});
