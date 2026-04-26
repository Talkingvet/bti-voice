const express = require('express');
const twilio  = require('twilio');
const { pool } = require('../db');
const { getIO } = require('../socket');
const { createNotification } = require('../notifications');

const router = express.Router();

// ── Auto-log a call to the BTI Voice DB + Zoho ────────────────────────────────
// Called from <Dial> action URLs — fires for every call regardless of Twilio
// console statusCallback config. Fire-and-forget, never throws.
function autoLogCall({ callSid, from, to, duration, direction, status, callStartTime }) {
  if (!callSid || !from) return;
  // Skip internal Twilio browser-client identifiers (e.g. "client:agent_2")
  if (from.toLowerCase().startsWith('client:') || (to || '').toLowerCase().startsWith('client:')) return;
  setImmediate(async () => {
    try {
      const port = process.env.PORT || 3000;

      // Deduplicate: if already logged by the frontend, skip
      const { rows: existing } = await pool.query(
        'SELECT id FROM calls WHERE twilio_call_sid = $1', [callSid]
      );
      if (existing.length > 0) {
        console.log(`[autoLog] ${callSid} already in DB — skipping`);
        return;
      }

      const phone   = direction === 'inbound' ? from : to;
      const digits  = (phone || '').replace(/\D/g, '');
      const e164    = digits.length === 10 ? '+1' + digits
                    : digits.length === 11 && digits.startsWith('1') ? '+' + digits
                    : phone;
      const tenDigit = digits.length === 11 ? digits.slice(1) : digits;

      // Secondary dedup: check if the frontend already logged this call.
      // The browser SDK gives the child leg SID (different from the parent SID we have here),
      // so we can't match by SID. We also cannot assume the frontend record has twilio_call_sid IS NULL
      // because the frontend DOES send its child SID. So match by phone + direction + time window only,
      // excluding only records that already have OUR exact parent SID (those would be self-matches).
      const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { rows: [frontendRecord] } = await pool.query(`
        SELECT ca.id, ca.twilio_call_sid FROM calls ca
        JOIN conversations cv ON cv.id = ca.conversation_id
        JOIN contacts co ON co.id = cv.contact_id
        WHERE (ca.twilio_call_sid IS NULL OR ca.twilio_call_sid != $4)
          AND ca.direction = $1
          AND co.phone_number = ANY($2::text[])
          AND ca.started_at > $3
        ORDER BY ca.started_at DESC LIMIT 1
      `, [direction, [e164, phone, tenDigit], thirtyMinsAgo, callSid]);
      if (frontendRecord) {
        // Frontend beat the webhook — stamp the parent SID so future dedup works
        await pool.query('UPDATE calls SET twilio_call_sid = $1 WHERE id = $2', [callSid, frontendRecord.id]);
        console.log(`[autoLog] Matched frontend-logged call for ${phone} — stamped SID ${callSid}`);
        return;
      }

      // Find or create contact
      let contact = null;
      for (const p of [e164, phone, tenDigit]) {
        const { rows } = await pool.query(
          'SELECT * FROM contacts WHERE phone_number = $1', [p]
        );
        if (rows[0]) { contact = rows[0]; break; }
      }
      if (!contact) {
        const { rows } = await pool.query(
          'INSERT INTO contacts (phone_number, name) VALUES ($1, $2) RETURNING *',
          [e164, e164]
        );
        contact = rows[0];
      }

      // Find or create conversation
      let { rows: [conv] } = await pool.query(
        'SELECT * FROM conversations WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 1',
        [contact.id]
      );
      if (!conv) {
        const { rows } = await pool.query(
          'INSERT INTO conversations (contact_id, last_message_at) VALUES ($1, NOW()) RETURNING *',
          [contact.id]
        );
        conv = rows[0];
      }

      // Use Twilio's CallStartTime if available — much more accurate than backdating from Date.now().
      // Backdating from Date.now() causes started_at to be 30-90s off (webhook processing delay),
      // which breaks time-window dedup against frontend-logged records.
      const startedAt = callStartTime
        ? new Date(callStartTime).toISOString()
        : new Date(Date.now() - duration * 1000).toISOString();
      const { rows: [call] } = await pool.query(`
        INSERT INTO calls
          (conversation_id, direction, duration, status, twilio_call_sid, started_at, ended_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING *
      `, [conv.id, direction, duration, status, callSid, startedAt]);

      console.log(`[autoLog] ✓ Logged call ${callSid} (${status}) for ${phone}`);

      // Sync to Zoho
      if (process.env.ZOHO_REFRESH_TOKEN) {
        fetch(`http://localhost:${port}/api/zoho/log-call`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ call_id: call.id }),
        }).catch(e => console.error('[autoLog→Zoho]', e.message));
      }

      // Notify connected clients
      const io = getIO();
      if (io) io.emit('call_logged', { call_id: call.id });

    } catch (e) {
      console.error('[autoLog] failed:', e.message);
    }
  });
}

