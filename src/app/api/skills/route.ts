/**
 * Skills API — GET (list skill states) + PUT (toggle skills).
 *
 * TASKRESPONSE-46 / Personalization L4
 *
 * GET  /api/skills  → { skills: Array<Skill & { enabled: boolean }> }
 * PUT  /api/skills  → { ok: true, count: number }
 *                    body: { skills: Array<{ skill_id: string, enabled: boolean }> }
 */

import { NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SKILLS_LIBRARY, SKILL_IDS } from '@/lib/skills/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            /* read-only context */
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            /* read-only context */
          }
        },
      },
    },
  );
}

export async function GET() {
  const supabase = await getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { data, error } = await supabase
    .from('user_skills')
    .select('skill_id, enabled')
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const enabledSet = new Set(
    (data ?? []).filter((r) => r.enabled).map((r) => r.skill_id as string),
  );

  const skills = SKILLS_LIBRARY.map((s) => ({
    ...s,
    enabled: enabledSet.has(s.id),
  }));

  return NextResponse.json({ skills });
}

interface PutItem {
  skill_id: string;
  enabled: boolean;
}

export async function PUT(req: Request) {
  const supabase = await getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  let body: { skills?: PutItem[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const items = body.skills;
  if (!Array.isArray(items)) {
    return NextResponse.json({ error: 'skills_array_required' }, { status: 400 });
  }

  for (const item of items) {
    if (!SKILL_IDS.includes(item.skill_id)) {
      return NextResponse.json(
        { error: 'invalid_skill_id', skill_id: item.skill_id },
        { status: 400 },
      );
    }
  }

  const rows = items.map((it) => ({
    user_id: user.id,
    skill_id: it.skill_id,
    enabled: !!it.enabled,
  }));

  const { error } = await supabase
    .from('user_skills')
    .upsert(rows, { onConflict: 'user_id,skill_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, count: rows.length });
}
