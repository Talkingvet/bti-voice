#!/usr/bin/env node
// server/scripts/migrate-notes-to-bti-voice.js
//
// One-time migration: move historical BTI-Voice activity into the BTI_Voice
// Zoho module, then clean up the old auto-created Notes.
//
// Instead of parsing old note text, historical SMS digests and call records are
// REBUILT from our own Postgres (authoritative), using the same helpers the
// live code uses. The old Notes are only ever listed + deleted.
//
// Usage (needs DATABASE_URL + ZOHO_* env vars, e.g. `railway run` or local env):
//   node server/scripts/migrate-notes-to-bti-voice.js --sync         # backfill module records from DB
//   node server/scripts/migrate-notes-to-bti-voice.js --list-notes   # write bti-notes-deletion-list.csv for Danny to review
//   node server/scripts/migrate-notes-to-bti-voice.js --delete       # delete the notes in that CSV (ONLY after review)

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { pool } = require('../db');
const { zohoAPI, findRecordByPhone } = require('../zoho');
const { upsertSmsDigest, upsertCallRecord } = require('../helpers/btiVoiceModule');

const CSV_PATH = path.join(__dirname, 'bti-notes-deletion-list.csv');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function resolveByPhone(phone, cache) {
  if (cache.has(phone)) return cache.get(phone);
  let rec = null;
  try { rec = await findRecordByPhone(phone); } catch (e) { /* not found / API blip */ }
  const out = rec ? { id: rec.id, module: rec.module === 'Leads' ? 'Leads' : 'Contacts' } : null;
  cache.set(phone, out);
  return out;
}

// ── --sync: rebuild module records from Postgres ──────────────────────────────
async function sync() {
  const cache = new Map();

  // 1. Every (conversation, local day) that has messages → one digest upsert
  const { rows: days } = await pool.query(
    "SELECT m.conversation_id, co.phone_number, co.name AS contact_name, " +
    "       ((m.sent_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York')::date AS day, " +
    "       MAX(m.sent_at) AS last_at " +
    "FROM messages m " +
    "JOIN conversations c ON c.id = m.conversation_id " +
    "JOIN contacts co ON co.id = c.contact_id " +
    "GROUP BY 1, 2, 3, 4 ORDER BY 4"
  );
  console.log('SMS digest days to sync: ' + days.length);
  let ok = 0, skip = 0, fail = 0;
  for (const d of days) {
    const rec = await resolveByPhone(d.phone_number, cache);
    try {
      await upsertSmsDigest({
        conversationId: d.conversation_id,
        phoneNumber:    d.phone_number,
        contactName:    d.contact_name,
        when:           d.last_at,
        zohoId:         rec && rec.id,
        zohoModule:     rec && rec.module,
      });
      ok++;
    } catch (e) {
      fail++;
      console.error('  digest failed', d.phone_number, String(d.day), e.message);
    }
    await sleep(250); // stay well under Zoho rate limits
  }
  console.log('Digests: ' + ok + ' ok, ' + fail + ' failed');

  // 2. Every call linked to a contact → one call record upsert
  const { rows: calls } = await pool.query(
    "SELECT ca.id, ca.direction, ca.status, ca.duration, ca.started_at, " +
    "       ca.recording_url, ca.transcription, ca.ai_summary, " +
    "       ca.chosen_zoho_contact_id, ca.chosen_zoho_module, " +
    "       co.phone_number, co.name AS contact_name, a.name AS agent_name " +
    "FROM calls ca " +
    "JOIN conversations c ON c.id = ca.conversation_id " +
    "JOIN contacts co ON co.id = c.contact_id " +
    "LEFT JOIN agents a ON a.id = ca.agent_id " +
    "WHERE co.phone_number != 'unknown' " +
    "ORDER BY ca.id"
  );
  console.log('Calls to sync: ' + calls.length);
  ok = 0; fail = 0;
  for (const call of calls) {
    let zohoId = call.chosen_zoho_contact_id, zohoModule = call.chosen_zoho_module;
    if (!zohoId) {
      const rec = await resolveByPhone(call.phone_number, cache);
      if (rec) { zohoId = rec.id; zohoModule = rec.module; }
    }
    if (zohoModule !== 'Leads') zohoModule = 'Contacts';
    try {
      await upsertCallRecord(call, zohoId, zohoModule);
      ok++;
    } catch (e) {
      fail++;
      console.error('  call failed', call.id, e.message);
    }
    await sleep(250);
  }
  console.log('Calls: ' + ok + ' ok, ' + fail + ' failed');
}

// ── --list-notes: find BTI-created notes and write the deletion CSV ───────────
function isBtiNote(n) {
  const title   = n.Note_Title   || '';
  const content = n.Note_Content || '';
  if (title.startsWith('SMS: ') && content.includes('Logged by BTI Voice')) return 'sms';
  if (title.startsWith('Call Summary') && content.startsWith('Call Summary (')) return 'call-summary';
  return null;
}

async function listNotes() {
  const rows = [['note_id', 'kind', 'parent_module', 'parent_id', 'created', 'title']];
  let page = 1, more = true, found = 0, scanned = 0;
  while (more) {
    const res = await zohoAPI('GET',
      '/Notes?fields=id,Note_Title,Note_Content,Parent_Id,Created_Time&per_page=200&page=' + page);
    const data = (res && res.data) || [];
    scanned += data.length;
    for (const n of data) {
      const kind = isBtiNote(n);
      if (!kind) continue;
      found++;
      const parent = n.Parent_Id || {};
      rows.push([
        n.id, kind,
        (parent.module && parent.module.api_name) || '',
        parent.id || '',
        n.Created_Time || '',
        '"' + String(n.Note_Title || '').replace(/"/g, '""') + '"',
      ]);
    }
    more = !!(res && res.info && res.info.more_records);
    page++;
    await sleep(300);
  }
  fs.writeFileSync(CSV_PATH, rows.map(r => r.join(',')).join('\n'));
  console.log('Scanned ' + scanned + ' notes, found ' + found + ' BTI-created.');
  console.log('Deletion list written to ' + CSV_PATH + ' — review with Danny before running --delete.');
}

// ── --delete: delete the notes listed in the CSV ──────────────────────────────
async function deleteNotes() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error('No ' + CSV_PATH + ' — run --list-notes first and have Danny review it.');
    process.exit(1);
  }
  const lines = fs.readFileSync(CSV_PATH, 'utf8').trim().split('\n').slice(1);
  console.log('Deleting ' + lines.length + ' notes…');
  let ok = 0, fail = 0;
  for (const line of lines) {
    const id = line.split(',')[0];
    if (!id) continue;
    try {
      await zohoAPI('DELETE', '/Notes/' + id);
      ok++;
    } catch (e) {
      fail++;
      console.error('  delete failed', id, e.message);
    }
    await sleep(300);
  }
  console.log('Deleted ' + ok + ', failed ' + fail);
}

(async () => {
  const arg = process.argv[2];
  try {
    if      (arg === '--sync')       await sync();
    else if (arg === '--list-notes') await listNotes();
    else if (arg === '--delete')     await deleteNotes();
    else {
      console.log('Usage: node migrate-notes-to-bti-voice.js --sync | --list-notes | --delete');
    }
  } catch (e) {
    console.error('FATAL:', e.message, e.body ? JSON.stringify(e.body) : '');
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
})();
