import { io } from 'socket.io-client'
import { getToken } from './api'

const SERVER = import.meta.env.VITE_API_URL || ''
let socket = null

export function getSocket() {
  if (!socket) {
    socket = io(SERVER, {
      transports: ['websocket', 'polling'],
      auth: { token: getToken() },
    })
  }
  return socket
}

export function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null }
}
