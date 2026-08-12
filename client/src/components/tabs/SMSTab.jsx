/* SMS Tab – single-pane navigator: conversation list → thread → back */
import { useState, useEffect, useCallback } from 'react'
import { api }       from '../../api'
import { getSocket } from '../../socket'
import ConvList      from '../ConvList'
import ChatPanel     from '../ChatPanel'
import { useToast }  from '../Toast'

export default function SMSTab({ agent, navConvId, onNavConvConsumed, device, onCallStart, onCallEnd, onChatOpenChange }) {
  const { toast } = useToast()
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
    let cancelled = false
    setLoadingMsgs(true)
    const socket = getSocket()
    socket.emit('join_conversation', selectedId)

    // Mark as read immediately when opened
    api.markConvRead(selectedId).catch(() => {})

    api.messages(selectedId)
      .then(msgs => {
        if (cancelled) return // a newer conversation was opened; ignore stale result
        setMessages(msgs)
        loadConversations()
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoadingMsgs(false) })

    const onNewMessage = (msg) => {
      // Dedupe by id so a double-emit can't render the bubble twice.
      setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
      api.markConvRead(selectedId).catch(() => {})
    }
    // socket.io re-connects after a network blip but does NOT auto re-join
    // rooms — without this an open thread silently stops receiving messages.
    const onReconnect = () => socket.emit('join_conversation', selectedId)
    socket.on('new_message', onNewMessage)
    socket.on('connect', onReconnect)
    return () => {
      cancelled = true
      socket.emit('leave_conversation', selectedId)
      socket.off('new_message', onNewMessage)
      socket.off('connect', onReconnect)
    }
  }, [selectedId])

  const handleSend = useCallback(async (body, mediaIds) => {
    if (!selectedId || (!body.trim() && !mediaIds?.length)) return
    try {
      await api.sendMessage(selectedId, body, mediaIds)
    } catch (e) {
      toast.error('Send failed: ' + e.message)
      throw e // let the composer keep the text instead of clearing it
    }
  }, [selectedId, toast])

  const handleAssign = useCallback(async (convId, agentId) => {
    try {
      await api.assignConversation(convId, agentId)
      loadConversations()
      toast.success('Conversation assigned')
    } catch (e) {
      toast.error('Assign failed: ' + e.message)
    }
  }, [toast])

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
