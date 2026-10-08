/* BTI Voice Admin portal — no build step, no framework.
   Hash routes:  #/  #/add  #/c/:id/:section  #/users  #/password                 */
(() => {
'use strict';

// ── tiny DOM helper ──────────────────────────────────────────────────────────
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'value') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  } else if (attrs != null) kids.unshift(attrs);
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}
const $app = document.getElementById('app');
function render(...nodes) { $app.replaceChildren(...nodes.flat()); window.scrollTo(0, 0); }
const svg = (d) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = d; return s; };
const I = {
  dash:  '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="11" width="8" height="10" rx="1.5"/><rect x="3" y="14" width="8" height="7" rx="1.5"/>',
  add:   '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.5a5 5 0 0 1 6 5"/>',
  key:   '<circle cx="8" cy="14" r="4"/><path d="M11 11l9-9M16 6l3 3M14 8l2 2"/>',
  usage: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  people:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  feat:  '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2.5"/><circle cx="8" cy="17" r="2.5"/>',
  bill:  '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  health:'<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  log:   '<path d="M5 6h14M5 12h14M5 18h9"/>',
  setup: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
  brand: '<path d="M4 20l4-1 10-10-3-3L5 16l-1 4z"/><path d="M13 7l3 3"/>',
  back:  '<path d="M15 6l-6 6 6 6"/>',
  sun:   '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon:  '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
};

// ── state / api ──────────────────────────────────────────────────────────────
const S = { token: localStorage.getItem('bti_admin_token') || null, user: null, customers: null,
            theme: localStorage.getItem('bti_admin_theme') || 'dark' };
function setToken(t) { S.token = t; t ? localStorage.setItem('bti_admin_token', t) : localStorage.removeItem('bti_admin_token'); }
function applyTheme() { document.documentElement.dataset.theme = S.theme; localStorage.setItem('bti_admin_theme', S.theme); }
applyTheme();

async function api(method, path, body) {
  const r = await fetch('/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  if (r.status === 401 && S.token && !path.startsWith('/auth/login')) { setToken(null); S.user = null; route(); throw new Error(data?.error || 'Your session expired — sign in again'); }
  if (r.status === 403 && data?.code === 'must_change_password') { location.hash = '#/password'; throw new Error(data.error); }
  if (!r.ok) { const e = new Error(data?.error || `Request failed (${r.status})`); e.data = data; e.status = r.status; throw e; }
  return data;
}
const GET = (p) => api('GET', p), POST = (p, b) => api('POST', p, b), PATCH = (p, b) => api('PATCH', p, b);
async function loadCustomers(force) { if (!S.customers || force) S.customers = (await GET('/tenants')).tenants; return S.customers; }

// ── toasts / modals ──────────────────────────────────────────────────────────
const $toasts = h('div', { id: 'toasts' }); document.body.append($toasts);
function toast(msg, kind) { const t = h('div', { class: 'toast ' + (kind || '') }, msg); $toasts.append(t); setTimeout(() => t.remove(), kind === 'error' ? 7000 : 3500); }
const oops = (e) => toast(e.message || String(e), 'error');
function modal(title, body, { onClose } = {}) {
  const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) close(); } });
  const close = () => { bg.remove(); onClose && onClose(); };
  bg.append(h('div', { class: 'modal', role: 'dialog' }, h('h2', title), body(close)));
  document.body.append(bg);
  const first = bg.querySelector('input,button'); first && first.focus();
  return close;
}
function confirmModal(title, text, { danger, okLabel = 'Confirm' } = {}) {
  return new Promise((resolve) => {
    modal(title, (close) => h('div', h('p', text),
      h('div', { class: 'row end', style: 'margin-top:1rem' },
        h('button', { class: 'btn', onclick: () => { close(); resolve(false); } }, 'Cancel'),
        h('button', { class: 'btn primary' + (danger ? ' danger' : ''), onclick: () => { resolve(true); close(); } }, okLabel))),
      { onClose: () => resolve(false) });
  });
}
function showTempPassword(who, password, extra) {
  modal('Temporary password', (close) => h('div',
    h('p', `Give this to ${who}. It's shown once, and they'll be asked to choose their own password the first time they sign in.`),
    h('div', { class: 'secret' }, h('span', password),
      h('button', { class: 'btn sm', onclick: () => navigator.clipboard?.writeText(password).then(() => toast('Copied')) }, 'Copy')),
    extra ? h('p', { class: 'muted', style: 'margin-top:.8rem' }, extra) : null,
    h('div', { class: 'row end', style: 'margin-top:1rem' }, h('button', { class: 'btn primary', onclick: close }, 'Done'))));
}

// ── form helpers ─────────────────────────────────────────────────────────────
// Filled input with the label inside (nVoq / Material style).
function field(label, input, hint, opts = {}) {
  if (input.tagName === 'INPUT') input.classList.add('input');
  return h('div', { class: 'field' + (opts.inline ? ' inline' : ''), style: opts.style }, h('label', label), input, hint ? h('span', { class: 'hint' }, hint) : null);
}
const inp = (attrs) => h('input', { type: 'text', ...attrs });