// ── Outbound: browser → PSTN ──────────────────────────────────────────────────
router.post('/outbound', async (req, res) => {
  const { To } = req.body;
  const callerId = process.env.TWILIO_PHONE_NUMBER;
  const twiml = new twilio.twiml.VoiceResponse();

  console.log(`[outbound] To=${To} callerId=${callerId}`);

  if (!callerId) {
    console.error('[outbound] ⚠️  TWILIO_PHONE_NUMBER is not set — outbound calls will fail');
  }

  if (To) {
    const dial = twiml.dial({ callerId, ...recordingOpts() });
    dial.number(To);
    console.log(`[outbound] TwiML: dial ${To} from ${callerId}`);
  } else {
    console.error('[outbound] ⚠️  No To parameter received — check TwiML App Voice Request URL');
    twiml.say('No destination number provided.');
  }

  res.set('Content-Type', 'text/xml');
  res.send(twiml.toString());
});

// ── Inbound: checks IVR, falls through to default agent or all agents ─────────
router.post('/inbound', async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const { CallSid } = req.body;

  // Register statusCallback on this call via REST API so we log it regardless
  // of what happens next (answered, missed, hung up during IVR, voicemail, etc.)
  if (CallSid && process.env.SERVER_URL && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    try {
      const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await twilioClient.calls(CallSid).update({
        statusCallback:       `${process.env.SERVER_URL}/webhooks/voice/status`,
        statusCallbackMethod: 'POST',
        statusCallbackEvent:  ['completed'],
      });
      console.log(`[inbound] ✓ Registered statusCallback for ${CallSid}`);
    } catch (e) {
      console.error('[inbound] statusCallback registration failed:', e.message);
    }
  }

  try {
    const { rows: settingsRows } = await pool.query(
      'SELECT * FROM ivr_settings WHERE id = 1 LIMIT 1'
    );
    const settings = settingsRows[0];

    if (settings?.enabled) {
      const { rows: menu } = await pool.query(
        'SELECT * FROM ivr_menus WHERE is_active = true ORDER BY sort_order, digit'
      );

      if (menu.length > 0) {
        const voice = settings.voice || 'Polly.Joanna-Neural';

        // Single gather — greeting + all options + repeat hint
        const gather = twiml.gather({
          numDigits: 1,
          action:    '/webhooks/voice/ivr-gather',
          method:    'POST',
          timeout:   8,
        });

        // Intro only
        gather.say({ voice }, settings.greeting);

        // Read each menu option
        menu.forEach(item => {
          const isVoicemail = item.destination_type === 'voicemail';
          const phrase = isVoicemail
            ? `Or to leave a voicemail, press ${item.digit}.`
            : `For ${item.label}, press ${item.digit}.`;
          gather.say({ voice }, phrase);
        });

        // "Press 5 to repeat" as the last option
        gather.say({ voice }, 'To hear these options again, press 5.');

        // No digit pressed → 5 seconds of silence, then auto-repeat
        twiml.pause({ length: 5 });
        twiml.redirect({ method: 'POST' }, '/webhooks/voice/inbound');

        res.set('Content-Type', 'text/xml');
        return res.send(twiml.toString());
      }
    }

    // IVR disabled or no menu — use default agent or ring all
    if (settings?.default_agent_id) {
      await dialAgent(twiml, settings.default_agent_id);
    } else {
      await ringAllAgents(twiml);
    }
  } catch (e) {
    console.error('[voice/inbound]', e.message);
    twiml.say('An error occurred. Please try again.');
  }

  res.set('Content-Type', 'text/xml');
  res.send(twiml.toString());
});

