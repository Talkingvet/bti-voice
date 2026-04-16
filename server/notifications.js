// Shared helper — creates a notification row and broadcasts it via socket.
const { pool } = require('./db');
const { getIO } = require('./socket');

const COLORS = {
  sms:         '#3b82f6',
  missed_call: '#ef4444',
  resolved:    '#22c55e',
};

async function createNotification({ type, title, body, meta = {} }) {
  try {
    const color = COLORS[type] || '#64748b';
    const { rows: [notif] } = await pool.query(
      `INSERT INTO notifications (type, title, body, color, meta)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [type, title, body || null, color, JSON.stringify(meta)]
    );
    const io = getIO();
    if (io) io.emit('notification', notif);
    return notif;
  } catch (e) {
    console.error('[notifications] createNotification error:', e.message);
  }
}

module.exports = { createNotification };
