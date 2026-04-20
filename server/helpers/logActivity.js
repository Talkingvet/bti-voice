const { pool } = require('../db');
let geoip;
try { geoip = require('geoip-lite'); } catch { geoip = null; }

function getIP(req) {
  const fwd = req.headers['x-forwarded-for'];
  return fwd ? fwd.split(',')[0].trim() : (req.ip || '');
}

async function logActivity(req, agent, event, detail = null) {
  try {
    const ip = getIP(req);
    let city = null, country = null;
    if (geoip && ip && ip !== '::1' && ip !== '127.0.0.1') {
      const geo = geoip.lookup(ip);
      if (geo) {
        city    = geo.city || geo.region || null;
        country = geo.country || null;
      }
    }
    await pool.query(
      `INSERT INTO user_activity_logs (agent_id, agent_name, event, detail, ip, city, country)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [agent?.id || null, agent?.name || null, event, detail, ip || null, city, country]
    );
  } catch (e) {
    console.error('[activity-log]', e.message);
  }
}

module.exports = { logActivity, getIP };
