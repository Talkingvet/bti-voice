// server/jobs/scheduledSmsSweep.js
//
// Every 30 seconds, send any scheduled messages whose send_at has passed.
// Respects opt-out (skips + marks failed), routes through the A2P Messaging
// Service when configured, and records the sent message in the conversation.
//
// To disable: comment out startScheduledSmsSweep() in server/index.js.

const { pool }    = require('../db');
const { getIO }   = require('../socket');

const SWEEP_INTERVAL_MS = 30 * 1000;

let timer = null;

async function sendDueMessage(sm) {
  // Re-check opt-out at send time (may have changed since scheduling)
  const { rows: [contact] } = await pool.query(
    'SELECT id, opted_out FROM contacts WHERE phone_number = $1', [sm.to_number]
  );
  if (contact?.opted_out) {
    await pool.query(
      "UPDATE scheduled_messages SET status = 'failed', error = 'Contact has opted out of SMS' WHERE id = $1",
      [sm.id]
    );
    return;
  }

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    await pool.query(
      "UPDATE scheduled_messages SET status = 'failed', error = 'Twilio not configured' WHERE id = $1",
      [sm.id]
    );
    return;
  }

  const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const params = { body: sm.body, from: sm.from_number, to: sm.to_number };
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
    params.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  }

  let sent;
  try {
    sent = await twilio.messages.create(params);
  } catch (twErr) {
    if (twErr.code === 21610 && contact) {
      await pool.query(
        'UPDATE contacts SET opted_out = true, opted_out_at = NOW() WHERE id = $1', [contact.id]
      );
    }
    await pool.query(
      "UPDATE scheduled_messages SET status = 'failed', error = $2 WHERE id = $1",
      [sm.id, twErr.message]
    );
    return;
  }

  // Record in the conversation as a normal outbound message
  const { rows: [message] } = await pool.query(`
    INSERT INTO messages (conversation_id, agent_id, direction, body, from_number, to_number, twilio_sid)
    VALUES ($1, $2, 'outbound', $3, $4, $5, $6)
    RETURNING *
  `, [sm.conversation_id, sm.agent_id, sm.body, sm.from_number, sm.to_number, sent.sid]);

  await pool.query(
    "UPDATE scheduled_messages SET status = 'sent', sent_at = NOW(), twilio_sid = $2 WHERE id = $1",
    [sm.id, sent.sid]
  );
  await pool.query(
    'UPDATE conversations SET last_message_at = NOW(), last_agent_id = $1 WHERE id = $2',
    [sm.agent_id, sm.conversation_id]
  );

  const { rows: [agent] } = await pool.query('SELECT * FROM agents WHERE id = $1', [sm.agent_id]);
  const io = getIO();
  if (io) {
    io.to(`conv_${sm.conversation_id}`).emit('new_message', {
      ...message,
      agent_id: agent?.id ?? null,
      agent_name: agent?.name ?? null,
      agent_color: agent?.color ?? null,
      agent_initials: agent?.initials ?? null,
    });
    io.emit('conversation_updated', { conversation_id: sm.conversation_id });
    io.emit('scheduled_messages_updated', { conversation_id: sm.conversation_id });
  }
  console.log(`[scheduled-sms] Sent #${sm.id} to ${sm.to_number}`);
}

function startScheduledSmsSweep() {
  if (timer) return;
  timer = setInterval(async function () {
    try {
      const { rows } = await pool.query(
        "SELECT * FROM scheduled_messages WHERE status = 'pending' AND send_at <= NOW() ORDER BY send_at ASC LIMIT 20"
      );
      for (const sm of rows) {
        // Claim it first so a crashed send can't double-fire next sweep
        const { rowCount } = await pool.query(
          "UPDATE scheduled_messages SET status = 'sending' WHERE id = $1 AND status = 'pending'", [sm.id]
        );
        if (!rowCount) continue;
        await sendDueMessage(sm).catch(async (e) => {
          console.error('[scheduled-sms] send failed:', e.message);
          await pool.query(
            "UPDATE scheduled_messages SET status = 'failed', error = $2 WHERE id = $1", [sm.id, e.message]
          );
        });
      }
    } catch (e) {
      console.error('[scheduled-sms sweep]', e.message);
    }
  }, SWEEP_INTERVAL_MS);
  console.log('[scheduled-sms] Sweep started');
}

module.exports = { startScheduledSmsSweep };
