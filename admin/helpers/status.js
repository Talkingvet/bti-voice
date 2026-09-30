// Pure helpers (unit-tested): dashboard status pill + CSV export.

// Maps a tenant's account status (from /api/tenant/settings → account) to the
// pill shown on the dashboard. Order of severity matters for sorting.
const PILLS = {
  unreachable: { label: 'Unreachable',  tone: 'grey',  rank: 0 },
  blocked:     { label: 'Blocked',      tone: 'red',   rank: 1 },
  restricted:  { label: 'Outbound off', tone: 'red',   rank: 2 },
  grace:       { label: 'In grace',     tone: 'amber', rank: 3 },
  renews_soon: { label: 'Renews soon',  tone: 'amber', rank: 4 },
  active:      { label: 'OK',           tone: 'green', rank: 5 },
};

function pillFor(account, reachable) {
  if (!reachable || !account) return { key: 'unreachable', ...PILLS.unreachable };
  const key = account.suspended ? 'blocked' : (PILLS[account.state] ? account.state : 'active');
  const pill = { key, ...PILLS[key] };
  if (account.suspended) pill.label = 'Suspended';
  if (key === 'renews_soon' && Number.isInteger(account.days_until_renewal)) pill.label = `Renews in ${account.days_until_renewal}d`;
  return pill;
}

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const USAGE_COLS = [
  ['calls_in', 'Calls in'], ['call_minutes_in', 'Inbound minutes'],
  ['calls_out', 'Calls out'], ['call_minutes_out', 'Outbound minutes'],
  ['missed_calls', 'Missed'], ['voicemails', 'Voicemails'],
  ['recordings', 'Recordings'], ['recorded_minutes', 'Recorded minutes'],
  ['transcriptions', 'Transcriptions'], ['ai_summaries', 'AI summaries'],
  ['sms_in', 'SMS in'], ['sms_out', 'SMS out'], ['mms', 'MMS'],
];

// One row per user, then "Unattributed" (inbound to numbers no user owns), then TOTAL.
function csvForUsage(tenantName, usage) {
  const header = ['Tenant', 'Period from', 'Period to', 'User', 'Username', 'Active', 'Last login', ...USAGE_COLS.map(c => c[1])];
  const lines = [header.map(csvCell).join(',')];
  const row = (label, username, active, lastLogin, b) =>
    [tenantName, usage.from, usage.to, label, username, active, lastLogin, ...USAGE_COLS.map(c => b[c[0]] ?? 0)].map(csvCell).join(',');
  for (const a of usage.agents || []) {
    lines.push(row(a.name, a.username, a.is_active ? 'yes' : 'no', a.last_login_at ? String(a.last_login_at).slice(0, 10) : '', a));
  }
  const t = usage.totals || {};
  if (t.unattributed) lines.push(row('Unattributed', '', '', '', t.unattributed));
  lines.push(row('TOTAL', '', '', '', t));
  return lines.join('\r\n') + '\r\n';
}

module.exports = { pillFor, csvForUsage, PILLS, USAGE_COLS };
