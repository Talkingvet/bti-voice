import { useState, useEffect, useCallback, useRef } from 'react'
import { BRAND } from './brand'

document.title = BRAND
import { Device } from '@twilio/voice-sdk'
import { ThemeProvider, useTheme } from './ThemeContext'
import { ToastProvider } from './components/Toast'
import { useColors }               from './useColors'
import { getSocket, disconnectSocket } from './socket'
import { startRingtone, stopRingtone, playConnected, playDisconnected, getSoundPrefs } from './dtmf'
import Login                       from './pages/Login'
import TitleBar                    from './components/TitleBar'
import BottomNav                   from './components/BottomNav'
import NotificationsPanel          from './components/NotificationsPanel'
import NewMessageModal             from './components/NewMessageModal'
import ActiveCallPanel             from './components/ActiveCallPanel'
import PostCallScreen             from './components/PostCallScreen'
import SMSTab                      from './components/tabs/SMSTab'
import DialpadTab                  from './components/tabs/DialpadTab'
import ContactsTab                 from './components/tabs/ContactsTab'
import CallsTab                    from './components/tabs/CallsTab'
import SettingsTab                 from './components/tabs/SettingsTab'
import { api, ensureMediaToken, clearMediaToken } from './api'
import { applyFont } from './utils/font'

const BASE_AT_KEY   = 'bti_notif_base_at'
const READ_KEYS_KEY = 'bti_notif_read_keys'

function loadReadKeys() {
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEYS_KEY) || '[]')) } catch { return new Set() }
}
function saveReadKeys(set) {
  localStorage.setItem(READ_KEYS_KEY, JSON.stringify([...set]))
}

