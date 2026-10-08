// One-off (Review Pass 2 batch 7, 2026-10-08): remove outbound texts that
// were stored as "sent" but never went through Twilio.
//
// Why: before batch 7, sending with no Twilio credentials or no agent number
// still INSERTed the message with twilio_sid = NULL (review §3 B2 / §6 F1).
// Every real send path (composer, New Message, Zoho widget, scheduled sweep,
// after-hours auto-reply) stores the Twilio SID, so
//     direction = 'outbound' AND twilio_sid IS NULL
// is exactly "never delivered". Batch 7 answers 409 instead, so no new rows
// of this kind can appear — this script cleans up the old ones.
//
// Run from the repo root in Git Bash, once per deploy, with that deploy's
// PUBLIC Postgres URL (Railway → the Postgres service → Variables →
// DATABASE_PUBLIC_URL; the internal DATABASE_URL only works inside Railway).
// Dry run first — it deletes nothing:
//   DATABASE_PUBLIC_URL="postgresql://..." node server/scripts/purge-undelivered.js
//   DATABASE_PUBLIC_URL="postgresql://..." node server/scripts/purge-undelivered.js --apply
//
// --apply deletes: those messages, their attachments (message_media cascades),
// and any conversation that is left with no messages and no calls (its
// contact row, notes and reads stay). Refuses to run on a SEED_DEMO deploy,
// whose demo chatter has no SIDs on purpose.

// Prefer the public URL (reachable from a PC); Railway's proxy needs TLS.
if (process.env.DATABASE_PUBLIC_URL) process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';
const { pool } = require('../db'); // same connection/SSL rules as the app

const APPLY = process.argv.includes('--apply');

(async () => {
  if (process.env.SEED_DEMO === 'true') {
    console.log('SEED_DEMO=true on this deploy — demo messages have no Twilio SID by design. Nothing done.');
    process.exit(0);
  }
  if (!process.env.DATABASE_URL) {
    console.error('Set DATABASE_PUBLIC_URL (Railway → Postgres service → Variables) before running this.');
    process.exit(1);
  }
  const client = await pool.connect();
  try {
    const { rows: fake } = await client.query(`
      SELECT m.id, m.conversation_id, m.sent_at, m.body, a.name AS agent_name, co.phone_number
      FROM messages m
      LEFT JOIN agents a ON a.id = m.agent_id
      JOIN conversations c ON c.id = m.conversation_id
      JOIN contacts co ON co.id = c.contact_id
      WHERE m.direction = 'outbound' AND m.twilio_sid IS NULL
      ORDER BY m.sent_at
    `);
    const convIds = [...new Set(fake.map(r => r.conversation_id))];

    // Conversations that would be empty once the fake rows are gone
    let emptyConvs = [];
    if (convIds.length) {
      const { rows } = await client.query(`
        SELECT c.id, co.name, co.phone_number
        FROM conversations c
        JOIN contacts co ON co.id = c.contact_id
        WHERE c.id = ANY($1::int[])
          AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND NOT (m.direction = 'outbound' AND m.twilio_sid IS NULL))
          AND NOT EXISTS (SELECT 1 FROM calls ca WHERE ca.conversation_id = c.id)
      `, [convIds]);
      emptyConvs = rows;
    }

    console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${fake.length} fake outbound message(s) across ${convIds.length} conversation(s); ${emptyConvs.length} conversation(s) would be removed entirely.`);
    for (const r of fake) {
      const when = new Date(r.sent_at).toISOString().slice(0, 16).replace('T', ' ');
      console.log(`  msg #${r.id}  ${when}  conv ${r.conversation_id}  to ${r.phone_number}  by ${r.agent_name || 'system'}  "${(r.body || '').slice(0, 50)}"`);
    }
    for (const c of emptyConvs) console.log(`  conv #${c.id} (${c.name || c.phone_number}) → would be removed (no real messages or calls left)`);

    if (!fake.length) { console.log('Nothing to clean up.'); return; }
    if (!APPLY) { console.log('\nDry run only. Re-run with --apply to delete the rows above.'); return; }

    await client.query('BEGIN');
    const msgIds = fake.map(r => r.id);
    const { rowCount: delMsgs } = await client.query('DELETE FROM messages WHERE id = ANY($1::int[])', [msgIds]);
    let delConvs = 0;
    if (emptyConvs.length) {
      const ids = emptyConvs.map(c => c.id);
      // Tables that reference conversations WITHOUT ON DELETE CASCADE
      await client.query('DELETE FROM conversation_agents WHERE conversation_id = ANY($1::int[])', [ids]);
      ({ rowCount: delConvs } = await client.query('DELETE FROM conversations WHERE id = ANY($1::int[])', [ids]));
    }
    await client.query('COMMIT');
    console.log(`\nDone: deleted ${delMsgs} message(s) and ${delConvs} empty conversation(s).`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('FAILED — nothing was changed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
