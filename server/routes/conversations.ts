import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../auth'
import { query, withTransaction } from '../db'
import type {
  ConversationRow,
  MessageRow,
  PublicUser,
  UserRow,
} from '../models'
import { conversationTitle, toPublicMessage, toPublicUser } from '../serialize'
import { broadcastToConversation } from '../ws'

const directSchema = z.object({ userId: z.string().uuid() })
const groupSchema = z.object({
  name: z.string().min(1).max(120),
  memberIds: z.array(z.string().uuid()).min(1).max(50),
})
const idParam = z.object({ id: z.string().uuid() })
const messageIdParam = z.object({ messageId: z.string().uuid() })
const listMessagesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
const createMessageSchema = z.object({
  body: z.string().trim().max(5000).optional().default(''),
  gifUrl: z.string().url().max(2000).optional(),
})
const editMessageSchema = z.object({
  body: z.string().trim().min(1).max(5000),
})

type ConversationView = {
  id: string
  kind: 'direct' | 'group'
  title: string
  name: string | null
  memberCount: number
  members: PublicUser[]
  lastMessage: { body: string; gifUrl: string | null; createdAt: string } | null
  updatedAt: string
}

const messageSelect = `
  SELECT m.*, u.username AS sender_username,
         u.display_name AS sender_display_name,
         u.avatar_url AS sender_avatar_url
  FROM messages m
  JOIN users u ON u.id = m.sender_id
`

