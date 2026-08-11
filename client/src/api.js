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
  sendMessage:   (conversation_id, body, media_ids) => request('/messages/send', { method: 'POST', body: { conversation_id, body, media_ids } }),
  uploadMedia: async (file) => {
    const res = await fetch(`${BASE}/messages/upload-media`, {
      method: 'POST',
      headers: { 'Content-Type': file.type, Authorization: `Bearer ${getToken()}` },
      body: file,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || 'Upload failed')
    }
    return res.json()
  },
  mediaUrl: (id) => `${BASE}/messages/media/${id}?token=${getToken()}`,
  scheduleMessage: (conversation_id, body, send_at) => request('/messages/schedule', { method: 'POST', body: { conversation_id, body, send_at } }),
  scheduledMessages: (conversation_id) => request(`/messages/scheduled?conversation_id=${conversation_id}`),
  cancelScheduledMessage: (id) => request(`/messages/scheduled/${id}`, { method: 'DELETE' }),
  resolveConv:   (convId)              => request(`/conversations/${convId}/resolve`, { method: 'PATCH' }),
  calls:         ()                    => request('/calls'),
  logCall:       (conversation_id, duration, direction) => request('/calls/log', { method: 'POST', body: { conversation_id, duration, direction } }),
  voiceToken:    ()                    => request('/calls/token', { method: 'POST' }),
  logCallByPhone: (phone, duration, direction, startedAt, callSid) =>
    request('/calls/log-by-phone', { method: 'POST', body: { phone, duration, direction, started_at: startedAt, call_sid: callSid } }),
  ensureConversation: (to_number) => request('/conversations/ensure', { method: 'POST', body: { to_number } }),
  newMessage:    ({ to_number, from_agent_id, body }) =>
    request('/conversations/new-message', { method: 'POST', body: { to_number, from_agent_id, body } }),
  activity:      () => request('/activity'),

  // Voicemails
  voicemails:        ()           => request('/calls/voicemails'),
  markVoicemailPlayed: (id)       => request(`/calls/voicemails/${id}/played`, { method: 'PATCH' }),

  // Zoho CRM
  zohoStatus: ()     => request('/zoho/status'),
  zohoTest:   ()     => request('/zoho/test'),

  // Zoho — used by post-call wrap-up screen (v1.4.0)
  zohoFindContactsByPhone: (phone) => request('/zoho/find-contacts-by-phone', { method: 'POST', body: { phone } }),
  zohoCreateContact:       (data)  => request('/zoho/create-contact',         { method: 'POST', body: data }),
  zohoUsers:               ()      => request('/zoho/users'),

  // Calls — wrap-up screen (v1.4.0)
  getCall:    (id)        => request(`/calls/${id}`),
  wrapUpCall: (id, data)  => request(`/calls/${id}/wrap-up`, { method: 'POST', body: data }),

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

  // Contacts CRUD + Zoho sync
  contacts:          ()           => request('/contacts'),
  createContact:     (data)       => request('/contacts', { method: 'POST', body: data }),
  updateContact:     (id, data)   => request(`/contacts/${id}`, { method: 'PATCH', body: data }),
  syncContactZoho:   (id)         => request(`/contacts/${id}/sync-zoho`, { method: 'POST' }),
  zohoProfile:       (id)         => request(`/contacts/${id}/zoho-profile`),

  // Unread badges
  conversationsUnreadCount: ()   => request('/conversations/unread-count'),
  markConvRead:      (id)         => request(`/conversations/${id}/read`, { method: 'POST' }),

  // Conversation notes
  notes:             (convId)     => request(`/conversations/${convId}/notes`),
  addNote:           (convId, body) => request(`/conversations/${convId}/notes`, { method: 'POST', body: { body } }),
  updateNote:        (convId, noteId, body) => request(`/conversations/${convId}/notes/${noteId}`, { method: 'PATCH', body: { body } }),
  deleteNote:        (convId, noteId) => request(`/conversations/${convId}/notes/${noteId}`, { method: 'DELETE' }),

  // Canned responses
  cannedResponses:   ()           => request('/canned-responses'),
  addCannedResponse: (data)       => request('/canned-responses', { method: 'POST', body: data }),
  updateCannedResponse: (id, data) => request(`/canned-responses/${id}`, { method: 'PATCH', body: data }),
  deleteCannedResponse: (id)      => request(`/canned-responses/${id}`, { method: 'DELETE' }),

  // Quick dial
  quickDial:         ()           => request('/quick-dial'),
  addQuickDial:      (data)       => request('/quick-dial', { method: 'POST', body: data }),
  deleteQuickDial:   (id)         => request(`/quick-dial/${id}`, { method: 'DELETE' }),

  // Agent status
  updateStatus:      (status)     => request('/agents/me/status', { method: 'PATCH', body: { status } }),

  // Conversation assignment
  assignConversation: (convId, agent_id) => request(`/conversations/${convId}/assign`, { method: 'PATCH', body: { agent_id } }),

  // Notifications
  notifications:        ()    => request('/notifications'),
  markNotifRead:        (id)  => request(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllNotifsRead:    ()    => request('/notifications/read-all', { method: 'POST' }),
  dismissNotif:         (id)  => request(`/notifications/${id}`, { method: 'DELETE' }),
  clearReadNotifs:      ()    => request('/notifications', { method: 'DELETE' }),

  // Activity tracking (fire-and-forget)
  track: (event, detail) => request('/track', { method: 'POST', body: { event, detail } }).catch(e => console.warn('[track]', e.message)),
}
