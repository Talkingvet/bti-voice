const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { generateToken, requireAuth } = require('../auth');
const { logActivity } = require('../helpers/logActivity');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM agents WHERE username = $1 AND is_active = true',
      [username.toLowerCase().trim()]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid username or password' });

    const agent = rows[0];
    const valid = await bcrypt.compare(password, agent.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid username or password' });

    // Nag-banner support: flag logins that still use the seeded default password.
    const default_password = password === agent.username + '123';

    delete agent.password_hash;
    logActivity(req, agent, 'login');
    res.json({ agent, token: generateToken(agent), default_password });
  } catch (e) {
    console.error('[auth/login]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, username, phone_number, color, initials, status FROM agents WHERE id = $1',
    [req.agent.id]
  );
  res.json(rows[0] || null);
});

module.exports = router;