async function getConversationView(
  conversationId: string,
  viewerId: string,
): Promise<ConversationView | null> {
  const found = await query<ConversationRow>(
    `SELECT c.*,
            (SELECT count(*)::int FROM conversation_members cm WHERE cm.conversation_id = c.id) AS member_count,
            (SELECT m.body FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1) AS last_message_body,
            (SELECT m.gif_url FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1) AS last_message_gif_url,
            (SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1) AS last_message_at
     FROM conversations c
     JOIN conversation_members cm ON cm.conversation_id = c.id
     WHERE c.id = $1 AND cm.user_id = $2`,
    [conversationId, viewerId],
  )
  const row = found.rows[0]
  if (!row) return null

  const membersResult = await query<UserRow>(
    `SELECT u.* FROM users u
     JOIN conversation_members cm ON cm.user_id = u.id
     WHERE cm.conversation_id = $1`,
    [conversationId],
  )
  const members = membersResult.rows.map(toPublicUser)
  const lastMessage =
    row.last_message_body || row.last_message_gif_url
      ? {
          body: row.last_message_body ?? '',
          gifUrl: row.last_message_gif_url ?? null,
          createdAt: row.last_message_at ? new Date(row.last_message_at).toISOString() : '',
        }
      : null

  return {
    id: row.id,
    kind: row.kind,
    title: conversationTitle(row, members, viewerId),
    name: row.name,
    memberCount: Number(row.member_count),
    members,
    lastMessage,
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

async function isMember(conversationId: string, userId: string) {
  const result = await query(
    'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
    [conversationId, userId],
  )
  return Boolean(result.rowCount)
}

export async function conversationRoutes(app: FastifyInstance) {
  app.get('/api/conversations', { preHandler: authenticate }, async (request) => {
    const visible = await query<{ id: string }>(
      `SELECT c.id FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id
       WHERE cm.user_id = $1
       ORDER BY c.updated_at DESC`,
      [request.userId],
    )
    const conversations: ConversationView[] = []
    for (const row of visible.rows) {
      const view = await getConversationView(row.id, request.userId)
      if (view) conversations.push(view)
    }
    return { conversations }
  })

  app.post(
    '/api/conversations/direct',
    { preHandler: authenticate },
    async (request, reply) => {
      const input = directSchema.parse(request.body)
      if (input.userId === request.userId) {
        return reply.code(400).send({ error: 'Cannot message yourself' })
      }

      const blocked = await query(
        `SELECT 1 FROM contacts
         WHERE status = 'blocked'
           AND ((owner_id = $1 AND contact_id = $2) OR (owner_id = $2 AND contact_id = $1))`,
        [request.userId, input.userId],
      )
      if (blocked.rowCount) {
        return reply.code(403).send({ error: 'User is blocked' })
      }

      const target = await query('SELECT 1 FROM users WHERE id = $1', [input.userId])
      if (!target.rowCount) return reply.code(404).send({ error: 'User not found' })

      const existing = await query<{ id: string }>(
        `SELECT c.id FROM conversations c
         JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = $1
         JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = $2
         WHERE c.kind = 'direct' LIMIT 1`,
        [request.userId, input.userId],
      )
      if (existing.rowCount) {
        return { conversation: await getConversationView(existing.rows[0].id, request.userId) }
      }

      const conversationId = await withTransaction(async (client) => {
        const created = await client.query<{ id: string }>(
          `INSERT INTO conversations (kind, created_by) VALUES ('direct', $1) RETURNING id`,
          [request.userId],
        )
        const id = created.rows[0].id
        await client.query(
          `INSERT INTO conversation_members (conversation_id, user_id, role)
           VALUES ($1, $2, 'member'), ($1, $3, 'member')`,
          [id, request.userId, input.userId],
        )
        return id
      })

      return {
        conversation: await getConversationView(conversationId, request.userId),
      }
    },
  )

  app.post(
    '/api/conversations',
    { preHandler: authenticate },
    async (request, reply) => {
      const input = groupSchema.parse(request.body)
      const ids = [...new Set([request.userId, ...input.memberIds])]
      const users = await query('SELECT id FROM users WHERE id = ANY($1::uuid[])', [ids])
      if (users.rowCount !== ids.length) {
        return reply.code(400).send({ error: 'One or more members do not exist' })
      }

      const conversationId = await withTransaction(async (client) => {
        const created = await client.query<{ id: string }>(
          `INSERT INTO conversations (kind, name, created_by)
           VALUES ('group', $1, $2) RETURNING id`,
          [input.name, request.userId],
        )
        const id = created.rows[0].id
        for (const userId of ids) {
          await client.query(
            `INSERT INTO conversation_members (conversation_id, user_id, role)
             VALUES ($1, $2, $3)`,
            [id, userId, userId === request.userId ? 'admin' : 'member'],
          )
        }
        return id
      })

      return { conversation: await getConversationView(conversationId, request.userId) }
    },
  )

  app.get(
    '/api/conversations/:id/messages',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = idParam.parse(request.params)
      const { limit } = listMessagesSchema.parse(request.query)
      if (!(await isMember(id, request.userId))) {
        return reply.code(403).send({ error: 'Not a member of this conversation' })
      }
      const result = await query<MessageRow>(
        `${messageSelect} WHERE m.conversation_id = $1
         ORDER BY m.created_at DESC LIMIT $2`,
        [id, limit],
      )
      return { messages: result.rows.map(toPublicMessage).reverse() }
    },
  )

  app.post(
    '/api/conversations/:id/messages',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = idParam.parse(request.params)
      const input = createMessageSchema.parse(request.body)
      if (!input.body && !input.gifUrl) {
        return reply.code(400).send({ error: 'Message cannot be empty' })
      }
      if (!(await isMember(id, request.userId))) {
        return reply.code(403).send({ error: 'Not a member of this conversation' })
      }

      const kind = input.gifUrl ? 'gif' : 'text'
      const inserted = await query<MessageRow>(
        `${messageSelect} WHERE m.id = (
           INSERT INTO messages (conversation_id, sender_id, body, gif_url, kind)
           VALUES ($1, $2, $3, $4, $5) RETURNING id
         )`,
        [id, request.userId, input.body, input.gifUrl ?? null, kind],
      )
      const message = toPublicMessage(inserted.rows[0])
      await query('UPDATE conversations SET updated_at = now() WHERE id = $1', [id])
      await broadcastToConversation(id, { type: 'message', message })
      return { message }
    },
  )

  app.patch(
    '/api/messages/:messageId',
    { preHandler: authenticate },
    async (request, reply) => {
      const { messageId } = messageIdParam.parse(request.params)
      const input = editMessageSchema.parse(request.body)
      const updated = await query<MessageRow>(
        `${messageSelect} WHERE m.id = (
           UPDATE messages SET body = $1, edited_at = now()
           WHERE id = $2 AND sender_id = $3 AND deleted_at IS NULL RETURNING id
         )`,
        [input.body, messageId, request.userId],
      )
      const message = updated.rows[0]
      if (!message) return reply.code(404).send({ error: 'Message not found' })
      const publicMessage = toPublicMessage(message)
      await broadcastToConversation(message.conversation_id, {
        type: 'message_edited',
        message: publicMessage,
      })
      return { message: publicMessage }
    },
  )

  app.delete(
    '/api/messages/:messageId',
    { preHandler: authenticate },
    async (request, reply) => {
      const { messageId } = messageIdParam.parse(request.params)
      const removed = await query<{ conversation_id: string }>(
        `UPDATE messages SET deleted_at = now(), body = '', gif_url = NULL
         WHERE id = $1 AND sender_id = $2 AND deleted_at IS NULL
         RETURNING conversation_id`,
        [messageId, request.userId],
      )
      const row = removed.rows[0]
      if (!row) return reply.code(404).send({ error: 'Message not found' })
      await broadcastToConversation(row.conversation_id, {
        type: 'message_deleted',
        messageId,
        conversationId: row.conversation_id,
      })
      return { ok: true }
    },
  )
}
