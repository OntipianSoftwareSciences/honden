type Note = {
  frequency: number
  duration?: number
  gain?: number
  type?: OscillatorType
}

let enabled = true
let volume = 0.35
let unlocked = false
let context: AudioContext | null = null
let ringTimer: number | undefined

function getContext(): AudioContext | null {
  if (!unlocked || !enabled || typeof window === 'undefined') return null
  const AudioContextClass =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return null
  if (!context) context = new AudioContextClass()
  if (context.state === 'suspended') void context.resume().catch(() => undefined)
  return context
}

function tone(note: Note, delay = 0): void {
  const ctx = getContext()
  if (!ctx) return
  const oscillator = ctx.createOscillator()
  const gainNode = ctx.createGain()
  const now = ctx.currentTime + delay
  const duration = note.duration ?? 0.08
  const peak = Math.max(0, Math.min(0.12, (note.gain ?? 0.04) * volume))
  oscillator.type = note.type ?? 'square'
  oscillator.frequency.setValueAtTime(note.frequency, now)
  gainNode.gain.setValueAtTime(0.0001, now)
  gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), now + 0.008)
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration)
  oscillator.connect(gainNode).connect(ctx.destination)
  oscillator.start(now)
  oscillator.stop(now + duration + 0.01)
}

function sequence(notes: Note[], gap = 0.1): void {
  notes.forEach((note, index) => tone(note, index * gap))
}

export function setSoundSettings(nextEnabled: boolean, nextVolume: number): void {
  enabled = nextEnabled
  volume = Math.max(0, Math.min(1, nextVolume))
  if (!enabled) stopCallRing()
}

export function playTap(): void {
  if (!enabled) return
  tone({ frequency: 880, duration: 0.05, gain: 0.025, type: 'triangle' })
}

export function playNewMessage(): void {
  if (!enabled) return
  sequence(
    [
      { frequency: 784, duration: 0.09, gain: 0.05, type: 'triangle' },
      { frequency: 1047, duration: 0.14, gain: 0.05, type: 'triangle' },
    ],
    0.09,
  )
}

export function playMessageSent(): void {
  if (!enabled) return
  tone({ frequency: 523, duration: 0.045, gain: 0.018, type: 'triangle' })
}

export function startCallRing(): void {
  stopCallRing()
  const ring = () => {
    if (!enabled) return
    sequence(
      [
        { frequency: 659, duration: 0.1, gain: 0.035, type: 'square' },
        { frequency: 784, duration: 0.1, gain: 0.035, type: 'square' },
        { frequency: 988, duration: 0.14, gain: 0.035, type: 'square' },
      ],
      0.13,
    )
  }
  ring()
  if (typeof window !== 'undefined') ringTimer = window.setInterval(ring, 2000)
}

export function stopCallRing(): void {
  if (ringTimer !== undefined && typeof window !== 'undefined') {
    window.clearInterval(ringTimer)
    ringTimer = undefined
  }
}

export function playCallConnected(): void {
  if (!enabled) return
  sequence(
    [
      { frequency: 587, duration: 0.1, gain: 0.045, type: 'triangle' },
      { frequency: 880, duration: 0.14, gain: 0.045, type: 'triangle' },
    ],
    0.1,
  )
}

export function playCallEnded(): void {
  if (!enabled) return
  sequence(
    [
      { frequency: 698, duration: 0.1, gain: 0.04, type: 'triangle' },
      { frequency: 466, duration: 0.14, gain: 0.04, type: 'triangle' },
    ],
    0.1,
  )
}

if (typeof document !== 'undefined') {
  const unlock = () => {
    unlocked = true
    if (context?.state === 'suspended') void context.resume().catch(() => undefined)
  }
  document.addEventListener('pointerdown', unlock)
  document.addEventListener('keydown', unlock)
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    const button = target?.closest('button')
    if (!button) return
    if (button.textContent?.trim() === 'Send') playMessageSent()
    else playTap()
  })
}
