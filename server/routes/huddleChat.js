// BTI Huddle — internal chat (v0.1, 2026-10-02).
//
// Agent-to-agent messaging. Never touches Twilio: a message is a row in
// Postgres, fanned out to each member's running apps over socket.io (every
// socket already sits in its agent_<id> room). Zero marginal cost.
//
//   huddle_chats          dm | group, optional name
//   huddle_chat_members   who is in it, per-member pin + last_read_at
//   huddle_chat_messages  the messages
//
// Gated by the `huddle` flag like everything else under /api/huddle.

const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');
const { featureOn } = require('../helpers/deploySettings');
const { getIO } = require('../socket');

const router = express.Router();
router.use((req, res, next) => (featureOn('huddle') ? next() : res.status(404).json({ error: 'Not found' })));
router.use(requireAuth);

const MAX_BODY = 4000;

async function memberIds(chatId) {
  const { rows } = await pool.query('SELECT agent_id FROM huddle_chat_members WHERE chat_id = $1', [chatId]);
  return rows.map(r => r.agent_id);
}
async function isMember(chatId, agentId) {
  const { rows } = await pool.query('SELECT 1 FROM huddle_chat_members WHERE chat_id = $1 AND agent_id = $2', [chatId, agentId]);
  return rows.length > 0;
}
function emitTo(agentIds, event, payload) {
  const io = getIO();
  if (!io) return;
  for (const id of agentIds) io.to('agent_' + id).emit(event, payload);
}

// One chat, shaped for the client's list: members, last message, unread, pinned.
async function loadChat(chatId, forAgentId) {
  const { rows: [chat] } = await pool.query(
    `SELECT c.id, c.type, c.name, c.created_by, c.created_at,
            m.pinned, m.last_read_at,
            (SELECT COUNT(*) FROM huddle_chat_messages x
              WHERE x.chat_id = c.id AND x.sender_id <> $2
                AND x.created_at > COALESCE(m.last_read_at, 'epoch'::timestamptz)) AS unread,
            (SELECT row_to_json(l) FROM (
               SELECT x.id, x.body, x.sender_id, x.created_at FROM huddle_chat_messages x
                WHERE x.chat_id = c.id ORDER BY x.created_at DESC LIMIT 1) l) AS last_message
       FROM huddle_chats c JOIN huddle_chat_members m ON m.chat_id = c.id AND m.agent_id = $2
      WHERE c.id = $1`, [chatId, forAgentId]);
  if (!chat) return null;
  const { rows: members } = await pool.query(
    `SELECT a.id, a.name, a.username, a.color, a.initials, a.status
       FROM huddle_chat_members m JOIN agents a ON a.id = m.agent_id WHERE m.chat_id = $1 ORDER BY a.name`, [chatId]);
  chat.members = members;
  chat.unread = parseInt(chat.unread, 10) || 0;
  return chat;
}

