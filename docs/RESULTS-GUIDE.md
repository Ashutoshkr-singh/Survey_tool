# Reading your survey results

A from-zero guide for whoever runs this survey. No coding or database
knowledge needed.

---

## Where your responses go

Every answer is saved to **two places** at the same moment:

| | What it is | Use it for |
|---|---|---|
| **Google Sheet** | A normal spreadsheet | Reading responses day to day. Start here. |
| **Supabase** | An online database (think: a very strict spreadsheet that lives on a server) | The complete, safe copy. Downloads, deeper questions, backup. |

> **Important:** until 12 Oct 2026, Supabase was silently rejecting every
> save (a permissions bug, now fixed). So **all older responses are only in
> the Google Sheet**. Supabase will have everything from the moment you
> finish step 1 below. Nothing was lost; the Sheet has it all.

---

## One-time setup (do these once, about 10 minutes)

### Step 1: Fix Supabase saving and add the readable views

1. Go to [supabase.com](https://supabase.com) and sign in.
2. Click your project (its address starts with `flrlczafuuufdvhebaph`).
3. In the left sidebar, click **SQL Editor** (the icon that looks like `>_`).
4. Click **New query** (or the **+** button).
5. Open the file [`supabase/2_fix_saving_and_readable_views.sql`](../supabase/2_fix_saving_and_readable_views.sql)
   from this repo, select everything, copy it.
6. Paste it into the big empty box in Supabase.
7. Click **Run** (bottom right, or press Ctrl+Enter).
8. You should see **"Success. No rows returned"**. That's correct: this
   file sets things up, it doesn't return data.

If you see a warning about "destructive operations", click **Run this query** to continue.
This file never deletes any data; it only creates or updates the save
functions and views.

### Step 2: Update the Google Sheet script

1. Open your responses Google Sheet.
2. Top menu: **Extensions → Apps Script**. A code editor opens.
3. Click inside the code, press **Ctrl+A** (select all), then **Delete**.
4. Open [`google-apps-script/sync.gs`](../google-apps-script/sync.gs) from
   this repo, copy all of it, and paste it into the empty editor.
5. Click the **save icon** (💾) or press Ctrl+S.
6. Top right: **Deploy → Manage deployments**.
7. Click the **pencil icon** (Edit) on your existing deployment.
8. Under **Version**, choose **New version**. Click **Deploy**.
   - ⚠️ Do **not** click "New deployment". That creates a new web address,
     and the survey would keep sending answers to the old one.
9. If Google asks you to authorise, click through: **Review permissions →
   your account → Advanced → Go to (project name) → Allow**. It's asking
   permission for *your own* script to edit *your own* Sheet.

### Step 3: Turn your existing responses into the readable layout

1. Go back to the Google Sheet tab and **reload the page**.
2. After a few seconds a new menu called **Survey** appears at the top (next to Help).
3. Click **Survey → Rebuild "All responses" from raw data**.
4. Authorise again if asked, then run it once more.
5. You'll get a small popup: *"Rebuilt N responses."*

From now on the Sheet keeps itself up to date. You only repeat step 3 if
something ever looks out of sync.

---

## Reading the Google Sheet

You'll now see these tabs at the bottom:

| Tab | What's in it |
|---|---|
| **All responses** | **One row per person.** Each column is a question, in the order the survey asks them. Fills in live, even while someone is still answering. |
| **Summary** | Totals, finish rate, responses per day (with a chart), and for every multiple-choice question: how many people picked each answer. |
| **Contacts** | People who left an email or phone number and what they agreed to (follow-up, juniors contacting them, a 20-min call). |
| **Raw answers / Raw sessions** | The original one-line-per-answer log. A backup; you don't need to read it. |

The first columns of **All responses** tell you who and how far:

- **Name**: what they typed on the first screen (it's optional, so some rows are blank).
- **Status**: `Completed`, or `Got to: Your story` (how far they got before stopping).
- **Group**: `Never applied`, `Started, didn't finish`, or `Went / going`.
  Each group gets different questions, so empty cells are normal: they
  only answered the questions meant for their group.

**Tips**
- **Read a long answer:** click the cell and read it in the bar above the
  grid, or drag the row taller.
- **Show only one group:** click any cell → **Data → Create a filter**,
  then use the small funnel icon on the **Group** column.
- **Find a person:** Ctrl+F and type their name.
- **Refresh the Summary:** it updates by itself when someone finishes; to
  force it, **Survey → Refresh summary**.
- **Don't edit or sort the raw tabs.** Sorting *All responses* is fine.

---

## Supabase from zero

### The 4 words you need

- **Project**: your whole database. You have one.
- **Table**: like one tab of a spreadsheet. You have three:
  - `sessions`: one row per person who opened the survey
  - `answers`: one row per *answer* (so one person = many rows)
  - `contacts`: emails and phone numbers
- **View**: a ready-made, read-only way of looking at tables. The setup
  file added views made for humans. **Use these instead of the raw
  tables.**
- **SQL**: the language you use to ask a database questions. You don't
  need to learn it; copy the ones below.

### Your readable views

In the left sidebar click **Table Editor** (the grid icon). In the list of
tables you'll also see these views:

| View | What it shows |
|---|---|
| `responses_readable` | **One row per person, one column per question.** Same layout as the Sheet's "All responses". |
| `responses_by_day` | How many started and finished each day, plus a running total. |
| `answer_breakdown` | Every multiple-choice question → each answer → number of people → %. |
| `question_labels` | The question code (e.g. `q22_barriers`) ↔ its plain-English name. |

Click one and it opens like a spreadsheet. Scroll sideways for more
columns. Click a cell to read long text.

### Download everything as a spreadsheet

1. **SQL Editor → New query**
2. Paste: `select * from responses_readable;`
3. **Run**
4. Above the results, click **Export → Download CSV**. Opens in Excel or Google Sheets.

### Handy copy-paste questions

Paste any of these into **SQL Editor → New query → Run**.

```sql
-- Everyone who finished
select * from responses_readable where "Status" = 'Completed';
```

```sql
-- Only people who started an application but dropped it
select * from responses_readable where "Group" = 'Started, didn''t finish';
```

```sql
-- What stops people (most common first)
select * from answer_breakdown where "Question" = 'What held them back';
```

```sql
-- Every "I'd apply if..." answer, newest first
select "Name", "Group", "“I’d apply if…”" from responses_readable
where "“I’d apply if…”" is not null;
```

```sql
-- Average cost guess vs how many said "no idea"
select
  round(avg((value->>'value')::numeric)) as average_guess_rupees,
  count(*) filter (where (value->>'no_idea')::boolean) as said_no_idea,
  count(*) as answered
from answers where question_id = 'q10_cost_guess';
```

### Things you can safely ignore

Authentication, Storage, Edge Functions, Realtime, Database → Roles. This
survey doesn't use them.

### Things to never do

- **Never share or paste the `service_role` key** (Project Settings → API).
  It bypasses all security. The survey only uses the **anon / public** key,
  which is safe to be public: it can save answers but can't read anyone's.
- **Don't delete rows or tables** unless you mean it. There's no undo.

---

## Checking it's all working

After the setup steps, fill in the survey once yourself (put "TEST" as your
name), then:

- **Sheet:** a new row appears in *All responses* within a few seconds.
- **Supabase:** Table Editor → `responses_readable` shows your TEST row.
  (Click the refresh icon if you had it open already.)

If the Sheet updates but Supabase doesn't, step 1 didn't run. Open SQL Editor
and run the file again; it's safe to run more than once.

To remove your test afterwards: delete the row in the Sheet, and in
Supabase run `delete from sessions where id = '<the Response ID column value>';`
(this also removes that person's answers and contact).
