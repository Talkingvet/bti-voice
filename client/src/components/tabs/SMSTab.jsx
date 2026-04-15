/* SMS Tab – single-pane navigator: conversation list → thread → back */
import { useState, useEffect, useCallback } from 'react'
import { api }       from '../../api'
import { getSocket } from '../../socket'
import ConvList      from '../ConvList'
import ChatPanel     from '../ChatPanel'

export default function SMSTab({ agent, navConvId, onNavConvConsumed, device, onCallStart, onCallEnd, onChatOpenChange }) {
  const [conversations, setConversations] = useState([])
  const [agents,        setAgents]        = useState([])
  const [selectedId,    setSelectedId]    = useState(null)
  const [messages,      setMessages]      = useState([])
  const [loadingMsgs,   setLoadingMsgs]   = useState(false)

  useEffect(() => {
    loadConversations()
    api.agents().then(setAgents).catch(console.error)
  }, [])

  // Deep-link: auto-select a conversation when navigated from a notification
  useEffect(() => {
    if (!navConvId) return
    // Wait until conversations are loaded, then select
    const id = parseInt(navConvId)
    if (!isNaN(id)) {
      setSelectedId(id)
      onNavConvConsumed?.()
      onChatOpenChange?.(true)
    }
  }, [navConvId]) // eslint-disable-line

  function loadConversations() {
    api.conversations().then(setConversations).catch(console.error)
  }

  // Real-time updates
  useEffect(() => {
    const socket = getSocket()
    socket.on('conversation_updated', loadConversations)
    return () => socket.off('conversation_updated', loadConversations)
  }, [])

  // Load messages when a conversation is selected
  useEffect(() => {
    if (!selectedId) { setMessages([]); return }
    setLoadingMsgs(true)
    const socket = getSocket()
    socket.emit('join_conversation', selectedId)

    // Mark as read immediately when opened
    api.markConvRead(selectedId).catch(() => {})

    api.messages(selectedId)
      .then(msgs => {
        setMessages(msgs)
        // Refresh convo list so unread badge clears
        loadConversations()
      })
      .catch(console.error)
      .finally(() => setLoadingMsgs(false))

    socket.on('new_message', (msg) => {
      setMessages(prev => [...prev, msg])
      // Mark as read since we're actively viewing the conversation
      api.markConvRead(selectedId).catch(() => {})
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
    } catch (e) {
      alert('Send failed: ' + e.message)
    }
  }, [selectedId])

  const handleAssign = useCallback(async (convId, agentId) => {
    try {
      await api.assignConversation(convId, agentId)
      loadConversations()
    } catch (e) {
      alert('Assign failed: ' + e.message)
    }
  }, [])

  const handleBack = useCallback(() => {
    setSelectedId(null)
    setMessages([])
    onChatOpenChange?.(false)
  }, [onChatOpenChange])

  const selectedConv = conversations.find(c => c.id === selectedId) || null

  return (
    <div style={S.wrap}>
      {selectedId === null ? (
        <ConvList
          conversations={conversations}
          selectedId={selectedId}
          onSelect={id => { setSelectedId(id); onChatOpenChange?.(true) }}
          currentAgent={agent}
          agents={agents}
        />
      ) : (
        <ChatPanel
          conv={selectedConv}
          messages={messages}
          loading={loadingMsgs}
          currentAgent={agent}
          agents={agents}
          onSend={handleSend}
          onBack={handleBack}
          onAssign={handleAssign}
          device={device}
          onCallStart={onCallStart}
          onCallEnd={onCallEnd}
        />
      )}
    </div>
  )
}

const S = {
  wrap: { display: 'flex', flex: 1, overflow: 'hidden', height: '100%' },
}