// ── formatting ───────────────────────────────────────────────────────────────
const fmtN = (n) => (n == null ? '—' : Number(n).toLocaleString());
const parseDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? new Date(...String(d).split('-').map((n, i) => +n - (i === 1 ? 1 : 0))) : new Date(d));
const fmtDate = (d) => (d ? parseDate(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const fmtDT = (d) => (d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const fmtISO = (d) => (d ? String(d).slice(0, 10) : '');
const fmtBytes = (b) => { if (b == null) return '—'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; b = Number(b); while (b >= 1024 && i < 3) { b /= 1024; i++; } return b.toFixed(i ? 1 : 0) + ' ' + u[i]; };
const ago = (d) => { if (!d) return 'never'; const s = (Date.now() - new Date(d)) / 1000; if (s < 90) return 'just now'; if (s < 5400) return Math.round(s / 60) + ' min ago'; if (s < 172800) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' days ago'; };
const pill = (p) => h('span', { class: 'pill ' + p.tone }, p.label);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const host = (u) => String(u || '').replace(/^https?:\/\//, '').replace(/\/$/, '');

const FEATURE_LABELS = {
  zoho: ['Zoho CRM integration', 'Needs Zoho credentials on the deploy. Off hides every CRM screen in the app.'],
  recording: ['Call recording', 'Needs ENABLE_RECORDING and an OpenAI key on the deploy. Off means no recording and no spoken disclosure.'],
  ai_summaries: ['AI call summaries', 'The transcript is still kept when this is off.'],
  sms: ['Text messaging (SMS/MMS)', 'Off refuses every outgoing text. Incoming texts still arrive.'],
  voicemail_transcription: ['Voicemail transcription', 'The audio is still saved when this is off.'],
  mobile_apps: ['iPhone and Android apps', 'Off refuses sign-in from phones. Desktop and browser still work.'],
  huddle: ['BTI Huddle (video, screen share, team chat)', 'Also needs ENABLE_HUDDLE=true on the deploy — this switch can only turn it off.'],
  call_lists: ['Call lists (dialer lists)', 'Also needs ENABLE_CALL_LISTS=true on the deploy — this switch can only turn it off. BTI-only for now.'],
};
const SECTIONS = [['usage', 'Usage', I.usage], ['users', 'Users', I.people], ['features', 'Features', I.feat], ['branding', 'Branding', I.brand], ['billing', 'Billing', I.bill], ['health', 'Health', I.health], ['log', 'Activity', I.log], ['setup', 'Setup', I.setup]];

// ── frame (sidebar + title bar) ──────────────────────────────────────────────
function pillFor(a) { // mirrors helpers/status.js
  const M = { blocked: ['Blocked', 'red'], restricted: ['Outbound off', 'red'], grace: ['In grace', 'amber'], renews_soon: ['Renews soon', 'amber'], active: ['OK', 'green'] };
  if (!a) return { label: 'Unknown', tone: 'grey' };
  if (a.suspended) return { label: 'Suspended', tone: 'red' };
  const [label, tone] = M[a.state] || M.active;
  return { label: a.state === 'renews_soon' && a.days_until_renewal != null ? `Renews in ${a.days_until_renewal} days` : label, tone };
}

function frame({ active, customer, section, title, crumb, sub, actions }, ...content) {
  const nav = (href, label, icon, on) => h('a', { href, class: on ? 'on' : '' }, svg(icon), label);
  const customers = (S.customers || []).filter(c => c.is_active);
  const sidebar = h('aside', { class: 'sidebar' },
    h('a', { href: '#/', class: 'brand' }, h('span', { class: 'mark' }, 'B'), h('span', 'BTI Voice', h('small', 'Admin portal'))),
    h('nav', { class: 'nav' },
      nav('#/', 'Dashboard', I.dash, active === 'dash'),
      nav('#/add', 'Add customer', I.add, active === 'add'),
      nav('#/users', 'Portal users', I.users, active === 'users'),
      customers.length ? h('div', { class: 'group' }, 'Customers') : null,
      customers.map(c => {
        const on = customer && customer.id === c.id;
        return [h('a', { href: `#/c/${c.id}/usage`, class: 'cust' + (on ? ' on' : '') },
                  h('span', { class: 'dot ' + (c.last_error ? 'red' : (c.last_ok_at ? 'on' : 'off')) }), h('span', { class: 'name' }, c.name)),
                on ? h('div', { class: 'sub' }, SECTIONS.map(([k, l, ic]) => nav(`#/c/${c.id}/${k}`, l, ic, section === k))) : null];
      })),
    h('div', { class: 'foot' },
      h('div', h('span', { class: 'who' }, S.user?.name), h('span', { class: 'muted' }, ' · ', S.user?.username)),
      h('div', { class: 'row' },
        h('a', { class: 'btn sm', href: '#/password' }, 'Password'),
        h('button', { class: 'btn sm', title: 'Switch theme', onclick: () => { S.theme = S.theme === 'dark' ? 'light' : 'dark'; applyTheme(); route(); } }, svg(S.theme === 'dark' ? I.sun : I.moon), S.theme === 'dark' ? 'Light' : 'Dark'),
        h('button', { class: 'btn sm', onclick: () => { setToken(null); S.user = null; S.customers = null; route(); } }, 'Sign out'))));
  const main = h('div', { class: 'main' },
    h('div', { class: 'titlebar' },
      h('div', crumb ? h('div', { class: 'crumb' }, crumb) : null, h('h1', title), sub ? h('div', { class: 'sub' }, sub) : null),
      actions ? h('div', { class: 'actions' }, actions) : null),
    h('div', { class: 'content' }, ...content));
  return h('div', { class: 'frame' }, sidebar, main);
}
const loading = (what) => h('div', { class: 'empty' }, `Loading ${what || ''}…`);
const errorBox = (e) => h('div', { class: 'alert error' }, e.message || String(e));

// ── login / password ─────────────────────────────────────────────────────────
function loginView() {
  const u = inp({ autocomplete: 'username', autofocus: true }), p = inp({ type: 'password', autocomplete: 'current-password' });
  const err = h('div');
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.replaceChildren();
    try { const r = await POST('/auth/login', { username: u.value, password: p.value }); setToken(r.token); S.user = r.user; location.hash = r.user.must_change_password ? '#/password' : '#/'; route(); }
    catch (ex) { err.replaceChildren(errorBox(ex)); }
  } },
    h('div', { class: 'brand' }, h('span', { class: 'mark' }, 'B'), h('span', 'BTI Voice', h('small', 'Admin portal'))),
    err, field('Username', u), field('Password', p),
    h('button', { class: 'btn primary block', type: 'submit' }, 'Sign in'),
    h('p', { class: 'hint', style: 'margin-top:1rem' }, 'BTI staff only. Every change made here is recorded.'));
  render(h('div', { class: 'login' }, h('div', { class: 'card' }, form)));
}

function passwordView() {
  const cur = inp({ type: 'password', autocomplete: 'current-password' }), nw = inp({ type: 'password', autocomplete: 'new-password' }), nw2 = inp({ type: 'password', autocomplete: 'new-password' });
  const box = h('div'); const forced = S.user?.must_change_password;
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); box.replaceChildren();
    if (nw.value !== nw2.value) return box.replaceChildren(h('div', { class: 'alert error' }, 'The two new passwords don\'t match'));
    try { await POST('/auth/change-password', { current_password: cur.value, new_password: nw.value }); S.user.must_change_password = false; toast('Password changed'); location.hash = '#/'; }
    catch (ex) { box.replaceChildren(errorBox(ex)); }
  } },
    forced ? h('div', { class: 'alert warn' }, 'You signed in with a temporary password. Choose your own to continue.') : null,
    box, field('Current password', cur), field('New password', nw, 'At least 10 characters.'), field('Confirm new password', nw2),
    h('button', { class: 'btn primary', type: 'submit' }, 'Change password'));
  render(frame({ active: 'pw', title: 'Change password' }, h('div', { class: 'panel', style: 'max-width:480px' }, form)));
}

