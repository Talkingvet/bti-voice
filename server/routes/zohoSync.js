// server/routes/zohoSync.js
// Internal endpoints called fire-and-forget after calls/messages are saved.
// Zoho errors are logged but never surface to the user.

const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const { zohoAPI, findContactByPhone } = require('../zoho');

// ── Shared: resolve a Zoho contact ID for a BTI contact ───────────────────────
// Checks the local cache first, then searches Zoho by phone number.
async function resolveZohoId(contactId, phoneNumber) {
  // Check DB cache
  const cached = await pool.query(
    'SELECT zoho_contact_id FROM contacts WHERE id = $1',
    [contactId]
  );
  if (cached.rows[0]?.zoho_contact_id) return cached.rows[0].zoho_contact_id;

  // Live search in Zoho CRM
  const contact = await findContactByPhone(phoneNumber);
  if (!contact) return null;

  // Cache for next time
  await pool.query(
    'UPDATE contacts SET zoho_contact_id = $1, zoho_synced_at = NOW() WHERE id = $2',
    [contact.id, contactId]
  );
  return contact.id;
}

// ── POST /api/zoho/log-call ────────────────────────────────────────────────────
router.post('/log-call', async (req, res) => {
  const { call_id } = req.body;
  if (!call_id) return res.status(400).json({ error: 'call_id required' });

  try {
    // Fetch call details from BTI Voice DB
    const { rows } = await pool.query(`
      SELECT ca.id, ca.direction, ca.status, ca.duration, ca.started_at,
             c.contact_id,
             co.phone_number, co.name AS contact_name,
             a.name AS agent_name
      FROM   calls ca
      LEFT JOIN conversations c  ON c.id  = ca.conversation_id
      LEFT JOIN contacts      co ON co.id = c.contact_id
      LEFT JOIN agents        a  ON a.id  = ca.agent_id
      WHERE  ca.id = $1
    `, [call_id]);

    if (!rows[0]) return res.status(404).json({ error: 'Call not found' });
    const call = rows[0];

    if (!call.contact_id || !call.phone_number) {
      return res.json({ skipped: true, reason: 'No contact linked to this call' });
    }

    // Find matching Zoho contact
    const zohoId = await resolveZohoId(call.contact_id, call.phone_number);
    if (!zohoId) {
      return res.json({ skipped: true, reason: 'Phone number not found in Zoho CRM' });
    }

    const callType = call.direction === 'inbound' ? 'Inbound' : 'Outbound';
    const durationSec = call.duration || 0;
    const hh = String(Math.floor(durationSec / 3600)).padStart(2, '0');
    const mm = String(Math.floor((durationSec % 3600) / 60)).padStart(2, '0');
    const ss = String(durationSec % 60).padStart(2, '0');

    await zohoAPI('POST', '/Calls', {
      data: [{
        Subject:         `${callType} call – ${call.contact_name || call.phone_number}`,
        Call_Type:       callType,
        Call_Start_Time: call.started_at
          ? new Date(call.started_at).toISOString()
          : new Date().toISOString(),
        Call_Duration:   `${hh}:${mm}:${ss}`,
        Call_Result:     call.status === 'missed' ? 'No answer' : 'Completed',
        Description:     `Logged by BTI Voice. Agent: ${call.agent_name || 'Unknown'}. Status: ${call.status || 'completed'}.`,
        Who_Id:          { id: zohoId },
        $se_module:      'Contacts',
      }]
    });

    console.log(`[Zoho] ✓ Call ${call_id} logged on contact ${zohoId}`);
    res.json({ success: true, zoho_contact_id: zohoId });

  } catch (e) {
    console.error('[Zoho log-call]', e.message, e.body || '');
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/zoho/log-sms ─────────────────────────────────────────────────────
router.post('/log-sms', async (req, res) => {
  const { message_id } = req.body;
  if (!message_id) return res.status(400).json({ error: 'message_id required' });

  try {
    const { rows } = await pool.query(`
      SELECT m.id, m.body, m.direction, m.sent_at,
             c.contact_id,
             co.phone_number, co.name AS contact_name,
             a.name AS agent_name
      FROM   messages m
      JOIN   conversations c  ON c.id  = m.conversation_id
      JOIN   contacts      co ON co.id = c.contact_id
      LEFT JOIN agents     a  ON a.id  = m.agent_id
      WHERE  m.id = $1
    `, [message_id]);

    if (!rows[0]) return res.status(404).json({ error: 'Message not found' });
    const msg = rows[0];

    const zohoId = await resolveZohoId(msg.contact_id, msg.phone_number);
    if (!zohoId) {
      return res.json({ skipped: true, reason: 'Phone number not found in Zoho CRM' });
    }

    // Log as a Note on the contact record.
    // If you identify the SMS extension API later, swap this out.
    const direction = msg.direction === 'inbound' ? 'Received from' : 'Sent to';
    const preview   = (msg.body || '').substring(0, 80);
    const noteBody  = [
      `[SMS] ${direction} ${msg.phone_number}`,
      `Agent: ${msg.agent_name || 'Unknown'}`,
      '',
      msg.body || '',
      '',
      `— Logged by BTI Voice at ${new Date(msg.sent_at || Date.now()).toLocaleString()}`,
    ].join('\n');

    await zohoAPI('POST', '/Notes', {
      data: [{
        Note_Title:   `SMS: ${msg.contact_name || msg.phone_number} — "${preview}${msg.body?.length > 80 ? '…' : ''}"`,
        Note_Content: noteBody,
        Parent_Id:    { id: zohoId },
        $se_module:   'Contacts',
      }]
    });

    console.log(`[Zoho] ✓ SMS ${message_id} logged on contact ${zohoId}`);
    res.json({ success: true, zoho_contact_id: zohoId });

  } catch (e) {
    console.error('[Zoho log-sms]', e.message, e.body || '');
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/zoho/test ─────────────────────────────────────────────────────────
// Quick connectivity check — returns the Zoho org info if credentials work.
router.get('/test', async (req, res) => {
  try {
    const org = await zohoAPI('GET', '/org');
    res.json({ ok: true, org: org?.org?.[0]?.company_name || 'Connected' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
