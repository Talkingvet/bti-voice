// Who should get the DESKTOP / push notification for something that arrived on
// one of our numbers (new text, missed call, voicemail)?
//
// Danny's rule (2026-10-06):
//   1. The number has an OWNER  → only the owner. Owner = the agent whose own
//      number it is (agents.phone_number), else a Number Routing rule that
//      sends the number to one agent (number_routing.destination_type='agent').
//   2. A SHARED number (main line / IVR, no single owner) → whoever the
//      conversation is assigned to (conversations.assigned_agent_id).
//   3. Shared and unassigned → everyone (null), so a new text to the main line
//      can't be missed. Once someone assigns it, only they get the rest.
//
// The in-app bell / badges are unchanged for everyone — this only decides who
// gets the pop-up. The result travels as `notify_agent_ids` (array of agent
// ids, or null = everyone) on the `notification` / `new_voicemail` socket
// payloads; clients built before this field simply ignore it.

const { pool } = require('../db');

// Pure decision — unit-tested. All inputs are "what the DB said", or null.
function pickTargets({ ownerAgentId = null, routedAgentId = null, assignedAgentId = null } = {}) {
  const owner = toId(ownerAgentId) || toId(routedAgentId);
  if (owner) return [owner];
  const assigned = toId(assignedAgentId);
  if (assigned) return [assigned];
  return null; // everyone
}

function toId(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Looks up the pieces and applies pickTargets. Never throws — on any DB error
// it returns null (everyone), which is the safe default.
async function notifyTargetsFor({ toNumber, conversationId } = {}) {
  try {
    const to = (toNumber || '').trim();
    let ownerAgentId = null, routedAgentId = null, assignedAgentId = null;
    if (to && to.startsWith('+')) {
      const { rows: [owner] } = await pool.query(
        'SELECT id FROM agents WHERE phone_number = $1 AND is_active = true LIMIT 1', [to]
      );
      ownerAgentId = owner?.id || null;
      if (!ownerAgentId) {
        const { rows: [rule] } = await pool.query(
          `SELECT destination_value FROM number_routing
           WHERE phone_number = $1 AND is_active = true AND destination_type = 'agent' LIMIT 1`, [to]
        );
        routedAgentId = rule?.destination_value || null;
      }
    }
    if (!ownerAgentId && !routedAgentId && conversationId) {
      const { rows: [conv] } = await pool.query(
        'SELECT assigned_agent_id FROM conversations WHERE id = $1', [conversationId]
      );
      assignedAgentId = conv?.assigned_agent_id || null;
    }
    return pickTargets({ ownerAgentId, routedAgentId, assignedAgentId });
  } catch (e) {
    console.error('[notifyTargets]', e.message);
    return null;
  }
}

module.exports = { pickTargets, notifyTargetsFor };
