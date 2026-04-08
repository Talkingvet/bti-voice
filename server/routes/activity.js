/* Activity feed — combined inbound messages + calls, newest-first */
const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        'message'       AS type,
        m.id::text      AS id,
        m.body          AS preview,
        m.sent_at       AS occurred_at,
        co.name         AS contact_name,
        co.phone_number AS contact_number,
        a.name          AS agent_name,
        a.color         AS agent_color,
        c.id            AS conversation_id,
        NULL            AS call_status,
        NULL            AS call_direction,
        NULL::integer   AS duration
      FROM messages m
      JOIN conversations c  ON c.id = m.conversation_id
      JOIN contacts co      ON co.id = c.contact_id
      LEFT JOIN agents a    ON a.id = m.agent_id
      WHERE m.direction = 'inbound'

      UNION ALL

      SELECT
        CASE WHEN ca.status = 'missed' THEN 'missed_call' ELSE 'call' END AS type,
        ca.id::text     AS id,
        NULL            AS preview,
        ca.started_at   AS occurred_at,
        co.name         AS contact_name,
        co.phone_number AS contact_number,
        a.name          AS agent_name,
        a.color         AS agent_color,
        ca.conversation_id,
        ca.status       AS call_status,
        ca.direction    AS call_direction,
        ca.duration
      FROM calls ca
      LEFT JOIN conversations c ON c.id = ca.conversation_id
      LEFT JOIN contacts co     ON co.id = c.contact_id
      LEFT JOIN agents a        ON a.id = ca.agent_id

      ORDER BY occurred_at DESC
      LIMIT 80
    `);

    res.json(rows);
  } catch (e) {
    console.error('[activity]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
