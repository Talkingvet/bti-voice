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
      const result = await pool.query(
        'SELECT id FROM calls ' +
        'WHERE needs_wrap_up = TRUE ' +
        '  AND zoho_logged_at IS NULL ' +
        '  AND ended_at IS NOT NULL ' +
        "  AND ended_at < NOW() - INTERVAL '" + TIMEOUT_THRESHOLD_S + " seconds'"
      );
      for (const row of result.rows) {
        console.log('[wrap-up sweep] Auto-syncing un-wrapped call', row.id);
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
