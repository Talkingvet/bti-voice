/**
 * dedup-calls.js — One-time cleanup script for duplicate call log entries.
 *
 * Groups calls by direction + time window (30s) + normalized phone number.
 * Also catches "client:agent_X" ghost contacts (Twilio internal IDs that
 * slipped into the contacts table) paired with real-phone duplicates.
 *
 * Before deleting a loser, merges any data it has that the keeper is missing
 * (recording_url, duration, twilio_call_sid, transcription, ai_summary).
 *
 * Usage:
 *   node scripts/dedup-calls.js           <- dry run
 *   node scripts/dedup-calls.js --execute  <- delete duplicates
 */

const path = require('path');
const dotenvPath = path.join(__dirname, '../server/.env');
if (require('fs').existsSync(dotenvPath)) {
  require(path.join(__dirname, '../server/node_modules/dotenv')).config({ path: dotenvPath });
}

const { Pool } = require(path.join(__dirname, '../server/node_modules/pg'));

const DRY_RUN = !process.argv.includes('--execute');
const WINDOW_SECONDS = 300; // 5 minutes — webhook start_at can lag frontend by 60-90s

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Normalize to last 10 digits. Returns null if unresolvable.
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return null;
}

// True if the contact is a Twilio internal client identifier (never a real caller)
function isClientAgent(r) {
  const name = (r.contact_name || '').toLowerCase();
  const phone = (r.phone_number || '').toLowerCase();
  return name.startsWith('client:') || phone.startsWith('client:');
}

// True if two records are likely the same physical call
function areSameCall(a, b) {
  if (a.direction !== b.direction) return false;
  const ms = Math.abs(new Date(a.started_at) - new Date(b.started_at));
  if (ms > WINDOW_SECONDS * 1000) return false;

  const normA = normalizePhone(a.phone_number);
  const normB = normalizePhone(b.phone_number);

  if (normA && normB) return normA === normB;

  // One known + one unknown: time+direction is enough. Two unknowns: do NOT group (different blocked-number callers).
  // time window + direction is sufficient to call them duplicates
  return true;
}

// Score a record — higher = better keeper.
// client:agent contacts get a massive penalty so real-phone records always win.
function score(r) {
  if (isClientAgent(r)) return -100000;
  const hasRealName = r.contact_name && r.contact_name !== r.phone_number;
  return (r.recording_url && Number(r.duration) > 0 ? 1000 : 0)
       + (hasRealName ? 300 : 0)
       + (Number(r.duration) || 0)
       + (r.twilio_call_sid ? 100 : 0)
       + (r.transcription   ? 500 : 0)
       + (r.ai_summary      ? 200 : 0)
       - r.id * 0.001; // slight preference for lower (earlier) id on ties
}

