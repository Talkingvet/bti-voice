// VITE_API_URL is set at build time for the Electron desktop build.
// When served from the Railway server directly it is empty → relative /api is used.
const SERVER = import.meta.env.VITE_API_URL || ''
const BASE   = `${SERVER}/api`

function getToken() {
  return localStorage.getItem('bti_token')
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

export const api = {
  login:         (username, password)  => request('/auth/login', { method: 'POST', body: { username, password } }),
  me:            ()                    => request('/auth/me'),
  agents:        ()                    => request('/agents'),
  conversations: ()                    => request('/conversations'),
  messages:      (convId)              => request(`/conversations/${convId}/messages`),
  sendMessage:   (conversation_id, body) => request('/messages/send', { method: 'POST', body: { conversation_id, body } }),
  resolveConv:   (convId)              => request(`/conversations/${convId}/resolve`, { method: 'PATCH' }),
  calls:         ()                    => request('/calls'),
  logCall:       (conversation_id, duration, direction) => request('/calls/log', { method: 'POST', body: { conversation_id, duration, direction } }),
  voiceToken:    ()                    => request('/calls/token', { method: 'POST' }),
  newMessage:    ({ to_number, from_agent_id, body }) =>
    request('/conversations/new-message', { method: 'POST', body: { to_number, from_agent_id, body } }),
  activity:      () => request('/activity'),
}
