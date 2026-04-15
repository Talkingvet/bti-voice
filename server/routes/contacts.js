/* Contacts API — create, read, update contacts + Zoho name sync */
const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// ── GET / — list all contacts with conversation count ─────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.*,
        COUNT(DISTINCT cv.id) AS conversation_count,
        MAX(cv.last_message_at) AS last_activity
      FROM contacts c
      LEFT JOIN conversations cv ON cv.contact_id = c.id
      GROUP BY c.id
      ORDER BY c.name ASC NULLS LAST, c.phone_number ASC
    `);
    res.json(rows);
  } catch (e) {
    console.error('[contacts GET /]', e.message);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// ── GET /:id — get a single contact ───────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM contacts WHERE id = $1', [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Contact not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('[contacts GET /:id]', e.message);
    res.status(500).json({ error: 'Failed to fetch contact' });
  }
});

// ── POST / — create a new contact ─────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, phone_number, notes } = req.body;
  if (!phone_number) return res.status(400).json({ error: 'phone_number is required' });

  // Normalize phone to E.164
  const digits = (phone_number || '').replace(/\D/g, '');
  const normalized = digits.length === 10 ? '+1' + digits
    : digits.length === 11 && digits.startsWith('1') ? '+' + digits
    : phone_number;

  try {
    const { rows } = await pool.query(
      `INSERT INTO contacts (name, phone_number, notes)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name || null, normalized, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'A contact with that phone number already exists' });
    }
    console.error('[contacts POST /]', e.message);
    res.status(500).json({ error: 'Failed to create contact' });
  }
});

// ── PATCH /:id — update name and/or notes ─────────────────────────────────────
router.patch('/:id', async (req, res) => {
  const { name, notes } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE contacts
       SET name  = COALESCE($1, name),
           notes = $2
       WHERE id = $3
       RETURNING *`,
      [name !== undefined ? name : null, notes !== undefined ? notes : null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Contact not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('[contacts PATCH /:id]', e.message);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// ── POST /:id/sync-zoho — pull name from Zoho CRM and update if unset ─────────
// Only overwrites the BTI Voice name if it still equals the raw phone number
// (meaning it was auto-created and no human has given it a real name yet).
router.post('/:id/sync-zoho', async (req, res) => {
  if (!process.env.ZOHO_REFRESH_TOKEN) {
    return res.status(400).json({ error: 'Zoho is not configured' });
  }

  try {
    const { rows: [contact] } = await pool.query(
      'SELECT * FROM contacts WHERE id = $1', [req.params.id]
    );
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const { findContactByPhone, zohoAPI } = require('../zoho');

    // Look up by phone number
    const zohoId = await findContactByPhone(contact.phone_number);
    if (!zohoId) {
      return res.json({ synced: false, message: 'No matching contact found in Zoho CRM' });
    }

    // Fetch the Zoho contact record
    const data = await zohoAPI('GET', `/crm/v2/Contacts/${zohoId}`);
    const zohoContact = data?.data?.[0];
    const zohoName = zohoContact?.Full_Name || null;

    // Determine if we should update the name:
    // Only overwrite if current name is null, empty, or equals the raw phone number
    const phone = contact.phone_number;
    const nameIsUnset = !contact.name
      || contact.name === phone
      || contact.name === phone.replace(/\D/g, '')
      || contact.name.replace(/\D/g, '') === phone.replace(/\D/g, '');

    let updatedContact = contact;
    if (zohoName && nameIsUnset) {
      const { rows: [updated] } = await pool.query(
        `UPDATE contacts
         SET name = $1, zoho_contact_id = $2, zoho_synced_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [zohoName, zohoId, contact.id]
      );
      updatedContact = updated;
    } else {
      // Still update the Zoho ID and sync timestamp even if name wasn't changed
      const { rows: [updated] } = await pool.query(
        `UPDATE contacts
         SET zoho_contact_id = $1, zoho_synced_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [zohoId, contact.id]
      );
      updatedContact = updated;
    }

    res.json({
      synced:       true,
      name_updated: zohoName && nameIsUnset,
      zoho_name:    zohoName,
      contact:      updatedContact,
    });
  } catch (e) {
    console.error('[contacts POST /:id/sync-zoho]', e.message);
    res.status(500).json({ error: 'Zoho sync failed: ' + e.message });
  }
});

module.exports = router;
