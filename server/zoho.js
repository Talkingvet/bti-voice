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

// ── Phone candidate generator ─────────────────────────────────────────────────
// Used by both findContactByPhone and findAllContactsByPhone.
function phoneCandidates(phone) {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return [];
  const candidates = [];
  if (digits.length === 11 && digits.startsWith('1')) {
    candidates.push(digits.slice(1)); // "12395959310" → "2395959310" (try first)
    candidates.push(digits);          // "12395959310" (try second)
  } else if (digits.length === 10) {
    candidates.push(digits);          // "2395959310" (try first)
    candidates.push('1' + digits);    // "12395959310" (try second)
  } else {
    candidates.push(digits);
  }
  return candidates;
}

// ── Contact lookup by phone ────────────────────────────────────────────────────
// Tries the full digit string first, then strips a leading country code (e.g.
// Twilio sends "+12395959310" → 11 digits, but Zoho stores "(239) 595-9310"
// → 10 digits).  We try both so US numbers always resolve.
async function findContactByPhone(phone) {
  const candidates = phoneCandidates(phone);
  if (!candidates.length) return null;

  for (const candidate of candidates) {
    try {
      const result = await zohoAPI('GET',
        `/Contacts/search?phone=${encodeURIComponent(candidate)}&fields=id,Full_Name,Phone,Mobile`
      );
      if (result && result.data && result.data.length > 0) {
        return result.data[0];
      }
    } catch (e) {
      // 204 / no-results → try next candidate; other errors propagate
      if (e.status === 204 || (e.message && e.message.includes('204'))) continue;
      throw e;
    }
  }
  return null;
}
// ── ALL contacts at a phone number ─────────────────────────────────────────────
// v1.4.0: powers the post-call screen dropdown when several people at the same
// hospital share a number. Returns the deduped union of every Zoho contact that
// matches any of the digit candidates above.
async function findAllContactsByPhone(phone) {
  const candidates = phoneCandidates(phone);
  if (!candidates.length) return [];

  const seen = new Map(); // id -> contact
  for (const candidate of candidates) {
    try {
      const result = await zohoAPI('GET',
        '/Contacts/search?phone=' + encodeURIComponent(candidate) +
        '&fields=id,Full_Name,Account_Name,Email,Phone,Mobile'
      );
      if (result && result.data) {
        for (const c of result.data) {
          if (c && c.id && !seen.has(c.id)) seen.set(c.id, c);
        }
      }
    } catch (e) {
      // 204 = no results for this candidate, try next
      if (e.status === 204 || (e.message && e.message.includes('204'))) continue;
      throw e;
    }
  }
  return Array.from(seen.values());
}

// ── Zoho users (cached) ────────────────────────────────────────────────────────
// v1.4.0: powers the task assignee dropdown. Zoho user list rarely changes, so
// we cache it for an hour to avoid hammering the API on every post-call screen.
let _usersCache       = null;
let _usersCacheExpiry = 0;
const USERS_TTL_MS    = 60 * 60 * 1000; // 1 hour

async function listZohoUsers(opts) {
  const force = opts && opts.force;
  if (!force && _usersCache && Date.now() < _usersCacheExpiry) {
    return _usersCache;
  }
  // Zoho only returns active users by default (type=AllUsers includes inactive)
  const result = await zohoAPI('GET', '/users?type=ActiveUsers');
  const users  = (result && result.users) ? result.users.map(function(u) {
    return {
      id:        u.id,
      full_name: u.full_name,
      email:     u.email,
      role:      u.role && u.role.name,
    };
  }) : [];
  _usersCache       = users;
  _usersCacheExpiry = Date.now() + USERS_TTL_MS;
  return users;
}

// ── Create a new Zoho contact ──────────────────────────────────────────────────
// v1.4.0: powers the "Create in Zoho" button on unknown numbers.
async function createZohoContact(opts) {
  const first_name   = opts.first_name;
  const last_name    = opts.last_name;
  const phone        = opts.phone;
  const email        = opts.email;
  const account_name = opts.account_name;
  if (!last_name) throw new Error('last_name is required by Zoho Contacts');
  const data = { Last_Name: last_name };
  if (first_name)   data.First_Name   = first_name;
  if (phone)        data.Phone        = phone;
  if (email)        data.Email        = email;
  if (account_name) data.Account_Name = account_name;

  const result = await zohoAPI('POST', '/Contacts', { data: [data] });
  const record = result && result.data && result.data[0];
  if (!record || record.status === 'error') {
    throw Object.assign(new Error('[Zoho] Contact create failed'), { body: record });
  }
  return record.details; // { id, Created_Time, ... }
}

// ── Create a Zoho task on a contact ────────────────────────────────────────────
// v1.4.0: powers the post-call screen "follow-up task" block.
async function createZohoTask(opts) {
  const subject     = opts.subject;
  const description = opts.description;
  const due_date    = opts.due_date;
  const owner_id    = opts.owner_id;
  const contact_id  = opts.contact_id;
  if (!subject)    throw new Error('subject is required for a Zoho task');
  if (!contact_id) throw new Error('contact_id is required for a Zoho task');
  const data = {
    Subject:    subject,
    Who_Id:     { id: contact_id },
    $se_module: 'Contacts',
  };
  if (description) data.Description = description;
  if (due_date)    data.Due_Date    = due_date; // ISO date 'YYYY-MM-DD'
  if (owner_id)    data.Owner       = { id: owner_id };

  const result = await zohoAPI('POST', '/Tasks', { data: [data] });
  const record = result && result.data && result.data[0];
  if (!record || record.status === 'error') {
    throw Object.assign(new Error('[Zoho] Task create failed'), { body: record });
  }
  return record.details;
}

// ── Update an existing Zoho Call record's contact ──────────────────────────────
// v1.4.0: when the post-call wrap-up sweep already synced the call to the
// auto-matched contact, but the agent later picks a different contact, we
// re-attach the existing Zoho Call record to the chosen contact so reporting
// stays clean.
async function updateZohoCallContact(zohoCallId, newZohoContactId) {
  if (!zohoCallId || !newZohoContactId) {
    throw new Error('zohoCallId and newZohoContactId are required');
  }
  const result = await zohoAPI('PUT', '/Calls/' + zohoCallId, {
    data: [{
      id:         zohoCallId,
      Who_Id:     { id: newZohoContactId },
      $se_module: 'Contacts',
    }]
  });
  const record = result && result.data && result.data[0];
  if (!record || record.status === 'error') {
    throw Object.assign(new Error('[Zoho] Call re-attach failed'), { body: record });
  }
  return record.details;
}

// ── Simple HTTPS POST helper (no extra deps) ───────────────────────────────────
function post(url, body) {
  return new Promise(function(resolve, reject) {
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
    }, function(res) {
      let data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = {
  zohoAPI,
  findContactByPhone,
  findAllContactsByPhone,
  listZohoUsers,
  createZohoContact,
  createZohoTask,
  updateZohoCallContact,
};
