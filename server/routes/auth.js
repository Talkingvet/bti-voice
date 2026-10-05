const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { generateToken, requireAuth, generateMediaToken, MEDIA_TOKEN_TTL_SEC } = require('../auth');
const { logActivity } = require('../helpers/logActivity');
const { loginAllowed, accountStatus, featureOn } = require('../helpers/deploySettings');
const sessions = require('../helpers/sessions');
const { throttled, recordFailure, clearFailures } = require('../helpers/loginThrottle');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { remember, platform } = req.body || {};
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
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
  // Brute-force throttle (review §5 A4): 10 failed attempts per username per
  // 15 minutes, same as the admin portal. Checked before the password so a
  // throttled account never leaks whether the guess was right.
  if (throttled(username)) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT * FROM agents WHERE username = $1 AND is_active = true',
      [username]
    );
    const agent = rows[0];
    const valid = agent && await bcrypt.compare(password, agent.password_hash);
    if (!valid) {
      recordFailure(username);
      console.warn(`[auth] failed login for "${username}" from ${req.ip}`);
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    clearFailures(username);

    // Nag-banner support: flag logins that still use the seeded default password,
    // OR a one-time temporary password handed out by BTI from the portal
    // (agents.must_change_password) — same banner, same "change it now" nudge.
    const default_password = password === agent.username + '123' || !!agent.must_change_password;

    pool.query('UPDATE agents SET last_login_at = NOW() WHERE id = $1', [agent.id]).catch(() => {});
    // One session row per device (per-device sign-out — helpers/sessions.js).
    const sid = await sessions.createSession(agent.id, {
      remember: remember !== false, platform: platform || null, userAgent: req.headers['user-agent'],
    });
    const token = generateToken(agent, { remember: remember !== false, sid });
    delete agent.password_hash;
    delete agent.must_change_password;
    delete agent.token_version;
    logActivity(req, agent, 'login');
    res.json({ agent, token, default_password });
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
router.post('/refresh', requireAuth, async (req, res) => {
  if (!req.agent.remember) return res.json({ token: null });
  try {
    // Re-read the agent (not the old payload) so a portal rename and the
    // current token_version land in the new token. Legacy tokens (minted
    // before per-device sessions existed) get a session row here.
    const { rows: [agent] } = await pool.query(
      'SELECT id, username, name, token_version FROM agents WHERE id = $1 AND is_active = true', [req.agent.id]
    );
    if (!agent) return res.status(401).json({ error: 'This account has been deactivated.', code: 'session_revoked' });
    let sid = req.agent.sid || null;
    if (sid) await sessions.touchSession(sid);
    else sid = await sessions.createSession(agent.id, { remember: true, userAgent: req.headers['user-agent'] });
    res.json({ token: generateToken(agent, { remember: true, sid }) });
  } catch (e) {
    console.error('[auth/refresh]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /logout — signs out THIS device only (revokes its session row and
// drops its socket). Other devices stay signed in. Legacy tokens without a
// session id have nothing to revoke server-side; the client discards them.
router.post('/logout', requireAuth, async (req, res) => {
  try {
    await sessions.revokeSession(req.agent.sid || null, req.agent.id);
    logActivity(req, req.agent, 'logout');
    res.json({ ok: true });
  } catch (e) {
    console.error('[auth/logout]', e);
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
