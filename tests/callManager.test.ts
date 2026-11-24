import assert from 'node:assert/strict'
import { afterEach, before, beforeEach, test } from 'node:test'

type FakeTrack = {
  id: string
  kind: 'audio' | 'video'
  enabled: boolean
  stop: () => void
  getSettings: () => Record<string, unknown>
}

type FakeSignal = {
  type: string
  to?: string
  from?: string
  callId?: string
  kind?: string
  sdp?: unknown
  candidate?: unknown
  peerName?: string
}

let trackSeq = 0
function fakeTrack(
  kind: 'audio' | 'video',
  settings: Record<string, unknown> = {},
): FakeTrack {
  trackSeq += 1
  return {
    id: `${kind}-${trackSeq}`,
    kind,
    enabled: true,
    stop() {},
    getSettings: () =>
      kind === 'video' ? { width: 1280, height: 720, ...settings } : settings,
  }
}

class FakeMediaStream {
  private tracks: FakeTrack[]
  constructor(tracks: FakeTrack[] = []) {
    this.tracks = tracks
  }
  getTracks() {
    return this.tracks
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio')
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video')
  }
  addTrack(track: FakeTrack) {
    this.tracks.push(track)
  }
  removeTrack(track: FakeTrack) {
    this.tracks = this.tracks.filter((item) => item !== track)
  }
}

type PcFailures = {
  create?: unknown
  createOffer?: unknown
  createAnswer?: unknown
  setRemoteDescription?: unknown
  addIceCandidate?: unknown
}

let pcFailures: PcFailures = {}

class FakeRTCPeerConnection {
  static instances: FakeRTCPeerConnection[] = []
  static configs: RTCConfiguration[] = []
  static parameters: RTCRtpParameters[] = []
  localDescription: unknown = null
  remoteDescription: unknown = null
  connectionState = 'new'
  iceConnectionState = 'new'
  onicecandidate: ((event: { candidate: unknown }) => void) | null = null
  ontrack: ((event: { track: FakeTrack }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  private senders: {
    track: FakeTrack
    getParameters: () => RTCRtpSendParameters
    setParameters: (parameters: RTCRtpParameters) => Promise<void>
    replaceTrack: (track: FakeTrack) => Promise<void>
  }[] = []

  constructor(config?: RTCConfiguration) {
    if (pcFailures.create) throw pcFailures.create
    FakeRTCPeerConnection.configs.push(config ?? {})
    FakeRTCPeerConnection.instances.push(this)
  }

  addTrack(track: FakeTrack) {
    const sender = {
      track,
      getParameters: () =>
        ({
          transactionId: 'test',
          codecs: [],
          headerExtensions: [],
          rtcp: { cname: 'test', ssrc: 0, mux: true, reducedSize: true },
          encodings: [],
        }) as RTCRtpSendParameters,
      setParameters: async (parameters: RTCRtpParameters) => {
        FakeRTCPeerConnection.parameters.push(parameters)
      },
      replaceTrack: async () => {},
    }
    this.senders.push(sender)
    return sender
  }

  getSenders() {
    return this.senders
  }

  async createOffer() {
    if (pcFailures.createOffer) throw pcFailures.createOffer
    return { type: 'offer', sdp: 'v=0 offer' }
  }

  async createAnswer() {
    if (pcFailures.createAnswer) throw pcFailures.createAnswer
    return { type: 'answer', sdp: 'v=0 answer' }
  }

  async setLocalDescription(description: unknown) {
    this.localDescription = description
  }

  async setRemoteDescription(description: unknown) {
    if (pcFailures.setRemoteDescription) throw pcFailures.setRemoteDescription
    this.remoteDescription = description
  }

  async addIceCandidate() {
    if (pcFailures.addIceCandidate) throw pcFailures.addIceCandidate
  }

  close() {}
}

let getUserMediaImpl: (constraints: MediaStreamConstraints) => Promise<unknown>
let enumerateDevicesImpl: () => Promise<unknown[]>

function defineGlobal(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  })
}

