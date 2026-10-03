// BTI Huddle — video calls, screen share, meeting links (v0.1, 2026-10-02).
//
// Design: media is peer-to-peer WebRTC between the participants' browsers /
// desktop apps. The server only does three small things:
//   1. hands out short-lived STUN/TURN credentials (Twilio Network Traversal
//      Service, billed per GB relayed — pennies for an internal team) so calls
//      connect through home routers and VPNs;
//   2. stores meeting-room codes so a link like /huddle/m/brisk-otter-42 keeps
//      working across server restarts;
//   3. relays signaling (offers/answers/ICE) over the existing socket.io
//      connection — see ../socket.js, section "Huddle".
//
// Everything here is gated by the `huddle` feature flag (ENABLE_HUDDLE=true on
// the deploy). With the flag off every endpoint 404s, so Voice-only deploys
// never expose a Huddle surface.

const express = require('express');
const crypto  = require('crypto');
const { pool } = require('../db');
const { requireAuth } = require('../auth');
const { featureOn } = require('../helpers/deploySettings');

const router = express.Router();

// Flag gate — before auth so the response is identical for everyone.
router.use((req, res, next) => {
  if (!featureOn('huddle')) return res.status(404).json({ error: 'Not found' });
  next();
});
router.use(requireAuth);

// ── ICE servers (STUN/TURN) ──────────────────────────────────────────────────
// Twilio NTS tokens are valid for a configurable TTL; we ask for 1 hour, which
// comfortably covers one call. Cached for 50 min per process so a burst of
// participants joining doesn't mint a token each.
let iceCache = { servers: null, expires: 0 };

async function getIceServers() {
  if (iceCache.servers && Date.now() < iceCache.expires) return iceCache.servers;
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    // No Twilio creds → public STUN only. Works on the same LAN / simple NATs.
    return [{ urls: 'stun:stun.l.google.com:19302' }];
  }
  try {
    const client = require('twilio')(sid, token);
    const t = await client.tokens.create({ ttl: 3600 });
    iceCache = { servers: t.iceServers, expires: Date.now() + 50 * 60 * 1000 };
    return t.iceServers;
  } catch (e) {
    console.error('[huddle] Twilio NTS token failed, falling back to STUN only:', e.message);
    return [{ urls: 'stun:stun.l.google.com:19302' }];
  }
}

router.get('/ice', async (req, res) => {
  res.json({ iceServers: await getIceServers() });
});

// ── Meeting rooms ────────────────────────────────────────────────────────────
const WORDS_A = ['brisk', 'calm', 'bold', 'bright', 'quick', 'quiet', 'sunny', 'swift', 'warm', 'keen'];
const WORDS_B = ['otter', 'heron', 'maple', 'cedar', 'falcon', 'river', 'harbor', 'meadow', 'summit', 'pelican'];

function makeCode() {
  const a = WORDS_A[crypto.randomInt(WORDS_A.length)];
  const b = WORDS_B[crypto.randomInt(WORDS_B.length)];
  return `${a}-${b}-${crypto.randomInt(10, 99)}`;
}

// POST /rooms { name? } → { code, name, url }
router.post('/rooms', async (req, res) => {
  const name = (req.body && typeof req.body.name === 'string') ? req.body.name.trim().slice(0, 80) : null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode();
    try {
      const { rows } = await pool.query(
        'INSERT INTO huddle_rooms (code, name, created_by) VALUES ($1, $2, $3) RETURNING code, name, created_at',
        [code, name || null, req.agent.id]
      );
      return res.json({ ...rows[0], url: `/huddle/m/${code}` });
    } catch (e) {
      if (e.code === '23505') continue; // unique violation — try another code
      console.error('[huddle/rooms]', e);
      return res.status(500).json({ error: 'Server error' });
    }
  }
  res.status(500).json({ error: 'Could not allocate a room code' });
});

// GET /rooms → recent rooms this deploy has created (for the "Meetings" list)
router.get('/rooms', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.code, r.name, r.created_at, r.last_used_at, a.name AS created_by_name
         FROM huddle_rooms r LEFT JOIN agents a ON a.id = r.created_by
        ORDER BY COALESCE(r.last_used_at, r.created_at) DESC LIMIT 50`
    );
    res.json(rows);
  } catch (e) {
    console.error('[huddle/rooms:list]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /rooms/:code → 200 if it exists (joining a link), 404 otherwise
router.get('/rooms/:code', async (req, res) => {
  const code = String(req.params.code || '').toLowerCase();
  if (!/^[a-z]+-[a-z]+-\d{2}$/.test(code)) return res.status(404).json({ error: 'Not found' });
  try {
    const { rows } = await pool.query(
      'UPDATE huddle_rooms SET last_used_at = NOW() WHERE code = $1 RETURNING code, name, created_at',
      [code]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('[huddle/rooms/:code]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
