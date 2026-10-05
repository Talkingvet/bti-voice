// Browser origins allowed to call the API cross-origin (Express CORS in
// index.js + the socket.io handshake in socket.js). Replaces the old `*`.
//
// Who actually calls us cross-origin:
//   iOS app      capacitor://localhost   (Capacitor default iOS scheme)
//   Android app  https://localhost       (client/capacitor.config.json androidScheme=https)
//   local dev    http://localhost[:port] (vite dev server)
// Everything else is SAME-origin and never consults this list: the web app
// and Huddle are served by this server, the Electron desktop app loads the
// server URL directly, and the Zoho widget + its call popup are served from
// /zoho-widget on this server (BASE = location.origin).
//
// Requests with no Origin header (curl, Twilio, the admin portal's
// server-to-server /api/tenant calls, Electron's own fetches) are allowed —
// CORS is a browser mechanism and has nothing to enforce there.
//
// CORS_ORIGINS (optional env): comma-separated extra origins, e.g. a future
// custom domain while the Railway URL is still in use.

const STATIC_ORIGINS = ['capacitor://localhost', 'https://localhost', 'http://localhost'];
const LOCALHOST_RE   = /^https?:\/\/localhost(:\d+)?$/;

function allowedOrigins(env = process.env) {
  const list = new Set(STATIC_ORIGINS);
  const self = (env.SERVER_URL || '').trim().replace(/\/+$/, '');
  if (self) { try { list.add(new URL(self).origin); } catch { /* ignore a malformed SERVER_URL */ } }
  for (const o of (env.CORS_ORIGINS || '').split(',')) {
    const t = o.trim().replace(/\/+$/, '');
    if (t) list.add(t);
  }
  return [...list];
}

function isAllowedOrigin(origin, env = process.env) {
  if (!origin) return true;                 // non-browser caller
  if (LOCALHOST_RE.test(origin)) return true; // any localhost port (dev)
  return allowedOrigins(env).includes(origin);
}

// Shape both the `cors` package and socket.io accept: (origin, cb).
function corsOriginFn(env = process.env) {
  return (origin, cb) => cb(null, isAllowedOrigin(origin, env));
}

module.exports = { allowedOrigins, isAllowedOrigin, corsOriginFn };
