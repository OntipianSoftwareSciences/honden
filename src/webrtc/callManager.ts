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

type CallEndReason = 'hung up' | 'ICE disconnected' | 'WebSocket closed' | 'timeout'

// Prefer 720p for video calls, but keep an explicit 480p path for cameras or
// browsers that cannot hold it. Bitrates stay in the 1.5-2.5 Mbps range.
export const VIDEO_CONSTRAINTS_720P: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
}
export const VIDEO_CONSTRAINTS_FALLBACK: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 480 },
}
export const VIDEO_MAX_BITRATE_720P = 2_000_000
export const VIDEO_MAX_BITRATE_FALLBACK = 1_500_000

type SignalingSender = (event: SignalEvent) => void

const micMissingMessage =
  'No microphone found on this device, voice call cannot start, use a USB headset or your phone'
const noCameraMessage = 'No camera found, continuing as voice only'
const videoUnavailableMessage = 'Video unavailable on the other device, continuing as voice only'

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
// Metered retired the shared OpenRelay credentials. staticauth.openrelay.metered.ca
// now resolves to a blackhole (no TCP/ICMP response on 80 or 443) and rejects
// allocations, so leaving it as the fallback silently disabled relay whenever the
// runtime config fetch failed on a flaky mobile connection. Keep the current global
// relay host and include TCP + TLS transports so a strict phone network still has a
// relay path. A runtime /api/turn-config response with per-account credentials always
// takes precedence over these defaults.
const defaultTurnUrls = [
  'turn:global.relay.metered.ca:80',
  'turn:global.relay.metered.ca:443',
  'turn:global.relay.metered.ca:443?transport=tcp',
  'turns:global.relay.metered.ca:443?transport=tcp',
]
const defaultTurnSecret = 'openrelayprojectsecret'
const envTurnUrls = parseIceUrls(
  import.meta.env?.VITE_TURN_URLS || import.meta.env?.VITE_TURN_URL,
)
let cachedIceServers: RTCIceServer[] | null = null
let cachedIceConfigKey = ''
let cachedIceConfigAt = 0
// TURN credentials can be rotated in Render without a redeploy. A long-lived tab
// must not keep using the credentials it loaded when the page first opened.
const ICE_CONFIG_TTL_MS = 60_000

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

// A phone can drop the config fetch while switching between Wi-Fi and mobile data.
// Remember the last config the server actually returned so one failed request cannot
// push the call onto the built-in fallback mid-session.
let lastGoodRuntimeTurn: RuntimeTurnConfig | null = null

