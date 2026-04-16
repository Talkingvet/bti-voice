const bcrypt = require('bcryptjs');
const { pool } = require('./db');

async function seed() {
  // Create agents
  const agents = [
    { name: 'Danny Roche',     username: 'danny',  password: 'danny123',  color: '#10b981', initials: 'DR' },
    { name: 'Shawn Stright',   username: 'shawn',  password: 'shawn123',  color: '#3b82f6', initials: 'SS' },
    { name: 'Rick Almendras',  username: 'rick',   password: 'rick123',   color: '#8b5cf6', initials: 'RA' },
    { name: 'Paul Messino',    username: 'paul',   password: 'paul123',   color: '#f59e0b', initials: 'PM' },
    { name: 'Warren Anderson', username: 'warren', password: 'warren123', color: '#06b6d4', initials: 'WA' },
  ];

  // Handle Raven → Rick rename.
  // If both 'raven' and 'rick' exist (artifact of a failed migration), remove the duplicate 'raven'.
  // If only 'raven' exists, rename it to 'rick'.
  await pool.query(`DELETE FROM agents WHERE username = 'raven' AND EXISTS (SELECT 1 FROM agents WHERE username = 'rick')`);
  await pool.query(`UPDATE agents SET username = 'rick', name = 'Rick Almendras', initials = 'RA', color = '#8b5cf6' WHERE username = 'raven'`);

  for (const a of agents) {
    const { rows } = await pool.query('SELECT id FROM agents WHERE username = $1', [a.username]);
    if (!rows.length) {
      // New agent — insert with hashed password
      const hash = await bcrypt.hash(a.password, 10);
      await pool.query(
        'INSERT INTO agents (name, username, password_hash, color, initials) VALUES ($1,$2,$3,$4,$5)',
        [a.name, a.username, hash, a.color, a.initials]
      );
      console.log(`[seed] Created agent: ${a.name}  (login: ${a.username} / ${a.password})`);
    } else {
      // Existing agent — keep password, just sync name/initials/color
      await pool.query(
        'UPDATE agents SET name = $1, initials = $2, color = $3 WHERE username = $4',
        [a.name, a.initials, a.color, a.username]
      );
    }
  }

  // Only seed demo conversations if the DB is empty
  const { rows: [{ count }] } = await pool.query('SELECT COUNT(*) FROM conversations');
  if (parseInt(count) > 0) return;

  console.log('[seed] Seeding demo conversations...');

  const { rows: allAgents } = await pool.query('SELECT * FROM agents ORDER BY id LIMIT 3');
  const [shawn, danny, raven] = allAgents;

  const now = new Date();
  const ago = (minutes) => new Date(now - minutes * 60 * 1000);

  // Helper: find or create contact + conversation
  async function mkConv(contactName, contactNumber, lastAgentId) {
    await pool.query(
      'INSERT INTO contacts (name, phone_number) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [contactName, contactNumber]
    );
    const { rows: [contact] } = await pool.query(
      'SELECT * FROM contacts WHERE phone_number = $1', [contactNumber]
    );
    const { rows: [conv] } = await pool.query(
      'INSERT INTO conversations (contact_id, last_agent_id, last_message_at) VALUES ($1,$2,$3) RETURNING *',
      [contact.id, lastAgentId, now]
    );
    return { contact, conv };
  }

  async function addMsg(convId, agentId, direction, body, fromNum, toNum, minutesAgo) {
    await pool.query(`
      INSERT INTO messages (conversation_id, agent_id, direction, body, from_number, to_number, sent_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `, [convId, agentId, direction, body, fromNum, toNum, ago(minutesAgo)]);
  }

  async function linkAgent(convId, agentId) {
    await pool.query(
      'INSERT INTO conversation_agents VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [convId, agentId]
    );
  }

  // ── Conversation 1: Ranch Pet Clinic (double-text warning scenario) ──
  const { contact: c1, conv: conv1 } = await mkConv('Ranch Pet Clinic', '+15125550147', danny.id);
  await addMsg(conv1.id, shawn.id, 'outbound', "Hi there! Just following up on your TalkingVet renewal — any questions?", shawn.phone_number, c1.phone_number, 120);
  await addMsg(conv1.id, null,     'inbound',  "Yes, we'd love to proceed! Can you send over the contract?",              c1.phone_number, shawn.phone_number, 90);
  await addMsg(conv1.id, shawn.id, 'outbound', "Absolutely, sending it over now. You'll get an email shortly!",           shawn.phone_number, c1.phone_number, 85);
  await addMsg(conv1.id, null,     'inbound',  "Perfect, thank you Shawn!",                                               c1.phone_number, shawn.phone_number, 60);
  await addMsg(conv1.id, danny.id, 'outbound', "Hey! Just checking in to see if you had any questions about the renewal 😊", danny.phone_number, c1.phone_number, 5);
  await linkAgent(conv1.id, shawn.id);
  await linkAgent(conv1.id, danny.id);

  // ── Conversation 2: Riverside Animal Hospital ──
  const { contact: c2, conv: conv2 } = await mkConv('Riverside Animal Hosp.', '+18305550234', shawn.id);
  await addMsg(conv2.id, raven.id, 'outbound', "Hi! I've attached the updated pricing sheet for your review.",         raven.phone_number, c2.phone_number, 150);
  await addMsg(conv2.id, null,     'inbound',  "Thanks Raven! We'll take a look and get back to you.",                c2.phone_number, raven.phone_number, 100);
  await addMsg(conv2.id, shawn.id, 'outbound', "Great! Let me know if you need anything else — we're here all week.", shawn.phone_number, c2.phone_number, 60);
  await linkAgent(conv2.id, raven.id);
  await linkAgent(conv2.id, shawn.id);

  // ── Conversation 3: Happy Paws Grooming ──
  const { contact: c3, conv: conv3 } = await mkConv('Happy Paws Grooming', '+12105550891', danny.id);
  await addMsg(conv3.id, danny.id, 'outbound', "Hi! Just wanted to confirm your demo appointment for Thursday at 2pm. Does that still work?", danny.phone_number, c3.phone_number, 200);
  await addMsg(conv3.id, null,     'inbound',  "Yes, confirmed! See you then. 🐾",                                                          c3.phone_number, danny.phone_number, 160);
  await linkAgent(conv3.id, danny.id);

  // ── Conversation 4: Austin Animal Center ──
  const { contact: c4, conv: conv4 } = await mkConv('Austin Animal Center', '+15125550312', shawn.id);
  await addMsg(conv4.id, shawn.id, 'outbound', "Hello! Just following up on the demo we had last week — would love to hear your thoughts!", shawn.phone_number, c4.phone_number, 1440);
  await addMsg(conv4.id, null,     'inbound',  "Hi Shawn, we're still reviewing internally. Should have an answer by end of week.",         c4.phone_number, shawn.phone_number, 1380);
  await linkAgent(conv4.id, shawn.id);

  // ── Seed a couple of calls ──
  await pool.query(`
    INSERT INTO calls (conversation_id, agent_id, direction, duration, status, started_at, ended_at)
    VALUES
      ($1, $2, 'outbound', 312,  'completed', $3, $4),
      ($5, $6, 'inbound',  707,  'completed', $7, $8),
      ($9, $10,'outbound', null, 'missed',    $11,$12)
  `, [
    conv1.id, danny.id, ago(90),  ago(85),
    conv2.id, shawn.id, ago(1500),ago(1488),
    conv4.id, raven.id, ago(60),  ago(60),
  ]);

  console.log('[seed] Demo data ready.');
}

module.exports = { seed };
