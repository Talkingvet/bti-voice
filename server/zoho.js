// server/zoho.js
// Handles Zoho CRM OAuth2 token refresh and API calls.
// All Zoho calls go through zohoAPI() — it auto-refreshes the access token.

const https = require('https');
const http  = require('http');

let _accessToken  = null;
let _tokenExpires = 0;

// ── Token refresh ──────────────────────────────────────────────────────────────
async function getAccessToken() {
  if (_accessToken && Date.now() < _tokenExpires - 60_000) return _accessToken;

  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    client_id:     process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    grant_type:    'refresh_token',
  });

  const body = await post('https://accounts.zoho.com/oauth/v2/token', params.toString());
  if (!body.access_token) {
    throw new Error('[Zoho] Token refresh failed: ' + JSON.stringify(body));
  }

  _accessToken  = body.access_token;
  _tokenExpires = Date.now() + (body.expires_in || 3600) * 1000;
  return _accessToken;
}

// ── Generic API call ───────────────────────────────────────────────────────────
async function zohoAPI(method, path, data = null) {
  if (!process.env.ZOHO_REFRESH_TOKEN) {
    throw new Error('[Zoho] ZOHO_REFRESH_TOKEN not set — skipping CRM sync');
  }
  const token = await getAccessToken();
  const base  = (process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com').replace(/\/$/, '');
  const url   = `${base}/crm/v2${path}`;

  const options = {
    method,
    headers: {
      'Authorization': `Zoho-oauthtoken ${token}`,
      'Content-Type':  'application/json',
    },
  };

  return fetch(url, {
    ...options,
    body: data ? JSON.stringify(data) : undefined,
  }).then(async r => {
    if (r.status === 204) return null; // No content (e.g. search with no results)
    const json = await r.json();
    if (!r.ok) throw Object.assign(new Error('[Zoho API] ' + r.status), { body: json });
    return json;
  });
}

// ── Contact lookup by phone ────────────────────────────────────────────────────
// Zoho strips formatting during search, so "3038790040" matches "+13038790040".
async function findContactByPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;

  try {
    const result = await zohoAPI('GET',
      `/Contacts/search?phone=${encodeURIComponent(digits)}&fields=id,Full_Name,Phone,Mobile`
    );
    if (result && result.data && result.data.length > 0) {
      return result.data[0];
    }
  } catch (e) {
    // 204 returns null from zohoAPI, other errors propagate
    if (e.message && e.message.includes('204')) return null;
    throw e;
  }
  return null;
}

// ── Simple HTTPS POST helper (no extra deps) ───────────────────────────────────
function post(url, body) {
  return new Promise((resolve, reject) => {
    const u   = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      path:     u.pathname + u.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { zohoAPI, findContactByPhone };