// ── dashboard ────────────────────────────────────────────────────────────────
async function dashboardView() {
  render(frame({ active: 'dash', title: 'Customers' }, loading('every customer')));
  let d; try { d = await GET('/dashboard'); } catch (e) { return render(frame({ active: 'dash', title: 'Customers' }, errorBox(e))); }
  S.customers = [...d.tenants, ...d.inactive];
  const rows = [...d.tenants].sort((a, b) => a.pill.rank - b.pill.rank || a.name.localeCompare(b.name));
  const sum = (k) => rows.reduce((n, t) => n + (t.usage?.totals?.[k] || 0), 0);
  const month = rows.find(t => t.usage)?.usage;
  const table = rows.length ? h('div', { class: 'tablewrap' }, h('table',
    h('thead', h('tr', h('th', 'Customer'), h('th', 'Status'), h('th', 'Renews'), h('th', { class: 'num' }, 'Users'), h('th', { class: 'num' }, 'Calls'), h('th', { class: 'num' }, 'Minutes'), h('th', { class: 'num' }, 'Texts'), h('th', { class: 'num' }, 'Recorded min'), h('th', 'Turned off'))),
    h('tbody', rows.map(t => {
      const u = t.usage?.totals, c = t.usage?.counts;
      const off = t.features ? Object.entries(t.features).filter(([k, v]) => FEATURE_LABELS[k] && !v).map(([k]) => FEATURE_LABELS[k][0].split(' ')[0]) : [];
      return h('tr', { class: 'click', onclick: () => location.hash = `#/c/${t.id}/usage` },
        h('td', h('b', t.name), h('span', { class: 'sub' }, t.company_name && t.company_name !== t.name ? t.company_name : host(t.url))),
        h('td', pill(t.pill), t.error ? h('span', { class: 'sub', style: 'color:var(--red);max-width:280px' }, t.error) : null),
        h('td', t.account?.enabled_through ? fmtDate(t.account.enabled_through) : h('span', { class: 'muted' }, 'No expiry')),
        h('td', { class: 'num' }, c ? `${c.active_agents}${c.seat_limit ? ' / ' + c.seat_limit : ''}` : '—'),
        h('td', { class: 'num' }, u ? fmtN(u.calls_in + u.calls_out) : '—'),
        h('td', { class: 'num' }, u ? fmtN(u.call_minutes_in + u.call_minutes_out) : '—'),
        h('td', { class: 'num' }, u ? fmtN(u.sms_in + u.sms_out) : '—'),
        h('td', { class: 'num' }, u ? fmtN(u.recorded_minutes) : '—'),
        h('td', { class: 'muted' }, off.length ? off.join(', ') : (t.features ? 'Nothing' : '—')));
    })))) : h('div', { class: 'empty' }, 'No customers yet. ', h('a', { href: '#/add' }, 'Add the first one'), ' — start with BTI\'s own deploy.');
  render(frame({ active: 'dash', title: 'Customers',
      sub: month ? `This month so far (${fmtDate(month.from)} to ${fmtDate(month.to)}), read live from each deploy.` : 'Read live from each deploy.',
      actions: [h('button', { class: 'btn', onclick: dashboardView }, 'Refresh'), h('a', { class: 'btn primary', href: '#/add' }, svg(I.add), 'Add customer')] },
    rows.length ? h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'v' }, rows.length), h('div', { class: 'l' }, rows.length === 1 ? 'active customer' : 'active customers')),
      h('div', { class: 'stat' }, h('div', { class: 'v', style: rows.some(t => t.pill.key !== 'active') ? 'color:var(--amber)' : '' }, rows.filter(t => t.pill.key !== 'active').length), h('div', { class: 'l' }, 'need attention')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, fmtN(sum('calls_in') + sum('calls_out'))), h('div', { class: 'l' }, 'calls this month')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, fmtN(sum('call_minutes_in') + sum('call_minutes_out'))), h('div', { class: 'l' }, 'call minutes')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, fmtN(sum('sms_in') + sum('sms_out'))), h('div', { class: 'l' }, 'texts')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, fmtN(sum('recorded_minutes'))), h('div', { class: 'l' }, 'recorded minutes'))) : null,
    h('div', { class: 'panel' }, table),
    d.inactive.length ? h('p', { class: 'muted' }, 'Archived: ', d.inactive.map((t, i) => [i ? ', ' : '', h('a', { href: `#/c/${t.id}/setup` }, t.name)])) : null));
}

// ── add customer ─────────────────────────────────────────────────────────────
async function addView() {
  await loadCustomers().catch(() => {});
  const f = { name: inp({ placeholder: ' ' }), url: inp({ type: 'url', placeholder: 'https://acme-voice.up.railway.app' }),
    key: inp({ type: 'password', autocomplete: 'off' }), plan: inp({ placeholder: 'Pilot · $35 per user' }), notes: h('textarea'), force: h('input', { type: 'checkbox' }) };
  const box = h('div'); const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Verify and add');
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); box.replaceChildren(); btn.disabled = true;
    try {
      const r = await POST('/tenants', { name: f.name.value, url: f.url.value, key: f.key.value, plan: f.plan.value, notes: f.notes.value, force: f.force.checked });
      S.customers = null; toast(r.verified ? 'Customer added and verified' : 'Customer saved, not verified yet'); location.hash = `#/c/${r.tenant.id}/features`;
    } catch (ex) { box.replaceChildren(errorBox(ex)); if (ex.data?.code === 'verify_failed') box.append(h('div', { class: 'alert warn' }, ex.data.hint)); }
    finally { btn.disabled = false; }
  } },
    box,
    field('Customer name', f.name),
    field('Deploy address', f.url, 'The Railway address of that customer\'s BTI Voice service.'),
    field('Admin key', f.key, 'The TENANT_ADMIN_KEY set on that service. Stored encrypted; only its last four characters are ever shown again.'),
    field('Plan (optional)', f.plan),
    field('Internal notes (optional)', f.notes),
    h('div', { class: 'row between' }, h('label', { class: 'check muted' }, f.force, 'Save even if the deploy can\'t be reached right now'), btn));
  render(frame({ active: 'add', title: 'Add customer', sub: 'Registers a customer deploy. Nothing about the customer is stored here except this row — their settings live on their own deploy.' },
    h('div', { class: 'grid two' },
      h('div', { class: 'panel' }, form),
      h('div', { class: 'panel' }, h('h2', 'Before you start'),
        h('p', 'The customer\'s Railway service needs a variable named ', h('code', 'TENANT_ADMIN_KEY'), ' — a long random string. Paste the same value here.'),
        h('p', 'After adding, you\'ll land on Features to choose what they get, then set their renewal date under Billing and create their first user under Users.'),
        h('p', { class: 'muted' }, 'Full steps: DEPLOY-RUNBOOK §8b.')))));
}

