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

const router = express.Router();

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
