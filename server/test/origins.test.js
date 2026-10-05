const test = require('node:test');
const assert = require('node:assert/strict');
const { allowedOrigins, isAllowedOrigin, corsOriginFn } = require('../helpers/origins');

test('mobile app origins are always allowed', () => {
  assert.equal(isAllowedOrigin('capacitor://localhost', {}), true); // iOS
  assert.equal(isAllowedOrigin('https://localhost', {}), true);     // Android (androidScheme=https)
  assert.equal(isAllowedOrigin('http://localhost', {}), true);
});

test('SERVER_URL is added, trailing slash and path tolerated', () => {
  const env = { SERVER_URL: 'https://bti-voice-production.up.railway.app/' };
  assert.ok(allowedOrigins(env).includes('https://bti-voice-production.up.railway.app'));
  assert.equal(isAllowedOrigin('https://bti-voice-production.up.railway.app', env), true);
});

test('a malformed SERVER_URL does not throw', () => {
  assert.doesNotThrow(() => allowedOrigins({ SERVER_URL: 'not a url' }));
});

test('CORS_ORIGINS adds extra origins', () => {
  const env = { CORS_ORIGINS: 'https://app.btivoice.com, https://admin.btivoice.com/' };
  assert.equal(isAllowedOrigin('https://app.btivoice.com', env), true);
  assert.equal(isAllowedOrigin('https://admin.btivoice.com', env), true);
});

test('any localhost port is allowed (vite dev server)', () => {
  assert.equal(isAllowedOrigin('http://localhost:5173', {}), true);
  assert.equal(isAllowedOrigin('http://localhost.evil.com', {}), false);
});

test('unknown origins are rejected; missing Origin header is allowed', () => {
  assert.equal(isAllowedOrigin('https://evil.example', {}), false);
  assert.equal(isAllowedOrigin(undefined, {}), true);
});

test('corsOriginFn matches the cors/socket.io callback shape', () => {
  const fn = corsOriginFn({});
  fn('https://evil.example', (err, ok) => { assert.equal(err, null); assert.equal(ok, false); });
  fn('capacitor://localhost', (err, ok) => { assert.equal(err, null); assert.equal(ok, true); });
});
