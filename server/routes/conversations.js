const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

// Get all open conversations with latest message + agents involved
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.id,
        c.last_message_at,
        c.is_resolved,
        co.id   AS contact_id,
        co.name AS contact_name,
        co.phone_number AS contact_number,
        a.id    AS last_agent_id,
        a.name  AS last_agent_name,
        a.color AS last_agent_color,
        a.initials AS last_agent_initials,
        (
          SELECT body FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.sent_at DESC LIMIT 1
        ) AS last_message,
        (
          SELECT json_agg(json_build_object(
            'id', ag.id, 'name', ag.name,
            'color', ag.color, 'initials', ag.initials
          ))
          FROM conversation_agents ca
          JOIN agents ag ON ag.id = ca.agent_id
          WHERE ca.conversation_id = c.id
        ) AS agents_involved,
        (
          SELECT COUNT(*) FROM messages m2
          WHERE m2.conversation_id = c.id
            AND m2.direction = 'outbound'
            AND m2.sent_at > NOW() - INTERVAL '2 hours'
        ) AS recent_outbound_count
      FROM conversations c
      JOIN contacts co ON co.id = c.contact_id
      LEFT JOIN agents a ON a.id = c.last_agent_id
      ORDER BY c.last_message_at DESC
    `);
    res.json(rows);
  } catch (e) {
    console.error('[conversations/]', e);
    res.status(500).json({ error: e.message });
  }
});

// Get messages for a specific conversation
router.get('/:id/messages', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        m.id, m.direction, m.body, m.sent_at, m.status,
        m.from_number, m.to_number,
        a.id       AS agent_id,
        a.name     AS agent_name,
        a.color    AS agent_color,
        a.initials AS agent_initials,
        a.phone_number AS agent_number
      FROM messages m
      LEFT JOIN agents a ON a.id = m.agent_id
      WHERE m.conversation_id = $1
      ORDER BY m.sent_at ASC
    `, [req.params.id]);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Start a new conversation (or reuse open one) and send the first message
router.post('/new-message', requireAuth, async (req, res) => {
  const { to_number, from_agent_id, body } = req.body
  if (!to_number || !body) return res.status(400).json({ error: 'to_number and body are required' })
  const { getIO } = require('../socket')
  try {
    let { rows: [contact] } = await pool.query('SELECT * FROM contacts WHERE phone_number = $1', [to_number])
    if (!contact) {
      const r = await pool.query('INSERT INTO contacts (phone_number) VALUES ($1) RETURNING *', [to_number])
      contact = r.rows[0]
    }
    let { rows: [conv] } = await pool.query(
      'SELECT * FROM conversations WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 1',
      [contact.id]
    )
    if (!conv) {
      const r = await pool.query(
        'INSERT INTO conversations (contact_id, last_message_at) VALUES ($1, NOW()) RETURNING *', [contact.id]
      )
      conv = r.rows[0]
    }
    const agentId = from_agent_id || req.agent.id
    const { rows: [agent] } = await pool.query('SELECT * FROM agents WHERE id = $1', [agentId])
    if (!agent) return res.status(404).json({ error: 'Agent not found' })
    let twilioSid = null
    const hasTwilio = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && agent.phone_number !== 'TBD'
    if (hasTwilio) {
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
      const msg = await twilio.messages.create({ body, from: agent.phone_number, to: to_number })
      twilioSid = msg.sid
    }
    await pool.query(
      'INSERT INTO messages (conversation_id, agent_id, direction, body, from_number, to_number, twilio_sid) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [conv.id, agent.id, 'outbound', body, agent.phone_number, to_number, twilioSid]
    )
    await pool.query('UPDATE conversations SET last_message_at = NOW(), last_agent_id = $1 WHERE id = $2', [agent.id, conv.id])
    await pool.query('INSERT INTO conversation_agents (conversation_id, agent_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [conv.id, agent.id])
    const io = getIO()
    if (io) io.emit('conversation_updated', { conversation_id: conv.id })
    res.json({ conversation_id: conv.id })
  } catch (e) {
    console.error('[conversations/new-message]', e)
    res.status(500).json({ error: e.message })
  }
})

// Mark conversation as resolved
router.patch('/:id/resolve', requireAuth, async (req, res) => {
  await pool.query(
    'UPDATE conversations SET is_resolved = true WHERE id = $1',
    [req.params.id]
  );
  res.json({ success: true });
});

module.exports = router;
