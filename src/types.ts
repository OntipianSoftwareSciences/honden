export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'waking'
  | 'reconnecting'
  | 'syncing'
  | 'live'

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
  createdAt: string
}

export type ProfilePatch = {
  displayName?: string
  bio?: string
  status?: PresenceStatus
  avatarColor?: string
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
