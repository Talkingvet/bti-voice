/* BTI Voice Admin portal — no build step, no framework.
   Hash routes:  #/  #/add  #/t/:id/:tab  #/users  #/password                     */
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

// ── state / api ──────────────────────────────────────────────────────────────
const S = { token: localStorage.getItem('bti_admin_token') || null, user: null };
function setToken(t) { S.token = t; t ? localStorage.setItem('bti_admin_token', t) : localStorage.removeItem('bti_admin_token'); }

async function api(method, path, body) {
  const r = await fetch('/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  if (r.status === 401 && S.token && !path.startsWith('/auth/login')) { setToken(null); S.user = null; route(); throw new Error(data?.error || 'Session expired'); }
  if (r.status === 403 && data?.code === 'must_change_password') { location.hash = '#/password'; throw new Error(data.error); }
  if (!r.ok) { const e = new Error(data?.error || `Request failed (${r.status})`); e.data = data; e.status = r.status; throw e; }
  return data;
}
const GET = (p) => api('GET', p), POST = (p, b) => api('POST', p, b), PATCH = (p, b) => api('PATCH', p, b);

// ── toasts / modals ──────────────────────────────────────────────────────────
const $toasts = h('div', { id: 'toasts' }); document.body.append($toasts);
function toast(msg, kind) {
  const t = h('div', { class: 'toast ' + (kind || '') }, msg); $toasts.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 7000 : 3500);
}
const oops = (e) => toast(e.message || String(e), 'error');
function modal(title, body, { onClose } = {}) {
  const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) close(); } });
  const close = () => { bg.remove(); onClose && onClose(); };
  bg.append(h('div', { class: 'modal' }, h('h2', title), body(close)));
  document.body.append(bg);
  return close;
}
function confirmModal(title, text, { danger, okLabel = 'Confirm' } = {}) {
  return new Promise((resolve) => {
    modal(title, (close) => h('div', h('p', text),
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => { close(); resolve(false); } }, 'Cancel'),
        h('button', { class: 'btn primary' + (danger ? ' danger' : ''), onclick: () => { close(); resolve(true); } }, okLabel))),
      { onClose: () => resolve(false) });
  });
}
function showTempPassword(who, password, extra) {
  modal('Temporary password', (close) => h('div',
    h('p', `Give this to ${who}. It is shown once and they must change it on first login.`),
    h('div', { class: 'secret' }, h('span', password),
      h('button', { class: 'btn sm', onclick: () => navigator.clipboard?.writeText(password).then(() => toast('Copied')) }, 'Copy')),
    extra ? h('p', { class: 'muted small', style: 'margin-top:10px' }, extra) : null,
    h('div', { class: 'row end', style: 'margin-top:14px' }, h('button', { class: 'btn primary', onclick: close }, 'Done'))));
}

// ── formatting ───────────────────────────────────────────────────────────────
const fmtN = (n) => (n == null ? '—' : Number(n).toLocaleString());
// Date-only strings (YYYY-MM-DD) are parsed as LOCAL dates — new Date('2026-12-31')
// would be UTC midnight and show as Dec 30 anywhere west of Greenwich.
const parseDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? new Date(...String(d).split('-').map((n, i) => +n - (i === 1 ? 1 : 0))) : new Date(d));
const fmtDate = (d) => (d ? parseDate(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const fmtDT = (d) => (d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const fmtISO = (d) => (d ? String(d).slice(0, 10) : '');
const fmtBytes = (b) => { if (b == null) return '—'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; b = Number(b); while (b >= 1024 && i < 3) { b /= 1024; i++; } return b.toFixed(i ? 1 : 0) + ' ' + u[i]; };
const ago = (d) => { if (!d) return 'never'; const s = (Date.now() - new Date(d)) / 1000; if (s < 90) return 'just now'; if (s < 5400) return Math.round(s / 60) + ' min ago'; if (s < 172800) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' days ago'; };
const pill = (p) => h('span', { class: 'pill ' + p.tone }, p.label);
const todayISO = () => new Date().toISOString().slice(0, 10);

const FEATURE_LABELS = {
  zoho: ['Zoho CRM integration', 'Requires Zoho credentials on the deploy. Off = no CRM UI anywhere in the app.'],
  recording: ['Call recording', 'Also needs ENABLE_RECORDING + OpenAI key on the deploy. Off = no recording, no disclosure.'],
  ai_summaries: ['AI call summaries', 'Transcript is still kept when off.'],
  sms: ['Text messaging (SMS/MMS)', 'Off = every outbound text is refused; inbound still arrives.'],
  voicemail_transcription: ['Voicemail transcription', 'Audio is still saved when off.'],
  mobile_apps: ['iPhone / Android apps', 'Off = mobile logins are refused; desktop and browser still work.'],
};

// ── shell ────────────────────────────────────────────────────────────────────
function shell(active, ...content) {
  const nav = (href, label, key) => h('a', { href, class: active === key ? 'on' : '' }, label);
  return [
    h('div', { class: 'topbar' },
      h('a', { href: '#/', class: 'logo' }, h('b', 'B'), 'BTI Voice Admin'),
      h('nav', nav('#/', 'Dashboard', 'dash'), nav('#/add', '+ Add tenant', 'add'), nav('#/users', 'Portal users', 'users')),
      h('div', { class: 'spacer' }),
      h('span', { class: 'muted small' }, S.user?.name),
      h('a', { href: '#/password', class: 'small' }, 'Password'),
      h('button', { class: 'btn sm', onclick: () => { setToken(null); S.user = null; route(); } }, 'Sign out')),
    h('div', { class: 'page' }, ...content),
  ];
}
const loading = (what) => h('div', { class: 'empty' }, `Loading ${what || ''}…`);
const errorBox = (e) => h('div', { class: 'alert error' }, e.message || String(e));

// ── login / password ─────────────────────────────────────────────────────────
function loginView() {
  const u = h('input', { type: 'text', autocomplete: 'username', autofocus: true });
  const p = h('input', { type: 'password', autocomplete: 'current-password' });
  const err = h('div');
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.replaceChildren();
    try { const r = await POST('/auth/login', { username: u.value, password: p.value }); setToken(r.token); S.user = r.user; location.hash = r.user.must_change_password ? '#/password' : '#/'; route(); }
    catch (ex) { err.replaceChildren(errorBox(ex)); }
  } },
    h('div', { class: 'logo', style: 'display:flex;gap:10px;align-items:center;font-weight:700;margin-bottom:16px' }, h('b', { style: 'display:inline-grid;place-items:center;width:32px;height:32px;border-radius:8px;background:var(--brand);color:var(--brand-ink)' }, 'B'), 'BTI Voice Admin'),
    err,
    h('div', { class: 'field' }, h('label', 'Username'), u),
    h('div', { class: 'field' }, h('label', 'Password'), p),
    h('button', { class: 'btn primary', type: 'submit', style: 'width:100%' }, 'Sign in'),
    h('p', { class: 'muted small', style: 'margin-top:14px' }, 'BTI staff only. Every action here is logged.'));
  render(h('div', { class: 'login' }, h('div', { class: 'panel' }, form)));
}

