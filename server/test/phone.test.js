// Unit tests for phoneVariants — the contact-matching normalizer.
// Getting this wrong created duplicate contacts and split conversations
// (the Kendall bug, 2026-08-12), so lock the behavior down.
const { test } = require('node:test');
const assert = require('node:assert');
const { phoneVariants } = require('../helpers/phone');

test('10-digit US number normalizes to E.164', () => {
  const { e164, variants } = phoneVariants('2395551234');
  assert.strictEqual(e164, '+12395551234');
  assert.ok(variants.includes('2395551234'));
  assert.ok(variants.includes('+12395551234'));
});

test('11-digit with leading 1 normalizes to the same E.164', () => {
  assert.strictEqual(phoneVariants('12395551234').e164, '+12395551234');
});

test('already-E.164 input is unchanged', () => {
  const { e164, variants } = phoneVariants('+12395551234');
  assert.strictEqual(e164, '+12395551234');
  assert.ok(variants.includes('2395551234'), 'must still match legacy 10-digit rows');
});

test('dashed and formatted input normalizes', () => {
  assert.strictEqual(phoneVariants('239-555-1234').e164, '+12395551234');
  assert.strictEqual(phoneVariants('(239) 555-1234').e164, '+12395551234');
  assert.strictEqual(phoneVariants('+1 239 555 1234').e164, '+12395551234');
});

test('all four input formats of one number share an E.164 (dedupe invariant)', () => {
  const forms = ['2395551234', '12395551234', '+12395551234', '239-555-1234'];
  const e164s = new Set(forms.map(f => phoneVariants(f).e164));
  assert.strictEqual(e164s.size, 1);
});

test('variants list is deduped and contains no empty strings', () => {
  const { variants } = phoneVariants('+12395551234');
  assert.strictEqual(new Set(variants).size, variants.length);
  assert.ok(variants.every(v => v.length > 0));
});

test('malformed short number falls back to trimmed input (no fake +1)', () => {
  // e.g. the 9-digit misdial +239595931 from the call-137 incident
  const { e164 } = phoneVariants('+239595931');
  assert.strictEqual(e164, '+239595931');
});

test('empty and null input do not throw', () => {
  assert.deepStrictEqual(phoneVariants('').variants, []);
  assert.doesNotThrow(() => phoneVariants(null));
  assert.doesNotThrow(() => phoneVariants(undefined));
});
