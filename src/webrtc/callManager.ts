import type { CallKind, SignalEvent } from '../api/client'

export type CallState =
  | 'idle'
  | 'calling'
  | 'incoming'
  | 'connecting'
  | 'connected'
  | 'ended'

export type CallSnapshot = {
  state: CallState
  kind: CallKind
  callId: string
  peerId: string
  peerName: string
  muted: boolean
  cameraOff: boolean
  cameraCount: number
  cameraLabel: string
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  error: string
  notice: string
}

type SignalingSender = (event: SignalEvent) => void

type CallStage =
  | 'getUserMedia'
  | 'peer connection'
  | 'signaling'
  | 'offer'
  | 'answer'
  | 'ice'
  | 'camera switch'

const stageCopy: Record<CallStage, string> = {
  getUserMedia: 'Call failed while getting the microphone or camera (getUserMedia)',
  'peer connection': 'Call failed while starting the peer connection (RTCPeerConnection)',
  signaling: 'Call failed during call signaling (ICE/answer)',
  offer: 'Call failed while creating or sending the offer (offer)',
  answer: 'Call failed while creating or sending the answer (answer)',
  ice: 'Call failed while handling a network candidate (ICE)',
  'camera switch': 'Call failed while switching cameras (getUserMedia)',
}

const plainErrorNames: Record<string, string> = {
  AbortError: 'device stopped unexpectedly',
  DataCloneError: 'data could not be copied',
  EncodingError: 'encoding failed',
  InvalidModificationError: 'call state could not be changed',
  InvalidStateError: 'call state was not ready',
  NetworkError: 'network error',
  NotAllowedError: 'permission denied',
  NotFoundError: 'no device found',
  NotReadableError: 'device is busy or unreadable',
  OperationError: 'the browser operation failed',
  OverconstrainedError: 'requested device setting is unavailable',
  QuotaExceededError: 'too much data',
  SecurityError: 'blocked by browser security settings',
  TypeError: 'invalid or unsupported request',
  VersionError: 'incompatible version',
}

function errorDetails(error: unknown): { name: string; message: string } {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return { name: error.name || 'DOMException', message: error.message }
  }
  if (error instanceof Error) {
    return { name: error.name || 'Error', message: error.message }
  }
  if (error && typeof error === 'object') {
    const candidate = error as { name?: unknown; message?: unknown }
    return {
      name:
        typeof candidate.name === 'string' && candidate.name
          ? candidate.name
          : 'UnknownError',
      message:
        typeof candidate.message === 'string' ? candidate.message : 'unknown failure',
    }
  }
  return { name: 'UnknownError', message: 'unknown failure' }
}

function callErrorText(stage: CallStage, error: unknown): string {
  const { name, message } = errorDetails(error)
  // Log only the error name. Never log error messages, SDP, or chat content.
  console.warn(`[call] ${stage} failed: ${name}`)
  const plain = plainErrorNames[name] ?? 'unexpected error'
  return `${stageCopy[stage]} — ${name} (${plain}): ${message || 'no message provided'}`
}

function logErrorName(label: string, error: unknown) {
  const { name } = errorDetails(error)
  console.warn(`[call] ${label}: ${name}`)
}

const iceServers: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
]

if (import.meta.env?.VITE_TURN_URL) {
  iceServers.push({
    urls: import.meta.env.VITE_TURN_URL,
    username: import.meta.env.VITE_TURN_USERNAME || undefined,
    credential: import.meta.env.VITE_TURN_CREDENTIAL || undefined,
  })
}

function idleSnapshot(): CallSnapshot {
  return {
    state: 'idle',
    kind: 'voice',
    callId: '',
    peerId: '',
    peerName: '',
    muted: false,
    cameraOff: false,
    cameraCount: 0,
    cameraLabel: '',
    localStream: null,
    remoteStream: null,
    error: '',
    notice: '',
  }
}

