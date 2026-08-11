// server/jobs/wrapUpSweep.js
//
// Every 30 seconds, look for connected calls (>= 15s) that ended more than
// 60 seconds ago and still haven't been synced to Zoho. Fire the sync
// against the auto-matched contact (since the agent didn't pick one in time
// via the post-call wrap-up screen).
//
// The needs_wrap_up flag stays TRUE so the "Needs wrap-up" badge persists
// until the agent actually fills out the screen — the sweep just makes sure
// the Zoho activity record never gets lost.
//
// To disable the sweep: comment out startWrapUpSweep() in server/index.js.

const { pool }            = require('../db');
const { fireZohoLogCall } = require('../helpers/syncCallToZoho');

const SWEEP_INTERVAL_MS    = 30 * 1000; // every 30 sec
const TIMEOUT_THRESHOLD_S  = 60;        // calls older than 60 sec

let timer = null;

function startWrapUpSweep() {
  if (timer) return;
  timer = setInterval(async function() {
    try {
      // Exponential backoff: attempt N waits 30s * 2^N since the last attempt
      // (30s, 1m, 2m, 4m, 8m, 16m, 32m). After MAX_ATTEMPTS we stamp
      // zoho_logged_at to permanently stop retrying — without this cap, a call
      // whose number has no Zoho match is retried every 30s forever (this
      // burned ~50K Zoho API credits/day in Aug 2026).
      const MAX_ATTEMPTS = 8;
      const result = await pool.query(
        'SELECT id, zoho_sync_attempts FROM calls ' +
        'WHERE needs_wrap_up = TRUE ' +
        '  AND zoho_logged_at IS NULL ' +
        '  AND ended_at IS NOT NULL ' +
        "  AND ended_at < NOW() - INTERVAL '" + TIMEOUT_THRESHOLD_S + " seconds'" +
        '  AND COALESCE(zoho_sync_attempts, 0) < ' + MAX_ATTEMPTS + ' ' +
        "  AND (zoho_sync_last_attempt IS NULL OR zoho_sync_last_attempt < NOW() - (INTERVAL '30 seconds' * POWER(2, COALESCE(zoho_sync_attempts, 0))))"
      );
      for (const row of result.rows) {
        const attempt = (row.zoho_sync_attempts || 0) + 1;
        await pool.query(
          'UPDATE calls SET zoho_sync_attempts = $2, zoho_sync_last_attempt = NOW() WHERE id = $1',
          [row.id, attempt]
        );
        if (attempt >= MAX_ATTEMPTS) {
          // Final attempt: stamp so this row can never re-enter the sweep,
          // regardless of whether the attempt below succeeds.
          await pool.query(
            'UPDATE calls SET zoho_logged_at = NOW() WHERE id = $1 AND zoho_logged_at IS NULL',
            [row.id]
          );
          console.warn('[wrap-up sweep] Call', row.id, 'reached max Zoho sync attempts — giving up');
        }
        console.log('[wrap-up sweep] Auto-syncing un-wrapped call', row.id, '(attempt ' + attempt + ')');
        fireZohoLogCall(row.id);
      }
    } catch (e) {
      console.error('[wrap-up sweep]', e.message);
    }
  }, SWEEP_INTERVAL_MS);
  console.log('[wrap-up sweep] started — every ' + (SWEEP_INTERVAL_MS / 1000) + 's, threshold ' + TIMEOUT_THRESHOLD_S + 's');
}

function stopWrapUpSweep() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { startWrapUpSweep, stopWrapUpSweep };
