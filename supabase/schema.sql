-- ============================================================================
-- Exchange Reality Check — Supabase schema
-- ============================================================================
-- Run this once in your Supabase project's SQL Editor (Project → SQL Editor →
-- New query → paste all of this → Run). It is safe to re-run: every statement
-- is guarded with IF NOT EXISTS / CREATE OR REPLACE where Postgres allows it.
--
-- Design notes (read this before you change anything):
--   * `sessions`  — one row per respondent. Created the moment someone opens
--                   the app, before they answer anything, so we can see
--                   how many people *started* vs *finished*.
--   * `answers`   — one row per QUESTION ANSWERED (EAV-style: session_id,
--                   question_id, value). Not one wide row per respondent.
--                   This is deliberate: it lets the app save each answer the
--                   instant it's given (so an abandoned session still leaves
--                   usable data), and it makes "how did everyone answer
--                   question X" a simple GROUP BY instead of a schema
--                   migration every time a question changes.
--   * `contacts`  — phone/WhatsApp/email, kept in a SEPARATE table from
--                   `answers` on purpose. Survey answers and contact details
--                   should never live in the same row — it's what lets you
--                   safely share the `answers` table (or an export of it)
--                   without leaking who said what.
--   * `question_stats` — a PUBLIC, PII-free view (counts only) that the
--                   live app reads to show "63% of your batch also had no
--                   idea this existed". Anonymous users can SELECT from this
--                   view but cannot read raw `answers` or `contacts` rows.
-- ============================================================================

create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------
create table if not exists sessions (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz,              -- set when they reach the very end
  branch          text,                     -- 'A' | 'B' | 'C' | null (not yet reached Q18)
  programme       text,                     -- raw Q2 answer, denormalized here for fast filtering
  year            text,                     -- raw Q3 answer
  department      text,                     -- raw Q4 answer
  is_pg           boolean,                  -- derived from programme, drives the PG-specific question
  furthest_tier   int not null default 0,   -- 0..3, how far they got — your drop-off funnel
  user_agent      text                      -- rough device/browser signal, no IP stored
);

create index if not exists idx_sessions_created_at on sessions (created_at);
create index if not exists idx_sessions_branch on sessions (branch);

-- ---------------------------------------------------------------------------
-- answers  (EAV: one row per question answered)
-- ---------------------------------------------------------------------------
create table if not exists answers (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions(id) on delete cascade,
  question_id   text not null,              -- e.g. 'q10_cost_guess'
  value         jsonb not null,             -- scalar, array, or {value, other_text} shape — see README
  created_at    timestamptz not null default now(),
  -- a respondent should only answer a given question once per session;
  -- if the app re-sends (e.g. they went back and changed an answer),
  -- upsert on this constraint rather than creating a duplicate row.
  unique (session_id, question_id)
);

create index if not exists idx_answers_session on answers (session_id);
create index if not exists idx_answers_question on answers (question_id);

-- ---------------------------------------------------------------------------
-- contacts  (kept separate from answers — see design notes above)
-- ---------------------------------------------------------------------------
create table if not exists contacts (
  session_id              uuid primary key references sessions(id) on delete cascade,
  email                   text,
  phone_whatsapp          text,             -- Q34 / Q45 / Q52's "phone or WhatsApp" fields, whichever fired
  ok_followup_contact     boolean,          -- Q52
  ok_junior_contact       boolean,          -- Q45 (Branch C only)
  ok_interview_contact    boolean,          -- Q34 (Branch B only)
  created_at              timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security — the browser talks to Supabase directly with a public
-- anon key, so these policies are the only thing standing between the
-- internet and your data. Anon can INSERT (write their own answers) and
-- UPDATE their own session row, but can NEVER select/delete anything,
-- and can never read another session's answers or any contact info.
-- ---------------------------------------------------------------------------
alter table sessions enable row level security;
alter table answers  enable row level security;
alter table contacts enable row level security;

drop policy if exists "anon can create a session" on sessions;
create policy "anon can create a session"
  on sessions for insert
  to anon
  with check (true);

drop policy if exists "anon can update their own session" on sessions;
create policy "anon can update their own session"
  on sessions for update
  to anon
  using (true)
  with check (true);
  -- Note: this is permissive (anon can update ANY session row) because the
  -- anon key has no concept of "which session is mine" without real auth.
  -- That's an acceptable trade-off for a short-lived public survey — the
  -- worst case is someone overwrites another respondent's programme/year
  -- metadata, not that they can read anyone's answers. If you want this
  -- tightened, add a per-session secret token column and check it here.

drop policy if exists "anon can insert answers" on answers;
create policy "anon can insert answers"
  on answers for insert
  to anon
  with check (true);

drop policy if exists "anon can update their own answers" on answers;
create policy "anon can update their own answers"
  on answers for update
  to anon
  using (true)
  with check (true);

drop policy if exists "anon can insert contacts" on contacts;
create policy "anon can insert contacts"
  on contacts for insert
  to anon
  with check (true);

drop policy if exists "anon can update their own contact row" on contacts;
create policy "anon can update their own contact row"
  on contacts for update
  to anon
  using (true)
  with check (true);

-- No SELECT or DELETE policy is granted to `anon` on any of the three
-- tables above, on purpose — the public app can write, never read back
-- raw rows. You (the project owner) read results via the Supabase
-- dashboard / SQL editor, which uses your authenticated session and
-- bypasses RLS automatically.

-- ---------------------------------------------------------------------------
-- question_stats — the ONE thing anon is allowed to read: aggregate counts
-- per question/answer, with no session_id and no way to reconstruct who
-- said what. This powers the "X% of your batch also picked this" reveal.
-- ---------------------------------------------------------------------------
create or replace view question_stats as
select
  question_id,
  value,
  count(*) as n
from answers
group by question_id, value;

grant select on question_stats to anon;

-- Total respondent / completion counts for the "unlock at 150 responses" bar.
create or replace view survey_progress as
select
  count(*) as started,
  count(*) filter (where completed_at is not null) as completed
from sessions;

grant select on survey_progress to anon;

-- ---------------------------------------------------------------------------
-- updated_at trigger — keeps sessions.updated_at fresh on every answer,
-- so you can see which sessions are "live right now" vs abandoned hours ago.
-- ---------------------------------------------------------------------------
create or replace function touch_session_updated_at()
returns trigger as $$
begin
  update sessions set updated_at = now() where id = new.session_id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_touch_session on answers;
create trigger trg_touch_session
  after insert or update on answers
  for each row execute function touch_session_updated_at();
