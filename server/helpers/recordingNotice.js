// Spoken recording disclosure, guarded so it plays ONCE per call.
//
// Why the guard exists: inbound call paths CHAIN — e.g. dialAgent() plays the
// notice, the agent doesn't answer, Twilio hits /no-answer, ringAllAgents()
// plays it again on the SAME call. Callers heard the disclosure twice (or more)
// before anyone picked up. Compliance needs it spoken once; repeats are just
// annoying.
//
// How: we remember every CallSid we've already played the notice for, in an
// in-memory Map (fine for this single-process server; a restart mid-call would
// at worst repeat the notice once, which is safe). Entries are pruned after
// 4 hours whenever the map grows past 1000 sids, so it can't leak.
//
// Fail-safe direction: if no CallSid is available we PLAY the notice —
// a repeated disclosure is harmless, a missing one is a compliance problem.

const playedSids = new Map(); // CallSid -> first-played timestamp (ms)
const PRUNE_AFTER_MS = 4 * 60 * 60 * 1000; // 4 hours
const PRUNE_THRESHOLD = 1000;              // prune only when the map grows past this

// Same gate as recordingOpts() in webhooks/voice.js: the disclosure is only
// required when recording is actually active.
function recordingActive(env = process.env) {
  if (!(env.ENABLE_RECORDING === 'true' && !!env.SERVER_URL && !!env.OPENAI_API_KEY)) return false;
  // Admin portal Phase 1: BTI can switch recording off per customer without a
  // redeploy (deploy_settings.features.recording = false). Only consulted once
  // the env gate passes, so the unit tests that inject a fake env stay pure.
  if (env === process.env) {
    const { getSettings } = require('./deploySettings');
    if (getSettings().features.recording === false) return false;
  }
  return true;
}

function maybeRecordingNotice(twiml, callSid) {
  if (!recordingActive()) return false;

  if (callSid) {
    if (playedSids.has(callSid)) {
      console.log(`[recording-notice] already played for ${callSid} — skipping repeat`);
      return false;
    }
    playedSids.set(callSid, Date.now());
    if (playedSids.size > PRUNE_THRESHOLD) {
      const cutoff = Date.now() - PRUNE_AFTER_MS;
      for (const [sid, t] of playedSids) {
        if (t < cutoff) playedSids.delete(sid);
      }
    }
  }

  twiml.say('This call may be recorded for quality and training purposes.');
  return true;
}

// Test hook: clear remembered sids between test cases.
function _resetForTests() {
  playedSids.clear();
}

module.exports = { maybeRecordingNotice, recordingActive, _resetForTests };
