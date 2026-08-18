const express = require('express');
const { pool }  = require('../db');

const router = express.Router();

const { ADMIN_KEY } = require('../secret'); // no hardcoded fallback — random per boot if unset

const EVENT_LABELS = {
  login:        '🔑 Login',
  app_open:     '📱 App Opened',
  call:         '📞 Call Made',
  tab_sms:      '💬 Opened Messages',
  tab_calls:    '📞 Opened Calls',
  tab_dialpad:  '🔢 Opened Dialpad',
  tab_contacts: '👥 Opened Contacts',
  tab_settings: '⚙️ Opened Settings',
  tab_notifications: '🔔 Opened Notifications',
};

router.get('/', async (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(401).send('<h2>401 Unauthorized</h2>');
  }

  const limit  = parseInt(req.query.limit  || '200', 10);
  const filter = req.query.filter || 'all';

  let whereClause = '';
  if (filter === 'logins') whereClause = `WHERE event = 'login'`;

  const { rows } = await pool.query(`
    SELECT id, agent_name, event, detail, ip, city, country, created_at
    FROM user_activity_logs
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $1
  `, [limit]);

  // Count logins per agent in the last 30 days
  const { rows: stats } = await pool.query(`
    SELECT agent_name, COUNT(*) AS logins
    FROM user_activity_logs
    WHERE event = 'login' AND created_at > NOW() - INTERVAL '30 days'
    GROUP BY agent_name
    ORDER BY logins DESC
  `);

  const rows_html = rows.map(r => {
    const time  = new Date(r.created_at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const label = EVENT_LABELS[r.event] || r.event;
    const loc   = [r.city, r.country].filter(Boolean).join(', ') || '—';
    const detail = r.detail ? `<span style="color:#94a3b8;font-size:12px"> · ${r.detail}</span>` : '';
    return `<tr>
      <td>${time}</td>
      <td><strong>${r.agent_name || '—'}</strong></td>
      <td>${label}${detail}</td>
      <td>${loc}</td>
      <td style="color:#64748b;font-size:12px">${r.ip || '—'}</td>
    </tr>`;
  }).join('');

  const stats_html = stats.map(s =>
    `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1e293b">
      <span>${s.agent_name || 'Unknown'}</span>
      <span style="color:#38bdf8;font-weight:600">${s.logins} logins</span>
    </div>`
  ).join('');

  const activeFilter = (f) => f === filter
    ? 'background:#0ea5e9;color:#fff;border-color:#0ea5e9'
    : 'background:transparent;color:#94a3b8;border-color:#334155';

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>BTI Voice — Activity</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; padding: 32px; }
    h1 { font-size: 22px; font-weight: 700; color: #f8fafc; margin-bottom: 4px; }
    .subtitle { color: #64748b; font-size: 13px; margin-bottom: 28px; }
    .layout { display: flex; gap: 24px; align-items: flex-start; }
    .main { flex: 1; min-width: 0; }
    .sidebar { width: 220px; flex-shrink: 0; }
    .card { background: #1e293b; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .card h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: #64748b; margin-bottom: 12px; }
    .filters { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
    .filters a { padding: 6px 14px; border-radius: 20px; border: 1px solid; text-decoration: none; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 10px 12px; color: #64748b; font-weight: 500; border-bottom: 1px solid #1e293b; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
    td { padding: 10px 12px; border-bottom: 1px solid #1e293b; vertical-align: middle; }
    tr:hover td { background: #1e293b44; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
  </style>
</head>
<body>
  <h1>BTI Voice · Activity Monitor</h1>
  <p class="subtitle">Showing last ${limit} events · All times Eastern</p>

  <div class="layout">
    <div class="main">
      <div class="filters">
        <a href="?key=${ADMIN_KEY}&filter=all&limit=${limit}" style="${activeFilter('all')}">All events</a>
        <a href="?key=${ADMIN_KEY}&filter=logins&limit=${limit}" style="${activeFilter('logins')}">Logins only</a>
        <a href="?key=${ADMIN_KEY}&filter=all&limit=50"  style="${activeFilter('50')}">50</a>
        <a href="?key=${ADMIN_KEY}&filter=all&limit=200" style="${activeFilter('200')}">200</a>
        <a href="?key=${ADMIN_KEY}&filter=all&limit=500" style="${activeFilter('500')}">500</a>
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        <table>
          <thead><tr>
            <th>Time (ET)</th><th>Agent</th><th>Event</th><th>Location</th><th>IP</th>
          </tr></thead>
          <tbody>${rows_html || '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:32px">No activity yet</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="sidebar">
      <div class="card">
        <h3>Logins (30 days)</h3>
        ${stats_html || '<p style="color:#64748b;font-size:13px">No logins yet</p>'}
      </div>
      <div class="card">
        <h3>Quick links</h3>
        <div style="font-size:13px;display:flex;flex-direction:column;gap:8px">
          <a href="?key=${ADMIN_KEY}&filter=all&limit=200" style="color:#38bdf8">↻ Refresh</a>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`);
});

module.exports = router;
