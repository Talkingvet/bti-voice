// server/helpers/btiVoiceModule.js
// Writes call + SMS activity into the custom Zoho module "BTI Voice"
// (API name BTI_Voice, created 2026-08-14). Replaces the old POST /Notes path.
//
// Records are upserted on BTI_Ref so retries and rebuilds are idempotent:
//   SMS   -> one live-appending daily digest per contact:  sms-YYYY-MM-DD-+1XXXXXXXXXX
//   Calls -> one record per call:                          call-<bti call id>
//
// Field API names confirmed against the live module 2026-08-14: Name (Subject),
// Type (Call/SMS), Direction (Inbound/Outbound/Missed/Voicemail), Agent,
// Phone_Number, Activity_Time, Duration, Recording_URL, Transcript, AI_Summary,
// Message_Log, Contact (lookup), Lead (lookup), BTI_Ref.

const { pool }    = require('../db');
const { zohoAPI } = require('../zoho');

const TEXTAREA_CAP = 30000; // Zoho large textarea limit is 32k; stay under it

function truncate(text, cap) {
  const t = String(text || '');
  if (t.length <= cap) return t;
  // Keep the TAIL for digests (newest messages matter most)
  return '… [truncated]\n' + t.slice(t.length - cap);
}

function zohoDatetime(d) {
  return new Date(d).toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

function mmss(sec) {
  const s = Math.max(0, parseInt(sec, 10) || 0);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// Attach the Contact OR Lead lookup based on the resolved module.
function attachLookup(record, zohoId, zohoModule) {
  if (!zohoId) return;
  if (zohoModule === 'Leads') record.Lead = { id: zohoId };
  else                        record.Contact = { id: zohoId };
}

// ── Upsert one record into BTI_Voice keyed on BTI_Ref ─────────────────────────
async function upsertBtiVoiceRecord(record) {
  if (!record.BTI_Ref) throw new Error('BTI_Ref is required for BTI_Voice upsert');
  const result = await zohoAPI('POST', '/BTI_Voice/upsert', {
    data: [record],
    duplicate_check_fields: ['BTI_Ref'],
  });
  const row = result && result.data && result.data[0];
  if (!row || row.status === 'error') {
    throw Object.assign(new Error('[Zoho] BTI_Voice upsert failed'), { body: row });
  }
  return row.details; // { id, ... }
}

// ── Business timezone (for the digest's day boundary) ─────────────────────────
async function businessTimezone() {
  try {
    const { rows: [cfg] } = await pool.query(
      'SELECT business_timezone FROM ivr_settings WHERE id = 1 LIMIT 1'
    );
    return (cfg && cfg.business_timezone) || 'America/New_York';
  } catch (e) {
    return 'America/New_York';
  }
}

function localDayString(date, tz) {
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(date));
}

function localTimeString(date, tz) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(date));
}

// ── SMS: rebuild + upsert the daily digest for one contact/day ────────────────
// Rebuilding the whole day from our DB (rather than appending) makes the digest
// self-healing: retries, out-of-order webhooks and edits all converge.
async function upsertSmsDigest({ conversationId, phoneNumber, contactName, when, zohoId, zohoModule }) {
  const tz  = await businessTimezone();
  const day = localDayString(when, tz);

  const { rows: msgs } = await pool.query(
    "SELECT m.direction, m.body, m.sent_at, a.name AS agent_name, " +
    "       EXISTS (SELECT 1 FROM message_media mm WHERE mm.message_id = m.id) AS has_media " +
    "FROM messages m LEFT JOIN agents a ON a.id = m.agent_id " +
    "WHERE m.conversation_id = $1 " +
    "  AND ((m.sent_at AT TIME ZONE 'UTC') AT TIME ZONE $2)::date = $3::date " +
    "ORDER BY m.sent_at ASC",
    [conversationId, tz, day]
  );
  if (!msgs.length) return null;

  const lines = msgs.map(m => {
    const t    = localTimeString(m.sent_at, tz);
    const who  = m.direction === 'inbound' ? (contactName || phoneNumber) : (m.agent_name || 'BTI Voice');
    const tag  = m.direction === 'inbound' ? '←' : '→';
    const body = (m.body || '') + (m.has_media ? (m.body ? ' ' : '') + '[attachment]' : '');
    return '[' + t + '] ' + tag + ' ' + who + ': ' + body;
  });

  const agentNames = [...new Set(msgs.filter(m => m.direction !== 'inbound' && m.agent_name).map(m => m.agent_name))];
  const lastMsg    = msgs[msgs.length - 1];

  const record = {
    Name:          ('SMS - ' + (contactName || phoneNumber) + ' - ' + day).slice(0, 120),
    Type:          'SMS',
    Direction:     lastMsg.direction === 'inbound' ? 'Inbound' : 'Outbound',
    Agent:         agentNames.join(', ').slice(0, 255) || null,
    Phone_Number:  phoneNumber,
    Activity_Time: zohoDatetime(lastMsg.sent_at),
    Message_Log:   truncate(lines.join('\n'), TEXTAREA_CAP),
    BTI_Ref:       'sms-' + day + '-' + phoneNumber,
  };
  attachLookup(record, zohoId, zohoModule);
  return upsertBtiVoiceRecord(record);
}

// ── Calls: one record per call ────────────────────────────────────────────────
// callRow needs: id, direction, status, duration, started_at, phone_number,
// contact_name, agent_name, recording_url, transcription, ai_summary.
async function upsertCallRecord(callRow, zohoId, zohoModule) {
  const direction = callRow.status === 'voicemail' ? 'Voicemail'
                  : callRow.status === 'missed'    ? 'Missed'
                  : callRow.direction === 'inbound' ? 'Inbound'
                  : 'Outbound';
  const day = localDayString(callRow.started_at || Date.now(), await businessTimezone());

  const record = {
    Name:          (direction + ' call - ' + (callRow.contact_name || callRow.phone_number) + ' - ' + day).slice(0, 120),
    Type:          'Call',
    Direction:     direction,
    Agent:         callRow.agent_name || null,
    Phone_Number:  callRow.phone_number,
    Activity_Time: zohoDatetime(callRow.started_at || Date.now()),
    Duration:      mmss(callRow.duration),
    BTI_Ref:       'call-' + callRow.id,
  };
  if (callRow.recording_url) record.Recording_URL = callRow.recording_url;
  if (callRow.transcription) record.Transcript    = truncate(callRow.transcription, TEXTAREA_CAP);
  if (callRow.ai_summary)    record.AI_Summary    = truncate(callRow.ai_summary, TEXTAREA_CAP);
  attachLookup(record, zohoId, zohoModule);
  return upsertBtiVoiceRecord(record);
}

module.exports = { upsertBtiVoiceRecord, upsertSmsDigest, upsertCallRecord, mmss, zohoDatetime };
