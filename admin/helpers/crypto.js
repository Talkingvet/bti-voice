// AES-256-GCM encryption for tenant admin keys at rest.
//
// A tenant's TENANT_ADMIN_KEY is the only credential that unlocks a customer's
// deploy, so the tenants table never holds it in the clear. The encryption key
// is derived from PORTAL_SECRET with a fixed-purpose salt; the JWT signer uses
// the raw secret, so a leaked token can't be turned into the encryption key.
//
// Stored format: "v1:<iv b64>:<tag b64>:<ciphertext b64>"
const crypto = require('crypto');

function deriveKey(secret) {
  return crypto.scryptSync(String(secret), 'bti-voice-admin:tenant-key:v1', 32);
}

function encrypt(plain, secret) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

function decrypt(stored, secret) {
  const [v, ivB, tagB, ctB] = String(stored).split(':');
  if (v !== 'v1' || !ivB || !tagB || !ctB) throw new Error('Unrecognised ciphertext format');
  const key = deriveKey(secret);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
}

// Last 4 chars, for showing "which key is this" without revealing it.
function hint(plain) {
  const s = String(plain || '');
  return s.length >= 8 ? '…' + s.slice(-4) : '••••';
}

module.exports = { encrypt, decrypt, hint };
