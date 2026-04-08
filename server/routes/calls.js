const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');

// Fire-and-forget Zoho sync — never blocks the response
function syncCallToZoho(callId, port) {
  if (!process.env.ZOHO_REFRESH_TOKEN) return; // Zoho not configured, skip silently
  setImmediate(async () => {
    try {
      await fetch(`http://localhost:${port || process.env.PORT || 3000}/api/zoho/log-call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call_id: callId }),
      });
    } catch (e) {
      console.error('[Zoho sync] log-call failed:', e.message);
    }
  });
}

const router = express.Router();

// Get call log (all agents, shared)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        ca.id, ca.direction, ca.duration, ca.status,
        ca.started_at, ca.ended_at,
        a.name     AS agent_name,
        a.color    AS agent_color,
        a.initials AS agent_initials,
        co.name    AS contact_name,
        co.phone_number AS contact_number,
        c.id       AS conversation_id
      FROM calls ca
      JOIN agents a       ON a.id  = ca.agent_id
      JOIN conversations c ON c.id = ca.conversation_id
      JOIN contacts co    ON co.id = c.contact_id
      ORDER BY ca.started_at DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Log a completed call (called from frontend when call ends)
router.post('/log', requireAuth, async (req, res) => {
  const { conversation_id, duration, direction = 'outbound', status = 'completed' } = req.body;
  try {
    const { rows: [call] } = await pool.query(`
      INSERT INTO calls (conversation_id, agent_id, direction, duration, status, ended_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *
    `, [conversation_id, req.agent.id, direction, duration, status]);

    // Sync to Zoho CRM in the background
    syncCallToZoho(call.id);

    res.json(call);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get a Twilio Voice access token for browser calling
router.post('/token', requireAuth, async (req, res) => {
  const sid     = process.env.TWILIO_ACCOUNT_SID;
  const apiKey  = process.env.TWILIO_API_KEY;
  const secret  = process.env.TWILIO_API_SECRET;
  const twimlApp = process.env.TWILIO_TWIML_APP_SID;

  if (!sid || !apiKey || !secret || !twimlApp) {
    return res.status(503).json({ error: 'Twilio Voice not yet configured' });
  }

  try {
    const twilio = require('twilio');
    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const token = new AccessToken(sid, apiKey, secret, {
      identity: `agent_${req.agent.id}`,
    });
    token.addGrant(new VoiceGrant({
      outgoingApplicationSid: twimlApp,
      incomingAllow: true,
    }));

    res.json({ token: token.toJwt(), identity: `agent_${req.agent.id}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
