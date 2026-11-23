import { apiUrl, authHeaders, type CallKind, type SignalEvent } from '../api/client'

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
  connectDiagnostic: string
  retryAvailable: boolean
}

type SignalingSender = (event: SignalEvent) => void

const micMissingMessage =
  'No microphone found on this device, voice call cannot start, use a USB headset or your phone'
const noCameraMessage = 'No camera found, use Voice call instead'

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
  if (message === micMissingMessage) return micMissingMessage
  const plain = plainErrorNames[name] ?? 'unexpected error'
  return `${stageCopy[stage]} — ${name} (${plain}): ${message || 'no message provided'}`
}

function logErrorName(label: string, error: unknown) {
  const { name } = errorDetails(error)
  console.warn(`[call] ${label}: ${name}`)
}

// Render has been seen with a single URL, a comma-separated list, and a JSON
// array string. Accept all three so the client matches whatever is configured.
function parseIceUrls(value: unknown): string[] {
  if (Array.isArray(value)) return normalizeIceUrls(value.map(String))
  if (typeof value !== 'string') return []

  const trimmed = value.trim()
  if (!trimmed) return []

  let items: unknown = trimmed
  if (trimmed.startsWith('[')) {
    try {
      items = JSON.parse(trimmed)
    } catch {
      // A malformed array still gets split below, so one bad entry cannot
      // silently disable TURN for the whole call.
    }
  }
  const values = Array.isArray(items) ? items.map(String) : [String(items)]
  return normalizeIceUrls(values)
}

function normalizeIceUrls(values: string[]): string[] {
  return values
    .flatMap((item) => item.split(/[\s,]+/))
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .filter((item) => /^(stun|stuns|turn|turns):/i.test(item))
    .filter((item, index, all) => all.indexOf(item) === index)
}

const defaultStunUrls = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']
// The old openrelay.metered.ca name now resolves to a blackhole address. OpenRelay's
// current free endpoint is the static-auth host documented by Metered. Its shared secret
// is public; we derive a short-lived username/credential pair from it in the browser.
// Override with VITE_TURN_URLS / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL in env.
const defaultTurnUrls = [
  'turn:staticauth.openrelay.metered.ca:80',
  'turn:staticauth.openrelay.metered.ca:443',
  'turn:staticauth.openrelay.metered.ca:443?transport=tcp',
]
const defaultTurnSecret = 'openrelayprojectsecret'
const envTurnUrls = parseIceUrls(
  import.meta.env?.VITE_TURN_URLS || import.meta.env?.VITE_TURN_URL,
)
let cachedIceServers: RTCIceServer[] | null = null
let useRelayOnly = false

// Render service env vars are available to the server at runtime, but Vite only
// bakes VITE_* vars into the bundle at build time. Prefer the runtime config so
// dashboard changes take effect without a rebuild.
function cleanEnvValue(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/^'(.*)'$/, '$1')
    .trim()
}

type RuntimeTurnConfig = { urls?: unknown; username?: unknown; credential?: unknown }

async function fetchRuntimeTurn(): Promise<RuntimeTurnConfig | null> {
  if (typeof fetch === 'undefined' || typeof localStorage === 'undefined') return null
  try {
    const response = await fetch(apiUrl('/api/turn-config'), { headers: authHeaders() })
    if (!response.ok) return null
    const data = (await response.json()) as RuntimeTurnConfig
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function hmacSha1Base64(secret: string, value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) return ''
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value),
  )
  return toBase64(new Uint8Array(signature))
}

