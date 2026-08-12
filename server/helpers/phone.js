// Phone normalization — single source of truth for matching contacts.
// Contacts are stored E.164 (+1XXXXXXXXXX) by routes/contacts.js, but
// legacy rows and hand-typed input come in as 10-digit, 11-digit, or
// dashed formats. Always look up by all variants and insert as E.164.
function phoneVariants(raw) {
  const trimmed = String(raw || '').trim()
  const digits  = trimmed.replace(/\D/g, '')
  const ten     = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  const e164    = ten.length === 10 ? '+1' + ten : trimmed
  const variants = [...new Set([e164, trimmed, ten, digits])].filter(Boolean)
  return { e164, variants }
}

module.exports = { phoneVariants }
