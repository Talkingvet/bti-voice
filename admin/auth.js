const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('./db');
const { PORTAL_SECRET } = require('./secret');

const SESSION_TTL = '12h';
const USERNAME_RE = /^[a-z0-9._-]{2,50}$/;
const USER_COLS = 'id, name, username, is_active, must_change_password, last_login_at, created_at';

function generateToken(user) {
  return jwt.sign({ id: user.id, username: user.username, name: user.name }, PORTAL_SECRET, { expiresIn: SESSION_TTL });
}

// Bearer JWT → req.user (fresh from DB so deactivation / password changes bite immediately).
async function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  let payload;
  try { payload = jwt.verify(auth.slice(7), PORTAL_SECRET); }
  catch { return res.status(401).json({ error: 'Invalid or expired session' }); }
  try {
    const { rows: [user] } = await pool.query(`SELECT ${USER_COLS} FROM portal_users WHERE id = $1`, [payload.id]);
    if (!user || !user.is_active) return res.status(401).json({ error: 'This portal login has been deactivated' });
    req.user = user;
    // A user who must change their password can only hit the change-password route.
    if (user.must_change_password && !req.path.endsWith('/auth/change-password') && !req.path.endsWith('/auth/me')) {
      return res.status(403).json({ error: 'You must change your password before continuing', code: 'must_change_password' });
    }
    next();
  } catch (e) {
    console.error('[auth]', e);
    res.status(500).json({ error: 'Server error' });
  }
}

function tempPassword() {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const pick = (n) => Array.from(crypto.randomBytes(n), b => alpha[b % alpha.length]).join('');
  return `${pick(4)}-${pick(4)}-${pick(4)}`;
}

// First boot: if there are no portal users, create one from env. Same pattern
// as the customer app's ADMIN_USERNAME/ADMIN_PASSWORD bootstrap.
async function bootstrap() {
  const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int AS n FROM portal_users');
  if (n > 0) return;
  const username = (process.env.PORTAL_ADMIN_USERNAME || '').trim().toLowerCase();
  const password = process.env.PORTAL_ADMIN_PASSWORD || '';
  if (!USERNAME_RE.test(username) || password.length < 8) {
    console.error('[bootstrap] No portal users exist and PORTAL_ADMIN_USERNAME / PORTAL_ADMIN_PASSWORD (≥ 8 chars) ' +
                  'are not set. Nobody can log in until you set them and redeploy.');
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    'INSERT INTO portal_users (name, username, password_hash, must_change_password) VALUES ($1,$2,$3,true)',
    [process.env.PORTAL_ADMIN_NAME || username, username, hash]
  );
  console.log(`[bootstrap] First portal user created: ${username}. Log in, change the password, then delete PORTAL_ADMIN_PASSWORD from Railway.`);
}

// Simple in-memory login throttle: 10 failures per username per 15 minutes.
const failures = new Map();
function throttled(username) {
  const f = failures.get(username);
  return f && f.count >= 10 && Date.now() - f.first < 15 * 60 * 1000;
}
function recordFailure(username) {
  const f = failures.get(username);
  if (!f || Date.now() - f.first > 15 * 60 * 1000) failures.set(username, { count: 1, first: Date.now() });
  else f.count++;
}

module.exports = { generateToken, requireAuth, bootstrap, tempPassword, throttled, recordFailure, USERNAME_RE, USER_COLS };
