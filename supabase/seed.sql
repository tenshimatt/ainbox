-- Local-dev seed data for Ainbox.
-- Synthesised content only. Addresses use the @ainbox.test sentinel
-- domain so the pre-commit hook (factory rule §8) does not trip.
--
-- This file is run by `supabase db reset` against a LOCAL stack only.
-- Do not run against production. Two synthetic users let us exercise
-- the cross-tenant isolation contract test (c1).

-- Synthetic users live in auth.users; this file assumes those rows
-- already exist (created via `supabase auth signup` or the test
-- harness). Skipping if absent so seed.sql is idempotent.

do $$
declare
  alice_id uuid;
  bob_id   uuid;
begin
  select id into alice_id from auth.users where email = 'alice@ainbox.test' limit 1;
  select id into bob_id   from auth.users where email = 'bob@ainbox.test'   limit 1;

  if alice_id is null or bob_id is null then
    raise notice 'seed: skipping (alice@ainbox.test or bob@ainbox.test not present)';
    return;
  end if;

  insert into public.automation_config (user_id, category, auto_send, threshold)
    values (alice_id, 'sales', false, 0.90)
    on conflict (user_id) do nothing;

  insert into public.automation_config (user_id, category, auto_send, threshold)
    values (bob_id, 'support', false, 0.85)
    on conflict (user_id) do nothing;

  insert into public.kb_items (user_id, type, content, confidence, human_verified)
    values
      (alice_id, 'signature', 'Best, Alice (synthetic).', 0.99, true),
      (bob_id,   'signature', 'Cheers, Bob (synthetic).', 0.99, true);
end
$$;
