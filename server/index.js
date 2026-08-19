require('dotenv').config();
const express    = require('express');
const http       = require('http');
const cors       = require('cors');
const path       = require('path');
const { migrate } = require('./db');
const { init: initSocket } = require('./socket');
const { seed }   = require('./seed');
const { startWrapUpSweep } = require('./jobs/wrapUpSweep');
const { startScheduledSmsSweep } = require('./jobs/scheduledSmsSweep');

const app    = express();
const server = http.createServer(app);
initSocket(server);

// ── Middleware ────────────────────────────────────────────────
app.set('trust proxy', true); // Railway terminates TLS; trust X-Forwarded-* 
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
app.use('/api/zoho-widget',   require('./routes/zohoWidget'));

// ── Twilio Webhooks ───────────────────────────────────────────
const { validateTwilio } = require('./webhooks/validateTwilio');
app.use('/webhooks/sms',       validateTwilio, require('./webhooks/sms'));
app.use('/webhooks/voice',     validateTwilio, require('./webhooks/voice'));

// ── Zoho CRM widget (static page, tracked in git — server/public is build output) ──
app.use('/zoho-widget', express.static(path.join(__dirname, 'zoho-widget')));

// ── Serve React Frontend ──────────────────────────────────────
const PUBLIC = path.join(__dirname, 'public');
app.use(express.static(PUBLIC));
// Unmatched API/webhook routes should 404 as JSON, not return index.html.
app.use(['/api', '/webhooks'], (req, res) => res.status(404).json({ error: 'Not found' }));
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC, 'index.html'));
});

// Central error handler — catches errors passed via next(err) so a thrown
// async handler returns 500 JSON instead of hanging the request.
app.use((err, req, res, next) => {
  console.error('[express error]', req.method, req.originalUrl, err && err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Crash safety ──────────────────────────────────────────────
// Express 4 doesn't catch rejected promises from async handlers, and Node
// defaults to crashing on unhandled rejections. Log instead of dying — a
// single bad request shouldn't drop every active call.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await migrate();
    await seed();
    startWrapUpSweep(); // v1.4.0: catches calls the agent skipped wrap-up on
    startScheduledSmsSweep(); // v1.5.x: sends due scheduled SMS
    server.listen(PORT, () => {
      console.log(`\n🚀 ${process.env.BRAND_NAME || 'BTI Voice'} running on port ${PORT}`);
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