function passwordView() {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const nw = h('input', { type: 'password', autocomplete: 'new-password' });
  const nw2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const box = h('div');
  const forced = S.user?.must_change_password;
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); box.replaceChildren();
    if (nw.value !== nw2.value) return box.replaceChildren(h('div', { class: 'alert error' }, 'New passwords do not match'));
    try { await POST('/auth/change-password', { current_password: cur.value, new_password: nw.value }); S.user.must_change_password = false; toast('Password changed'); location.hash = '#/'; }
    catch (ex) { box.replaceChildren(errorBox(ex)); }
  } },
    forced ? h('div', { class: 'alert warn' }, 'You are using a temporary password. Choose a new one to continue.') : null,
    box,
    h('div', { class: 'field' }, h('label', 'Current password'), cur),
    h('div', { class: 'field' }, h('label', 'New password'), nw, h('span', { class: 'hint' }, 'At least 10 characters.')),
    h('div', { class: 'field' }, h('label', 'Confirm new password'), nw2),
    h('button', { class: 'btn primary', type: 'submit' }, 'Change password'));
  render(shell('pw', h('div', { class: 'head' }, h('h1', 'Change password')), h('div', { class: 'panel', style: 'max-width:440px' }, form)));
}

// ── dashboard ────────────────────────────────────────────────────────────────
async function dashboardView() {
  render(shell('dash', h('div', { class: 'head' }, h('h1', 'Customers')), loading('all tenants')));
  let d; try { d = await GET('/dashboard'); } catch (e) { return render(shell('dash', errorBox(e))); }
  const rows = [...d.tenants].sort((a, b) => a.pill.rank - b.pill.rank || a.name.localeCompare(b.name));
  const sum = (k) => rows.reduce((n, t) => n + (t.usage?.totals?.[k] || 0), 0);
  const month = rows.find(t => t.usage)?.usage;
  const table = rows.length ? h('div', { class: 'tablewrap' }, h('table',
    h('thead', h('tr', h('th', 'Customer'), h('th', 'Status'), h('th', 'Renews'), h('th', { class: 'num' }, 'Users'), h('th', { class: 'num' }, 'Calls'), h('th', { class: 'num' }, 'Minutes'), h('th', { class: 'num' }, 'Texts'), h('th', { class: 'num' }, 'AI min'), h('th', 'Features off'))),
    h('tbody', rows.map(t => {
      const u = t.usage?.totals, c = t.usage?.counts;
      const off = t.features ? Object.entries(t.features).filter(([k, v]) => FEATURE_LABELS[k] && !v).map(([k]) => FEATURE_LABELS[k][0].split(' ')[0]) : [];
      return h('tr', { class: 'click', onclick: () => location.hash = `#/t/${t.id}/usage` },
        h('td', h('div', { style: 'font-weight:600' }, t.name), h('div', { class: 'muted small' }, t.company_name && t.company_name !== t.name ? t.company_name : t.url.replace(/^https?:\/\//, ''))),
        h('td', pill(t.pill), t.error ? h('div', { class: 'small', style: 'color:var(--red);max-width:260px' }, t.error) : null),
        h('td', t.account?.enabled_through ? fmtDate(t.account.enabled_through) : h('span', { class: 'muted' }, 'no expiry')),
        h('td', { class: 'num' }, c ? `${c.active_agents}${c.seat_limit ? ' / ' + c.seat_limit : ''}` : '—'),
        h('td', { class: 'num' }, u ? fmtN(u.calls_in + u.calls_out) : '—'),
        h('td', { class: 'num' }, u ? fmtN(u.call_minutes_in + u.call_minutes_out) : '—'),
        h('td', { class: 'num' }, u ? fmtN(u.sms_in + u.sms_out) : '—'),
        h('td', { class: 'num' }, u ? fmtN(u.recorded_minutes) : '—'),
        h('td', { class: 'small muted' }, off.length ? off.join(', ') : (t.features ? 'all on' : '—')));
    })))) : h('div', { class: 'empty' }, 'No tenants yet. ', h('a', { href: '#/add' }, 'Add the first one'), ' — start with BTI\'s own deploy.');
  render(shell('dash',
    h('div', { class: 'head' }, h('div', h('h1', 'Customers'), h('p', { class: 'muted' }, month ? `Usage is month-to-date (${fmtDate(month.from)} – ${fmtDate(month.to)}), pulled live from each deploy.` : 'Pulled live from each deploy.')),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: dashboardView }, 'Refresh'), h('a', { class: 'btn primary', href: '#/add' }, '+ Add tenant'))),
    rows.length ? h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'v' }, rows.length), h('div', { class: 'l' }, 'active tenants')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, rows.filter(t => t.pill.key !== 'active').length), h('div', { class: 'l' }, 'need attention')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, fmtN(sum('calls_in') + sum('calls_out'))), h('div', { class: 'l' }, 'calls this month')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, fmtN(sum('call_minutes_in') + sum('call_minutes_out'))), h('div', { class: 'l' }, 'call minutes')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, fmtN(sum('sms_in') + sum('sms_out'))), h('div', { class: 'l' }, 'texts')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, fmtN(sum('recorded_minutes'))), h('div', { class: 'l' }, 'AI / recorded min'))) : null,
    h('div', { class: 'panel' }, table),
    d.inactive.length ? h('p', { class: 'muted small' }, 'Archived: ', d.inactive.map((t, i) => [i ? ', ' : '', h('a', { href: `#/t/${t.id}/setup` }, t.name)])) : null));
}

