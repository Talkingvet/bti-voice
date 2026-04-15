const express = require('express')
const router  = express.Router()
const { pool } = require('../db')
const { requireAuth } = require('../auth')

// GET /api/canned-responses
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM canned_responses ORDER BY name ASC'
    )
    res.json(rows)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// POST /api/canned-responses
router.post('/', requireAuth, async (req, res) => {
  const { name, body } = req.body
  if (!name?.trim() || !body?.trim()) return res.status(400).json({ error: 'name and body required' })
  try {
    const { rows } = await pool.query(
      'INSERT INTO canned_responses (name, body) VALUES ($1, $2) RETURNING *',
      [name.trim(), body.trim()]
    )
    res.json(rows[0])
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// PATCH /api/canned-responses/:id
router.patch('/:id', requireAuth, async (req, res) => {
  const { name, body } = req.body
  if (!name?.trim() || !body?.trim()) return res.status(400).json({ error: 'name and body required' })
  try {
    const { rows } = await pool.query(
      'UPDATE canned_responses SET name = $1, body = $2 WHERE id = $3 RETURNING *',
      [name.trim(), body.trim(), req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/canned-responses/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM canned_responses WHERE id = $1', [req.params.id])
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
