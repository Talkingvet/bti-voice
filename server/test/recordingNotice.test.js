// Unit tests for the once-per-call recording disclosure guard.
// Run with:  npm test   (from server/)  — uses Node's built-in test runner.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { maybeRecordingNotice, recordingActive, _resetForTests } = require('../helpers/recordingNotice');

// Minimal stand-in for a Twilio VoiceResponse: we only care whether .say() fired.
function fakeTwiml() {
  return { said: [], say(msg) { this.said.push(msg); } };
}

function enableRecording() {
  process.env.ENABLE_RECORDING = 'true';
  process.env.SERVER_URL = 'https://example.test';
  process.env.OPENAI_API_KEY = 'sk-test';
}

beforeEach(() => {
  _resetForTests();
  enableRecording();
});

test('plays the disclosure when recording is enabled', () => {
  const twiml = fakeTwiml();
  const played = maybeRecordingNotice(twiml, 'CA001');
  assert.strictEqual(played, true);
  assert.strictEqual(twiml.said.length, 1);
  assert.match(twiml.said[0], /recorded/i);
});

test('does NOT play twice for the same CallSid (the double-disclosure bug)', () => {
  // Simulates the real chain: dialAgent plays it, agent misses,
  // /no-answer -> ringAllAgents used to play it again on the same call.
  const first = fakeTwiml();
  const second = fakeTwiml();
  maybeRecordingNotice(first, 'CA002');
  const playedAgain = maybeRecordingNotice(second, 'CA002');
  assert.strictEqual(playedAgain, false);
  assert.strictEqual(second.said.length, 0, 'second TwiML must stay silent');
});

test('different calls each get their own disclosure', () => {
  const a = fakeTwiml();
  const b = fakeTwiml();
  maybeRecordingNotice(a, 'CA003');
  maybeRecordingNotice(b, 'CA004');
  assert.strictEqual(a.said.length, 1);
  assert.strictEqual(b.said.length, 1);
});

test('missing CallSid fails safe: always plays (compliance over silence)', () => {
  const a = fakeTwiml();
  const b = fakeTwiml();
  maybeRecordingNotice(a, undefined);
  maybeRecordingNotice(b, undefined);
  assert.strictEqual(a.said.length, 1);
  assert.strictEqual(b.said.length, 1);
});

test('no-op when ENABLE_RECORDING is not "true"', () => {
  process.env.ENABLE_RECORDING = 'false';
  const twiml = fakeTwiml();
  assert.strictEqual(maybeRecordingNotice(twiml, 'CA005'), false);
  assert.strictEqual(twiml.said.length, 0);
});

test('no-op when SERVER_URL or OPENAI_API_KEY is missing (matches recordingOpts gate)', () => {
  delete process.env.SERVER_URL;
  const twiml = fakeTwiml();
  assert.strictEqual(maybeRecordingNotice(twiml, 'CA006'), false);
  assert.strictEqual(twiml.said.length, 0);
});

test('recordingActive mirrors the env gate', () => {
  assert.strictEqual(recordingActive(), true);
  process.env.ENABLE_RECORDING = 'false';
  assert.strictEqual(recordingActive(), false);
});
