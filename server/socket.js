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

    socket.on('join_conversation', (conversationId) => {
      socket.join(`conv_${conversationId}`);
    });

    socket.on('leave_conversation', (conversationId) => {
      socket.leave(`conv_${conversationId}`);
    });

    socket.on('disconnect', () => {
      console.log('[socket] Client disconnected:', socket.id);
    });
  });

  return io;
}

function getIO() {
  return io;
}

module.exports = { init, getIO };