// ── add tenant ───────────────────────────────────────────────────────────────
function addTenantView() {
  const f = { name: h('input', { type: 'text', placeholder: 'Acme Plumbing' }), url: h('input', { type: 'url', placeholder: 'https://acme-voice.up.railway.app' }),
    key: h('input', { type: 'password', placeholder: 'TENANT_ADMIN_KEY from that deploy\'s Railway variables', autocomplete: 'off' }),
    plan: h('input', { type: 'text', placeholder: 'e.g. Pilot · $35/user' }), notes: h('textarea', { placeholder: 'Contact, invoice cadence, anything BTI-internal' }), force: h('input', { type: 'checkbox' }) };
  const box = h('div'); const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Verify & add');
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); box.replaceChildren(); btn.disabled = true;
    try {
      const r = await POST('/tenants', { name: f.name.value, url: f.url.value, key: f.key.value, plan: f.plan.value, notes: f.notes.value, force: f.force.checked });
      toast(r.verified ? 'Tenant added and verified' : 'Tenant saved (not verified)'); location.hash = `#/t/${r.tenant.id}/features`;
    } catch (ex) { box.replaceChildren(errorBox(ex)); if (ex.data?.code === 'verify_failed') box.append(h('div', { class: 'alert warn' }, ex.data.hint)); }
    finally { btn.disabled = false; }
  } },
    box,
    h('div', { class: 'field' }, h('label', 'Customer name'), f.name),
    h('div', { class: 'field' }, h('label', 'Deploy URL'), f.url, h('span', { class: 'hint' }, 'The Railway public URL of that customer\'s BTI Voice service.')),
    h('div', { class: 'field' }, h('label', 'Tenant admin key'), f.key, h('span', { class: 'hint' }, 'Stored encrypted. Only the last 4 characters are ever shown again.')),
    h('div', { class: 'field' }, h('label', 'Plan (optional)'), f.plan),
    h('div', { class: 'field' }, h('label', 'Internal notes (optional)'), f.notes),
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('label', { class: 'small muted' }, f.force, ' Save even if the deploy can\'t be reached right now'), btn));
  render(shell('add', h('div', { class: 'head' }, h('div', h('h1', 'Add tenant'), h('p', { class: 'muted' }, 'Registers a customer deploy. Nothing about the customer is stored here except this row — settings live on their deploy.'))),
    h('div', { class: 'panel', style: 'max-width:600px' }, form),
    h('div', { class: 'panel small muted', style: 'max-width:600px' }, h('b', 'Before this step: '), 'the customer\'s Railway service must have ', h('code', 'TENANT_ADMIN_KEY'), ' set (see DEPLOY-RUNBOOK). Paste the same value here.')));
}

// ── tenant page ──────────────────────────────────────────────────────────────
const TABS = [['usage', 'Usage'], ['users', 'Users'], ['features', 'Features'], ['billing', 'Billing'], ['health', 'Health'], ['log', 'Activity log'], ['setup', 'Setup']];

async function tenantView(id, tab) {
  tab = TABS.some(t => t[0] === tab) ? tab : 'usage';
  render(shell(null, loading('tenant')));
  let reg; try { reg = (await GET('/tenants')).tenants.find(t => t.id === id); } catch (e) { return render(shell(null, errorBox(e))); }
  if (!reg) return render(shell(null, errorBox(new Error('Tenant not found'))));
  const body = h('div');
  const head = h('div', { class: 'head' },
    h('div', h('a', { href: '#/', class: 'small' }, '← All customers'), h('h1', reg.name, !reg.is_active ? h('span', { class: 'pill grey', style: 'margin-left:10px' }, 'Archived') : null),
      h('p', { class: 'muted small' }, h('a', { href: reg.url, target: '_blank', rel: 'noopener' }, reg.url), reg.plan ? ` · ${reg.plan}` : '', reg.last_ok_at ? ` · last reached ${ago(reg.last_ok_at)}` : '')),
    reg.last_error ? h('div', { class: 'alert error', style: 'margin:0' }, reg.last_error) : null);
  const tabs = h('div', { class: 'tabs' }, TABS.map(([k, l]) => h('a', { href: `#/t/${id}/${k}`, class: k === tab ? 'on' : '' }, l)));
  render(shell(null, head, tabs, body));
  const views = { usage: usageTab, users: usersTab, features: featuresTab, billing: billingTab, health: healthTab, log: logTab, setup: setupTab };
  body.append(loading());
  try { body.replaceChildren(await views[tab](id, reg)); } catch (e) { body.replaceChildren(errorBox(e)); }
}

