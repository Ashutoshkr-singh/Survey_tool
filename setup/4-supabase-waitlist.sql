-- ============================================================================
-- Exchange Reality Check: launch waitlist ("pre-booking")
-- ============================================================================
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run
-- again: it only creates things that don't exist yet or replaces functions.
--
-- One table, two ways in, kept apart by `source`:
--   source = 'survey'   someone finished the survey and ticked "tell me when
--                       it launches". Already interested, so this count
--                       overstates demand.
--   source = 'landing'  someone signed up on the standalone page (join.html).
--                       The honest demand signal.
-- `channel` is the ?from=... tag on the link they used (e.g. hostel-rjb).
-- ============================================================================

create table if not exists waitlist (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  email       text not null,
  source      text not null check (source in ('survey', 'landing')),
  channel     text,
  session_id  uuid references sessions(id) on delete set null,
  unique (email, source)
);
create index if not exists idx_waitlist_source on waitlist (source);

-- Locked down: no policies, so the public key can neither read nor write the
-- table directly. It can only call join_waitlist() below.
alter table waitlist enable row level security;

create or replace function public.join_waitlist(
  p_email text,
  p_source text,
  p_channel text default null,
  p_session_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_email is null or trim(p_email) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email';
  end if;
  if p_source not in ('survey', 'landing') then
    raise exception 'invalid source';
  end if;
  if p_session_id is not null then
    insert into sessions (id) values (p_session_id) on conflict (id) do nothing;
  end if;
  insert into waitlist (email, source, channel, session_id)
  values (lower(trim(left(p_email, 320))), p_source, left(p_channel, 60), p_session_id)
  on conflict (email, source) do update set
    channel    = coalesce(waitlist.channel, excluded.channel),
    session_id = coalesce(waitlist.session_id, excluded.session_id);
end;
$$;

grant execute on function public.join_waitlist(text, text, text, uuid) to anon;

-- Counts only (no emails), so join.html can show "N people are waiting".
create or replace view waitlist_counts as
select source, count(*)::int as n from waitlist group by source;
grant select on waitlist_counts to anon;
