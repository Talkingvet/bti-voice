// One-off (Review Pass 2 batch 7, 2026-10-08): remove texts that never went
// through Twilio — fake "sent" outbound rows AND the seeded demo threads.
//
// Why: before batch 7, sending with no Twilio credentials or no agent number
// still INSERTed the message with twilio_sid = NULL (review §3 B2 / §6 F1),
// and the original demo seed (seed.js, SEED_DEMO) wrote whole conversations
// with no SIDs in either direction. Every real path stores the Twilio SID:
// outbound (composer, New Message, Zoho widget, scheduled sweep, after-hours
// auto-reply) and inbound (the SMS webhook stores MessageSid). So
//     twilio_sid IS NULL
// is exactly "never happened". Batch 7 answers 409 instead of inserting, so
// no new rows of this kind can appear — this script cleans up the old ones.
//
// Run from the repo root in Git Bash, once per deploy, with that deploy's
// PUBLIC Postgres URL (Railway → the Postgres service → Variables →
// DATABASE_PUBLIC_URL; the internal DATABASE_URL only works inside Railway).
// Dry run first — it deletes nothing:
//   DATABASE_PUBLIC_URL="postgresql://..." node server/scripts/purge-undelivered.js
//   DATABASE_PUBLIC_URL="postgresql://..." node server/scripts/purge-undelivered.js --apply
//
// Second pass — the demo seed's contacts: seed.js uses 555 numbers
// (+1 NPA 555 XXXX, reserved fictional numbers no real customer can have).
// Everything under such a contact (messages, calls incl. recordings,
// notes, conversations, the contact) is seed data and goes too. A call row
// without a Twilio SID is NOT used as a test — an old client-side "log call"
// path wrote real calls without one.
//
// --apply deletes: those messages, their attachments (message_media cascades),
// any conversation left with no messages and no calls, and any contact left
// with no conversation, no call and no Zoho link (notes/reads cascade; the
// consent log keeps its rows with contact_id set to NULL by design). Refuses to run on a SEED_DEMO deploy,
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
      SELECT m.id, m.conversation_id, m.direction, m.sent_at, m.body, a.name AS agent_name, co.phone_number
      FROM messages m
      LEFT JOIN agents a ON a.id = m.agent_id
      JOIN conversations c ON c.id = m.conversation_id
      JOIN contacts co ON co.id = c.contact_id
      WHERE m.twilio_sid IS NULL
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
          AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.twilio_sid IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM calls ca WHERE ca.conversation_id = c.id)
      `, [convIds]);
      emptyConvs = rows;
    }

    // Contacts that would have nothing left pointing at them
    let orphanContacts = [];
    if (emptyConvs.length) {
      const { rows } = await client.query(`
        SELECT co.id, co.name, co.phone_number
        FROM contacts co
        WHERE co.zoho_contact_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.contact_id = co.id AND NOT (c.id = ANY($1::int[])))
          AND NOT EXISTS (SELECT 1 FROM calls ca JOIN conversations c2 ON c2.id = ca.conversation_id WHERE c2.contact_id = co.id)
          AND EXISTS (SELECT 1 FROM conversations c3 WHERE c3.contact_id = co.id AND c3.id = ANY($1::int[]))
      `, [emptyConvs.map(c => c.id)]);
      orphanContacts = rows;
    }

    // Demo-seed contacts (555 numbers) and everything hanging off them
    const { rows: demoContacts } = await client.query(`
      SELECT co.id, co.name, co.phone_number,
        (SELECT COUNT(*) FROM conversations c WHERE c.contact_id = co.id)::int AS convs,
        (SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.contact_id = co.id)::int AS msgs,
        (SELECT COUNT(*) FROM calls ca JOIN conversations c ON c.id = ca.conversation_id WHERE c.contact_id = co.id)::int AS calls
      FROM contacts co
      WHERE co.phone_number ~ '^\\+1[2-9][0-9]{2}555[0-9]{4}$'
      ORDER BY co.id
    `);

    console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${fake.length} message(s) with no Twilio ID across ${convIds.length} conversation(s); ${emptyConvs.length} conversation(s) and ${orphanContacts.length} contact(s) would be removed entirely.`);
    for (const r of fake) {
      const when = new Date(r.sent_at).toISOString().slice(0, 16).replace('T', ' ');
      console.log(`  msg #${r.id}  ${when}  ${r.direction.padEnd(8)}  conv ${r.conversation_id}  ${r.phone_number}  ${r.agent_name || (r.direction === 'inbound' ? 'customer' : 'system')}  "${(r.body || '').slice(0, 50)}"`);
    }
    for (const c of emptyConvs) console.log(`  conv #${c.id} (${c.name || c.phone_number}) → would be removed (no real messages or calls left)`);
    for (const c of orphanContacts) console.log(`  contact #${c.id} (${c.name || '?'} ${c.phone_number}) → would be removed (nothing left, not linked to Zoho)`);
    console.log(`Demo-seed contacts (555 numbers): ${demoContacts.length}`);
    for (const c of demoContacts) console.log(`  contact #${c.id} ${c.name || '?'} ${c.phone_number} → ${c.convs} conversation(s), ${c.msgs} message(s), ${c.calls} call(s) — all seed data, would be removed`);

    if (!fake.length && !demoContacts.length) { console.log('Nothing to clean up.'); return; }
    if (!APPLY) { console.log('\nDry run only. Re-run with --apply to delete the rows above.'); return; }

    await client.query('BEGIN');
    const msgIds = fake.map(r => r.id);
    const { rowCount: delMsgs } = msgIds.length ? await client.query('DELETE FROM messages WHERE id = ANY($1::int[])', [msgIds]) : { rowCount: 0 };
    let delConvs = 0;
    if (emptyConvs.length) {
      const ids = emptyConvs.map(c => c.id);
      // Tables that reference conversations WITHOUT ON DELETE CASCADE
      await client.query('DELETE FROM conversation_agents WHERE conversation_id = ANY($1::int[])', [ids]);
      ({ rowCount: delConvs } = await client.query('DELETE FROM conversations WHERE id = ANY($1::int[])', [ids]));
    }
    let delContacts = 0;
    if (orphanContacts.length) {
      const cids = orphanContacts.map(c => c.id);
      await client.query('DELETE FROM call_list_entries WHERE contact_id = ANY($1::int[])', [cids]);
      ({ rowCount: delContacts } = await client.query('DELETE FROM contacts WHERE id = ANY($1::int[])', [cids]));
    }
    let demo = { convs: 0, msgs: 0, calls: 0, contacts: 0 };
    if (demoContacts.length) {
      const dcids = demoContacts.map(c => c.id);
      const { rows: dconvs } = await client.query('SELECT id FROM conversations WHERE contact_id = ANY($1::int[])', [dcids]);
      const dconvIds = dconvs.map(c => c.id);
      if (dconvIds.length) {
        const { rows: dcalls } = await client.query('SELECT id FROM calls WHERE conversation_id = ANY($1::int[])', [dconvIds]);
        const dcallIds = dcalls.map(c => c.id);
        if (dcallIds.length) {
          await client.query('UPDATE call_list_attempts SET call_id = NULL WHERE call_id = ANY($1::int[])', [dcallIds]);
          ({ rowCount: demo.calls } = await client.query('DELETE FROM calls WHERE id = ANY($1::int[])', [dcallIds])); // call_recordings cascade
        }
        ({ rowCount: demo.msgs } = await client.query('DELETE FROM messages WHERE conversation_id = ANY($1::int[])', [dconvIds]));
        await client.query('DELETE FROM conversation_agents WHERE conversation_id = ANY($1::int[])', [dconvIds]);
        ({ rowCount: demo.convs } = await client.query('DELETE FROM conversations WHERE id = ANY($1::int[])', [dconvIds])); // notes/reads/scheduled cascade
      }
      await client.query('DELETE FROM call_list_entries WHERE contact_id = ANY($1::int[])', [dcids]);
      ({ rowCount: demo.contacts } = await client.query('DELETE FROM contacts WHERE id = ANY($1::int[])', [dcids]));
    }
    await client.query('COMMIT');
    console.log(`\nDone: deleted ${delMsgs} message(s), ${delConvs} empty conversation(s) and ${delContacts} contact(s); demo seed: ${demo.contacts} contact(s), ${demo.convs} conversation(s), ${demo.msgs} message(s), ${demo.calls} call(s).`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('FAILED — nothing was changed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
