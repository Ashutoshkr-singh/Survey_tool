/**
 * ============================================================================
 * Exchange Reality Check: Google Sheets sync
 * ============================================================================
 * Lives inside the Google Sheet (Extensions -> Apps Script), not in this
 * repo's website. See docs/RESULTS-GUIDE.md for step-by-step setup.
 *
 * What you see in the Sheet:
 *   All responses   ONE ROW PER PERSON. Columns are the questions, in survey
 *                   order, with plain-English headings. Updates live as
 *                   people answer, so half-finished responses show too.
 *   Summary         Totals, responses per day (with a chart) and, for every
 *                   multiple-choice question, how many people picked what.
 *                   Refreshes itself when someone finishes, or use the
 *                   "Survey" menu -> "Refresh summary".
 *   Contacts        Emails / phone numbers from people who agreed to it.
 *   Raw answers,    The original one-line-per-answer log, kept as a backup.
 *   Raw sessions    You don't need to read these. "All responses" can be
 *                   rebuilt from them at any time (Survey menu).
 *
 * After pasting a new version of this file you must REDEPLOY or the old
 * code keeps running: Deploy -> Manage deployments -> pencil icon ->
 * Version: "New version" -> Deploy. (Do NOT use "New deployment": that
 * creates a new URL, and the survey would keep posting to the old one.)
 * ============================================================================
 */

var TAB_READABLE = 'All responses';
var TAB_SUMMARY = 'Summary';
var TAB_RAW_ANSWERS = 'Raw answers';
var TAB_RAW_SESSIONS = 'Raw sessions';
var TAB_CONTACTS = 'Contacts';
var TZ = 'Asia/Kolkata';

// [question id, column heading, section]. Order = column order.
var QUESTIONS = [
  ["respondent_name", "Name", 0],
  ["q8_awareness", "Knew exchange was possible?", 0],
  ["q10_cost_guess", "Cost guess for 1 semester", 0],
  ["q12_confidence", "Confidence in that guess", 0],
  ["q11_cost_reasoning", "How they got that number", 0],
  ["q2_programme", "Programme", 0],
  ["q3_year", "Year", 0],
  ["q4_department", "Department", 0],
  ["q5_gender", "Gender", 0],
  ["q7_family_situation", "Family could manage a big expense?", 0],
  ["q2pg_availability", "[PG] Is exchange open to PG students?", 1],
  ["q2pg_detail", "[PG] What they know about the PG route", 1],
  ["q9_name_university", "A partner university they can name", 1],
  ["q13_who_handles", "Who handles exchange at IITR?", 1],
  ["q14_cgpa_requirement", "Is there a minimum CGPA?", 1],
  ["q14_detail", "CGPA cutoff they think", 1],
  ["q15_application_window", "When applications open", 1],
  ["q16_credits_count", "Do credits count at IITR?", 1],
  ["q18_category", "Their situation", 1],
  ["q19_unlikely_reason", "What makes it feel unlikely", 2],
  ["q20_describe_exchange_student", "What exchange students are like", 2],
  ["q21_sounds_like_you", "Does that sound like them?", 2],
  ["q22_barriers", "What held them back", 2],
  ["q22_barriers_other_text", "Held back by (other)", 2],
  ["q23_biggest_barrier", "Biggest barrier", 2],
  ["q24_if_removed", "Would apply if that was gone?", 2],
  ["q24_detail_probably", "What else would be in the way", 2],
  ["q24_detail_no", "Why they still wouldn’t", 2],
  ["q25_suggested_by_someone", "Has anyone suggested they apply?", 2],
  ["q26_how_far", "How far they got", 2],
  ["q27_moment_stopped", "The moment they stopped", 2],
  ["q28_decision_or_fade", "Decision, or did it fade?", 2],
  ["q29_biggest_blocker", "Biggest blocker", 2],
  ["q29_detail_other", "Blocker (other)", 2],
  ["q30_hard_wall", "Hard wall, or fixable?", 2],
  ["q31_info_search", "What happened when they looked for info", 2],
  ["q32_wrong_belief", "Something they believed that was wrong", 2],
  ["q33_would_have_gone", "Would have gone if clearer?", 2],
  ["q34_willing_to_talk", "Up for a 20-min call?", 2],
  ["q34_contact", "Phone for the call", 2],
  ["q35_university_country_term", "Where and when they went", 2],
  ["q36_total_cost", "Actual total cost", 2],
  ["q37_cost_breakdown", "Cost breakdown", 2],
  ["q38_blindsided_cost", "Cost that surprised them", 2],
  ["q39_funding", "How they paid for it", 2],
  ["q39_funding_other_text", "Paid for it with (other)", 2],
  ["q40_mapping_experience", "How credit mapping went", 2],
  ["q41_mapping_story", "Credit mapping story", 2],
  ["q42_wish_known", "Wish they had known", 2],
  ["q43_how_found_out", "How they found out exchange exists", 2],
  ["q44_would_redo", "Would do it again?", 2],
  ["q45_junior_contact", "Juniors can contact them?", 2],
  ["q45_contact_detail", "Contact for juniors", 2],
  ["q46_conversation_at_home", "Conversation with family", 3],
  ["q47_how_find_opportunities", "How they hear about opportunities", 3],
  ["q48_missed_too_late", "Missed something by finding out late", 3],
  ["q49_apply_if", "“I’d apply if…”", 3],
  ["q50_single_page_usefulness", "Would use a one-page guide?", 3],
  ["q51_anything_else", "Anything else", 3],
  ["q52_contact_ok", "OK to follow up?", 3],
  ["q52_contact_detail", "Phone for follow-up", 3],
  ["email_signup", "Email", 3]
];
var SECTIONS = ['Getting started', 'What you know', 'Your story', 'Wrapping up'];
var SCALES = ['q12_confidence', 'q21_sounds_like_you', 'q33_would_have_gone', 'q44_would_redo', 'q50_single_page_usefulness'];
var GROUPS = { A: 'Never applied', B: "Started, didn't finish", C: 'Went / going' };

