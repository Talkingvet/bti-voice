require('dotenv').config();
const express    = require('express');
const http       = require('http');
const cors       = require('cors');
const path       = require('path');
const { migrate } = require('./db');
const { init: initSocket } = require('./socket');
const { seed }   = require('./seed');
const { startWrapUpSweep } = require('./jobs/wrapUpSweep');

const app    = express();
const server = http.createServer(app);
initSocket(server);

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // needed for Twilio webhooks

// ── API Routes ────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/agents',        require('./routes/agents'));
app.use('/api/contacts',      require('./routes/contacts'));
app.use('/api/conversations', require('./routes/conversations'));
app.use('/api/messages',      require('./routes/messages'));
app.use('/api/calls',         require('./routes/calls'));
app.use('/api/activity',      require('./routes/activity'));
app.use('/api/zoho',          require('./routes/zohoSync'));
app.use('/api/ivr',           require('./routes/ivr'));
app.use('/api/updates',       require('./routes/updates'));
app.use('/api/conversations', require('./routes/notes'));
app.use('/api/canned-responses', require('./routes/cannedResponses'));
app.use('/api/quick-dial',    require('./routes/quickDial'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/track',         require('./routes/track'));
app.use('/admin/activity',    require('./routes/adminActivity'));

// ── Twilio Webhooks ───────────────────────────────────────────
app.use('/webhooks/sms',       require('./webhooks/sms'));
app.use('/webhooks/voice',     require('./webhooks/voice'));

// ── Serve React Frontend ──────────────────────────────────────
const PUBLIC = path.join(__dirname, 'public');
app.use(express.static(PUBLIC));
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC, 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await migrate();
    await seed();
    startWrapUpSweep(); // v1.4.0: catches calls the agent skipped wrap-up on
    server.listen(PORT, () => {
      console.log(`\n🚀 BTI Voice running on port ${PORT}`);
      console.log(`   Local:   http://localhost:${PORT}`);
      console.log(`   Twilio webhook URLs (set in Twilio console):`);
      console.log(`     SMS:   https://YOUR-DOMAIN/webhooks/sms`);
      console.log(`     Voice: https://YOUR-DOMAIN/webhooks/voice/inbound\n`);
    });
  } catch (e) {
    console.error('Startup error:', e);
    process.exit(1);
  }
})();