// ── IVR digit handler ─────────────────────────────────────────────────────────
router.post('/ivr-gather', async (req, res) => {
  const { Digits } = req.body;
  const fallback     = req.query.fallback === '1';
  const defaultAgent = req.query.default_agent ? parseInt(req.query.default_agent) : null;
  const twiml = new twilio.twiml.VoiceResponse();

  console.log(`[ivr-gather] Digits="${Digits}" fallback=${fallback} defaultAgent=${defaultAgent}`);

  try {
    // Load settings (voice, default agent)
    const { rows: settingsRows } = await pool.query(
      'SELECT default_agent_id, voice FROM ivr_settings WHERE id = 1 LIMIT 1'
    );
    const voice                = settingsRows[0]?.voice || 'Polly.Joanna-Neural';
    const settingsDefaultAgent = settingsRows[0]?.default_agent_id || null;

    // Timeout fallback — ring default agent or all agents
    if (fallback || !Digits) {
      console.log('[ivr-gather] Timeout/no-digit fallback → routing to agent');
      if (defaultAgent || settingsDefaultAgent) {
        await dialAgent(twiml, defaultAgent || settingsDefaultAgent);
      } else {
        await ringAllAgents(twiml);
      }
      res.set('Content-Type', 'text/xml');
      return res.send(twiml.toString());
    }

    // Digit 5 = replay the menu
    if (Digits === '5') {
      twiml.pause({ length: 1 });
      twiml.redirect({ method: 'POST' }, '/webhooks/voice/inbound');
      res.set('Content-Type', 'text/xml');
      return res.send(twiml.toString());
    }

    const { rows } = await pool.query(
      'SELECT * FROM ivr_menus WHERE digit = $1 AND is_active = true LIMIT 1',
      [Digits]
    );
    const item = rows[0];

    if (!item) {
      // Invalid digit → connect to default agent
      console.log(`[ivr-gather] Unknown digit "${Digits}" → routing to default agent`);
      twiml.say({ voice }, "Let me connect you now.");
      if (defaultAgent || settingsDefaultAgent) {
        await dialAgent(twiml, defaultAgent || settingsDefaultAgent);
      } else {
        await ringAllAgents(twiml);
      }
      res.set('Content-Type', 'text/xml');
      return res.send(twiml.toString());
    }

    console.log(`[ivr-gather] Routing digit "${Digits}" → type=${item.destination_type} value=${item.destination_value}`);

    switch (item.destination_type) {

      case 'sequential': {
        const agentIds = parseAgentList(item.destination_value);
        console.log(`[ivr-gather] Sequential ring: ${JSON.stringify(agentIds)}`);
        dialSequential(twiml, agentIds, settingsDefaultAgent);
        break;
      }

      case 'agent': {
        const agentId = parseInt(item.destination_value, 10);
        if (!agentId || isNaN(agentId)) {
          console.error(`[ivr-gather] Invalid agent destination_value="${item.destination_value}" — falling back to ringAll`);
          await ringAllAgents(twiml);
        } else {
          console.log(`[ivr-gather] Dialing agent_${agentId}`);
          await dialAgent(twiml, agentId);
        }
        break;
      }

      case 'voicemail': {
        const serverUrl = process.env.SERVER_URL || '';
        twiml.say({ voice }, 'Please leave a message after the tone. Press pound when finished.');
        twiml.record({
          maxLength:               120,
          finishOnKey:             '#',
          transcribe:              false,
          recordingStatusCallback: `${serverUrl}/webhooks/voice/recording-complete`,
          recordingStatusCallbackMethod: 'POST',
        });
        twiml.say({ voice }, 'Thank you for your message. Goodbye.');
        break;
      }

      case 'all_agents':
      default:
        console.log('[ivr-gather] Ringing all agents');
        await ringAllAgents(twiml);
        break;
    }

  } catch (e) {
    console.error('[voice/ivr-gather]', e.message);
    twiml.say('An error occurred. Please try again.');
  }

  res.set('Content-Type', 'text/xml');
  res.send(twiml.toString());
});

