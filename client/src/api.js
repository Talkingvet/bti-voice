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
  logCallByPhone: (phone, duration, direction, startedAt, callSid) =>
    request('/calls/log-by-phone', { method: 'POST', body: { phone, duration, direction, started_at: startedAt, call_sid: callSid } }),
  newMessage:    ({ to_number, from_agent_id, body }) =>
    request('/conversations/new-message', { method: 'POST', body: { to_number, from_agent_id, body } }),
  activity:      () => request('/activity'),

  // Voicemails
  voicemails:        ()           => request('/calls/voicemails'),
  markVoicemailPlayed: (id)       => request(`/calls/voicemails/${id}/played`, { method: 'PATCH' }),

  // Zoho CRM
  zohoStatus: ()     => request('/zoho/status'),
  zohoTest:   ()     => request('/zoho/test'),

  // Active call controls (hold, resume, blind transfer)
  holdCall:          (callSid)                => request('/calls/hold',     { method: 'POST', body: { callSid } }),
  resumeCall:        (callSid, agentId)       => request('/calls/resume',   { method: 'POST', body: { callSid, agentId } }),
  transferCall:      (callSid, targetAgentId) => request('/calls/transfer', { method: 'POST', body: { callSid, targetAgentId } }),

  // IVR / phone tree
  ivrSettings:       ()           => request('/ivr/settings'),
  ivrSaveSettings:   (data)       => request('/ivr/settings', { method: 'PUT', body: data }),
  ivrMenu:           ()           => request('/ivr/menu'),
  ivrAddItem:        (data)       => request('/ivr/menu', { method: 'POST', body: data }),
  ivrUpdateItem:     (id, data)   => request(`/ivr/menu/${id}`, { method: 'PUT', body: data }),
  ivrDeleteItem:     (id)         => request(`/ivr/menu/${id}`, { method: 'DELETE' }),
}