class CallManager {
  private state: CallState = 'idle'
  private kind: CallKind = 'voice'
  private callId = ''
  private peerId = ''
  private peerName = ''
  private pc: RTCPeerConnection | null = null
  private local: MediaStream | null = null
  private remote: MediaStream | null = null
  private muted = false
  private cameraOff = false
  private cameras: MediaDeviceInfo[] = []
  private cameraLabel = ''
  private cameraLabelTimer: number | undefined
  private connectTimer: number | undefined
  private pendingIce: RTCIceCandidateInit[] = []
  private error = ''
  private notice = ''
  private send: SignalingSender = () => undefined
  private listeners = new Set<(snapshot: CallSnapshot) => void>()

  setSignalingSender(sender: SignalingSender) {
    this.send = sender
  }

  subscribe(listener: (snapshot: CallSnapshot) => void) {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  snapshot(): CallSnapshot {
    if (typeof this === 'undefined') return idleSnapshot()
    return {
      state: this.state,
      kind: this.kind,
      callId: this.callId,
      peerId: this.peerId,
      peerName: this.peerName,
      muted: this.muted,
      cameraOff: this.cameraOff,
      cameraCount: this.cameras.length,
      cameraLabel: this.cameraLabel,
      localStream: this.local,
      remoteStream: this.remote,
      error: this.error,
      notice: this.notice,
    }
  }

  private emit() {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }

  private makeId() {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID()
    }
    return `call-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  private startConnectTimer() {
    if (this.connectTimer !== undefined) window.clearTimeout(this.connectTimer)
    this.connectTimer = window.setTimeout(() => {
      if (this.state === 'calling' || this.state === 'connecting') {
        console.info('[call] connect timeout', { callId: this.callId })
        this.fail("Couldn't connect, try again")
      }
    }, 15_000)
  }

  private markConnecting() {
    this.state = 'connecting'
    console.info('[call] connecting', { callId: this.callId })
    this.emit()
    this.startConnectTimer()
  }

  private markConnected() {
    if (this.state === 'connected') return
    if (this.connectTimer !== undefined) {
      window.clearTimeout(this.connectTimer)
      this.connectTimer = undefined
    }
    this.state = 'connected'
    console.info('[call] connected', { callId: this.callId })
    this.emit()
  }

  private async flushIce() {
    const queued = this.pendingIce.splice(0)
    for (const candidate of queued) {
      if (!this.pc?.remoteDescription) {
        this.pendingIce.push(candidate)
        continue
      }
      try {
        await this.pc.addIceCandidate(candidate)
      } catch (error) {
        logErrorName('ice candidate failed', error)
        continue
      }
    }
  }

  private teardown() {
    if (this.cameraLabelTimer !== undefined) {
      window.clearTimeout(this.cameraLabelTimer)
      this.cameraLabelTimer = undefined
    }
    if (this.connectTimer !== undefined) {
      window.clearTimeout(this.connectTimer)
      this.connectTimer = undefined
    }
    this.pendingIce = []
    if (this.local) {
      for (const track of this.local.getTracks()) track.stop()
    }
    if (this.pc) {
      this.pc.onicecandidate = null
      this.pc.ontrack = null
      this.pc.onconnectionstatechange = null
      this.pc.oniceconnectionstatechange = null
      this.pc.close()
    }
    this.local = null
    this.remote = null
    this.pc = null
    this.muted = false
    this.cameraOff = false
    this.cameras = []
    this.cameraLabel = ''
  }

  private reset() {
    this.teardown()
    this.state = 'idle'
    this.callId = ''
    this.peerId = ''
    this.peerName = ''
    this.kind = 'voice'
    this.error = ''
    this.notice = ''
    this.emit()
  }

  private ensurePeerConnection() {
    if (this.pc) return this.pc

    const pc = new RTCPeerConnection({ iceServers })
    this.pc = pc
    this.remote = new MediaStream()

    pc.onicecandidate = (event) => {
      if (!event.candidate || !this.callId || !this.peerId) return
      const candidate = event.candidate.toJSON
        ? event.candidate.toJSON()
        : {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          }
      this.send({
        type: 'call:ice',
        to: this.peerId,
        callId: this.callId,
        candidate,
      })
    }

    pc.ontrack = (event) => {
      const stream = this.remote ?? new MediaStream()
      if (!stream.getTracks().some((track) => track.id === event.track.id)) {
        stream.addTrack(event.track)
      }
      this.remote = stream
      this.emit()
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this.markConnected()
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        if (this.state !== 'ended') {
          this.fail("Couldn't connect, try again")
        }
      }
    }

    pc.oniceconnectionstatechange = () => {
      if (
        pc.iceConnectionState === 'connected' ||
        pc.iceConnectionState === 'completed'
      ) {
        this.markConnected()
      }
    }

    return pc
  }

  private async tryGetMedia(
    constraints: MediaStreamConstraints,
  ): Promise<MediaStream | null> {
    try {
      // Let the browser's exact DOMException reach the caller.
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (error) {
      if (errorDetails(error).name === 'NotFoundError') {
        logErrorName('device unavailable', error)
        return null
      }
      throw error
    }
  }

  private async ensureLocalStream() {
    if (this.local) return this.local

    const video: MediaTrackConstraints = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
    }

    if (this.kind === 'voice') {
      // A voice call never needs a camera, so a missing camera cannot fail it.
      this.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      this.notice = ''
      await this.refreshCameras()
      return this.local
    }

    let stream = await this.tryGetMedia({ audio: true, video })
    if (stream) {
      this.notice = ''
    } else {
      // One device is missing. Keep the call alive with whichever device works.
      stream = await this.tryGetMedia({ audio: true, video: false })
      if (stream) {
        this.kind = 'voice'
        this.notice = 'No camera found, voice call only'
      } else {
        stream = await this.tryGetMedia({ audio: false, video })
        if (stream) {
          this.notice = 'No microphone found'
        } else {
          throw new DOMException('No microphone found', 'NotFoundError')
        }
      }
    }
    this.local = stream
    await this.refreshCameras()
    return this.local
  }

  private attachLocalTracks(pc: RTCPeerConnection, stream: MediaStream) {
    for (const track of stream.getTracks()) {
      if (!pc.getSenders().some((sender) => sender.track === track)) {
        pc.addTrack(track, stream)
      }
    }
  }

  private fail(message: string) {
    this.error = message
    this.hangup()
  }

  async startOutgoing(peerId: string, kind: CallKind, peerName = '') {
    this.reset()
    this.peerId = peerId
    this.peerName = peerName
    this.kind = kind
    this.callId = this.makeId()
    this.state = 'calling'
    this.emit()

    try {
      await this.ensureLocalStream()
    } catch (error) {
      this.fail(callErrorText('getUserMedia', error))
      return
    }

    const activeKind = this.kind
    console.info('[call] invite sent', { callId: this.callId, to: peerId, kind: activeKind })
    this.send({
      type: 'call:invite',
      to: peerId,
      callId: this.callId,
      kind: activeKind,
    })
    this.startConnectTimer()
  }

  handleInvite(event: SignalEvent) {
    if (!event.from || !event.callId || !event.kind) return
    console.info('[call] invite received', {
      callId: event.callId,
      from: event.from,
      kind: event.kind,
    })
    if (this.state !== 'idle') {
      this.send({ type: 'call:reject', to: event.from, callId: event.callId })
      return
    }
    this.peerId = event.from
    this.peerName = event.peerName ?? ''
    this.callId = event.callId
    this.kind = event.kind
    this.state = 'incoming'
    this.error = ''
    this.notice = ''
    this.emit()
  }

  async accept() {
    if (this.state !== 'incoming') return
    this.markConnecting()

    let stage: CallStage = 'getUserMedia'
    try {
      const stream = await this.ensureLocalStream()
      stage = 'peer connection'
      const pc = this.ensurePeerConnection()
      this.attachLocalTracks(pc, stream)
      stage = 'signaling'
      this.send({
        type: 'call:accept',
        to: this.peerId,
        callId: this.callId,
      })
    } catch (error) {
      this.fail(callErrorText(stage, error))
    }
  }

  reject() {
    if (this.peerId && this.callId) {
      this.send({
        type: 'call:reject',
        to: this.peerId,
        callId: this.callId,
      })
    }
    this.reset()
  }

  async handleAccept(event: SignalEvent) {
    if (event.callId !== this.callId || this.state !== 'calling') {
      return
    }
    if (event.from) this.peerId = event.from
    if (event.peerName) this.peerName = event.peerName

    this.markConnecting()

    let stage: CallStage = 'getUserMedia'
    try {
      const stream = await this.ensureLocalStream()
      stage = 'peer connection'
      const pc = this.ensurePeerConnection()
      this.attachLocalTracks(pc, stream)
      stage = 'offer'
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      this.send({
        type: 'call:offer',
        to: this.peerId,
        callId: this.callId,
        sdp: pc.localDescription ?? offer,
      })
    } catch (error) {
      this.fail(callErrorText(stage, error))
    }
  }

  async handleOffer(event: SignalEvent) {
    if (event.callId !== this.callId || !event.sdp) {
      return
    }
    if (event.from) this.peerId = event.from

    let stage: CallStage = 'peer connection'
    try {
      const pc = this.ensurePeerConnection()
      stage = 'signaling'
      await pc.setRemoteDescription(event.sdp)
      await this.flushIce()
      stage = 'answer'
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      console.info('[call] answer sent', { callId: this.callId, to: this.peerId })
      this.send({
        type: 'call:answer',
        to: this.peerId,
        callId: this.callId,
        sdp: pc.localDescription ?? answer,
      })
    } catch (error) {
      this.fail(callErrorText(stage, error))
    }
  }

  async handleAnswer(event: SignalEvent) {
    if (event.callId !== this.callId || !event.sdp) {
      return
    }
    const stage: CallStage = 'signaling'
    try {
      console.info('[call] answer received', { callId: this.callId, from: event.from })
      await this.pc?.setRemoteDescription(event.sdp)
      await this.flushIce()
    } catch (error) {
      this.fail(callErrorText(stage, error))
    }
  }

  async handleIce(event: SignalEvent) {
    if (event.callId !== this.callId || !event.candidate) {
      return
    }
    if (!this.pc?.remoteDescription) {
      this.pendingIce.push(event.candidate)
      return
    }
    try {
      await this.pc.addIceCandidate(event.candidate)
    } catch (error) {
      logErrorName('ice candidate failed', error)
      this.pendingIce.push(event.candidate)
    }
  }

  handleReject(event: SignalEvent) {
    this.handleHangup(event)
  }

  handleHangup(event: SignalEvent) {
    if (event.callId && event.callId !== this.callId) return
    this.teardown()
    this.state = 'ended'
    this.emit()
    window.setTimeout(() => {
      if (this.callId === event.callId) this.reset()
    }, 1800)
  }

  hangup() {
    const callId = this.callId
    if (this.peerId && callId) {
      this.send({ type: 'call:hangup', to: this.peerId, callId })
    }
    this.teardown()
    this.state = 'ended'
    this.emit()
    window.setTimeout(() => {
      if (this.callId === callId) this.reset()
    }, 1800)
  }

  private async refreshCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      this.cameras = []
      this.emit()
      return this.cameras
    }
    try {
      this.cameras = (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === 'videoinput',
      )
    } catch {
      this.cameras = []
    }
    this.emit()
    return this.cameras
  }

  private showCameraLabel(label: string) {
    this.cameraLabel = label
    this.emit()
    if (this.cameraLabelTimer !== undefined) window.clearTimeout(this.cameraLabelTimer)
    this.cameraLabelTimer = window.setTimeout(() => {
      this.cameraLabel = ''
      this.cameraLabelTimer = undefined
      this.emit()
    }, 2000)
  }

  async switchCamera() {
    if (!this.local || this.kind !== 'video' || this.state === 'idle') return
    const cameras = await this.refreshCameras()
    if (cameras.length <= 1) return

    const oldTrack = this.local.getVideoTracks()[0]
    if (!oldTrack) return

    let newStream: MediaStream | undefined
    let label: string
    try {
      if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        const facing = oldTrack.getSettings().facingMode === 'environment' ? 'user' : 'environment'
        try {
          newStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { exact: facing } },
            audio: false,
          })
        } catch {
          newStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: facing },
            audio: false,
          })
        }
        label = facing === 'user' ? 'Front camera' : 'Back camera'
      } else {
        const currentIndex = cameras.findIndex(
          (device) => device.deviceId === oldTrack.getSettings().deviceId,
        )
        const nextIndex = (currentIndex + 1) % cameras.length
        const next = cameras[nextIndex]
        newStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: next.deviceId } },
          audio: false,
        })
        label = next.label || `Camera ${nextIndex + 1}`
      }

      const newTrack = newStream.getVideoTracks()[0]
      if (!newTrack) throw new Error('no video track')

      const sender = this.pc?.getSenders().find((item) => item.track?.kind === 'video')
      if (sender) await sender.replaceTrack(newTrack)

      newTrack.enabled = !this.cameraOff
      this.local.removeTrack(oldTrack)
      oldTrack.stop()
      this.local.addTrack(newTrack)
      this.error = ''
      this.showCameraLabel(label)
      this.emit()
    } catch (error) {
      newStream?.getVideoTracks().forEach((track) => track.stop())
      this.error = callErrorText('camera switch', error)
      this.emit()
    }
  }

  toggleMic() {
    this.muted = !this.muted
    for (const track of this.local?.getAudioTracks() ?? []) {
      track.enabled = !this.muted
    }
    this.emit()
  }

  toggleCamera() {
    this.cameraOff = !this.cameraOff
    for (const track of this.local?.getVideoTracks() ?? []) {
      track.enabled = !this.cameraOff
    }
    this.emit()
  }

  acceptFromPush(data: {
    callId?: unknown
    sender?: unknown
    senderName?: unknown
    kind?: unknown
  }): boolean {
    const callId = typeof data.callId === 'string' ? data.callId : ''
    const sender =
      typeof data.sender === 'string'
        ? data.sender.trim().replace(/^@/, '').toLowerCase()
        : ''
    const kind: CallKind = data.kind === 'video' ? 'video' : 'voice'
    if (!callId || !sender) return false
    if (this.state === 'incoming' && this.callId === callId) {
      void this.accept()
      return true
    }
    if (this.state !== 'idle') return false
    const peerName = typeof data.senderName === 'string' ? data.senderName : sender
    this.handleInvite({
      type: 'call:invite',
      from: sender,
      callId,
      kind,
      peerName,
    } as SignalEvent)
    const stateAfterInvite = this.snapshot().state
    if (stateAfterInvite === 'incoming' && this.callId === callId) {
      void this.accept()
      return true
    }
    return false
  }

  dispose() {
    this.reset()
  }
}

export const callManager = new CallManager()

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    const data = event.data as {
      type?: unknown
      action?: unknown
      callId?: unknown
      sender?: unknown
    } | null
    if (data?.type !== 'honden:call-action') return
    if (data.action === 'accept') {
      callManager.acceptFromPush(data)
    } else if (data.action === 'decline') {
      callManager.handleReject({
        type: 'call:reject',
        callId: data.callId,
        from: data.sender,
      } as SignalEvent)
    }
  })
}
