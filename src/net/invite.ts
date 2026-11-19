import { sameOriginWs } from '../api/client'
import { randomId } from '../crypto/e2ee'

export type Invite = {
  room: string
  key: string
}

const STORAGE_KEY = 'honden.invite.v1'
const DEFAULT_RELAY = sameOriginWs('/ws')
const KEY_BYTES = 32

function encode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decode(value: string): Uint8Array | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const binary = atob(padded)
    if (binary.length !== KEY_BYTES) return null
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    return null
  }
}

function validate(value: unknown): Invite | null {
  if (!value || typeof value !== 'object') return null
  const room = (value as Invite).room
  const key = (value as Invite).key
  if (typeof room !== 'string' || !room) return null
  if (typeof key !== 'string' || !decode(key)) return null
  return { room: room.slice(0, 128), key }
}

export function parseInvite(location: Location | URL = window.location): Invite | null {
  const room = new URLSearchParams(location.search).get('room')?.trim()
  const hash = location.hash.replace(/^#/, '')
  const match = /(?:^|&)key=([^&]+)/.exec(hash)
  let key: string | null = null
  if (match) {
    try {
      key = decodeURIComponent(match[1])
    } catch {
      key = null
    }
  }
  if (!room || !key || !decode(key)) return null
  return { room: room.slice(0, 128), key }
}

export function loadInvite(): Invite | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return null
    return validate(JSON.parse(saved) as unknown)
  } catch {
    return null
  }
}

export function saveInvite(invite: Invite): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(invite))
}

export function createInvite(): Invite {
  const invite: Invite = {
    room: randomId(),
    key: encode(crypto.getRandomValues(new Uint8Array(KEY_BYTES))),
  }
  saveInvite(invite)
  return invite
}

let current: Invite | undefined

export function currentInvite(): Invite {
  if (current) return current
  const fromLink = parseInvite()
  if (fromLink) {
    saveInvite(fromLink)
    current = fromLink
    return fromLink
  }
  current = loadInvite() ?? createInvite()
  return current
}

export function rotateInvite(): Invite {
  current = createInvite()
  history.replaceState(null, '', inviteUrl(current))
  return current
}

export function inviteUrl(invite: Invite): string {
  const url = new URL(window.location.href)
  url.search = ''
  url.searchParams.set('room', invite.room)
  url.hash = `key=${invite.key}`
  return url.toString()
}

export function relayUrl(invite: Invite, configured: string): string {
  const custom = configured.trim()
  const base = custom.startsWith('/') ? sameOriginWs(custom) : DEFAULT_RELAY
  try {
    const url = new URL(base)
    url.searchParams.set('room', invite.room)
    return url.toString()
  } catch {
    return `${base}?room=${encodeURIComponent(invite.room)}`
  }
}

let cached: { key: string; value: Promise<CryptoKey> } | null = null

export function getRoomKey(key: string): Promise<CryptoKey> {
  if (cached?.key === key) return cached.value
  const bytes = decode(key)
  if (!bytes) return Promise.reject(new Error('This invite link is not valid.'))
  const value = crypto.subtle.importKey(
    'raw',
    bytes as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
  cached = { key, value }
  return value
}
