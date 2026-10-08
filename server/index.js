require('dotenv').config();
const express    = require('express');
const http       = require('http');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const { corsOriginFn } = require('./helpers/origins');
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
// Railway terminates TLS behind ONE proxy hop. `1` (not `true`) so req.ip is
// the real client as reported by Railway and can't be spoofed by a client-
// supplied X-Forwarded-For — the rate limiters below key on it, and the
// activity log stores it. Same setting as the admin portal (review §3 B12).
app.set('trust proxy', 1);

// Security headers (review §5 B8). Deliberate exemptions — each one breaks a
// real client if left at helmet's default:
//   contentSecurityPolicy   off — a real CSP for the SPA + Twilio SDK is its own batch
//   crossOriginOpenerPolicy off — the Zoho widget opens the call popup with
//                                 window.open() from inside Zoho CRM; COOP would
//                                 sever the opener and the popup-blocked check
//   crossOriginResourcePolicy = cross-origin — the iOS/Android apps load
//                                 recordings + MMS images from this server
//   frameguard              off here, applied below to everything EXCEPT
//                                 /zoho-widget, which lives in an iframe in Zoho CRM
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  frameguard: false,
}));
const frameguard = helmet.frameguard({ action: 'sameorigin' });
app.use((req, res, next) => (req.path.startsWith('/zoho-widget') ? next() : frameguard(req, res, next)));

// CORS: explicit allow-list instead of `*` (helpers/origins.js — SERVER_URL,
// the mobile apps' capacitor://localhost + https://localhost, localhost dev,
// plus optional CORS_ORIGINS). Same-origin callers (web app, Electron, Huddle,
// Zoho widget) are unaffected by CORS entirely.
app.use(cors({ origin: corsOriginFn(), methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] }));
app.use(express.json({ limit: '100kb' }));          // explicit; diagnostics logs stay under this (utils/logBuffer.js)
app.use(express.urlencoded({ extended: false })); // needed for Twilio webhooks

// Rate limits (review §5 A4 / B8), per client IP. Twilio webhooks (/webhooks)
// are signature-validated and NOT limited. socket.io traffic isn't under /api.
// 429s are JSON with `error` so the app shows the message like any other error.
const limiter = (opts) => rateLimit({
  standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many requests — please wait a minute and try again.' },
  ...opts,
});
// Whole API: generous — an office behind one IP with every app open and
// refetching on socket events stays far below this.
const apiLimiter = limiter({ windowMs: 60 * 1000, limit: 300,
  skip: (req) => req.path === '/health' || req.path === '/features' });
// Login: 30 attempts / 15 min per IP (the per-username throttle in
// routes/auth.js is the other axis — 10 fails / 15 min, copied from the portal).
const loginLimiter = limiter({ windowMs: 15 * 60 * 1000, limit: 30,
  message: { error: 'Too many login attempts from this network. Try again in 15 minutes.' } });
// /track fires on a handful of UI events; /diagnostics is a manual button.
const trackLimiter = limiter({ windowMs: 15 * 60 * 1000, limit: 60 });
const diagLimiter  = limiter({ windowMs: 15 * 60 * 1000, limit: 10 });
app.use('/api', apiLimiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/track', trackLimiter);
app.post('/api/diagnostics', diagLimiter);

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
const { twilioConfigured } = require('./helpers/smsConfig');
app.get('/api/features', (req, res) => {
  const st = deploySettings.accountStatus();
  res.json({
    ...deploySettings.resolveFeatures(),
    // batch 7 (F1): lets the composer explain "texting isn't set up" instead
    // of letting a send fail. Per-agent number is checked client-side.
    sms_configured: twilioConfigured(),
    brand:   deploySettings.displayNames().brand,
    company: deploySettings.displayNames().company,
    // batch 8 (brand sweep): who to contact + the per-deploy wrap-up config.
    support: deploySettings.support(),
    wrap_up: deploySettings.wrapUp(),
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
app.use('/api/huddle/chats',  require('./routes/huddleChat'));
// Call Lists (dialer lists). 404s unless ENABLE_CALL_LISTS=true — BTI only for now.
app.use('/api/call-lists',    require('./routes/callLists'));

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
