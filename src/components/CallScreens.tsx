import { useEffect, useRef } from 'react'
import { Mic, MicOff, Phone, PhoneOff, SwitchCamera, Video, VideoOff } from 'lucide-react'
import CuteLoader from './CuteLoader'
import type { CallSnapshot } from '../webrtc/callManager'
import {
  playCallConnected,
  playCallEnded,
  startCallRing,
  stopCallRing,
} from '../sounds'

type Props = {
  snapshot: CallSnapshot
  onAccept: () => void
  onReject: () => void
  onHangup: () => void
  onRetry: () => void
  onStartVoice: () => void
  onStartVideo: () => void
  onToggleMic: () => void
  onToggleCamera: () => void
  onSwitchCamera: () => void
}

export default function CallScreens({
  snapshot,
  onAccept,
  onReject,
  onHangup,
  onRetry,
  onStartVoice,
  onStartVideo,
  onToggleMic,
  onToggleCamera,
  onSwitchCamera,
}: Props) {
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const previousState = useRef(snapshot.state)

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = snapshot.remoteStream
    }
  }, [snapshot.remoteStream])

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = snapshot.localStream
    }
  }, [snapshot.localStream])

  useEffect(() => {
    if (snapshot.state !== 'incoming') {
      stopCallRing()
      return
    }
    startCallRing()
    return () => stopCallRing()
  }, [snapshot.state])

  useEffect(() => {
    const previous = previousState.current
    if (previous !== snapshot.state) {
      if (snapshot.state === 'connected') playCallConnected()
      if (snapshot.state === 'ended') playCallEnded()
    }
    previousState.current = snapshot.state
  }, [snapshot.state])

  const localHasVideo = Boolean(snapshot.localStream?.getVideoTracks().length)
  const remoteHasVideo = Boolean(snapshot.remoteStream?.getVideoTracks().length)

  if (snapshot.state === 'idle') return null

  if (snapshot.state === 'incoming') {
    const isVideo = snapshot.kind === 'video'
    const caller = snapshot.peerName || (snapshot.peerId ? `@${snapshot.peerId}` : '@someone')
    return (
      <div className="fixed inset-0 z-50 flex h-[100dvh] w-full items-center justify-center overflow-hidden bg-warm-cream p-4">
        <div className="w-full max-w-sm rounded-3xl border border-border bg-white p-6 shadow-soft">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-soft-blush text-heart-pink">
            {isVideo ? <Video size={28} /> : <Phone size={28} />}
          </div>
          <h2 className="text-center text-xl font-bold text-warm-charcoal lg:text-2xl">
            {isVideo ? 'Video' : 'Voice'} call from {caller}
          </h2>
          <p className="mt-2 text-center text-[13px] text-soft-grey">
            Only you and {caller} can see this call.
          </p>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={onReject}
              className="min-h-12 flex-1 rounded-xl border border-soft-red px-3 py-3 text-base font-bold text-soft-red transition hover:bg-soft-blush"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={onAccept}
              className="min-h-12 flex-1 rounded-xl bg-heart-pink px-3 py-3 text-base font-bold text-white transition hover:bg-deep-rose"
            >
              {isVideo ? 'Answer as Video' : 'Answer as Voice'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col overflow-hidden bg-warm-cream">
      <div className="relative min-h-0 flex-1 overflow-hidden bg-soft-blush">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 h-full w-full bg-soft-blush object-cover"
        />
        {!remoteHasVideo && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-soft-blush">
            <div className="call-avatar flex h-24 w-24 items-center justify-center rounded-full bg-white text-4xl font-bold text-heart-pink shadow-soft">
              :3
            </div>
            <p className="text-[13px] font-semibold text-warm-charcoal">
              {snapshot.kind === 'video'
                ? 'Voice only — camera unavailable'
                : 'Voice call'}
            </p>
          </div>
        )}
        {localHasVideo && (
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="absolute bottom-3 right-3 z-20 aspect-[4/3] w-[110px] rounded-2xl border-2 border-border bg-white object-cover shadow-soft md:bottom-4 md:right-4 md:w-[180px] lg:w-[240px]"
          />
        )}
        {snapshot.cameraLabel && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-xl bg-white px-3 py-1 text-[13px] text-soft-grey shadow-soft">
            {snapshot.cameraLabel}
          </div>
        )}
        <div className="absolute left-3 top-3 z-20 flex flex-wrap gap-2">
          <div className="rounded-xl bg-white px-3 py-1 text-[13px] font-semibold text-warm-charcoal shadow-soft">
            {snapshot.kind === 'video' ? 'Video call' : 'Voice call'}
          </div>
          {snapshot.state === 'connected' && (
            <div className="call-connected-pill rounded-xl bg-white px-3 py-1 text-[13px] font-semibold text-heart-pink shadow-soft">
              Connected
            </div>
          )}
        </div>

        {(snapshot.state === 'calling' || snapshot.state === 'connecting') && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-warm-cream/90 p-4 text-center">
            <CuteLoader size="lg" label="Connecting call" />
            <p className="text-xl font-bold text-warm-charcoal lg:text-2xl">
              {snapshot.notice === 'Reconnecting...'
                ? 'Reconnecting...'
                : snapshot.state === 'calling'
                  ? `Calling ${snapshot.peerName || snapshot.peerId || 'someone'}...`
                  : `Connecting ${snapshot.peerName || snapshot.peerId || 'someone'}...`}
            </p>
            {snapshot.connectDiagnostic && (
              <p className="max-w-md text-[13px] leading-relaxed text-warm-charcoal">
                {snapshot.connectDiagnostic}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={onHangup}
                className="min-h-12 rounded-xl bg-soft-red px-6 py-3 text-base font-bold text-white transition hover:bg-deep-rose"
              >
                Cancel
              </button>
              {snapshot.retryAvailable && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="min-h-12 rounded-xl border border-heart-pink bg-white px-6 py-3 text-base font-bold text-heart-pink transition hover:bg-soft-blush"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        )}

        {snapshot.state === 'ended' && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-warm-cream/95 p-4 text-center">
            <p className="text-lg font-bold text-warm-charcoal">
              {snapshot.error || 'Call ended'}
            </p>
            <p className="text-[13px] text-soft-grey">
              {snapshot.peerName || snapshot.peerId || 'Contact'}
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={onStartVoice}
                className="flex min-h-12 items-center gap-2 rounded-xl border border-heart-pink bg-white px-5 py-3 text-base font-bold text-heart-pink transition hover:bg-soft-blush"
              >
                <Phone size={18} />
                Voice
              </button>
              <button
                type="button"
                onClick={onStartVideo}
                className="flex min-h-12 items-center gap-2 rounded-xl bg-heart-pink px-5 py-3 text-base font-bold text-white transition hover:bg-deep-rose"
              >
                <Video size={18} />
                Video
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:px-4 md:pt-4">
        <div className="mx-auto flex w-full max-w-md items-center justify-center gap-2 md:max-w-xl md:gap-4">
          <button
            type="button"
            onClick={onToggleMic}
            className="flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-soft-red px-2 py-2 text-soft-red transition hover:bg-soft-blush md:min-h-14 md:px-4"
          >
            {snapshot.muted ? <MicOff size={20} /> : <Mic size={20} />}
            <span className="text-[13px] font-semibold leading-tight">Mic mute</span>
          </button>
          <button
            type="button"
            onClick={onToggleCamera}
            className="flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-soft-red px-2 py-2 text-soft-red transition hover:bg-soft-blush md:min-h-14 md:px-4"
          >
            {localHasVideo && snapshot.cameraOff ? (
              <VideoOff size={20} />
            ) : (
              <Video size={20} />
            )}
            <span className="text-[13px] font-semibold leading-tight">
              {localHasVideo && !snapshot.cameraOff ? 'Camera off' : 'Camera on'}
            </span>
          </button>
          <button
            type="button"
            onClick={onSwitchCamera}
            disabled={snapshot.cameraCount <= 1}
            className="flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-heart-pink px-2 py-2 text-heart-pink transition hover:bg-soft-blush disabled:cursor-not-allowed disabled:border-border disabled:text-soft-grey disabled:opacity-60 md:min-h-14 md:px-4"
          >
            <SwitchCamera size={20} />
            <span className="text-[13px] font-semibold leading-tight">Switch camera</span>
          </button>
          <button
            type="button"
            onClick={onHangup}
            className="flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl bg-soft-red px-2 py-2 text-white transition hover:bg-deep-rose md:min-h-14 md:px-4"
          >
            <PhoneOff size={20} />
            <span className="text-[13px] font-semibold leading-tight">End call</span>
          </button>
        </div>
        {snapshot.cameraCount === 0 && (
          <p className="mt-2 text-center text-[13px] text-soft-grey">No camera found</p>
        )}
        {snapshot.cameraCount === 1 && (
          <p className="mt-2 text-center text-[13px] text-soft-grey">Only one camera found</p>
        )}
        <p className="mt-2 text-center text-[13px] text-soft-grey">
          Only you and {snapshot.peerName || 'someone'} can see this call.
        </p>
        {snapshot.error && (
          <p className="mt-1 text-center text-[13px] text-warm-charcoal">{snapshot.error}</p>
        )}
        {snapshot.notice && (
          <p className="mt-1 text-center text-[13px] font-semibold text-soft-grey">
            {snapshot.notice}
          </p>
        )}
      </div>
    </div>
  )
}
