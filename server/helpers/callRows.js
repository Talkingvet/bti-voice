// Batch 4b (2026-10-06): a call row is created with status 'in-progress' the
// first time an agent presses Hold (routes/calls.js ensureInProgressRow) so the
// <Dial> recording that completes mid-call has a row to attach to and no other
// logger creates a second one. Whichever logger sees the real end first —
// the status webhook, a <Dial> action webhook, or the app's log-by-phone —
// calls this to fill in duration/status and kick off the Zoho sync.
const { pool } = require('../db');
const { getIO } = require('../socket');
const { syncCallToZoho } = require('./syncCallToZoho');

async function finalizeInProgressCall(callId, { duration = 0, status = 'completed', agentId = null } = {}) {
  const { rows: [call] } = await pool.query(`
    UPDATE calls
       SET duration = GREATEST(COALESCE(duration, 0), $2),
           status   = $3,
           ended_at = NOW(),
           agent_id = COALESCE($4, agent_id)
     WHERE id = $1 AND status = 'in-progress'
     RETURNING *
  `, [callId, parseInt(duration, 10) || 0, status, agentId]);
  if (!call) return null;
  syncCallToZoho(call.id);
  const io = getIO();
  if (io) io.emit('call_logged', { call_id: call.id });
  return call;
}

module.exports = { finalizeInProgressCall };