defineGlobal('window', {
  addEventListener() {},
  setTimeout: () => 0,
  clearTimeout() {},
})
defineGlobal('navigator', {
  userAgent: 'node',
  mediaDevices: {
    getUserMedia: (constraints: MediaStreamConstraints) => getUserMediaImpl(constraints),
    enumerateDevices: () => enumerateDevicesImpl(),
  },
})
defineGlobal('MediaStream', FakeMediaStream)
defineGlobal('RTCPeerConnection', FakeRTCPeerConnection)

let manager: typeof import('../src/webrtc/callManager')['callManager']
let sent: FakeSignal[] = []
let warnings: string[] = []
let originalWarn: typeof console.warn

let video720p: MediaTrackConstraints
let videoFallback: MediaTrackConstraints
let bitrate720p: number
let bitrateFallback: number

before(async () => {
  const module = await import('../src/webrtc/callManager')
  manager = module.callManager
  video720p = module.VIDEO_CONSTRAINTS_720P
  videoFallback = module.VIDEO_CONSTRAINTS_FALLBACK
  bitrate720p = module.VIDEO_MAX_BITRATE_720P
  bitrateFallback = module.VIDEO_MAX_BITRATE_FALLBACK
})

beforeEach(() => {
  trackSeq = 0
  pcFailures = {}
  sent = []
  warnings = []
  FakeRTCPeerConnection.configs = []
  FakeRTCPeerConnection.parameters = []
  getUserMediaImpl = async () => new FakeMediaStream([fakeTrack('audio')])
  enumerateDevicesImpl = async () => [
    { kind: 'videoinput', deviceId: 'cam-1', label: 'Camera' },
  ]
  originalWarn = console.warn
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(' '))
  }
  ;(manager as unknown as { reset: () => void }).reset()
  manager.setSignalingSender((event) => sent.push(event as FakeSignal))
})

afterEach(() => {
  console.warn = originalWarn
})

function assertNoMessageLogged(message: string) {
  assert.equal(
    warnings.some((line) => line.includes(message)),
    false,
    `browser console logged message content: ${message}`,
  )
}

async function placeCall(kind: 'voice' | 'video') {
  await manager.startOutgoing('skypuppy', kind, '@skypuppy')
  const callId = manager.snapshot().callId
  await manager.handleAccept({
    type: 'call:accept',
    from: 'skypuppy',
    callId,
  })
  const offer = sent.find((event) => event.type === 'call:offer')
  assert.ok(offer, 'call offer was not sent')
  await manager.handleAnswer({
    type: 'call:answer',
    from: 'skypuppy',
    callId,
    sdp: { type: 'answer', sdp: 'v=0 answer' },
  })
  const pc = FakeRTCPeerConnection.instances.at(-1)
  assert.ok(pc)
  pc.connectionState = 'connected'
  pc.onconnectionstatechange?.()
  return callId
}

test('voice-only call connects first', async () => {
  let constraints: MediaStreamConstraints | undefined
  getUserMediaImpl = async (next) => {
    constraints = next
    return new FakeMediaStream([fakeTrack('audio')])
  }

  await placeCall('voice')

  assert.deepEqual(constraints, { audio: true, video: false })
  assert.equal(sent.find((event) => event.type === 'call:invite')?.kind, 'voice')
  assert.equal(manager.snapshot().state, 'connected')
  assert.equal(manager.snapshot().error, '')
})

test('video call connects second', async () => {
  let constraints: MediaStreamConstraints | undefined
  getUserMediaImpl = async (next) => {
    constraints = next
    return new FakeMediaStream([fakeTrack('audio'), fakeTrack('video')])
  }

  await placeCall('video')

  assert.deepEqual(constraints, { audio: true, video: video720p })
  assert.equal(sent.find((event) => event.type === 'call:invite')?.kind, 'video')
  assert.equal(manager.snapshot().state, 'connected')
  assert.equal(manager.snapshot().error, '')
})