function AppInner() {
  const { theme } = useTheme()
  const C = useColors()
  const isDark = theme === 'dark'

  const [agent,      setAgent]      = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [activeTab,  setActiveTab]  = useState('dialpad')
  const [navConvId,  setNavConvId]  = useState(null)   // deep-link into a specific SMS conversation
  const [autoDialNumber, setAutoDialNumber] = useState(null) // click-to-call: number DialpadTab should dial on mount
  const [smsOpenChat, setSmsOpenChat] = useState(false) // true when a conversation thread is open
  const [agentStatus, setAgentStatus] = useState('online')
  const [compose,      setCompose]      = useState(false)
  const [notifOpen,    setNotifOpen]    = useState(false)
  const [activity,     setActivity]     = useState([])
  const [unreadNotifs, setUnreadNotifs] = useState(0)  // badge on Notifications tab
  const [unreadSms,    setUnreadSms]    = useState(0)  // badge on Messages tab
  const [unreadVm,     setUnreadVm]     = useState(0)  // badge on Calls tab (voicemails)

  // Per-item read tracking (individual) + base timestamp (everything before this is auto-old)
  const [baseAt,    setBaseAt]    = useState(() => {
    const stored = localStorage.getItem(BASE_AT_KEY)
    if (stored) return new Date(stored)
    // First run: treat everything up to now as already seen so the bell doesn't
    // show the entire message history (that's the "63 unread" bug).
    const now = new Date()
    localStorage.setItem(BASE_AT_KEY, now.toISOString())
    return now
  })
  const [readKeys,  setReadKeys]  = useState(() => loadReadKeys())

  // ── Twilio Device (app-level — stays registered on any tab) ──────────────────
  const [twilioDevice,  setTwilioDevice]  = useState(null)
  const [incomingCall,  setIncomingCall]  = useState(null)
  const [activeCall,    setActiveCall]    = useState(null)
  const [callerInfo,    setCallerInfo]    = useState(null)  // { phone, name }
  const [wrapUpCall,    setWrapUpCall]    = useState(null)  // { id, phone, contact_name, duration, direction } — opens post-call screen
  const [deviceStatus,  setDeviceStatus]  = useState('idle') // 'idle' | 'registering' | 'registered' | 'unregistered' | 'error'
  const deviceRef    = useRef(null)
  const callStartRef = useRef(null)   // timestamp when call was answered
  const activeCallRef = useRef(null)  // mirrors activeCall state — accessible in IPC closures
  const handlingEndRef = useRef(false)  // dedup flag for handleCallEnded — prevents double-fire when SDK disconnect AND onHangup both invoke it

  useEffect(() => {
    if (!agent) return
    let mounted = true

    async function initDevice() {
      try {
        setDeviceStatus('registering')
        const { token } = await api.voiceToken()
        if (!mounted) return

        const device = new Device(token, {
          logLevel: 'warn',
          codecPreferences: ['opus', 'pcmu'],
        })

        device.on('registered', () => {
          console.log('[Twilio] Device registered — ready for incoming calls')
          if (mounted) setDeviceStatus('registered')
        })

        device.on('unregistered', async () => {
          console.warn('[Twilio] Device unregistered — attempting re-register…')
          if (!mounted) return
          setDeviceStatus('unregistered')
          // Auto re-register: refresh token first, then register
          try {
            const { token: t } = await api.voiceToken()
            if (!mounted) return
            device.updateToken(t)
            await device.register()
          } catch (e) {
            console.error('[Twilio] re-register failed', e)
            if (mounted) setDeviceStatus('error')
          }
        })

        device.on('incoming', call => {
          if (!mounted) return
          // Auto-dismiss if caller hangs up before agent answers
          // Note: do NOT log here — the Twilio status webhook handles missed/cancelled inbound calls
          call.on('cancel', () => {
            stopRingtone()
            setIncomingCall(null)
            window.electronAPI?.dismissIncomingCall?.()
          })
          startRingtone()
          setIncomingCall(call)
          // Tell Electron so it can grab the user's attention when BTI Voice
          // is hidden / on another Space: bring window to front, bounce the
          // dock icon, and post a native OS notification with the caller's #.
          window.electronAPI?.notifyIncomingCall?.({
            from: call.parameters?.From || 'Unknown number',
          })
        })

        device.on('tokenWillExpire', async () => {
          try {
            const { token: t } = await api.voiceToken()
            device.updateToken(t)
          } catch (e) { console.error('[Twilio] token refresh failed', e) }
        })

        device.on('error', err => {
          console.error('[Twilio Device]', err)
          if (mounted) setDeviceStatus('error')
        })

        // Apply noise suppression / echo cancellation from user prefs
        const applyAudioConstraints = (dev) => {
          const { noiseSuppression } = getSoundPrefs()
          dev.audio.setAudioConstraints({
            noiseSuppression:  !!noiseSuppression,
            echoCancellation:  true,
            autoGainControl:   !!noiseSuppression,
          }).catch(console.warn)
        }
        applyAudioConstraints(device)

        // Listen for live pref changes from Settings toggle
        const onPrefChange = () => applyAudioConstraints(device)
        window.addEventListener('bti_noise_pref_change', onPrefChange)

        await device.register()
        deviceRef.current = device
        deviceRef._cleanupNoise = () => window.removeEventListener('bti_noise_pref_change', onPrefChange)
        if (mounted) setTwilioDevice(device)
        // 'registered' event fires after register() resolves, but set it here as a fallback
        if (mounted) setDeviceStatus('registered')
      } catch (e) {
        console.error('[Twilio init]', e)
        if (mounted) setDeviceStatus('error')
      }
    }

    initDevice()
    return () => {
      mounted = false
      stopRingtone()
      if (deviceRef._cleanupNoise) { deviceRef._cleanupNoise(); deviceRef._cleanupNoise = null }
      if (deviceRef.current) { deviceRef.current.destroy(); deviceRef.current = null }
      setDeviceStatus('idle')
    }
  }, [agent])

  // ── Apply saved UI density on startup ────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.setZoom) return
    const saved = localStorage.getItem('bti_density') || 'normal'
    const DENSITY = { compact: { factor: 0.82, w: 345, h: 595 }, normal: { factor: 1.0, w: 420, h: 720 }, comfortable: { factor: 1.12, w: 470, h: 806 } }
    const d = DENSITY[saved] || DENSITY.normal
    window.electronAPI.setZoom(d.factor, d.w, d.h)
  }, [])

  // ── Default-password nag banner ──────────────────────────────────────────────
  const [defaultPw, setDefaultPw] = useState(false)
  useEffect(() => {
    const clear = () => setDefaultPw(false)
    window.addEventListener('bti-password-changed', clear)
    return () => window.removeEventListener('bti-password-changed', clear)
  }, [])

  // ── Apply saved font on startup ───────────────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem('bti_font') || 'system'
    applyFont(saved)
  }, [])

  // ── Auth check on mount ───────────────────────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('bti_token')
    if (token) {
      api.me()
        .then(data => { setAgent(data); setAgentStatus(data.status || 'online') })
        .catch(() => localStorage.removeItem('bti_token'))
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  // ── Short-lived media token (images / recording audio URLs) ──────────────────
  useEffect(() => {
    if (!agent) return
    ensureMediaToken()
    const iv = setInterval(ensureMediaToken, 5 * 60 * 1000)
    return () => clearInterval(iv)
  }, [agent])

  // ── Activity feed ─────────────────────────────────────────────────────────────
  const loadActivity = useCallback(() => {
    api.activity().then(setActivity).catch(console.error)
  }, [])

  useEffect(() => {
    if (!agent) return
    loadActivity()
    const socket = getSocket()
    socket.on('conversation_updated', loadActivity)
    socket.on('call_logged', loadActivity)   // refresh activity when calls are logged
    return () => {
      socket.off('conversation_updated', loadActivity)
      socket.off('call_logged', loadActivity)
    }
  }, [agent, loadActivity])

  // Load initial unread notification count + listen for new ones
  useEffect(() => {
    if (!agent) return
    api.notifications().then(data => {
      setUnreadNotifs(data.filter(n => !n.read).length)
    }).catch(() => {})
    const socket = getSocket()
    function handleNewNotif() {
      // Only bump badge if not already on the notifications tab
      setActiveTab(prev => {
        if (prev !== 'notifications') setUnreadNotifs(c => c + 1)
        return prev
      })
    }
    socket.on('notification', handleNewNotif)
    return () => socket.off('notification', handleNewNotif)
  }, [agent])

  // Clear badge when user opens the notifications tab
  useEffect(() => {
    if (activeTab === 'sms')           setUnreadSms(0)
    if (activeTab === 'calls')         setUnreadVm(0)
  }, [activeTab])

  // ── Mac dock badge ───────────────────────────────────────────────
  // Push the total unread count to the Electron main process so it can
  // show a red badge on the dock icon (Mac) — same UX as Mail/Messages.
  // No-op in browser; harmless on Windows (main process ignores it there).
  useEffect(() => {
    if (!window.electronAPI?.setUnreadCount) return
    window.electronAPI.setUnreadCount(unreadSms + unreadVm + unreadNotifs)
  }, [unreadSms, unreadVm, unreadNotifs])

  // ── Mac app menu / tray "Settings…" entry point ──────────────────
  // The Electron menu sends an "open-settings" IPC when the user picks
  // Settings… (or Cmd+,) — switch the active tab to settings in response.
  useEffect(() => {
    if (!window.electronAPI?.onOpenSettings) return
    return window.electronAPI.onOpenSettings(() => setActiveTab('settings'))
  }, [])

  // Track app open + tab navigation (fire-and-forget, only when logged in)
  const trackedOpen = useRef(false)
  useEffect(() => {
    if (!agent) return
    if (!trackedOpen.current) {
      trackedOpen.current = true
      api.track('app_open')
    }
    api.track(`tab_${activeTab}`)
  }, [activeTab, agent])

  // SMS unread badge — fetch count on load + refresh on conversation_updated socket
  useEffect(() => {
    if (!agent) return
    const fetchSmsUnread = () => {
      api.conversationsUnreadCount()
        .then(({ count }) => setUnreadSms(count))
        .catch(() => {})
    }
    fetchSmsUnread()
    const socket = getSocket()
    socket.on('conversation_updated', fetchSmsUnread)
    return () => socket.off('conversation_updated', fetchSmsUnread)
  }, [agent])

  // Voicemail badge — fetch unplayed count on load + increment on new_voicemail socket
  useEffect(() => {
    if (!agent) return
    api.voicemails()
      .then(vms => setUnreadVm(vms.filter(v => !v.played).length))
      .catch(() => {})
    const socket = getSocket()
    const onNewVm = () => setUnreadVm(c => c + 1)
    socket.on('new_voicemail', onNewVm)
    return () => socket.off('new_voicemail', onNewVm)
  }, [agent])

  // Sync own status in real-time when another session changes it
  useEffect(() => {
    if (!agent) return
    const socket = getSocket()
    function handleStatusChanged({ agent_id, status }) {
      if (agent_id === agent.id) setAgentStatus(status)
    }
    socket.on('agent_status_changed', handleStatusChanged)
    return () => socket.off('agent_status_changed', handleStatusChanged)
  }, [agent])

  const unreadCount = activity.filter(a =>
    new Date(a.occurred_at) > baseAt && !readKeys.has(`${a.type}-${a.id}`)
  ).length

  function handleBellClick() {
    // Just toggle open — don't auto-mark anything as read
    setNotifOpen(o => !o)
  }

  function handleMarkRead(key) {
    setReadKeys(prev => {
      const next = new Set(prev)
      next.add(key)
      saveReadKeys(next)
      return next
    })
  }

  function handleMarkAllRead() {
    const now = new Date()
    localStorage.setItem(BASE_AT_KEY, now.toISOString())
    setBaseAt(now)
    // Clear individual read keys (they're all now covered by baseAt)
    saveReadKeys(new Set())
    setReadKeys(new Set())
  }

  function handleNotifNavigate({ tab, convId }) {
    setActiveTab(tab)
    if (tab === 'sms' && convId) {
      setNavConvId(convId)
    }
    setNotifOpen(false)
  }

  // ── Click-to-call / click-to-message (CallsTab + ContactsTab icons) ─────────
  // dialTo: switch to the dialpad and connect immediately.
  function dialTo(number) {
    if (!number) return
    setAutoDialNumber(number)
    setActiveTab('dialpad')
  }

  // messageTo: resolve (or create) the conversation for this number, then jump
  // straight into that SMS thread.
  async function messageTo(number) {
    if (!number) return
    try {
      const r = await api.ensureConversation(number)
      setNavConvId(r.conversation_id)
      setActiveTab('sms')
    } catch (e) {
      console.error('[messageTo]', e)
      alert(e.message || 'Could not open conversation')
    }
  }

  async function handleStatusChange(newStatus) {
    setAgentStatus(newStatus) // optimistic
    try {
      await api.updateStatus(newStatus)
    } catch (e) {
      console.error('[status change]', e)
    }
  }

  function handleLogin(agentData, token, defaultPassword) {
    localStorage.setItem('bti_token', token)
    setAgent(agentData)
    setAgentStatus(agentData.status || 'online')
    setActiveTab('dialpad')
    setDefaultPw(!!defaultPassword)
  }

  function handleLogout() {
    setDefaultPw(false)
    disconnectSocket()
    clearMediaToken()
    localStorage.removeItem('bti_token')
    setActivity([])
    setUnreadSms(0); setUnreadVm(0); setUnreadNotifs(0)
    setAgent(null)
  }

  // ── Electron incoming-call banner (Accept/Decline) ───────────────────────────
  useEffect(() => {
    if (!window.electronAPI) return
    window.__btiOnIncomingCallAction = (data) => {
      const action = data && data.action
      if (action === 'accept') acceptIncoming()
      else rejectIncoming()
    }
    return () => { try { delete window.__btiOnIncomingCallAction } catch { /* noop */ } }
  }, [incomingCall])

  // ── Electron mini widget — notify when call starts / ends ────────────────────
  // window.electronAPI is injected by preload.js only in the Electron desktop app;
  // it's undefined in the browser, so all calls are safely guarded with ?.
  useEffect(() => {
    if (!window.electronAPI?.onCallAction) return

    const cleanup = window.electronAPI.onCallAction(({ action, value }) => {
      const call = activeCallRef.current
      if (!call) return

      if (action === 'hangup') {
        call.disconnect()
        // handleCallEnded will fire via the 'disconnect' event already wired on the call
      }
      if (action === 'mute') {
        call.mute(!!value)
      }
    })

    return () => { if (typeof cleanup === 'function') cleanup() }
  }, [agent]) // eslint-disable-line

  // ── Shared call end logic (logs to DB + plays sound) ─────────────────────────
  // v1.4.0: After a connected call >= 15s ends, opens the PostCallScreen so
  // the agent can pick the right contact (handles shared-phone scenarios)
  // and optionally drop a Zoho note + follow-up task.
  //
  // Dedup: handlingEndRef ensures only the first invocation does the work when
  // both the SDK 'disconnect' event AND ActiveCallPanel.onHangup fire.
  // Capture duration immediately because DialpadTab's own disconnect handler
  // calls onCallEnd which used to null callStartRef before this could read it.
  async function handleCallEnded(phone, direction, status = 'completed', callSid = null) {
    if (handlingEndRef.current) return
    handlingEndRef.current = true

    // Capture timing BEFORE any other handler (e.g. DialpadTab's onCallEnd)
    // can null it out via state updates.
    const startTs  = callStartRef.current
    const duration = startTs ? Math.round((Date.now() - startTs) / 1000) : 0

    stopRingtone()
    playDisconnected()
    callStartRef.current  = null
    activeCallRef.current = null
    setActiveCall(null)
    setCallerInfo(null)
    window.electronAPI?.callEnd?.()

    try {
      if (!phone) return
      const callRecord = await api.logCallByPhone(
        phone, duration, direction,
        new Date(Date.now() - duration * 1000).toISOString(),
        callSid
      )

      // v1.4.0 trigger: open the post-call wrap-up screen for connected calls >= 15s.
      // Status='completed' means connected (vs 'missed', 'voicemail', 'failed').
      if (callRecord && callRecord.id && status === 'completed' && duration >= 15) {
        setWrapUpCall({
          id:           callRecord.id,
          phone:        phone,
          contact_name: callRecord.contact_name || null,
          duration:     duration,
          direction:    direction,
        })
      }
    } catch (e) {
      console.error('[handleCallEnded]', e)
    } finally {
      // Reset dedup so the NEXT call can be handled. Tiny delay so any straggler
      // disconnect event from the same call still hits the guard.
      setTimeout(() => { handlingEndRef.current = false }, 1500)
    }
  }

  // ── Inbound call handlers ─────────────────────────────────────────────────────
  function acceptIncoming() {
    if (!incomingCall) return
    stopRingtone()
    const from  = incomingCall.parameters?.From
    const callSid = incomingCall.parameters?.CallSid
    incomingCall.accept()
    window.electronAPI?.dismissIncomingCall?.()
    const info = { phone: from || 'Unknown', name: null }
    setActiveCall(incomingCall)
    activeCallRef.current = incomingCall
    setCallerInfo(info)
    callStartRef.current = Date.now()
    playConnected()
    // Notify mini widget
    window.electronAPI?.callStart?.(info)

    incomingCall.on('disconnect', () => {
      handleCallEnded(from, 'inbound', 'completed', callSid)
      setIncomingCall(null)
    })
    setIncomingCall(null)
    setActiveTab('dialpad')
  }

  function rejectIncoming() {
    if (incomingCall) {
      incomingCall.reject()
      stopRingtone()
      setIncomingCall(null)
      window.electronAPI?.dismissIncomingCall?.()
      // Twilio status webhook handles logging the missed call — no frontend log needed
    }
  }

  if (loading) {
    return (
      <div style={{ ...S.splash, background: isDark ? '#161b24' : '#f4f6f9' }}>
        <div style={S.spinWrap}>
          <div style={S.logoMark}>B</div>
          <div style={{ ...S.splashText, color: isDark ? 'white' : '#1e293b' }}>{BRAND}</div>
        </div>
      </div>
    )
  }

  if (!agent) return <Login onLogin={handleLogin} />

  return (
    <div style={{
      ...S.root,
      background: isDark ? '#161b24' : '#f4f6f9',
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'}`,
    }}>
      <TitleBar agent={agent} unreadCount={unreadCount} onBellClick={handleBellClick} agentStatus={agentStatus} onStatusChange={handleStatusChange} deviceStatus={deviceStatus} />

      {/* ── Default-password nag banner ─────────────────────────────── */}
      {defaultPw && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
          background: 'rgba(245,158,11,0.14)', borderBottom: '1px solid rgba(245,158,11,0.35)',
          fontSize: 12, color: isDark ? '#fbbf24' : '#92400e', flexShrink: 0,
        }}>
          <span style={{ flexShrink: 0 }}>&#9888;&#65039;</span>
          <span style={{ flex: 1 }}>You&apos;re still using the default password.</span>
          <button
            onClick={() => setActiveTab('settings')}
            style={{
              border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
              background: '#f59e0b', color: '#1e1b0e', fontSize: 11, fontWeight: 700, flexShrink: 0,
            }}
          >
            Change it
          </button>
          <button
            onClick={() => setDefaultPw(false)}
            title="Dismiss until next sign-in"
            style={{
              border: 'none', background: 'none', cursor: 'pointer', flexShrink: 0,
              color: 'inherit', fontSize: 13, padding: '2px 4px', opacity: 0.7,
            }}
          >
            &#10005;
          </button>
        </div>
      )}

      {notifOpen && (
        <NotificationsPanel
          activity={activity}
          readKeys={readKeys}
          baseAt={baseAt}
          onMarkRead={handleMarkRead}
          onMarkAllRead={handleMarkAllRead}
          onNavigate={handleNotifNavigate}
          onClose={() => setNotifOpen(false)}
        />
      )}

      {/* ── Incoming call overlay ────────────────────────────────────── */}
      {incomingCall && (
        <div style={{ ...S.incomingOverlay, background: C.panel, borderBottom: `1px solid ${C.border}` }}>
          <div style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>
            📞 Incoming call from {incomingCall.parameters?.From || 'Unknown'}
          </div>
          <div style={S.incomingBtns}>
            <button style={S.answerBtn} onClick={acceptIncoming}>Answer</button>
            <button style={S.rejectBtn} onClick={rejectIncoming}>Decline</button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div style={S.content}>
        {activeTab === 'sms'      && <SMSTab
          agent={agent}
          navConvId={navConvId}
          onNavConvConsumed={() => setNavConvId(null)}
          onChatOpenChange={setSmsOpenChat}
          device={twilioDevice}
          onCallStart={(call, phone) => {
            const info = { phone, name: null }
            call.customDirection = 'outbound'
            setActiveCall(call)
            activeCallRef.current = call
            setCallerInfo(info)
            callStartRef.current = Date.now()
            playConnected()
            window.electronAPI?.callStart?.(info)
            call.on('disconnect', () => handleCallEnded(phone, 'outbound', 'completed'))
            call.on('cancel',     () => handleCallEnded(phone, 'outbound', 'missed'))
          }}
          onCallEnd={() => {
            // Same as DialpadTab — let handleCallEnded own the timing ref.
            setActiveCall(null)
            activeCallRef.current = null
            setCallerInfo(null)
          }}
        />}
        {activeTab === 'contacts' && <ContactsTab agent={agent} onDial={dialTo} onMessage={messageTo} />}
        {activeTab === 'calls'    && <CallsTab    agent={agent} onWrapUpClick={c => setWrapUpCall(c)} onDial={dialTo} onMessage={messageTo} />}
        {activeTab === 'dialpad'  && (
          <DialpadTab
            agent={agent}
            device={twilioDevice}
            activeCall={activeCall}
            autoDial={autoDialNumber}
            onAutoDialConsumed={() => setAutoDialNumber(null)}
            onCallStart={(call, phone) => {
              const info = { phone, name: null }
              call.customDirection = 'outbound'
              setActiveCall(call)
              activeCallRef.current = call
              setCallerInfo(info)
              callStartRef.current = Date.now()
              playConnected()
              // Notify mini widget
              window.electronAPI?.callStart?.(info)
              call.on('disconnect', () => handleCallEnded(phone, 'outbound', 'completed'))
              call.on('cancel',     () => handleCallEnded(phone, 'outbound', 'missed'))
            }}
            onCallEnd={() => {
              // Note: callStartRef intentionally NOT cleared here — handleCallEnded
              // captures the timestamp first and clears it after. Clearing here
              // would race against handleCallEnded and zero out duration.
              setActiveCall(null)
              setCallerInfo(null)
            }}
          />
        )}
        {activeTab === 'settings'       && <SettingsTab       agent={agent} onLogout={handleLogout} />}

        {/* Active call panel — overlays the content area during any call */}
        {activeCall && (
          <ActiveCallPanel
            call={activeCall}
            agent={agent}
            callerInfo={callerInfo}
            onHangup={() => {
              const phone    = callerInfo?.phone
              const callSid  = activeCall?.parameters?.CallSid
              handleCallEnded(phone, activeCall?.customDirection || 'inbound', 'completed', callSid)
            }}
          />
        )}
      </div>

      {!smsOpenChat && activeTab !== 'settings' && <button style={S.composeBtn} onClick={() => setCompose(true)} title="New message">
        <ComposePenIcon />
      </button>}

      <BottomNav activeTab={activeTab} onChange={setActiveTab} notifCount={unreadNotifs} smsCount={unreadSms} vmCount={unreadVm} />

      {compose && (
        <NewMessageModal
          currentAgent={agent}
          onClose={() => setCompose(false)}
          onSent={() => setActiveTab('sms')}
        />
      )}

      {wrapUpCall && (
        <PostCallScreen
          call={wrapUpCall}
          onClose={() => setWrapUpCall(null)}
          onSaved={() => { /* badge clears via socket call_logged */ }}
        />
      )}
    </div>
  )
}

