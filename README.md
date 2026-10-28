# Exchange Reality Check

> **Just want to read the responses?** See
> [docs/RESULTS-GUIDE.md](docs/RESULTS-GUIDE.md): a from-zero guide to the
> Google Sheet and Supabase, including the one-time setup steps.

A rebuild of *"Studying abroad for a semester — a 5-minute survey"* as a
tap-first, chat-style, gamified micro-survey, instead of a 50-question
Google Form nobody finishes.

**Live logic, zero build step.** `index.html` is the entire app — HTML, CSS
and JS in one file. Open it in a browser and it runs. No `npm install`, no
bundler, no framework.

---

## What's in this repo

| File | What it is |
|---|---|
| `index.html` | The whole app. Open it directly, or host it anywhere static. |
| `supabase/schema.sql` | The database: tables, Row Level Security policies, and the two public aggregate views that power the live "X% of your batch also..." stats. |
| `supabase/2_fix_saving_and_readable_views.sql` | Run after `schema.sql`. The save functions the app writes through, plus owner-only readable views (`responses_readable`, `responses_by_day`, `answer_breakdown`). |
| `docs/RESULTS-GUIDE.md` | How to read results in the Sheet and in Supabase, for non-technical owners. |
| `google-apps-script/sync.gs` | An optional Google Sheets mirror, deployed separately as an Apps Script Web App. |
| `README.md` | This file. |

---

## Why it's built this way

The original form lost people to three things: a false "5 minutes" promise
(closer to 15–20 on the longer branches), email collected before any trust
was earned, and a 9-question-in-a-row "knowledge probe" that felt like an
exam. This version fixes all three — see the long comment at the top of
`index.html` for the exact before/after mapping of every question, including
two things the live form was getting wrong without anyone noticing:

1. **PG students never see the PG-specific question.** The original form's
   "After Section 1 → Go to Section 3" rule skips Section 2 ("PG Specific")
   for *everyone*, not just UG students. This rebuild fires that question
   correctly, based on the respondent's actual programme.