test('video calls request 720p and set a 2 Mbps sender bitrate', async () => {
  let constraints: MediaStreamConstraints | undefined
  getUserMediaImpl = async (next) => {
    constraints = next
    return new FakeMediaStream([fakeTrack('audio'), fakeTrack('video')])
  }

  await placeCall('video')

  assert.deepEqual(video720p, { width: { ideal: 1280 }, height: { ideal: 720 } })
  assert.equal(bitrate720p, 2_000_000)
  assert.deepEqual(constraints, { audio: true, video: video720p })
  const parameters = FakeRTCPeerConnection.parameters.at(-1)
  assert.equal(parameters?.encodings?.[0]?.maxBitrate, bitrate720p)
})

test('video calls fall back to 480p when 720p is overconstrained', async () => {
  const requested: MediaStreamConstraints[] = []
  getUserMediaImpl = async (next) => {
    requested.push(next)
    if (next.video === video720p) {
      throw new DOMException('Constraints not satisfied', 'OverconstrainedError')
    }
    return new FakeMediaStream([
      fakeTrack('audio'),
      fakeTrack('video', { width: 640, height: 480 }),
    ])
  }

  await placeCall('video')

  assert.deepEqual(videoFallback, { width: { ideal: 640 }, height: { ideal: 480 } })
  assert.equal(bitrateFallback, 1_500_000)
  assert.deepEqual(requested, [
    { audio: true, video: video720p },
    { audio: true, video: videoFallback },
  ])
  const parameters = FakeRTCPeerConnection.parameters.at(-1)
  assert.equal(parameters?.encodings?.[0]?.maxBitrate, bitrateFallback)
})

test('video calls retry with 480p when the camera cannot deliver 720p', async () => {
  const requested: MediaStreamConstraints[] = []
  getUserMediaImpl = async (next) => {
    requested.push(next)
    return new FakeMediaStream([
      fakeTrack('audio'),
      fakeTrack('video', { width: 640, height: 480 }),
    ])
  }

  await placeCall('video')

  assert.equal(requested.length, 2)
  assert.deepEqual(requested[1], { audio: true, video: videoFallback })
})

test('switching cameras keeps the 720p preference', async () => {
  const requested: MediaStreamConstraints[] = []
  enumerateDevicesImpl = async () => [
    { kind: 'videoinput', deviceId: 'cam-1', label: 'Camera 1' },
    { kind: 'videoinput', deviceId: 'cam-2', label: 'Camera 2' },
  ]
  getUserMediaImpl = async (next) => {
    requested.push(next)
    const video = next.video
    const isSwitch =
      Boolean(video) && typeof video === 'object' && 'deviceId' in video
    return new FakeMediaStream([
      fakeTrack('audio'),
      fakeTrack('video', { deviceId: isSwitch ? 'cam-2' : 'cam-1' }),
    ])
  }

  await placeCall('video')
  await manager.switchCamera()

  assert.deepEqual(requested[1], {
    audio: false,
    video: { ...video720p, deviceId: { exact: 'cam-2' } },
  })
})

test('TURN is configured and gathered relay candidates mark TURN working', async () => {
  getUserMediaImpl = async () => new FakeMediaStream([fakeTrack('audio'), fakeTrack('video')])
  await manager.startOutgoing('skypuppy', 'video', '@skypuppy')
  const callId = manager.snapshot().callId
  await manager.handleAccept({ type: 'call:accept', from: 'skypuppy', callId, kind: 'video' })

  const config = FakeRTCPeerConnection.configs.at(-1)
  assert.ok(config, 'peer connection config was not captured')
  const hasTurn = (config.iceServers ?? []).some((server) => {
    const urls = typeof server.urls === 'string' ? [server.urls] : server.urls
    return urls.some((url) => /^turns?:/i.test(url))
  })
  assert.equal(hasTurn, true, 'peer connection was created without a TURN server')

  const pc = FakeRTCPeerConnection.instances.at(-1)
  assert.ok(pc)
  pc.iceConnectionState = 'checking'
  const relayCandidate = 'candidate:1 1 udp 1 192.0.2.1 3478 typ relay'
  pc.onicecandidate?.({
    candidate: {
      type: 'relay',
      candidate: relayCandidate,
      sdpMid: '0',
      sdpMLineIndex: 0,
      toJSON: () => ({ candidate: relayCandidate, sdpMid: '0', sdpMLineIndex: 0 }),
    },
  })

  const iceEvent = sent.find((event) => event.type === 'call:ice')
  assert.equal(iceEvent?.candidate?.candidate, relayCandidate)

  ;(manager as unknown as { refreshDiagnostic: () => void }).refreshDiagnostic()
  assert.match(manager.snapshot().connectDiagnostic, /TURN: working/)
  assert.equal(manager.snapshot().state, 'connecting')
})

