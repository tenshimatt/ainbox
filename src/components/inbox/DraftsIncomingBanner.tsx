'use client';

/**
 * DraftsIncomingBanner — shows a dismissible amber banner when new drafts
 * arrive via Supabase Realtime INSERT on the `drafts` table.
 *
 * TASK7544-24: /inbox 'drafts incoming' banner + Realtime auto-prepend
 *
 * Wires to a test hook via CustomEvent('inbox-drafts-incoming-mock') so
 * Playwright tests can simulate draft arrivals without a live socket.
 */

import { useEffect, useCallback, useState } from 'react';
import { getBrowserClient } from '@/lib/supabase';

export function DraftsIncomingBanner() {
  const [count, setCount] = useState(0);
  // Sentinel: true once the test-hook useEffect has run and the event listener
  // is registered. Tests wait for data-testid="drafts-incoming-ready" to be
  // attached before dispatching mock events to avoid a race with SSR hydration.
  const [ready, setReady] = useState(false);

  const addIncoming = useCallback(() => {
    setCount((n) => n + 1);
  }, []);

  const dismiss = useCallback(() => setCount(0), []);

  // Supabase Realtime subscription for new draft INSERTs.
  // Tenant isolation is enforced server-side via RLS (auth.uid()).
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    try {
      const supabase = getBrowserClient();
      const channelName = `drafts-incoming-${Math.random().toString(36).slice(2, 8)}`;
      const channel = supabase.channel(channelName);

      // supabase-js typing for postgres_changes is loose; cast through any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (channel as any).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'drafts' }, () => {
        if (!cancelled) addIncoming();
      });

      channel.subscribe();

      cleanup = () => {
        try {
          supabase.removeChannel(channel);
        } catch {
          /* ignore */
        }
      };
    } catch {
      // No Supabase env in test/SSR fallback — silently skip realtime.
    }

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [addIncoming]);

  // Test hook: dispatch CustomEvent('inbox-drafts-incoming-mock') to simulate
  // a draft arrival from Playwright tests without a live socket.
  // Sets `ready` so tests can wait for the listener to be registered.
  useEffect(() => {
    function onMock() {
      addIncoming();
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('inbox-drafts-incoming-mock', onMock);
      setReady(true);
      return () => window.removeEventListener('inbox-drafts-incoming-mock', onMock);
    }
  }, [addIncoming]);

  return (
    <>
      {/* Mount sentinel: hidden, used by tests to await component hydration */}
      {ready && <span data-testid="drafts-incoming-ready" hidden aria-hidden="true" />}
      {count > 0 && (
        <div
          role="status"
          data-testid="drafts-incoming-banner"
          className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"
        >
          <span>
            <strong>{count}</strong> new draft{count === 1 ? '' : 's'} incoming
          </span>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss drafts incoming banner"
            data-testid="drafts-incoming-dismiss"
            className="ml-4 shrink-0 text-amber-700 hover:text-amber-900"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}

export default DraftsIncomingBanner;