// ── Sequential ring: next agent in waterfall ──────────────────────────────────
router.post('/next-agent', async (req, res) => {
  const { DialCallStatus, CallSid, From, To, DialCallDuration } = req.body;
  const twiml = new twilio.twiml.VoiceResponse();

  console.log(`[next-agent] DialCallStatus=${DialCallStatus} CallSid=${CallSid}`);

  if (DialCallStatus === 'completed' || DialCallStatus === 'answered') {
    autoLogCall({
      callSid:       CallSid,
      from:          From,
      to:            To,
      duration:      parseInt(DialCallDuration) || 0,
      direction:     'inbound',
      status:        'completed',
      callStartTime: req.body.CallStartTime,
    });
    res.set('Content-Type', 'text/xml');
    return res.send(twiml.toString());
  }

  const queue        = req.query.queue ? req.query.queue.split(',').filter(Boolean) : [];
  const defaultAgent = req.query.default_agent ? parseInt(req.query.default_agent) : null;

  if (queue.length > 0) {
    dialSequential(twiml, queue, defaultAgent);
  } else if (defaultAgent) {
    await dialAgent(twiml, defaultAgent);
  } else {
    twiml.say({ voice: 'Polly.Joanna-Neural' }, 'Sorry, no one is available right now. Please try again later.');
  }

  res.set('Content-Type', 'text/xml');
  res.send(twiml.toString());
});

// ── No-answer fallback — called when a single-agent dial fails ────────────────
// Twilio fires this when the <Dial> action URL is hit after no-answer/busy/failed.
// It is ALSO called when DialCallStatus=completed (call answered and finished).
// We use this as our most reliable call-logging hook — no Twilio console config needed.
router.post('/no-answer', async (req, res) => {
  const { DialCallStatus, CallSid, From, To, DialCallDuration } = req.body;
  const twiml = new twilio.twiml.VoiceResponse();

  console.log(`[no-answer] DialCallStatus=${DialCallStatus} CallSid=${CallSid} From=${From}`);

  // If the call was actually connected and completed, log it and return
  if (DialCallStatus === 'completed' || DialCallStatus === 'answered') {
    autoLogCall({
      callSid:       CallSid,
      from:          From,
      to:            To,
      duration:      parseInt(DialCallDuration) || 0,
      direction:     'inbound',
      status:        'completed',
      callStartTime: req.body.CallStartTime,
    });
    res.set('Content-Type', 'text/xml');
    return res.send(twiml.toString());
  }

  // Agent didn't answer — try ringing all agents as final fallback
  // (don't log yet — wait for the ringAllAgents <Dial> action to fire)
  try {
    await ringAllAgents(twiml);
  } catch (e) {
    // ringAllAgents failed entirely — log as missed now
    autoLogCall({
      callSid:       CallSid,
      from:          From,
      to:            To,
      duration:      0,
      direction:     'inbound',
      status:        'missed',
      callStartTime: req.body.CallStartTime,
    });
    // Fire auto-text on total miss
    setImmediate(() => sendMissedCallAutoText(From));
    twiml.say({ voice: 'Polly.Joanna-Neural' }, 'Sorry, no one is available right now. Please leave a voicemail or try again later.');
  }

  res.set('Content-Type', 'text/xml');
  res.send(twiml.toString());
});