test('connect diagnostic does not claim TURN failed before ICE starts', async () => {
  await manager.startOutgoing('skypuppy', 'video', '@skypuppy')
  ;(manager as unknown as { refreshDiagnostic: () => void }).refreshDiagnostic()

  const diagnostic = manager.snapshot().connectDiagnostic
  assert.match(diagnostic, /ICE: not started/)
  assert.match(diagnostic, /TURN: pending/)
  assert.doesNotMatch(diagnostic, /TURN: not working/)
})

test('voice getUserMedia failure shows the exact DOMException', async () => {
  getUserMediaImpl = async () => {
    throw new DOMException('Permission denied', 'NotAllowedError')
  }

  await manager.startOutgoing('skypuppy', 'voice')

  const snapshot = manager.snapshot()
  assert.equal(snapshot.state, 'ended')
  assert.match(snapshot.error, /getUserMedia/)
  assert.match(snapshot.error, /NotAllowedError/)
  assert.match(snapshot.error, /permission denied/)
  assert.match(snapshot.error, /Permission denied/)
  assert.ok(warnings.includes('[call] getUserMedia failed: NotAllowedError'))
  assertNoMessageLogged('Permission denied')
})

test('video getUserMedia failure shows the exact DOMException', async () => {
  getUserMediaImpl = async () => {
    throw new DOMException('Could not start video source', 'NotReadableError')
  }

  await manager.startOutgoing('skypuppy', 'video')

  const snapshot = manager.snapshot()
  assert.match(snapshot.error, /getUserMedia/)
  assert.match(snapshot.error, /NotReadableError/)
  assert.match(snapshot.error, /Could not start video source/)
  assert.ok(warnings.includes('[call] getUserMedia failed: NotReadableError'))
  assertNoMessageLogged('Could not start video source')
})

test('offer failure shows the offer stage and real error', async () => {
  pcFailures = { createOffer: new DOMException('Invalid state', 'InvalidStateError') }
  await manager.startOutgoing('skypuppy', 'voice')

  await manager.handleAccept({
    type: 'call:accept',
    from: 'skypuppy',
    callId: manager.snapshot().callId,
  })

  const snapshot = manager.snapshot()
  assert.match(snapshot.error, /offer/)
  assert.match(snapshot.error, /InvalidStateError/)
  assert.match(snapshot.error, /Invalid state/)
  assert.ok(warnings.includes('[call] offer failed: InvalidStateError'))
  assertNoMessageLogged('Invalid state')
})

test('signaling failure shows the signaling stage and real error', async () => {
  pcFailures = {
    setRemoteDescription: new DOMException('Bad description', 'InvalidStateError'),
  }
  await manager.startOutgoing('skypuppy', 'voice')
  const callId = manager.snapshot().callId
  await manager.handleAccept({ type: 'call:accept', from: 'skypuppy', callId })

  await manager.handleOffer({
    type: 'call:offer',
    from: 'skypuppy',
    callId,
    sdp: { type: 'offer', sdp: 'v=0 offer' },
  })

  const snapshot = manager.snapshot()
  assert.match(snapshot.error, /signaling/)
  assert.match(snapshot.error, /InvalidStateError/)
  assert.match(snapshot.error, /Bad description/)
  assert.ok(warnings.includes('[call] signaling failed: InvalidStateError'))
  assertNoMessageLogged('Bad description')
})

