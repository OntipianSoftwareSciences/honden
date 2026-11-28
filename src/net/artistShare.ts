import type { ArtistAudio, ArtistShare, MomentMediaKind } from '../types'

export const OWN_KO_FI_URL = 'https://ko-fi.com/L7O32B7IIH'

export const MAX_AUDIO_BYTES = 50 * 1024 * 1024
export const AUDIO_TOO_BIG_MESSAGE = 'That file is too big — try an .mp3 under 50 MB'
export const AUDIO_BAD_TYPE_MESSAGE = 'Choose an .mp3 or .wav file.'
const AUDIO_UNREADABLE_MESSAGE = 'Could not read that audio file. Try a different one.'

const MAX_ARTIST_NAME = 80
const MAX_TITLE = 120
const MAX_AUDIO_NAME = 200

function trimmed(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/** Only plain https://ko-fi.com/<name> links are accepted, with no query or fragment. */
export function normalizeKoFiUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'ko-fi.com') return null
    if (url.port || url.username || url.password || url.search || url.hash) return null
    const path = url.pathname.replace(/\/+$/, '')
    if (!/^\/[A-Za-z0-9_-]{1,40}$/.test(path)) return null
    return `https://ko-fi.com${path}`
  } catch {
    return null
  }
}

export function normalizeSongUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.toString()
  } catch {
    return null
  }
}

/** Artist shares accept only .mp3 and .wav files. */
export function isArtistAudioFile(file: { name?: unknown; type?: unknown }): boolean {
  const name = trimmed(file.name, MAX_AUDIO_NAME).toLowerCase()
  if (!/\.(mp3|wav)$/.test(name)) return false
  const type = typeof file.type === 'string' ? file.type.trim().toLowerCase() : ''
  return !type || type.startsWith('audio/') || type === 'application/octet-stream'
}

export function validateArtistAudio(file: { name?: unknown; type?: unknown; size?: unknown }): string | null {
  if (!isArtistAudioFile(file)) return AUDIO_BAD_TYPE_MESSAGE
  if (typeof file.size !== 'number' || !Number.isFinite(file.size) || file.size <= 0) return AUDIO_UNREADABLE_MESSAGE
  if (file.size > MAX_AUDIO_BYTES) return AUDIO_TOO_BIG_MESSAGE
  return null
}

function normalizeArtistAudio(value: unknown): ArtistAudio | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { name?: unknown; size?: unknown; dataUrl?: unknown }
  const name = trimmed(candidate.name, MAX_AUDIO_NAME)
  const size = candidate.size
  const dataUrl = candidate.dataUrl
  if (validateArtistAudio({ name, size }) !== null) return null
  if (
    typeof dataUrl !== 'string' ||
    !/^data:(audio\/[A-Za-z0-9.+-]+|application\/octet-stream);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)
  ) return null
  return { name, size: size as number, dataUrl }
}

export function normalizeArtistShare(value: {
  artistName?: unknown
  title?: unknown
  songUrl?: unknown
  presetName?: unknown
  audio?: unknown
}): ArtistShare | null {
  const artistName = trimmed(value.artistName, MAX_ARTIST_NAME)
  const title = trimmed(value.title, MAX_TITLE)
  const songUrl = normalizeSongUrl(value.songUrl)
  const presetName = trimmed(value.presetName, MAX_TITLE)
  const audio = normalizeArtistAudio(value.audio)
  if (!artistName || !title) return null
  // Exactly one: a song link, a preset name, or one uploaded audio file.
  if ((songUrl ? 1 : 0) + (presetName ? 1 : 0) + (audio ? 1 : 0) !== 1) return null
  if (audio) return { artistName, title, audio }
  return songUrl ? { artistName, title, songUrl } : { artistName, title, presetName }
}

export type MomentPayload = {
  description: string
  mediaKind?: MomentMediaKind
  mediaDataUrl?: string
  artist?: ArtistShare
}

export type MomentDraft = {
  description?: unknown
  mediaKind?: unknown
  mediaDataUrl?: unknown
  artist?: {
    artistName?: unknown
    title?: unknown
    songUrl?: unknown
    presetName?: unknown
    audio?: unknown
  } | null
}

export function encodeMomentPayload(input: MomentDraft): string | null {
  const description = trimmed(input.description, 200)
  if (input.artist) {
    const artist = normalizeArtistShare(input.artist)
    if (!artist) return null
    // v3 adds encrypted audio; v2 song/preset shares stay readable.
    return JSON.stringify({ v: artist.audio ? 3 : 2, description, share: artist })
  }
  if (input.mediaKind !== 'image' && input.mediaKind !== 'video') return null
  if (typeof input.mediaDataUrl !== 'string' || !input.mediaDataUrl) return null
  return JSON.stringify({ v: 1, description, mediaKind: input.mediaKind, mediaDataUrl: input.mediaDataUrl })
}

export function decodeMomentPayload(text: string): MomentPayload | null {
  try {
    const parsed = JSON.parse(text) as {
      v?: unknown
      description?: unknown
      mediaKind?: unknown
      mediaDataUrl?: unknown
      share?: {
        artistName?: unknown
        title?: unknown
        songUrl?: unknown
        presetName?: unknown
        audio?: unknown
      }
    }
    const description = trimmed(parsed.description, 200)
    if (parsed.v === 2 || parsed.v === 3) {
      const artist = parsed.share ? normalizeArtistShare(parsed.share) : null
      return artist ? { description, artist } : null
    }
    if (parsed.v !== 1) return null
    if (parsed.mediaKind !== 'image' && parsed.mediaKind !== 'video') return null
    if (typeof parsed.mediaDataUrl !== 'string' || !parsed.mediaDataUrl) return null
    return { description, mediaKind: parsed.mediaKind, mediaDataUrl: parsed.mediaDataUrl }
  } catch {
    return null
  }
}
