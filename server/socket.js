const { Server } = require('socket.io');

let io;

function init(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  io.on('connection', (socket) => {
    console.log('[socket] Client connected:', socket.id);

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
