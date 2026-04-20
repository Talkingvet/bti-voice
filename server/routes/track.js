const express = require('express');
const { requireAuth } = require('../auth');
const { logActivity } = require('../helpers/logActivity');

const router = express.Router();

// POST /api/track  { event, detail }
router.post('/', requireAuth, async (req, res) => {
  const { event, detail } = req.body || {};
  if (!event) return res.status(400).json({ error: 'event required' });
  await logActivity(req, req.agent, event, detail || null);
  res.json({ ok: true });
});

module.exports = router;