// Questions counted in the Summary tab (multiple choice and 1-5 scales).
var BREAKDOWN = [
  'q8_awareness', 'q12_confidence', 'q2_programme', 'q3_year', 'q5_gender', 'q7_family_situation',
  'q2pg_availability', 'q14_cgpa_requirement', 'q15_application_window', 'q16_credits_count', 'q18_category',
  'q21_sounds_like_you', 'q22_barriers', 'q23_biggest_barrier', 'q24_if_removed', 'q25_suggested_by_someone',
  'q26_how_far', 'q28_decision_or_fade', 'q29_biggest_blocker', 'q30_hard_wall', 'q31_info_search',
  'q33_would_have_gone', 'q34_willing_to_talk', 'q39_funding', 'q40_mapping_experience', 'q44_would_redo',
  'q45_junior_contact', 'q47_how_find_opportunities', 'q50_single_page_usefulness', 'q52_contact_ok'
];

var FIXED_COLS = ['#', 'Name', 'Started (IST)', 'Last activity (IST)', 'Status', 'Group'];
var ID_COL = 'Response ID';

/* ===========================================================================
   Web endpoint (the survey POSTs here)
   ========================================================================= */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var body = JSON.parse(e.postData.contents);
    lock.waitLock(20000);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureTabs_(ss);
    var when = body.created_at || new Date().toISOString();

    if (body.kind === 'answer') {
      appendRaw_(ss, TAB_RAW_ANSWERS, ['session_id', 'question_id', 'value', 'created_at'],
        [body.session_id, body.question_id, typeof body.value === 'string' ? body.value : JSON.stringify(body.value), when]);
      upsertPerson_(ss, body.session_id, when, function (set) { applyAnswer_(set, body.question_id, body.value); });

    } else if (body.kind === 'session') {
      appendRaw_(ss, TAB_RAW_SESSIONS,
        ['session_id', 'created_at', 'programme', 'year', 'department', 'is_pg', 'branch', 'user_agent', 'furthest_tier', 'completed_at'],
        [body.session_id, when, body.programme || '', body.year || '', body.department || '', !!body.is_pg,
         body.branch || '', body.user_agent || '', body.furthest_tier || 0, body.completed_at || '']);
      upsertPerson_(ss, body.session_id, when, function (set) { applySession_(set, body); });
      if (body.completed_at) maybeRefreshSummary_();

    } else if (body.kind === 'contact') {
      upsertContact_(ss, body, when);

    } else {
      return json_({ ok: false, error: 'unknown kind: ' + body.kind });
    }
    return json_({ ok: true });

  } catch (err) {
    // Logged so problems show in Apps Script -> Executions.
    Logger.log('sync error: ' + err + '\n' + (e && e.postData && e.postData.contents));
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** Open the Web App URL in a browser to check the deployment is live. */
function doGet() {
  return json_({ ok: true, message: 'Exchange Reality Check sync endpoint is live.' });
}

/* ===========================================================================
   "Survey" menu inside the Sheet
   ========================================================================= */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Survey')
    .addItem('Refresh summary', 'refreshSummary')
    .addItem('Rebuild "All responses" from raw data', 'rebuildAllResponses')
    .addToUi();
}