2. **Q18 has 6 options but only 3 follow-up sections existed.** Reading Q28's
   own answer choices ("I was rejected or not selected", "I got selected but
   chose not to go") makes the intended mapping clear, and this rebuild
   makes it explicit in code rather than leaving it implicit.

---

## Setup (takes about 15 minutes)

You chose **both** Supabase (live database) and a Google Sheets mirror. Here's
how to wire each one up. The app works fine with neither configured — it just
runs in **local-only demo mode** (a banner says so), which is a good way to
test the flow before connecting anything.

### 1. Supabase (the real database)

1. Go to [supabase.com](https://supabase.com) → **New project** (the free
   tier is plenty for this).
2. Once it's created: **SQL Editor** → **New query** → paste the entire
   contents of `supabase/schema.sql` → **Run**. This creates all three
   tables, locks them down with Row Level Security (the public app can only
   *insert* its own answers — it can never read anyone else's), and creates
   the two public, PII-free views that power the live stats.
   Then do the same with `supabase/2_fix_saving_and_readable_views.sql`.
   **Both files are required**: the app saves through functions defined in
   the second one.
3. **Project Settings → API**. Copy:
   - **Project URL** → paste into `CONFIG.supabaseUrl` in `index.html`
   - **anon / public key** (not the `service_role` key — that one must
     never appear in client-side code) → paste into `CONFIG.supabaseAnonKey`

That's it — no server to deploy. The browser talks to Supabase directly.

**Reading your results:** Supabase dashboard → **Table Editor**, or write
SQL in the **SQL Editor**. Your own login bypasses Row Level Security, so
you see everything; the public app never can. A starting query:

```sql
select s.branch, s.programme, s.year, a.question_id, a.value
from answers a
join sessions s on s.id = a.session_id
order by s.created_at desc;
```

### 2. Google Sheets mirror (optional, but you asked for it)

1. Create a new Google Sheet (any name).
2. **Extensions → Apps Script**.
3. Delete the placeholder `myFunction() {}` code, paste in the entire
   contents of `google-apps-script/sync.gs`.
4. **Deploy → New deployment** → gear icon → type **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
5. **Deploy**, authorize it when Google asks, then copy the **Web app URL**
   it gives you.
6. Paste that URL into `CONFIG.sheetsWebAppUrl` in `index.html`.

The Sheet builds an **All responses** tab (one row per person, one column
per question, plain-English headings), a **Summary** tab, a **Contacts**
tab, and two raw log tabs. Use the **Survey** menu inside the Sheet to
rebuild or refresh them. When you update `sync.gs` later, redeploy with
*Manage deployments → Edit → New version*, not *New deployment* (that would
change the URL). Treat this Sheet as a convenience
copy for quick browsing — **Supabase is the source of truth** if the two
ever disagree (e.g. if the Sheet sync is briefly down, the app's own retry
queue keeps trying, but it never blocks the Supabase write).

### 3. Host it

Any static host works since it's one file:

- **GitHub Pages** (free, matches this repo): Settings → Pages → Deploy
  from branch → `main` → `/ (root)`. Your survey will be live at
  `https://<you>.github.io/survey_tool/`.
- **Vercel / Netlify**: drag-and-drop the whole folder, or connect the repo.
- Literally anywhere that can serve a static HTML file.

### 4. (Optional) AI-assisted reflections

`CONFIG.enableReflections` is `false` by default — the survey is fully
functional without it. If you want it on: **never put a Gemini API key
directly in `index.html`** — it's client-side code anyone can read. Deploy a
tiny proxy yourself (a Cloudflare Worker is the easiest option, a dozen
lines) that accepts `{ question, answer }`, calls Gemini server-side with
your key, and returns `{ reflection }`. Put that proxy's URL in
`CONFIG.geminiProxyUrl` and flip `enableReflections` to `true`.

---

## How data is structured

Answers are stored **EAV-style** (one row per question answered, not one
giant wide row per respondent) in both Supabase and the Sheets mirror:

```
session_id | question_id        | value
-----------|---------------------|------------------------------
abc-123    | q10_cost_guess      | {"value": 450000, "no_idea": false}
abc-123    | q8_awareness        | "No, this is news to me"
abc-123    | q22_barriers        | ["The cost", "Family wouldn't be comfortable with it"]
```

This is deliberate: every answer saves the instant it's given (so an
abandoned session still leaves usable data), and adding or rewording a
question later is a data edit to the `FLOW` arrays in `index.html`, never a
schema migration.

Contact details (email, phone/WhatsApp) live in a **separate** `contacts`
table — never mixed into the same row as survey answers — so you can share
or export response data without it carrying anyone's contact info along
with it.

---

## Testing locally without any setup

Just open `index.html` in a browser. With `CONFIG.supabaseUrl` /
`sheetsWebAppUrl` left as placeholders, a small banner says you're in demo
mode, and everything persists to `localStorage` only (including resuming
exactly where you left off if you close the tab). This is the fastest way to
walk through the actual question flow and branching before wiring up a
database.

---

## Customizing the flow

Every question lives in one of five arrays near the top of the `<script>`
block in `index.html`: `TIER0`, `TIER1`, `BRANCH_A`, `BRANCH_B`, `BRANCH_C`,
`TIER3`. Each step is a plain object:

```js
{
  id: 'q10_cost_guess',        // becomes the question_id written to the DB — don't change this on a live survey, you'll fork your own stats
  tier: 0,
  type: 'slider',               // info | single | multi_chips | slider | scale | short_text | long_text | reveal | single_from_prior
  title: '...',                 // the question itself
  subtitle: '...',               // optional helper text
  condition: (answers) => bool, // optional — only show this step if true
  optional: true,                // optional — adds a Skip affordance
}
```

Reordering, rewording, or adding a `condition` to a step is enough for most
changes — the router (`advancePointer` / `retreatPointer` in `index.html`)
walks whichever list applies and skips anything whose `condition` fails, so
you don't need to touch the navigation logic itself.
