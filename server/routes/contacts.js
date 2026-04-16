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

    const { findContactByPhone } = require('../zoho');

    // Look up by phone — returns the full Zoho contact object (with id + Full_Name) or null
    const zohoContact = await findContactByPhone(contact.phone_number);
    if (!zohoContact) {
      return res.json({ synced: false, message: 'No matching contact found in Zoho CRM' });
    }

    const zohoId   = zohoContact.id;
    const zohoName = zohoContact.Full_Name || null;

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

// ── GET /:id/zoho-profile — fetch rich CRM context for a contact ───────────────
// Returns Contact record, related Deals, and Lead fallback from Zoho.
// Used by the client-side Zoho context panel in the conversation view.
router.get('/:id/zoho-profile', async (req, res) => {
  if (!process.env.ZOHO_REFRESH_TOKEN) {
    return res.status(400).json({ error: 'Zoho is not configured' });
  }

  try {
    const { rows: [contact] } = await pool.query(
      'SELECT * FROM contacts WHERE id = $1', [req.params.id]
    );
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const { zohoAPI, findContactByPhone } = require('../zoho');

    // Build profile object we'll return
    const profile = {
      type:         null,   // 'contact' | 'lead' | null
      zoho_id:      contact.zoho_contact_id || null,
      name:         null,
      email:        null,
      account_name: null,
      account_type: null,
      lead_status:   null,
      lead_source:   null,
      contact_stage: null,
      description:  null,
      last_activity:null,
      created_at:   null,
      deals:        [],
      zoho_url:     null,
    };

    // ── 1. Try Contact record ────────────────────────────────────────────────
    let zohoId = contact.zoho_contact_id;

    // If we don't have a stored ID, try to look one up now
    if (!zohoId) {
      const found = await findContactByPhone(contact.phone_number);
      zohoId = found?.id || null;
      if (zohoId) {
        // Cache it for next time
        await pool.query(
          'UPDATE contacts SET zoho_contact_id = $1, zoho_synced_at = NOW() WHERE id = $2',
          [zohoId, contact.id]
        );
      }
    }

    if (zohoId) {
      // Fetch Contact fields
      try {
        const contactData = await zohoAPI('GET',
          `/Contacts/${zohoId}?fields=Full_Name,Email,Phone,Mobile,Account_Name,Lead_Source,Contact_Stage,Description,Modified_Time,Created_Time`
        );
        const c = contactData?.data?.[0];
        if (c) {
          profile.type         = 'contact';
          profile.zoho_id      = zohoId;
          profile.name         = c.Full_Name || null;
          profile.email        = c.Email || null;
          profile.account_name = c.Account_Name?.name || c.Account_Name || null;
          profile.lead_source    = c.Lead_Source || null;
          profile.contact_stage  = c.Contact_Stage || null;
          profile.description    = c.Description || null;
          profile.last_activity= c.Modified_Time || null;
          profile.created_at   = c.Created_Time || null;
          profile.zoho_url     = `https://crm.zoho.com/crm/tab/Contacts/${zohoId}`;

          // Fetch Account type if we have an account name
          if (c.Account_Name?.id) {
            try {
              const acctData = await zohoAPI('GET',
                `/Accounts/${c.Account_Name.id}?fields=Account_Name,Account_Type,Industry`
              );
              const acct = acctData?.data?.[0];
              if (acct) profile.account_type = acct.Account_Type || null;
            } catch (e) { /* ignore */ }
          }
        }
      } catch (e) { console.error('[zoho-profile] Contact fetch:', e.message); }

      // Fetch related Deals
      try {
        const dealsData = await zohoAPI('GET',
          `/Contacts/${zohoId}/Deals?fields=Deal_Name,Stage,Amount,Closing_Date,Modified_Time,Probability&sort_by=Modified_Time&sort_order=desc`
        );
        if (dealsData?.data?.length) {
          profile.deals = dealsData.data.map(d => ({
            id:           d.id,
            name:         d.Deal_Name,
            stage:        d.Stage,
            amount:       d.Amount,
            closing_date: d.Closing_Date,
            probability:  d.Probability,
            modified:     d.Modified_Time,
            url:          `https://crm.zoho.com/crm/tab/Potentials/${d.id}`,
          }));
        }
      } catch (e) { console.error('[zoho-profile] Deals fetch:', e.message); }
    }

    // ── 2. Fallback: try Leads module if no Contact found ────────────────────
    if (!profile.type) {
      try {
        const digits = contact.phone_number.replace(/\D/g, '');
        const search10 = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
        const leadData = await zohoAPI('GET',
          `/Leads/search?phone=${encodeURIComponent(search10)}&fields=Full_Name,Lead_Status,Lead_Source,Email,Modified_Time,Created_Time,Description`
        );
        const lead = leadData?.data?.[0];
        if (lead) {
          profile.type         = 'lead';
          profile.zoho_id      = lead.id;
          profile.name         = lead.Full_Name || null;
          profile.email        = lead.Email || null;
          profile.lead_status  = lead.Lead_Status || null;
          profile.lead_source  = lead.Lead_Source || null;
          profile.description  = lead.Description || null;
          profile.last_activity= lead.Modified_Time || null;
          profile.created_at   = lead.Created_Time || null;
          profile.zoho_url     = `https://crm.zoho.com/crm/tab/Leads/${lead.id}`;
        }
      } catch (e) { /* 204 = not found, that's fine */ }
    }

    res.json(profile);
  } catch (e) {
    console.error('[contacts GET /:id/zoho-profile]', e.message);
    res.status(500).json({ error: 'Zoho profile fetch failed: ' + e.message });
  }
});

module.exports = router;