// ── Call status callback — Twilio fires this on every call state change ───────
// Must return 200 or Twilio logs error 15003 and may drop the call.
// We also use the terminal states (completed/no-answer/busy/failed) to ensure
// every call is logged in the BTI Voice DB and synced to Zoho CRM, even if the
// browser SDK missed the disconnect event.
router.post('/status', async (req, res) => {
  const { CallStatus, CallSid, From, To, Direction, CallDuration } = req.body;
  console.log(`[status] CallStatus=${CallStatus} CallSid=${CallSid} From=${From} To=${To}`);
  res.sendStatus(200); // Always respond 200 immediately

  // Only process terminal states on parent calls (inbound from PSTN have no
  // parentCallSid; child / agent-leg calls do — skip those to avoid double-logging)
  const terminal = ['completed', 'no-answer', 'busy', 'failed', 'canceled'];
  if (!terminal.includes(CallStatus)) return;
  if (req.body.ParentCallSid) return; // child leg — skip
  // Skip browser-client legs (To = "client:agent_X") — not real PSTN calls
  if ((req.body.To || '').toLowerCase().startsWith('client:')) return;
  if ((req.body.From || '').toLowerCase().startsWith('client:')) return;

  const phone    = Direction === 'inbound' ? From : To;
  const duration = parseInt(CallDuration) || 0;
  const callDir  = Direction === 'inbound' ? 'inbound' : 'outbound';
  const status   = CallStatus === 'completed' ? 'completed'
                 : CallStatus === 'no-answer'  ? 'missed'
                 : 'missed';

  if (!phone) return;

  // Fire-and-forget — don't let errors bubble
  setImmediate(async () => {
    try {
      // Check if this call SID was already logged (by frontend or a previous webhook)
      const existing = await pool.query(
        'SELECT id FROM calls WHERE twilio_call_sid = $1', [CallSid]
      );
      if (existing.rows.length > 0) {
        console.log(`[status] CallSid ${CallSid} already logged — skipping`);
        return;
      }

      // Normalize phone number up front (needed for both dedup and contact lookup)
      const digits  = phone.replace(/\D/g, '');
      const normalized = (digits.length === 11 && digits.startsWith('1'))
        ? '+' + digits
        : digits.length === 10
          ? '+1' + digits
          : phone;

      // Secondary dedup: check if the frontend already logged this call.
      // Frontend records have a child SID (not null, not our parent SID), so we
      // cannot use IS NULL. Match by phone + direction + time, excluding our own SID.
      const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const dupeCheck = await pool.query(`
        SELECT ca.id FROM calls ca
        JOIN conversations cv ON cv.id = ca.conversation_id
        JOIN contacts co ON co.id = cv.contact_id
        WHERE (ca.twilio_call_sid IS NULL OR ca.twilio_call_sid != $4)
          AND ca.direction = $1
          AND co.phone_number = ANY($2::text[])
          AND ca.started_at > $3
        LIMIT 1
      `, [callDir, [normalized, phone], thirtyMinsAgo, CallSid]);
      if (dupeCheck.rows.length > 0) {
        // Update the existing record with the SID so future dedup works
        await pool.query('UPDATE calls SET twilio_call_sid = $1 WHERE id = $2', [CallSid, dupeCheck.rows[0].id]);
        console.log(`[status] Matched frontend-logged call for ${phone} — updated SID, skipping duplicate`);
        return;
      }

      // Find or create contact
      let { rows: [contact] } = await pool.query(
        'SELECT * FROM contacts WHERE phone_number = $1', [normalized]
      );
      if (!contact) {
        // Try alternate formats
        const alt = digits.length === 11 ? digits.slice(1) : '1' + digits;
        ({ rows: [contact] } = await pool.query(
          'SELECT * FROM contacts WHERE phone_number = $1', [alt]
        ));
      }
      if (!contact) {
        const r = await pool.query(
          'INSERT INTO contacts (phone_number, name) VALUES ($1, $2) RETURNING *',
          [normalized, normalized]
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

      // Log the call with the Twilio SID so we can deduplicate
      const startedAt = new Date(Date.now() - duration * 1000).toISOString();
      const { rows: [call] } = await pool.query(`
        INSERT INTO calls
          (conversation_id, direction, duration, status, twilio_call_sid, started_at, ended_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING *
      `, [conv.id, callDir, duration, status, CallSid, startedAt]);

      console.log(`[status] ✓ Auto-logged call ${CallSid} for ${phone} (${status})`);

      // Send missed-call auto-text if enabled
      if (status === 'missed' && callDir === 'inbound') {
        sendMissedCallAutoText(phone);
        // Create missed call notification
        const contactLabel = contact?.name || phone;
        createNotification({
          type:  'missed_call',
          title: `Missed call – ${contactLabel}`,
          body:  `${phone} called and no one answered.`,
          meta:  { call_id: call.id, phone },
        });
      }

      // Sync to Zoho CRM
      if (process.env.ZOHO_REFRESH_TOKEN) {
        const port = process.env.PORT || 3000;
        fetch(`http://localhost:${port}/api/zoho/log-call`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ call_id: call.id }),
        }).catch(e => console.error('[status→Zoho]', e.message));
      }

      // Notify connected clients
      const io = getIO();
      if (io) io.emit('call_logged', { call_id: call.id });

    } catch (e) {
      console.error('[status webhook] auto-log failed:', e.message);
    }
  });
});

