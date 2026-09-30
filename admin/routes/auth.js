// Portal login + portal user management (Danny, Paul, Rick, Shawn — plan §4a #5).
//
//   POST  /api/auth/login              { username, password } → { token, user }
//   GET   /api/auth/me
//   POST  /api/auth/change-password    { current_password, new_password }
//   GET   /api/users                   all portal users
//   POST  /api/users                   { name, username } → { user, temporary_password }
//   PATCH /api/users/:id               { name?, username?, is_active?, reset_password?: true }
//
// Every portal user is a full admin (there are four of them and they're all BTI).
// The only guard is that you can't deactivate yourself or the last active user.
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, audit } = require('../db');
const { generateToken, requireAuth, tempPassword, throttled, recordFailure, USERNAME_RE, USER_COLS } = require('../auth');

const router = express.Router();

router.post('/auth/login', async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  if (throttled(username)) return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  try {
    const { rows: [user] } = await pool.query(
      `SELECT ${USER_COLS}, password_hash FROM portal_users WHERE username = $1`, [username]
    );
    const ok = user && user.is_active && await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      recordFailure(username);
      console.warn(`[auth] failed login for "${username}" from ${req.ip}`);
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    await pool.query('UPDATE portal_users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    delete user.password_hash;
    req.user = user;
    await audit(req, 'login');
    res.json({ token: generateToken(user), user });
  } catch (e) {
    console.error('[auth/login]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

router.post('/auth/change-password', requireAuth, async (req, res) => {
  const cur = String(req.body?.current_password || '');
  const next = String(req.body?.new_password || '');
  if (next.length < 10) return res.status(400).json({ error: 'New password must be at least 10 characters' });
  if (next === cur) return res.status(400).json({ error: 'New password must be different from the current one' });
  try {
    const { rows: [row] } = await pool.query('SELECT password_hash FROM portal_users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(cur, row.password_hash))) return res.status(401).json({ error: 'Current password is incorrect' });
    await pool.query('UPDATE portal_users SET password_hash = $1, must_change_password = false WHERE id = $2',
                     [await bcrypt.hash(next, 10), req.user.id]);
    await audit(req, 'change_password');
    res.json({ ok: true });
  } catch (e) {
    console.error('[auth/change-password]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Portal users ─────────────────────────────────────────────────────────────
router.get('/users', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`SELECT ${USER_COLS} FROM portal_users ORDER BY is_active DESC, id`);
  res.json({ users: rows });
});

router.post('/users', requireAuth, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const username = String(req.body?.username || '').trim().toLowerCase();
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'username must be 2–50 chars: letters, numbers, . _ -' });
  try {
    const { rows: dup } = await pool.query('SELECT id FROM portal_users WHERE username = $1', [username]);
    if (dup.length) return res.status(409).json({ error: `Username "${username}" is already taken` });
    const password = tempPassword();
    const { rows: [user] } = await pool.query(
      `INSERT INTO portal_users (name, username, password_hash, must_change_password)
       VALUES ($1,$2,$3,true) RETURNING ${USER_COLS}`,
      [name, username, await bcrypt.hash(password, 10)]
    );
    await audit(req, 'user_create', { detail: { username } });
    res.status(201).json({ user, temporary_password: password });
  } catch (e) {
    console.error('[users POST]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/users/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad user id' });
  const b = req.body || {};
  const sets = []; const vals = [];
  const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  let temporary_password = null;
  try {
    const { rows: [existing] } = await pool.query('SELECT id, is_active FROM portal_users WHERE id = $1', [id]);
    if (!existing) return res.status(404).json({ error: 'User not found' });
    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name) return res.status(400).json({ error: 'name cannot be empty' });
      set('name', name);
    }
    if (b.username !== undefined) {
      const username = String(b.username).trim().toLowerCase();
      if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'username must be 2–50 chars: letters, numbers, . _ -' });
      const { rows: dup } = await pool.query('SELECT id FROM portal_users WHERE username = $1 AND id <> $2', [username, id]);
      if (dup.length) return res.status(409).json({ error: `Username "${username}" is already taken` });
      set('username', username);
    }
    if (b.is_active !== undefined) {
      if (typeof b.is_active !== 'boolean') return res.status(400).json({ error: 'is_active must be true or false' });
      if (!b.is_active) {
        if (id === req.user.id) return res.status(400).json({ error: "You can't deactivate your own login" });
        const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int AS n FROM portal_users WHERE is_active AND id <> $1', [id]);
        if (n === 0) return res.status(400).json({ error: "Can't deactivate the last active portal user" });
      }
      set('is_active', b.is_active);
    }
    if (b.reset_password === true) {
      temporary_password = tempPassword();
      set('password_hash', await bcrypt.hash(temporary_password, 10));
      set('must_change_password', true);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    const { rows: [user] } = await pool.query(
      `UPDATE portal_users SET ${sets.join(', ')} WHERE id = $${vals.length + 1} RETURNING ${USER_COLS}`, [...vals, id]
    );
    await audit(req, 'user_update', { detail: { user_id: id, fields: Object.keys(b) } });
    res.json(temporary_password ? { user, temporary_password } : { user });
  } catch (e) {
    console.error('[users PATCH]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
