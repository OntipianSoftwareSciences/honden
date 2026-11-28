/** Minimal browser audio surface used by the in-app Artist Honey player. */
export type PlayableAudio = {
  paused: boolean
  play: () => Promise<void>
  pause: () => void
}

/** Tap-to-seek helper: keeps a tap inside the real clip bounds. */
export function clampSeekTime(value: number, duration: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(duration) || duration <= 0) return 0
  return Math.max(0, Math.min(value, duration))
}

export function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Play/Pause is explicit; the player never autoplays. */
export async function toggleAudio(audio: PlayableAudio): Promise<boolean> {
  if (!audio.paused) {
    audio.pause()
    return false
  }
  try {
    await audio.play()
    return true
  } catch {
    return false
  }
}
