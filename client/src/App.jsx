import { useState, useEffect, useCallback, useRef } from 'react'
import { Device } from '@twilio/voice-sdk'
import { ThemeProvider, useTheme } from './ThemeContext'
import { useColors }               from './useColors'
import { getSocket }               from './socket'
import { startRingtone, stopRingtone, playConnected, playDisconnected, getSoundPrefs } from './dtmf'
import Login                       from './pages/Login'
import TitleBar                    from './components/TitleBar'
import BottomNav                   from './components/BottomNav'
import NotificationsPanel          from './components/NotificationsPanel'
import NewMessageModal             from './components/NewMessageModal'
import ActiveCallPanel             from './components/ActiveCallPanel'
import SMSTab                      from './components/tabs/SMSTab'
import DialpadTab                  from './components/tabs/DialpadTab'
import ContactsTab                 from './components/tabs/ContactsTab'
import CallsTab                    from './components/tabs/CallsTab'
import SettingsTab                 from './components/tabs/SettingsTab'
import { api } from './api'

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
  const [smsOpenChat, setSmsOpenChat] = useState(false) // true when a conversation thread is open
  const [agentStatus, setAgentStatus] = useState('online')
  const [compose,    setCompose]    = useState(false)
  const [notifOpen,  setNotifOpen]  = useState(false)
  const [activity,   setActivity]   = useState([])

  // Per-item read tracking (individual) + base timestamp (everything before this is auto-old)
  const [baseAt,    setBaseAt]    = useState(
    () => localStorage.getItem(BASE_AT_KEY) ? new Date(localStorage.getItem(BASE_AT_KEY)) : new Date(0)
  )
  const [readKeys,  setReadKeys]  = useState(() => loadReadKeys())

  // ── Twilio Device (app-level — stays registered on any tab) ──────────────────
  const [twilioDevice,  setTwilioDevice]  = useState(null)
  const [incomingCall,  setIncomingCall]  = useState(null)
  const [activeCall,    setActiveCall]    = useState(null)
  const [callerInfo,    setCallerInfo]    = useState(null)  // { phone, name }
  const deviceRef    = useRef(null)
  const callStartRef = useRef(null)   // timestamp when call was answered
  const activeCallRef = useRef(null)  // mirrors activeCall state — accessible in IPC closures

  useEffect(() => {
    if (!agent) return
    let mounted = true

    async function initDevice() {
      try {
        const { token } = await api.voiceToken()
        if (!mounted) return

        const device = new Device(token, {
          logLevel: 'warn',
          codecPreferences: ['opus', 'pcmu'],
        })

        device.on('incoming', call => {
          if (!mounted) return
          // Auto-dismiss if caller hangs up before agent answers
          call.on('cancel', () => {
            stopRingtone()
            setIncomingCall(null)
            // Log as missed call
            const from = call.parameters?.From
            if (from) api.logCallByPhone(from, 0, 'inbound', new Date().toISOString())
              .catch(console.error)
          })
          startRingtone()
          setIncomingCall(call)
        })

        device.on('tokenWillExpire', async () => {
          try {
            const { token: t } = await api.voiceToken()
            device.updateToken(t)
          } catch (e) { console.error('[Twilio] token refresh failed', e) }
        })

        device.on('error', err => console.error('[Twilio Device]', err))

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
      } catch (e) {
        console.error('[Twilio init]', e)
      }
    }

    initDevice()
    return () => {
      mounted = false
      stopRingtone()
      if (deviceRef._cleanupNoise) { deviceRef._cleanupNoise(); deviceRef._cleanupNoise = null }
      if (deviceRef.current) { deviceRef.current.destroy(); deviceRef.current = null }
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

  async function handleStatusChange(newStatus) {
    setAgentStatus(newStatus) // optimistic
    try {
      await api.updateStatus(newStatus)
    } catch (e) {
      console.error('[status change]', e)
    }
  }

  function handleLogin(agentData, token) {
    localStorage.setItem('bti_token', token)
    setAgent(agentData)
    setAgentStatus(agentData.status || 'online')
    setActiveTab('dialpad')
  }

  function handleLogout() {
    localStorage.removeItem('bti_token')
    setAgent(null)
  }

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
  function handleCallEnded(phone, direction, status = 'completed', callSid = null) {
    stopRingtone()
    playDisconnected()
    const duration = callStartRef.current
      ? Math.round((Date.now() - callStartRef.current) / 1000)
      : 0
    callStartRef.current = null
    setActiveCall(null)
    activeCallRef.current = null
    setCallerInfo(null)
    // Tell the mini widget the call is done
    window.electronAPI?.callEnd?.()
    if (phone) {
      api.logCallByPhone(
        phone, duration, direction,
        new Date(Date.now() - duration * 1000).toISOString(),
        callSid
      ).catch(console.error)
    }
  }

  // ── Inbound call handlers ─────────────────────────────────────────────────────
  function acceptIncoming() {
    if (!incomingCall) return
    stopRingtone()
    const from  = incomingCall.parameters?.From
    const callSid = incomingCall.parameters?.CallSid
    incomingCall.accept()
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
      const from    = incomingCall.parameters?.From
      const callSid = incomingCall.parameters?.CallSid
      incomingCall.reject()
      stopRingtone()
      setIncomingCall(null)
      // Log as missed (webhook will also log, but send SID so frontend wins if faster)
      if (from) api.logCallByPhone(from, 0, 'inbound', new Date().toISOString(), callSid)
        .catch(console.error)
    }
  }

  if (loading) {
    return (
      <div style={{ ...S.splash, background: isDark ? '#161b24' : '#f4f6f9' }}>
        <div style={S.spinWrap}>
          <div style={S.logoMark}>B</div>
          <div style={{ ...S.splashText, color: isDark ? 'white' : '#1e293b' }}>BTI Voice</div>
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
      <TitleBar agent={agent} unreadCount={unreadCount} onBellClick={handleBellClick} agentStatus={agentStatus} onStatusChange={handleStatusChange} />

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
            setActiveCall(null)
            activeCallRef.current = null
            setCallerInfo(null)
            callStartRef.current = null
          }}
        />}
        {activeTab === 'contacts' && <ContactsTab agent={agent} />}
        {activeTab === 'calls'    && <CallsTab    agent={agent} />}
        {activeTab === 'dialpad'  && (
          <DialpadTab
            agent={agent}
            device={twilioDevice}
            activeCall={activeCall}
            onCallStart={(call, phone) => {
              const info = { phone, name: null }
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
              setActiveCall(null)
              setCallerInfo(null)
              callStartRef.current = null
            }}
          />
        )}
        {activeTab === 'settings' && <SettingsTab agent={agent} onLogout={handleLogout} />}

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

      {!smsOpenChat && <button style={S.composeBtn} onClick={() => setCompose(true)} title="New message">
        <ComposePenIcon />
      </button>}

      <BottomNav activeTab={activeTab} onChange={setActiveTab} />

      {compose && (
        <NewMessageModal
          currentAgent={agent}
          onClose={() => setCompose(false)}
          onSent={() => setActiveTab('sms')}
        />
      )}
    </div>
  )
}

export default function App() {
  return <ThemeProvider><AppInner /></ThemeProvider>
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
