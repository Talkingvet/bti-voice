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
  // Check DB cache — but always re-verify the cached ID is still valid
  const cached = await pool.query(
    'SELECT zoho_contact_id FROM contacts WHERE id = $1',
    [contactId]
  );
  // Always do a fresh lookup — don't trust the cache, since a bad ID was
  // previously stored (4478198000019675754). The live search is fast.
  // (Re-enable cache once we're confident IDs are reliable.)

  // Live search in Zoho CRM
  const contact = await findContactByPhone(phoneNumber);
  if (!contact) {
    // Clear any stale cached ID
    if (cached.rows[0]?.zoho_contact_id) {
      await pool.query('UPDATE contacts SET zoho_contact_id = NULL WHERE id = $1', [contactId]);
    }
    return null;
  }

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

    // Zoho Call_Type must be 'Inbound', 'Outbound', or 'Missed'
    const callType = call.status === 'missed' ? 'Missed'
                   : call.direction === 'inbound' ? 'Inbound'
                   : 'Outbound';

    // Zoho Call_Duration format is mm:ss (NOT hh:mm:ss)
    const durationSec = call.duration || 0;
    const mm = String(Math.floor(durationSec / 60)).padStart(2, '0');
    const ss = String(durationSec % 60).padStart(2, '0');

    const payload = {
      data: [{
        Subject:         `${callType} call – ${call.contact_name || call.phone_number}`,
        Call_Type:       callType,
        Call_Start_Time: call.started_at
          ? new Date(call.started_at).toISOString()
          : new Date().toISOString(),
        Call_Duration:   `${mm}:${ss}`,
        Call_Result:     call.status === 'missed' ? 'No answer' : 'Completed',
        Description:     `Logged by BTI Voice. Agent: ${call.agent_name || 'Unknown'}. Status: ${call.status || 'completed'}.`,
        Who_Id:          { id: zohoId },
        $se_module:      'Contacts',
      }]
    };

    const zohoRes = await zohoAPI('POST', '/Calls', payload);

    // Zoho returns 200 even on validation errors — check the body
    const record = zohoRes?.data?.[0];
    if (record?.status === 'error') {
      console.error(`[Zoho] Call create failed:`, JSON.stringify(record));
      return res.status(500).json({ error: 'Zoho rejected the call record', details: record });
    }

    console.log(`[Zoho] ✓ Call ${call_id} logged on contact ${zohoId} (Zoho record: ${record?.details?.id})`);
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

// ── POST /api/zoho/add-note ────────────────────────────────────────────────────
// Add a freeform note to a contact. Used for AI call summaries.
router.post('/add-note', async (req, res) => {
  const { contact_id, note, title } = req.body;
  if (!contact_id || !note) return res.status(400).json({ error: 'contact_id and note required' });

  try {
    const { rows: [contact] } = await pool.query(
      'SELECT * FROM contacts WHERE id = $1', [contact_id]
    );
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const zohoId = await resolveZohoId(contact_id, contact.phone_number);
    if (!zohoId) return res.json({ skipped: true, reason: 'Contact not found in Zoho CRM' });

    await zohoAPI('POST', '/Notes', {
      data: [{
        Note_Title:   title || `Call Summary — ${new Date().toLocaleDateString()}`,
        Note_Content: note,
        Parent_Id:    { id: zohoId },
        $se_module:   'Contacts',
      }]
    });

    res.json({ success: true, zoho_contact_id: zohoId });
  } catch (e) {
    console.error('[Zoho add-note]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/zoho/status ───────────────────────────────────────────────────────
// Returns which credentials are configured — never exposes actual values.
router.get('/status', (req, res) => {
  const required = ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN'];
  const optional = ['ZOHO_API_DOMAIN'];

  const missing  = required.filter(k => !process.env[k]);
  const present  = required.filter(k => !!process.env[k]);
  const configured = missing.length === 0;

  res.json({
    configured,
    present,
    missing,
    optional: {
      ZOHO_API_DOMAIN: process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com (default)',
    },
  });
});

// ── GET /api/zoho/test ─────────────────────────────────────────────────────────
// Quick connectivity check — fetches first contact to verify token + scope.
router.get('/test', async (req, res) => {
  try {
    const result = await zohoAPI('GET', '/Contacts?per_page=1&fields=id,Full_Name,Phone');
    const contact = result?.data?.[0];
    res.json({
      ok:             true,
      message:        'Zoho CRM connected',
      sample_contact: contact?.Full_Name || 'No contacts found',
      sample_phone:   contact?.Phone    || '',
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