async function getIceServers(): Promise<RTCIceServer[]> {
  if (cachedIceServers) return cachedIceServers

  const runtime = await fetchRuntimeTurn()
  const runtimeUrls = parseIceUrls(cleanEnvValue(runtime?.urls))
  const turnUrls = runtimeUrls.length > 0 ? runtimeUrls : envTurnUrls
  const usernameSource = runtime?.username ?? import.meta.env?.VITE_TURN_USERNAME
  const credentialSource = runtime?.credential ?? import.meta.env?.VITE_TURN_CREDENTIAL
  const envUsername = cleanEnvValue(usernameSource)
  const envCredential = cleanEnvValue(credentialSource)

  const servers: RTCIceServer[] = [{ urls: defaultStunUrls }]
  if (turnUrls.length > 0 && envUsername && envCredential) {
    servers.push({
      urls: turnUrls,
      username: envUsername,
      credential: envCredential,
    })
    // Chrome stops ICE gathering as soon as a host/srflx pair connects, which
    // can leave a configured TURN server completely unused. Send all media
    // through the configured relay so it is actually exercised.
    useRelayOnly = true
  } else {
    useRelayOnly = false
    if (turnUrls.length > 0) {
      console.warn('[call] TURN URL set but username/credential missing, using default')
    }
    const username = `${Math.floor(Date.now() / 1000) + 86_400}:honden`
    const credential = await hmacSha1Base64(defaultTurnSecret, username)
    servers.push({
      urls: defaultTurnUrls,
      username,
      credential,
    })
  }

  // Log names + URLs + auth presence only. Never log a credential or token.
  console.info('[call] TURN env config', {
    VITE_TURN_URLS: turnUrls.length > 0,
    VITE_TURN_USERNAME: Boolean(envUsername),
    VITE_TURN_CREDENTIAL: Boolean(envCredential),
    source:
      runtimeUrls.length > 0
        ? 'runtime-config'
        : envTurnUrls.length > 0
          ? 'VITE_TURN_URLS'
          : 'default-openrelay',
  })
  console.info(
    '[call] ICE servers',
    servers.map((server) => ({
      urls: typeof server.urls === 'string' ? [server.urls] : server.urls,
      auth:
        server.username && server.credential
          ? 'username+credential set'
          : 'missing',
    })),
  )
  cachedIceServers = servers
  return servers
}

