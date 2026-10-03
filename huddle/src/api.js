// Same server, same login as BTI Voice. VITE_API_URL is set for desktop
// builds; served from Railway it is empty and relative /api is used.
const SERVER = import.meta.env.VITE_API_URL || ''
const BASE   = `${SERVER}/api`

// Shared with BTI Voice on purpose: one BTI login across the family.
export const TOKEN_KEY = 'bti_token'
export const AGENT_KEY = 'bti_huddle_agent'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const getAgent = () => { try { return JSON.parse(localStorage.getItem(AGENT_KEY)) } catch { return null } }
export function setSession(agent, token) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(AGENT_KEY, JSON.stringify(agent))
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(AGENT_KEY)
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  let data = null
  try { data = await res.json() } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`)
    err.status = res.status
    err.code = data && data.code
    throw err
  }
  return data
}

export const api = {
  features:   () => request('/features'),
  login:      (username, password, remember = true) => request('/auth/login', { method: 'POST', body: { username, password, remember } }),
  refresh:    () => request('/auth/refresh', { method: 'POST' }),
  agents:     () => request('/agents'),
  setStatus:  (status) => request('/agents/me/status', { method: 'PATCH', body: { status } }),
  ice:        () => request('/huddle/ice'),
  rooms:      () => request('/huddle/rooms'),
  createRoom: (name) => request('/huddle/rooms', { method: 'POST', body: { name } }),
  room:       (code) => request(`/huddle/rooms/${encodeURIComponent(code)}`),
  // chat
  chats:        () => request('/huddle/chats'),
  createChat:   (type, member_ids, name) => request('/huddle/chats', { method: 'POST', body: { type, member_ids, name } }),
  chatMessages: (id, before) => request(`/huddle/chats/${id}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  sendMessage:  (id, body) => request(`/huddle/chats/${id}/messages`, { method: 'POST', body: { body } }),
  markRead:     (id) => request(`/huddle/chats/${id}/read`, { method: 'POST' }),
  updateChat:   (id, patch) => request(`/huddle/chats/${id}`, { method: 'PATCH', body: patch }),
  addMembers:   (id, agent_ids) => request(`/huddle/chats/${id}/members`, { method: 'POST', body: { agent_ids } }),
  leaveChat:    (id) => request(`/huddle/chats/${id}/members/me`, { method: 'DELETE' }),
}
