export type UserRow = {
  id: string
  username: string
  email: string
  password_hash: string
  display_name: string
  bio: string
  status: 'online' | 'dnd' | 'offline'
  avatar_color: string
  avatar_url: string | null
  created_at: Date | string
  updated_at: Date | string
}

export type PublicUser = {
  id: string
  username: string
  displayName: string
  bio: string
  status: 'online' | 'dnd' | 'offline'
  avatarColor: string
  avatarUrl: string | null
  createdAt: string
}

export type SelfUser = PublicUser & { email: string }

export type MessageRow = {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  gif_url: string | null
  kind: 'text' | 'gif'
  edited_at: Date | string | null
  deleted_at: Date | string | null
  created_at: Date | string
  sender_username: string
  sender_display_name: string
  sender_avatar_url: string | null
}

export type PublicMessage = {
  id: string
  conversationId: string
  senderId: string
  senderUsername: string
  senderDisplayName: string
  senderAvatarUrl: string | null
  body: string
  kind: 'text' | 'gif'
  gifUrl: string | null
  createdAt: string
  editedAt: string | null
  deleted: boolean
}

export type ConversationRow = {
  id: string
  kind: 'direct' | 'group'
  name: string | null
  created_by: string
  created_at: Date | string
  updated_at: Date | string
  member_count: number | string
  last_message_body: string | null
  last_message_gif_url: string | null
  last_message_at: Date | string | null
}