test('ICE failure logs only the error name', async () => {
  pcFailures = { addIceCandidate: new DOMException('ICE candidate failed', 'OperationError') }
  const callId = await placeCall('voice')

  await manager.handleIce({
    type: 'call:ice',
    from: 'skypuppy',
    callId,
    candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 },
  })

  assert.ok(warnings.includes('[call] ice candidate failed: OperationError'))
  assertNoMessageLogged('ICE candidate failed')
  assert.equal(manager.snapshot().error, '')
})

test('voice-only call works with no camera', async () => {
  enumerateDevicesImpl = async () => []
  getUserMediaImpl = async (next) => {
    assert.deepEqual(next, { audio: true, video: false })
    return new FakeMediaStream([fakeTrack('audio')])
  }

  await placeCall('voice')

  const snapshot = manager.snapshot()
  assert.equal(snapshot.state, 'connected')
  assert.equal(snapshot.kind, 'voice')
  assert.equal(snapshot.cameraCount, 0)
  assert.equal(snapshot.notice, '')
  assert.equal(sent.find((event) => event.type === 'call:invite')?.kind, 'voice')
})

test('voice call never requests video even when a camera is present', async () => {
  const requested: MediaStreamConstraints[] = []
  getUserMediaImpl = async (next) => {
    requested.push(next)
    return new FakeMediaStream([fakeTrack('audio')])
  }

  await placeCall('voice')

  assert.deepEqual(requested, [{ audio: true, video: false }])
  assert.equal(manager.snapshot().kind, 'voice')
  assert.equal(manager.snapshot().notice, '')
})

test('video call with no camera keeps the voice path working', async () => {
  enumerateDevicesImpl = async () => []
  const requested: MediaStreamConstraints[] = []
  getUserMediaImpl = async (next) => {
    requested.push(next)
    if (next.video) {
      throw new DOMException('Requested device not found', 'NotFoundError')
    }
    return new FakeMediaStream([fakeTrack('audio')])
  }

  await placeCall('video')

  assert.deepEqual(requested, [
    { audio: true, video: video720p },
    { audio: true, video: false },
  ])
  const snapshot = manager.snapshot()
  assert.equal(snapshot.state, 'connected')
  assert.equal(snapshot.kind, 'voice')
  assert.equal(snapshot.notice, 'No camera found, use Voice call instead')
  assert.equal(sent.find((event) => event.type === 'call:invite')?.kind, 'voice')
  assert.ok(warnings.includes('[call] camera unavailable: NotFoundError'))
  assertNoMessageLogged('Requested device not found')
})

test('video call with a stream but no video track shows the plain camera message', async () => {
  getUserMediaImpl = async () => new FakeMediaStream([fakeTrack('audio')])

  await placeCall('video')

  const snapshot = manager.snapshot()
  assert.equal(snapshot.state, 'connected')
  assert.equal(snapshot.kind, 'voice')
  assert.equal(snapshot.notice, 'No camera found, use Voice call instead')
})

test('missing microphone fails with a plain message, not a generic connect error', async () => {
  const requested: MediaStreamConstraints[] = []
  getUserMediaImpl = async (next) => {
    requested.push(next)
    throw new DOMException('Requested device not found', 'NotFoundError')
  }

  await manager.startOutgoing('skypuppy', 'video')

  assert.deepEqual(requested, [
    { audio: true, video: video720p },
    { audio: true, video: false },
  ])
  const snapshot = manager.snapshot()
  assert.equal(snapshot.state, 'ended')
  assert.equal(
    snapshot.error,
    'No microphone found on this device, voice call cannot start, use a USB headset or your phone',
  )
  assert.equal(sent.find((event) => event.type === 'call:invite'), undefined)
  assert.ok(warnings.includes('[call] getUserMedia failed: NotFoundError'))
  assertNoMessageLogged('Requested device not found')
})

test('no microphone or camera fails with the same plain message', async () => {
  getUserMediaImpl = async () => {
    throw new DOMException('No input device found', 'NotFoundError')
  }

  await manager.startOutgoing('skypuppy', 'video')

  const snapshot = manager.snapshot()
  assert.equal(snapshot.state, 'ended')
  assert.equal(
    snapshot.error,
    'No microphone found on this device, voice call cannot start, use a USB headset or your phone',
  )
  assert.ok(warnings.includes('[call] getUserMedia failed: NotFoundError'))
  assertNoMessageLogged('No input device found')
})

