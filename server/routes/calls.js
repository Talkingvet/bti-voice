const express = require('express');
const { pool } = require('../db');
const { requireAuth , requireMediaAuth } = require('../auth');
const { logActivity } = require('../helpers/logActivity');
const { syncCallToZoho, fireZohoLogCall } = require('../helpers/syncCallToZoho');
const { updateZohoCallContact } = require('../zoho');
const { finalizeInProgressCall } = require('./../helpers/callRows');
const { twilioMediaUrl } = require('../helpers/twilioUrls');

const router = express.Router();

// Get call log (all agents, shared)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        ca.id, ca.direction, ca.duration, ca.status,
        ca.started_at, ca.ended_at,
        ca.recording_url, ca.transcription, ca.ai_summary, ca.recording_opt_out,
        ca.needs_wrap_up, ca.chosen_zoho_contact_id, ca.chosen_zoho_module,
        ca.disposition, ca.wrap_up_note, ca.wrap_up_completed_at,
        (SELECT COALESCE(json_agg(json_build_object('part', r.part, 'duration', r.duration) ORDER BY r.part), '[]'::json)
           FROM call_recordings r WHERE r.call_id = ca.id) AS recording_parts,
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
  // Dialpad "Don't record this call" toggle — stored so the Calls tab can say
  // "not recorded" instead of looking like a missing recording.
  const optOut = req.body.recording_opt_out === true;
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
        await pool.query('UPDATE calls SET agent_id = $1, recording_opt_out = $3 WHERE id = $2', [req.agent.id, existing.id, optOut]);
        if (existing.status === 'in-progress') {
          // Row created at first Hold (batch 4b) — this is the real end.
          const done = await finalizeInProgressCall(existing.id, { duration, status, agentId: req.agent.id });
          logActivity(req, req.agent, 'call', `${direction} · ${status} · ${duration}s · ${phone}`);
          return res.json({ ...(done || existing), recording_opt_out: optOut });
        }
        return res.json({ ...existing, recording_opt_out: optOut });
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
      await pool.query('UPDATE calls SET agent_id = $1, recording_opt_out = $3 WHERE id = $2', [req.agent.id, webhookRecord.id, optOut]);
      console.log(`[log-by-phone] Matched webhook-logged call for ${phone} — skipping duplicate`);
      await finalizeInProgressCall(webhookRecord.id, { duration, status, agentId: req.agent.id }); // no-op unless 'in-progress'
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
      INSERT INTO calls (conversation_id, agent_id, direction, duration, status, twilio_call_sid, started_at, ended_at, recording_opt_out)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
      RETURNING *
    `, [conv.id, req.agent.id, direction, duration, status, call_sid || null, startedAt, optOut]);

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
        ca.transcription,
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
    // ?part=N picks one part of a held call's recording (batch 4b); no part,
    // or part 1, is calls.recording_url exactly as before.
    const part = parseInt(req.query.part, 10);
    let call;
    if (part > 1) {
      ({ rows: [call] } = await pool.query(
        'SELECT recording_url FROM call_recordings WHERE call_id = $1 AND part = $2', [req.params.id, part]
      ));
    } else {
      ({ rows: [call] } = await pool.query(
        'SELECT recording_url FROM calls WHERE id = $1', [req.params.id]
      ));
    }
    if (!call?.recording_url) return res.status(404).json({ error: 'No recording for this call' });

    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) return res.status(503).json({ error: 'Twilio credentials not configured' });

    // Ask Twilio for MP3 explicitly. Without an extension the API can answer with an
    // unsized/chunked body, and an <audio> element that never learns Content-Length
    // reports duration Infinity — which iOS renders as "Live Broadcast", unplayable.
    let url = call.recording_url;
    if (!/\.(mp3|wav)(\?|$)/i.test(url)) url += '.mp3';
    // Review §5 A6: only api.twilio.com on our account gets our credentials.
    url = twilioMediaUrl(url, sid);
    if (!url) {
      console.warn(`[recording proxy] refused to fetch recording for call ${req.params.id}: URL not on our Twilio account`);
      return res.status(502).json({ error: 'Recording unavailable' });
    }

    const twilioAuth = Buffer.from(sid + ':' + token).toString('base64');
    const audioRes = await fetch(url, { headers: { Authorization: 'Basic ' + twilioAuth } });

    if (!audioRes.ok) {
      return res.status(audioRes.status).json({ error: 'Twilio returned ' + audioRes.status });
    }

    // Buffer the whole recording so its length is ALWAYS known. Previously we mirrored
    // Twilio's headers and only set Content-Length when Twilio supplied one; when it
    // didn't, iOS got no duration and refused to play. Recordings are small (a 60-minute
    // call is a few MB), so holding one in memory briefly is cheap and removes the
    // dependency on upstream behaviour entirely.
    const audio = Buffer.from(await audioRes.arrayBuffer());

    res.set('Content-Type', audioRes.headers.get('content-type') || 'audio/mpeg');
    res.set('Cache-Control', 'private, max-age=3600');
    res.set('Accept-Ranges', 'bytes');

    // iOS probes with a Range request (often "bytes=0-1") and expects a real 206.
    // We answer it ourselves rather than forwarding it upstream.
    const rangeHeader = req.headers.range;
    const m = rangeHeader && /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (m) {
      let start = m[1] === '' ? null : parseInt(m[1], 10);
      let end   = m[2] === '' ? null : parseInt(m[2], 10);
      if (start === null) {
        // suffix form, e.g. "bytes=-500" = the last 500 bytes
        start = Math.max(0, audio.length - (end || 0));
        end   = audio.length - 1;
      } else if (end === null || end >= audio.length) {
        end = audio.length - 1;
      }
      if (start >= audio.length || start > end) {
        res.set('Content-Range', 'bytes */' + audio.length);
        return res.status(416).end();
      }
      const slice = audio.subarray(start, end + 1);
      res.status(206);
      res.set('Content-Range', 'bytes ' + start + '-' + end + '/' + audio.length);
      res.set('Content-Length', String(slice.length));
      return res.end(slice);
    }

    res.status(200);
    res.set('Content-Length', String(audio.length));
    return res.end(audio);
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

// ── In-call controls (hold, resume, transfer, hangup) ─────────────────────────
// Review §5 A5 (2026-10-05): every route validates callSid / agent ids, builds
// TwiML with twilio.twiml.VoiceResponse (helpers/callControl.js) and refuses to
// touch a call that doesn't belong to the requesting agent (403).
//
// Batch 4b (2026-10-06): Hold no longer redirects a leg out of the <Dial> (that
// hung up the agent's browser leg, so the desktop app thought the call ended).
// The FIRST Hold moves both legs into a Twilio Conference room named after the
// customer's call SID (see helpers/callControl.js header for the mechanics);
// from then on Hold/Resume are participant hold on/off and the agent's leg is
// never touched. Works the same for inbound (customer = parent leg) and
// outbound (customer = child leg) calls, and for a leg that was transferred.

const {
  parseAgentId, isCallSid, dialAgentTwiml, callBelongsToAgent, identifyLegs,
  roomFor, conferenceTwiml, registerMove, setRoom, getRoom,
} = require('../helpers/callControl');
const { recordingActive } = require('../helpers/recordingNotice');

function getTwilioClient() {
  const sid    = process.env.TWILIO_ACCOUNT_SID;
  const token  = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('Twilio credentials not configured');
  return require('twilio')(sid, token);
}

// Fetch the call the browser gave us plus its parent (the PSTN leg) if any,
// or — for an outbound browser call — its children (the customer's leg).
// Returns null when Twilio doesn't know the SID.
async function resolveCall(client, callSid) {
  let call;
  try {
    call = await client.calls(callSid).fetch();
  } catch (e) {
    console.warn(`[callControl] Could not fetch ${callSid}:`, e.message);
    return null;
  }
  let parent = null;
  let children = [];
  if (call.parentCallSid) {
    try {
      parent = await client.calls(call.parentCallSid).fetch();
    } catch (e) {
      console.warn(`[callControl] Could not fetch parent ${call.parentCallSid}:`, e.message);
    }
  } else {
    try {
      children = await client.calls.list({ parentCallSid: call.sid, limit: 10 });
    } catch (e) {
      console.warn(`[callControl] Could not list children of ${call.sid}:`, e.message);
    }
  }
  return { call, parent, children };
}

// Shared preamble: validate the SID, find the call, prove it's the requester's,
// work out which leg is the customer. Sends the error response itself and
// returns null when the caller must stop.
async function authorizeCallControl(req, res, label) {
  const { callSid } = req.body || {};
  if (!isCallSid(callSid)) {
    res.status(400).json({ error: 'A valid callSid is required' });
    return null;
  }
  const client   = getTwilioClient();
  const resolved = await resolveCall(client, callSid);
  if (!resolved) {
    res.status(404).json({ error: 'Call not found' });
    return null;
  }
  const { rows } = await pool.query(
    'SELECT id, phone_number FROM agents WHERE id = $1 AND is_active = true',
    [req.agent.id]
  );
  const me = rows[0];
  if (!me || !callBelongsToAgent(resolved, me)) {
    console.warn(`[${label}] agent ${req.agent.id} denied control of ${callSid} (from=${resolved.call.from} to=${resolved.call.to})`);
    res.status(403).json({ error: "This call isn't yours to control" });
    return null;
  }
  const legs = identifyLegs(resolved);
  if (!legs) {
    console.warn(`[${label}] could not identify the customer leg of ${callSid} (from=${resolved.call.from} to=${resolved.call.to}, children=${resolved.children.length})`);
    res.status(409).json({ error: 'The other side of this call could not be found' });
    return null;
  }
  return { client, ...resolved, legs, room: roomFor(legs.customerSid) };
}

function twilioFailure(res, label, e) {
  console.error(`[${label}]`, e.message);
  const msg = e.message === 'Twilio credentials not configured'
    ? 'Calling is not configured on this server'
    : 'Call control failed — please try again';
  res.status(502).json({ error: msg });
}

// The in-progress conference for this call, or null if the call is still a
// plain <Dial> bridge (no Hold yet).
async function findRoom(client, room) {
  const known = getRoom(room);
  if (known?.conferenceSid) {
    try {
      const conf = await client.conferences(known.conferenceSid).fetch();
      if (conf.status === 'in-progress') return conf;
    } catch (e) { /* fall through to the list lookup */ }
  }
  const list = await client.conferences.list({ friendlyName: room, status: 'in-progress', limit: 1 });
  return list[0] || null;
}

function holdMusicUrl() {
  return `${process.env.SERVER_URL || ''}/webhooks/voice/hold-music`;
}

// First Hold: create the call row now, status 'in-progress', so the <Dial>
// recording that completes mid-call has somewhere to land and nothing logs a
// second row later. The SID it is keyed by matches what the other loggers
// use: the customer's SID for inbound, the agent's own leg for outbound.
async function ensureInProgressRow({ legs, twilioCall, agentId, optOut }) {
  const rowSid = legs.direction === 'inbound' ? legs.customerSid : legs.agentSid;
  const { rows: have } = await pool.query('SELECT id FROM calls WHERE twilio_call_sid = $1', [rowSid]);
  if (have.length) return rowSid;

  const { phoneVariants } = require('../helpers/phone');
  const { e164, variants } = phoneVariants(legs.phone);
  let { rows: [contact] } = await pool.query(
    'SELECT * FROM contacts WHERE phone_number = ANY($1::text[]) ORDER BY (phone_number = $2) DESC LIMIT 1',
    [variants, e164]
  );
  if (!contact) {
    ({ rows: [contact] } = await pool.query(
      'INSERT INTO contacts (phone_number, name) VALUES ($1, $2) RETURNING *', [e164, e164]
    ));
  }
  let { rows: [conv] } = await pool.query(
    'SELECT * FROM conversations WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 1', [contact.id]
  );
  if (!conv) {
    ({ rows: [conv] } = await pool.query(
      'INSERT INTO conversations (contact_id, last_message_at) VALUES ($1, NOW()) RETURNING *', [contact.id]
    ));
  }
  const startedAt = twilioCall?.startTime ? new Date(twilioCall.startTime).toISOString() : new Date().toISOString();
  await pool.query(`
    INSERT INTO calls (conversation_id, agent_id, direction, duration, status, twilio_call_sid, started_at, recording_opt_out)
    VALUES ($1, $2, $3, 0, 'in-progress', $4, $5, $6)
  `, [conv.id, agentId, legs.direction, rowSid, startedAt, !!optOut]);
  console.log(`[hold] created in-progress row for ${rowSid} (${legs.direction}, ${legs.phone})`);
  return rowSid;
}

// PUT the customer on hold. First time: move the call into a conference room
// (the agent stays connected); afterwards: participant hold.
router.post('/hold', requireAuth, async (req, res) => {
  try {
    const ctx = await authorizeCallControl(req, res, 'hold');
    if (!ctx) return;
    const { client, legs, room } = ctx;
    const conf = await findRoom(client, room);
    if (conf) {
      await client.conferences(conf.sid).participants(legs.customerSid)
        .update({ hold: true, holdUrl: holdMusicUrl(), holdMethod: 'POST' });
      setRoom(room, { conferenceSid: conf.sid, holdOnJoin: false });
      console.log(`[hold] customer ${legs.customerSid} on hold in ${room}`);
      return res.json({ success: true, customerCallSid: legs.customerSid, upgraded: false });
    }

    // First Hold on this call → upgrade to a conference.
    const optOut = req.body.recordingOptOut === true;
    const rowSid = await ensureInProgressRow({ legs, twilioCall: ctx.call, agentId: req.agent.id, optOut });
    const record = recordingActive() && !optOut;
    setRoom(room, {
      customerSid: legs.customerSid, agentSid: legs.agentSid, agentId: req.agent.id,
      rowSid, holdOnJoin: true, transferring: false,
    });
    registerMove(legs.dialParentSid, { room, agentSid: legs.agentSid, customerSid: legs.customerSid, rowSid, record });

    // Redirect the CHILD leg first; the parent's <Dial> then ends and its action
    // webhook (joinPendingRoom in webhooks/voice.js) sends it to the same room.
    const childSid     = legs.dialParentSid === legs.customerSid ? legs.agentSid : legs.customerSid;
    const childIsAgent = childSid === legs.agentSid;
    console.log(`[hold] upgrading ${legs.direction} call to ${room}: child=${childSid} (${childIsAgent ? 'agent' : 'customer'}), parent=${legs.dialParentSid}`);
    await client.calls(childSid).update({
      twiml: conferenceTwiml(room, {
        endOnExit:   childIsAgent,
        serverUrl:   process.env.SERVER_URL || '',
        record,
        customerSid: rowSid,
      }),
    });
    res.json({ success: true, customerCallSid: legs.customerSid, upgraded: true });
  } catch (e) {
    twilioFailure(res, 'hold', e);
  }
});

// Resume from hold — un-hold the customer in the room. `agentId` in the body is
// accepted for backwards compatibility but must be the requester.
router.post('/resume', requireAuth, async (req, res) => {
  const { agentId } = req.body || {};
  if (agentId !== undefined && agentId !== null && agentId !== '') {
    const id = parseAgentId(agentId);
    if (!id) return res.status(400).json({ error: 'agentId must be a positive integer' });
    if (id !== req.agent.id) return res.status(403).json({ error: 'You can only resume a call to yourself' });
  }
  try {
    const ctx = await authorizeCallControl(req, res, 'resume');
    if (!ctx) return;
    const { client, legs, room } = ctx;
    const conf = await findRoom(client, room);
    if (!conf) return res.status(409).json({ error: "This call isn't on hold" });
    await client.conferences(conf.sid).participants(legs.customerSid).update({ hold: false });
    setRoom(room, { conferenceSid: conf.sid, holdOnJoin: false });
    console.log(`[resume] customer ${legs.customerSid} resumed in ${room}`);
    res.json({ success: true, customerCallSid: legs.customerSid });
  } catch (e) {
    twilioFailure(res, 'resume', e);
  }
});

// Blind transfer — the customer's leg is redirected to ring another agent.
// Works from a plain <Dial> bridge and from a conference room (the customer
// leaves the room; the requester's browser disconnects itself right after).
router.post('/transfer', requireAuth, async (req, res) => {
  const targetId = parseAgentId((req.body || {}).targetAgentId);
  if (!targetId) return res.status(400).json({ error: 'targetAgentId must be a positive integer' });
  const serverUrl = process.env.SERVER_URL || '';
  try {
    const { rows } = await pool.query(
      'SELECT id FROM agents WHERE id = $1 AND is_active = true', [targetId]
    );
    if (rows.length === 0) return res.status(400).json({ error: 'Unknown or inactive agent' });

    const ctx = await authorizeCallControl(req, res, 'transfer');
    if (!ctx) return;
    const { client, legs, room } = ctx;
    if (getRoom(room)) setRoom(room, { transferring: true });   // customer leaving the room is expected
    console.log(`[transfer] Transferring ${legs.customerSid} to agent_${targetId}`);
    await client.calls(legs.customerSid).update({ twiml: dialAgentTwiml(targetId, serverUrl) });
    res.json({ success: true });
  } catch (e) {
    twilioFailure(res, 'transfer', e);
  }
});

// Hang up the customer's leg. Used by the app when the agent ends a call while
// the customer is on hold (the agent's own leg is disconnected client-side).
router.post('/hangup', requireAuth, async (req, res) => {
  try {
    const ctx = await authorizeCallControl(req, res, 'hangup');
    if (!ctx) return;
    const { client, legs, room } = ctx;
    if (getRoom(room)) setRoom(room, { transferring: true });   // don't double-end the agent leg
    console.log(`[hangup] ending customer leg ${legs.customerSid}`);
    await client.calls(legs.customerSid).update({ status: 'completed' });
    res.json({ success: true });
  } catch (e) {
    twilioFailure(res, 'hangup', e);
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

    // Call Lists (2026-10-03): when this call was dialled from a list, the same
    // Save also records the attempt on that entry (closing dispositions take it
    // off the list; left_voicemail / callback_requested keep it). Never fails
    // the wrap-up itself — the list is secondary to logging the call.
    if (body.list_entry_id && body.disposition) {
      try {
        const CL = require('../helpers/callLists');
        if (CL.isKnownOutcome(body.disposition)) {
          await CL.recordOutcome({
            entryId: parseInt(body.list_entry_id, 10), agentId: req.agent.id, outcome: body.disposition,
            note: body.note || null, callbackAt: body.callback_at || null, callId,
          });
        }
      } catch (e) {
        console.error('[wrap-up] call-list outcome failed:', e.message);
      }
    }

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
      // 2026-10-05: the outcome pill goes onto the Zoho Call record too, so a
      // Zoho-only user sees "Demo scheduled" without opening the note.
      if (body.disposition && call.zoho_call_id) {
        setImmediate(async function() {
          try {
            const outcome = require('../helpers/deploySettings').dispositionLabel(body.disposition);
            const { rows: [info] } = await pool.query(
              'SELECT ca.direction, ca.status, a.name AS agent_name, co.name AS contact_name, co.phone_number ' +
              'FROM calls ca LEFT JOIN agents a ON a.id = ca.agent_id ' +
              'LEFT JOIN conversations c ON c.id = ca.conversation_id LEFT JOIN contacts co ON co.id = c.contact_id ' +
              'WHERE ca.id = $1', [callId]);
            const callType = info.status === 'missed' ? 'Missed' : info.direction === 'inbound' ? 'Inbound' : 'Outbound';
            await require('../zoho').updateZohoCall(call.zoho_call_id, {
              Subject:     callType + ' call - ' + (info.contact_name || info.phone_number) + ' — ' + outcome,
              Description: `Logged by ${process.env.BRAND_NAME || 'BTI Voice'}. Agent: ` + (info.agent_name || 'Unknown') +
                           '. Status: ' + (info.status || 'completed') + '. Outcome: ' + outcome + '.',
            });
          } catch (e) {
            console.error('[wrap-up] Zoho outcome update failed:', e.message);
          }
        });
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
