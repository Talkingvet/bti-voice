// server/helpers/syncCallToZoho.js
//
// Centralized Zoho call-sync logic with v1.4.0 wrap-up deferral.
//
// Two responsibilities:
//
//   1. syncCallToZoho(callId): the public entry point. For connected calls
//      lasting >= 15 seconds, this just FLAGS the call as needing wrap-up
//      (needs_wrap_up = TRUE) and returns. The post-call wrap-up screen
//      will fire the actual sync when the agent submits the form. If the
//      agent never submits, the wrap-up sweep job in jobs/wrapUpSweep.js
//      fires the sync after 60 seconds against the auto-matched contact.
//
//      For short calls (< 15 sec) and non-connected calls (missed,
//      voicemail, failed), the sync fires immediately just like before.
//
//   2. fireZohoLogCall(callId, opts): kicks off the actual POST to
//      /api/zoho/log-call in the background. Used by syncCallToZoho's
//      immediate-fire path, by the wrap-up sweep, and by the wrap-up
//      endpoint when the agent submits.
//
// To revert to immediate-fire-always (pre-v1.4.0 behaviour): replace the
// body of syncCallToZoho with a single fireZohoLogCall(callId) call and
// stop reading the wrap-up flag.

const { pool } = require('../db');

const WRAP_UP_MIN_DURATION_SEC = 15;

async function syncCallToZoho(callId, port) {
  if (!process.env.ZOHO_REFRESH_TOKEN) return; // Zoho not configured, skip silently
  if (!callId) return;

  try {
    const queryResult = await pool.query(
      'SELECT duration, status, zoho_logged_at, wrap_up_completed_at ' +
      'FROM calls WHERE id = $1',
      [callId]
    );
    const call = queryResult.rows[0];
    if (!call) return;

    // Guard: if this call was already synced or already wrapped up by the
    // agent, do nothing. Prevents late webhook events from re-raising the
    // "Needs wrap-up" badge after the agent has already dealt with it.
    if (call.zoho_logged_at || call.wrap_up_completed_at) return;

    const isConnected  = call.status === 'completed';
    const isLongEnough = (call.duration || 0) >= WRAP_UP_MIN_DURATION_SEC;

    if (isConnected && isLongEnough) {
      // Defer — let the wrap-up handler or the 60s sweep fire the actual sync
      await pool.query(
        'UPDATE calls SET needs_wrap_up = TRUE WHERE id = $1',
        [callId]
      );
      return;
    }
  } catch (e) {
    console.error('[syncCallToZoho] wrap-up check failed:', e.message);
    // Fall through to immediate sync on any error
  }

  fireZohoLogCall(callId, { port: port });
}

// Fire the actual POST to /api/zoho/log-call. The endpoint stamps
// zoho_logged_at + zoho_call_id on the row so we don't double-sync.
function fireZohoLogCall(callId, opts) {
  const port = (opts && opts.port) || process.env.PORT || 3000;
  const body = { call_id: callId };
  if (opts && opts.zoho_contact_id) body.zoho_contact_id = opts.zoho_contact_id;

  setImmediate(async function() {
    try {
      const url = 'http://localhost:' + port + '/api/zoho/log-call';
      await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
    } catch (e) {
      console.error('[Zoho sync] log-call failed:', e.message);
    }
  });
}

module.exports = { syncCallToZoho, fireZohoLogCall, WRAP_UP_MIN_DURATION_SEC };
