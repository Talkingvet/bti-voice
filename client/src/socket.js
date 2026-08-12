import { io } from 'socket.io-client'

// In Electron (file://) we need the full Railway URL.
// When served from Railway directly, empty string connects to same origin.
const SERVER = import.meta.env.VITE_API_URL || ''

let socket = null

export function getSocket() {
  if (!socket) {
    socket = io(SERVER, {
      transports: ['websocket', 'polling'],
      // Auth handshake — server rejects sockets without a valid agent token.
      auth: { token: localStorage.getItem('bti_token') },
    })
  }
  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
