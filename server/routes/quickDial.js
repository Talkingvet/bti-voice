const express = require('express')
const router  = express.Router()
const { pool } = require('../db')
const { requireAuth } = require('../auth')

// GET /api/quick-dial
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM quick_dial ORDER BY name ASC'
    )
    res.json(rows)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// POST /api/quick-dial
router.post('/', requireAuth, async (req, res) => {
  const { name, phone_number } = req.body
  if (!name?.trim() || !phone_number?.trim()) return res.status(400).json({ error: 'name and phone_number required' })
  try {
    const { rows } = await pool.query(
      'INSERT INTO quick_dial (name, phone_number) VALUES ($1, $2) RETURNING *',
      [name.trim(), phone_number.trim()]
    )
    res.json(rows[0])
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/quick-dial/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM quick_dial WHERE id = $1', [req.params.id])
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
