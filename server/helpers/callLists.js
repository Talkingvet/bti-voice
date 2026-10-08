// Call Lists — outcome rules + the one place that writes an attempt.
//
// Pure functions first (unit-tested, no DB), then the DB side used by both
// routes/callLists.js (outcome strip, reopen) and routes/calls.js (wrap-up
// hook) so a wrap-up Save and an outcome-strip click behave identically.
// Spec: docs/BTI-Voice-Call-Lists-Plan.md §3 step 3.
const { pool } = require('../db');

const ds = require('./deploySettings');

// Built-in outcomes: the quick strip (no answer / voicemail / busy / wrong
// number) plus the two the server writes itself. Everything else comes from
// the deploy's configured wrap-up outcomes (batch 8): an outcome marked
// keep_open ("expects a callback") keeps the entry on the list, any other
// closes it.
const CLOSING   = new Set(['wrong_number', 'max_attempts', 'removed']);
const RETAINING = new Set(['left_voicemail', 'no_answer', 'busy']);

// Labels for the built-ins + anything stored before outcomes were configurable.
const OUTCOME_LABELS = ds.LEGACY_LABELS;

function isKnownOutcome(o) { return CLOSING.has(o) || RETAINING.has(o) || !!ds.findDisposition(o); }
function isClosing(o) {
  if (CLOSING.has(o)) return true;
  if (RETAINING.has(o)) return false;
  const d = ds.findDisposition(o);
  return d ? !d.keep_open : false;
}
// Label for any outcome code: configured → legacy → humanised.
const outcomeLabel = (code) => ds.dispositionLabel(code);

// applyOutcome(entry, { outcome, callback_at, max_attempts }) → the fields to
// write on the entry. Never mutates its input.
function applyOutcome(entry, { outcome, callback_at = null, max_attempts = null } = {}) {
  if (!isKnownOutcome(outcome)) throw new Error('unknown outcome: ' + outcome);
  const attempts = (entry.attempts || 0) + (outcome === 'removed' ? 0 : 1);
  let status = 'open', last_outcome = outcome, cb = null;
  if (isClosing(outcome)) {
    status = 'done';
  } else {
    // Retaining outcome. A callback date sticks for any of them — "left a
    // voicemail, try again Thursday" is as real as "they asked for Thursday".
    cb = callback_at ? new Date(callback_at) : null;
    if (cb && Number.isNaN(cb.getTime())) cb = null;
    if (Number.isInteger(max_attempts) && max_attempts > 0 && attempts >= max_attempts) {
      status = 'done'; last_outcome = 'max_attempts'; cb = null;
    }
  }
  return { status, attempts, last_outcome, callback_at: cb, closed: status === 'done' };
}

// Default working order for the Remaining view (plan §3 step 2):
// due callbacks first (earliest due), then never-tried oldest-added first,
// then fewest attempts, oldest attempt first.
function compareEntries(a, b, now = Date.now()) {
  const ad = a.callback_at ? new Date(a.callback_at).getTime() : null;
  const bd = b.callback_at ? new Date(b.callback_at).getTime() : null;
  const aDue = ad !== null && ad <= now, bDue = bd !== null && bd <= now;
  if (aDue !== bDue) return aDue ? -1 : 1;
  if (aDue && bDue) return ad - bd;
  // Future callbacks go after untried entries (don't call early).
  const aFut = ad !== null, bFut = bd !== null;
  if (aFut !== bFut) return aFut ? 1 : -1;
  if (aFut && bFut) return ad - bd;
  if ((a.attempts || 0) !== (b.attempts || 0)) return (a.attempts || 0) - (b.attempts || 0);
  const aa = new Date(a.last_attempt_at || a.added_at || 0).getTime();
  const bb = new Date(b.last_attempt_at || b.added_at || 0).getTime();
  return aa - bb;
}

// ── DB side ───────────────────────────────────────────────────────────────────
// Records one attempt against an entry and updates the entry in a transaction.
// Returns the updated entry row, or null if the entry doesn't exist.
async function recordOutcome({ entryId, agentId, outcome, note = null, callbackAt = null, callId = null }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [entry] } = await client.query(
      'SELECT e.*, l.max_attempts FROM call_list_entries e JOIN call_lists l ON l.id = e.list_id ' +
      'WHERE e.id = $1 FOR UPDATE', [entryId]);
    if (!entry) { await client.query('ROLLBACK'); return null; }
    const next = applyOutcome(entry, { outcome, callback_at: callbackAt, max_attempts: entry.max_attempts });
    await client.query(
      'INSERT INTO call_list_attempts (entry_id, call_id, agent_id, outcome, note, callback_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [entryId, callId, agentId, outcome, note, next.callback_at]);
    const { rows: [updated] } = await client.query(
      'UPDATE call_list_entries SET status=$2, attempts=$3, last_outcome=$4, last_attempt_at=NOW(), callback_at=$5, ' +
      '  held_by_agent_id=NULL, held_at=NULL, ' +
      '  closed_at = CASE WHEN $7::boolean THEN NOW() ELSE NULL END, ' +
      '  closed_by_agent_id = CASE WHEN $7::boolean THEN $6::integer ELSE NULL END ' +
      'WHERE id = $1 RETURNING *',
      [entryId, next.status, next.attempts, next.last_outcome, next.callback_at, agentId, next.closed]);
    await client.query('COMMIT');
    notifyList(updated.list_id);
    return updated;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

function notifyList(listId) {
  try {
    const { getIO } = require('../socket');
    const io = getIO();
    if (io) io.emit('call_list_updated', { list_id: listId });
  } catch (e) {
    console.warn('[call-lists] notify failed:', e.message);
  }
}

module.exports = { CLOSING, RETAINING, OUTCOME_LABELS, isKnownOutcome, isClosing, outcomeLabel, applyOutcome, compareEntries, recordOutcome, notifyList };
