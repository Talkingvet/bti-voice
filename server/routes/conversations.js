const express = require('express');
const { pool } = require('../db')
const { recordConsent } = require('../helpers/consent');
const { requireAuth } = require('../auth');
const { createNotification } = require('../notifications');

const router = express.Router();

// Get all open conversations with latest message + agents involved + unread status
router.get('/', requireAuth, async (req, res) => {
  try {
    const agentId = req.agent.id;
    const { rows } = await pool.query(`
      SELECT
        c.id,
        c.last_message_at,
        c.is_resolved,
        co.id   AS contact_id,
        co.name AS contact_name,
        co.phone_number AS contact_number,
        co.opted_out,
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
        ) AS recent_outbound_count,
        c.assigned_agent_id,
        assign_a.name  AS assigned_agent_name,
        assign_a.color AS assigned_agent_color,
        -- Unread: last inbound message is newer than agent's last read timestamp
        CASE WHEN EXISTS (
          SELECT 1 FROM messages mi
          WHERE mi.conversation_id = c.id
            AND mi.direction = 'inbound'
            AND mi.sent_at > COALESCE(
              (SELECT cr.read_at FROM conversation_reads cr
               WHERE cr.conversation_id = c.id AND cr.agent_id = $1),
              '1970-01-01'::timestamptz
            )
        ) THEN true ELSE false END AS unread
      FROM conversations c
      JOIN contacts co ON co.id = c.contact_id
      LEFT JOIN agents a ON a.id = c.last_agent_id
      LEFT JOIN agents assign_a ON assign_a.id = c.assigned_agent_id
      WHERE EXISTS (
        SELECT 1 FROM messages m WHERE m.conversation_id = c.id
      )
      ORDER BY c.last_message_at DESC
    `, [agentId]);
    res.json(rows);
  } catch (e) {
    console.error('[conversations/]', e);
    res.status(500).json({ error: e.message });
  }
});

