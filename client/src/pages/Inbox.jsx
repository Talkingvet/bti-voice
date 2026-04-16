import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { getSocket } from '../socket'
import Sidebar from '../components/Sidebar'
import ChatPanel from '../components/ChatPanel'
import { useToast } from '../components/Toast'

export default function Inbox({ agent, onLogout }) {
  const { toast } = useToast()
  const [conversations, setConversations]       = useState([])
  const [agents, setAgents]                     = useState([])
  const [selectedId, setSelectedId]             = useState(null)
  const [messages, setMessages]                 = useState([])
  const [calls, setCalls]                       = useState([])
  const [sideTab, setSideTab]                   = useState('sms') // 'sms' | 'calls'
  const [loadingMsgs, setLoadingMsgs]           = useState(false)

  // Load initial data
  useEffect(() => {
    loadConversations()
    api.agents().then(setAgents).catch(console.error)
    api.calls().then(setCalls).catch(console.error)
  }, [])

  function loadConversations() {
    api.conversations().then(setConversations).catch(console.error)
  }

  // Real-time socket
  useEffect(() => {
    const socket = getSocket()
    socket.on('conversation_updated', () => loadConversations())
    return () => socket.off('conversation_updated')
  }, [])

  // Load messages when conversation changes
  useEffect(() => {
    if (!selectedId) return
    setLoadingMsgs(true)

    const socket = getSocket()
    socket.emit('join_conversation', selectedId)

    api.messages(selectedId)
      .then(setMessages)
      .catch(console.error)
      .finally(() => setLoadingMsgs(false))

    socket.on('new_message', (msg) => {
      setMessages(prev => [...prev, msg])
    })

    return () => {
      socket.emit('leave_conversation', selectedId)
      socket.off('new_message')
    }
  }, [selectedId])

  const handleSend = useCallback(async (body) => {
    if (!selectedId || !body.trim()) return
    try {
      await api.sendMessage(selectedId, body)
      // Message will arrive via socket broadcast
    } catch (e) {
      toast.error('Failed to send: ' + e.message)
    }
  }, [selectedId, toast])

  const handleResolve = useCallback(async () => {
    if (!selectedId) return
    await api.resolveConv(selectedId)
    setSelectedId(null)
    setMessages([])
    loadConversations()
  }, [selectedId])

  const handleCallLogged = useCallback((callData) => {
    api.calls().then(setCalls).catch(console.error)
  }, [])

  const selectedConv = conversations.find(c => c.id === selectedId) || null

  return (
    <div style={styles.app}>
      {/* Top bar */}
      <div style={styles.topbar}>
        <div style={styles.brand}>
          📞 <span style={{ color: '#4f9cf9' }}>BTI</span> Voice
        </div>
        <div style={styles.topRight}>
          <span style={styles.stat}>Open: <strong>{conversations.length}</strong></span>
          <div style={styles.agentBadge}>
            <div style={{ ...styles.dot, background: agent.color || '#3b82f6' }} />
            <span>{agent.name}</span>
            <span style={styles.agentNum}>{agent.phone_number !== 'TBD' ? agent.phone_number : 'No number yet'}</span>
            <button style={styles.logoutBtn} onClick={onLogout} title="Sign out">⏏</button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={styles.body}>
        <Sidebar
          conversations={conversations}
          calls={calls}
          selectedId={selectedId}
          sideTab={sideTab}
          onSelectConv={setSelectedId}
          onTabChange={setSideTab}
          currentAgent={agent}
        />
        <ChatPanel
          conv={selectedConv}
          messages={messages}
          loading={loadingMsgs}
          currentAgent={agent}
          agents={agents}
          onSend={handleSend}
          onResolve={handleResolve}
          onCallLogged={handleCallLogged}
        />
      </div>
    </div>
  )
}

const styles = {
  app: { display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' },
  topbar: {
    background: '#1a2332', color: 'white',
    padding: '0 20px', height: 52,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexShrink: 0, zIndex: 100,
  },
  brand: { fontSize: 18, fontWeight: 700, letterSpacing: '-0.3px' },
  topRight: { display: 'flex', alignItems: 'center', gap: 16 },
  stat: { fontSize: 12, color: 'rgba(255,255,255,0.6)' },
  agentBadge: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 8, padding: '5px 12px',
    fontSize: 13,
  },
  dot: { width: 8, height: 8, borderRadius: '50%' },
  agentNum: { fontSize: 11, color: 'rgba(255,255,255,0.5)' },
  logoutBtn: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)',
    fontSize: 14, cursor: 'pointer', padding: '0 0 0 4px',
  },
  body: { display: 'flex', flex: 1, overflow: 'hidden' },
}
