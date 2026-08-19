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
  const {
    enabled, greeting, timeout, default_agent_id, voice,
    auto_text_enabled, auto_text_message,
    after_hours_sms_enabled, after_hours_sms_message,
    business_hours_start, business_hours_end, business_days, business_timezone,
  } = req.body;
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
            auto_text_enabled       = COALESCE($6,  ivr_settings.auto_text_enabled),
            auto_text_message       = COALESCE($7,  ivr_settings.auto_text_message),
            after_hours_sms_enabled = COALESCE($8,  ivr_settings.after_hours_sms_enabled),
            after_hours_sms_message = COALESCE($9,  ivr_settings.after_hours_sms_message),
            business_hours_start    = COALESCE($10, ivr_settings.business_hours_start),
            business_hours_end      = COALESCE($11, ivr_settings.business_hours_end),
            business_days           = COALESCE($12, ivr_settings.business_days),
            business_timezone       = COALESCE($13, ivr_settings.business_timezone),
            updated_at       = NOW()
      RETURNING *
    `, [
      !!enabled, greeting || '', timeout || 10, default_agent_id || null, voice || 'Polly.Joanna-Neural',
      auto_text_enabled === undefined ? null : !!auto_text_enabled,
      auto_text_message ?? null,
      after_hours_sms_enabled === undefined ? null : !!after_hours_sms_enabled,
      after_hours_sms_message ?? null,
      business_hours_start ?? null,
      business_hours_end ?? null,
      business_days ?? null,
      business_timezone ?? null,
    ]);
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

// ── Per-number inbound routing rules ──────────────────────────────────────────
const NR_TYPES = ['ivr', 'agent', 'all_agents', 'voicemail'];

function normalizeE164(input) {
  const digits = (input || '').replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return (input || '').trim();
}

router.get('/number-routing', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT nr.*, ag.name AS agent_name
      FROM number_routing nr
      LEFT JOIN agents ag ON ag.id = NULLIF(regexp_replace(nr.destination_value, '\\D', '', 'g'), '')::int AND nr.destination_type = 'agent'
      ORDER BY nr.phone_number
    `);
    res.json(rows);
  } catch (e) {
    console.error('[ivr GET /number-routing]', e.message);
    res.status(500).json({ error: 'Failed to fetch number routing' });
  }
});

router.post('/number-routing', requireAuth, async (req, res) => {
  const { phone_number, label, destination_type, destination_value } = req.body;
  const phone = normalizeE164(phone_number);
  if (!/^\+\d{10,15}$/.test(phone)) return res.status(400).json({ error: 'phone_number must be a valid number (E.164)' });
  if (!NR_TYPES.includes(destination_type)) return res.status(400).json({ error: `destination_type must be one of: ${NR_TYPES.join(', ')}` });
  if (destination_type === 'agent' && !parseInt(destination_value, 10)) {
    return res.status(400).json({ error: 'destination_value must be an agent id when destination_type is agent' });
  }
  try {
    const { rows: [row] } = await pool.query(`
      INSERT INTO number_routing (phone_number, label, destination_type, destination_value)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (phone_number) DO UPDATE SET
        label = EXCLUDED.label,
        destination_type = EXCLUDED.destination_type,
        destination_value = EXCLUDED.destination_value,
        is_active = true,
        updated_at = NOW()
      RETURNING *
    `, [phone, label || null, destination_type, destination_type === 'agent' ? String(parseInt(destination_value, 10)) : null]);
    res.json(row);
  } catch (e) {
    console.error('[ivr POST /number-routing]', e.message);
    res.status(500).json({ error: 'Failed to save routing rule' });
  }
});

router.delete('/number-routing/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM number_routing WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[ivr DELETE /number-routing/:id]', e.message);
    res.status(500).json({ error: 'Failed to delete routing rule' });
  }
});

module.exports = router;
