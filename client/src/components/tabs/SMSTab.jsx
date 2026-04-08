/* SMS Tab – single-pane navigator: conversation list → thread → back */
import { useState, useEffect, useCallback } from 'react'
import { api }       from '../../api'
import { getSocket } from '../../socket'
import ConvList      from '../ConvList'
import ChatPanel     from '../ChatPanel'

export default function SMSTab({ agent }) {
  const [conversations, setConversations] = useState([])
  const [agents,        setAgents]        = useState([])
  const [selectedId,    setSelectedId]    = useState(null)
  const [messages,      setMessages]      = useState([])
  const [loadingMsgs,   setLoadingMsgs]   = useState(false)

  useEffect(() => {
    loadConversations()
    api.agents().then(setAgents).catch(console.error)
  }, [])

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
    api.messages(selectedId)
      .then(setMessages)
      .catch(console.error)
      .finally(() => setLoadingMsgs(false))

    socket.on('new_message', (msg) => setMessages(prev => [...prev, msg]))
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

  const handleBack = useCallback(() => {
    setSelectedId(null)
    setMessages([])
  }, [])

  const selectedConv = conversations.find(c => c.id === selectedId) || null

  return (
    <div style={S.wrap}>
      {selectedId === null ? (
        <ConvList
          conversations={conversations}
          selectedId={selectedId}
          onSelect={setSelectedId}
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
          onCallLogged={() => {}}
          onBack={handleBack}
        />
      )}
    </div>
  )
}

const S = {
  wrap: { display: 'flex', flex: 1, overflow: 'hidden', height: '100%' },
}