// ── Recording complete — transcribe + AI summary ──────────────────────────────
router.post('/recording-complete', async (req, res) => {
  // Respond immediately so Twilio doesn't retry
  res.sendStatus(200);

  const { RecordingUrl, RecordingDuration, RecordingSid, CallSid, From } = req.body;
  if (!RecordingUrl) return;

  // Skip very short recordings (< 3s — likely silence or hangups)
  const duration = parseInt(RecordingDuration) || 0;
  if (duration < 3) return;

  // Run the whole pipeline fire-and-forget
  setImmediate(async () => {
    try {
      const mp3Url = RecordingUrl + '.mp3';

      // Find the matching call record by twilio_call_sid, or the most recent one
      let { rows: [callRecord] } = await pool.query(
        `SELECT ca.*, co.phone_number AS contact_phone, co.name AS contact_name, co.id AS contact_id
         FROM calls ca
         JOIN conversations cv ON cv.id = ca.conversation_id
         JOIN contacts co      ON co.id = cv.contact_id
         WHERE ca.twilio_call_sid = $1 OR ca.status = 'voicemail'
         ORDER BY ca.started_at DESC LIMIT 1`,
        [CallSid]
      );

      // If this is a voicemail (no existing call record), create one
      if (!callRecord || callRecord.status === 'voicemail') {
        const phone = From || 'unknown';
        await pool.query('INSERT INTO contacts (phone_number, name) VALUES ($1, $2) ON CONFLICT (phone_number) DO NOTHING', [phone, phone]);
        const { rows: [contact] } = await pool.query('SELECT * FROM contacts WHERE phone_number = $1', [phone]);
        let { rows: [conv] } = await pool.query(
          'SELECT * FROM conversations WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 1', [contact.id]
        );
        if (!conv) {
          const r = await pool.query(
            'INSERT INTO conversations (contact_id, last_message_at) VALUES ($1, NOW()) RETURNING *', [contact.id]
          );
          conv = r.rows[0];
        }
        const { rows: [newCall] } = await pool.query(`
          INSERT INTO calls (conversation_id, direction, duration, status, recording_url, recording_sid, started_at, ended_at)
          VALUES ($1, 'inbound', $2, 'voicemail', $3, $4, NOW(), NOW()) RETURNING *
        `, [conv.id, duration, mp3Url, RecordingSid]);

        callRecord = { ...newCall, contact_phone: phone, contact_name: contact.name || phone, contact_id: contact.id };

        // Notify all agents of new voicemail
        const io = getIO();
        if (io) io.emit('new_voicemail', {
          id: newCall.id, from: phone, contact_name: contact.name || phone,
          duration, recording_url: mp3Url, received_at: new Date().toISOString(),
        });
      } else {
        // Update existing call record with recording URL
        await pool.query(
          'UPDATE calls SET recording_url = $1, recording_sid = $2 WHERE id = $3',
          [mp3Url, RecordingSid, callRecord.id]
        );
      }

      // ── Transcribe with OpenAI Whisper ────────────────────────────────────
      if (!process.env.OPENAI_API_KEY) {
        console.log('[recording] OPENAI_API_KEY not set — skipping transcription');
        return;
      }

      console.log(`[recording] Transcribing call ${callRecord.id} (${duration}s)…`);

      const OpenAI  = require('openai');
      const { toFile } = require('openai');
      const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      // Download audio from Twilio (requires Basic auth)
      const twilioAuth = Buffer.from(
        `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
      ).toString('base64');

      const audioRes = await fetch(mp3Url, {
        headers: { Authorization: `Basic ${twilioAuth}` },
      });
      if (!audioRes.ok) throw new Error(`Failed to fetch recording: ${audioRes.status}`);

      // Use arrayBuffer + toFile so OpenAI SDK receives a proper File object
      const rawBuffer  = await audioRes.arrayBuffer();
      const audioFile  = await toFile(Buffer.from(rawBuffer), 'call.mp3', { type: 'audio/mpeg' });

      const transcription = await openai.audio.transcriptions.create({
        file:  audioFile,
        model: 'whisper-1',
      });

      const transcriptText = transcription.text || '';
      console.log(`[recording] Transcription done (${transcriptText.length} chars)`);

      // ── AI Summary with GPT-4o-mini ───────────────────────────────────────
      const summaryRes = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are analyzing a business call for Talkingvet — an AI scribing and dictation solution for veterinary practices.
The team (Raven, Shawn, Danny) handles sales, technical support, and billing for vet clinics and practices.
Produce a concise call summary with these sections:
• Reason for Calling (1-2 sentences — why did the caller reach out?)
• Key Topics Discussed (bullet list of main subjects covered)
• Outcome (1 sentence — what was resolved, decided, or left open?)
• Sentiment (Positive / Neutral / Negative)
Keep it tight — this is for a CRM note, not a report.`,
          },
          {
            role: 'user',
            content: `Call transcript:\n\n${transcriptText}`,
          },
        ],
        max_tokens: 500,
      });

      const aiSummary = summaryRes.choices[0]?.message?.content || '';

      // ── Save to DB ────────────────────────────────────────────────────────
      await pool.query(
        'UPDATE calls SET transcription = $1, ai_summary = $2 WHERE id = $3',
        [transcriptText, aiSummary, callRecord.id]
      );

      // ── Emit to frontend so the call row updates live ─────────────────────
      const io = getIO();
      if (io) io.emit('call_transcribed', {
        call_id:       callRecord.id,
        transcription: transcriptText,
        ai_summary:    aiSummary,
      });

      // ── Sync summary to Zoho CRM as a note (fire-and-forget) ─────────────
      if (process.env.ZOHO_REFRESH_TOKEN && callRecord.contact_id) {
        try {
          await fetch(`http://localhost:${process.env.PORT || 3000}/api/zoho/add-note`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              contact_id: callRecord.contact_id,
              note:       `Call Summary (${new Date().toLocaleDateString()}):\n\n${aiSummary}`,
            }),
          });
        } catch (e) {
          console.error('[recording] Zoho note sync failed:', e.message);
        }
      }

      console.log(`[recording] ✓ Call ${callRecord.id} — transcribed + summarized`);
    } catch (e) {
      console.error('[recording-complete]', e.message);
    }
  });
});

