import type { ArtistShare, MomentMediaKind } from '../types'

export const OWN_KO_FI_URL = 'https://ko-fi.com/L7O32B7IIH'

const MAX_ARTIST_NAME = 80
const MAX_TITLE = 120

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

export function normalizeArtistShare(value: {
  artistName?: unknown
  title?: unknown
  songUrl?: unknown
  presetName?: unknown
}): ArtistShare | null {
  const artistName = trimmed(value.artistName, MAX_ARTIST_NAME)
  const title = trimmed(value.title, MAX_TITLE)
  const songUrl = normalizeSongUrl(value.songUrl)
  const presetName = trimmed(value.presetName, MAX_TITLE)
  if (!artistName || !title) return null
  // Exactly one: a song link or a preset name.
  if ((songUrl ? 1 : 0) + (presetName ? 1 : 0) !== 1) return null
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
  } | null
}

export function encodeMomentPayload(input: MomentDraft): string | null {
  const description = trimmed(input.description, 200)
  if (input.artist) {
    const artist = normalizeArtistShare(input.artist)
    if (!artist) return null
    return JSON.stringify({ v: 2, description, share: artist })
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
      }
    }
    const description = trimmed(parsed.description, 200)
    if (parsed.v === 2) {
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
