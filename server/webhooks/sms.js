const express = require('express');
const { twilioMediaUrl } = require('../helpers/twilioUrls');
const { pool } = require('../db');
const { getIO } = require('../socket');
const { createNotification } = require('../notifications');
const { notifyTargetsFor } = require('../helpers/notifyTargets');
const { recordConsent } = require('../helpers/consent');
const { withStatusCallback, initialStatus, normalizeStatus, shouldApply, isFailure, errorText } = require('../helpers/smsStatus');

// Fire-and-forget Zoho sync — never blocks the Twilio webhook response
function syncSMSToZoho(messageId) {
  if (!require('../zoho').isZohoConfigured()) return; // Zoho not configured, skip silently
  setImmediate(async () => {
    try {
      await fetch(`http://localhost:${process.env.PORT || 3000}/api/zoho/log-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-token': require('../secret').INTERNAL_TOKEN },
        body: JSON.stringify({ message_id: messageId }),
      });
    } catch (e) {
      console.error('[Zoho sync] log-sms failed:', e.message);
    }
  });
}

const OPT_OUT_WORDS = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'];
const OPT_IN_WORDS  = ['start', 'unstop', 'yes'];

// ── After-hours auto-responder helpers ────────────────────────────────────────
function isWithinBusinessHours(s) {
  const tz = s.business_timezone || 'America/New_York';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date()).map(p => [p.type, p.value])
  );
  const dayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const days = (s.business_days || '1,2,3,4,5').split(',').map(Number);
  if (!days.includes(dayMap[parts.weekday])) return false;
  const nowMin = parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10);
  const [sh, sm] = (s.business_hours_start || '09:00').split(':').map(Number);
  const [eh, em] = (s.business_hours_end || '17:00').split(':').map(Number);
  return nowMin >= sh * 60 + sm && nowMin < eh * 60 + em;
}

// Sends the after-hours auto-reply when enabled, outside business hours,
// not a STOP/START/HELP keyword, contact not opted out, and no auto-reply
// was already sent on this conversation in the last 4 hours.
async function maybeSendAfterHoursReply({ conv, contact, From, To, keyword }) {
  try {
    if (OPT_OUT_WORDS.includes(keyword) || OPT_IN_WORDS.includes(keyword) || keyword === 'help') return;
    if (contact.opted_out) return;

    const { rows } = await pool.query(
      `SELECT after_hours_sms_enabled, after_hours_sms_message,
              business_hours_start, business_hours_end, business_days, business_timezone
       FROM ivr_settings WHERE id = 1 LIMIT 1`
    );
    const s = rows[0];
    if (!s?.after_hours_sms_enabled) return;
    if (isWithinBusinessHours(s)) return;
    // Auto-replies are outbound SMS: respect the sms add-on + subscription state.
    const smsBlock = require('../helpers/deploySettings').smsBlockedReason();
    if (smsBlock) { console.log(`[afterHours] skipped — ${smsBlock}`); return; }

    // Throttle: max one auto-reply per conversation per 4 hours
    const { rows: [c] } = await pool.query(
      'SELECT last_auto_reply_at FROM conversations WHERE id = $1', [conv.id]
    );
    if (c?.last_auto_reply_at && Date.now() - new Date(c.last_auto_reply_at).getTime() < 4 * 60 * 60 * 1000) return;

    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return;
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const params = {
      body: s.after_hours_sms_message || "Thanks for your message! Our team is away right now, but we'll reply as soon as we're back during business hours.",
      from: To, // reply from whichever number they texted
      to:   From,
    };
    if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
      params.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    }
    withStatusCallback(params); // batch 7b: carrier delivery status

    let sent;
    try {
      sent = await twilio.messages.create(params);
    } catch (twErr) {
      if (twErr.code === 21610) {
        await pool.query(
          'UPDATE contacts SET opted_out = true, opted_out_at = NOW() WHERE id = $1', [contact.id]
        );
        recordConsent({ contactId: contact.id, phone: From, action: 'opt_out', method: 'carrier_block', detail: 'Twilio error 21610 on after-hours auto-reply' });
        return;
      }
      throw twErr;
    }

    // Record as an outbound message (agent_id null = system/auto)
    const { rows: [m] } = await pool.query(`
      INSERT INTO messages (conversation_id, direction, body, from_number, to_number, twilio_sid, status)
      VALUES ($1, 'outbound', $2, $3, $4, $5, $6)
      RETURNING *
    `, [conv.id, params.body, To, From, sent.sid, initialStatus(sent)]);
    await pool.query(
      'UPDATE conversations SET last_auto_reply_at = NOW(), last_message_at = NOW() WHERE id = $1', [conv.id]
    );

    const io = getIO();
    if (io) {
      io.to(`conv_${conv.id}`).emit('new_message', { ...m, agent_id: null, agent_name: 'Auto-reply' });
      io.emit('conversation_updated', { conversation_id: conv.id });
    }
    console.log(`[afterHours] Auto-replied to ${From}`);
  } catch (e) {
    console.error('[afterHours]', e.message);
  }
}

const router = express.Router();

// Twilio sends a GET request to validate the URL when saving in the console
router.get('/', (req, res) => {
  res.set('Content-Type', 'text/xml')
  res.send('<Response></Response>')
})

// ── Delivery status callback (Review batch 7b) ───────────────────────────────
// Twilio posts here (statusCallback on every messages.create) as the carrier
// moves the text along: queued → sending → sent → delivered | undelivered |
// failed. We store the furthest-along status, the Twilio error code on a
// failure, and tell open threads over the socket. Always 200 — Twilio retries
// non-2xx responses and there is nothing a retry would fix here.
router.post('/status', async (req, res) => {
  res.status(200).send('');
  const b = req.body || {};
  const sid = b.MessageSid || b.SmsSid;
  const status = normalizeStatus(b.MessageStatus || b.SmsStatus);
  if (!sid || !status) { console.warn('[sms/status] ignored payload', JSON.stringify(b).slice(0, 200)); return; }
  const errorCode = b.ErrorCode ? String(b.ErrorCode).slice(0, 10) : null;
  try {
    const { rows: [m] } = await pool.query(
      'SELECT id, conversation_id, status FROM messages WHERE twilio_sid = $1 ORDER BY id DESC LIMIT 1', [sid]
    );
    if (!m) { console.log(`[sms/status] ${sid} ${status} — no local message (auto-text or pre-7b send)`); return; }
    if (!shouldApply(m.status, status)) { console.log(`[sms/status] ${sid} ${status} ignored (already ${m.status})`); return; }
    await pool.query(
      'UPDATE messages SET status = $2, error_code = COALESCE($3, error_code), status_updated_at = NOW() WHERE id = $1',
      [m.id, status, errorCode]
    );
    if (isFailure(status)) {
      console.warn(`[sms/status] message ${m.id} ${status}${errorCode ? ` (${errorCode}: ${errorText(errorCode)})` : ''} to ${b.To || '?'}`);
    } else {
      console.log(`[sms/status] message ${m.id} → ${status}`);
    }
    const io = getIO();
    if (io) {
      io.to(`conv_${m.conversation_id}`).emit('message_status', {
        id: m.id, conversation_id: m.conversation_id, status,
        error_code: errorCode, error_text: errorText(errorCode),
      });
    }
  } catch (e) {
    console.error('[sms/status]', e.message);
  }
});

router.post('/', async (req, res) => {
  const { From, To, Body, MessageSid } = req.body;

  // Always respond with valid TwiML immediately
  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');

  try {
    // Find or create contact — match ALL stored formats so an opt-out can't be
    // defeated by a duplicate row saved as e.g. 10-digit vs +1 (A2P/TCPA).
    const { phoneVariants } = require('../helpers/phone');
    const { e164: fromE164, variants: fromVariants } = phoneVariants(From);
    let { rows: [contact] } = await pool.query(
      'SELECT * FROM contacts WHERE phone_number = ANY($1::text[]) ORDER BY (phone_number = $2) DESC LIMIT 1',
      [fromVariants, fromE164]
    );
    if (!contact) {
      const result = await pool.query(
        'INSERT INTO contacts (phone_number) VALUES ($1) RETURNING *', [fromE164]
      );
      contact = result.rows[0];
      // Contact texted us first — record the implied opt-in for the audit trail
      recordConsent({ contactId: contact.id, phone: fromE164, action: 'opt_in', method: 'inbound_sms', detail: `Contact initiated conversation by texting ${To}`, messageSid: MessageSid });
    }

    // ── A2P opt-out / opt-in keyword handling ────────────────────────────
    // Twilio's Messaging Service auto-replies to STOP/HELP at the carrier
    // level; we mirror the state locally so the app blocks further sends.
    const keyword = (Body || '').trim().toLowerCase();
    if (OPT_OUT_WORDS.includes(keyword)) {
      await pool.query(
        'UPDATE contacts SET opted_out = true, opted_out_at = NOW() WHERE id = $1',
        [contact.id]
      );
      recordConsent({ contactId: contact.id, phone: From, action: 'opt_out', method: 'sms_keyword', detail: `Keyword: ${keyword}`, messageSid: MessageSid });
      console.log(`[webhook/sms] ${From} opted OUT (keyword: ${keyword})`);
    } else if (OPT_IN_WORDS.includes(keyword) && contact.opted_out) {
      await pool.query(
        'UPDATE contacts SET opted_out = false, opted_out_at = NULL WHERE id = $1',
        [contact.id]
      );
      recordConsent({ contactId: contact.id, phone: From, action: 'opt_in', method: 'sms_keyword', detail: `Keyword: ${keyword}`, messageSid: MessageSid });
      console.log(`[webhook/sms] ${From} opted back IN (keyword: ${keyword})`);
    }

    // Find open conversation for this contact, or create one
    let { rows: [conv] } = await pool.query(
      `SELECT * FROM conversations
       WHERE contact_id = $1 AND is_resolved = false
       ORDER BY created_at DESC LIMIT 1`,
      [contact.id]
    );
    if (!conv) {
      const result = await pool.query(
        'INSERT INTO conversations (contact_id) VALUES ($1) RETURNING *',
        [contact.id]
      );
      conv = result.rows[0];
    }

    // Save inbound message
    const { rows: [message] } = await pool.query(`
      INSERT INTO messages
        (conversation_id, direction, body, from_number, to_number, twilio_sid)
      VALUES ($1, 'inbound', $2, $3, $4, $5)
      RETURNING *
    `, [conv.id, Body || '', From, To, MessageSid]);

    // Capture MMS media (images etc.) — stored as Twilio URLs, proxied to the app
    const numMedia = parseInt(req.body.NumMedia || '0', 10);
    const media = [];
    for (let i = 0; i < numMedia; i++) {
      // Review §5 A6: only Twilio-hosted media on OUR account may be stored —
      // this URL is later fetched with our Twilio credentials attached.
      const url = twilioMediaUrl(req.body[`MediaUrl${i}`]);
      if (!url) {
        console.warn(`[sms] dropped MediaUrl${i} for ${MessageSid}: not a Twilio media URL on this account`);
        continue;
      }
      let ct = req.body[`MediaContentType${i}`] || 'application/octet-stream';
      // Security: only trust known image types; anything else (e.g. text/html)
      // is stored as a generic binary so it can never execute in the app.
      if (!/^image\/(png|jpe?g|gif|webp)$/i.test(ct)) ct = 'application/octet-stream';
      const { rows: [mm] } = await pool.query(
        'INSERT INTO message_media (message_id, content_type, twilio_url) VALUES ($1, $2, $3) RETURNING id, content_type',
        [message.id, ct, url]
      );
      media.push(mm);
    }

    // Update conversation timestamp
    await pool.query(
      'UPDATE conversations SET last_message_at = NOW() WHERE id = $1',
      [conv.id]
    );

    // Sync inbound SMS to Zoho CRM (fire-and-forget)
    syncSMSToZoho(message.id);

    // After-hours auto-reply (fire-and-forget — has its own error handling)
    maybeSendAfterHoursReply({ conv, contact, From, To, keyword });

    // Create notification for inbound message
    const contactLabel = contact.name || From;
    const notifBody = (Body && Body.trim()) ? Body : (media.length ? '📷 Image' : '');
    // notify_agent_ids decides who gets the desktop/push pop-up (owner of the
    // texted number → assigned agent → everyone); the bell stays for everyone.
    const notifyAgentIds = await notifyTargetsFor({ toNumber: To, conversationId: conv.id });
    createNotification({
      type:  'sms',
      title: `New message from ${contactLabel}`,
      body:  notifBody.length > 100 ? notifBody.slice(0, 100) + '…' : notifBody,
      meta:  { conversation_id: conv.id, from_number: From, to_number: To, notify_agent_ids: notifyAgentIds },
    });

    // Broadcast to all connected clients
    const io = getIO();
    if (io) {
      io.to(`conv_${conv.id}`).emit('new_message', {
        ...message,
        media,
        direction: 'inbound',
        agent_id: null,
        agent_name: null,
      });
      io.emit('conversation_updated', { conversation_id: conv.id });
    }
  } catch (e) {
    console.error('[webhook/sms]', e);
  }
});

module.exports = router;