// ── customer page ────────────────────────────────────────────────────────────
async function customerView(id, section) {
  section = SECTIONS.some(s => s[0] === section) ? section : 'usage';
  const label = SECTIONS.find(s => s[0] === section)[1];
  let reg;
  try { reg = (await loadCustomers(true)).find(c => c.id === id); } catch (e) { return render(frame({ title: 'Customer' }, errorBox(e))); }
  if (!reg) return render(frame({ title: 'Customer' }, errorBox(new Error('That customer no longer exists'))));
  const body = h('div', loading());
  render(frame({ customer: reg, section, title: reg.name, crumb: h('a', { href: '#/' }, '← All customers'),
      sub: [h('a', { href: reg.url, target: '_blank', rel: 'noopener' }, host(reg.url)), reg.plan ? ` — ${reg.plan}` : '', reg.last_ok_at ? ` — reached ${ago(reg.last_ok_at)}` : ''],
      actions: [!reg.is_active ? h('span', { class: 'pill grey' }, 'Archived') : null, h('span', { class: 'muted' }, label)] },
    reg.last_error ? h('div', { class: 'alert error' }, reg.last_error) : null, body));
  const views = { usage: usageTab, users: usersTab, features: featuresTab, branding: brandingTab, billing: billingTab, health: healthTab, log: logTab, setup: setupTab };
  try { body.replaceChildren(await views[section](id, reg)); } catch (e) { body.replaceChildren(errorBox(e)); }
}

// Usage ----------------------------------------------------------------------
async function usageTab(id) {
  const t = todayISO();
  const from = inp({ type: 'date', value: t.slice(0, 8) + '01' }), to = inp({ type: 'date', value: t });
  const agentSel = h('select', h('option', { value: '' }, 'Everyone'));
  const out = h('div');
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
  const preset = (label, f, tt) => h('button', { class: 'btn sm', type: 'button', onclick: () => { from.value = f; to.value = tt; load(); } }, label);
  async function load() {
    out.replaceChildren(loading('usage'));
    try {
      const u = await GET(`/tenants/${id}/usage?from=${from.value}&to=${to.value}${agentSel.value ? '&agent_id=' + agentSel.value : ''}`);
      if (agentSel.options.length === 1) for (const a of u.agents) agentSel.append(h('option', { value: a.agent_id }, a.name));
      const T = agentSel.value ? u.agents[0] || {} : u.totals;
      const tiles = [['Calls in', T.calls_in], ['Calls out', T.calls_out], ['Inbound minutes', T.call_minutes_in], ['Outbound minutes', T.call_minutes_out], ['Missed', T.missed_calls], ['Voicemails', T.voicemails],
        ['Texts in', T.sms_in], ['Texts out', T.sms_out], ['MMS', T.mms], ['Recordings', T.recordings], ['Recorded minutes', T.recorded_minutes], ['Transcriptions', T.transcriptions], ['AI summaries', T.ai_summaries]];
      const cols = [['calls_in', 'In'], ['calls_out', 'Out'], ['call_minutes_in', 'Min in'], ['call_minutes_out', 'Min out'], ['missed_calls', 'Missed'], ['voicemails', 'VM'], ['sms_in', 'Texts in'], ['sms_out', 'Texts out'], ['recorded_minutes', 'Rec min'], ['ai_summaries', 'AI']];
      out.replaceChildren(
        h('div', { class: 'stats compact' }, tiles.map(([l, v]) => h('div', { class: 'stat' }, h('div', { class: 'v' }, fmtN(v)), h('div', { class: 'l' }, l)))),
        h('div', { class: 'panel' },
          h('p', { class: 'muted' }, `${u.counts.active_agents} active ${u.counts.active_agents === 1 ? 'user' : 'users'}${u.counts.seat_limit ? ` of ${u.counts.seat_limit} seats` : ', no seat limit'} — ${u.counts.agents_logged_in_period} signed in this period — ${fmtN(u.counts.contacts)} contacts — ${fmtN(u.counts.conversations)} conversations — ${fmtBytes(u.storage.db_bytes + u.storage.media_bytes)} stored`),
          h('div', { class: 'tablewrap' }, h('table',
            h('thead', h('tr', h('th', 'User'), h('th', 'Last sign-in'), cols.map(c => h('th', { class: 'num' }, c[1])))),
            h('tbody', u.agents.map(a => h('tr', h('td', h('span', { class: 'dot ' + (a.is_active ? 'on' : 'off') }), h('b', a.name), h('span', { class: 'muted' }, '  ', a.username)), h('td', a.last_login_at ? fmtDT(a.last_login_at) : h('span', { class: 'muted' }, 'Never')), cols.map(c => h('td', { class: 'num' }, fmtN(a[c[0]]))))),
              !agentSel.value && Object.values(u.totals.unattributed).some(v => v) ? h('tr', h('td', { class: 'muted' }, 'Unattributed', h('span', { class: 'sub' }, 'Incoming to numbers no user owns')), h('td'), cols.map(c => h('td', { class: 'num muted' }, fmtN(u.totals.unattributed[c[0]])))) : null,
              !agentSel.value ? h('tr', { class: 'total' }, h('td', 'Total'), h('td'), cols.map(c => h('td', { class: 'num' }, fmtN(u.totals[c[0]])))) : null)))));
    } catch (e) { out.replaceChildren(errorBox(e)); }
  }
  async function exportCsv() {
    try {
      const r = await fetch(`/api/tenants/${id}/usage.csv?from=${from.value}&to=${to.value}`, { headers: { Authorization: 'Bearer ' + S.token } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'The export failed');
      const blob = await r.blob(); const a = h('a', { href: URL.createObjectURL(blob), download: (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'usage.csv' });
      document.body.append(a); a.click(); a.remove(); toast('CSV downloaded');
    } catch (e) { oops(e); }
  }
  load();
  return h('div',
    h('div', { class: 'panel' }, h('div', { class: 'row' },
      field('From', from, null, { inline: true }), field('To', to, null, { inline: true }), field('User', agentSel, null, { inline: true }),
      h('button', { class: 'btn', onclick: load }, 'Apply'),
      h('span', { style: 'width:.5rem' }), preset('This month', t.slice(0, 8) + '01', t), preset('Last month', iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))),
      h('span', { style: 'flex:1' }), h('button', { class: 'btn', onclick: exportCsv }, 'Export CSV'))),
    out);
}

