const test = require('node:test');
const assert = require('node:assert/strict');
const { createThrottle } = require('../helpers/loginThrottle');

function clock(start = 1_000_000) { let t = start; return { now: () => t, tick: (ms) => { t += ms; } }; }

test('not throttled before 10 failures, throttled at 10', () => {
  const c = clock(); const th = createThrottle({ now: c.now });
  for (let i = 0; i < 9; i++) th.recordFailure('danny');
  assert.equal(th.throttled('danny'), false);
  th.recordFailure('danny');
  assert.equal(th.throttled('danny'), true);
});

test('throttle is per username', () => {
  const th = createThrottle({ now: clock().now });
  for (let i = 0; i < 10; i++) th.recordFailure('danny');
  assert.equal(th.throttled('danny'), true);
  assert.equal(th.throttled('paul'), false);
});

test('window expires after 15 minutes', () => {
  const c = clock(); const th = createThrottle({ now: c.now });
  for (let i = 0; i < 10; i++) th.recordFailure('danny');
  c.tick(15 * 60 * 1000 - 1);
  assert.equal(th.throttled('danny'), true);
  c.tick(2);
  assert.equal(th.throttled('danny'), false);
  // next failure starts a fresh window with count 1
  th.recordFailure('danny');
  assert.equal(th.throttled('danny'), false);
});

test('successful login clears failures', () => {
  const th = createThrottle({ now: clock().now });
  for (let i = 0; i < 10; i++) th.recordFailure('danny');
  th.clearFailures('danny');
  assert.equal(th.throttled('danny'), false);
});

test('unknown username is never throttled', () => {
  const th = createThrottle();
  assert.equal(th.throttled('nobody'), false);
});