test('permission errors are not treated as missing devices', async () => {
  let calls = 0
  getUserMediaImpl = async () => {
    calls += 1
    throw new DOMException('Permission denied', 'NotAllowedError')
  }

  await manager.startOutgoing('skypuppy', 'video')

  assert.equal(calls, 1)
  const snapshot = manager.snapshot()
  assert.match(snapshot.error, /NotAllowedError/)
  assert.match(snapshot.error, /Permission denied/)
  assert.ok(warnings.includes('[call] getUserMedia failed: NotAllowedError'))
  assertNoMessageLogged('Permission denied')
})

test('video answered as voice falls back cleanly on the caller', async () => {
  getUserMediaImpl = async () => new FakeMediaStream([fakeTrack('audio'), fakeTrack('video')])
  await manager.startOutgoing('heather', 'video', '@heather')
  const callId = manager.snapshot().callId

  await manager.handleAccept({
    type: 'call:accept',
    from: 'heather',
    callId,
    kind: 'voice',
  })

  const snapshot = manager.snapshot()
  assert.equal(snapshot.kind, 'voice')
  assert.equal(snapshot.notice, 'Video unavailable on the other device, using voice only')
  const pc = FakeRTCPeerConnection.instances.at(-1)
  assert.equal(pc?.getSenders().some((sender) => sender.track.kind === 'video'), false)
})

test('answering video without a camera sends a voice accept with the plain notice', async () => {
  enumerateDevicesImpl = async () => []
  const requested: MediaStreamConstraints[] = []
  getUserMediaImpl = async (next) => {
    requested.push(next)
    if (next.video) throw new DOMException('Requested device not found', 'NotFoundError')
    return new FakeMediaStream([fakeTrack('audio')])
  }

  manager.handleInvite({
    type: 'call:invite',
    from: 'heather',
    callId: 'call-no-camera',
    kind: 'video',
    peerName: '@heather',
  })
  await manager.accept()

  const snapshot = manager.snapshot()
  assert.equal(snapshot.kind, 'voice')
  assert.equal(snapshot.cameraCount, 0)
  assert.equal(snapshot.notice, 'No camera found, use Voice call instead')
  assert.deepEqual(requested, [
    { audio: true, video: video720p },
    { audio: true, video: false },
  ])
  assert.equal(sent.find((event) => event.type === 'call:accept')?.kind, 'voice')
})

test('answerer ICE failure asks the offerer to restart', async () => {
  manager.handleInvite({
    type: 'call:invite',
    from: 'heather',
    callId: 'call-ice',
    kind: 'voice',
    peerName: '@heather',
  })
  await manager.accept()
  await manager.handleOffer({
    type: 'call:offer',
    from: 'heather',
    callId: 'call-ice',
    sdp: { type: 'offer', sdp: 'v=0 offer' },
  })
  const pc = FakeRTCPeerConnection.instances.at(-1)
  assert.ok(pc)
  pc.connectionState = 'connected'
  pc.onconnectionstatechange?.()
  assert.equal(manager.snapshot().state, 'connected')

  sent.length = 0
  pc.connectionState = 'failed'
  pc.onconnectionstatechange?.()

  const retry = sent.find((event) => event.type === 'call:retry')
  assert.ok(retry, 'answerer should ask the offerer to restart ICE')
  assert.equal(retry?.to, 'heather')
})

test('retry while connected rebuilds the peer without ping-pong retries', async () => {
  const callId = await placeCall('voice')
  const offersBefore = sent.filter((event) => event.type === 'call:offer').length
  sent.length = 0

  await manager.handleRetry({ type: 'call:retry', from: 'heather', callId })

  assert.equal(sent.filter((event) => event.type === 'call:retry').length, 0)
  assert.equal(sent.filter((event) => event.type === 'call:offer').length, offersBefore)
  assert.equal(manager.snapshot().state, 'connecting')
  assert.equal(manager.snapshot().notice, 'Reconnecting...')
})
