-- Migration: §7.5 Email sync — incremental delta — pg_cron + pg_net schedule
--
-- PRD §7.5: After initial backfill, switch to delta-token (Outlook) /
-- historyId (Gmail) incremental sync. The email-sync-delta edge function
-- is the cron dispatcher; this migration registers it to run every 60 seconds.
--
-- Prerequisites (enabled by default in Supabase):
--   - pg_cron  (schedules SQL jobs)
--   - pg_net   (makes outbound HTTP requests from SQL)
--   - vault    (stores secrets — supabase_url and cron_secret)
--
-- The two Vault secret names referenced below must be pre-populated in the
-- Supabase dashboard (Settings → Vault) or via the Management API before this
-- migration runs:
--
--   supabase_url   — your project URL, e.g. https://<ref>.supabase.co
--   cron_secret    — value of CRON_SECRET env var (same as edge function secret)
--
-- If you prefer not to use Vault, replace the subselects with literal values
-- and store this migration outside version control.

SELECT cron.schedule(
  'email-sync-delta-60s',        -- job name (unique; idempotent re-run)
  '* * * * *',                   -- every minute (pg_cron minimum granularity)
  $$
  SELECT
    net.http_post(
      url     := (
                   SELECT decrypted_secret
                   FROM   vault.decrypted_secrets
                   WHERE  name = 'supabase_url'
                 ) || '/functions/v1/email-sync-delta',
      headers := jsonb_build_object(
                   'Authorization',
                   'Bearer ' || (
                     SELECT decrypted_secret
                     FROM   vault.decrypted_secrets
                     WHERE  name = 'cron_secret'
                   ),
                   'Content-Type', 'application/json'
                 ),
      body    := '{}'::jsonb
    ) AS request_id
  $$
);
