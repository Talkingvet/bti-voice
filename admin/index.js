// bti-voice-admin — BTI-only control plane for BTI Voice customer deploys.
// Admin portal Phase 2 (plan §3). Serves the portal UI from ./public and the
// JSON API under /api. Talks to each customer deploy's /api/tenant/* (Phase 1).
require('./secret'); // fail fast in production if PORTAL_SECRET is missing
const path = require('path');
const express = require('express');
const { migrate, pool } = require('./db');
const { bootstrap } = require('./auth');

const app = express();
app.set('trust proxy', 1); // Railway sits behind a proxy; req.ip = real client
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

// Basic hardening headers — the portal is a private tool, nothing embeds it.
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store' : 'no-cache');
  next();
});

app.get('/api/health', async (req, res) => {
  try {
    const { rows: [{ tenants }] } = await pool.query('SELECT COUNT(*)::int AS tenants FROM tenants WHERE is_active');
    res.json({ ok: true, version: require('./package.json').version, tenants, uptime_seconds: Math.round(process.uptime()) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/tenants'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));
// SPA fallback so /tenants/3 reloads cleanly.
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Server error' });
});

const PORT = process.env.PORT || 3000;
(async () => {
  try {
    await migrate();
    await bootstrap();
  } catch (e) {
    console.error('[boot] FATAL:', e);
    process.exit(1);
  }
  app.listen(PORT, () => console.log(`[admin] bti-voice-admin listening on :${PORT}`));
})();