/* ===========================================================================
   All responses: one row per person
   ========================================================================= */

/** Finds (or creates) the person's row, lets `fill` set cells, then writes them. */
function upsertPerson_(ss, sessionId, when, fill) {
  var sheet = readableSheet_(ss);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idCol = headers.indexOf(ID_COL) + 1;
  var row = findRow_(sheet, idCol, sessionId);
  var current = {};
  if (row) {
    var vals = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
    headers.forEach(function (h, i) { current[h] = vals[i]; });
  } else {
    row = sheet.getLastRow() + 1;
    current['#'] = row - 1;
    current['Started (IST)'] = formatTime_(when);
    current[ID_COL] = sessionId;
    current['Status'] = 'Got to: ' + SECTIONS[0];
  }
  var changes = {};
  var set = function (header, value) { changes[header] = value; current[header] = value; };
  set.current = current;
  ['#', 'Started (IST)', 'Status', ID_COL].forEach(function (h) { if (current[h] !== '' && current[h] != null) changes[h] = current[h]; });
  fill(set);
  changes['Last activity (IST)'] = formatTime_(when);
  writeCells_(sheet, row, headers, changes);
}

function applyAnswer_(set, questionId, value) {
  var q = questionById_(questionId);
  var header = q ? q[1] : questionId;
  set(header, formatAnswer_(questionId, value));
  if (questionId === 'email_signup') set('Status', 'Completed');
  else if (q) bumpStatus_(set, q[2]);
  if (questionId === 'q18_category') {
    var g = groupFromSituation_(value);
    if (g) set('Group', g);
  }
}

function applySession_(set, s) {
  if (s.branch && GROUPS[s.branch]) set('Group', GROUPS[s.branch]);
  [['programme', 'Programme'], ['year', 'Year'], ['department', 'Department']].forEach(function (f) {
    if (s[f[0]] && !set.current[f[1]]) set(f[1], String(s[f[0]]));
  });
  if (s.completed_at) set('Status', 'Completed');
  else if (s.furthest_tier != null) bumpStatus_(set, Number(s.furthest_tier) || 0);
}

/** Status only ever moves forward: Getting started -> ... -> Completed. */
function bumpStatus_(set, section) {
  var now = String(set.current['Status'] || '');
  if (now === 'Completed') return;
  var at = SECTIONS.indexOf(now.replace('Got to: ', ''));
  if (section > at) set('Status', 'Got to: ' + SECTIONS[section]);
}

function readableSheet_(ss) {
  var sheet = ss.getSheetByName(TAB_READABLE);
  if (sheet) return sheet;
  sheet = ss.insertSheet(TAB_READABLE, 0);
  var headers = FIXED_COLS.concat(
    QUESTIONS.filter(function (q) { return q[0] !== 'respondent_name'; }).map(function (q) { return q[1]; }),
    [ID_COL]);
  ensureSize_(sheet, 2, headers.length);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  styleReadable_(sheet, headers.length);
  return sheet;
}

function styleReadable_(sheet, nCols) {
  // Everything as plain text, so phone numbers, "2nd", "+91..." etc. stay exactly as typed.
  sheet.getRange(1, 1, sheet.getMaxRows(), nCols).setNumberFormat('@')
    .setWrap(true).setVerticalAlignment('top');
  sheet.getRange(1, 1, 1, nCols)
    .setFontWeight('bold').setBackground('#123049').setFontColor('#F3ECDC');
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
  sheet.setColumnWidth(1, 45);
  sheet.setColumnWidth(2, 130);
  sheet.setColumnWidths(3, 2, 150);
  sheet.setColumnWidths(5, 2, 170);
  if (nCols > 7) sheet.setColumnWidths(7, nCols - 7, 240);
  sheet.setColumnWidth(nCols, 110);
  sheet.setRowHeight(1, 48);
}

