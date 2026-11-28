export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'waking'
  | 'reconnecting'
  | 'unreachable'
  | 'syncing'
  | 'live'

export type ConnectionDetail = {
  /** Number of automatic retries already made in this wake window. */
  attempt: number
  maxAttempts: number
  secondsLeft: number
}

export type MessageKind = 'text' | 'gif'

export type ChatMessage = {
  id: string
  threadId: string
  senderId: string
  from: 'me' | 'them'
  time: string
  timestamp: number
  text: string
  kind?: MessageKind
  gifUrl?: string
  editedAt?: string | null
  deleted?: boolean
  status?: 'sending' | 'sent' | 'failed'
}

export type MomentMediaKind = 'image' | 'video'

export type ArtistShare = {
  artistName: string
  title: string
  songUrl?: string
  presetName?: string
}

export type HoneyMoment = {
  id: string
  threadId: string
  sender: string
  createdAt: string
  description: string
  mediaKind?: MomentMediaKind
  mediaDataUrl?: string
  artist?: ArtistShare
  /** Public profile Ko-fi link, used only for the external Tip button. */
  koFiUrl?: string | null
  heartedByMe: boolean
}

export type GifResult = {
  id: string
  title: string
  url: string
  preview: string
}

export type PresenceStatus = 'online' | 'dnd' | 'offline'

export type AccountUser = {
  id: string
  username: string
  email: string
  displayName: string
  bio: string
  status: PresenceStatus
  avatarColor: string
  avatarUrl: string | null
  koFiUrl: string | null
  createdAt: string
}

export type ProfilePatch = {
  displayName?: string
  bio?: string
  status?: PresenceStatus
  avatarColor?: string
  koFiUrl?: string | null
}

export type DeviceSession = {
  id: string
  deviceId: string
  platform: string | null
  lastSeen: string
  createdAt: string
}

export type ContactSummary = {
  id: string
  username: string
  displayName: string
  status: PresenceStatus
  avatarColor: string
}
