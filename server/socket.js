const { Server } = require('socket.io');

let io;

function init(httpServer) {
  const jwt = require('jsonwebtoken');
  const { JWT_SECRET } = require('./secret');

  io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  // Require a valid agent token to open a socket. Without this, anyone could
  // connect and join a conversation room to stream every message in real time.
  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('Unauthorized'));
    try {
      socket.agent = jwt.verify(token, JWT_SECRET);
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    console.log('[socket] Client connected:', socket.id, 'agent:', socket.agent && socket.agent.username);

    // Per-agent room — lets the server target one agent's running app
    // (e.g. Zoho click-to-dial emits 'dial_request' into agent_<id>).
    if (socket.agent && socket.agent.id) {
      socket.join('agent_' + socket.agent.id);
    }

    socket.on('join_conversation', (conversationId) => {
      socket.join(`conv_${conversationId}`);
    });

    socket.on('leave_conversation', (conversationId) => {
      socket.leave(`conv_${conversationId}`);
    });

    // ── Huddle (video / screen share) signaling ─────────────────────────────
    // The server never sees media. It only (a) tracks who is in which Huddle
    // room so new joiners know whom to connect to, (b) relays WebRTC
    // offers/answers/ICE candidates between two sockets, and (c) rings an
    // agent's running apps for a direct call. All gated by the huddle flag.
    const huddleRooms = new Set(); // rooms this socket is in, for cleanup
    const huddleOn = () => { try { return require('./helpers/deploySettings').featureOn('huddle'); } catch { return false; } };
    const roomName = (code) => 'huddle_' + String(code || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64);
    const me = () => ({ socketId: socket.id, agent: { id: socket.agent.id, name: socket.agent.name, username: socket.agent.username } });

    socket.on('huddle:join', async (code, ack) => {
      if (!huddleOn()) return;
      const room = roomName(code);
      if (room === 'huddle_') return;
      // Tell the joiner who is already here, then announce the joiner.
      const sockets = await io.in(room).fetchSockets();
      const peers = sockets.filter(s => s.id !== socket.id).map(s => ({
        socketId: s.id, agent: { id: s.agent.id, name: s.agent.name, username: s.agent.username },
      }));
      socket.join(room);
      huddleRooms.add(room);
      if (typeof ack === 'function') ack({ peers });
      socket.to(room).emit('huddle:peer-joined', me());
    });

    const leaveHuddle = (room) => {
      if (!huddleRooms.has(room)) return;
      huddleRooms.delete(room);
      socket.leave(room);
      socket.to(room).emit('huddle:peer-left', { socketId: socket.id });
    };
    socket.on('huddle:leave', (code) => leaveHuddle(roomName(code)));

    // Relay one WebRTC signaling message to one peer socket.
    socket.on('huddle:signal', ({ to, data } = {}) => {
      if (!huddleOn() || !to || !data) return;
      io.to(to).emit('huddle:signal', { from: socket.id, agent: me().agent, data });
    });

    // Direct call: ring every running app of the target agent.
    socket.on('huddle:ring', ({ toAgentId, code } = {}) => {
      if (!huddleOn()) return;
      const id = parseInt(toAgentId, 10);
      if (!Number.isInteger(id) || !code) return;
      io.to('agent_' + id).emit('huddle:ring', { from: me().agent, code: String(code).slice(0, 64) });
    });
    // Callee declined (accepting is implicit — they just join the room).
    socket.on('huddle:decline', ({ toAgentId, code } = {}) => {
      if (!huddleOn()) return;
      const id = parseInt(toAgentId, 10);
      if (!Number.isInteger(id)) return;
      io.to('agent_' + id).emit('huddle:declined', { by: me().agent, code });
    });

    // Chat typing indicator: relay to the other members of a chat.
    socket.on('chat:typing', async ({ chatId } = {}) => {
      if (!huddleOn()) return;
      const id = parseInt(chatId, 10);
      if (!Number.isInteger(id)) return;
      try {
        const { pool } = require('./db');
        const { rows } = await pool.query('SELECT agent_id FROM huddle_chat_members WHERE chat_id = $1', [id]);
        if (!rows.some(r => r.agent_id === socket.agent.id)) return;
        for (const r of rows) if (r.agent_id !== socket.agent.id) io.to('agent_' + r.agent_id).emit('chat:typing', { chatId: id, agent: me().agent });
      } catch { /* ignore */ }
    });

    socket.on('disconnect', () => {
      for (const room of [...huddleRooms]) leaveHuddle(room);
      console.log('[socket] Client disconnected:', socket.id);
    });
  });

  return io;
}

function getIO() {
  return io;
}

module.exports = { init, getIO };