function writeCells_(sheet, row, headers, changes) {
  // Unknown question ids (added to the survey later) get a new column.
  Object.keys(changes).forEach(function (h) {
    if (headers.indexOf(h) === -1) {
      headers.push(h);
      ensureSize_(sheet, 1, headers.length);
      sheet.getRange(1, headers.length).setValue(h).setFontWeight('bold').setBackground('#123049').setFontColor('#F3ECDC');
    }
  });
  ensureSize_(sheet, row, headers.length);
  var range = sheet.getRange(row, 1, 1, headers.length);
  var vals = range.getValues()[0];
  headers.forEach(function (h, i) { if (h in changes) vals[i] = safe_(changes[h]); });
  range.setNumberFormat('@').setValues([vals]);
}

function findRow_(sheet, col, id) {
  var last = sheet.getLastRow();
  if (last < 2 || col < 1) return 0;
  var hit = sheet.getRange(2, col, last - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

/* ===========================================================================
   Contacts tab: one row per person who left contact details
   ========================================================================= */
function upsertContact_(ss, b, when) {
  var headers = ['Name', 'Email', 'Phone / WhatsApp', 'OK to follow up', 'OK for juniors to contact', 'OK for a 20-min call', 'Saved (IST)', ID_COL];
  var sheet = ss.getSheetByName(TAB_CONTACTS);
  if (!sheet || sheet.getRange(1, 1).getValue() !== 'Name') {
    if (sheet) sheet.setName('Contacts (old)');
    sheet = ss.insertSheet(TAB_CONTACTS);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#123049').setFontColor('#F3ECDC');
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@');
  }
  var name = '';
  var readable = ss.getSheetByName(TAB_READABLE);
  if (readable) {
    var rh = readable.getRange(1, 1, 1, readable.getLastColumn()).getValues()[0];
    var r = findRow_(readable, rh.indexOf(ID_COL) + 1, b.session_id);
    if (r) name = readable.getRange(r, rh.indexOf('Name') + 1).getValue();
  }
  var yes = function (v) { return v ? 'Yes' : 'No'; };
  var vals = [name, b.email || '', b.phone_whatsapp || '', yes(b.ok_followup_contact), yes(b.ok_junior_contact),
              yes(b.ok_interview_contact), formatTime_(when), b.session_id].map(safe_);
  var row = findRow_(sheet, headers.length, b.session_id) || sheet.getLastRow() + 1;
  ensureSize_(sheet, row, headers.length);
  sheet.getRange(row, 1, 1, headers.length).setNumberFormat('@').setValues([vals]);
}

/* ===========================================================================
   Rebuild "All responses" from the raw log (also imports old responses)
   ========================================================================= */
function rebuildAllResponses() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureTabs_(ss);
    var people = {}; // session_id -> { started, last, answers: {qid: value}, session: {} }
    var person = function (id, when) {
      var p = people[id] || (people[id] = { started: when, last: when, answers: {}, session: {} });
      if (when && (!p.started || new Date(when) < new Date(p.started))) p.started = when;
      if (when && (!p.last || new Date(when) > new Date(p.last))) p.last = when;
      return p;
    };

    var raw = ss.getSheetByName(TAB_RAW_ANSWERS);
    if (raw && raw.getLastRow() > 1) {
      raw.getRange(2, 1, raw.getLastRow() - 1, 4).getValues().forEach(function (r) {
        if (!r[0]) return;
        person(r[0], toIso_(r[3])).answers[r[1]] = parseRaw_(r[2]); // later rows win
      });
    }
    var rs = ss.getSheetByName(TAB_RAW_SESSIONS);
    if (rs && rs.getLastRow() > 1) {
      var h = rs.getRange(1, 1, 1, rs.getLastColumn()).getValues()[0];
      rs.getRange(2, 1, rs.getLastRow() - 1, h.length).getValues().forEach(function (r) {
        if (!r[0]) return;
        var p = person(r[0], toIso_(r[h.indexOf('created_at')]));
        h.forEach(function (key, i) { if (r[i] !== '' && r[i] != null) p.session[key] = r[i]; });
      });
    }

    var old = ss.getSheetByName(TAB_READABLE);
    if (old) { ss.setActiveSheet(old); ss.deleteSheet(old); }
    var sheet = readableSheet_(ss);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    var ids = Object.keys(people).sort(function (a, b) { return new Date(people[a].started) - new Date(people[b].started); });
    var rows = ids.map(function (id, n) {
      var p = people[id];
      var cur = { '#': n + 1, 'Started (IST)': formatTime_(p.started), 'Status': 'Got to: ' + SECTIONS[0] };
      cur[ID_COL] = id;
      var set = function (hh, v) { cur[hh] = v; };
      set.current = cur;
      QUESTIONS.forEach(function (q) { if (q[0] in p.answers) applyAnswer_(set, q[0], p.answers[q[0]]); });
      Object.keys(p.answers).forEach(function (qid) { if (!questionById_(qid)) applyAnswer_(set, qid, p.answers[qid]); });
      applySession_(set, p.session);
      cur['Last activity (IST)'] = formatTime_(p.last);
      Object.keys(cur).forEach(function (hh) { if (headers.indexOf(hh) === -1) { headers.push(hh); ensureSize_(sheet, 1, headers.length); sheet.getRange(1, headers.length).setValue(hh); } });
      return cur;
    });
    if (rows.length) {
      var grid = rows.map(function (cur) { return headers.map(function (hh) { return safe_(hh in cur ? cur[hh] : ''); }); });
      ensureSize_(sheet, grid.length + 1, headers.length);
      sheet.getRange(2, 1, grid.length, headers.length).setNumberFormat('@').setValues(grid);
    }
    refreshSummary();
    SpreadsheetApp.getActive().toast('Rebuilt ' + rows.length + ' responses.', 'Survey', 5);
  } finally {
    lock.releaseLock();
  }
}

