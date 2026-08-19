// server/routes/zohoWidget.js
// Endpoints backing the Zoho CRM "BTI Voice" SMS conversation widget
// (served from /zoho-widget/sms.html and embedded in the CRM Canvas tab).
//
// Auth: shared secret via ZOHO_WIDGET_KEY env var — sent as the x-widget-key
// header (the widget reads it from its own URL query string, which only exists
// in the Zoho widget registration, not in the public HTML). NOT agent JWT:
// widget users are Zoho CRM users, not logged-in BTI Voice agents.

const express = require('express');
const crypto  = require('crypto');
const { pool } = require('../db');
const { recordConsent } = require('../helpers/consent');
const { getIO } = require('../socket');
const { phoneVariants } = require('../helpers/phone');

const router = express.Router();

function keysMatch(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

router.use((req, res, next) => {
  const KEY = process.env.ZOHO_WIDGET_KEY;
  if (!KEY) return res.status(503).json({ error: 'Widget not configured — set ZOHO_WIDGET_KEY in Railway' });
  const supplied = req.get('x-widget-key') || req.query.key;
  if (!keysMatch(supplied, KEY)) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

// ── GET /api/zoho-widget/agents ───────────────────────────────────────────────
// Powers the "send as" dropdown. can_send = agent has a real Twilio number.
router.get('/agents', async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, color, initials, phone_number FROM agents WHERE is_active = TRUE ORDER BY name"
    );
    res.json({
      agents: rows.map(a => ({
        id:        a.id,
        name:      a.name,
        color:     a.color,
        initials:  a.initials,
        can_send:  !!(a.phone_number && a.phone_number.startsWith('+')),
      })),
    });
  } catch (e) {
    console.error('[zoho-widget/agents]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/zoho-widget/thread?phone=+1XXXXXXXXXX ────────────────────────────
// Full SMS thread for the number, newest last. Includes every agent's messages.
router.get('/thread', async (req, res) => {
  const phone = req.query.phone;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  try {
    const { e164, variants } = phoneVariants(phone);
    const { rows: [contact] } = await pool.query(
      'SELECT * FROM contacts WHERE phone_number = ANY($1::text[]) ORDER BY (phone_number = $2) DESC LIMIT 1',
      [variants, e164]
    );
    if (!contact) return res.json({ contact: null, opted_out: false, messages: [] });

    const { rows: [conv] } = await pool.query(
      'SELECT id FROM conversations WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 1',
      [contact.id]
    );
    let messages = [];
    if (conv) {
      const { rows } = await pool.query(
        'SELECT m.id, m.direction, m.body, m.status, m.sent_at, ' +
        '       a.name AS agent_name, a.color AS agent_color, a.initials AS agent_initials, ' +
        '       EXISTS (SELECT 1 FROM message_media mm WHERE mm.message_id = m.id) AS has_media ' +
        'FROM messages m LEFT JOIN agents a ON a.id = m.agent_id ' +
        'WHERE m.conversation_id = $1 ' +
        'ORDER BY m.sent_at ASC ' +
        'LIMIT 500',
        [conv.id]
      );
      messages = rows;
    }
    res.json({
      contact:   { id: contact.id, name: contact.name, phone_number: contact.phone_number },
      opted_out: !!contact.opted_out,
      messages:  messages,
    });
  } catch (e) {
    console.error('[zoho-widget/thread]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/zoho-widget/send { phone, body, agent_id } ──────────────────────
// Sends from the CHOSEN agent's own Twilio number via the normal path, so the
// message lands in the BTI Voice shared inbox + Zoho digest like any app send.
router.post('/send', async (req, res) => {
  const phone   = req.body.phone;
  const text    = (req.body.body || '').trim();
  const agentId = parseInt(req.body.agent_id, 10);
  if (!phone || !text) return res.status(400).json({ error: 'phone and body required' });
  if (!agentId)        return res.status(400).json({ error: 'agent_id required' });

  try {
    const { rows: [agent] } = await pool.query(
      'SELECT * FROM agents WHERE id = $1 AND is_active = TRUE', [agentId]
    );
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (!agent.phone_number || !agent.phone_number.startsWith('+')) {
      return res.status(400).json({ error: agent.name + ' has no Twilio number assigned yet' });
    }

    // Find or create contact + conversation (same logic as /conversations/ensure)
    const { e164, variants } = phoneVariants(phone);
    let { rows: [contact] } = await pool.query(
      'SELECT * FROM contacts WHERE phone_number = ANY($1::text[]) ORDER BY (phone_number = $2) DESC LIMIT 1',
      [variants, e164]
    );
    if (!contact) {
      const r = await pool.query('INSERT INTO contacts (phone_number) VALUES ($1) RETURNING *', [e164]);
      contact = r.rows[0];
    }
    // A2P compliance: never send to a contact who replied STOP
    if (contact.opted_out) {
      return res.status(403).json({ error: 'This contact has opted out of SMS (replied STOP). They must text START to resume messaging.' });
    }
    let { rows: [conv] } = await pool.query(
      'SELECT * FROM conversations WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 1',
      [contact.id]
    );
    if (!conv) {
      const r = await pool.query(
        'INSERT INTO conversations (contact_id, last_message_at) VALUES ($1, NOW()) RETURNING *', [contact.id]
      );
      conv = r.rows[0];
    }

    // Send via Twilio (Messaging Service routing, same as messages.js /send)
    let twilioSid = null;
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const params = { body: text, from: agent.phone_number, to: contact.phone_number };
      if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
        params.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
      }
      try {
        const msg = await twilio.messages.create(params);
        twilioSid = msg.sid;
      } catch (twErr) {
        if (twErr.code === 21610) {
          await pool.query(
            'UPDATE contacts SET opted_out = true, opted_out_at = NOW() WHERE id = $1', [contact.id]
          );
          recordConsent({ contactId: contact.id, phone: contact.phone_number, action: 'opt_out', method: 'carrier_block', detail: 'Twilio error 21610 on Zoho widget send' });
          return res.status(403).json({ error: 'This contact has opted out of SMS (replied STOP). They must text START to resume messaging.' });
        }
        throw twErr;
      }
    }

    const { rows: [message] } = await pool.query(
      "INSERT INTO messages (conversation_id, agent_id, direction, body, from_number, to_number, twilio_sid) " +
      "VALUES ($1, $2, 'outbound', $3, $4, $5, $6) RETURNING *",
      [conv.id, agent.id, text, agent.phone_number, contact.phone_number, twilioSid]
    );
    await pool.query(
      'UPDATE conversations SET last_message_at = NOW(), last_agent_id = $1 WHERE id = $2',
      [agent.id, conv.id]
    );
    await pool.query(
      'INSERT INTO conversation_agents (conversation_id, agent_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [conv.id, agent.id]
    );

    const enriched = {
      ...message,
      media: [],
      agent_id:       agent.id,
      agent_name:     agent.name,
      agent_color:    agent.color,
      agent_initials: agent.initials,
      agent_number:   agent.phone_number,
    };

    // Zoho digest sync (fire-and-forget, same internal path as app sends)
    if (process.env.ZOHO_REFRESH_TOKEN) {
      setImmediate(async () => {
        try {
          await fetch('http://localhost:' + (process.env.PORT || 3000) + '/api/zoho/log-sms', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-token': require('../secret').INTERNAL_TOKEN },
            body:    JSON.stringify({ message_id: message.id }),
          });
        } catch (e) {
          console.error('[zoho-widget] log-sms failed:', e.message);
        }
      });
    }

    // Broadcast so the desktop app updates live
    const io = getIO();
    if (io) {
      io.to('conv_' + conv.id).emit('new_message', enriched);
      io.emit('conversation_updated', { conversation_id: conv.id });
    }

    res.json(enriched);
  } catch (e) {
    console.error('[zoho-widget/send]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
