const test = require('node:test');
const assert = require('node:assert/strict');
const { twilioMediaUrl, isTwilioMediaUrl } = require('../helpers/twilioUrls');

const AC  = 'AC' + '1'.repeat(32);
const AC2 = 'AC' + '2'.repeat(32);
const RE  = 'RE' + 'a'.repeat(32);
const MM  = 'MM' + 'b'.repeat(32);
const ME  = 'ME' + 'c'.repeat(32);
const rec   = `https://api.twilio.com/2010-04-01/Accounts/${AC}/Recordings/${RE}`;
const media = `https://api.twilio.com/2010-04-01/Accounts/${AC}/Messages/${MM}/Media/${ME}`;

test('accepts our recording and MMS media URLs, with or without an extension', () => {
  assert.equal(twilioMediaUrl(rec, AC), rec);
  assert.equal(twilioMediaUrl(rec + '.mp3', AC), rec + '.mp3');
  assert.equal(twilioMediaUrl(rec + '.wav', AC), rec + '.wav');
  assert.equal(twilioMediaUrl(media, AC), media);
  assert.equal(twilioMediaUrl(media.replace('MM', 'SM'), AC), media.replace('MM', 'SM'));
  assert.equal(twilioMediaUrl(`  ${rec}  `, AC), rec, 'trims whitespace');
});

test('the Account in the path must be ours when the account SID is known', () => {
  assert.equal(twilioMediaUrl(rec, AC2), null);
  assert.equal(twilioMediaUrl(rec, undefined), rec, 'shape-only check when no account SID is configured');
});

test('rejects anything that is not api.twilio.com over https with the exact path shape', () => {
  const bad = [
    rec.replace('https', 'http'),
    rec.replace('api.twilio.com', 'api.twilio.com.evil.example'),
    rec.replace('api.twilio.com', 'evil.example'),
    rec.replace('api.twilio.com', 'api.twilio.com:8443'),
    rec.replace('https://', 'https://user:pw@'),
    rec + '?x=1',
    rec + '#frag',
    rec + '.exe',
    rec + '/../../Accounts/' + AC2 + '/Recordings/' + RE,
    `https://api.twilio.com/2010-04-01/Accounts/${AC}/Calls/CA${'d'.repeat(32)}`,
    `https://api.twilio.com/2010-04-01/Accounts/${AC}/Recordings/RE123`,
    `https://api.twilio.com/2010-04-01/Accounts/${AC}/Messages/${MM}/Media/`,
    'https://mms.twiliocdn.com/' + AC + '/' + ME,
    'javascript:alert(1)', '', null, undefined, 5, {}, 'x'.repeat(600),
  ];
  for (const b of bad) assert.equal(twilioMediaUrl(b, AC), null, `should reject ${String(b).slice(0, 80)}`);
  assert.equal(isTwilioMediaUrl(rec, AC), true);
  assert.equal(isTwilioMediaUrl('https://evil.example/' + RE, AC), false);
});