/* ===========================================================================
   Summary tab
   ========================================================================= */
function maybeRefreshSummary_() {
  // At most once a minute, so a burst of completions doesn't slow the survey.
  var cache = CacheService.getScriptCache();
  if (cache.get('summary_recent')) return;
  cache.put('summary_recent', '1', 60);
  try { refreshSummary(); } catch (err) { Logger.log('summary refresh failed: ' + err); }
}

function refreshSummary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = ss.getSheetByName(TAB_READABLE);
  var sheet = ss.getSheetByName(TAB_SUMMARY) || ss.insertSheet(TAB_SUMMARY, 1);
  sheet.clear();
  sheet.getCharts().forEach(function (c) { sheet.removeChart(c); });
  sheet.setColumnWidth(1, 360);
  sheet.setColumnWidths(2, 2, 110);

  var data = (src && src.getLastRow() > 1) ? src.getRange(1, 1, src.getLastRow(), src.getLastColumn()).getDisplayValues() : [[]];
  var headers = data[0];
  var people = data.slice(1);
  var col = function (h) { return headers.indexOf(h); };
  var out = [];
  var boldRows = [], titleRows = [];
  var line = function (a, b, c) { out.push([a == null ? '' : a, b == null ? '' : b, c == null ? '' : c]); };

  line('Exchange Reality Check: summary'); titleRows.push(out.length);
  line('Last refreshed ' + formatTime_(new Date().toISOString()) + '. Survey menu -> Refresh summary to update.');
  line();

  var completed = people.filter(function (r) { return r[col('Status')] === 'Completed'; }).length;
  line('Overview'); titleRows.push(out.length);
  line('People who started', people.length);
  line('People who finished', completed);
  line('Finish rate', people.length ? Math.round(100 * completed / people.length) + '%' : '-');
  var groupCounts = {};
  people.forEach(function (r) { var g = r[col('Group')] || '(not reached yet)'; groupCounts[g] = (groupCounts[g] || 0) + 1; });
  Object.keys(groupCounts).forEach(function (g) { line('Group: ' + g, groupCounts[g]); });
  line();

  // Responses per day
  line('Responses per day'); titleRows.push(out.length);
  line('Day', 'Started', 'Finished'); boldRows.push(out.length);
  var days = {};
  people.forEach(function (r) {
    var d = String(r[col('Started (IST)')]).split(',')[0];
    if (!d) return;
    days[d] = days[d] || [0, 0];
    days[d][0]++;
    if (r[col('Status')] === 'Completed') days[d][1]++;
  });
  var dayKeys = Object.keys(days).sort(function (a, b) { return new Date(a) - new Date(b); });
  var dayStart = out.length + 1;
  dayKeys.forEach(function (d) { line(d, days[d][0], days[d][1]); });
  var dayEnd = out.length;
  line();

  // Answer breakdowns
  line('How people answered'); titleRows.push(out.length);
  line('(% is out of the people who answered that question. Tick-all questions can add up past 100%.)');
  line();
  BREAKDOWN.forEach(function (qid) {
    var q = questionById_(qid);
    var c = q ? col(q[1]) : -1;
    if (c < 0) return;
    var counts = {}, answered = 0;
    people.forEach(function (r) {
      var v = String(r[c] || '');
      if (!v) return;
      answered++;
      v.split('\n').forEach(function (part) {
        var a = part.replace(/^•\s*/, '').trim() || '(skipped)';
        counts[a] = (counts[a] || 0) + 1;
      });
    });
    if (!answered) return;
    line(q[1], 'People', '%'); boldRows.push(out.length);
    Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).forEach(function (a) {
      line('   ' + a, counts[a], Math.round(100 * counts[a] / answered) + '%');
    });
    line();
  });

  ensureSize_(sheet, out.length, 3);
  sheet.getRange(1, 1, out.length, 3).setValues(out).setWrap(true).setVerticalAlignment('top');
  titleRows.forEach(function (r) { sheet.getRange(r, 1, 1, 3).setFontWeight('bold').setFontSize(12).setBackground('#F3ECDC'); });
  sheet.getRange(1, 1).setFontSize(15);
  boldRows.forEach(function (r) { sheet.getRange(r, 1, 1, 3).setFontWeight('bold').setBorder(false, false, true, false, false, false); });

  if (dayEnd >= dayStart) {
    sheet.insertChart(sheet.newChart()
      .setChartType(Charts.ChartType.LINE)
      .addRange(sheet.getRange(dayStart - 1, 1, dayEnd - dayStart + 2, 3))
      .setNumHeaders(1)
      .setOption('title', 'Responses per day')
      .setOption('legend', { position: 'bottom' })
      .setPosition(2, 5, 0, 0)
      .build());
  }
}