async function main() {
  console.log(DRY_RUN
    ? 'DRY RUN - no records will be deleted\n'
    : 'EXECUTE MODE - duplicates will be deleted\n'
  );

  const { rows: candidates } = await pool.query(`
    SELECT
      ca.id, ca.direction, ca.duration, ca.status,
      ca.twilio_call_sid, ca.recording_url, ca.started_at,
      ca.agent_id, ca.transcription, ca.ai_summary,
      co.phone_number, co.name AS contact_name
    FROM calls ca
    JOIN conversations cv ON cv.id = ca.conversation_id
    JOIN contacts co      ON co.id = cv.contact_id
    WHERE ca.status != 'voicemail'
    ORDER BY ca.direction, ca.started_at
  `);

  // Group by direction + time window + normalized phone (or unknown)
  const used = new Set();
  const groups = [];

  for (let i = 0; i < candidates.length; i++) {
    if (used.has(i)) continue;
    const anchor = candidates[i];
    const group = [anchor];
    used.add(i);

    for (let j = i + 1; j < candidates.length; j++) {
      if (used.has(j)) continue;
      const next = candidates[j];
      // Past the time window — no need to scan further (results are time-ordered)
      if (new Date(next.started_at) - new Date(anchor.started_at) > WINDOW_SECONDS * 1000) break;
      if (areSameCall(anchor, next)) {
        group.push(next);
        used.add(j);
      }
    }

    if (group.length > 1) groups.push(group);
  }

  if (groups.length === 0) {
    console.log('No duplicate call records found. Nothing to clean up.');
    await pool.end();
    return;
  }

  console.log('Found ' + groups.length + ' duplicate group(s):\n');

  const toDelete = [];
  // Merges to apply before deletion: { keeperId, field, value }
  const toMerge = [];

  for (const group of groups) {
    const scored = group.map(r => ({ ...r, _score: score(r) }));
    scored.sort((a, b) => b._score - a._score);
    const keeper = scored[0];
    const dupes  = scored.slice(1);

    const contactLabel = (keeper.contact_name && keeper.contact_name !== keeper.phone_number)
      ? keeper.contact_name + ' (' + (keeper.phone_number || '?') + ')'
      : (keeper.phone_number || (isClientAgent(keeper) ? keeper.contact_name : 'unknown'));

    console.log('  Contact:   ' + contactLabel);
    console.log('  Direction: ' + keeper.direction + '  |  Time: ' + new Date(keeper.started_at).toLocaleString());
    console.log('  KEEP   id=' + keeper.id
      + '  dur=' + keeper.duration + 's'
      + '  sid=' + (keeper.twilio_call_sid || 'none')
      + '  rec=' + (keeper.recording_url ? 'yes' : 'no'));

    for (const d of dupes) {
      const dLabel = (d.contact_name && d.contact_name !== d.phone_number)
        ? d.contact_name
        : (d.phone_number || (isClientAgent(d) ? d.contact_name : 'unknown'));

      // Check what data the keeper is missing that this dupe has
      const merges = [];
      if (!keeper.recording_url && d.recording_url)   merges.push({ field: 'recording_url', value: d.recording_url });
      if ((!keeper.duration || keeper.duration == 0) && d.duration > 0) merges.push({ field: 'duration', value: d.duration });
      if (!keeper.twilio_call_sid && d.twilio_call_sid) merges.push({ field: 'twilio_call_sid', value: d.twilio_call_sid });
      if (!keeper.transcription && d.transcription)   merges.push({ field: 'transcription', value: d.transcription });
      if (!keeper.ai_summary && d.ai_summary)         merges.push({ field: 'ai_summary', value: d.ai_summary });

      const mergeNote = merges.length > 0
        ? '  [will merge: ' + merges.map(m => m.field).join(', ') + ']'
        : '';

      console.log('  DELETE id=' + d.id
        + '  dur=' + d.duration + 's'
        + '  sid=' + (d.twilio_call_sid || 'none')
        + '  rec=' + (d.recording_url ? 'yes' : 'no')
        + '  contact=' + dLabel
        + mergeNote);

      toDelete.push(d.id);
      for (const m of merges) toMerge.push({ keeperId: keeper.id, ...m });
    }
    console.log('');
  }

  console.log('-----------------------------------------');
  console.log('Total records to delete: ' + toDelete.length);
  if (toMerge.length > 0) console.log('Fields to merge into keepers: ' + toMerge.length);

  if (DRY_RUN) {
    console.log('\nRun with --execute to perform the deletion:');
    console.log('  node scripts/dedup-calls.js --execute\n');
  } else {
    // Apply merges first
    for (const m of toMerge) {
      await pool.query(
        'UPDATE calls SET ' + m.field + ' = $1 WHERE id = $2',
        [m.value, m.keeperId]
      );
      console.log('Merged ' + m.field + ' into call id=' + m.keeperId);
    }
    // Delete duplicates
    console.log('\nDeleting...');
    const { rowCount } = await pool.query(
      'DELETE FROM calls WHERE id = ANY($1::int[])',
      [toDelete]
    );
    console.log('Deleted ' + rowCount + ' duplicate record(s).\n');
  }

  await pool.end();
}

main().catch(async e => {
  console.error('Error:', e.message || e);
  await pool.end();
  process.exit(1);
});