// ── Missed-call auto-text ─────────────────────────────────────────────────────
// Sends an SMS to the caller if auto_text_enabled is set in ivr_settings.
// Fire-and-forget — never blocks Twilio response.
async function sendMissedCallAutoText(fromPhone) {
  if (!fromPhone) return;
  try {
    const { rows } = await pool.query(
      'SELECT auto_text_enabled, auto_text_message FROM ivr_settings WHERE id = 1 LIMIT 1'
    );
    const settings = rows[0];
    if (!settings?.auto_text_enabled) return;

    const message = settings.auto_text_message || "Hi! We missed your call. We'll get back to you as soon as possible.";

    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
      console.log('[autoText] Twilio not configured — skipping auto-text');
      return;
    }

    const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to:   fromPhone,
    });
    console.log(`[autoText] ✓ Sent auto-text to ${fromPhone}`);
  } catch (e) {
    console.error('[autoText] Failed:', e.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Recording requires ENABLE_RECORDING=true in addition to SERVER_URL + OPENAI_API_KEY.
function recordingOpts() {
  if (process.env.ENABLE_RECORDING !== 'true') return {};
  if (!process.env.SERVER_URL || !process.env.OPENAI_API_KEY) return {};
  return {
    record:                        'record-from-answer',
    recordingStatusCallback:       `${process.env.SERVER_URL}/webhooks/voice/recording-complete`,
    recordingStatusCallbackMethod: 'POST',
  };
}

// dialAgent: dials a specific Twilio Client browser endpoint.
// IMPORTANT: the action URL is required — without it, Twilio silently ends the
// call when the client is unavailable (no-answer, busy, not registered).
async function dialAgent(twiml, agentId, timeout = 30) {
  // Validate the agent ID before dialing — parseInt('') === NaN
  const id = parseInt(agentId, 10);
  if (!id || isNaN(id)) {
    console.error(`[dialAgent] Invalid agentId="${agentId}" — falling back to ringAll`);
    await ringAllAgents(twiml);
    return;
  }

  console.log(`[dialAgent] Dialing agent_${id} (timeout=${timeout}s)`);

  // action="/webhooks/voice/no-answer" ensures Twilio calls us back instead of
  // silently dropping the call when the client doesn't answer.
  const dial = twiml.dial({
    timeout,
    action: '/webhooks/voice/no-answer',
    method: 'POST',
    ...recordingOpts(),
  });
  dial.client(`agent_${id}`);
}

async function ringAllAgents(twiml) {
  const { rows } = await pool.query(
    'SELECT id FROM agents WHERE is_active = true ORDER BY id'
  );
  if (rows.length === 0) {
    console.log('[ringAllAgents] No active agents found');
    twiml.say({ voice: 'Polly.Joanna-Neural' }, 'No agents are available. Please try again later.');
    return;
  }
  console.log(`[ringAllAgents] Ringing ${rows.length} agents: ${rows.map(r => r.id).join(', ')}`);
  const dial = twiml.dial({
    timeout: 30,
    action:  '/webhooks/voice/no-answer',
    method:  'POST',
    ...recordingOpts(),
  });
  rows.forEach(a => dial.client(`agent_${a.id}`));
}

function parseAgentList(value) {
  try { return JSON.parse(value || '[]'); } catch { return []; }
}

function dialSequential(twiml, agentIds, defaultAgent = null) {
  if (!agentIds || agentIds.length === 0) {
    twiml.say({ voice: 'Polly.Joanna-Neural' }, 'Sorry, no one is available right now. Please try again later.');
    return;
  }
  const [first, ...rest] = agentIds.map(String);
  const params = [];
  if (rest.length > 0) params.push(`queue=${rest.join(',')}`);
  if (defaultAgent)    params.push(`default_agent=${defaultAgent}`)
  const actionUrl = `/webhooks/voice/next-agent${
    params.length ? '?' + params.join('&') : ''
  }`;

  console.log(`[dialSequential] Dialing agent_${first}, fallback queue: [${rest.join(', ')}]`);

  const dial = twiml.dial({ timeout: 25, action: actionUrl, method: 'POST' });
  dial.client(`agent_${first}`);
}

module.exports = router;
