-- AINBOX-30: §7.5 Email sync — incremental delta via pg_cron + pg_net.
--
-- Schedules two cron jobs that POST to the edge function endpoints every
-- 60 seconds, triggering incremental delta sync for all connected users.
--
-- Prerequisites:
--   - pg_cron extension (available in Supabase hosted Postgres)
--   - pg_net extension (available in Supabase hosted Postgres)
--   - app.next_base_url Postgres setting pointing at the Next.js deployment
--   - app.cron_secret Postgres setting matching CRON_SECRET env var
--
-- To set the required settings in Supabase, run:
--   ALTER DATABASE postgres SET "app.next_base_url" = 'https://your-app.vercel.app';
--   ALTER DATABASE postgres SET "app.cron_secret" = '<your-cron-secret>';
--
-- The jobs are unscheduled-safe: running this migration twice is idempotent
-- because we unschedule before scheduling.

-- Extensions ----------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Unschedule existing jobs (idempotency) ------------------------------------

SELECT cron.unschedule('ainbox-email-sync-gmail-delta')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'ainbox-email-sync-gmail-delta'
);

SELECT cron.unschedule('ainbox-email-sync-outlook-delta')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'ainbox-email-sync-outlook-delta'
);

-- Gmail incremental delta — every 60 seconds (pg_cron minimum is 1 minute) --

SELECT cron.schedule(
  'ainbox-email-sync-gmail-delta',
  '* * * * *',   -- every minute (§7.5: "every 60s")
  $$
  SELECT net.http_post(
    url     := current_setting('app.next_base_url') || '/api/edge/email-sync-gmail',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || current_setting('app.cron_secret')
               ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Outlook incremental delta — every 60 seconds ------------------------------

SELECT cron.schedule(
  'ainbox-email-sync-outlook-delta',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.next_base_url') || '/api/edge/email-sync-outlook',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || current_setting('app.cron_secret')
               ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Confirm scheduled jobs (output visible in migration logs) -----------------

SELECT jobname, schedule, command
FROM cron.job
WHERE jobname IN (
  'ainbox-email-sync-gmail-delta',
  'ainbox-email-sync-outlook-delta'
);
