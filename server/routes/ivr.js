const express    = require('express');
const { pool }   = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

// ── GET settings ──────────────────────────────────────────────────────────────
router.get('/settings', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM ivr_settings LIMIT 1');
    res.json(rows[0] || { enabled: false, greeting: '', timeout: 10 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUT settings ──────────────────────────────────────────────────────────────
router.put('/settings', requireAuth, async (req, res) => {
  const { enabled, greeting, timeout, default_agent_id, voice } = req.body;
  try {
    const { rows } = await pool.query(`
      INSERT INTO ivr_settings (id, enabled, greeting, timeout, default_agent_id, voice, updated_at)
      VALUES (1, $1, $2, $3, $4, $5, NOW())
      ON CONFLICT (id) DO UPDATE
        SET enabled          = $1,
            greeting         = $2,
            timeout          = $3,
            default_agent_id = $4,
            voice            = $5,
            updated_at       = NOW()
      RETURNING *
    `, [!!enabled, greeting || '', timeout || 10, default_agent_id || null, voice || 'Polly.Joanna-Neural']);
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET menu items ─────────────────────────────────────────────────────────────
router.get('/menu', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM ivr_menus ORDER BY sort_order, digit'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST menu item ─────────────────────────────────────────────────────────────
router.post('/menu', requireAuth, async (req, res) => {
  const { digit, label, destination_type, destination_value, sort_order } = req.body;
  if (!digit || !label || !destination_type) {
    return res.status(400).json({ error: 'digit, label and destination_type are required' });
  }
  try {
    const { rows } = await pool.query(`
      INSERT INTO ivr_menus (digit, label, destination_type, destination_value, sort_order)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [digit, label, destination_type, destination_value || null, sort_order || 0]);
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUT menu item ──────────────────────────────────────────────────────────────
router.put('/menu/:id', requireAuth, async (req, res) => {
  const { digit, label, destination_type, destination_value, sort_order, is_active } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE ivr_menus
      SET digit             = COALESCE($1, digit),
          label             = COALESCE($2, label),
          destination_type  = COALESCE($3, destination_type),
          destination_value = COALESCE($4, destination_value),
          sort_order        = COALESCE($5, sort_order),
          is_active         = COALESCE($6, is_active)
      WHERE id = $7
      RETURNING *
    `, [digit, label, destination_type, destination_value, sort_order, is_active, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE menu item ───────────────────────────────────────────────────────────
router.delete('/menu/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM ivr_menus WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
