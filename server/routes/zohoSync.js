// server/routes/zohoSync.js
// Internal endpoints called fire-and-forget after calls/messages are saved.
// Zoho errors are logged but never surface to the user.

const express = require('express');
const router  = express.Router();
const { internalOrAuth } = require('../auth');
const { pool } = require('../db');

// Lock down every Zoho endpoint: either a logged-in agent or an internal
// server-to-server self-call (which carries the x-internal-token header).
router.use(internalOrAuth);
const {
  zohoAPI,
  findContactByPhone,
  findAllContactsByPhone,
  findAllRecordsByPhone,
  findRecordByPhone,
  listZohoUsers,
  createZohoContact,
  createZohoTask,
} = require('../zoho');
const { upsertSmsDigest, upsertCallRecord } = require('../helpers/btiVoiceModule');

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
    if (cached.rows[0] && cached.rows[0].zoho_contact_id) {
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

// ── v1.4.1: Module-aware resolver — Contacts OR Leads ─────────────────────────
// Returns { id, module } or null. Used by /log-call / /add-note when no chosen
// contact is on the row (auto-match path).
async function resolveZohoRecord(phoneNumber) {
  const rec = await findRecordByPhone(phoneNumber);
  if (!rec) return null;
  return { id: rec.id, module: rec.module };
}

// ── POST /api/zoho/log-call ────────────────────────────────────────────────────
// v1.4.0 changes:
//   - Accepts optional `zoho_contact_id` override in the body. If provided,
//     attaches the call to that contact directly (bypasses phone lookup).
//   - Reads `chosen_zoho_contact_id` from the calls row if no override is
//     passed (set by the post-call wrap-up screen).
//   - Stamps `zoho_call_id` and `zoho_logged_at` back on the calls row so the
//     wrap-up sweep can avoid double-syncing and so the wrap-up endpoint can
//     re-attach the record later if the agent picks a different contact.
router.post('/log-call', async (req, res) => {
  const callId         = req.body.call_id;
  const overrideZohoId = req.body.zoho_contact_id || null;
  // v1.4.1: optional module override. 'Contacts' (default) or 'Leads'.
  const overrideModule = req.body.zoho_module || null;
  if (!callId) return res.status(400).json({ error: 'call_id required' });

  try {
    // Fetch call details from BTI Voice DB
    const queryResult = await pool.query(
      'SELECT ca.id, ca.direction, ca.status, ca.duration, ca.started_at, ' +
      '       ca.recording_url, ca.transcription, ca.ai_summary, ' +
      '       ca.chosen_zoho_contact_id, ca.chosen_zoho_module, ' +
      '       ca.zoho_call_id, ca.zoho_logged_at, ' +
      '       c.contact_id, ' +
      '       co.phone_number, co.name AS contact_name, ' +
      '       a.name AS agent_name ' +
      'FROM   calls ca ' +
      'LEFT JOIN conversations c  ON c.id  = ca.conversation_id ' +
      'LEFT JOIN contacts      co ON co.id = c.contact_id ' +
      'LEFT JOIN agents        a  ON a.id  = ca.agent_id ' +
      'WHERE  ca.id = $1',
      [callId]
    );

    if (!queryResult.rows[0]) return res.status(404).json({ error: 'Call not found' });
    const call = queryResult.rows[0];

    if (!call.contact_id || !call.phone_number) {
      return res.json({ skipped: true, reason: 'No contact linked to this call' });
    }

    // Idempotency: if already synced, skip unless an override is passed
    if (call.zoho_logged_at && !overrideZohoId) {
      return res.json({ skipped: true, reason: 'Already logged to Zoho', zoho_call_id: call.zoho_call_id });
    }

    // v1.4.1: Decide which Zoho record (Contact or Lead) to attach the call to.
    // Priority: explicit override > chosen_zoho_contact_id+module (from wrap-up) > auto-match.
    let zohoId     = overrideZohoId || call.chosen_zoho_contact_id || null;
    let zohoModule = overrideModule || call.chosen_zoho_module     || null;
    if (!zohoId) {
      const rec = await resolveZohoRecord(call.phone_number);
      if (rec) { zohoId = rec.id; zohoModule = rec.module; }
    }
    if (!zohoId) {
      return res.json({ skipped: true, reason: 'Phone number not found in Zoho CRM' });
    }
    // Default to Contacts when module is unknown (pre-v1.4.1 rows).
    if (zohoModule !== 'Leads') zohoModule = 'Contacts';

    // Zoho Call_Type must be 'Inbound', 'Outbound', or 'Missed'
    const callType = call.status === 'missed' ? 'Missed'
                   : call.direction === 'inbound' ? 'Inbound'
                   : 'Outbound';

    // Zoho Call_Duration format is mm:ss (NOT hh:mm:ss)
    const durationSec = call.duration || 0;
    const mm = String(Math.floor(durationSec / 60)).padStart(2, '0');
    const ss = String(durationSec % 60).padStart(2, '0');

    const startedIso = (call.started_at ? new Date(call.started_at) : new Date())
      .toISOString().replace(/\.\d{3}Z$/, '+00:00');

    const subject     = callType + ' call - ' + (call.contact_name || call.phone_number);
    const description = 'Logged by BTI Voice. Agent: ' + (call.agent_name || 'Unknown') +
                        '. Status: ' + (call.status || 'completed') + '.';

    const payload = {
      data: [{
        Subject:         subject,
        Call_Type:       callType,
        Call_Start_Time: startedIso,
        Call_Duration:   mm + ':' + ss,
        Call_Result:     call.status === 'missed' ? 'No answer' : 'Completed',
        Description:     description,
        Who_Id:          { id: zohoId },
        $se_module:      zohoModule,
      }]
    };

    const zohoRes = await zohoAPI('POST', '/Calls', payload);

    // Zoho returns 200 even on validation errors — check the body
    const record = zohoRes && zohoRes.data && zohoRes.data[0];
    if (!record || record.status === 'error') {
      console.error('[Zoho] Call create failed:', JSON.stringify(record));
      return res.status(500).json({ error: 'Zoho rejected the call record', details: record });
    }

    const zohoCallId = record.details && record.details.id;

    // Stamp the call row so we don't re-sync and so wrap-up can re-attach later
    await pool.query(
      'UPDATE calls SET zoho_logged_at = NOW(), zoho_call_id = COALESCE($2, zoho_call_id) WHERE id = $1',
      [callId, zohoCallId || null]
    );

    console.log('[Zoho] Call ' + callId + ' logged on ' + zohoModule + ' ' + zohoId + ' (Zoho record: ' + zohoCallId + ')');

    // Also record it in the custom BTI_Voice module (one record per call,
    // upserted on BTI_Ref 'call-<id>' — transcript/summary may land later via
    // /update-call-record). Non-fatal: native Calls logging above is the
    // source of truth for Zoho activity reporting.
    try {
      await upsertCallRecord({
        id:            call.id,
        direction:     call.direction,
        status:        call.status,
        duration:      call.duration,
        started_at:    call.started_at,
        phone_number:  call.phone_number,
        contact_name:  call.contact_name,
        agent_name:    call.agent_name,
        recording_url: call.recording_url,
        transcription: call.transcription,
        ai_summary:    call.ai_summary,
      }, zohoId, zohoModule);
    } catch (e) {
      console.error('[Zoho log-call] BTI_Voice upsert failed:', e.message, e.body ? JSON.stringify(e.body) : '');
    }

    res.json({ success: true, zoho_contact_id: zohoId, zoho_module: zohoModule, zoho_call_id: zohoCallId });

  } catch (e) {
    console.error('[Zoho log-call]', e.message, e.body || '');
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/zoho/log-sms ─────────────────────────────────────────────────────
router.post('/log-sms', async (req, res) => {
  const messageId = req.body.message_id;
  if (!messageId) return res.status(400).json({ error: 'message_id required' });

  try {
    const queryResult = await pool.query(
      'SELECT m.id, m.body, m.direction, m.sent_at, m.conversation_id, ' +
      '       c.contact_id, ' +
      '       co.phone_number, co.name AS contact_name, ' +
      '       a.name AS agent_name ' +
      'FROM   messages m ' +
      'JOIN   conversations c  ON c.id  = m.conversation_id ' +
      'JOIN   contacts      co ON co.id = c.contact_id ' +
      'LEFT JOIN agents     a  ON a.id  = m.agent_id ' +
      'WHERE  m.id = $1',
      [messageId]
    );

    if (!queryResult.rows[0]) return res.status(404).json({ error: 'Message not found' });
    const msg = queryResult.rows[0];

    // v1.4.1: resolve Contact OR Lead so SMS notes attach to whichever record exists.
    const rec = await resolveZohoRecord(msg.phone_number);
    if (!rec) {
      return res.json({ skipped: true, reason: 'Phone number not found in Zoho CRM' });
    }
    const zohoId     = rec.id;
    const zohoModule = rec.module === 'Leads' ? 'Leads' : 'Contacts';

    // Upsert the live-appending daily digest in the BTI_Voice module
    // (BTI_Ref 'sms-YYYY-MM-DD-<phone>'). The whole day is rebuilt from our DB
    // on every message, so retries and out-of-order syncs converge.
    await upsertSmsDigest({
      conversationId: msg.conversation_id,
      phoneNumber:    msg.phone_number,
      contactName:    msg.contact_name,
      when:           msg.sent_at || new Date(),
      zohoId:         zohoId,
      zohoModule:     zohoModule,
    });

    console.log('[Zoho] SMS ' + messageId + ' digested on ' + zohoModule + ' ' + zohoId);
    res.json({ success: true, zoho_contact_id: zohoId, zoho_module: zohoModule });

  } catch (e) {
    console.error('[Zoho log-sms]', e.message, e.body || '');
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/zoho/update-call-record ─────────────────────────────────────────
// Called by webhooks/voice.js after transcription/AI summary complete. Upserts
// the BTI_Voice record for the call (BTI_Ref 'call-<id>') with the recording
// URL, transcript and AI summary. Replaces the old add-note path for summaries.
router.post('/update-call-record', async (req, res) => {
  const callId = req.body.call_id;
  if (!callId) return res.status(400).json({ error: 'call_id required' });
  try {
    const queryResult = await pool.query(
      'SELECT ca.id, ca.direction, ca.status, ca.duration, ca.started_at, ' +
      '       ca.recording_url, ca.transcription, ca.ai_summary, ' +
      '       ca.chosen_zoho_contact_id, ca.chosen_zoho_module, ' +
      '       co.phone_number, co.name AS contact_name, ' +
      '       a.name AS agent_name ' +
      'FROM   calls ca ' +
      'LEFT JOIN conversations c  ON c.id  = ca.conversation_id ' +
      'LEFT JOIN contacts      co ON co.id = c.contact_id ' +
      'LEFT JOIN agents        a  ON a.id  = ca.agent_id ' +
      'WHERE  ca.id = $1',
      [callId]
    );
    if (!queryResult.rows[0]) return res.status(404).json({ error: 'Call not found' });
    const call = queryResult.rows[0];
    if (!call.phone_number) return res.json({ skipped: true, reason: 'No contact linked to this call' });

    let zohoId     = call.chosen_zoho_contact_id || null;
    let zohoModule = call.chosen_zoho_module     || null;
    if (!zohoId) {
      const rec = await resolveZohoRecord(call.phone_number);
      if (rec) { zohoId = rec.id; zohoModule = rec.module; }
    }
    if (zohoModule !== 'Leads') zohoModule = 'Contacts';
    // zohoId may be null — the record still gets created, just without a lookup.

    const details = await upsertCallRecord(call, zohoId, zohoModule);
    console.log('[Zoho] BTI_Voice call record updated for call ' + callId);
    res.json({ success: true, bti_voice_id: details && details.id });
  } catch (e) {
    console.error('[Zoho update-call-record]', e.message, e.body ? JSON.stringify(e.body) : '');
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/zoho/add-note ────────────────────────────────────────────────────
// Add a freeform note to a contact. Used for AI call summaries and the
// post-call wrap-up screen's "note" field.
// v1.4.0: accepts optional `zoho_contact_id` override (used by wrap-up so the
// note lands on the chosen contact, not the auto-matched one).
router.post('/add-note', async (req, res) => {
  const contactId       = req.body.contact_id;
  const note            = req.body.note;
  const title           = req.body.title;
  const overrideZohoId  = req.body.zoho_contact_id || null;
  // v1.4.1: optional module override. 'Contacts' (default) or 'Leads'.
  const overrideModule  = req.body.zoho_module || null;
  if ((!contactId && !overrideZohoId) || !note) {
    return res.status(400).json({ error: 'note required, plus either contact_id or zoho_contact_id' });
  }

  try {
    let zohoId     = overrideZohoId;
    let zohoModule = overrideModule;
    if (!zohoId) {
      const contactQuery = await pool.query('SELECT * FROM contacts WHERE id = $1', [contactId]);
      const contact      = contactQuery.rows[0];
      if (!contact) return res.status(404).json({ error: 'Contact not found' });
      // v1.4.1: auto-detect module (Contact OR Lead) when no override given.
      const rec = await resolveZohoRecord(contact.phone_number);
      if (rec) { zohoId = rec.id; zohoModule = rec.module; }
    }
    if (!zohoId) return res.json({ skipped: true, reason: 'Contact not found in Zoho CRM' });
    if (zohoModule !== 'Leads') zohoModule = 'Contacts';

    await zohoAPI('POST', '/Notes', {
      data: [{
        Note_Title:   title || ('Call Summary - ' + new Date().toLocaleDateString()),
        Note_Content: note,
        Parent_Id:    { id: zohoId },
        $se_module:   zohoModule,
      }]
    });

    res.json({ success: true, zoho_contact_id: zohoId, zoho_module: zohoModule });
  } catch (e) {
    console.error('[Zoho add-note]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/zoho/find-contacts-by-phone ─────────────────────────────────────
// v1.4.0: powers the post-call screen dropdown. Returns ALL Zoho contacts at
// a given phone number so the agent can pick the right one when several people
// share a number.
router.post('/find-contacts-by-phone', async (req, res) => {
  const phone = req.body.phone;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  try {
    // v1.4.1: search both Contacts and Leads. Each record has a `module` tag.
    // Returns under `contacts` key for backwards compat with older clients,
    // but the array now contains both Contacts and Leads.
    const records = await findAllRecordsByPhone(phone);
    res.json({ contacts: records, records: records });
  } catch (e) {
    console.error('[Zoho find-contacts-by-phone]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/zoho/create-contact ──────────────────────────────────────────────
// v1.4.0: powers the "Create in Zoho" button on unknown numbers.
router.post('/create-contact', async (req, res) => {
  const first_name   = req.body.first_name;
  const last_name    = req.body.last_name;
  const phone        = req.body.phone;
  const email        = req.body.email;
  const account_name = req.body.account_name;
  const link_call_id = req.body.link_call_id || null; // optional: also stamp chosen_zoho_contact_id on this call

  try {
    const created = await createZohoContact({
      first_name: first_name,
      last_name:  last_name,
      phone:      phone,
      email:      email,
      account_name: account_name,
    });

    // If linked to a call, set chosen_zoho_contact_id so wrap-up flow uses this contact
    if (link_call_id && created && created.id) {
      await pool.query(
        'UPDATE calls SET chosen_zoho_contact_id = $1 WHERE id = $2',
        [created.id, link_call_id]
      );
    }

    res.json({ success: true, zoho_contact: created });
  } catch (e) {
    console.error('[Zoho create-contact]', e.message, e.body || '');
    res.status(500).json({ error: e.message, details: e.body });
  }
});

// ── POST /api/zoho/create-task ─────────────────────────────────────────────────
// v1.4.0: powers the post-call screen "follow-up task" block.
router.post('/create-task', async (req, res) => {
  try {
    const created = await createZohoTask({
      subject:     req.body.subject,
      description: req.body.description,
      due_date:    req.body.due_date,
      owner_id:    req.body.owner_id,
      contact_id:  req.body.contact_id,
      // v1.4.1: 'Contacts' (default) or 'Leads'
      module:      req.body.zoho_module || req.body.module || 'Contacts',
    });
    res.json({ success: true, zoho_task: created });
  } catch (e) {
    console.error('[Zoho create-task]', e.message, e.body || '');
    res.status(500).json({ error: e.message, details: e.body });
  }
});

// ── GET /api/zoho/users ────────────────────────────────────────────────────────
// v1.4.0: powers the task assignee dropdown. Cached server-side for an hour.
router.get('/users', async (req, res) => {
  try {
    const force = req.query.refresh === '1';
    const users = await listZohoUsers({ force: force });
    res.json({ users: users });
  } catch (e) {
    console.error('[Zoho users]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/zoho/status ───────────────────────────────────────────────────────
// Returns which credentials are configured — never exposes actual values.
router.get('/status', (req, res) => {
  const required = ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN'];
  const missing  = required.filter(function(k) { return !process.env[k]; });
  const present  = required.filter(function(k) { return !!process.env[k]; });
  const configured = missing.length === 0;

  res.json({
    configured: configured,
    present:    present,
    missing:    missing,
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
    const contact = result && result.data && result.data[0];
    res.json({
      ok:             true,
      message:        'Zoho CRM connected',
      sample_contact: (contact && contact.Full_Name) || 'No contacts found',
      sample_phone:   (contact && contact.Phone)     || '',
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
