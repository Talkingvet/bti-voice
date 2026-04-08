const express = require('express');
const twilio = require('twilio');
const { pool } = require('../db');

const router = express.Router();

// TwiML for outbound browser calls — dials the customer's number
router.post('/outbound', async (req, res) => {
  const { To } = req.body;
  const twiml = new twilio.twiml.VoiceResponse();

  if (To) {
    const dial = twiml.dial({ callerId: req.body.From || To });
    dial.number(To);
  } else {
    twiml.say('No destination number provided.');
  }

  res.set('Content-Type', 'text/xml');
  res.send(twiml.toString());
});

// TwiML for inbound calls — routes to the correct agent's browser client
router.post('/inbound', async (req, res) => {
  const { To } = req.body;
  const twiml = new twilio.twiml.VoiceResponse();

  try {
    const { rows: [agent] } = await pool.query(
      'SELECT * FROM agents WHERE phone_number = $1 AND is_active = true', [To]
    );

    if (agent) {
      const dial = twiml.dial({ timeout: 30 });
      dial.client(`agent_${agent.id}`);
    } else {
      twiml.say('No agent is available for this number. Please try again later.');
    }
  } catch (e) {
    twiml.say('An error occurred. Please try again.');
  }

  res.set('Content-Type', 'text/xml');
  res.send(twiml.toString());
});

module.exports = router;
