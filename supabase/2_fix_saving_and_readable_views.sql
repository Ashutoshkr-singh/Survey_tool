-- ============================================================================
-- Exchange Reality Check: fix saving + readable views
-- ============================================================================
-- Run this ONCE, after schema.sql, in Supabase: SQL Editor -> New query ->
-- paste this whole file -> Run. Safe to run again later; it only creates
-- or replaces things, it never deletes data.
--
-- What it does:
--   1. FIXES SAVING. The survey used to save with a direct "upsert". An
--      upsert has to look up the existing row first, and the public key has
--      (deliberately) no permission to read rows, so Postgres rejected every
--      single save with "new row violates row-level security policy". The
--      survey now calls the three functions below instead. They run with the
--      database owner's rights, do the upsert, and return nothing, so the
--      public key still can't read a single answer back.
--   2. PLUGS A LEAK. question_stats was readable by anyone and grouped ALL
--      answers, including names, emails and phone numbers. It now only
--      covers the four multiple-choice questions the survey shows stats for.
--   3. ADDS READABLE VIEWS for you, the owner (open them in Table Editor):
--        responses_readable   one row per person, one column per question
--        responses_by_day     how many started / finished each day
--        answer_breakdown     for every multiple-choice question: each
--                             answer, how many picked it, and the %
--      None of these are readable with the public key.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Save functions (called by index.html via supabase.rpc)
-- ---------------------------------------------------------------------------
create or replace function public.save_session(
  p_id uuid,
  p_programme text default null,
  p_year text default null,
  p_department text default null,
  p_is_pg boolean default null,
  p_branch text default null,
  p_user_agent text default null,
  p_furthest_tier int default 0,
  p_completed_at timestamptz default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into sessions (id, programme, year, department, is_pg, branch, user_agent, furthest_tier, completed_at)
  values (p_id, left(p_programme, 200), left(p_year, 50), left(p_department, 200), p_is_pg,
          left(p_branch, 5), left(p_user_agent, 500), coalesce(p_furthest_tier, 0), p_completed_at)
  on conflict (id) do update set
    programme     = coalesce(excluded.programme, sessions.programme),
    year          = coalesce(excluded.year, sessions.year),
    department    = coalesce(excluded.department, sessions.department),
    is_pg         = coalesce(excluded.is_pg, sessions.is_pg),
    branch        = coalesce(excluded.branch, sessions.branch),
    user_agent    = coalesce(excluded.user_agent, sessions.user_agent),
    furthest_tier = greatest(sessions.furthest_tier, excluded.furthest_tier),
    completed_at  = coalesce(sessions.completed_at, excluded.completed_at),
    updated_at    = now();
end;
$$;

create or replace function public.save_answer(
  p_session_id uuid,
  p_question_id text,
  p_value jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- The first answer (the name) can arrive before the session row does.
  insert into sessions (id) values (p_session_id) on conflict (id) do nothing;
  insert into answers (session_id, question_id, value)
  values (p_session_id, left(p_question_id, 100), coalesce(p_value, 'null'::jsonb))
  on conflict (session_id, question_id) do update set value = excluded.value;
end;
$$;

create or replace function public.save_contact(
  p_session_id uuid,
  p_email text default null,
  p_phone_whatsapp text default null,
  p_ok_followup_contact boolean default false,
  p_ok_junior_contact boolean default false,
  p_ok_interview_contact boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into sessions (id) values (p_session_id) on conflict (id) do nothing;
  insert into contacts (session_id, email, phone_whatsapp, ok_followup_contact, ok_junior_contact, ok_interview_contact)
  values (p_session_id, left(p_email, 320), left(p_phone_whatsapp, 100),
          p_ok_followup_contact, p_ok_junior_contact, p_ok_interview_contact)
  on conflict (session_id) do update set
    email                = excluded.email,
    phone_whatsapp       = excluded.phone_whatsapp,
    ok_followup_contact  = excluded.ok_followup_contact,
    ok_junior_contact    = excluded.ok_junior_contact,
    ok_interview_contact = excluded.ok_interview_contact;
end;
$$;

grant execute on function public.save_session(uuid, text, text, text, boolean, text, text, int, timestamptz) to anon;
grant execute on function public.save_answer(uuid, text, jsonb) to anon;
grant execute on function public.save_contact(uuid, text, text, boolean, boolean, boolean) to anon;

-- ---------------------------------------------------------------------------
-- 2. Public stats: only the four questions the survey actually shows stats
--    for. Nothing personal (names, emails, phones, free text) is exposed.
-- ---------------------------------------------------------------------------
create or replace view question_stats as
select question_id, value, count(*) as n
from answers
where question_id in ('q8_awareness', 'q10_cost_guess', 'q14_cgpa_requirement', 'q16_credits_count')
group by question_id, value;

grant select on question_stats to anon;

-- ---------------------------------------------------------------------------
-- 3. Readable views for the owner
-- ---------------------------------------------------------------------------

-- Turns a stored answer into plain text: lists become "• a  • b", the cost
-- guess becomes "₹6,00,000" or "No idea".
create or replace function public.answer_text(v jsonb) returns text
language sql immutable as $$
  select case jsonb_typeof(v)
    when 'string' then nullif(v #>> '{}', '')
    when 'number' then v #>> '{}'
    when 'boolean' then case when (v #>> '{}')::boolean then 'Yes' else 'No' end
    when 'array' then (select string_agg('• ' || (e #>> '{}'), E'\n') from jsonb_array_elements(v) e)
    when 'object' then
      case
        when (v ->> 'no_idea')::boolean then 'No idea'
        when jsonb_typeof(v -> 'value') = 'number' then '₹' || trim(to_char((v ->> 'value')::numeric, '99,99,99,999'))
        else v::text
      end
    else null
  end
$$;

create or replace view responses_readable with (security_invoker = true) as
select
  row_number() over (order by s.created_at) as "#",
  to_char(s.created_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') as "Started (IST)",
  to_char(s.updated_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') as "Last activity (IST)",
  case
    when s.completed_at is not null then 'Completed'
    else 'Stopped at: ' || (array['Getting started', 'What you know', 'Your story', 'Wrapping up'])[least(s.furthest_tier, 3) + 1]
  end as "Status",
  case s.branch
    when 'A' then 'Never applied'
    when 'B' then 'Started, didn''t finish'
    when 'C' then 'Went / going'
  end as "Group",
  max(public.answer_text(a.value)) filter (where a.question_id = 'respondent_name') as "Name",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q8_awareness') as "Knew exchange was possible?",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q10_cost_guess') as "Cost guess for 1 semester",
  max(public.answer_text(a.value) || ' / 5') filter (where a.question_id = 'q12_confidence') as "Confidence in that guess",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q11_cost_reasoning') as "How they got that number",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q2_programme') as "Programme",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q3_year') as "Year",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q4_department') as "Department",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q5_gender') as "Gender",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q7_family_situation') as "Family could manage a big expense?",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q2pg_availability') as "[PG] Is exchange open to PG students?",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q2pg_detail') as "[PG] What they know about the PG route",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q9_name_university') as "A partner university they can name",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q13_who_handles') as "Who handles exchange at IITR?",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q14_cgpa_requirement') as "Is there a minimum CGPA?",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q14_detail') as "CGPA cutoff they think",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q15_application_window') as "When applications open",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q16_credits_count') as "Do credits count at IITR?",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q18_category') as "Their situation",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q19_unlikely_reason') as "What makes it feel unlikely",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q20_describe_exchange_student') as "What exchange students are like",
  max(public.answer_text(a.value) || ' / 5') filter (where a.question_id = 'q21_sounds_like_you') as "Does that sound like them?",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q22_barriers') as "What held them back",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q22_barriers_other_text') as "Held back by (other)",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q23_biggest_barrier') as "Biggest barrier",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q24_if_removed') as "Would apply if that was gone?",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q24_detail_probably') as "What else would be in the way",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q24_detail_no') as "Why they still wouldn’t",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q25_suggested_by_someone') as "Has anyone suggested they apply?",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q26_how_far') as "How far they got",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q27_moment_stopped') as "The moment they stopped",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q28_decision_or_fade') as "Decision, or did it fade?",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q29_biggest_blocker') as "Biggest blocker",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q29_detail_other') as "Blocker (other)",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q30_hard_wall') as "Hard wall, or fixable?",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q31_info_search') as "What happened when they looked for info",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q32_wrong_belief') as "Something they believed that was wrong",
  max(public.answer_text(a.value) || ' / 5') filter (where a.question_id = 'q33_would_have_gone') as "Would have gone if clearer?",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q34_willing_to_talk') as "Up for a 20-min call?",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q34_contact') as "Phone for the call",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q35_university_country_term') as "Where and when they went",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q36_total_cost') as "Actual total cost",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q37_cost_breakdown') as "Cost breakdown",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q38_blindsided_cost') as "Cost that surprised them",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q39_funding') as "How they paid for it",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q39_funding_other_text') as "Paid for it with (other)",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q40_mapping_experience') as "How credit mapping went",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q41_mapping_story') as "Credit mapping story",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q42_wish_known') as "Wish they had known",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q43_how_found_out') as "How they found out exchange exists",
  max(public.answer_text(a.value) || ' / 5') filter (where a.question_id = 'q44_would_redo') as "Would do it again?",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q45_junior_contact') as "Juniors can contact them?",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q45_contact_detail') as "Contact for juniors",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q46_conversation_at_home') as "Conversation with family",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q47_how_find_opportunities') as "How they hear about opportunities",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q48_missed_too_late') as "Missed something by finding out late",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q49_apply_if') as "“I’d apply if…”",
  max(public.answer_text(a.value) || ' / 5') filter (where a.question_id = 'q50_single_page_usefulness') as "Would use a one-page guide?",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q51_anything_else') as "Anything else",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q52_contact_ok') as "OK to follow up?",
  max(public.answer_text(a.value)) filter (where a.question_id = 'q52_contact_detail') as "Phone for follow-up",
  max(public.answer_text(a.value)) filter (where a.question_id = 'email_signup') as "Email"

