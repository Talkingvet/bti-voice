const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

// Get all active agents
router.get('/', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, username, phone_number, color, initials, status FROM agents WHERE is_active = true ORDER BY id'
  );
  res.json(rows);
});

// Update own phone number (when Twilio numbers are ready)
router.patch('/me/number', requireAuth, async (req, res) => {
  const { phone_number } = req.body;
  const { rows } = await pool.query(
    'UPDATE agents SET phone_number = $1 WHERE id = $2 RETURNING id, name, phone_number',
    [phone_number, req.agent.id]
  );
  res.json(rows[0]);
});

// Update own status
router.patch('/me/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  const allowed = ['available', 'busy', 'dnd', 'be_right_back', 'offline', 'online', 'away'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const { rows } = await pool.query(
      'UPDATE agents SET status = $1 WHERE id = $2 RETURNING id, name, color, status',
      [status, req.agent.id]
    );
    const { getIO } = require('../socket');
    const io = getIO();
    if (io) io.emit('agent_status_changed', { agent_id: req.agent.id, status });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Change own password
router.patch('/me/password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body;
  const { rows } = await pool.query('SELECT * FROM agents WHERE id = $1', [req.agent.id]);
  const valid = await bcrypt.compare(current_password, rows[0].password_hash);
  if (!valid) return res.status(400).json({ error: 'Current password incorrect' });
  const hash = await bcrypt.hash(new_password, 10);
  await pool.query('UPDATE agents SET password_hash = $1 WHERE id = $2', [hash, req.agent.id]);
  res.json({ success: true });
});

module.exports = router;
