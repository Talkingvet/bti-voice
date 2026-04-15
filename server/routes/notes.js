const express = require('express')
const router  = express.Router()
const { pool } = require('../db')
const { requireAuth } = require('../auth')

// GET /api/conversations/:id/notes
router.get('/:convId/notes', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT n.*, a.name AS agent_name, a.color AS agent_color
      FROM conversation_notes n
      LEFT JOIN agents a ON a.id = n.agent_id
      WHERE n.conversation_id = $1
      ORDER BY n.created_at ASC
    `, [req.params.convId])
    res.json(rows)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// POST /api/conversations/:id/notes
router.post('/:convId/notes', requireAuth, async (req, res) => {
  const { body } = req.body
  if (!body?.trim()) return res.status(400).json({ error: 'body required' })
  try {
    const { rows } = await pool.query(`
      INSERT INTO conversation_notes (conversation_id, agent_id, body)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [req.params.convId, req.agent.id, body.trim()])
    // Fetch with agent info
    const { rows: full } = await pool.query(`
      SELECT n.*, a.name AS agent_name, a.color AS agent_color
      FROM conversation_notes n
      LEFT JOIN agents a ON a.id = n.agent_id
      WHERE n.id = $1
    `, [rows[0].id])
    res.json(full[0])
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// PATCH /api/conversations/:id/notes/:noteId
router.patch('/:convId/notes/:noteId', requireAuth, async (req, res) => {
  const { body } = req.body
  if (!body?.trim()) return res.status(400).json({ error: 'body required' })
  try {
    const { rows } = await pool.query(`
      UPDATE conversation_notes
      SET body = $1, updated_at = NOW()
      WHERE id = $2 AND agent_id = $3
      RETURNING *
    `, [body.trim(), req.params.noteId, req.agent.id])
    if (!rows.length) return res.status(404).json({ error: 'Not found or not yours' })
    res.json(rows[0])
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/conversations/:id/notes/:noteId
router.delete('/:convId/notes/:noteId', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM conversation_notes WHERE id = $1 AND agent_id = $2',
      [req.params.noteId, req.agent.id]
    )
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
