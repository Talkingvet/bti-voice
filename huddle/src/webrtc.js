// Peer-to-peer mesh WebRTC for a Huddle room.
//
// One RTCPeerConnection per other participant. Signaling rides on the shared
// socket.io connection ('huddle:signal'), using the "perfect negotiation"
// pattern so either side can add/remove tracks (camera, screen share) at any
// time without glare. The side with the lexically smaller socket id is
// "polite" (yields on collisions).
//
// Screen share is sent as a second video track with its own MediaStream; a
// small out-of-band 'screen' message tells the far side which stream id is
// the screen so it can render it large.

import { getSocket } from './socket'
import { api } from './api'
import { mediaConstraints } from './devices'

export class HuddleCall {
  constructor({ code, onChange }) {
    this.code = code
    this.onChange = onChange
    this.socket = getSocket()
    this.peers = new Map()        // socketId → peer record
    this.localStream = null       // camera + mic
    this.screenStream = null
    this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]
    this.joined = false
    this._bound = {
      joined: (p) => this._onPeerJoined(p),
      left:   (p) => this._onPeerLeft(p),
      signal: (m) => this._onSignal(m),
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  async start({ video = true, audio = true } = {}) {
    try {
      const { iceServers } = await api.ice()
      if (Array.isArray(iceServers) && iceServers.length) this.iceServers = iceServers
    } catch (e) { console.warn('[huddle] ICE fetch failed, STUN only:', e.message) }

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints({ video, audio }))
    } catch (e) {
      // No camera? Try audio only so the call still works.
      console.warn('[huddle] getUserMedia failed, retrying audio-only:', e.message)
      this.localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints({ video: false, audio }))
    }

    this.socket.on('huddle:peer-joined', this._bound.joined)
    this.socket.on('huddle:peer-left',   this._bound.left)
    this.socket.on('huddle:signal',      this._bound.signal)

    // Join; the ack lists everyone already here. The NEWCOMER initiates to
    // each existing peer, so each pair has exactly one offerer initially.
    const { peers } = await new Promise((resolve) => this.socket.emit('huddle:join', this.code, resolve))
    this.joined = true
    for (const p of peers) {
      const rec = this._peer(p.socketId, p.agent)
      // Adding our tracks fires onnegotiationneeded → offer.
      this._attachLocalTracks(rec)
    }
    this._emit()
  }

  stop() {
    if (this.joined) this.socket.emit('huddle:leave', this.code)
    this.joined = false
    this.socket.off('huddle:peer-joined', this._bound.joined)
    this.socket.off('huddle:peer-left',   this._bound.left)
    this.socket.off('huddle:signal',      this._bound.signal)
    for (const rec of this.peers.values()) rec.pc.close()
    this.peers.clear()
    this.localStream?.getTracks().forEach(t => t.stop())
    this.screenStream?.getTracks().forEach(t => t.stop())
    this.localStream = null
    this.screenStream = null
    this._emit()
  }

  // ── Controls ──────────────────────────────────────────────────────────────
  setMuted(muted) {
    this.localStream?.getAudioTracks().forEach(t => { t.enabled = !muted })
    this._emit()
  }
  setCameraOff(off) {
    this.localStream?.getVideoTracks().forEach(t => { t.enabled = !off })
    this._emit()
  }
  get muted()     { return !!this.localStream && this.localStream.getAudioTracks().every(t => !t.enabled) }
  get cameraOff() { return !this.localStream || this.localStream.getVideoTracks().length === 0 || this.localStream.getVideoTracks().every(t => !t.enabled) }

  async startScreenShare() {
    if (this.screenStream) return
    // In the desktop app, Electron's setDisplayMediaRequestHandler services
    // this call; in a browser it shows the native picker.
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false })
    const track = this.screenStream.getVideoTracks()[0]
    track.onended = () => this.stopScreenShare() // user hit the browser's "Stop sharing"
    for (const rec of this.peers.values()) {
      rec.screenSender = rec.pc.addTrack(track, this.screenStream)
      this._send(rec.id, { type: 'screen', streamId: this.screenStream.id, on: true })
    }
    this._emit()
  }

  stopScreenShare() {
    if (!this.screenStream) return
    const streamId = this.screenStream.id
    this.screenStream.getTracks().forEach(t => t.stop())
    this.screenStream = null
    for (const rec of this.peers.values()) {
      if (rec.screenSender) { try { rec.pc.removeTrack(rec.screenSender) } catch { /* closed */ } rec.screenSender = null }
      this._send(rec.id, { type: 'screen', streamId, on: false })
    }
    this._emit()
  }

  // ── Peers ─────────────────────────────────────────────────────────────────
  _peer(socketId, agent) {
    if (this.peers.has(socketId)) return this.peers.get(socketId)
    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    const rec = {
      id: socketId, agent, pc,
      camStream: null, screenStream: null, screenStreamId: null,
      screenSender: null,
      makingOffer: false, ignoreOffer: false,
      polite: this.socket.id < socketId,
      state: 'connecting',
    }

    pc.onicecandidate = ({ candidate }) => { if (candidate) this._send(socketId, { type: 'candidate', candidate }) }

    pc.onnegotiationneeded = async () => {
      try {
        rec.makingOffer = true
        await pc.setLocalDescription()
        this._send(socketId, { type: 'description', description: pc.localDescription })
      } catch (e) { console.error('[huddle] negotiation', e) }
      finally { rec.makingOffer = false }
    }

    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0]
      if (!stream) return
      if (rec.screenStreamId && stream.id === rec.screenStreamId) rec.screenStream = stream
      else if (!rec.camStream || rec.camStream.id === stream.id) rec.camStream = stream
      else if (!rec.screenStreamId) {
        // Second video stream arrived before its 'screen' tag — assume screen.
        rec.screenStream = stream
      }
      stream.onremovetrack = () => this._emit()
      track.onmute = () => this._emit()
      track.onunmute = () => this._emit()
      this._emit()
    }

    pc.onconnectionstatechange = () => {
      rec.state = pc.connectionState
      if (pc.connectionState === 'failed') { try { pc.restartIce() } catch { /* ignore */ } }
      this._emit()
    }

    this.peers.set(socketId, rec)
    return rec
  }

  _attachLocalTracks(rec) {
    this.localStream?.getTracks().forEach(t => rec.pc.addTrack(t, this.localStream))
    if (this.screenStream) {
      const st = this.screenStream.getVideoTracks()[0]
      if (st) {
        rec.screenSender = rec.pc.addTrack(st, this.screenStream)
        this._send(rec.id, { type: 'screen', streamId: this.screenStream.id, on: true })
      }
    }
  }

  _onPeerJoined({ socketId, agent }) {
    // Existing participants wait for the newcomer's offer, but attach their
    // tracks now so the answer carries them. addTrack before any remote
    // description does queue a negotiationneeded; perfect negotiation makes
    // the resulting collision harmless.
    const rec = this._peer(socketId, agent)
    this._attachLocalTracks(rec)
    this._emit()
  }

  _onPeerLeft({ socketId }) {
    const rec = this.peers.get(socketId)
    if (!rec) return
    rec.pc.close()
    this.peers.delete(socketId)
    this._emit()
  }

  async _onSignal({ from, agent, data }) {
    const rec = this._peer(from, agent)
    const pc = rec.pc
    try {
      if (data.type === 'description') {
        const desc = data.description
        const offerCollision = desc.type === 'offer' && (rec.makingOffer || pc.signalingState !== 'stable')
        rec.ignoreOffer = !rec.polite && offerCollision
        if (rec.ignoreOffer) return
        await pc.setRemoteDescription(desc)
        if (desc.type === 'offer') {
          await pc.setLocalDescription()
          this._send(from, { type: 'description', description: pc.localDescription })
        }
      } else if (data.type === 'candidate') {
        try { await pc.addIceCandidate(data.candidate) }
        catch (e) { if (!rec.ignoreOffer) throw e }
      } else if (data.type === 'screen') {
        if (data.on) {
          rec.screenStreamId = data.streamId
          // If the stream already arrived untagged, re-home it.
          if (rec.camStream && rec.camStream.id === data.streamId) { rec.screenStream = rec.camStream; rec.camStream = null }
        } else {
          rec.screenStreamId = null
          rec.screenStream = null
        }
        this._emit()
      }
    } catch (e) { console.error('[huddle] signal', e) }
  }

  _send(to, data) { this.socket.emit('huddle:signal', { to, data }) }

  _emit() {
    this.onChange && this.onChange({
      local: this.localStream,
      screen: this.screenStream,
      muted: this.muted,
      cameraOff: this.cameraOff,
      peers: [...this.peers.values()].map(r => ({
        id: r.id, agent: r.agent, camStream: r.camStream, screenStream: r.screenStream, state: r.state,
      })),
    })
  }
}
