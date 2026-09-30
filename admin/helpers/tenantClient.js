// Talks to one customer deploy's /api/tenant/* (built in Phase 1).
//
// Every call carries the tenant's decrypted TENANT_ADMIN_KEY in X-Tenant-Key,
// times out (TENANT_TIMEOUT_MS, default 8s) so one dead deploy can't hang the
// dashboard, and normalises failures into { ok:false, error, status } so the
// portal can show "unreachable" instead of crashing.
const { decrypt } = require('./crypto');
const { PORTAL_SECRET } = require('../secret');

const TIMEOUT = parseInt(process.env.TENANT_TIMEOUT_MS, 10) || 8000;

function baseUrl(url) {
  return String(url).trim().replace(/\/+$/, '');
}

async function call(tenant, method, path, { body, query } = {}) {
  let key;
  try { key = decrypt(tenant.key_enc, PORTAL_SECRET); }
  catch (e) { return { ok: false, status: 0, error: 'Stored tenant key cannot be decrypted (PORTAL_SECRET changed?). Re-enter the key.' }; }

  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')).toString() : '';
  const url = `${baseUrl(tenant.url)}/api/tenant${path}${qs}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, {
      method,
      headers: { 'X-Tenant-Key': key, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    if (!r.ok) {
      const msg = data?.error
        || (r.status === 401 ? 'Tenant rejected the admin key (wrong TENANT_ADMIN_KEY?)'
          : r.status === 404 ? 'Tenant has no admin API (TENANT_ADMIN_KEY not set on that deploy, or wrong URL)'
          : `Tenant responded ${r.status}`);
      return { ok: false, status: r.status, error: msg, code: data?.code, data };
    }
    return { ok: true, status: r.status, data };
  } catch (e) {
    const msg = e.name === 'AbortError' ? `No response within ${TIMEOUT / 1000}s` : (e.cause?.code || e.message);
    return { ok: false, status: 0, error: `Unreachable: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

const get   = (t, path, query) => call(t, 'GET', path, { query });
const patch = (t, path, body)  => call(t, 'PATCH', path, { body });
const post  = (t, path, body)  => call(t, 'POST', path, { body });

// Run the same call across many tenants in parallel; never throws.
async function fanOut(tenants, fn) {
  return Promise.all(tenants.map(async (t) => {
    try { return { tenant: t, result: await fn(t) }; }
    catch (e) { return { tenant: t, result: { ok: false, status: 0, error: e.message } }; }
  }));
}

module.exports = { call, get, patch, post, fanOut, baseUrl, TIMEOUT };
