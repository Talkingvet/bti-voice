const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { generateToken, requireAuth, generateMediaToken, MEDIA_TOKEN_TTL_SEC } = require('../auth');
const { logActivity } = require('../helpers/logActivity');
const { loginAllowed, accountStatus, featureOn } = require('../helpers/deploySettings');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password, remember, platform } = req.body;
  // Subscription lifecycle: blocked deploys refuse every login with the
  // "contact BTI" message (plan §4a #3). Checked BEFORE the password so we
  // never confirm/deny credentials on a blocked account.
  if (!loginAllowed()) {
    return res.status(403).json({ error: accountStatus().message, code: 'account_blocked' });
  }
  // mobile_apps toggle: the iOS/Android apps send platform:'ios'|'android'.
  // Browser + desktop send nothing. Enforced at login so a customer who hasn't
  // bought the mobile add-on gets a clear message instead of a half-working app.
  if ((platform === 'ios' || platform === 'android') && !featureOn('mobile_apps')) {
    return res.status(403).json({ error: 'The mobile apps are not enabled on this account. Please sign in from the desktop app or a browser, or contact BTI.', code: 'mobile_disabled' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT * FROM agents WHERE username = $1 AND is_active = true',
      [username.toLowerCase().trim()]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid username or password' });

    const agent = rows[0];
    const valid = await bcrypt.compare(password, agent.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid username or password' });

    // Nag-banner support: flag logins that still use the seeded default password,
    // OR a one-time temporary password handed out by BTI from the portal
    // (agents.must_change_password) — same banner, same "change it now" nudge.
    const default_password = password === agent.username + '123' || !!agent.must_change_password;

    pool.query('UPDATE agents SET last_login_at = NOW() WHERE id = $1', [agent.id]).catch(() => {});
    delete agent.password_hash;
    delete agent.must_change_password;
    logActivity(req, agent, 'login');
    res.json({ agent, token: generateToken(agent, { remember: remember !== false }), default_password });
  } catch (e) {
    console.error('[auth/login]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /media-token — mint a short-lived, media-only token for <img>/<audio>
// URLs. See requireMediaAuth in ../auth.js.
router.post('/media-token', requireAuth, (req, res) => {
  res.json({ token: generateMediaToken(req.agent.id), expires_in: MEDIA_TOKEN_TTL_SEC });
});

// POST /refresh — sliding session. Called by the client on every successful
// app start. Only "keep me signed in" tokens are renewed; short sessions get
// { token: null } and simply expire on schedule.
router.post('/refresh', requireAuth, (req, res) => {
  if (!req.agent.remember) return res.json({ token: null });
  const { id, username, name } = req.agent;
  res.json({ token: generateToken({ id, username, name }, { remember: true }) });
});

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, username, phone_number, color, initials, status FROM agents WHERE id = $1',
    [req.agent.id]
  );
  res.json(rows[0] || null);
});

module.exports = router;
