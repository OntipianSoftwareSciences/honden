import type { FastifyInstance } from 'fastify'
import '@fastify/websocket'
import { WebSocket } from 'ws'
import { verifyToken } from './auth'
import { query } from './db'

const clients = new Map<string, Set<WebSocket>>()

function send(socket: WebSocket, payload: unknown) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload))
  }
}

export function broadcastToUser(userId: string, payload: unknown) {
  for (const socket of clients.get(userId) ?? []) send(socket, payload)
}

export async function broadcastToConversation(
  conversationId: string,
  payload: unknown,
  excludeUserId?: string,
) {
  const members = await query<{ user_id: string }>(
    'SELECT user_id FROM conversation_members WHERE conversation_id = $1',
    [conversationId],
  )
  for (const member of members.rows) {
    if (member.user_id !== excludeUserId) {
      broadcastToUser(member.user_id, payload)
    }
  }
}

export async function registerWebSockets(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, (socket, request) => {
    const token = (request.query as { token?: string }).token
    if (!token) {
      socket.close(1008, 'Token required')
      return
    }

    void verifyToken(token)
      .then(async (userId) => {
        if (!userId) {
          socket.close(1008, 'Unauthorized')
          return
        }

        const sockets = clients.get(userId) ?? new Set<WebSocket>()
        sockets.add(socket)
        clients.set(userId, sockets)
        send(socket, { type: 'ready', userId })

        const callEvents = new Set([
          'call:invite',
          'call:accept',
          'call:reject',
          'call:offer',
          'call:answer',
          'call:ice',
          'call:hangup',
        ])

        const handleMessage = async (raw: string) => {
          let parsed: Record<string, unknown>
          try {
            parsed = JSON.parse(raw) as Record<string, unknown>
          } catch {
            return
          }

          if (parsed.type === 'typing' && typeof parsed.conversationId === 'string') {
            const membership = await query(
              'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
              [parsed.conversationId, userId],
            )
            if (!membership.rowCount) return

            await broadcastToConversation(
              parsed.conversationId,
              {
                type: 'typing',
                conversationId: parsed.conversationId,
                userId,
                isTyping: Boolean(parsed.isTyping),
              },
              userId,
            )
            return
          }

          if (
            typeof parsed.type === 'string' &&
            callEvents.has(parsed.type) &&
            typeof parsed.to === 'string' &&
            typeof parsed.callId === 'string'
          ) {
            if (
              parsed.type === 'call:invite' &&
              parsed.kind !== 'voice' &&
              parsed.kind !== 'video'
            ) {
              return
            }
            broadcastToUser(parsed.to, { ...parsed, from: userId })
          }
        }

        socket.on('message', (raw) => {
          void handleMessage(raw.toString())
        })

        const remove = () => {
          const current = clients.get(userId)
          current?.delete(socket)
          if (current?.size === 0) clients.delete(userId)
        }
        socket.on('close', remove)
        socket.on('error', remove)
      })
      .catch(() => socket.close(1008, 'Unauthorized'))
  })
}