// Usage ----------------------------------------------------------------------
async function usageTab(id) {
  const t = todayISO();
  const from = h('input', { type: 'date', value: t.slice(0, 8) + '01' }), to = h('input', { type: 'date', value: t });
  const agentSel = h('select', h('option', { value: '' }, 'All users'));
  const out = h('div');
  const preset = (label, f, tt) => h('button', { class: 'btn sm', onclick: () => { from.value = f; to.value = tt; load(); } }, label);
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const lastFrom = iso(new Date(y, m - 1, 1)), lastTo = iso(new Date(y, m, 0));
  async function load() {
    out.replaceChildren(loading('usage'));
    try {
      const u = await GET(`/tenants/${id}/usage?from=${from.value}&to=${to.value}${agentSel.value ? '&agent_id=' + agentSel.value : ''}`);
      if (agentSel.options.length === 1) for (const a of u.agents) agentSel.append(h('option', { value: a.agent_id }, a.name));
      const T = agentSel.value ? u.agents[0] || {} : u.totals;
      const tiles = [['Calls in', T.calls_in], ['Calls out', T.calls_out], ['Inbound min', T.call_minutes_in], ['Outbound min', T.call_minutes_out], ['Missed', T.missed_calls], ['Voicemails', T.voicemails],
        ['Texts in', T.sms_in], ['Texts out', T.sms_out], ['MMS', T.mms], ['Recordings', T.recordings], ['Recorded min', T.recorded_minutes], ['Transcriptions', T.transcriptions], ['AI summaries', T.ai_summaries]];
      const cols = [['calls_in', 'In'], ['calls_out', 'Out'], ['call_minutes_in', 'Min in'], ['call_minutes_out', 'Min out'], ['missed_calls', 'Missed'], ['voicemails', 'VM'], ['sms_in', 'SMS in'], ['sms_out', 'SMS out'], ['recorded_minutes', 'Rec min'], ['ai_summaries', 'AI']];
      out.replaceChildren(
        h('div', { class: 'stats' }, tiles.map(([l, v]) => h('div', { class: 'stat' }, h('div', { class: 'v' }, fmtN(v)), h('div', { class: 'l' }, l)))),
        h('div', { class: 'row small muted', style: 'margin-bottom:12px' }, `Active users: ${u.counts.active_agents}${u.counts.seat_limit ? ' of ' + u.counts.seat_limit + ' seats' : ' (no seat limit)'} · logged in this period: ${u.counts.agents_logged_in_period} · contacts: ${fmtN(u.counts.contacts)} · conversations: ${fmtN(u.counts.conversations)} · storage: ${fmtBytes(u.storage.db_bytes + u.storage.media_bytes)}`),
        h('div', { class: 'tablewrap' }, h('table',
          h('thead', h('tr', h('th', 'User'), h('th', 'Last login'), cols.map(c => h('th', { class: 'num' }, c[1])))),
          h('tbody', u.agents.map(a => h('tr', h('td', h('span', { class: 'dot ' + (a.is_active ? 'on' : 'off') }), a.name, h('span', { class: 'muted small' }, ' ', a.username)), h('td', { class: 'small' }, a.last_login_at ? fmtDT(a.last_login_at) : h('span', { class: 'muted' }, 'never')), cols.map(c => h('td', { class: 'num' }, fmtN(a[c[0]]))))),
            !agentSel.value && Object.values(u.totals.unattributed).some(v => v) ? h('tr', h('td', { class: 'muted' }, 'Unattributed', h('div', { class: 'small' }, 'inbound to numbers no user owns')), h('td'), cols.map(c => h('td', { class: 'num muted' }, fmtN(u.totals.unattributed[c[0]])))) : null,
            !agentSel.value ? h('tr', { class: 'total' }, h('td', 'Total'), h('td'), cols.map(c => h('td', { class: 'num' }, fmtN(u.totals[c[0]])))) : null))));
    } catch (e) { out.replaceChildren(errorBox(e)); }
  }
  async function exportCsv() {
    try {
      const r = await fetch(`/api/tenants/${id}/usage.csv?from=${from.value}&to=${to.value}`, { headers: { Authorization: 'Bearer ' + S.token } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Export failed');
      const blob = await r.blob(); const a = h('a', { href: URL.createObjectURL(blob), download: (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'usage.csv' });
      document.body.append(a); a.click(); a.remove(); toast('CSV downloaded');
    } catch (e) { oops(e); }
  }
  load();
  return h('div', { class: 'panel' },
    h('div', { class: 'row', style: 'margin-bottom:14px' }, from, h('span', { class: 'muted' }, 'to'), to, agentSel, h('button', { class: 'btn', onclick: load }, 'Apply'),
      h('span', { style: 'width:8px' }), preset('This month', t.slice(0, 8) + '01', t), preset('Last month', lastFrom, lastTo),
      h('div', { class: 'spacer', style: 'flex:1' }), h('button', { class: 'btn', onclick: exportCsv }, '⬇ Export CSV')),
    out);
}

// Users -----------------------------------------------------------------------
async function usersTab(id) {
  const wrap = h('div');
  async function load() {
    wrap.replaceChildren(loading('users'));
    try {
      const d = await GET(`/tenants/${id}/agents`);
      const seatNote = d.seat_limit ? `${d.active} of ${d.seat_limit} seats used` : `${d.active} active users · no seat limit`;
      const act = async (a, body, msg) => { try { const r = await PATCH(`/tenants/${id}/agents/${a.id}`, body); if (r.temporary_password) showTempPassword(r.agent.name, r.temporary_password); else toast(msg); load(); } catch (e) { oops(e); } };
      wrap.replaceChildren(
        h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:12px' }, h('span', { class: 'muted' }, seatNote), h('button', { class: 'btn primary', onclick: () => addUser(id, load) }, '+ Add user')),
        h('div', { class: 'tablewrap' }, h('table',
          h('thead', h('tr', h('th', 'Name'), h('th', 'Username'), h('th', 'Number'), h('th', 'Status'), h('th', 'Last login'), h('th'))),
          h('tbody', d.agents.map(a => h('tr',
            h('td', h('span', { class: 'dot ' + (a.is_active ? 'on' : 'off') }), a.name),
            h('td', { class: 'mono small' }, a.username),
            h('td', { class: 'small' }, a.phone_number === 'TBD' ? h('span', { class: 'muted' }, '—') : a.phone_number),
            h('td', a.is_active ? (a.must_change_password ? h('span', { class: 'pill amber' }, 'Temp password') : h('span', { class: 'pill green' }, 'Active')) : h('span', { class: 'pill grey' }, 'Deactivated')),
            h('td', { class: 'small' }, a.last_login_at ? fmtDT(a.last_login_at) : h('span', { class: 'muted' }, 'never')),
            h('td', { class: 'row end', style: 'flex-wrap:nowrap' },
              h('button', { class: 'btn sm', onclick: () => editUser(id, a, load) }, 'Edit'),
              h('button', { class: 'btn sm', onclick: async () => { if (await confirmModal('Reset password', `Reset ${a.name}'s password? Their current one stops working immediately.`, { okLabel: 'Reset' })) act(a, { reset_password: true }); } }, 'Reset password'),
              a.is_active ? h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmModal('Deactivate user', `${a.name} will be signed out and unable to log in. Nothing is deleted.`, { danger: true, okLabel: 'Deactivate' })) act(a, { is_active: false }, 'User deactivated'); } }, 'Deactivate')
                : h('button', { class: 'btn sm', onclick: () => act(a, { is_active: true }, 'User reactivated') }, 'Reactivate'))))))));
    } catch (e) { wrap.replaceChildren(errorBox(e)); }
  }
  load();
  return h('div', { class: 'panel' }, wrap);
}
function addUser(id, reload) {
  const name = h('input', { type: 'text', placeholder: 'Jane Smith' }), user = h('input', { type: 'text', placeholder: 'jane' }), phone = h('input', { type: 'text', placeholder: '+12395551234 (optional)' });
  modal('Add user', (close) => { const box = h('div'); return h('form', { onsubmit: async (e) => { e.preventDefault(); try { const r = await POST(`/tenants/${id}/agents`, { name: name.value, username: user.value, phone_number: phone.value }); close(); showTempPassword(r.agent.name, r.temporary_password, 'Username: ' + r.agent.username); reload(); } catch (ex) { box.replaceChildren(errorBox(ex)); } } },
    box, h('div', { class: 'field' }, h('label', 'Full name'), name), h('div', { class: 'field' }, h('label', 'Username'), user, h('span', { class: 'hint' }, 'Lowercase letters, numbers, . _ -')), h('div', { class: 'field' }, h('label', 'Their Twilio number'), phone),
    h('div', { class: 'row end' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Create user'))); });
}
function editUser(id, a, reload) {
  const name = h('input', { type: 'text', value: a.name }), user = h('input', { type: 'text', value: a.username }), phone = h('input', { type: 'text', value: a.phone_number === 'TBD' ? '' : a.phone_number });
  modal('Edit user', (close) => { const box = h('div'); return h('form', { onsubmit: async (e) => { e.preventDefault(); try { await PATCH(`/tenants/${id}/agents/${a.id}`, { name: name.value, username: user.value, phone_number: phone.value }); close(); toast('User updated'); reload(); } catch (ex) { box.replaceChildren(errorBox(ex)); } } },
    box, h('div', { class: 'field' }, h('label', 'Full name'), name), h('div', { class: 'field' }, h('label', 'Username'), user), h('div', { class: 'field' }, h('label', 'Twilio number'), phone),
    h('div', { class: 'row end' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Save'))); });
}

// Features --------------------------------------------------------------------
async function featuresTab(id) {
  const s = await GET(`/tenants/${id}/settings`);
  const env = s.env_defaults;
  const unavailable = { zoho: !env.zoho_credentials && 'No Zoho credentials on this deploy', recording: !(env.recording_env && env.openai) && 'Deploy lacks ENABLE_RECORDING and/or OpenAI key', ai_summaries: !env.openai && 'No OpenAI key on this deploy', voicemail_transcription: !env.openai && 'No OpenAI key on this deploy' };
  const seat = h('input', { type: 'number', min: 1, value: s.settings.seat_limit ?? '', placeholder: 'unlimited', style: 'width:120px' });
  const rows = s.feature_keys.map(k => {
    const [label, help] = FEATURE_LABELS[k] || [k, ''];
    const on = s.settings.features[k] !== false;
    const cb = h('input', { type: 'checkbox', checked: on, onchange: async () => { cb.disabled = true; try { await PATCH(`/tenants/${id}/settings`, { features: { [k]: cb.checked } }); toast(`${label} ${cb.checked ? 'enabled' : 'disabled'}`); } catch (e) { cb.checked = !cb.checked; oops(e); } finally { cb.disabled = false; } } });
    return h('div', { class: 'toggle' }, h('div', h('div', { style: 'font-weight:600' }, label, unavailable[k] ? h('span', { class: 'pill grey', style: 'margin-left:8px' }, 'not available') : null), h('div', { class: 'muted small' }, unavailable[k] || help)), h('label', { class: 'switch' }, cb, h('span')));
  });
  return h('div', { class: 'grid two' },
    h('div', { class: 'panel' }, h('h2', 'Features'), h('p', { class: 'muted small' }, 'Changes apply within 30 seconds — no redeploy. A toggle can only turn something off; the deploy still needs the underlying credentials.'), rows),
    h('div', { class: 'panel' }, h('h2', 'Seats'), h('p', { class: 'muted small' }, 'Maximum active users. Creating or reactivating a user past this is refused. Blank = unlimited.'),
      h('div', { class: 'row' }, seat, h('button', { class: 'btn primary', onclick: async () => { try { await PATCH(`/tenants/${id}/settings`, { seat_limit: seat.value ? parseInt(seat.value, 10) : null }); toast('Seat limit saved'); } catch (e) { oops(e); } } }, 'Save')),
      h('h3', 'Resolved right now'), h('div', { class: 'small' }, Object.entries(s.resolved_features).map(([k, v]) => h('div', h('span', { class: 'dot ' + (v ? 'on' : 'off') }), k)))));
}

// Billing ---------------------------------------------------------------------
async function billingTab(id, reg) {
  const s = await GET(`/tenants/${id}/settings`);
  const a = s.account;
  const wrap = h('div');
  const date = h('input', { type: 'date', value: fmtISO(s.settings.enabled_through), style: 'width:180px' });
  const grace = h('input', { type: 'number', min: 0, max: 365, value: s.settings.grace_days, style: 'width:90px' });
  const notes = h('textarea', { placeholder: 'Invoice #, billing contact, plan tier…' }, s.settings.notes || '');
  const plan = h('input', { type: 'text', value: reg.plan || '', placeholder: 'Pilot · $35/user' });
  const save = async (body, msg) => { try { await PATCH(`/tenants/${id}/settings`, body); toast(msg); tenantView(id, 'billing'); } catch (e) { oops(e); } };
  const extend = (days) => async () => { try { const r = await POST(`/tenants/${id}/settings/extend`, { days }); toast(`Extended to ${fmtDate(r.enabled_through)}`); tenantView(id, 'billing'); } catch (e) { oops(e); } };
  const stateP = pillFor(a);
  return h('div', { class: 'grid two' },
    h('div', { class: 'panel' }, h('h2', 'Subscription'),
      h('div', { class: 'row', style: 'margin-bottom:12px' }, pill(stateP), a.message ? h('span', { class: 'small muted' }, a.message) : null),
      h('div', { class: 'field' }, h('label', 'Enabled through'), h('div', { class: 'row' }, date, h('button', { class: 'btn', onclick: () => save({ enabled_through: date.value || null }, 'Renewal date saved') }, 'Save'), h('button', { class: 'btn link', onclick: () => save({ enabled_through: null }, 'Expiry removed') }, 'No expiry')),
        h('span', { class: 'hint' }, a.enabled_through ? `Grace ends ${fmtDate(a.grace_ends)} · login blocked from ${fmtDate(a.blocked_from)}` : 'No renewal date — the account never lapses.')),
      h('div', { class: 'row', style: 'margin-bottom:14px' }, h('span', { class: 'small muted' }, 'Extend:'), h('button', { class: 'btn sm', onclick: extend(30) }, '+30 days'), h('button', { class: 'btn sm', onclick: extend(90) }, '+90 days'), h('button', { class: 'btn sm', onclick: extend(365) }, '+1 year'), h('span', { class: 'hint' }, 'From the current date if still in the future, else from today. Also clears a suspension.')),
      h('div', { class: 'field' }, h('label', 'Grace period (days)'), h('div', { class: 'row' }, grace, h('button', { class: 'btn', onclick: () => save({ grace_days: parseInt(grace.value, 10) }, 'Grace period saved') }, 'Save'))),
      h('h3', 'Suspension'),
      s.settings.suspended
        ? h('div', h('div', { class: 'alert error' }, 'This account is suspended. Nobody can log in.'), h('button', { class: 'btn primary', onclick: () => save({ suspended: false }, 'Account reactivated') }, 'Lift suspension'))
        : h('div', h('p', { class: 'small muted' }, 'Immediately blocks every login and API call. Nothing is deleted; lift it any time.'), h('button', { class: 'btn danger', onclick: async () => { if (await confirmModal('Suspend account', `Suspend ${reg.name} right now? All their users are signed out until you lift it.`, { danger: true, okLabel: 'Suspend' })) save({ suspended: true }, 'Account suspended'); } }, 'Suspend account'))),
    h('div',
      h('div', { class: 'panel' }, h('h2', 'Plan & notes'),
        h('div', { class: 'field' }, h('label', 'Plan (portal only)'), h('div', { class: 'row' }, plan, h('button', { class: 'btn', onclick: async () => { try { await PATCH(`/tenants/${id}`, { plan: plan.value }); toast('Plan saved'); } catch (e) { oops(e); } } }, 'Save'))),
        h('div', { class: 'field' }, h('label', 'Billing notes (stored on the deploy, BTI-only)'), notes, h('button', { class: 'btn', style: 'align-self:flex-start', onclick: () => save({ notes: notes.value }, 'Notes saved') }, 'Save notes'))),
      h('div', { class: 'panel small' }, h('h2', 'How expiry works'),
        h('p', h('b', '14 days before: '), 'the customer\'s users see a renewal banner.'),
        h('p', h('b', 'After the date, for ', s.settings.grace_days, ' days (grace): '), 'banner for everyone, app fully works.'),
        h('p', h('b', 'After grace: '), 'outbound calls and texts are paused. Incoming calls still ring and are logged. Login still works.'),
        h('p', h('b', 'Grace + 30 days: '), 'login blocked with a "contact BTI" screen. ', h('b', 'Nothing is ever deleted.')),
        h('p', { class: 'muted' }, 'Extending the date or lifting a suspension takes effect within 30 seconds.'))));
}
function pillFor(a) { // mirrors helpers/status.js
  const M = { blocked: ['Blocked', 'red'], restricted: ['Outbound off', 'red'], grace: ['In grace', 'amber'], renews_soon: ['Renews soon', 'amber'], active: ['OK', 'green'] };
  if (!a) return { label: 'Unknown', tone: 'grey' };
  if (a.suspended) return { label: 'Suspended', tone: 'red' };
  const [label, tone] = M[a.state] || M.active;
  return { label: a.state === 'renews_soon' && a.days_until_renewal != null ? `Renews in ${a.days_until_renewal}d` : label, tone };
}

// Health ----------------------------------------------------------------------
async function healthTab(id) {
  const hh = await GET(`/tenants/${id}/health`);
  const yn = (v) => h('span', { class: 'dot ' + (v ? 'on' : 'off') });
  const kv = (rows) => h('table', h('tbody', rows.map(([k, v]) => h('tr', h('th', k), h('td', v)))));
  return h('div', { class: 'grid two' },
    h('div', { class: 'panel' }, h('h2', 'Deploy'), kv([
      ['Server version', hh.versions.server], ['Desktop app (latest)', hh.versions.desktop_latest || '—'], ['Node', hh.versions.node],
      ['Uptime', Math.round(hh.uptime_seconds / 3600) + ' h'], ['Brand', `${hh.brand?.company_name || ''} / ${hh.brand?.brand_name || ''}`],
      ['Database size', fmtBytes(hh.db.bytes)], ['Users', `${hh.db.active_agents} active / ${hh.db.total_agents} total`],
      ['Last call', fmtDT(hh.db.last_call_at)], ['Last text', fmtDT(hh.db.last_message_at)], ['Last login', fmtDT(hh.db.last_login_at)],
      ['Last Twilio voice webhook', fmtDT(hh.last_seen?.voice)], ['Last Twilio SMS webhook', fmtDT(hh.last_seen?.sms)]]),
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn', onclick: async () => { try { const r = await POST(`/tenants/${id}/test`); r.ok ? toast('Reachable ✓') : toast(r.error, 'error'); } catch (e) { oops(e); } } }, 'Test connection'))),
    h('div',
      h('div', { class: 'panel' }, h('h2', 'Integrations configured'), kv([
        ['Twilio', yn(hh.env.twilio_configured)], ['Voice (API key + TwiML app)', yn(hh.env.voice_configured)], ['Messaging service', yn(hh.env.messaging_service)],
        ['OpenAI', yn(hh.env.openai)], ['Zoho credentials', yn(hh.env.zoho_credentials)], ['Default number', hh.env.default_number || '—'], ['SERVER_URL', h('span', { class: 'mono small' }, hh.env.server_url || '—')]])),
      h('div', { class: 'panel' }, h('h2', 'Phone numbers'),
        hh.numbers.routing.length ? h('table', h('thead', h('tr', h('th', 'Number'), h('th', 'Label'), h('th', 'Routes to'), h('th', 'Active'))), h('tbody', hh.numbers.routing.map(n => h('tr', h('td', { class: 'mono' }, n.phone_number), h('td', n.label || ''), h('td', n.destination_type), h('td', yn(n.is_active)))))) : h('p', { class: 'muted small' }, 'No routing rules.'),
        hh.numbers.agents.length ? h('div', { class: 'small', style: 'margin-top:8px' }, h('b', 'User numbers: '), hh.numbers.agents.map(a => `${a.name} ${a.phone_number}`).join(' · ')) : null)));
}

// Log -------------------------------------------------------------------------
async function logTab(id) {
  const d = await GET(`/tenants/${id}/audit`);
  return h('div', { class: 'panel' }, h('h2', 'Portal actions on this tenant'),
    d.audit.length ? h('table', h('thead', h('tr', h('th', 'When'), h('th', 'Who'), h('th', 'Action'), h('th', 'Detail'))),
      h('tbody', d.audit.map(r => h('tr', h('td', { class: 'small' }, fmtDT(r.created_at)), h('td', r.username), h('td', { class: 'mono small' }, r.action), h('td', { class: 'mono small muted' }, r.detail ? JSON.stringify(r.detail) : ''))))) : h('p', { class: 'muted' }, 'Nothing yet.'));
}

// Setup -----------------------------------------------------------------------
async function setupTab(id, reg) {
  const name = h('input', { type: 'text', value: reg.name }), url = h('input', { type: 'url', value: reg.url }), key = h('input', { type: 'password', placeholder: `Leave blank to keep current key (${reg.key_hint})`, autocomplete: 'off' }), notes = h('textarea', reg.notes || '');
  const save = async () => { try { const body = { name: name.value, url: url.value, notes: notes.value }; if (key.value) body.key = key.value; await PATCH(`/tenants/${id}`, body); toast('Saved'); tenantView(id, 'setup'); } catch (e) { oops(e); } };
  return h('div', { class: 'panel', style: 'max-width:600px' }, h('h2', 'Registry entry'),
    h('div', { class: 'field' }, h('label', 'Customer name'), name),
    h('div', { class: 'field' }, h('label', 'Deploy URL'), url),
    h('div', { class: 'field' }, h('label', 'Tenant admin key'), key, h('span', { class: 'hint' }, 'Only needed if you rotated TENANT_ADMIN_KEY on the deploy.')),
    h('div', { class: 'field' }, h('label', 'Portal notes'), notes),
    h('div', { class: 'row', style: 'justify-content:space-between' },
      reg.is_active ? h('button', { class: 'btn danger', onclick: async () => { if (await confirmModal('Archive tenant', 'Hides it from the dashboard. The customer\'s deploy is untouched and you can un-archive any time.', { okLabel: 'Archive' })) { try { await PATCH(`/tenants/${id}`, { is_active: false }); toast('Archived'); location.hash = '#/'; } catch (e) { oops(e); } } } }, 'Archive')
        : h('button', { class: 'btn', onclick: async () => { try { await PATCH(`/tenants/${id}`, { is_active: true }); toast('Restored'); tenantView(id, 'setup'); } catch (e) { oops(e); } } }, 'Un-archive'),
      h('button', { class: 'btn primary', onclick: save }, 'Save')));
}

// ── portal users ─────────────────────────────────────────────────────────────
async function portalUsersView() {
  render(shell('users', h('div', { class: 'head' }, h('h1', 'Portal users')), loading('users')));
  let d; try { d = await GET('/users'); } catch (e) { return render(shell('users', errorBox(e))); }
  const act = async (u, body, msg) => { try { const r = await PATCH(`/users/${u.id}`, body); if (r.temporary_password) showTempPassword(r.user.name, r.temporary_password); else toast(msg); portalUsersView(); } catch (e) { oops(e); } };
  const add = () => { const name = h('input', { type: 'text' }), user = h('input', { type: 'text' }); modal('Add portal user', (close) => { const box = h('div'); return h('form', { onsubmit: async (e) => { e.preventDefault(); try { const r = await POST('/users', { name: name.value, username: user.value }); close(); showTempPassword(r.user.name, r.temporary_password, 'Username: ' + r.user.username); portalUsersView(); } catch (ex) { box.replaceChildren(errorBox(ex)); } } }, box, h('div', { class: 'field' }, h('label', 'Name'), name), h('div', { class: 'field' }, h('label', 'Username'), user), h('div', { class: 'row end' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Create'))); }); };
  render(shell('users',
    h('div', { class: 'head' }, h('div', h('h1', 'Portal users'), h('p', { class: 'muted' }, 'Who can sign in here. Everyone is a full admin.')), h('button', { class: 'btn primary', onclick: add }, '+ Add user')),
    h('div', { class: 'panel' }, h('table', h('thead', h('tr', h('th', 'Name'), h('th', 'Username'), h('th', 'Status'), h('th', 'Last login'), h('th'))),
      h('tbody', d.users.map(u => h('tr', h('td', u.name, u.id === S.user.id ? h('span', { class: 'muted small' }, ' (you)') : null), h('td', { class: 'mono small' }, u.username),
        h('td', u.is_active ? (u.must_change_password ? h('span', { class: 'pill amber' }, 'Temp password') : h('span', { class: 'pill green' }, 'Active')) : h('span', { class: 'pill grey' }, 'Deactivated')),
        h('td', { class: 'small' }, u.last_login_at ? fmtDT(u.last_login_at) : h('span', { class: 'muted' }, 'never')),
        h('td', { class: 'row end', style: 'flex-wrap:nowrap' },
          h('button', { class: 'btn sm', onclick: async () => { if (await confirmModal('Reset password', `Reset ${u.name}'s portal password?`, { okLabel: 'Reset' })) act(u, { reset_password: true }); } }, 'Reset password'),
          u.id !== S.user.id ? (u.is_active ? h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmModal('Deactivate', `Remove ${u.name}'s portal access?`, { danger: true, okLabel: 'Deactivate' })) act(u, { is_active: false }, 'Deactivated'); } }, 'Deactivate') : h('button', { class: 'btn sm', onclick: () => act(u, { is_active: true }, 'Reactivated') }, 'Reactivate')) : null))))))));
}

// ── router ───────────────────────────────────────────────────────────────────
async function route() {
  if (!S.token) return loginView();
  if (!S.user) { try { S.user = (await GET('/auth/me')).user; } catch { return; } }
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (S.user.must_change_password && parts[0] !== 'password') { location.hash = '#/password'; return; }
  if (parts[0] === 'password') return passwordView();
  if (parts[0] === 'add') return addTenantView();
  if (parts[0] === 'users') return portalUsersView();
  if (parts[0] === 't' && parts[1]) return tenantView(parseInt(parts[1], 10), parts[2]);
  return dashboardView();
}
window.addEventListener('hashchange', route);
route();
})();
