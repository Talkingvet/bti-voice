/* Shared phone-number display helpers — single source of truth for formatting */

export function formatPhone(p) {
  if (!p) return ''
  const d = String(p).replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) {
    return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  }
  if (d.length === 10) {
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  }
  return String(p)
}

/* True when a string is just a phone number (e.g. contact "name" imported as a number) */
export function isPhoneLike(str) {
  if (!str) return false
  return /^\+?[\d\s().-]{7,}$/.test(String(str).trim())
}

/* Real name if there is one, otherwise the formatted number */
export function displayName(name, phone) {
  if (name && !isPhoneLike(name)) return name
  return formatPhone(phone || name) || String(name || 'Unknown')
}

/* Avatar initials; "#" for number-only contacts instead of "+1"/"23" */
export function contactInitials(name, phone) {
  const n = name && !isPhoneLike(name) ? String(name).trim() : null
  if (!n) return '#'
  const p = n.split(/\s+/)
  return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : n.slice(0, 2).toUpperCase()
}