// Users -----------------------------------------------------------------------
async function usersTab(id) {
  const wrap = h('div');
  async function load() {
    wrap.replaceChildren(loading('users'));
    try {
      const d = await GET(`/tenants/${id}/agents`);
      const seatNote = d.seat_limit ? `${d.active} of ${d.seat_limit} seats in use` : `${d.active} active ${d.active === 1 ? 'user' : 'users'}, no seat limit`;
      const act = async (a, body, msg) => { try { const r = await PATCH(`/tenants/${id}/agents/${a.id}`, body); if (r.temporary_password) showTempPassword(r.agent.name, r.temporary_password); else toast(msg); load(); } catch (e) { oops(e); } };
      wrap.replaceChildren(h('div', { class: 'panel' },
        h('div', { class: 'row between', style: 'margin-bottom:1rem' }, h('span', { class: 'muted' }, seatNote), h('button', { class: 'btn primary', onclick: () => addUser(id, load) }, svg(I.add), 'Add user')),
        h('div', { class: 'tablewrap' }, h('table',
          h('thead', h('tr', h('th', 'Name'), h('th', 'Username'), h('th', 'Number'), h('th', 'Status'), h('th', 'Last sign-in'), h('th'))),
          h('tbody', d.agents.map(a => h('tr',
            h('td', h('span', { class: 'dot ' + (a.is_active ? 'on' : 'off') }), h('b', a.name)),
            h('td', { class: 'mono' }, a.username),
            h('td', a.phone_number === 'TBD' ? h('span', { class: 'muted' }, '—') : a.phone_number),
            h('td', a.is_active ? (a.must_change_password ? h('span', { class: 'pill amber' }, 'Temporary password') : h('span', { class: 'pill green' }, 'Active')) : h('span', { class: 'pill grey' }, 'Deactivated')),
            h('td', a.last_login_at ? fmtDT(a.last_login_at) : h('span', { class: 'muted' }, 'Never')),
            h('td', { class: 'row end', style: 'flex-wrap:nowrap' },
              h('button', { class: 'btn sm', onclick: () => editUser(id, a, load) }, 'Edit'),
              h('button', { class: 'btn sm', onclick: async () => { if (await confirmModal('Reset password', `Reset ${a.name}'s password? Their current one stops working right away.`, { okLabel: 'Reset password' })) act(a, { reset_password: true }); } }, 'Reset password'),
              a.is_active ? h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmModal('Deactivate user', `${a.name} will be signed out and unable to sign in. Nothing is deleted.`, { danger: true, okLabel: 'Deactivate' })) act(a, { is_active: false }, 'User deactivated'); } }, 'Deactivate')
                : h('button', { class: 'btn sm', onclick: () => act(a, { is_active: true }, 'User reactivated') }, 'Reactivate')))))))));
    } catch (e) { wrap.replaceChildren(errorBox(e)); }
  }
  load();
  return wrap;
}
function addUser(id, reload) {
  const name = inp(), user = inp(), phone = inp({ placeholder: '+12395551234' });
  modal('Add user', (close) => { const box = h('div'); return h('form', { onsubmit: async (e) => { e.preventDefault(); try { const r = await POST(`/tenants/${id}/agents`, { name: name.value, username: user.value, phone_number: phone.value }); close(); showTempPassword(r.agent.name, r.temporary_password, 'Username: ' + r.agent.username); reload(); } catch (ex) { box.replaceChildren(errorBox(ex)); } } },
    box, field('Full name', name), field('Username', user, 'Lowercase letters, numbers, dots, dashes.'), field('Their Twilio number (optional)', phone),
    h('div', { class: 'row end' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Create user'))); });
}
function editUser(id, a, reload) {
  const name = inp({ value: a.name }), user = inp({ value: a.username }), phone = inp({ value: a.phone_number === 'TBD' ? '' : a.phone_number });
  modal('Edit user', (close) => { const box = h('div'); return h('form', { onsubmit: async (e) => { e.preventDefault(); try { await PATCH(`/tenants/${id}/agents/${a.id}`, { name: name.value, username: user.value, phone_number: phone.value }); close(); toast('User updated'); reload(); } catch (ex) { box.replaceChildren(errorBox(ex)); } } },
    box, field('Full name', name), field('Username', user), field('Twilio number', phone),
    h('div', { class: 'row end' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Save changes'))); });
}

// Features --------------------------------------------------------------------
async function featuresTab(id) {
  const s = await GET(`/tenants/${id}/settings`);
  const env = s.env_defaults;
  const unavailable = { zoho: !env.zoho_credentials && 'This deploy has no Zoho credentials', recording: !(env.recording_env && env.openai) && 'This deploy is missing ENABLE_RECORDING or an OpenAI key', ai_summaries: !env.openai && 'This deploy has no OpenAI key', voicemail_transcription: !env.openai && 'This deploy has no OpenAI key' };
  const seat = inp({ type: 'number', min: 1, value: s.settings.seat_limit ?? '', placeholder: 'Unlimited', style: 'width:11rem' });
  const rows = s.feature_keys.map(k => {
    const [label, help] = FEATURE_LABELS[k] || [k, ''];
    const on = s.settings.features[k] !== false;
    const cb = h('input', { type: 'checkbox', checked: on, onchange: async () => { cb.disabled = true; try { await PATCH(`/tenants/${id}/settings`, { features: { [k]: cb.checked } }); toast(`${label} turned ${cb.checked ? 'on' : 'off'}`); } catch (e) { cb.checked = !cb.checked; oops(e); } finally { cb.disabled = false; } } });
    return h('div', { class: 'toggle' }, h('div', h('div', { class: 't' }, label, unavailable[k] ? h('span', { class: 'pill grey', style: 'margin-left:.6rem' }, 'Not available') : null), h('div', { class: 'd' }, unavailable[k] || help)), h('label', { class: 'switch' }, cb, h('span')));
  });
  return h('div', { class: 'grid two' },
    h('div', { class: 'panel' }, h('h2', 'What this customer gets'), h('p', { class: 'muted' }, 'A switch takes effect on their deploy within 30 seconds — no redeploy. Switches can only turn something off; the deploy still needs the underlying credentials to turn it on.'), rows),
    h('div',
      h('div', { class: 'panel' }, h('h2', 'Seats'), h('p', { class: 'muted' }, 'The most users they can have active at once. Adding or reactivating a user past this is refused. Leave blank for unlimited.'),
        h('div', { class: 'row' }, field('Seat limit', seat, null, { inline: true }), h('button', { class: 'btn primary', onclick: async () => { try { await PATCH(`/tenants/${id}/settings`, { seat_limit: seat.value ? parseInt(seat.value, 10) : null }); toast('Seat limit saved'); } catch (e) { oops(e); } } }, 'Save'))),
      h('div', { class: 'panel' }, h('h2', 'In effect right now'), h('p', { class: 'muted' }, 'What the deploy actually resolves, after credentials are taken into account.'),
        Object.entries(s.resolved_features).map(([k, v]) => h('div', { style: 'padding:.3rem 0' }, h('span', { class: 'dot ' + (v ? 'on' : 'off') }), FEATURE_LABELS[k]?.[0] || k)))));
}

// Branding (batch 8 — brand sweep) --------------------------------------------
// What the customer's app shows for itself: product name, their company name,
// who they contact for help, and whether a wrap-up screen opens after calls
// (with which outcomes). All live on the deploy within 30 s, no redeploy.
async function brandingTab(id) {
  const s = await GET(`/tenants/${id}/settings`);
  const st = s.settings, env = s.env_defaults, eff = s.effective || {};
  const save = async (body, msg) => { try { await PATCH(`/tenants/${id}/settings`, body); toast(msg); customerView(id, 'branding'); } catch (e) { oops(e); } };
  const orNull = (el) => el.value.trim() || null;

  // Identity
  const brand   = inp({ value: st.brand_name || '', placeholder: env.brand_name || 'BTI Voice' });
  const company = inp({ value: st.company_name || '', placeholder: env.company_name || 'e.g. Collier Building Industry Association' });
  const sName   = inp({ value: st.support_name || '', placeholder: env.support_name || 'Business Technology Insight' });
  const sEmail  = inp({ type: 'email', value: st.support_email || '', placeholder: env.support_email || 'helpdesk@businesstechnologyinsight.com' });
  const sUrl    = inp({ type: 'url', value: st.support_url || '', placeholder: env.support_url || 'https://… (optional help page)' });
  const identity = h('div', { class: 'panel' }, h('h2', 'Identity'),
    h('p', { class: 'muted' }, 'Blank fields fall back to the deploy’s environment variables (shown greyed), then to BTI’s defaults.'),
    field('Product name', brand, 'The wordmark on the login screen, title bar, splash and About. Leave blank for "BTI Voice".'),
    field('Customer’s company name', company, 'Shown under the product name on the login screen.'),
    field('Support name', sName, 'Who the app says to contact: "Support by …", subscription notices, blocked-sign-in messages.'),
    field('Support email', sEmail, 'About → "Need help?" opens a new email to this address. Blank hides the link.'),
    field('Support web page', sUrl, 'Used for "Need help?" only when there is no support email.'),
    h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: () => save({ brand_name: orNull(brand), company_name: orNull(company), support_name: orNull(sName), support_email: orNull(sEmail), support_url: orNull(sUrl) }, 'Identity saved') }, 'Save identity')),
    h('p', { class: 'hint', style: 'margin-top:.9rem' }, `In effect right now: ${eff.brand || '—'} · ${eff.company || 'no company name'} · support ${eff.support?.name || '—'}${eff.support?.email ? ' (' + eff.support.email + ')' : ''}`));

  // Wrap-up after calls
  const wrapCb = h('input', { type: 'checkbox', checked: !!st.wrap_up_enabled, onchange: async () => { wrapCb.disabled = true; try { await PATCH(`/tenants/${id}/settings`, { wrap_up_enabled: wrapCb.checked }); toast(`Wrap-up turned ${wrapCb.checked ? 'on' : 'off'}`); } catch (e) { wrapCb.checked = !wrapCb.checked; oops(e); } finally { wrapCb.disabled = false; } } });
  const wrapRow = h('div', { class: 'toggle' }, h('div', h('div', { class: 't' }, 'Wrap-up screen after calls'), h('div', { class: 'd' }, 'After a connected call of 15 seconds or more, the app slides up a screen to pick the contact, choose an outcome and leave a note. Off = nothing interrupts the user (most customers). On = sales / call-list teams.')), h('label', { class: 'switch' }, wrapCb, h('span')));

  // Outcomes editor — rows of label + "expects a callback" checkbox
  let rows = (st.dispositions || []).map(d => ({ ...d }));
  const list = h('div');
  const draw = () => list.replaceChildren(...rows.map((d, i) => {
    const label = inp({ class: 'input bare', value: d.label, placeholder: 'Outcome label', maxlength: 40, style: 'flex:1', oninput: () => { d.label = label.value; } });
    const keep = h('input', { type: 'checkbox', checked: !!d.keep_open, onchange: () => { d.keep_open = keep.checked; } });
    return h('div', { class: 'row', style: 'margin-bottom:.55rem' }, label,
      h('label', { class: 'row', style: 'gap:.4rem;font-size:.88rem;white-space:nowrap;cursor:pointer' }, keep, 'expects a callback'),
      h('button', { class: 'btn sm danger', type: 'button', title: 'Remove', onclick: () => { rows.splice(i, 1); draw(); } }, '✕'));
  }), rows.length ? null : h('p', { class: 'muted' }, 'No outcomes — the wrap-up screen shows just the contact and a note.'));
  draw();
  const addBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => { rows.push({ label: '', keep_open: false }); draw(); list.querySelector('input[type=text]:last-of-type')?.focus(); } }, '+ Add outcome');
  const presets = h('button', { class: 'btn sm', type: 'button', title: 'Resolved · Follow-up needed · Left voicemail · Wrong number · Other', onclick: () => { if (rows.length && !confirm('Replace the current outcomes with the starter set?')) return; rows = [['Resolved', false], ['Follow-up needed', true], ['Left voicemail', true], ['Wrong number', false], ['Other', false]].map(([label, keep_open]) => ({ label, keep_open })); draw(); } }, 'Use starter set');
  const saveOutcomes = h('button', { class: 'btn primary', type: 'button', onclick: () => save({ dispositions: rows.filter(r => r.label.trim()).map(r => ({ code: r.code, label: r.label.trim(), keep_open: !!r.keep_open })) }, 'Outcomes saved') }, 'Save outcomes');
  const wrap = h('div', { class: 'panel' }, h('h2', 'Wrap-up after calls'), wrapRow,
    h('h3', { style: 'margin:1.4rem 0 .3rem' }, 'Outcomes'),
    h('p', { class: 'muted' }, 'The buttons on the wrap-up screen. "Expects a callback" keeps a call-list entry on the list and asks for a call-back date; any other outcome closes it. Renaming keeps the history of old calls intact; removing one only hides the button.'),
    list, h('div', { class: 'row', style: 'margin-top:.6rem' }, addBtn, presets), h('div', { class: 'row end', style: 'margin-top:1rem' }, saveOutcomes));

  return h('div', { class: 'grid two' }, identity, wrap);
}

// Billing ---------------------------------------------------------------------
async function billingTab(id, reg) {
  const s = await GET(`/tenants/${id}/settings`);
  const a = s.account;
  const date = inp({ type: 'date', value: fmtISO(s.settings.enabled_through) });
  const grace = inp({ type: 'number', min: 0, max: 365, value: s.settings.grace_days, style: 'width:8rem' });
  const notes = h('textarea', s.settings.notes || '');
  const plan = inp({ value: reg.plan || '', placeholder: 'Pilot · $35 per user' });
  const save = async (body, msg) => { try { await PATCH(`/tenants/${id}/settings`, body); toast(msg); customerView(id, 'billing'); } catch (e) { oops(e); } };
  const extend = (days) => async () => { try { const r = await POST(`/tenants/${id}/settings/extend`, { days }); toast(`Extended to ${fmtDate(r.enabled_through)}`); customerView(id, 'billing'); } catch (e) { oops(e); } };
  return h('div', { class: 'grid two' },
    h('div',
      h('div', { class: 'panel' }, h('h2', 'Subscription'),
        h('div', { class: 'row', style: 'margin-bottom:1.1rem' }, pill(pillFor(a)), a.message ? h('span', { class: 'muted' }, a.message) : null),
        h('div', { class: 'row' }, field('Enabled through', date, null, { inline: true }), h('button', { class: 'btn primary', onclick: () => save({ enabled_through: date.value || null }, 'Renewal date saved') }, 'Save'), h('button', { class: 'btn link', onclick: () => save({ enabled_through: null }, 'Expiry removed') }, 'Remove expiry')),
        h('p', { class: 'hint', style: 'margin:.5rem 0 1.1rem' }, a.enabled_through ? `Grace ends ${fmtDate(a.grace_ends)}. Sign-in is blocked from ${fmtDate(a.blocked_from)}.` : 'No renewal date, so this account never lapses.'),
        h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Extend by'), h('button', { class: 'btn sm', onclick: extend(30) }, '30 days'), h('button', { class: 'btn sm', onclick: extend(90) }, '90 days'), h('button', { class: 'btn sm', onclick: extend(365) }, '1 year')),
        h('p', { class: 'hint', style: 'margin-top:.5rem' }, 'Counts from the current date if it\'s still ahead, otherwise from today. Also lifts a suspension.'),
        h('h3', 'Grace period'),
        h('div', { class: 'row' }, field('Days', grace, null, { inline: true }), h('button', { class: 'btn', onclick: () => save({ grace_days: parseInt(grace.value, 10) }, 'Grace period saved') }, 'Save'))),
      h('div', { class: 'panel' }, h('h2', 'Suspension'),
        s.settings.suspended
          ? h('div', h('div', { class: 'alert error' }, 'This account is suspended. Nobody can sign in.'), h('button', { class: 'btn primary', onclick: () => save({ suspended: false }, 'Suspension lifted') }, 'Lift suspension'))
          : h('div', h('p', { class: 'muted' }, 'Blocks every sign-in immediately. Nothing is deleted, and you can lift it any time.'), h('button', { class: 'btn danger', onclick: async () => { if (await confirmModal('Suspend account', `Suspend ${reg.name} now? All their users are signed out until you lift it.`, { danger: true, okLabel: 'Suspend' })) save({ suspended: true }, 'Account suspended'); } }, 'Suspend account')))),
    h('div',
      h('div', { class: 'panel' }, h('h2', 'Plan and notes'),
        h('div', { class: 'row', style: 'margin-bottom:1rem' }, field('Plan', plan, null, { inline: true, style: 'flex:1' }), h('button', { class: 'btn', onclick: async () => { try { await PATCH(`/tenants/${id}`, { plan: plan.value }); toast('Plan saved'); S.customers = null; } catch (e) { oops(e); } } }, 'Save')),
        field('Billing notes', notes, 'Invoice numbers, billing contact, anything BTI-internal. Stored on the deploy.'),
        h('button', { class: 'btn', onclick: () => save({ notes: notes.value }, 'Notes saved') }, 'Save notes')),
      h('div', { class: 'panel explain' }, h('h2', 'What happens as a subscription lapses'),
        h('p', h('b', '14 days before'), h('span', 'Their users see a renewal banner.')),
        h('p', h('b', `Grace, ${s.settings.grace_days} days`), h('span', 'Banner for everyone; the app works fully.')),
        h('p', h('b', 'After grace'), h('span', 'Outgoing calls and texts pause. Incoming calls still ring and are logged. Sign-in still works.')),
        h('p', h('b', 'Grace + 30 days'), h('span', 'Sign-in blocked with a "contact BTI" screen. Nothing is ever deleted.')),
        h('p', { class: 'hint', style: 'display:block;margin-top:.6rem' }, 'Extending the date or lifting a suspension takes effect within 30 seconds.'))));
}

// Health ----------------------------------------------------------------------
async function healthTab(id) {
  const hh = await GET(`/tenants/${id}/health`);
  const yn = (v, t) => [h('span', { class: 'dot ' + (v ? 'on' : 'off') }), t || (v ? 'Yes' : 'No')];
  const kv = (rows) => h('table', { class: 'kv' }, h('tbody', rows.map(([k, v]) => h('tr', h('th', k), h('td', v)))));
  return h('div', { class: 'grid two' },
    h('div', { class: 'panel' }, h('h2', 'Deploy'), kv([
      ['Server version', hh.versions.server], ['Latest desktop app', hh.versions.desktop_latest || '—'], ['Node', hh.versions.node],
      ['Up for', Math.round(hh.uptime_seconds / 3600) + ' hours'], ['Company / brand', `${hh.brand?.company_name || '—'} / ${hh.brand?.brand_name || '—'}`],
      ['Database size', fmtBytes(hh.db.bytes)], ['Users', `${hh.db.active_agents} active of ${hh.db.total_agents}`],
      ['Last call', fmtDT(hh.db.last_call_at)], ['Last text', fmtDT(hh.db.last_message_at)], ['Last sign-in', fmtDT(hh.db.last_login_at)],
      ['Last Twilio voice webhook', fmtDT(hh.last_seen?.voice)], ['Last Twilio text webhook', fmtDT(hh.last_seen?.sms)]]),
      h('div', { style: 'margin-top:1rem' }, h('button', { class: 'btn', onclick: async () => { try { const r = await POST(`/tenants/${id}/test`); r.ok ? toast('Reachable') : toast(r.error, 'error'); } catch (e) { oops(e); } } }, 'Test connection'))),
    h('div',
      h('div', { class: 'panel' }, h('h2', 'Integrations on this deploy'), kv([
        ['Twilio', yn(hh.env.twilio_configured)], ['Voice (API key + TwiML app)', yn(hh.env.voice_configured)], ['Messaging service', yn(hh.env.messaging_service)],
        ['OpenAI', yn(hh.env.openai)], ['Zoho credentials', yn(hh.env.zoho_credentials)], ['Default number', hh.env.default_number || '—'], ['Server address', h('span', { class: 'mono' }, host(hh.env.server_url) || '—')]])),
      h('div', { class: 'panel' }, h('h2', 'Phone numbers'),
        hh.numbers.routing.length ? h('table', h('thead', h('tr', h('th', 'Number'), h('th', 'Label'), h('th', 'Routes to'), h('th', 'Active'))), h('tbody', hh.numbers.routing.map(n => h('tr', h('td', { class: 'mono' }, n.phone_number), h('td', n.label || ''), h('td', n.destination_type), h('td', yn(n.is_active)))))) : h('p', { class: 'muted' }, 'No routing rules.'),
        hh.numbers.agents.length ? h('p', { style: 'margin-top:.8rem' }, h('b', 'User numbers: '), hh.numbers.agents.map(a => `${a.name} ${a.phone_number}`).join(', ')) : null)));
}

// Log -------------------------------------------------------------------------
const ACTION_LABELS = { login: 'Signed in', change_password: 'Changed portal password', user_create: 'Added portal user', user_update: 'Updated portal user', tenant_create: 'Registered customer', tenant_update: 'Edited customer record', settings_patch: 'Changed settings', settings_extend: 'Extended subscription', usage_export: 'Exported usage CSV', agent_create: 'Added user', agent_update: 'Updated user' };
async function logTab(id) {
  const d = await GET(`/tenants/${id}/audit`);
  return h('div', { class: 'panel' }, h('h2', 'Portal activity for this customer'),
    d.audit.length ? h('div', { class: 'tablewrap' }, h('table', h('thead', h('tr', h('th', 'When'), h('th', 'Who'), h('th', 'What'), h('th', 'Details'))),
      h('tbody', d.audit.map(r => h('tr', h('td', fmtDT(r.created_at)), h('td', r.username), h('td', ACTION_LABELS[r.action] || r.action), h('td', { class: 'mono muted' }, r.detail ? JSON.stringify(r.detail) : '')))))) : h('p', { class: 'muted' }, 'Nothing yet.'));
}

// Setup -----------------------------------------------------------------------
async function setupTab(id, reg) {
  const name = inp({ value: reg.name }), url = inp({ type: 'url', value: reg.url }), key = inp({ type: 'password', autocomplete: 'off', placeholder: `Leave blank to keep the current key (${reg.key_hint})` }), notes = h('textarea', reg.notes || '');
  const save = async () => { try { const body = { name: name.value, url: url.value, notes: notes.value }; if (key.value) body.key = key.value; await PATCH(`/tenants/${id}`, body); toast('Saved'); S.customers = null; customerView(id, 'setup'); } catch (e) { oops(e); } };
  return h('div', { class: 'grid two' },
    h('div', { class: 'panel' }, h('h2', 'Customer record'),
      field('Customer name', name), field('Deploy address', url), field('Admin key', key, 'Only needed if you rotated TENANT_ADMIN_KEY on the deploy.'), field('Portal notes', notes),
      h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: save }, 'Save changes'))),
    h('div', { class: 'panel' }, h('h2', reg.is_active ? 'Archive' : 'Archived'),
      reg.is_active
        ? h('div', h('p', { class: 'muted' }, 'Hides this customer from the dashboard and sidebar. Their deploy is untouched, and you can bring them back any time.'), h('button', { class: 'btn danger', onclick: async () => { if (await confirmModal('Archive customer', `Archive ${reg.name}? Their deploy keeps running; this only hides them here.`, { okLabel: 'Archive' })) { try { await PATCH(`/tenants/${id}`, { is_active: false }); S.customers = null; toast('Archived'); location.hash = '#/'; } catch (e) { oops(e); } } } }, 'Archive customer'))
        : h('div', h('p', { class: 'muted' }, 'This customer is hidden from the dashboard.'), h('button', { class: 'btn primary', onclick: async () => { try { await PATCH(`/tenants/${id}`, { is_active: true }); S.customers = null; toast('Restored'); customerView(id, 'setup'); } catch (e) { oops(e); } } }, 'Restore customer'))));
}

// ── portal users ─────────────────────────────────────────────────────────────
async function portalUsersView() {
  await loadCustomers().catch(() => {});
  render(frame({ active: 'users', title: 'Portal users' }, loading('users')));
  let d; try { d = await GET('/users'); } catch (e) { return render(frame({ active: 'users', title: 'Portal users' }, errorBox(e))); }
  const act = async (u, body, msg) => { try { const r = await PATCH(`/users/${u.id}`, body); if (r.temporary_password) showTempPassword(r.user.name, r.temporary_password); else toast(msg); portalUsersView(); } catch (e) { oops(e); } };
  const add = () => { const name = inp(), user = inp(); modal('Add portal user', (close) => { const box = h('div'); return h('form', { onsubmit: async (e) => { e.preventDefault(); try { const r = await POST('/users', { name: name.value, username: user.value }); close(); showTempPassword(r.user.name, r.temporary_password, 'Username: ' + r.user.username); portalUsersView(); } catch (ex) { box.replaceChildren(errorBox(ex)); } } }, box, field('Name', name), field('Username', user), h('div', { class: 'row end' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Create user'))); }); };
  render(frame({ active: 'users', title: 'Portal users', sub: 'Who can sign in here. Everyone has the same full access.', actions: h('button', { class: 'btn primary', onclick: add }, svg(I.add), 'Add portal user') },
    h('div', { class: 'panel' }, h('div', { class: 'tablewrap' }, h('table', h('thead', h('tr', h('th', 'Name'), h('th', 'Username'), h('th', 'Status'), h('th', 'Last sign-in'), h('th'))),
      h('tbody', d.users.map(u => h('tr', h('td', h('b', u.name), u.id === S.user.id ? h('span', { class: 'muted' }, ' (you)') : null), h('td', { class: 'mono' }, u.username),
        h('td', u.is_active ? (u.must_change_password ? h('span', { class: 'pill amber' }, 'Temporary password') : h('span', { class: 'pill green' }, 'Active')) : h('span', { class: 'pill grey' }, 'Deactivated')),
        h('td', u.last_login_at ? fmtDT(u.last_login_at) : h('span', { class: 'muted' }, 'Never')),
        h('td', { class: 'row end', style: 'flex-wrap:nowrap' },
          h('button', { class: 'btn sm', onclick: async () => { if (await confirmModal('Reset password', `Reset ${u.name}'s portal password?`, { okLabel: 'Reset password' })) act(u, { reset_password: true }); } }, 'Reset password'),
          u.id !== S.user.id ? (u.is_active ? h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmModal('Deactivate', `Remove ${u.name}'s portal access?`, { danger: true, okLabel: 'Deactivate' })) act(u, { is_active: false }, 'Deactivated'); } }, 'Deactivate') : h('button', { class: 'btn sm', onclick: () => act(u, { is_active: true }, 'Reactivated') }, 'Reactivate')) : null)))))))));
}

// ── router ───────────────────────────────────────────────────────────────────
async function route() {
  if (!S.token) return loginView();
  if (!S.user) { try { S.user = (await GET('/auth/me')).user; } catch { return; } }
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (S.user.must_change_password && parts[0] !== 'password') { location.hash = '#/password'; return; }
  if (parts[0] === 'password') { await loadCustomers().catch(() => {}); return passwordView(); }
  if (parts[0] === 'add') return addView();
  if (parts[0] === 'users') return portalUsersView();
  if ((parts[0] === 'c' || parts[0] === 't') && parts[1]) return customerView(parseInt(parts[1], 10), parts[2]);
  return dashboardView();
}
window.addEventListener('hashchange', route);
route();
})();