// GET /chats — every chat I'm in, pinned first, then most recent activity
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id FROM huddle_chats c JOIN huddle_chat_members m ON m.chat_id = c.id
        WHERE m.agent_id = $1
        ORDER BY m.pinned DESC,
                 COALESCE((SELECT MAX(created_at) FROM huddle_chat_messages x WHERE x.chat_id = c.id), c.created_at) DESC`,
      [req.agent.id]);
    const chats = [];
    for (const r of rows) { const c = await loadChat(r.id, req.agent.id); if (c) chats.push(c); }
    res.json(chats);
  } catch (e) { console.error('[chats:list]', e); res.status(500).json({ error: 'Server error' }); }
});

// POST /chats { type: 'dm'|'group', member_ids: [], name? }
// A DM between the same two people is reused rather than duplicated.
router.post('/', async (req, res) => {
  const me = req.agent.id;
  const type = req.body?.type === 'group' ? 'group' : 'dm';
  let ids = Array.isArray(req.body?.member_ids) ? req.body.member_ids.map(n => parseInt(n, 10)).filter(Number.isInteger) : [];
  ids = [...new Set([...ids, me])];
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : null;
  if (type === 'dm' && ids.length !== 2) return res.status(400).json({ error: 'A direct message needs exactly one other person' });
  if (type === 'group' && ids.length < 2) return res.status(400).json({ error: 'Add at least one other person' });
  try {
    const { rows: valid } = await pool.query('SELECT id FROM agents WHERE id = ANY($1) AND is_active = true', [ids]);
    if (valid.length !== ids.length) return res.status(400).json({ error: 'Unknown agent' });

    if (type === 'dm') {
      const { rows } = await pool.query(
        `SELECT c.id FROM huddle_chats c
          WHERE c.type = 'dm'
            AND (SELECT COUNT(*) FROM huddle_chat_members m WHERE m.chat_id = c.id) = 2
            AND (SELECT COUNT(*) FROM huddle_chat_members m WHERE m.chat_id = c.id AND m.agent_id = ANY($1)) = 2
          LIMIT 1`, [ids]);
      if (rows.length) return res.json(await loadChat(rows[0].id, me));
    }

    const { rows: [chat] } = await pool.query(
      'INSERT INTO huddle_chats (type, name, created_by) VALUES ($1, $2, $3) RETURNING id', [type, name || null, me]);
    for (const id of ids) {
      await pool.query('INSERT INTO huddle_chat_members (chat_id, agent_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [chat.id, id]);
    }
    const full = await loadChat(chat.id, me);
    for (const id of ids) { const view = id === me ? full : await loadChat(chat.id, id); emitTo([id], 'chat:updated', view); }
    res.status(201).json(full);
  } catch (e) { console.error('[chats:create]', e); res.status(500).json({ error: 'Server error' }); }
});

// GET /chats/:id/messages?before=<iso>&limit=50 — newest first within the page
router.get('/:id/messages', async (req, res) => {
  const chatId = parseInt(req.params.id, 10);
  if (!Number.isInteger(chatId) || !(await isMember(chatId, req.agent.id))) return res.status(404).json({ error: 'Not found' });
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
  const before = req.query.before ? new Date(req.query.before) : null;
  try {
    const { rows } = await pool.query(
      `SELECT x.id, x.chat_id, x.sender_id, x.body, x.created_at
         FROM huddle_chat_messages x WHERE x.chat_id = $1 ${before && !isNaN(before) ? 'AND x.created_at < $3' : ''}
        ORDER BY x.created_at DESC LIMIT $2`,
      before && !isNaN(before) ? [chatId, limit, before] : [chatId, limit]);
    res.json(rows.reverse());
  } catch (e) { console.error('[chats:messages]', e); res.status(500).json({ error: 'Server error' }); }
});

// POST /chats/:id/messages { body }
router.post('/:id/messages', async (req, res) => {
  const chatId = parseInt(req.params.id, 10);
  const body = typeof req.body?.body === 'string' ? req.body.body.trim().slice(0, MAX_BODY) : '';
  if (!body) return res.status(400).json({ error: 'Empty message' });
  if (!Number.isInteger(chatId) || !(await isMember(chatId, req.agent.id))) return res.status(404).json({ error: 'Not found' });
  try {
    const { rows: [msg] } = await pool.query(
      'INSERT INTO huddle_chat_messages (chat_id, sender_id, body) VALUES ($1, $2, $3) RETURNING id, chat_id, sender_id, body, created_at',
      [chatId, req.agent.id, body]);
    // Sender has obviously read up to their own message.
    await pool.query('UPDATE huddle_chat_members SET last_read_at = $3 WHERE chat_id = $1 AND agent_id = $2', [chatId, req.agent.id, msg.created_at]);
    msg.sender_name = req.agent.name;
    emitTo(await memberIds(chatId), 'chat:message', msg);
    res.status(201).json(msg);
  } catch (e) { console.error('[chats:send]', e); res.status(500).json({ error: 'Server error' }); }
});

// POST /chats/:id/read — mark everything read
router.post('/:id/read', async (req, res) => {
  const chatId = parseInt(req.params.id, 10);
  if (!Number.isInteger(chatId)) return res.status(404).json({ error: 'Not found' });
  await pool.query('UPDATE huddle_chat_members SET last_read_at = NOW() WHERE chat_id = $1 AND agent_id = $2', [chatId, req.agent.id]);
  res.json({ ok: true });
});

// PATCH /chats/:id { pinned?, name? } — pin is per-person; name is shared (groups only)
router.patch('/:id', async (req, res) => {
  const chatId = parseInt(req.params.id, 10);
  if (!Number.isInteger(chatId) || !(await isMember(chatId, req.agent.id))) return res.status(404).json({ error: 'Not found' });
  try {
    if (typeof req.body?.pinned === 'boolean') {
      await pool.query('UPDATE huddle_chat_members SET pinned = $3 WHERE chat_id = $1 AND agent_id = $2', [chatId, req.agent.id, req.body.pinned]);
    }
    if (typeof req.body?.name === 'string') {
      const name = req.body.name.trim().slice(0, 80) || null;
      await pool.query(`UPDATE huddle_chats SET name = $2 WHERE id = $1 AND type = 'group'`, [chatId, name]);
      const ids = await memberIds(chatId);
      for (const id of ids) emitTo([id], 'chat:updated', await loadChat(chatId, id));
    }
    res.json(await loadChat(chatId, req.agent.id));
  } catch (e) { console.error('[chats:patch]', e); res.status(500).json({ error: 'Server error' }); }
});

// POST /chats/:id/members { agent_ids } — add people to a group
router.post('/:id/members', async (req, res) => {
  const chatId = parseInt(req.params.id, 10);
  if (!Number.isInteger(chatId) || !(await isMember(chatId, req.agent.id))) return res.status(404).json({ error: 'Not found' });
  const ids = Array.isArray(req.body?.agent_ids) ? req.body.agent_ids.map(n => parseInt(n, 10)).filter(Number.isInteger) : [];
  if (!ids.length) return res.status(400).json({ error: 'No one to add' });
  try {
    const { rows: [c] } = await pool.query('SELECT type FROM huddle_chats WHERE id = $1', [chatId]);
    if (!c || c.type !== 'group') return res.status(400).json({ error: 'You can only add people to a group chat' });
    for (const id of ids) await pool.query('INSERT INTO huddle_chat_members (chat_id, agent_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [chatId, id]);
    const all = await memberIds(chatId);
    for (const id of all) emitTo([id], 'chat:updated', await loadChat(chatId, id));
    res.json(await loadChat(chatId, req.agent.id));
  } catch (e) { console.error('[chats:add]', e); res.status(500).json({ error: 'Server error' }); }
});

// DELETE /chats/:id/members/me — leave a group
router.delete('/:id/members/me', async (req, res) => {
  const chatId = parseInt(req.params.id, 10);
  if (!Number.isInteger(chatId)) return res.status(404).json({ error: 'Not found' });
  try {
    await pool.query('DELETE FROM huddle_chat_members WHERE chat_id = $1 AND agent_id = $2', [chatId, req.agent.id]);
    emitTo([req.agent.id], 'chat:removed', { id: chatId });
    const rest = await memberIds(chatId);
    for (const id of rest) emitTo([id], 'chat:updated', await loadChat(chatId, id));
    res.json({ ok: true });
  } catch (e) { console.error('[chats:leave]', e); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
