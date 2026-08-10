const express = require('express');
const { pool } = require('../db');
const { getIO } = require('../socket');
const { createNotification } = require('../notifications');

// Fire-and-forget Zoho sync — never blocks the Twilio webhook response
function syncSMSToZoho(messageId) {
  if (!process.env.ZOHO_REFRESH_TOKEN) return; // Zoho not configured, skip silently
  setImmediate(async () => {
    try {
      await fetch(`http://localhost:${process.env.PORT || 3000}/api/zoho/log-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

    // Throttle: max one auto-reply per conversation per 4 hours
    const { rows: [c] } = await pool.query(
      'SELECT last_auto_reply_at FROM conversations WHERE id = $1', [conv.id]
    );
    if (c?.last_auto_reply_at && Date.now() - new Date(c.last_auto_reply_at).getTime() < 4 * 60 * 60 * 1000) return;

    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return;
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const params = {
      body: s.after_hours_sms_message || "Talkingvet: Thanks for your message! Our team is away right now, but we'll reply as soon as we're back during business hours.",
      from: To, // reply from whichever number they texted
      to:   From,
    };
    if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
      params.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    }

    let sent;
    try {
      sent = await twilio.messages.create(params);
    } catch (twErr) {
      if (twErr.code === 21610) {
        await pool.query(
          'UPDATE contacts SET opted_out = true, opted_out_at = NOW() WHERE id = $1', [contact.id]
        );
        return;
      }
      throw twErr;
    }

    // Record as an outbound message (agent_id null = system/auto)
    const { rows: [m] } = await pool.query(`
      INSERT INTO messages (conversation_id, direction, body, from_number, to_number, twilio_sid)
      VALUES ($1, 'outbound', $2, $3, $4, $5)
      RETURNING *
    `, [conv.id, params.body, To, From, sent.sid]);
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

router.post('/', async (req, res) => {
  const { From, To, Body, MessageSid } = req.body;

  // Always respond with valid TwiML immediately
  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');

  try {
    // Find or create contact
    let { rows: [contact] } = await pool.query(
      'SELECT * FROM contacts WHERE phone_number = $1', [From]
    );
    if (!contact) {
      const result = await pool.query(
        'INSERT INTO contacts (phone_number) VALUES ($1) RETURNING *', [From]
      );
      contact = result.rows[0];
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
      console.log(`[webhook/sms] ${From} opted OUT (keyword: ${keyword})`);
    } else if (OPT_IN_WORDS.includes(keyword) && contact.opted_out) {
      await pool.query(
        'UPDATE contacts SET opted_out = false, opted_out_at = NULL WHERE id = $1',
        [contact.id]
      );
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
    `, [conv.id, Body, From, To, MessageSid]);

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
    createNotification({
      type:  'sms',
      title: `New message from ${contactLabel}`,
      body:  Body.length > 100 ? Body.slice(0, 100) + '…' : Body,
      meta:  { conversation_id: conv.id, from_number: From },
    });

    // Broadcast to all connected clients
    const io = getIO();
    if (io) {
      io.to(`conv_${conv.id}`).emit('new_message', {
        ...message,
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
