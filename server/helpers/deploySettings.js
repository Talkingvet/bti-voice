// Per-deploy settings + subscription state (admin portal Phase 1, 2026-09-30).
//
// Single source of truth for three questions the rest of the server asks:
//   1. resolveFeatures()  — is add-on X on for THIS customer?
//   2. accountStatus()    — where is this deploy in its billing lifecycle,
//                           and what is it allowed to do right now?
//   3. getSettings()      — the raw deploy_settings row (portal reads/writes it).
//
// The row is cached in memory and refreshed every REFRESH_MS, and immediately
// after any PATCH through /api/tenant/settings. It is read synchronously from
// TwiML builders and auth middleware (hot paths, no await), so the cache is
// primed once at boot (see index.js) and never awaited afterwards.
//
// Feature rule: a toggle can only ever turn something OFF. Credentials still
// gate everything — toggling zoho=true on a deploy with no ZOHO_* vars does
// nothing, exactly as before. Missing key = on.
//
// Lifecycle (plan §4a #3 — Danny locked this in, do not change casually):
//   active        — no enabled_through, or more than 14 days away.
//   renews_soon   — within 14 days of enabled_through. Banner for everyone
//                   (there is no customer-admin role; see §4a #4).
//   grace         — past enabled_through, inside grace_days (default 14).
//                   Banner for everyone; app fully works.
//   restricted    — past grace. OUTBOUND calls + SMS OFF (incl. auto-texts).
//                   Inbound still rings and logs. Login + reading data work.
//   blocked       — past grace + 30 days, OR suspended=true. Login refused
//                   with a "contact BTI" message. NOTHING is deleted.
// BTI extends the date or flips suspended from the portal at any time.

const { pool } = require('../db');

const REFRESH_MS         = 30 * 1000;
const RENEWS_SOON_DAYS   = 14;
const BLOCK_AFTER_GRACE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const FEATURE_KEYS = ['zoho', 'recording', 'ai_summaries', 'sms', 'voicemail_transcription', 'mobile_apps', 'huddle', 'call_lists'];

const DEFAULT_ROW = {
  id: 1, features: {}, seat_limit: null, enabled_through: null, grace_days: 14,
  suspended: false, company_name: null, brand_name: null, notes: null,
};

let cached    = { ...DEFAULT_ROW };
let loadedAt  = 0;
let timer     = null;

async function refreshSettings() {
  try {
    const { rows: [row] } = await pool.query('SELECT * FROM deploy_settings WHERE id = 1');
    cached = row ? normalize(row) : { ...DEFAULT_ROW };
    loadedAt = Date.now();
  } catch (e) {
    console.error('[deploySettings] refresh failed (keeping previous values):', e.message);
  }
  return cached;
}

function normalize(row) {
  const out = { ...row };
  out.features = row.features && typeof row.features === 'object' ? row.features : {};
  // pg returns DATE as a JS Date at local midnight; keep a plain YYYY-MM-DD too.
  out.enabled_through = row.enabled_through ? toISODate(row.enabled_through) : null;
  out.grace_days = Number.isInteger(row.grace_days) ? row.grace_days : 14;
  return out;
}

