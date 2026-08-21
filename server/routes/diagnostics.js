const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

// Cap what we accept so a runaway client can't post megabytes of log text.
// 200k characters is roughly 2000 log lines — far more than the client keeps.
const MAX_LOG_CHARS = 200000;
const MAX_NOTE_CHARS = 2000;

// Submit a diagnostic report from the app.
// Used by Settings -> Help -> "Send diagnostics", primarily so TestFlight
// testers on iOS can report a problem without a Mac or console access.
router.post('/', requireAuth, async (req, res) => {
  try {
    const { note, platform, appVersion, userAgent, context, logs } = req.body || {};

    const safeLogs = typeof logs === 'string' ? logs.slice(-MAX_LOG_CHARS) : null;
    const safeNote = typeof note === 'string' ? note.slice(0, MAX_NOTE_CHARS) : null;

    const { rows: [row] } = await pool.query(
      `INSERT INTO diagnostic_reports
         (agent_id, note, platform, app_version, user_agent, context, logs)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [
        req.agent?.id || null,
        safeNote,
        typeof platform   === 'string' ? platform.slice(0, 40)   : null,
        typeof appVersion === 'string' ? appVersion.slice(0, 20) : null,
        typeof userAgent  === 'string' ? userAgent.slice(0, 500) : null,
        context && typeof context === 'object' ? context : null,
        safeLogs,
      ]
    );

    // Mirror a marker into the server log so it surfaces in Railway's deploy
    // logs too — useful when someone reports an issue in real time.
    console.log(
      '[diagnostics] Report #' + row.id +
      ' from agent ' + (req.agent?.id || '?') +
      ' (' + (platform || 'unknown') + ')' +
      (safeNote ? ' — ' + safeNote.slice(0, 120) : '')
    );

    res.json({ ok: true, id: row.id, created_at: row.created_at });
  } catch (e) {
    console.error('[diagnostics] Failed to store report:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// List recent reports (metadata only — no log bodies, keeps the payload small).
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.note, d.platform, d.app_version, d.user_agent,
              d.context, d.created_at, a.name AS agent_name,
              length(d.logs) AS log_chars
         FROM diagnostic_reports d
         LEFT JOIN agents a ON a.id = d.agent_id
        ORDER BY d.created_at DESC
        LIMIT 100`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Full report including the captured log text.
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows: [row] } = await pool.query(
      `SELECT d.*, a.name AS agent_name
         FROM diagnostic_reports d
         LEFT JOIN agents a ON a.id = d.agent_id
        WHERE d.id = $1`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