async function fetchRuntimeTurn(): Promise<RuntimeTurnConfig | null> {
  if (typeof fetch === 'undefined' || typeof localStorage === 'undefined') {
    return lastGoodRuntimeTurn
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(apiUrl(`/api/turn-config?t=${Date.now()}`), {
        headers: authHeaders(),
        cache: 'no-store',
      })
      if (response.ok) {
        const data = (await response.json()) as RuntimeTurnConfig
        if (data && typeof data === 'object') {
          lastGoodRuntimeTurn = data
          return data
        }
      }
    } catch {
      // Transient network failure. Try once more before reusing the cached config.
    }
    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  return lastGoodRuntimeTurn
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

async function getIceServers(forceRefresh = false): Promise<RTCIceServer[]> {
  const now = Date.now()
  if (
    !forceRefresh &&
    cachedIceServers &&
    now - cachedIceConfigAt < ICE_CONFIG_TTL_MS
  ) {
    return cachedIceServers
  }

  const runtime = await fetchRuntimeTurn()
  const runtimeUrls = parseIceUrls(cleanEnvValue(runtime?.urls))
  const turnUrls = runtimeUrls.length > 0 ? runtimeUrls : envTurnUrls
  const usernameSource = runtime?.username ?? import.meta.env?.VITE_TURN_USERNAME
  const credentialSource = runtime?.credential ?? import.meta.env?.VITE_TURN_CREDENTIAL
  const envUsername = cleanEnvValue(usernameSource)
  const envCredential = cleanEnvValue(credentialSource)
  const source = runtimeUrls.length > 0
    ? 'runtime-config'
    : envTurnUrls.length > 0
      ? 'VITE_TURN_URLS'
      : 'default-openrelay'
  // Identical config means the refresh found nothing new; keep the existing
  // connection settings instead of needlessly replacing a working peer.
  const configKey = JSON.stringify({ turnUrls, envUsername, envCredential, source })
  if (!forceRefresh && cachedIceServers && configKey === cachedIceConfigKey) {
    cachedIceConfigAt = now
    return cachedIceServers
  }

  const servers: RTCIceServer[] = [{ urls: defaultStunUrls }]
  if (turnUrls.length > 0 && envUsername && envCredential) {
    servers.push({
      urls: turnUrls,
      username: envUsername,
      credential: envCredential,
    })
    // TURN is always offered, but never forced: if Metered is unreachable or
    // its credentials have rotated, a host/srflx pair can still carry the call.
    // Relay-only mode turned a TURN outage into a dead call with no candidates.
  } else {
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
    source,
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
  cachedIceConfigKey = configKey
  cachedIceConfigAt = now
  return servers
}

async function refreshIceConfig(): Promise<RTCIceServer[]> {
  cachedIceServers = null
  cachedIceConfigKey = ''
  cachedIceConfigAt = 0
  return getIceServers(true)
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

function is720pTrack(track: MediaStreamTrack): boolean {
  const settings = track.getSettings?.()
  return (
    typeof settings?.width === 'number' &&
    typeof settings?.height === 'number' &&
    settings.width >= 1280 &&
    settings.height >= 720
  )
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
  private iceTroubleTimer: number | undefined
  private connectedLogged = false
  private endedLogged = false
  private signalingClosed = false
  private reconnecting = false
  private rebuildingPeer = false
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
      date: new Date().toISOString(),
      label,
      state: this.state,
      connection: this.pc?.connectionState ?? 'none',
      ice: this.pc?.iceConnectionState ?? 'none',
      signaling: this.pc?.signalingState ?? 'none',
    })
  }

  // Only these two call lifecycle messages are logged. No message content,
  // SDP, credentials, or device details are ever logged.
  private logCallConnected() {
    if (this.connectedLogged) return
    this.connectedLogged = true
    console.info('[call] Call connected', {
      callId: this.callId,
      date: new Date().toISOString(),
    })
  }

  private logCallEnded(reason: CallEndReason) {
    if (this.endedLogged) return
    this.endedLogged = true
    console.info(`[call] Call ended, reason: ${reason}`, {
      callId: this.callId,
      date: new Date().toISOString(),
    })
  }

  // A signaling socket drop does not by itself end a connected call. It is
  // remembered only so an ICE failure that follows it is labelled correctly.
  notifySignalingClosed() {
    if (this.state === 'idle' || this.state === 'ended') return
    this.signalingClosed = true
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
    // With no peer connection there is no ICE state and no TURN result yet. Say
    // so instead of printing fake "checking"/"not working" values while the call
    // is still waiting for the other side to accept.
    const ice = this.pc ? this.pc.iceConnectionState || 'checking' : 'not started'
    const turn = !this.pc ? 'pending' : this.relayCandidateSeen ? 'working' : 'not working'
    const mic = this.micFound ? 'found' : 'not found'
    const camera = this.cameraFound ? 'found' : 'not found'
    this.connectDiagnostic = `Still connecting, ICE: ${ice}, TURN: ${turn}, Mic: ${mic}, Camera: ${camera}`
    this.retryAvailable = true
  }

  private startConnectTimer() {
    if (this.connectTimer !== undefined) window.clearTimeout(this.connectTimer)
    this.connectTimer = window.setTimeout(() => {
      if (this.state === 'calling' || this.state === 'connecting') {
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
    this.clearIceTroubleTimer()
    this.reconnecting = false
    this.notice = this.notice === 'Reconnecting...' ? '' : this.notice
    this.clearDiagnostic()
    this.state = 'connected'
    this.logCallConnected()
    this.logState('connected')
    console.info('[call] ICE connected diagnostic', {
      callId: this.callId,
      date: new Date().toISOString(),
      ice: this.pc?.iceConnectionState ?? 'none',
      candidateTypes: this.candidateTypes.join(',') || 'none',
      turn: this.relayCandidateSeen ? 'working' : 'not working',
      mic: this.micFound ? 'found' : 'not found',
      camera: this.cameraFound ? 'found' : 'not found',
    })
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

  private clearIceTroubleTimer() {
    if (this.iceTroubleTimer !== undefined) {
      window.clearTimeout(this.iceTroubleTimer)
      this.iceTroubleTimer = undefined
    }
  }

  // A short ICE disconnect is normal on mobile and relay networks. Give the
  // connection ten seconds to recover before ending the call. Meanwhile try
  // one ICE restart so it can recover without any user action.
  private handleIceTrouble(label: string) {
    if (this.state !== 'connected' && this.state !== 'connecting') return
    if (this.iceTroubleTimer !== undefined) return
    this.iceTroubleTimer = window.setTimeout(() => {
      this.iceTroubleTimer = undefined
      const ice = this.pc?.iceConnectionState ?? 'failed'
      const connection = this.pc?.connectionState ?? 'failed'
      if (ice === 'connected' || ice === 'completed' || connection === 'connected') {
        this.clearReconnectTimer()
        this.reconnecting = false
        return
      }
      this.fail(
        'Call ended, connection lost',
        this.signalingClosed ? 'WebSocket closed' : 'ICE disconnected',
      )
    }, 10_000)
    if (this.state === 'connecting') {
      // Before the first connection, a failed ICE agent usually means stale or
      // rejected TURN credentials. Rebuild with freshly fetched config instead
      // of restarting the same broken agent.
      if (this.peerId && this.callId) {
        this.emitSignal({ type: 'call:retry', to: this.peerId, callId: this.callId })
      }
      void this.rebuildPeerConnection(label)
      return
    }
    // Only the offerer can send the restart offer. If the answering side lost
    // ICE, ask that offerer to restart instead of waiting for a dead peer.
    if (!this.restartInitiator && this.peerId && this.callId) {
      this.emitSignal({ type: 'call:retry', to: this.peerId, callId: this.callId })
    }
    void this.tryIceRestart(label)
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
    this.clearIceTroubleTimer()
    this.reconnecting = false
    this.rebuildingPeer = false
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
    this.connectedLogged = false
    this.endedLogged = false
    this.signalingClosed = false
    this.clearDiagnostic()
    this.emit()
  }

  private async ensurePeerConnection(freshConfig = false) {
    if (this.pc && !freshConfig) return this.pc

    const iceServers = freshConfig ? await refreshIceConfig() : await getIceServers()
    const config: RTCConfiguration = { iceServers }
    const pc = new RTCPeerConnection(config)
    this.pc = pc
    this.remote = new MediaStream()

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        console.info('[call] ICE gathering complete', {
          callId: this.callId,
          date: new Date().toISOString(),
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
        this.handleIceTrouble('disconnected')
        return
      }
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        if (this.state !== 'ended') {
          this.handleIceTrouble('failed')
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
        this.handleIceTrouble(pc.iceConnectionState)
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

  private async requestVideoMedia(audio: boolean): Promise<MediaStream> {
    const request = (video: MediaTrackConstraints) =>
      navigator.mediaDevices.getUserMedia({ audio, video })
    try {
      const stream = await request(VIDEO_CONSTRAINTS_720P)
      const track = stream.getVideoTracks()[0]
      if (track && !is720pTrack(track)) {
        // The camera accepted the call but cannot actually deliver 720p.
        // Stop it cleanly and retry with the explicit 480p constraints.
        for (const item of stream.getTracks()) item.stop()
        return await request(VIDEO_CONSTRAINTS_FALLBACK)
      }
      return stream
    } catch (error) {
      // Overconstrained is the one failure a lower resolution can fix. Every
      // other video failure is handled by the caller's audio-only fallback.
      if (errorDetails(error).name !== 'OverconstrainedError') throw error
      return await request(VIDEO_CONSTRAINTS_FALLBACK)
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
      media = await this.requestVideoMedia(true)
    } catch (error) {
      // NotFound, Overconstrained, NotAllowed, NotReadable and every other
      // video-only failure must fall back to audio instead of ending the call.
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
      this.lastKind = 'voice'
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
      this.lastKind = 'voice'
      this.notice = noCameraMessage
    } else {
      this.cameraFound = true
      this.notice = ''
    }
    await this.refreshCameras()
    return this.local
  }

  private async applyVideoBitrate(sender: RTCRtpSender, track: MediaStreamTrack) {
    if (
      typeof sender.setParameters !== 'function' ||
      typeof sender.getParameters !== 'function'
    ) {
      return
    }
    const maxBitrate = is720pTrack(track)
      ? VIDEO_MAX_BITRATE_720P
      : VIDEO_MAX_BITRATE_FALLBACK
    try {
      const parameters = sender.getParameters()
      const encodings = parameters.encodings?.length
        ? parameters.encodings
        : [{} as RTCRtpEncodingParameters]
      await sender.setParameters({
        ...parameters,
        encodings: encodings.map((encoding) => ({ ...encoding, maxBitrate })),
      })
    } catch {
      // A browser may refuse encoding changes; WebRTC still negotiates a
      // workable bitrate, so never fail the call over this hint.
    }
  }

  private async attachLocalTracks(pc: RTCPeerConnection, stream: MediaStream) {
    for (const track of stream.getTracks()) {
      if (!pc.getSenders().some((sender) => sender.track === track)) {
        const sender = pc.addTrack(track, stream)
        if (track.kind === 'video') await this.applyVideoBitrate(sender, track)
      }
    }
  }

  private fail(message: string, reason: CallEndReason = 'ICE disconnected') {
    this.error = message
    this.logCallEnded(reason)
    this.logState('fail')
    this.hangup()
  }

  // Rebuild the ICE agent with fresh server settings. Reusing a peer connection
  // keeps its original TURN configuration, so a stale credential can never be
  // replaced by a normal ICE restart.
  private async rebuildPeerConnection(reason: string) {
    if (this.state === 'ended' || this.state === 'idle') return
    if (this.rebuildingPeer || !this.peerId || !this.callId || !this.local) return
    this.rebuildingPeer = true
    signalLog(`Rebuilding peer connection: ${reason}`, this.callId)

    const previous = this.pc
    if (previous) {
      previous.onicecandidate = null
      previous.ontrack = null
      previous.onconnectionstatechange = null
      previous.oniceconnectionstatechange = null
      previous.close()
    }
    this.pc = null
    this.pendingIce = []
    this.relayCandidateSeen = false
    this.candidateTypes = []
    this.remote = new MediaStream()
    this.emit()

    try {
      const pc = await this.ensurePeerConnection(true)
      await this.attachLocalTracks(pc, this.local)
      if (this.restartInitiator) {
        const offer = await pc.createOffer({ iceRestart: true })
        await pc.setLocalDescription(offer)
        this.emitSignal({
          type: 'call:offer',
          to: this.peerId,
          callId: this.callId,
          sdp: pc.localDescription ?? offer,
        })
      }
      this.logState(`peer-rebuilt-${reason}`)
    } catch (error) {
      logErrorName('peer rebuild failed', error)
    } finally {
      this.rebuildingPeer = false
    }
  }

  private async tryIceRestart(reason: string) {
    if (this.state === 'ended' || this.state === 'idle') return
    if (!this.pc || !this.peerId || !this.callId) return
    if (!this.restartInitiator) return
    if (this.reconnecting || this.pc.signalingState !== 'stable') return
    this.reconnecting = true
    this.notice = 'Reconnecting...'
    if (this.state === 'connected') this.state = 'connecting'
    this.logState(`ice-restart-${reason}`)
    this.emit()
    this.clearReconnectTimer()
    // The ICE trouble timer is the single source of truth for ending a call.
    // This only releases the reconnect flag; it must not hang up by itself.
    this.reconnectTimer = window.setTimeout(() => {
      if (this.reconnecting && this.state !== 'connected' && this.state !== 'ended') {
        this.reconnecting = false
        this.notice = ''
        this.emit()
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
      this.reconnecting = false
      this.notice = ''
      this.emit()
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
      await this.attachLocalTracks(pc, stream)
      stage = 'signaling'
      this.emitSignal({
        type: 'call:accept',
        to: this.peerId,
        callId: this.callId,
        kind: this.kind,
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
      this.reconnecting = false
      this.startConnectTimer()
      this.emitSignal({ type: 'call:retry', to: this.peerId, callId: this.callId })
      await this.rebuildPeerConnection('retry')
      return
    }
    if (this.lastPeerId) {
      await this.startOutgoing(this.lastPeerId, this.lastKind, this.lastPeerName)
    }
  }

  reject() {
    this.logCallEnded('hung up')
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
      // The answerer may have had to drop video for a missing camera. Match
      // that decision here so the caller stops showing a dead video call.
      if (event.kind === 'voice' && this.kind === 'video') {
        this.kind = 'voice'
        this.lastKind = 'voice'
        this.notice = videoUnavailableMessage
        for (const track of stream.getVideoTracks()) {
          stream.removeTrack(track)
          track.stop()
        }
        this.emit()
      }
      stage = 'peer connection'
      const pc = await this.ensurePeerConnection()
      await this.attachLocalTracks(pc, stream)
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
      if (this.reconnecting) {
        this.reconnecting = false
        this.notice = ''
      }
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

  async handleRetry(event: SignalEvent) {
    if (event.callId !== this.callId) return
    if (
      this.state !== 'calling' &&
      this.state !== 'connecting' &&
      this.state !== 'connected'
    ) {
      return
    }
    signalLog('Retry received', this.callId)
    this.clearDiagnostic()
    if (this.state === 'connected') {
      this.state = 'connecting'
      this.notice = 'Reconnecting...'
    } else {
      this.notice = ''
    }
    this.startConnectTimer()
    // Do not echo the retry back; that makes both peers rebuild in a loop.
    await this.rebuildPeerConnection('peer-retry')
  }

  handleReject(event: SignalEvent) {
    this.handleHangup(event)
  }

  handleHangup(event: SignalEvent) {
    if (event.callId && event.callId !== this.callId) return
    this.logCallEnded('hung up')
    this.teardown()
    this.state = 'ended'
    this.emit()
    window.setTimeout(() => {
      if (this.callId === event.callId) this.reset()
    }, 1800)
  }

  hangup() {
    this.logCallEnded('hung up')
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
            video: { ...VIDEO_CONSTRAINTS_720P, facingMode: { exact: facing } },
            audio: false,
          })
        } catch {
          newStream = await navigator.mediaDevices.getUserMedia({
            video: { ...VIDEO_CONSTRAINTS_720P, facingMode: facing },
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
          video: { ...VIDEO_CONSTRAINTS_720P, deviceId: { exact: next.deviceId } },
          audio: false,
        })
        label = next.label || `Camera ${nextIndex + 1}`
      }

      const newTrack = newStream.getVideoTracks()[0]
      if (!newTrack) throw new Error('no video track')

      const sender = this.pc?.getSenders().find((item) => item.track?.kind === 'video')
      if (sender) {
        await sender.replaceTrack(newTrack)
        await this.applyVideoBitrate(sender, newTrack)
      }

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

  // A camera can appear after a call started as voice-only (USB webcam,
  // permission granted late). Add it to the live call without re-calling.
  async enableCamera() {
    if (
      this.state !== 'connected' ||
      !this.local ||
      this.local.getAudioTracks().length === 0
    ) {
      return
    }

    const existing = this.local.getVideoTracks()[0]
    if (existing) {
      existing.enabled = true
      this.cameraOff = false
      this.notice = ''
      this.emit()
      return
    }

    let stream: MediaStream
    try {
      stream = await this.requestVideoMedia(false)
    } catch (error) {
      logErrorName('camera unavailable', error)
      this.notice = noCameraMessage
      this.emit()
      return
    }

    const track = stream.getVideoTracks()[0]
    if (!track) {
      this.notice = noCameraMessage
      this.emit()
      return
    }

    track.enabled = true
    this.local.addTrack(track)
    this.cameraFound = true
    this.kind = 'video'
    this.lastKind = 'video'
    this.cameraOff = false
    this.notice = ''
    this.error = ''

    const pc = this.pc
    if (pc && pc.signalingState === 'stable') {
      try {
        const sender = pc.addTrack(track, this.local)
        await this.applyVideoBitrate(sender, track)
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        this.emitSignal({
          type: 'call:offer',
          to: this.peerId,
          callId: this.callId,
          sdp: pc.localDescription ?? offer,
        })
      } catch (error) {
        logErrorName('camera enable failed', error)
      }
    }

    await this.refreshCameras()
    this.emit()
  }

  toggleMic() {
    this.muted = !this.muted
    for (const track of this.local?.getAudioTracks() ?? []) {
      track.enabled = !this.muted
    }
    this.emit()
  }

  async toggleCamera() {
    if (!this.local || this.state === 'idle') return
    const track = this.local.getVideoTracks()[0]
    if (!track) {
      await this.enableCamera()
      return
    }
    this.cameraOff = !this.cameraOff
    track.enabled = !this.cameraOff
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
