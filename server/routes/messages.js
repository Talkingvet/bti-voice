const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');
const { getIO } = require('../socket');

// Fire-and-forget Zoho sync for outbound SMS
function syncSMSToZoho(messageId) {
  if (!process.env.ZOHO_REFRESH_TOKEN) return;
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

router.post('/send', requireAuth, async (req, res) => {
  const { conversation_id, body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'Message body required' });

  try {
    // Get conversation contact number
    const { rows: [conv] } = await pool.query(`
      SELECT c.id, co.id AS contact_id, co.phone_number AS to_number, co.opted_out
      FROM conversations c
      JOIN contacts co ON co.id = c.contact_id
      WHERE c.id = $1
    `, [conversation_id]);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    // A2P compliance: never send to a contact who replied STOP
    if (conv.opted_out) {
      return res.status(403).json({ error: 'This contact has opted out of SMS (replied STOP). They must text START to resume messaging.' });
    }

    // Get sending agent's details
    const { rows: [agent] } = await pool.query(
      'SELECT * FROM agents WHERE id = $1', [req.agent.id]
    );

    let twilioSid = null;

    // Send via Twilio if credentials and a real number are configured
    const hasTwilio = process.env.TWILIO_ACCOUNT_SID &&
                      process.env.TWILIO_AUTH_TOKEN &&
                      agent.phone_number !== 'TBD';
    if (hasTwilio) {
      const twilio = require('twilio')(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );
      const params = {
        body: body.trim(),
        from: agent.phone_number,
        to: conv.to_number,
      };
      // Route through the A2P-registered Messaging Service when configured.
      // `from` is kept so the message still sends from the agent's own number.
      if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
        params.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
      }
      try {
        const msg = await twilio.messages.create(params);
        twilioSid = msg.sid;
      } catch (twErr) {
        if (twErr.code === 21610) {
          // Recipient opted out at the Twilio/carrier level — mirror it locally
          await pool.query(
            'UPDATE contacts SET opted_out = true, opted_out_at = NOW() WHERE id = $1',
            [conv.contact_id]
          );
          return res.status(403).json({ error: 'This contact has opted out of SMS (replied STOP). They must text START to resume messaging.' });
        }
        throw twErr;
      }
    }

    // Save to database
    const { rows: [message] } = await pool.query(`
      INSERT INTO messages
        (conversation_id, agent_id, direction, body, from_number, to_number, twilio_sid)
      VALUES ($1, $2, 'outbound', $3, $4, $5, $6)
      RETURNING *
    `, [conversation_id, agent.id, body.trim(), agent.phone_number, conv.to_number, twilioSid]);

    // Update conversation's last activity
    await pool.query(
      'UPDATE conversations SET last_message_at = NOW(), last_agent_id = $1 WHERE id = $2',
      [agent.id, conversation_id]
    );

    // Track this agent as involved in the conversation
    await pool.query(
      'INSERT INTO conversation_agents (conversation_id, agent_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [conversation_id, agent.id]
    );

    // Build the enriched message object for broadcast
    const enriched = {
      ...message,
      agent_id: agent.id,
      agent_name: agent.name,
      agent_color: agent.color,
      agent_initials: agent.initials,
      agent_number: agent.phone_number,
    };

    // Sync outbound SMS to Zoho CRM (fire-and-forget)
    syncSMSToZoho(message.id);

    // Broadcast to all clients watching this conversation
    const io = getIO();
    if (io) {
      io.to(`conv_${conversation_id}`).emit('new_message', enriched);
      io.emit('conversation_updated', { conversation_id: parseInt(conversation_id) });
    }

    res.json(enriched);
  } catch (e) {
    console.error('[messages/send]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