from sessions s
left join answers a on a.session_id = s.id
group by s.id
order by s.created_at desc;

create or replace view responses_by_day with (security_invoker = true) as
select
  (s.created_at at time zone 'Asia/Kolkata')::date as "Day",
  count(*) as "Started",
  count(*) filter (where s.completed_at is not null) as "Completed",
  sum(count(*)) over (order by (s.created_at at time zone 'Asia/Kolkata')::date) as "Started (running total)"
from sessions s
group by 1
order by 1 desc;

-- Plain-English name for every question id, in survey order.
create or replace view question_labels with (security_invoker = true) as
select * from (values
    ('respondent_name', 'Name', 0),
    ('q8_awareness', 'Knew exchange was possible?', 1),
    ('q10_cost_guess', 'Cost guess for 1 semester', 2),
    ('q12_confidence', 'Confidence in that guess', 3),
    ('q11_cost_reasoning', 'How they got that number', 4),
    ('q2_programme', 'Programme', 5),
    ('q3_year', 'Year', 6),
    ('q4_department', 'Department', 7),
    ('q5_gender', 'Gender', 8),
    ('q7_family_situation', 'Family could manage a big expense?', 9),
    ('q2pg_availability', '[PG] Is exchange open to PG students?', 10),
    ('q2pg_detail', '[PG] What they know about the PG route', 11),
    ('q9_name_university', 'A partner university they can name', 12),
    ('q13_who_handles', 'Who handles exchange at IITR?', 13),
    ('q14_cgpa_requirement', 'Is there a minimum CGPA?', 14),
    ('q14_detail', 'CGPA cutoff they think', 15),
    ('q15_application_window', 'When applications open', 16),
    ('q16_credits_count', 'Do credits count at IITR?', 17),
    ('q18_category', 'Their situation', 18),
    ('q19_unlikely_reason', 'What makes it feel unlikely', 19),
    ('q20_describe_exchange_student', 'What exchange students are like', 20),
    ('q21_sounds_like_you', 'Does that sound like them?', 21),
    ('q22_barriers', 'What held them back', 22),
    ('q22_barriers_other_text', 'Held back by (other)', 23),
    ('q23_biggest_barrier', 'Biggest barrier', 24),
    ('q24_if_removed', 'Would apply if that was gone?', 25),
    ('q24_detail_probably', 'What else would be in the way', 26),
    ('q24_detail_no', 'Why they still wouldn’t', 27),
    ('q25_suggested_by_someone', 'Has anyone suggested they apply?', 28),
    ('q26_how_far', 'How far they got', 29),
    ('q27_moment_stopped', 'The moment they stopped', 30),
    ('q28_decision_or_fade', 'Decision, or did it fade?', 31),
    ('q29_biggest_blocker', 'Biggest blocker', 32),
    ('q29_detail_other', 'Blocker (other)', 33),
    ('q30_hard_wall', 'Hard wall, or fixable?', 34),
    ('q31_info_search', 'What happened when they looked for info', 35),
    ('q32_wrong_belief', 'Something they believed that was wrong', 36),
    ('q33_would_have_gone', 'Would have gone if clearer?', 37),
    ('q34_willing_to_talk', 'Up for a 20-min call?', 38),
    ('q34_contact', 'Phone for the call', 39),
    ('q35_university_country_term', 'Where and when they went', 40),
    ('q36_total_cost', 'Actual total cost', 41),
    ('q37_cost_breakdown', 'Cost breakdown', 42),
    ('q38_blindsided_cost', 'Cost that surprised them', 43),
    ('q39_funding', 'How they paid for it', 44),
    ('q39_funding_other_text', 'Paid for it with (other)', 45),
    ('q40_mapping_experience', 'How credit mapping went', 46),
    ('q41_mapping_story', 'Credit mapping story', 47),
    ('q42_wish_known', 'Wish they had known', 48),
    ('q43_how_found_out', 'How they found out exchange exists', 49),
    ('q44_would_redo', 'Would do it again?', 50),
    ('q45_junior_contact', 'Juniors can contact them?', 51),
    ('q45_contact_detail', 'Contact for juniors', 52),
    ('q46_conversation_at_home', 'Conversation with family', 53),
    ('q47_how_find_opportunities', 'How they hear about opportunities', 54),
    ('q48_missed_too_late', 'Missed something by finding out late', 55),
    ('q49_apply_if', '“I’d apply if…”', 56),
    ('q50_single_page_usefulness', 'Would use a one-page guide?', 57),
    ('q51_anything_else', 'Anything else', 58),
    ('q52_contact_ok', 'OK to follow up?', 59),
    ('q52_contact_detail', 'Phone for follow-up', 60),
    ('email_signup', 'Email', 61)
) as t(question_id, question, position);