export default function App() {
  return <ThemeProvider><ToastProvider><AppInner /></ToastProvider></ThemeProvider>
}

function ComposePenIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="10" y1="11" x2="14" y2="11" />
    </svg>
  )
}

const S = {
  root:    { display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', borderRadius: 8, position: 'relative' },
  content: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' },
  incomingOverlay: {
    position: 'absolute', top: 44, left: 0, right: 0, zIndex: 300,
    padding: '12px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
  },
  incomingBtns: { display: 'flex', gap: 10 },
  answerBtn: { background: '#22c55e', color: 'white', border: 'none', borderRadius: 8, padding: '7px 20px', fontWeight: 700, cursor: 'pointer', fontSize: 13 },
  rejectBtn: { background: '#ef4444', color: 'white', border: 'none', borderRadius: 8, padding: '7px 20px', fontWeight: 700, cursor: 'pointer', fontSize: 13 },
  composeBtn: {
    position: 'absolute', bottom: 72, right: 16,
    width: 46, height: 46, borderRadius: '50%',
    background: 'linear-gradient(135deg, #1d4ed8, #4f9cf9)',
    border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 4px 16px rgba(79,156,249,0.45)', zIndex: 200,
  },
  splash:    { height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  spinWrap:  { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  logoMark:  { width: 52, height: 52, borderRadius: 12, background: 'linear-gradient(135deg,#1d4ed8,#4f9cf9)', color: 'white', fontWeight: 900, fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  splashText: { fontWeight: 700, fontSize: 18, letterSpacing: 1 },
}
