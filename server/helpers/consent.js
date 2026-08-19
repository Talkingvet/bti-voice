/* Consent audit log (A2P 10DLC / TCPA compliance).
 *
 * Append-only record of every SMS consent event so BTI can answer a carrier
 * or TCR audit ("prove +1XXX opted in / when did they opt out").
 * Writers NEVER throw — consent logging must not break message flow.
 *
 * action: 'opt_in' | 'opt_out'
 * method: sms_keyword   — STOP/START etc. received on the webhook
 *         inbound_sms   — contact initiated the conversation by texting us
 *         carrier_block — Twilio error 21610 (carrier says they opted out)
 *         verbal | web_form | written | other — manually recorded by an agent
 */
const { pool } = require('../db');

async function recordConsent({ contactId = null, phone, action, method, detail = null, messageSid = null, agentId = null }) {
  try {
    if (!phone || !action || !method) return null;
    const { rows: [rec] } = await pool.query(
      `INSERT INTO consent_records (contact_id, phone_number, action, method, detail, message_sid, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [contactId, phone, action, method, detail, messageSid, agentId]
    );
    return rec;
  } catch (e) {
    console.error('[consent] failed to record:', e.message);
    return null;
  }
}

module.exports = { recordConsent };