-- Every multiple-choice style answer, counted. Lists are split so each
-- ticked option counts once; % is out of the people who answered that
-- question (so tick-all-that-apply questions can add up past 100%).
create or replace view answer_breakdown with (security_invoker = true) as
with picks as (
  select a.question_id,
         case when jsonb_typeof(a.value) = 'array' then e.value #>> '{}' else public.answer_text(a.value) end as answer
  from answers a
  left join lateral jsonb_array_elements(case when jsonb_typeof(a.value) = 'array' then a.value else '[]'::jsonb end) e on true
  where a.question_id in (
    'q8_awareness', 'q12_confidence', 'q2_programme', 'q3_year', 'q5_gender', 'q7_family_situation',
    'q2pg_availability', 'q14_cgpa_requirement', 'q15_application_window', 'q16_credits_count', 'q18_category',
    'q21_sounds_like_you', 'q22_barriers', 'q23_biggest_barrier', 'q24_if_removed', 'q25_suggested_by_someone',
    'q26_how_far', 'q28_decision_or_fade', 'q29_biggest_blocker', 'q30_hard_wall', 'q31_info_search',
    'q33_would_have_gone', 'q34_willing_to_talk', 'q39_funding', 'q40_mapping_experience', 'q44_would_redo',
    'q45_junior_contact', 'q47_how_find_opportunities', 'q50_single_page_usefulness', 'q52_contact_ok'
  )
)
select
  coalesce(l.question, p.question_id) as "Question",
  coalesce(p.answer, '(skipped)') as "Answer",
  count(*) as "People",
  round(100.0 * count(*) / max(t.answered), 1) as "% of people who answered"
from picks p
join (select question_id, count(*) as answered from answers group by question_id) t on t.question_id = p.question_id
left join question_labels l on l.question_id = p.question_id
group by p.question_id, l.question, l.position, p.answer
order by l.position, count(*) desc;

-- Owner-only: the public key must never be able to read these.
revoke all on responses_readable, responses_by_day, answer_breakdown, question_labels from anon, authenticated;