function toISODate(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startSettingsRefresh() {
  if (timer) return;
  timer = setInterval(refreshSettings, REFRESH_MS);
  if (timer.unref) timer.unref();
}

// Synchronous read of the cached row. Never hits the DB.
function getSettings() { return cached; }

// ── Feature resolution ────────────────────────────────────────────────────────
// toggles: the deploy_settings.features object; env: process.env (injectable
// for tests). Returns booleans only — never credential values.
function resolveFeatures(toggles = cached.features, env = process.env) {
  const on = (k) => toggles[k] !== false; // missing = on
  let zohoConfigured = false;
  try { zohoConfigured = require('../zoho').isZohoConfigured(); } catch { /* tests */ }
  const hasOpenAI  = !!env.OPENAI_API_KEY;
  const recordingEnv = env.ENABLE_RECORDING === 'true' && !!env.SERVER_URL && hasOpenAI;
  return {
    zoho:                   on('zoho') && zohoConfigured,
    zoho_widget:            on('zoho') && zohoConfigured && !!env.ZOHO_WIDGET_KEY,
    recording:              on('recording') && recordingEnv,
    ai_summaries:           on('ai_summaries') && hasOpenAI,
    sms:                    on('sms'),
    voicemail_transcription: on('voicemail_transcription') && hasOpenAI,
    mobile_apps:            on('mobile_apps'),
    // BTI Huddle (video / screen share / meetings, 2026-10-02). OFF unless the
    // deploy explicitly sets ENABLE_HUDDLE=true — unlike the other keys, a
    // missing toggle must NOT mean on, because Huddle ships inert to every
    // existing Voice deploy. The portal toggle can still turn it off.
    huddle:                 on('huddle') && env.ENABLE_HUDDLE === 'true',
    // Call Lists (dialer lists, 2026-10-03). Same rule as Huddle: OFF unless the
    // deploy sets ENABLE_CALL_LISTS=true — BTI-only for now.
    call_lists:             on('call_lists') && env.ENABLE_CALL_LISTS === 'true',
  };
}

function featureOn(key) { return !!resolveFeatures()[key]; }

// ── Subscription lifecycle ────────────────────────────────────────────────────
// Pure function so it can be unit-tested: pass the row + "now".
function computeAccountStatus(row = cached, now = new Date()) {
  const graceDays = Number.isInteger(row.grace_days) ? row.grace_days : 14;
  const base = {
    enabled_through: row.enabled_through || null,
    grace_days: graceDays,
    grace_ends: null,
    blocked_from: null,
    days_until_renewal: null,
    suspended: !!row.suspended,
  };
  if (row.suspended) {
    return { ...base, state: 'blocked', outbound_allowed: false, login_allowed: false,
             message: 'This account has been suspended. Please contact BTI.' };
  }
  if (!row.enabled_through) {
    return { ...base, state: 'active', outbound_allowed: true, login_allowed: true, message: null };
  }
  // enabled_through is inclusive: the account is fully active THROUGH that day.
  const through   = new Date(row.enabled_through + 'T23:59:59.999');
  const graceEnd  = new Date(through.getTime() + graceDays * DAY_MS);
  const blockFrom = new Date(graceEnd.getTime() + BLOCK_AFTER_GRACE_DAYS * DAY_MS);
  const daysLeft  = Math.ceil((through.getTime() - now.getTime()) / DAY_MS);
  base.grace_ends   = toISODate(graceEnd);
  base.blocked_from = toISODate(blockFrom);
  base.days_until_renewal = daysLeft;
  const renewOn = fmtDate(row.enabled_through);

  if (now > blockFrom) {
    return { ...base, state: 'blocked', outbound_allowed: false, login_allowed: false,
             message: `This BTI Voice subscription ended on ${renewOn}. Please contact BTI to reactivate your account.` };
  }
  if (now > graceEnd) {
    return { ...base, state: 'restricted', outbound_allowed: false, login_allowed: true,
             message: `Your BTI Voice subscription ended on ${renewOn}. Outbound calls and texts are paused — incoming calls still ring. Please contact BTI to renew.` };
  }
  if (now > through) {
    return { ...base, state: 'grace', outbound_allowed: true, login_allowed: true,
             message: `Your BTI Voice subscription renewal was due ${renewOn}. Please contact BTI to renew and avoid interruption.` };
  }
  if (daysLeft <= RENEWS_SOON_DAYS) {
    return { ...base, state: 'renews_soon', outbound_allowed: true, login_allowed: true,
             message: `Your BTI Voice subscription renews on ${renewOn}.` };
  }
  return { ...base, state: 'active', outbound_allowed: true, login_allowed: true, message: null };
}

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function accountStatus() { return computeAccountStatus(cached, new Date()); }
function outboundAllowed() { return accountStatus().outbound_allowed; }
function loginAllowed()    { return accountStatus().login_allowed; }

// Convenience for SMS send sites: one reason string or null.
function smsBlockedReason() {
  if (!featureOn('sms')) return 'Text messaging is not enabled on this account. Please contact BTI.';
  const st = accountStatus();
  if (!st.outbound_allowed) return st.message;
  return null;
}

function displayNames(env = process.env) {
  return {
    brand:   cached.brand_name   || env.BRAND_NAME   || 'BTI Voice',
    company: cached.company_name || env.COMPANY_NAME || null,
  };
}

module.exports = {
  FEATURE_KEYS, REFRESH_MS, RENEWS_SOON_DAYS, BLOCK_AFTER_GRACE_DAYS,
  refreshSettings, startSettingsRefresh, getSettings,
  resolveFeatures, featureOn,
  computeAccountStatus, accountStatus, outboundAllowed, loginAllowed, smsBlockedReason,
  displayNames, toISODate,
  _setCacheForTests: (row) => { cached = { ...DEFAULT_ROW, ...row }; },
};
