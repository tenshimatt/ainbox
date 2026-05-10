-- AINBOX-30: pg_cron + pg_net for incremental delta sync scheduling.
-- PRD §7.5 — run email sync every 60s (pg_cron minimum granularity = 1 minute).
--
-- Pre-requisites — set these on the Supabase project before enabling the cron:
--
--   ALTER DATABASE postgres
--     SET app.settings.cron_endpoint = 'https://<your-vercel-url>';
--   ALTER DATABASE postgres
--     SET app.settings.cron_secret  = '<CRON_SECRET>';
--
-- The values are read at job execution time from database config so they are
-- never stored in plaintext in migrations (PRD §4.1 — no secrets in repo).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove prior schedule if this migration is re-run (idempotent).
DELETE FROM cron.job WHERE jobname = 'ainbox-email-incremental-sync';

-- Schedule every minute (= 60s per PRD §7.5).
-- net.http_get fires the Next.js cron handler on Vercel.
-- Timeout = 55s so the job finishes within the 60s window.
SELECT cron.schedule(
  'ainbox-email-incremental-sync',
  '* * * * *',
  $cron$
  SELECT net.http_get(
    url        := current_setting('app.settings.cron_endpoint', true)
                    || '/api/cron/email-sync',
    headers    := jsonb_build_object(
                    'Authorization',
                    'Bearer ' || coalesce(
                      current_setting('app.settings.cron_secret', true), ''
                    )
                  ),
    timeout_milliseconds := 55000
  ) AS request_id;
  $cron$
);
