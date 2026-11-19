import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authenticate, hashPassword, signToken, verifyPassword } from '../auth'
import { query } from '../db'
import type { UserRow } from '../models'
import { toSelfUser } from '../serialize'

const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, 'Use letters, numbers and underscores only'),
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
})

const loginSchema = z.object({
  emailOrUsername: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
})

const profileSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  bio: z.string().max(240).optional(),
  status: z.enum(['online', 'dnd', 'offline']).optional(),
  avatarColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a #RRGGBB color')
    .optional(),
  avatarUrl: z.string().url().nullable().optional(),
})

const deviceIdSchema = z.object({
  deviceId: z.string().uuid(),
})

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/api/auth/register',
    { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const input = registerSchema.parse(request.body)
      const username = input.username.toLowerCase()
      const email = input.email.toLowerCase()

      const existing = await query(
        'SELECT 1 FROM users WHERE username = $1 OR email = $2',
        [username, email],
      )
      if (existing.rowCount) {
        return reply.code(409).send({ error: 'Username or email is already in use' })
      }

      const passwordHash = await hashPassword(input.password)
      const created = await query<UserRow>(
        `INSERT INTO users (username, email, password_hash, display_name)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [username, email, passwordHash, input.username],
      )
      const user = created.rows[0]
      const token = await signToken(user.id)
      return reply.code(201).send({ token, user: toSelfUser(user) })
    },
  )

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const input = loginSchema.parse(request.body)
      const identity = input.emailOrUsername.toLowerCase()
      const found = await query<UserRow>(
        'SELECT * FROM users WHERE email = $1 OR username = $1 LIMIT 1',
        [identity],
      )
      const user = found.rows[0]
      if (!user || !(await verifyPassword(user.password_hash, input.password))) {
        return reply.code(401).send({ error: 'Invalid credentials' })
      }

      const token = await signToken(user.id)
      return { token, user: toSelfUser(user) }
    },
  )

  app.get('/api/auth/me', { preHandler: authenticate }, async (request, reply) => {
    const found = await query<UserRow>('SELECT * FROM users WHERE id = $1', [
      request.userId,
    ])
    const user = found.rows[0]
    if (!user) return reply.code(404).send({ error: 'Account not found' })
    return { user: toSelfUser(user) }
  })

  const updateProfile = async (request: FastifyRequest) => {
    const input = profileSchema.parse(request.body ?? {})
    const changes: string[] = []
    const values: unknown[] = []

    const addChange = (column: string, value: unknown) => {
      values.push(value)
      changes.push(`${column} = $${values.length}`)
    }

    if (input.displayName !== undefined) addChange('display_name', input.displayName)
    if (input.bio !== undefined) addChange('bio', input.bio)
    if (input.status !== undefined) addChange('status', input.status)
    if (input.avatarColor !== undefined) addChange('avatar_color', input.avatarColor)
    if (input.avatarUrl !== undefined) addChange('avatar_url', input.avatarUrl)

    if (changes.length === 0) {
      const current = await query<UserRow>('SELECT * FROM users WHERE id = $1', [
        request.userId,
      ])
      return { user: toSelfUser(current.rows[0]) }
    }

    values.push(request.userId)
    const updated = await query<UserRow>(
      `UPDATE users SET ${changes.join(', ')}, updated_at = now()
       WHERE id = $${values.length} RETURNING *`,
      values,
    )
    return { user: toSelfUser(updated.rows[0]) }
  }

  app.patch('/api/auth/profile', { preHandler: authenticate }, updateProfile)
  app.put('/api/auth/profile', { preHandler: authenticate }, updateProfile)

  app.get('/api/auth/devices', { preHandler: authenticate }, async (request) => {
    const result = await query<{
      id: string
      device_id: string
      platform: string | null
      last_seen: Date | string
      created_at: Date | string
    }>(
      `SELECT id, device_id, platform, last_seen, created_at
       FROM user_devices WHERE user_id = $1
       ORDER BY last_seen DESC`,
      [request.userId],
    )
    return {
      devices: result.rows.map((device) => ({
        id: device.id,
        deviceId: device.device_id,
        platform: device.platform,
        lastSeen: new Date(device.last_seen).toISOString(),
        createdAt: new Date(device.created_at).toISOString(),
      })),
    }
  })

  app.delete(
    '/api/auth/devices/:deviceId',
    { preHandler: authenticate },
    async (request, reply) => {
      const { deviceId } = deviceIdSchema.parse(request.params)
      const removed = await query(
        'DELETE FROM user_devices WHERE id = $1 AND user_id = $2',
        [deviceId, request.userId],
      )
      if (!removed.rowCount) {
        return reply.code(404).send({ error: 'Device session not found' })
      }
      return { ok: true }
    },
  )
}
