const express = require('express');
const { pool } = require('../db');
const { requireAuth , requireMediaAuth } = require('../auth');
const { logActivity } = require('../helpers/logActivity');
const { syncCallToZoho, fireZohoLogCall } = require('../helpers/syncCallToZoho');
const { updateZohoCallContact } = require('../zoho');

const router = express.Router();

// Get call log (all agents, shared)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        ca.id, ca.direction, ca.duration, ca.status,
        ca.started_at, ca.ended_at,
        ca.recording_url, ca.transcription, ca.ai_summary,
        ca.needs_wrap_up, ca.chosen_zoho_contact_id, ca.chosen_zoho_module,
        ca.disposition, ca.wrap_up_completed_at,
        a.name     AS agent_name,
        a.color    AS agent_color,
        a.initials AS agent_initials,
        co.name    AS contact_name,
        co.phone_number AS contact_number,
        c.id       AS conversation_id
      FROM calls ca
      LEFT JOIN agents a       ON a.id  = ca.agent_id
      JOIN conversations c     ON c.id  = ca.conversation_id
      JOIN contacts co         ON co.id = c.contact_id
      ORDER BY ca.started_at DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Log a completed call (called from frontend when call ends)
router.post('/log', requireAuth, async (req, res) => {
  const { conversation_id, duration, direction = 'outbound', status = 'completed' } = req.body;
  try {
    const { rows: [call] } = await pool.query(`
      INSERT INTO calls (conversation_id, agent_id, direction, duration, status, ended_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *
    `, [conversation_id, req.agent.id, direction, duration, status]);

    // Sync to Zoho CRM in the background
    syncCallToZoho(call.id);

    // Track call activity
    logActivity(req, req.agent, 'call', `${direction} · ${status} · ${duration || 0}s`);

    res.json(call);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get a Twilio Voice access token for browser calling
router.post('/token', requireAuth, async (req, res) => {
  const sid     = process.env.TWILIO_ACCOUNT_SID;
  const apiKey  = process.env.TWILIO_API_KEY;
  const secret  = process.env.TWILIO_API_SECRET;
  const twimlApp = process.env.TWILIO_TWIML_APP_SID;

  if (!sid || !apiKey || !secret || !twimlApp) {
    return res.status(503).json({ error: 'Twilio Voice not yet configured' });
  }

  try {
    const twilio = require('twilio');
    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const token = new AccessToken(sid, apiKey, secret, {
      identity: `agent_${req.agent.id}`,
    });
    token.addGrant(new VoiceGrant({
      outgoingApplicationSid: twimlApp,
      incomingAllow: true,
    }));

    res.json({ token: token.toJwt(), identity: `agent_${req.agent.id}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Log a call by phone number — creates contact/conversation if needed
// Called from frontend after a call ends (outbound or inbound answered)
router.post('/log-by-phone', requireAuth, async (req, res) => {
  const { phone, duration = 0, direction = 'outbound', status = 'completed', started_at, call_sid } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });

  try {
    const { getIO } = require('../socket');

    // If the webhook already logged this SID, return that record instead of duplicating
    if (call_sid) {
      const { rows: [existing] } = await pool.query(
        'SELECT * FROM calls WHERE twilio_call_sid = $1', [call_sid]
      );
      if (existing) {
        // Update with agent_id since the webhook doesn't know the agent
        await pool.query('UPDATE calls SET agent_id = $1 WHERE id = $2', [req.agent.id, existing.id]);
        return res.json(existing);
      }
    }

    // Normalize phone: Twilio sends E.164 (+12395959310), try that first, then 10-digit
    const digits = phone.replace(/\D/g, '');
    const e164   = digits.length === 10 ? '+1' + digits
                 : digits.length === 11 && digits.startsWith('1') ? '+' + digits
                 : phone;
    const tenDigit = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;

    // Secondary dedup: the browser SDK sends the child leg SID but the webhook stores
    // the parent SID — they won't match. Fall back to a phone + direction + time-window
    // check to catch the case where autoLogCall already logged this call.
    // 30 min window so calls longer than 2 min are still caught.
    const twoMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { rows: [webhookRecord] } = await pool.query(`
      SELECT ca.id FROM calls ca
      JOIN conversations cv ON cv.id = ca.conversation_id
      JOIN contacts co ON co.id = cv.contact_id
      WHERE ca.twilio_call_sid IS NOT NULL
        AND ca.direction = $1
        AND co.phone_number = ANY($2::text[])
        AND ca.started_at > $3
      ORDER BY ca.started_at DESC LIMIT 1
    `, [direction, [e164, phone, tenDigit], twoMinsAgo]);
    if (webhookRecord) {
      // Webhook already logged this — stamp agent_id and return existing record
      await pool.query('UPDATE calls SET agent_id = $1 WHERE id = $2', [req.agent.id, webhookRecord.id]);
      console.log(`[log-by-phone] Matched webhook-logged call for ${phone} — skipping duplicate`);
      const { rows: [updated] } = await pool.query('SELECT * FROM calls WHERE id = $1', [webhookRecord.id]);
      return res.json(updated);
    }

    // Find or create contact (try E.164 first, then raw, then 10-digit)
    let contact = null;
    for (const p of [e164, phone, tenDigit]) {
      ({ rows: [contact] } = await pool.query(
        'SELECT * FROM contacts WHERE phone_number = $1', [p]
      ));
      if (contact) break;
    }
    if (!contact) {
      const r = await pool.query(
        'INSERT INTO contacts (phone_number, name) VALUES ($1, $2) RETURNING *',
        [e164, e164]
      );
      contact = r.rows[0];
    }

    // Find or create conversation
    let { rows: [conv] } = await pool.query(
      'SELECT * FROM conversations WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 1',
      [contact.id]
    );
    if (!conv) {
      const r = await pool.query(
        'INSERT INTO conversations (contact_id, last_message_at) VALUES ($1, NOW()) RETURNING *',
        [contact.id]
      );
      conv = r.rows[0];
    }

    // Log the call
    const startedAt = started_at ? new Date(started_at).toISOString() : new Date(Date.now() - duration * 1000).toISOString();
    const { rows: [call] } = await pool.query(`
      INSERT INTO calls (conversation_id, agent_id, direction, duration, status, twilio_call_sid, started_at, ended_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING *
    `, [conv.id, req.agent.id, direction, duration, status, call_sid || null, startedAt]);

    // Sync to Zoho
    syncCallToZoho(call.id);

    // Track call activity
    const contactLabel = contact.name && contact.name !== e164 ? contact.name : phone;
    logActivity(req, req.agent, 'call', `${direction} · ${status} · ${duration}s · ${contactLabel}`);

    // Notify all clients to refresh calls list
    const io = getIO();
    if (io) io.emit('call_logged', { call_id: call.id });

    res.json(call);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get voicemails (calls with status = 'voicemail')
router.get('/voicemails', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        ca.id, ca.duration, ca.recording_url, ca.started_at AS received_at,
        ca.played,
        co.name        AS contact_name,
        co.phone_number AS from,
        cv.id          AS conversation_id
      FROM calls ca
      JOIN conversations cv ON cv.id = ca.conversation_id
      JOIN contacts co      ON co.id = cv.contact_id
      WHERE ca.status = 'voicemail'
      ORDER BY ca.started_at DESC
      LIMIT 50
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Proxy a Twilio recording so the browser can play it without needing Basic auth.
// Twilio recording URLs require Account SID + Auth Token credentials; a browser
// <audio> tag can't supply those, so we fetch server-side and stream to the client.
// Auth: accepts Bearer header OR ?token= query param (needed for <audio src> and download links).
router.get('/:id/recording', requireMediaAuth, async (req, res) => {

  try {
    const { rows: [call] } = await pool.query(
      'SELECT recording_url FROM calls WHERE id = $1', [req.params.id]
    );
    if (!call?.recording_url) return res.status(404).json({ error: 'No recording for this call' });

    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) return res.status(503).json({ error: 'Twilio credentials not configured' });

    const twilioAuth = Buffer.from(`${sid}:${token}`).toString('base64');
    const audioRes   = await fetch(call.recording_url, {
      headers: { Authorization: `Basic ${twilioAuth}` },
    });

    if (!audioRes.ok) {
      return res.status(audioRes.status).json({ error: `Twilio returned ${audioRes.status}` });
    }

    // Forward content-type, content-length (needed for seek/duration), and stream
    res.set('Content-Type', audioRes.headers.get('content-type') || 'audio/mpeg');
    res.set('Cache-Control', 'private, max-age=3600');
    const cl = audioRes.headers.get('content-length');
    if (cl) res.set('Content-Length', cl);

    const { Readable } = require('stream');
    Readable.fromWeb(audioRes.body).pipe(res);
  } catch (e) {
    console.error('[recording proxy]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Mark voicemail as played
router.patch('/voicemails/:id/played', requireAuth, async (req, res) => {
  try {
    await pool.query('UPDATE calls SET played = true WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── In-call controls (hold, resume, transfer) ─────────────────────────────────
// These use the Twilio REST API to redirect the PSTN caller's call leg.
// The browser SDK gives us the child call SID; we look up the parent SID
// (the inbound PSTN leg) so we can redirect the caller, not just our browser.

function getTwilioClient() {
  const sid    = process.env.TWILIO_ACCOUNT_SID;
  const token  = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('Twilio credentials not configured');
  return require('twilio')(sid, token);
}

// Resolve the PSTN (parent) call SID from whichever SID the browser gives us
async function resolveParentSid(client, callSid) {
  try {
    const call = await client.calls(callSid).fetch();
    return call.parentCallSid || callSid;
  } catch (e) {
    console.warn(`[resolveParentSid] Could not fetch ${callSid}:`, e.message);
    return callSid;
  }
}

// PUT caller on hold — plays hold music to the PSTN caller
router.post('/hold', requireAuth, async (req, res) => {
  const { callSid } = req.body;
  if (!callSid) return res.status(400).json({ error: 'callSid required' });
  try {
    const client    = getTwilioClient();
    const targetSid = await resolveParentSid(client, callSid);
    console.log(`[hold] Putting ${targetSid} on hold`);
    await client.calls(targetSid).update({
      twiml: '<Response><Play loop="50">https://com.twilio.music.classical.s3.amazonaws.com/BachGavotteShort.mp3</Play></Response>',
    });
    res.json({ success: true });
  } catch (e) {
    console.error('[hold]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Resume from hold — reconnects caller to this agent
router.post('/resume', requireAuth, async (req, res) => {
  const { callSid, agentId } = req.body;
  if (!callSid || !agentId) return res.status(400).json({ error: 'callSid and agentId required' });
  const serverUrl = process.env.SERVER_URL || '';
  try {
    const client    = getTwilioClient();
    const targetSid = await resolveParentSid(client, callSid);
    console.log(`[resume] Reconnecting ${targetSid} to agent_${agentId}`);
    await client.calls(targetSid).update({
      twiml: `<Response><Dial timeout="30" action="${serverUrl}/webhooks/voice/no-answer" method="POST"><Client>agent_${agentId}</Client></Dial></Response>`,
    });
    res.json({ success: true });
  } catch (e) {
    console.error('[resume]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Blind transfer — redirects PSTN caller to a different agent's browser client
router.post('/transfer', requireAuth, async (req, res) => {
  const { callSid, targetAgentId } = req.body;
  if (!callSid || !targetAgentId) return res.status(400).json({ error: 'callSid and targetAgentId required' });
  const serverUrl = process.env.SERVER_URL || '';
  try {
    const client    = getTwilioClient();
    const targetSid = await resolveParentSid(client, callSid);
    console.log(`[transfer] Transferring ${targetSid} to agent_${targetAgentId}`);
    await client.calls(targetSid).update({
      twiml: `<Response><Dial timeout="30" action="${serverUrl}/webhooks/voice/no-answer" method="POST"><Client>agent_${targetAgentId}</Client></Dial></Response>`,
    });
    res.json({ success: true });
  } catch (e) {
    console.error('[transfer]', e.message);
    res.status(500).json({ error: e.message });
  }
});


// ── POST /:id/wrap-up ─────────────────────────────────────────────────────────
// v1.4.0: post-call wrap-up screen submission.
//
// Body:
//   chosen_zoho_contact_id?: string  // Zoho contact id picked from dropdown
//   disposition?: string             // outcome code, e.g. 'demo_scheduled'
//   note?: string                    // freeform note (posted as Zoho Note)
//   task?: { subject, description?, due_date?, owner_id? }  // optional follow-up task
//   skip?: boolean                   // true = agent clicked Skip; do nothing,
//                                    //   leave needs_wrap_up = TRUE so the
//                                    //   "Needs wrap-up" badge persists.
//
// Behaviour:
//   - If skip = true: no DB writes, no Zoho calls. Sweep job will handle Zoho
//     sync via auto-matched contact after 60s.
//   - Otherwise: persists wrap-up data, clears needs_wrap_up, then either
//     (a) fires log-call to chosen contact if not yet synced, or
//     (b) re-attaches the existing Zoho Call record to the chosen contact if
//         the sweep already synced it to a different one.
//   - Fires add-note + create-task in the background if those fields are set.
router.post('/:id/wrap-up', requireAuth, async (req, res) => {
  const callId      = parseInt(req.params.id, 10);
  const body        = req.body || {};
  const choseId     = body.chosen_zoho_contact_id || null;
  // v1.4.1: 'Contacts' (default) or 'Leads'
  const choseModule = body.chosen_zoho_module === 'Leads' ? 'Leads'
                    : body.chosen_zoho_module === 'Contacts' ? 'Contacts'
                    : null;
  const skip        = !!body.skip;
  if (Number.isNaN(callId)) return res.status(400).json({ error: 'invalid call id' });

  try {
    const lookup = await pool.query(
      'SELECT id, zoho_logged_at, zoho_call_id, chosen_zoho_contact_id, chosen_zoho_module ' +
      'FROM calls WHERE id = $1',
      [callId]
    );
    const call = lookup.rows[0];
    if (!call) return res.status(404).json({ error: 'Call not found' });

    if (skip) {
      // Agent dismissed the screen without filling it out. Leave the badge on.
      // Sweep will handle Zoho sync to auto-matched contact after 60s.
      return res.json({ success: true, skipped: true });
    }

    // Persist wrap-up form data; clear the badge.
    await pool.query(
      'UPDATE calls SET ' +
      '  chosen_zoho_contact_id = COALESCE($2, chosen_zoho_contact_id), ' +
      '  chosen_zoho_module     = COALESCE($3, chosen_zoho_module), ' +
      '  disposition            = COALESCE($4, disposition), ' +
      '  wrap_up_note           = COALESCE($5, wrap_up_note), ' +
      '  wrap_up_completed_at   = NOW(), ' +
      '  needs_wrap_up          = FALSE ' +
      'WHERE id = $1',
      [callId, choseId, choseModule, body.disposition || null, body.note || null]
    );

    const targetZohoId     = choseId     || call.chosen_zoho_contact_id || null;
    const targetZohoModule = choseModule || call.chosen_zoho_module     || 'Contacts';

    // Decide what to do for the Zoho Call record itself
    if (call.zoho_logged_at) {
      // Already synced (sweep got there first). Re-attach if the agent picked
      // a different contact from whatever the sweep used.
      if (targetZohoId && call.zoho_call_id) {
        try {
          await updateZohoCallContact(call.zoho_call_id, targetZohoId, { module: targetZohoModule });
        } catch (e) {
          console.error('[wrap-up] Zoho call re-attach failed:', e.message);
        }
      }
    } else {
      // Not yet synced — fire to chosen record (or auto-match if null)
      fireZohoLogCall(callId, { zoho_contact_id: targetZohoId, zoho_module: targetZohoModule });
    }

    const port = process.env.PORT || 3000;

    // Post the agent's note (if any) as a Zoho Note on the chosen record
    if (body.note && targetZohoId) {
      setImmediate(async function() {
        try {
          await fetch('http://localhost:' + port + '/api/zoho/add-note', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-token': require('../secret').INTERNAL_TOKEN },
            body:    JSON.stringify({
              zoho_contact_id: targetZohoId,
              zoho_module:     targetZohoModule,
              note:            body.note,
              title:           'Call note - ' + new Date().toLocaleDateString(),
            }),
          });
        } catch (e) {
          console.error('[wrap-up] add-note failed:', e.message);
        }
      });
    }

    // Create the follow-up task (if provided) on the chosen record
    if (body.task && body.task.subject && targetZohoId) {
      setImmediate(async function() {
        try {
          await fetch('http://localhost:' + port + '/api/zoho/create-task', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-token': require('../secret').INTERNAL_TOKEN },
            body:    JSON.stringify({
              subject:     body.task.subject,
              description: body.task.description || null,
              due_date:    body.task.due_date    || null,
              owner_id:    body.task.owner_id    || null,
              contact_id:  targetZohoId,
              zoho_module: targetZohoModule,
            }),
          });
        } catch (e) {
          console.error('[wrap-up] create-task failed:', e.message);
        }
      });
    }

    res.json({ success: true });
  } catch (e) {
    console.error('[wrap-up]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /:id ───────────────────────────────────────────────────────────────────
// Fetch a single call (used by the post-call wrap-up screen to pre-fill).
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT ca.id, ca.direction, ca.duration, ca.status, ca.started_at, ca.ended_at, ' +
      '       ca.needs_wrap_up, ca.chosen_zoho_contact_id, ca.chosen_zoho_module, ' +
      '       ca.disposition, ca.wrap_up_note, ' +
      '       ca.wrap_up_completed_at, ca.zoho_logged_at, ca.zoho_call_id, ' +
      '       co.id AS contact_id, co.name AS contact_name, co.phone_number ' +
      'FROM   calls ca ' +
      'JOIN   conversations cv ON cv.id = ca.conversation_id ' +
      'JOIN   contacts      co ON co.id = cv.contact_id ' +
      'WHERE  ca.id = $1',
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