/* ===========================================================================
   Helpers
   ========================================================================= */
function ensureTabs_(ss) {
  // Older versions of this script wrote to "Responses" and "Sessions".
  var rename = function (from, to) {
    var s = ss.getSheetByName(from);
    if (s && !ss.getSheetByName(to)) s.setName(to);
  };
  rename('Responses', TAB_RAW_ANSWERS);
  rename('Sessions', TAB_RAW_SESSIONS);
}

function appendRaw_(ss, name, headers, row) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastColumn() < headers.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  sheet.appendRow(row.map(safe_));
}

/** New tabs start at 1000 x 26; grow them before writing past the edge. */
function ensureSize_(sheet, rows, cols) {
  var maxR = sheet.getMaxRows(), maxC = sheet.getMaxColumns();
  if (rows > maxR) sheet.insertRowsAfter(maxR, rows - maxR + 200);
  if (cols > maxC) sheet.insertColumnsAfter(maxC, cols - maxC);
}

function questionById_(id) {
  for (var i = 0; i < QUESTIONS.length; i++) if (QUESTIONS[i][0] === id) return QUESTIONS[i];
  return null;
}

/** Stored answer -> what a person should read in the cell. */
function formatAnswer_(qid, v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.length ? v.map(function (x) { return '• ' + x; }).join('\n') : '(none ticked)';
  if (typeof v === 'object') {
    if (v.no_idea) return 'No idea';
    if (typeof v.value === 'number') return '₹' + indianNumber_(v.value);
    return JSON.stringify(v);
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return SCALES.indexOf(qid) !== -1 ? v + ' / 5' : String(v);
  var s = String(v).trim();
  if (!s) return '(skipped)';
  if (SCALES.indexOf(qid) !== -1 && /^[1-5]$/.test(s)) return s + ' / 5';
  return s;
}

/** Raw log cells hold JSON for lists / objects / numbers; plain text otherwise. */
function parseRaw_(v) {
  if (typeof v !== 'string') return v;
  var t = v.trim();
  if (/^[\[{]/.test(t) || /^-?\d+(\.\d+)?$/.test(t) || t === 'true' || t === 'false' || t === 'null') {
    try { return JSON.parse(t); } catch (e) { return v; }
  }
  return v;
}

function groupFromSituation_(answer) {
  var a = String(answer || '');
  if (/^I’ve never|^I've never|^I thought/.test(a)) return GROUPS.A;
  if (/^I started|^I applied/.test(a)) return GROUPS.B;
  if (/^I have been/.test(a)) return GROUPS.C;
  return '';
}

function indianNumber_(n) {
  var s = String(Math.round(n));
  if (s.length <= 3) return s;
  var last3 = s.slice(-3), rest = s.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
}

function formatTime_(iso) {
  if (!iso) return '';
  var d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d)) return String(iso);
  return Utilities.formatDate(d, TZ, 'dd MMM yyyy, h:mm a');
}

function toIso_(v) {
  if (v instanceof Date) return v.toISOString();
  return v ? String(v) : '';
}

/** Stops typed answers like "=SUM(...)" or "+91..." being run as formulas. */
function safe_(v) {
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
