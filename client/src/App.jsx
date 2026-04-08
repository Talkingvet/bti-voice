import { useState, useEffect, useCallback } from 'react'
import { ThemeProvider, useTheme } from './ThemeContext'
import { getSocket }          from './socket'
import Login                  from './pages/Login'
import TitleBar               from './components/TitleBar'
import BottomNav              from './components/BottomNav'
import NotificationsPanel     from './components/NotificationsPanel'
import NewMessageModal        from './components/NewMessageModal'
import SMSTab                 from './components/tabs/SMSTab'
import DialpadTab             from './components/tabs/DialpadTab'
import ContactsTab            from './components/tabs/ContactsTab'
import CallsTab               from './components/tabs/CallsTab'
import SettingsTab            from './components/tabs/SettingsTab'
import { api } from './api'

const SEEN_KEY = 'bti_notif_seen_at'

function AppInner() {
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  const [agent,      setAgent]      = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [activeTab,  setActiveTab]  = useState('dialpad')
  const [compose,    setCompose]    = useState(false)
  const [notifOpen,  setNotifOpen]  = useState(false)
  const [activity,   setActivity]   = useState([])
  const [seenAt,     setSeenAt]     = useState(
    () => localStorage.getItem(SEEN_KEY) ? new Date(localStorage.getItem(SEEN_KEY)) : null
  )

  // Auth check on mount
  useEffect(() => {
    const token = localStorage.getItem('bti_token')
    if (token) {
      api.me()
        .then(setAgent)
        .catch(() => localStorage.removeItem('bti_token'))
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  // Load activity feed + keep it fresh via socket
  const loadActivity = useCallback(() => {
    api.activity().then(setActivity).catch(console.error)
  }, [])

  useEffect(() => {
    if (!agent) return
    loadActivity()
    const socket = getSocket()
    socket.on('conversation_updated', loadActivity)
    return () => socket.off('conversation_updated', loadActivity)
  }, [agent, loadActivity])

  // Unread = items newer than last-seen timestamp
  const unreadCount = activity.filter(a =>
    seenAt ? new Date(a.occurred_at) > seenAt : true
  ).length

  function handleBellClick() {
    const isOpening = !notifOpen
    setNotifOpen(isOpening)
    if (isOpening) {
      const now = new Date()
      localStorage.setItem(SEEN_KEY, now.toISOString())
      setSeenAt(now)
    }
  }

  function handleLogin(agentData, token) {
    localStorage.setItem('bti_token', token)
    setAgent(agentData)
    setActiveTab('dialpad')
  }

  function handleLogout() {
    localStorage.removeItem('bti_token')
    setAgent(null)
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
      <TitleBar
        agent={agent}
        unreadCount={unreadCount}
        onBellClick={handleBellClick}
      />

      {/* Notification panel overlay */}
      {notifOpen && (
        <NotificationsPanel
          activity={activity}
          seenAt={seenAt}
          onClose={() => setNotifOpen(false)}
        />
      )}

      {/* Main content */}
      <div style={S.content}>
        {activeTab === 'sms'      && <SMSTab       agent={agent} />}
        {activeTab === 'contacts' && <ContactsTab  agent={agent} />}
        {activeTab === 'calls'    && <CallsTab     agent={agent} />}
        {activeTab === 'dialpad'  && <DialpadTab   agent={agent} />}
        {activeTab === 'settings' && <SettingsTab  agent={agent} onLogout={handleLogout} />}
      </div>

      {/* Floating compose button */}
      <button
        style={S.composeBtn}
        onClick={() => setCompose(true)}
        title="New message"
      >
        <ComposePenIcon />
      </button>

      {/* Bottom navigation */}
      <BottomNav activeTab={activeTab} onChange={setActiveTab} />

      {/* New message modal */}
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
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  )
}

function ComposePenIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="10" y1="11" x2="14" y2="11" />
    </svg>
  )
}

const S = {
  root: {
    display: 'flex', flexDirection: 'column',
    height: '100vh', overflow: 'hidden',
    borderRadius: 8, position: 'relative',
  },
  content: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 },

  composeBtn: {
    position: 'absolute',
    bottom: 72,
    right: 16,
    width: 46, height: 46,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #1d4ed8, #4f9cf9)',
    border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 4px 16px rgba(79,156,249,0.45)',
    zIndex: 200,
    transition: 'transform 0.15s, box-shadow 0.15s',
  },

  splash: {
    height: '100vh', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  },
  spinWrap:  { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  logoMark:  {
    width: 52, height: 52, borderRadius: 12,
    background: 'linear-gradient(135deg,#1d4ed8,#4f9cf9)',
    color: 'white', fontWeight: 900, fontSize: 24,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  splashText: { fontWeight: 700, fontSize: 18, letterSpacing: 1 },
}
