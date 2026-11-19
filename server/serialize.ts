import type {
  ConversationRow,
  MessageRow,
  PublicMessage,
  PublicUser,
  SelfUser,
  UserRow,
} from './models'

export function iso(value: Date | string | null | undefined) {
  if (!value) return null
  const time = typeof value === 'string' ? new Date(value) : value
  return time.toISOString()
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    status: row.status,
    avatarColor: row.avatar_color,
    avatarUrl: row.avatar_url,
    createdAt: iso(row.created_at) ?? '',
  }
}

export function toSelfUser(row: UserRow): SelfUser {
  return { ...toPublicUser(row), email: row.email }
}

export function toPublicMessage(row: MessageRow): PublicMessage {
  const deleted = Boolean(row.deleted_at)
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderUsername: row.sender_username,
    senderDisplayName: row.sender_display_name,
    senderAvatarUrl: row.sender_avatar_url,
    body: deleted ? '' : row.body,
    kind: row.kind,
    gifUrl: deleted ? null : row.gif_url,
    createdAt: iso(row.created_at) ?? '',
    editedAt: iso(row.edited_at),
    deleted,
  }
}

export function conversationTitle(row: ConversationRow, members: PublicUser[], viewerId: string) {
  if (row.kind === 'group') return row.name ?? 'Group conversation'
  const other = members.find((member) => member.id !== viewerId)
  return other?.displayName ?? 'Unknown user'
}