function signalLog(message: string, callId: string) {
  console.info(`[call] ${message}`, { callId, date: new Date().toISOString() })
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
    connectDiagnostic: '',
    retryAvailable: false,
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
  private reconnectTimer: number | undefined
  private iceRestartUsed = false
  private reconnecting = false
  // Only the peer that sent the original offer may restart ICE. If both peers
  // restart at once their offers collide and setRemoteDescription fails.
  private restartInitiator = false
  private pendingIce: RTCIceCandidateInit[] = []
  private pendingAcceptCallId = ''
  private error = ''
  private notice = ''
  private micFound = false
  private cameraFound = false
  private relayCandidateSeen = false
  private candidateTypes: string[] = []
  private connectDiagnostic = ''
  private retryAvailable = false
  private lastPeerId = ''
  private lastKind: CallKind = 'voice'
  private lastPeerName = ''
  private send: SignalingSender = () => undefined
  private signalingReady = false
  private pendingSignals: SignalEvent[] = []
  private listeners = new Set<(snapshot: CallSnapshot) => void>()

  setSignalingSender(sender: SignalingSender) {
    this.send = sender
    this.signalingReady = true
    if (this.pendingSignals.length === 0) return
    const queued = this.pendingSignals.splice(0)
    for (const event of queued) this.send(event)
  }

  private emitSignal(event: SignalEvent) {
    if (!this.signalingReady) {
      this.pendingSignals.push(event)
      return
    }
    this.send(event)
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
      connectDiagnostic: this.connectDiagnostic,
      retryAvailable: this.retryAvailable,
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

  private logState(label: string) {
    console.info('[call] state', {
      callId: this.callId,
      label,
      state: this.state,
      connection: this.pc?.connectionState ?? 'none',
      ice: this.pc?.iceConnectionState ?? 'none',
      signaling: this.pc?.signalingState ?? 'none',
    })
  }

  private clearDiagnostic() {
    this.connectDiagnostic = ''
    this.retryAvailable = false
  }

  private refreshDiagnostic() {
    if (this.state !== 'calling' && this.state !== 'connecting') {
      this.clearDiagnostic()
      return
    }
    const ice = this.pc?.iceConnectionState ?? 'checking'
    const turn = this.relayCandidateSeen ? 'working' : 'not working'
    const mic = this.micFound ? 'found' : 'not found'
    const camera = this.cameraFound ? 'found' : 'not found'
    this.connectDiagnostic = `Still connecting, ICE state: ${ice}, TURN: ${turn}, Mic: ${mic}, Camera: ${camera}`
    this.retryAvailable = true
  }

  private startConnectTimer() {
    if (this.connectTimer !== undefined) window.clearTimeout(this.connectTimer)
    this.connectTimer = window.setTimeout(() => {
      if (this.state === 'calling' || this.state === 'connecting') {
        console.info('[call] connect timeout', { callId: this.callId })
        this.logState('connect-timeout')
        this.refreshDiagnostic()
        this.emit()
      }
    }, 10_000)
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
    this.clearReconnectTimer()
    this.reconnecting = false
    this.iceRestartUsed = false
    this.notice = this.notice === 'Reconnecting...' ? '' : this.notice
    this.clearDiagnostic()
    this.state = 'connected'
    console.info('[call] connected', { callId: this.callId })
    this.logState('connected')
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

  private clearReconnectTimer() {
    if (this.reconnectTimer !== undefined) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
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
    this.clearReconnectTimer()
    this.iceRestartUsed = false
    this.reconnecting = false
    this.restartInitiator = false
    this.pendingIce = []
    this.pendingAcceptCallId = ''
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
    this.micFound = false
    this.cameraFound = false
    this.relayCandidateSeen = false
    this.candidateTypes = []
    this.clearDiagnostic()
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
    this.clearDiagnostic()
    this.emit()
  }

  private async ensurePeerConnection() {
    if (this.pc) return this.pc

    const iceServers = await getIceServers()
    const config: RTCConfiguration = { iceServers }
    if (useRelayOnly) config.iceTransportPolicy = 'relay'
    const pc = new RTCPeerConnection(config)
    this.pc = pc
    this.remote = new MediaStream()

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        console.info('[call] ICE gathering complete', {
          callId: this.callId,
          candidateTypes: this.candidateTypes.join(',') || 'none',
          turn: this.relayCandidateSeen ? 'working' : 'not working',
        })
        if (this.retryAvailable) {
          this.refreshDiagnostic()
          this.emit()
        }
        return
      }
      const type = event.candidate.type ?? 'unknown'
      if (!this.candidateTypes.includes(type)) this.candidateTypes.push(type)
      if (type === 'relay') this.relayCandidateSeen = true
      if (this.retryAvailable) {
        this.refreshDiagnostic()
        this.emit()
      }
      if (!this.callId || !this.peerId) return
      const candidate = event.candidate.toJSON
        ? event.candidate.toJSON()
        : {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          }
      this.emitSignal({
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
      this.logState('connectionstatechange')
      if (pc.connectionState === 'connected') {
        this.markConnected()
        return
      }
      if (pc.connectionState === 'disconnected') {
        void this.tryIceRestart('disconnected')
        return
      }
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        if (this.state !== 'ended') {
          void this.tryIceRestart('failed')
        }
      }
    }

    pc.oniceconnectionstatechange = () => {
      this.logState('iceconnectionstatechange')
      if (this.retryAvailable) {
        this.refreshDiagnostic()
        this.emit()
      }
      if (
        pc.iceConnectionState === 'connected' ||
        pc.iceConnectionState === 'completed'
      ) {
        this.markConnected()
        return
      }
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        void this.tryIceRestart(pc.iceConnectionState)
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

    // Voice calls ask for the microphone only. A missing camera can never break
    // this path because it is never requested.
    if (this.kind === 'voice') {
      const audio = await this.tryGetMedia({ audio: true, video: false })
      if (!audio || audio.getAudioTracks().length === 0) {
        throw new DOMException(micMissingMessage, 'NotFoundError')
      }
      this.micFound = true
      this.local = audio
      this.notice = ''
      await this.refreshCameras()
      this.cameraFound = this.cameras.length > 0
      return this.local
    }

    // Video calls ask for audio + video together. If this device has no camera,
    // keep the audio path alive and say so in plain words.
    let media: MediaStream | null = null
    let cameraMissing = false
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
    } catch (error) {
      if (errorDetails(error).name !== 'NotFoundError') throw error
      logErrorName('camera unavailable', error)
      cameraMissing = true
    }

    if (cameraMissing) {
      const audio = await this.tryGetMedia({ audio: true, video: false })
      if (!audio || audio.getAudioTracks().length === 0) {
        throw new DOMException(micMissingMessage, 'NotFoundError')
      }
      this.micFound = true
      this.local = audio
      this.cameraFound = false
      this.kind = 'voice'
      this.notice = noCameraMessage
      await this.refreshCameras()
      return this.local
    }

    if (!media || media.getAudioTracks().length === 0) {
      for (const track of media?.getTracks() ?? []) track.stop()
      throw new DOMException(micMissingMessage, 'NotFoundError')
    }

    this.micFound = true
    this.local = media
    if (media.getVideoTracks().length === 0) {
      this.cameraFound = false
      this.kind = 'voice'
      this.notice = noCameraMessage
    } else {
      this.cameraFound = true
      this.notice = ''
    }
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
    this.logState('fail')
    this.hangup()
  }

  private async tryIceRestart(reason: string) {
    if (this.state === 'ended' || this.state === 'idle') return
    if (!this.pc || !this.peerId || !this.callId) return
    if (!this.restartInitiator) return
    if (this.reconnecting || this.pc.signalingState !== 'stable') return
    if (this.iceRestartUsed) {
      this.fail('Call dropped, connection failed, try again, check your internet')
      return
    }
    this.iceRestartUsed = true
    this.reconnecting = true
    this.notice = 'Reconnecting...'
    if (this.state === 'connected') this.state = 'connecting'
    this.logState(`ice-restart-${reason}`)
    this.emit()
    this.clearReconnectTimer()
    this.reconnectTimer = window.setTimeout(() => {
      if (this.reconnecting && this.state !== 'connected' && this.state !== 'ended') {
        this.fail('Call dropped, connection failed, try again, check your internet')
      }
    }, 10_000)

    try {
      const offer = await this.pc.createOffer({ iceRestart: true })
      await this.pc.setLocalDescription(offer)
      this.emitSignal({
        type: 'call:offer',
        to: this.peerId,
        callId: this.callId,
        sdp: this.pc.localDescription ?? offer,
      })
    } catch (error) {
      logErrorName('ice restart failed', error)
      this.fail('Call dropped, connection failed, try again, check your internet')
    }
  }

  async startOutgoing(peerId: string, kind: CallKind, peerName = '') {
    this.reset()
    this.peerId = peerId
    this.peerName = peerName
    this.kind = kind
    this.restartInitiator = true
    this.lastPeerId = peerId
    this.lastPeerName = peerName
    this.lastKind = kind
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
    this.lastKind = activeKind
    console.info('[call] invite sent', { callId: this.callId, to: peerId, kind: activeKind })
    this.emitSignal({
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
      if (this.pendingAcceptCallId === event.callId) return
      this.emitSignal({ type: 'call:reject', to: event.from, callId: event.callId })
      return
    }
    this.peerId = event.from
    this.peerName = event.peerName ?? ''
    this.callId = event.callId
    this.kind = event.kind
    this.restartInitiator = false
    this.lastPeerId = event.from
    this.lastPeerName = event.peerName ?? ''
    this.lastKind = event.kind
    this.state = 'incoming'
    this.error = ''
    this.notice = ''
    this.emit()
    if (this.pendingAcceptCallId === event.callId) {
      this.pendingAcceptCallId = ''
      void this.accept()
    }
  }

  async accept() {
    if (this.state !== 'incoming') return
    this.markConnecting()

    let stage: CallStage = 'getUserMedia'
    try {
      const stream = await this.ensureLocalStream()
      stage = 'peer connection'
      const pc = await this.ensurePeerConnection()
      this.attachLocalTracks(pc, stream)
      stage = 'signaling'
      this.emitSignal({
        type: 'call:accept',
        to: this.peerId,
        callId: this.callId,
      })
    } catch (error) {
      this.fail(callErrorText(stage, error))
    }
  }

  async retry() {
    if (!this.retryAvailable || (this.state !== 'connecting' && this.state !== 'calling')) return
    signalLog('Retry requested', this.callId)
    this.clearDiagnostic()
    this.notice = ''
    if (this.pc && this.peerId && this.callId) {
      this.iceRestartUsed = false
      this.reconnecting = false
      this.restartInitiator = true
      this.startConnectTimer()
      await this.tryIceRestart('retry')
      return
    }
    if (this.lastPeerId) {
      await this.startOutgoing(this.lastPeerId, this.lastKind, this.lastPeerName)
    }
  }

  reject() {
    if (this.peerId && this.callId) {
      this.emitSignal({
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
      const pc = await this.ensurePeerConnection()
      this.attachLocalTracks(pc, stream)
      stage = 'offer'
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      this.emitSignal({
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
    signalLog('Call offer received', this.callId)

    let stage: CallStage = 'peer connection'
    try {
      const pc = await this.ensurePeerConnection()
      stage = 'signaling'
      await pc.setRemoteDescription(event.sdp)
      await this.flushIce()
      stage = 'answer'
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      signalLog('Call answer sent', this.callId)
      this.emitSignal({
        type: 'call:answer',
        to: this.peerId,
        callId: this.callId,
        sdp: pc.localDescription ?? answer,
      })
      this.logState('answer-sent')
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
      this.logState('answer-applied')
    } catch (error) {
      this.fail(callErrorText(stage, error))
    }
  }

  async handleIce(event: SignalEvent) {
    if (event.callId !== this.callId || !event.candidate) {
      return
    }
    signalLog('ICE candidate received', this.callId)
    if (!this.pc?.remoteDescription) {
      this.pendingIce.push(event.candidate)
      this.logState('ice-queued')
      return
    }
    try {
      await this.pc.addIceCandidate(event.candidate)
      this.logState('ice-applied')
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
      this.emitSignal({ type: 'call:hangup', to: this.peerId, callId })
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
    if (this.state !== 'idle') {
      if (this.callId === callId) this.pendingAcceptCallId = callId
      return false
    }
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
    this.pendingAcceptCallId = callId
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
