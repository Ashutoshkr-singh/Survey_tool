/**
 * ============================================================================
 * Exchange Reality Check — Google Sheets mirror
 * ============================================================================
 * This is NOT run from this repo. It's deployed separately inside a Google
 * Sheet, as that Sheet's bound Apps Script project. See README.md for the
 * full "how to deploy" walkthrough — short version:
 *
 *   1. Create a new Google Sheet.
 *   2. Extensions → Apps Script.
 *   3. Delete the placeholder code, paste this whole file in.
 *   4. Deploy → New deployment → type "Web app" →
 *        Execute as: Me
 *        Who has access: Anyone
 *      Deploy, then copy the Web App URL it gives you.
 *   5. Paste that URL into index.html's CONFIG.sheetsWebAppUrl.
 *
 * What this does:
 *   The web app (index.html) is the source of truth and writes straight to
 *   Supabase. In parallel, it ALSO POSTs each answer here as a best-effort
 *   mirror, so you can browse responses in a normal spreadsheet without
 *   touching SQL. If this endpoint is slow, down, or misconfigured, the
 *   survey itself is unaffected — the client queues and retries writes to
 *   THIS endpoint independently of its Supabase writes (see app.js's
 *   `queueWrite` / retry logic). Treat this Sheet as a convenience copy,
 *   never as the record of truth — Supabase (via RLS, append-only from the
 *   client) is harder to accidentally overwrite.
 *
 * Sheet layout (one tab, "Responses", created automatically on first write):
 *   session_id | question_id | value | created_at
 * That's a long/EAV layout to match the Supabase `answers` table exactly —
 * easiest way to keep the two mirrors honest with each other. If you want a
 * wide, one-row-per-respondent pivot for reading, build a Pivot Table or a
 * QUERY() formula on a second tab rather than reshaping this one; reshaping
 * the raw tab risks silently dropping data on the next sync.
 * ============================================================================
 */

var SHEET_NAME = 'Responses';
var CONTACTS_SHEET_NAME = 'Contacts';

/**
 * Handles POST requests from the web app.
 * Expected JSON body shapes (see index.html's postToSheets()):
 *   { kind: 'answer',  session_id, question_id, value, created_at }
 *   { kind: 'contact', session_id, email, phone_whatsapp,
 *                      ok_followup_contact, ok_junior_contact,
 *                      ok_interview_contact, created_at }
 *   { kind: 'session', session_id, created_at, programme, year,
 *                      department, is_pg, branch, user_agent }
 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (body.kind === 'answer') {
      appendRow_(ss, SHEET_NAME,
        ['session_id', 'question_id', 'value', 'created_at'],
        [body.session_id, body.question_id,
         typeof body.value === 'string' ? body.value : JSON.stringify(body.value),
         body.created_at || new Date().toISOString()]);

    } else if (body.kind === 'contact') {
      appendRow_(ss, CONTACTS_SHEET_NAME,
        ['session_id', 'email', 'phone_whatsapp', 'ok_followup_contact',
         'ok_junior_contact', 'ok_interview_contact', 'created_at'],
        [body.session_id, body.email || '', body.phone_whatsapp || '',
         !!body.ok_followup_contact, !!body.ok_junior_contact,
         !!body.ok_interview_contact, body.created_at || new Date().toISOString()]);

    } else if (body.kind === 'session') {
      appendRow_(ss, 'Sessions',
        ['session_id', 'created_at', 'programme', 'year', 'department',
         'is_pg', 'branch', 'user_agent'],
        [body.session_id, body.created_at || new Date().toISOString(),
         body.programme || '', body.year || '', body.department || '',
         !!body.is_pg, body.branch || '', body.user_agent || '']);

    } else {
      return jsonResponse_({ ok: false, error: 'unknown kind: ' + body.kind });
    }

    return jsonResponse_({ ok: true });

  } catch (err) {
    // Never let a malformed request 500 silently — log it so you can see
    // sync problems in Apps Script's execution log, and tell the client
    // clearly so its retry queue doesn't spin forever on a request that
    // will never succeed (e.g. bad JSON).
    Logger.log('sync.gs error: ' + err + '\n' + (e && e.postData && e.postData.contents));
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

/** Simple GET handler so you can sanity-check the deployment in a browser. */
function doGet(e) {
  return jsonResponse_({ ok: true, message: 'Exchange Reality Check sync endpoint is live.' });
}

/** Appends a row to `sheetName`, creating the sheet + header row if it doesn't exist yet. */
function appendRow_(ss, sheetName, headers, row) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow(row);
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
