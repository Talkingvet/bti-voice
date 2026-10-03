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
// Unauthenticated liveness probe — the desktop app's offline page polls this
// to know when to reconnect.
app.get('/api/health', (req, res) => res.json({ ok: true }));
// Feature flags for the client — which optional add-ons this deploy has.
// Booleans only, never credential values. The client hides CRM UI when
// zoho=false so a customer without Zoho never sees CRM panels or buttons.
// Admin portal Phase 1: flags now come from env vars AND the per-customer
// toggles BTI sets in deploy_settings (helpers/deploySettings.js); `account`
// carries the subscription state so the client can show the renewal /
// grace / restricted banner (plan §4a #3). No customer-controllable inputs.
const { isZohoConfigured } = require('./zoho');
const deploySettings = require('./helpers/deploySettings');
app.get('/api/features', (req, res) => {
  const st = deploySettings.accountStatus();
  res.json({
    ...deploySettings.resolveFeatures(),
    brand: deploySettings.displayNames().brand,
    account: {
      state: st.state, message: st.message, enabled_through: st.enabled_through,
      grace_ends: st.grace_ends, outbound_allowed: st.outbound_allowed,
    },
  });
});
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
app.use('/api/diagnostics',   require('./routes/diagnostics'));
app.use('/admin/activity',    require('./routes/adminActivity'));
// BTI-only tenant admin API (admin portal Phase 1). Keyed by TENANT_ADMIN_KEY,
// never a customer login. The Phase 2 portal is its only intended client.
app.use('/api/tenant',        require('./routes/tenant'));
app.use('/api/zoho-widget',   require('./routes/zohoWidget'));
// BTI Huddle (video / screen share / meetings). 404s unless ENABLE_HUDDLE=true.
app.use('/api/huddle',        require('./routes/huddle'));

// ── Twilio Webhooks ───────────────────────────────────────────
const { validateTwilio } = require('./webhooks/validateTwilio');
app.use('/webhooks/sms',       validateTwilio, require('./webhooks/sms'));
app.use('/webhooks/voice',     validateTwilio, require('./webhooks/voice'));

// ── Zoho CRM widget (static page, tracked in git — server/public is build output) ──
app.use('/zoho-widget', express.static(path.join(__dirname, 'zoho-widget')));

// ── Serve BTI Huddle frontend (separate Vite app, built into server/public-huddle) ──
// Served only when the flag is on, so a Voice-only deploy has no /huddle page.
// Flag off → falls through to the Voice SPA below, which shows its normal UI.
const HUDDLE_PUBLIC = path.join(__dirname, 'public-huddle');
const huddleEnabled = (req, res, next) => (deploySettings.featureOn('huddle') ? next() : next('router'));
const huddleRouter = express.Router();
huddleRouter.use(huddleEnabled);
huddleRouter.use(express.static(HUDDLE_PUBLIC));
huddleRouter.get('*', (req, res, next) => {
  res.sendFile(path.join(HUDDLE_PUBLIC, 'index.html'), (err) => { if (err) next(); });
});
app.use('/huddle', huddleRouter);

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
    // Prime the per-deploy settings cache (features, seats, renewal date) and
    // keep it fresh — auth + TwiML read it synchronously.
    await deploySettings.refreshSettings();
    deploySettings.startSettingsRefresh();
    // v1.4.0: catches calls the agent skipped wrap-up on. Zoho-only — the
    // sweep's sole job is pushing calls to the CRM, so skip it entirely on
    // deploys without the Zoho add-on.
    if (require('./zoho').hasZohoCredentials()) startWrapUpSweep();
    else console.log('[boot] Zoho CRM add-on not configured — CRM sync + wrap-up sweep disabled');
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