// Unread conversation count for the current agent (lightweight — just a number for BottomNav badge)
router.get('/unread-count', requireAuth, async (req, res) => {
  try {
    const agentId = req.agent.id;
    const { rows } = await pool.query(`
      SELECT COUNT(*) AS count
      FROM conversations c
      JOIN contacts co ON co.id = c.contact_id
      WHERE EXISTS (
        SELECT 1 FROM messages m WHERE m.conversation_id = c.id
      )
      AND EXISTS (
        SELECT 1 FROM messages mi
        WHERE mi.conversation_id = c.id
          AND mi.direction = 'inbound'
          AND mi.sent_at > COALESCE(
            (SELECT cr.read_at FROM conversation_reads cr
             WHERE cr.conversation_id = c.id AND cr.agent_id = $1),
            '1970-01-01'::timestamptz
          )
      )
    `, [agentId]);
    res.json({ count: parseInt(rows[0].count, 10) });
  } catch (e) {
    console.error('[conversations/unread-count]', e);
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
        (
          SELECT json_agg(json_build_object('id', mm.id, 'content_type', mm.content_type))
          FROM message_media mm WHERE mm.message_id = m.id
        ) AS media,
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
  const { phoneVariants } = require('../helpers/phone')
  const { e164, variants } = phoneVariants(to_number)
  try {
    let { rows: [contact] } = await pool.query(
      'SELECT * FROM contacts WHERE phone_number = ANY($1::text[]) ORDER BY (phone_number = $2) DESC LIMIT 1',
      [variants, e164]
    )
    if (!contact) {
      const r = await pool.query('INSERT INTO contacts (phone_number) VALUES ($1) RETURNING *', [e164])
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
    // A2P compliance: never send to a contact who replied STOP
    if (contact.opted_out) {
      return res.status(403).json({ error: 'This contact has opted out of SMS (replied STOP). They must text START to resume messaging.' })
    }
    const agentId = from_agent_id || req.agent.id
    const { rows: [agent] } = await pool.query('SELECT * FROM agents WHERE id = $1', [agentId])
    if (!agent) return res.status(404).json({ error: 'Agent not found' })
    let twilioSid = null
    const hasTwilio = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && agent.phone_number !== 'TBD'
    if (hasTwilio) {
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
      const params = { body, from: agent.phone_number, to: contact.phone_number }
      // Route through the A2P-registered Messaging Service when configured
      if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
        params.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID
      }
      try {
        const msg = await twilio.messages.create(params)
        twilioSid = msg.sid
      } catch (twErr) {
        if (twErr.code === 21610) {
          await pool.query('UPDATE contacts SET opted_out = true, opted_out_at = NOW() WHERE id = $1', [contact.id])
          recordConsent({ contactId: contact.id, phone: contact.phone_number, action: 'opt_out', method: 'carrier_block', detail: 'Twilio error 21610 on new-message send' })
          return res.status(403).json({ error: 'This contact has opted out of SMS (replied STOP). They must text START to resume messaging.' })
        }
        throw twErr
      }
    }
    await pool.query(
      'INSERT INTO messages (conversation_id, agent_id, direction, body, from_number, to_number, twilio_sid) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [conv.id, agent.id, 'outbound', body, agent.phone_number, contact.phone_number, twilioSid]
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

// Find-or-create a conversation for a number WITHOUT sending anything.
// Used by the New Message modal so scheduled sends and MMS can reuse the
// standard /messages/schedule and /messages/send endpoints.
router.post('/ensure', requireAuth, async (req, res) => {
  const { to_number } = req.body
  if (!to_number) return res.status(400).json({ error: 'to_number is required' })
  const { phoneVariants } = require('../helpers/phone')
  const { e164, variants } = phoneVariants(to_number)
  try {
    let { rows: [contact] } = await pool.query(
      'SELECT * FROM contacts WHERE phone_number = ANY($1::text[]) ORDER BY (phone_number = $2) DESC LIMIT 1',
      [variants, e164]
    )
    if (!contact) {
      const r = await pool.query('INSERT INTO contacts (phone_number) VALUES ($1) RETURNING *', [e164])
      contact = r.rows[0]
    }
    // A2P compliance: surface opt-out before the caller schedules anything
    if (contact.opted_out) {
      return res.status(403).json({ error: 'This contact has opted out of SMS (replied STOP). They must text START to resume messaging.' })
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
    res.json({ conversation_id: conv.id })
  } catch (e) {
    console.error('[conversations/ensure]', e)
    res.status(500).json({ error: e.message })
  }
})

// Mark conversation as read by the current agent
router.post('/:id/read', requireAuth, async (req, res) => {
  try {
    await pool.query(`
      INSERT INTO conversation_reads (conversation_id, agent_id, read_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (conversation_id, agent_id)
      DO UPDATE SET read_at = NOW()
    `, [req.params.id, req.agent.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('[conversations/:id/read]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Assign conversation to an agent (null to unassign)
router.patch('/:id/assign', requireAuth, async (req, res) => {
  const { agent_id } = req.body; // null = unassign
  const { getIO } = require('../socket');
  try {
    const { rows } = await pool.query(
      'UPDATE conversations SET assigned_agent_id = $1 WHERE id = $2 RETURNING *',
      [agent_id || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const io = getIO();
    if (io) io.emit('conversation_updated', { conversation_id: rows[0].id });
    res.json(rows[0]);
  } catch (e) {
    console.error('[conversations/:id/assign]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Mark conversation as resolved
router.patch('/:id/resolve', requireAuth, async (req, res) => {
  const convId = req.params.id;
  await pool.query('UPDATE conversations SET is_resolved = true WHERE id = $1', [convId]);

  // Look up contact name for the notification
  const { rows: [conv] } = await pool.query(
    `SELECT c.name, c.phone_number
     FROM conversations v JOIN contacts c ON c.id = v.contact_id
     WHERE v.id = $1`, [convId]
  );
  const label = conv?.name || conv?.phone_number || 'a contact';
  createNotification({
    type:  'resolved',
    title: 'Conversation resolved',
    body:  `${req.agent.name} resolved the thread with ${label}.`,
    meta:  { conversation_id: parseInt(convId) },
  });

  res.json({ success: true });
});

module.exports = router;
