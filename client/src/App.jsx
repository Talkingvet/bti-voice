import { useState, useEffect, useCallback, useRef } from 'react'
import { BRAND } from './brand'
import { IS_TOUCH } from './utils/touch'

document.title = BRAND
import { Device } from '@twilio/voice-sdk'
import { ThemeProvider, useTheme } from './ThemeContext'
import { ToastProvider } from './components/Toast'
import { useColors }               from './useColors'
import { getSocket, disconnectSocket } from './socket'
import { startRingtone, stopRingtone, playConnected, playDisconnected, getSoundPrefs } from './dtmf'
import { showDesktopNotification, onDesktopNotificationClick, requestNotificationPermission } from './utils/desktopNotify'
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
import CallListsTab                from './components/tabs/CallListsTab'
import ListOutcomeStrip            from './components/ListOutcomeStrip'
import { api, ensureMediaToken, clearMediaToken } from './api'
import { loadFeatures, resetFeatures, useFeatures } from './features'
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
  // Set while a saved session can't be verified because the server is
  // unreachable (typical right after boot, before Wi-Fi is up). We keep the
  // token and retry instead of bouncing the user to the login screen.
  const [reconnecting, setReconnecting] = useState(false)
  const retryNowRef = useRef(null)
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
  // Call Lists (2026-10-03): the list entry the current outbound call was dialled
  // from — { id, list_id, list_name, display_name, phone }. Set by dialFromList,
  // consumed (and cleared) by handleCallEnded so the outcome lands on the entry.
  const listEntryRef = useRef(null)
  const [listOutcome, setListOutcome] = useState(null)  // { entry, callId } → ListOutcomeStrip

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
          if (!mounted) return
          // The SDK emits non-fatal errors — audio-device warnings, transient
          // ICE/signaling hiccups — and this used to latch the status red
          // permanently, with nothing ever setting it back. On iOS that meant
          // a constantly red connection dot while calls worked perfectly.
          // Trust the device's own state instead: only report an error when
          // it is genuinely not registered. A real drop still fires
          // 'unregistered', and recovery still fires 'registered'.
          if (device.state === 'registered') return
          setDeviceStatus('error')
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

        // Use the microphone chosen in Settings → Sound → Mic test on calls.
        // Before 2026-10-06 the choice was saved but never handed to the SDK,
        // so every call used the system-default mic. An empty/unknown id (e.g.
        // the headset is unplugged) falls back to the default silently.
        const applyInputDevice = async (dev) => {
          let id = ''
          try { id = localStorage.getItem('bti_mic_device') || '' } catch { /* noop */ }
          try {
            if (id && dev.audio.availableInputDevices?.has?.(id)) {
              await dev.audio.setInputDevice(id)
            } else if (!id) {
              await dev.audio.unsetInputDevice()
            }
          } catch (e) { console.warn('[Twilio] setInputDevice failed:', e.message) }
        }
        applyInputDevice(device)
        const onMicChange = () => applyInputDevice(device)
        window.addEventListener('bti_mic_device_change', onMicChange)
        // Re-apply when devices come and go (headset plugged back in)
        device.audio.on('deviceChange', onMicChange)

        await device.register()
        deviceRef.current = device
        deviceRef._cleanupNoise = () => {
          window.removeEventListener('bti_noise_pref_change', onPrefChange)
          window.removeEventListener('bti_mic_device_change', onMicChange)
          try { device.audio.removeListener('deviceChange', onMicChange) } catch { /* noop */ }
        }
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

  // ── Subscription banner (admin portal Phase 1) ──────────────────────────────
  // Server-driven: renews_soon / grace → amber notice; restricted → red
  // (outbound calls + texts paused, inbound still rings). Nothing to dismiss —
  // it clears itself when BTI extends the date from the portal.
  const features = useFeatures()
  const account  = features.account
  const showAccountBanner = account && account.message && account.state !== 'active'

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
    if (!token) { setLoading(false); return }

    let cancelled = false
    let timer     = null
    let attempt   = 0

    async function restore() {
      timer = null
      try {
        const data = await api.me()
        if (cancelled) return
        setAgent(data)
        loadFeatures(true)
        setAgentStatus(data.status || 'online')
        setReconnecting(false)
        setLoading(false)
        // Sliding session: "keep me signed in" tokens are renewed on every
        // successful start, so the user is only logged out after 30 days of
        // not opening the app. Short sessions get { token: null } — ignored.
        api.refresh()
          .then(r => { if (r?.token) localStorage.setItem('bti_token', r.token) })
          .catch(() => {})
      } catch (err) {
        if (cancelled) return
        if (err.status === 401 || err.status === 403) {
          // Token expired or was revoked — the ONLY case that should sign out.
          // A 403 account_blocked means BTI's subscription lifecycle refused
          // the session; carry the server's message to the login screen.
          if (err.code === 'account_blocked') { try { sessionStorage.setItem('bti_blocked_msg', err.message) } catch {} }
          localStorage.removeItem('bti_token')
          setReconnecting(false)
          setLoading(false)
          return
        }
        // Offline / server hiccup: keep the token, show "Connecting…", retry
        // with a gentle backoff (2s, 4s, … capped at 15s).
        attempt++
        setReconnecting(true)
        timer = setTimeout(restore, Math.min(2000 * attempt, 15000))
      }
    }

    retryNowRef.current = () => { if (timer) { clearTimeout(timer); timer = null } restore() }
    const onOnline = () => retryNowRef.current?.()
    window.addEventListener('online', onOnline)
    restore()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      window.removeEventListener('online', onOnline)
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

  // ── Desktop / browser notifications ──────────────────────────────────────────
  // New text, missed call, new voicemail → an OS pop-up when you're not already
  // looking at it. The server says WHO it is for (`notify_agent_ids`: the owner
  // of the number → the assigned agent → everyone); the bell/badges above stay
  // for everyone. In the 1.6.0+ desktop app the pop-up goes through Electron
  // (click restores the window from the tray); in a browser or an older shell
  // the browser's own Notification API is used. utils/desktopNotify.js.
  const activeTabRef = useRef(activeTab)
  useEffect(() => { activeTabRef.current = activeTab }, [activeTab])
  const openConvRef = useRef(null)   // id of the SMS thread currently open, or null
  useEffect(() => {
    if (!agent) return
    const forMe = (ids) => !Array.isArray(ids) || ids.map(Number).includes(Number(agent.id))
    const looking = () => document.visibilityState === 'visible' && document.hasFocus()
    const socket = getSocket()
    const onNotif = (n) => {
      const meta = n?.meta || {}
      if (!forMe(meta.notify_agent_ids)) return
      if (n.type === 'sms') {
        if (looking() && activeTabRef.current === 'sms' && openConvRef.current === meta.conversation_id) return
        showDesktopNotification({
          kind: 'sms', tag: `sms-${meta.conversation_id}`,
          title: n.title, body: n.body,
          nav: { tab: 'sms', convId: meta.conversation_id },
        })
      } else if (n.type === 'missed_call') {
        if (looking() && activeTabRef.current === 'calls') return
        showDesktopNotification({
          kind: 'missed_call', tag: `call-${meta.call_id}`,
          title: n.title, body: n.body,
          nav: { tab: 'calls' },
        })
      }
    }
    const onVm = (vm) => {
      if (!forMe(vm?.notify_agent_ids)) return
      if (looking() && activeTabRef.current === 'calls') return
      const secs = Number(vm.duration) || 0
      const len  = secs ? ` (${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')})` : ''
      showDesktopNotification({
        kind: 'voicemail', tag: `vm-${vm.id}`,
        title: `New voicemail – ${vm.contact_name || vm.from}`,
        body:  `${vm.from} left a voicemail${len}.`,
        nav: { tab: 'calls' },
      })
    }
    socket.on('notification', onNotif)
    socket.on('new_voicemail', onVm)
    const offClick = onDesktopNotificationClick(nav => {
      if (!nav) return
      setActiveTab(nav.tab)
      if (nav.tab === 'sms' && nav.convId) setNavConvId(nav.convId)
      setNotifOpen(false)
    })
    return () => {
      socket.off('notification', onNotif)
      socket.off('new_voicemail', onVm)
      offClick()
    }
  }, [agent])

  // Clear badge when user opens the notifications tab
  useEffect(() => {
    if (activeTab === 'sms')           setUnreadSms(0)
    // batch 7 (F26): the voicemail badge clears as each voicemail is actually
    // played (see below), not just because the Calls tab was opened.
    // Touch devices: dismiss the keyboard when changing tabs
    if (IS_TOUCH && document.activeElement && document.activeElement.blur) document.activeElement.blur()
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
    const onPlayed = () => setUnreadVm(c => Math.max(0, c - 1))
    socket.on('new_voicemail', onNewVm)
    window.addEventListener('bti-voicemail-played', onPlayed)
    return () => { socket.off('new_voicemail', onNewVm); window.removeEventListener('bti-voicemail-played', onPlayed) }
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

  // Call Lists: dial an entry and remember which one, so the wrap-up screen /
  // outcome strip can record the attempt against it when the call ends.
  function dialFromList(entry) {
    if (!entry || !entry.phone) return
    listEntryRef.current = entry
    dialTo(entry.phone)
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
    requestNotificationPermission()   // browser only; the login click is the user gesture
    localStorage.setItem('bti_token', token)
    setAgent(agentData)
    loadFeatures(true)
    setAgentStatus(agentData.status || 'online')
    setActiveTab('dialpad')
    setDefaultPw(!!defaultPassword)
  }

  // Server said this device's session is dead (deactivated / reset / changed
  // password elsewhere) → sign out and carry the reason to the login screen.
  useEffect(() => {
    const onRevoked = (e) => {
      try { sessionStorage.setItem('bti_blocked_msg', e.detail || 'You have been signed out. Please sign in again.') } catch {}
      handleLogout({ notifyServer: false })
    }
    window.addEventListener('bti-session-revoked', onRevoked)
    return () => window.removeEventListener('bti-session-revoked', onRevoked)
  }, [])

  // notifyServer: the user clicked Sign out → revoke THIS device's session on
  // the server (other devices stay signed in). False when the server already
  // revoked it (nothing to tell it, and the token is dead anyway).
  function handleLogout({ notifyServer = true } = {}) {
    if (notifyServer) api.logout().catch(() => {})
    setDefaultPw(false)
    disconnectSocket()
    clearMediaToken()
    resetFeatures()
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
    // Dialpad "Don't record this call" flag — read before activeCallRef is cleared
    const noRecord = !!(activeCallRef.current && activeCallRef.current.customNoRecord)

    stopRingtone()
    playDisconnected()
    callStartRef.current  = null
    activeCallRef.current = null
    setActiveCall(null)
    setCallerInfo(null)
    window.electronAPI?.callEnd?.()

    // Call Lists: only attribute this call to the list entry if it really was
    // that number (guards against a stale ref if a list dial never connected).
    const digits = v => String(v || '').replace(/\D/g, '').slice(-10)
    const listEntry = listEntryRef.current && phone && digits(listEntryRef.current.phone) === digits(phone)
      ? listEntryRef.current : null
    listEntryRef.current = null

    try {
      if (!phone) return
      const callRecord = await api.logCallByPhone(
        phone, duration, direction,
        new Date(Date.now() - duration * 1000).toISOString(),
        callSid,
        noRecord
      )

      // v1.4.0 trigger: open the post-call wrap-up screen for connected calls >= 15s.
      // Status='completed' means connected (vs 'missed', 'voicemail', 'failed').
      if (callRecord && callRecord.id && status === 'completed' && duration >= 15) {
        setWrapUpCall({
          id:           callRecord.id,
          phone:        phone,
          contact_name: callRecord.contact_name || (listEntry && listEntry.display_name) || null,
          duration:     duration,
          direction:    direction,
          list_entry:   listEntry,   // wrap-up Save also records the list outcome
        })
      } else if (listEntry) {
        // Unanswered / short list call: the wrap-up won't open, so ask with the
        // quick outcome strip (No answer / Left voicemail / Busy / Wrong number).
        setListOutcome({ entry: listEntry, callId: callRecord && callRecord.id ? callRecord.id : null })
      }
    } catch (e) {
      console.error('[handleCallEnded]', e)
      if (listEntry) setListOutcome({ entry: listEntry, callId: null })
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

  // Before sign-in (splash + login) the desktop app is a frameless window, so
  // the React title bar is the only thing that gives the user a drag handle
  // and an X. Without it a non-technical user has no visible way to close
  // the app. Same shell as the signed-in view, just without agent/bell.
  const preAuthShell = (children) => {
    if (!window.electronAPI) return children
    return (
      <div style={{
        ...S.root,
        background: isDark ? '#161b24' : '#f4f6f9',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'}`,
      }}>
        <TitleBar agent={null} />
        <div style={S.content}>{children}</div>
      </div>
    )
  }

  if (loading) {
    return preAuthShell(
      <div style={{ ...S.splash, ...(window.electronAPI ? {} : { minHeight: '100vh' }), background: isDark ? '#161b24' : '#f4f6f9' }}>
        <div style={S.spinWrap}>
          <div style={S.logoMark}>B</div>
          <div style={{ ...S.splashText, color: isDark ? 'white' : '#1e293b' }}>{BRAND}</div>
          {reconnecting && (
            <div style={{ textAlign: 'center', marginTop: 6 }}>
              <div style={{ fontSize: 13, color: isDark ? 'rgba(255,255,255,0.55)' : '#64748b' }}>
                Connecting&hellip; waiting for your internet connection
              </div>
              <button
                onClick={() => retryNowRef.current?.()}
                style={{ marginTop: 10, padding: '7px 18px', border: 'none', borderRadius: 8, background: '#4f9cf9', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                Retry now
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (!agent) return preAuthShell(<Login onLogin={handleLogin} embedded={!!window.electronAPI} />)

  return (
    <div style={{
      ...S.root,
      background: isDark ? '#161b24' : '#f4f6f9',
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'}`,
    }}>
      <TitleBar agent={agent} unreadCount={unreadCount} onBellClick={handleBellClick} agentStatus={agentStatus} onStatusChange={handleStatusChange} deviceStatus={deviceStatus} />

      {/* ── Desktop update banner (installed app only) ─────────────── */}
      {window.electronAPI && <UpdateBanner isDark={isDark} />}

      {/* ── Subscription renewal / grace / restricted banner ─────────── */}
      {showAccountBanner && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', flexShrink: 0, fontSize: 12,
          ...(account.state === 'restricted'
            ? { background: 'rgba(239,68,68,0.14)', borderBottom: '1px solid rgba(239,68,68,0.35)', color: isDark ? '#fca5a5' : '#991b1b' }
            : { background: 'rgba(245,158,11,0.14)', borderBottom: '1px solid rgba(245,158,11,0.35)', color: isDark ? '#fbbf24' : '#92400e' }),
        }}>
          <span style={{ flexShrink: 0 }}>{account.state === 'restricted' ? '⛔' : '\u{1F4C5}'}</span>
          <span style={{ flex: 1 }}>{account.message}</span>
        </div>
      )}

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
          onSelectedConvChange={id => { openConvRef.current = id }}
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
        {activeTab === 'settings'       && <SettingsTab       agent={agent} onLogout={() => handleLogout()} />}
        {activeTab === 'lists' && features.call_lists && <CallListsTab agent={agent} onDialEntry={dialFromList} onMessage={messageTo} />}

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

      {!smsOpenChat && activeTab !== 'settings' && !(IS_TOUCH && activeTab === 'dialpad') && <button style={S.composeBtn} onClick={() => setCompose(true)} title="New message">
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
          onClose={() => {
            // Skipped a list call's wrap-up → let go of the entry so a teammate can take it.
            const le = wrapUpCall.list_entry
            if (le && !wrapUpCall._saved) api.releaseCallListEntry(le.list_id, le.id).catch(() => {})
            setWrapUpCall(null)
          }}
          onSaved={() => {
            // badge clears via socket call_logged; for a list call, go back to the list.
            if (wrapUpCall.list_entry) { wrapUpCall._saved = true; setActiveTab('lists') }
          }}
        />
      )}
      {listOutcome && (
        <ListOutcomeStrip
          entry={listOutcome.entry}
          callId={listOutcome.callId}
          onDone={() => { setListOutcome(null); setActiveTab('lists') }}
        />
      )}
    </div>
  )
}

// ── Desktop update banner ─────────────────────────────────────────────────────
// The Electron shell checks for updates on launch / every 4 h / on wake and
// sends 'update-available'; this banner is mounted for the whole session so
// the prompt is seen wherever you are in the app (the About tab's own listener
// only worked while About was open). "Later" hides that version until the next
// check finds a newer one. Download + install reuse the About-tab IPCs.
function UpdateBanner({ isDark }) {
  const [version,  setVersion]  = useState(null)
  const [stage,    setStage]    = useState('idle')   // idle | available | downloading | ready | error
  const [percent,  setPercent]  = useState(0)
  const snoozedRef = useRef((() => { try { return localStorage.getItem('bti_update_snoozed') || '' } catch { return '' } })())

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    const offer = (v) => {
      if (!v || v === snoozedRef.current) return
      setVersion(v)
      setStage(s => (s === 'downloading' || s === 'ready') ? s : 'available')
    }
    api.getPendingUpdate?.().then(info => offer(info?.version)).catch(() => {})
    api.onUpdateAvailable?.(({ version: v }) => offer(v))
    api.onUpdateProgress?.(({ percent: p }) => { setPercent(p || 0); setStage('downloading') })
    api.onUpdateDownloaded?.(() => setStage('ready'))
  }, [])

  if (stage === 'idle' || !version) return null

  async function updateNow() {
    setStage('downloading'); setPercent(0)
    try {
      const r = await window.electronAPI.downloadUpdate()
      if (r && r.status === 'error') setStage('error')
    } catch { setStage('error') }
  }
  function later() {
    snoozedRef.current = version
    try { localStorage.setItem('bti_update_snoozed', version) } catch {}
    setStage('idle')
  }
  const btn = { border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', flexShrink: 0, fontSize: 12,
      background: 'rgba(79,156,249,0.14)', borderBottom: '1px solid rgba(79,156,249,0.35)',
      color: isDark ? '#bfdbfe' : '#1e3a8a',
    }}>
      <span style={{ flexShrink: 0 }}>{'\u2B06\uFE0F'}</span>
      <span style={{ flex: 1 }}>
        {stage === 'available'   && <>{BRAND} {version} is available.</>}
        {stage === 'downloading' && <>Downloading {BRAND} {version}… {percent ? `${percent}%` : ''}</>}
        {stage === 'ready'       && <>{BRAND} {version} is ready to install — it takes about a minute and the app will reopen.</>}
        {stage === 'error'       && <>Couldn’t download {BRAND} {version}. Try again from Settings → About.</>}
      </span>
      {stage === 'available' && <>
        <button style={{ ...btn, background: '#4f9cf9', color: '#fff' }} onClick={updateNow}>Update now</button>
        <button style={{ ...btn, background: 'transparent', color: 'inherit', opacity: 0.8 }} onClick={later}>Later</button>
      </>}
      {stage === 'ready' && (
        <button style={{ ...btn, background: '#4f9cf9', color: '#fff' }} onClick={() => window.electronAPI.installUpdate()}>Restart to update</button>
      )}
      {stage === 'error' && (
        <button style={{ ...btn, background: 'transparent', color: 'inherit', opacity: 0.8 }} onClick={() => setStage('idle')}>Dismiss</button>
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
  splash:    { flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  spinWrap:  { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  logoMark:  { width: 52, height: 52, borderRadius: 12, background: 'linear-gradient(135deg,#1d4ed8,#4f9cf9)', color: 'white', fontWeight: 900, fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  splashText: { fontWeight: 700, fontSize: 18, letterSpacing: 1 },
}
