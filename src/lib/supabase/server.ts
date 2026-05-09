/**
 * Supabase server client for Server Components / Route Handlers / middleware
 * (PRD §3.9, §4.1 tenant isolation — every server query inherits auth.uid()).
 *
 * Two flavors:
 *  - getServerSupabase(): for Server Components / Route Handlers, uses next/headers cookies.
 *  - getMiddlewareSupabase(req, res): for middleware, mutates the response cookies.
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { NextRequest, NextResponse } from 'next/server';

const URL_FALLBACK = 'http://localhost:54321';
const ANON_FALLBACK = 'public-anon-key-placeholder';

export async function getServerSupabase() {
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? URL_FALLBACK;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ANON_FALLBACK;

  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(items: { name: string; value: string; options: CookieOptions }[]) {
        try {
          for (const { name, value, options } of items) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server components can't set cookies; safe to ignore.
        }
      },
    },
  });
}

export function getMiddlewareSupabase(req: NextRequest, res: NextResponse) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? URL_FALLBACK;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ANON_FALLBACK;

  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(items: { name: string; value: string; options: CookieOptions }[]) {
        for (const { name, value, options } of items) {
          res.cookies.set({ name, value, ...options });
        }
      },
    },
  });
}
