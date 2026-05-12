/**
 * AINBOX-46 — Personalization L4: Skills library + /settings toggle UI
 *
 * Covers:
 *   1. SKILLS_LIBRARY has the expected shape (id, label, description, prompt_instruction).
 *   2. buildSkillsBlock returns empty string when no skills enabled.
 *   3. buildSkillsBlock injects prompt_instruction for a single enabled skill.
 *   4. buildSkillsBlock injects all instructions when multiple skills enabled.
 *   5. buildSkillsBlock ignores unknown skill IDs gracefully.
 *   6. SKILL_IDS contains every id in SKILLS_LIBRARY (no orphans).
 *   7. Skills API GET returns all library skills with enabled=false by default
 *      (simulated via fake Supabase store).
 *   8. Skills API PUT toggles enabled state and rejects unknown skill ids.
 *
 * No real email content, no real network calls.
 */

import { test, expect } from '@playwright/test';
import {
  SKILLS_LIBRARY,
  SKILL_IDS,
  buildSkillsBlock,
} from '../../src/lib/skills/skills';

// ---- pure-function tests ---------------------------------------------------

test.describe('@feature AINBOX-46 skills library', () => {
  test('every skill has id, label, description and prompt_instruction', () => {
    expect(SKILLS_LIBRARY.length).toBeGreaterThanOrEqual(1);
    for (const skill of SKILLS_LIBRARY) {
      expect(typeof skill.id).toBe('string');
      expect(skill.id.length).toBeGreaterThan(0);
      expect(typeof skill.label).toBe('string');
      expect(skill.label.length).toBeGreaterThan(0);
      expect(typeof skill.description).toBe('string');
      expect(skill.description.length).toBeGreaterThan(0);
      expect(typeof skill.prompt_instruction).toBe('string');
      expect(skill.prompt_instruction.length).toBeGreaterThan(0);
    }
  });

  test('SKILL_IDS contains every id in SKILLS_LIBRARY (no orphans)', () => {
    for (const skill of SKILLS_LIBRARY) {
      expect(SKILL_IDS).toContain(skill.id);
    }
    expect(SKILL_IDS.length).toBe(SKILLS_LIBRARY.length);
  });

  test('skill ids are unique', () => {
    const ids = SKILLS_LIBRARY.map((s) => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

test.describe('@feature AINBOX-46 buildSkillsBlock', () => {
  test('returns empty string when no skills enabled', () => {
    expect(buildSkillsBlock([])).toBe('');
  });

  test('returns empty string when all ids are unknown', () => {
    expect(buildSkillsBlock(['nonexistent_skill', 'another_fake'])).toBe('');
  });

  test('injects prompt_instruction for a single known skill', () => {
    const skill = SKILLS_LIBRARY[0];
    const block = buildSkillsBlock([skill.id]);

    expect(block).not.toBe('');
    expect(block).toContain(skill.prompt_instruction);
    expect(block).toContain('Writing style rules');
  });

  test('injects all instructions when multiple skills are enabled', () => {
    const ids = SKILLS_LIBRARY.slice(0, 3).map((s) => s.id);
    const block = buildSkillsBlock(ids);

    for (const id of ids) {
      const skill = SKILLS_LIBRARY.find((s) => s.id === id)!;
      expect(block).toContain(skill.prompt_instruction);
    }
  });

  test('ignores unknown ids mixed with valid ones', () => {
    const validSkill = SKILLS_LIBRARY[0];
    const block = buildSkillsBlock(['totally_fake', validSkill.id, 'also_fake']);

    expect(block).toContain(validSkill.prompt_instruction);
    // Should only have one bullet for the one real skill
    const bulletCount = (block.match(/^- /gm) ?? []).length;
    expect(bulletCount).toBe(1);
  });

  test('formal_tone skill is present and injects formal language instruction', () => {
    const block = buildSkillsBlock(['formal_tone']);
    expect(block).toContain('formal');
  });

  test('concise_replies skill injects sentence-limit instruction', () => {
    const block = buildSkillsBlock(['concise_replies']);
    expect(block).toContain('2-3 sentences');
  });

  test('block starts with a newline so it appends cleanly to system prompt', () => {
    const block = buildSkillsBlock([SKILLS_LIBRARY[0].id]);
    expect(block.startsWith('\n')).toBe(true);
  });
});

// ---- API contract tests via fake Supabase store ----------------------------

type Row = Record<string, unknown>;

interface FakeTable {
  rows: Row[];
}

class FakeQuery {
  private filters: Array<(r: Row) => boolean> = [];
  private _upsert: Row[] | null = null;
  private _select = false;

  constructor(
    private store: FakeStore,
    private table: string,
  ) {}

  select(_cols?: string) {
    this._select = true;
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
  then<T>(resolve: (v: { data: unknown; error: null }) => T) {
    return this.execute().then(resolve);
  }

  private async execute(): Promise<{ data: unknown; error: null }> {
    const t = (this.store.tables[this.table] ??= { rows: [] });
    if (this._upsert) {
      for (const r of this._upsert) {
        const idx = t.rows.findIndex(
          (x) => x.user_id === r.user_id && x.skill_id === r.skill_id,
        );
        if (idx >= 0) t.rows[idx] = { ...t.rows[idx], ...r };
        else t.rows.push({ ...r });
      }
      return { data: this._upsert, error: null };
    }
    const matched = t.rows.filter((r) => this.filters.every((f) => f(r)));
    return { data: matched, error: null };
  }
}

class FakeStore {
  tables: Record<string, FakeTable> = {};
  from(name: string) {
    return new FakeQuery(this, name);
  }
}

/**
 * Simulate the GET /api/skills logic: load user_skills rows and merge with
 * SKILLS_LIBRARY defaults. Mirrors src/app/api/skills/route.ts GET handler.
 */
function simulateGet(
  store: FakeStore,
  userId: string,
): Array<typeof SKILLS_LIBRARY[number] & { enabled: boolean }> {
  const rows = store.tables['user_skills']?.rows ?? [];
  const enabledSet = new Set(
    rows.filter((r) => r.user_id === userId && r.enabled === true).map((r) => r.skill_id as string),
  );
  return SKILLS_LIBRARY.map((s) => ({ ...s, enabled: enabledSet.has(s.id) }));
}

/**
 * Simulate the PUT /api/skills logic: validate and upsert skill rows.
 * Returns { ok, count } or { error }.
 */
async function simulatePut(
  store: FakeStore,
  userId: string,
  items: Array<{ skill_id: string; enabled: boolean }>,
): Promise<{ ok: boolean; count?: number; error?: string; skill_id?: string }> {
  for (const item of items) {
    if (!SKILL_IDS.includes(item.skill_id)) {
      return { ok: false, error: 'invalid_skill_id', skill_id: item.skill_id };
    }
  }
  const rows: Row[] = items.map((it) => ({
    user_id: userId,
    skill_id: it.skill_id,
    enabled: it.enabled,
  }));
  await store.from('user_skills').upsert(rows);
  return { ok: true, count: rows.length };
}

test.describe('@feature AINBOX-46 skills API contract', () => {
  test('GET returns all library skills disabled by default (no rows in DB)', () => {
    const store = new FakeStore();
    const result = simulateGet(store, 'user-abc');

    expect(result).toHaveLength(SKILLS_LIBRARY.length);
    for (const s of result) {
      expect(s.enabled).toBe(false);
    }
  });

  test('GET reflects enabled skills stored in DB', () => {
    const store = new FakeStore();
    store.tables['user_skills'] = {
      rows: [
        { user_id: 'user-abc', skill_id: 'formal_tone', enabled: true },
        { user_id: 'user-abc', skill_id: 'concise_replies', enabled: false },
      ],
    };

    const result = simulateGet(store, 'user-abc');

    const formal = result.find((s) => s.id === 'formal_tone')!;
    expect(formal.enabled).toBe(true);
    const concise = result.find((s) => s.id === 'concise_replies')!;
    expect(concise.enabled).toBe(false);
  });

  test('GET does not leak other users skills', () => {
    const store = new FakeStore();
    store.tables['user_skills'] = {
      rows: [{ user_id: 'user-other', skill_id: 'formal_tone', enabled: true }],
    };

    const result = simulateGet(store, 'user-abc');
    const formal = result.find((s) => s.id === 'formal_tone')!;
    expect(formal.enabled).toBe(false);
  });

  test('PUT persists skill toggle and GET reflects it', async () => {
    const store = new FakeStore();

    const putResult = await simulatePut(store, 'user-abc', [
      { skill_id: 'formal_tone', enabled: true },
      { skill_id: 'bullet_structure', enabled: true },
    ]);

    expect(putResult.ok).toBe(true);
    expect(putResult.count).toBe(2);

    const getResult = simulateGet(store, 'user-abc');
    const formal = getResult.find((s) => s.id === 'formal_tone')!;
    expect(formal.enabled).toBe(true);
    const bullet = getResult.find((s) => s.id === 'bullet_structure')!;
    expect(bullet.enabled).toBe(true);
  });

  test('PUT rejects unknown skill_id', async () => {
    const store = new FakeStore();

    const result = await simulatePut(store, 'user-abc', [
      { skill_id: 'totally_made_up', enabled: true },
    ]);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_skill_id');
    expect(result.skill_id).toBe('totally_made_up');
  });

  test('PUT toggle off removes enabled flag', async () => {
    const store = new FakeStore();
    // First enable
    await simulatePut(store, 'user-abc', [{ skill_id: 'formal_tone', enabled: true }]);
    // Then disable
    await simulatePut(store, 'user-abc', [{ skill_id: 'formal_tone', enabled: false }]);

    const result = simulateGet(store, 'user-abc');
    const formal = result.find((s) => s.id === 'formal_tone')!;
    expect(formal.enabled).toBe(false);
  });
});
