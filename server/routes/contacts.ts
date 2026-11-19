import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../auth'
import { query } from '../db'
import type { UserRow } from '../models'
import { toPublicUser } from '../serialize'

const addContactSchema = z.object({
  username: z.string().min(3).max(30),
})

const searchSchema = z.object({
  q: z.string().min(1).max(80),
})

export async function contactRoutes(app: FastifyInstance) {
  app.get('/api/contacts', { preHandler: authenticate }, async (request) => {
    const result = await query<UserRow & { contact_id: string; alias: string | null; status: string }>(
      `SELECT c.id AS contact_id, c.alias, c.status, u.*
       FROM contacts c
       JOIN users u ON u.id = c.contact_id
       WHERE c.owner_id = $1 AND c.status <> 'blocked'
       ORDER BY u.display_name, u.username`,
      [request.userId],
    )

    return {
      contacts: result.rows.map((row) => ({
        id: row.contact_id,
        alias: row.alias,
        status: row.status,
        user: toPublicUser(row),
      })),
    }
  })

  app.post('/api/contacts', { preHandler: authenticate }, async (request, reply) => {
    const input = addContactSchema.parse(request.body)
    const target = await query<UserRow>('SELECT * FROM users WHERE username = $1', [
      input.username.toLowerCase(),
    ])
    const contact = target.rows[0]
    if (!contact) return reply.code(404).send({ error: 'User not found' })
    if (contact.id === request.userId) {
      return reply.code(400).send({ error: 'You cannot add yourself' })
    }

    const saved = await query<{ id: string; alias: string | null; status: string }>(
      `INSERT INTO contacts (owner_id, contact_id, status)
       VALUES ($1, $2, 'accepted')
       ON CONFLICT (owner_id, contact_id) DO UPDATE SET status = 'accepted'
       RETURNING id, alias, status`,
      [request.userId, contact.id],
    )

    return {
      contact: {
        ...saved.rows[0],
        user: toPublicUser(contact),
      },
    }
  })

  const contactStatusSchema = z.object({
    status: z.enum(['accepted', 'blocked']),
  })

  app.patch(
    '/api/contacts/:contactId',
    { preHandler: authenticate },
    async (request, reply) => {
      const params = z.object({ contactId: z.string().uuid() }).parse(request.params)
      const input = contactStatusSchema.parse(request.body)
      const updated = await query<{ id: string; status: string }>(
        `UPDATE contacts SET status = $1
         WHERE owner_id = $2 AND contact_id = $3
         RETURNING id, status`,
        [input.status, request.userId, params.contactId],
      )
      if (!updated.rowCount) {
        return reply.code(404).send({ error: 'Contact not found' })
      }
      return { contact: updated.rows[0] }
    },
  )

  app.get('/api/users/search', { preHandler: authenticate }, async (request) => {
    const input = searchSchema.parse(request.query)
    const term = `%${input.q}%`
    const result = await query<UserRow>(
      `SELECT * FROM users
       WHERE id <> $1
         AND id NOT IN (
           SELECT contact_id FROM contacts WHERE owner_id = $1 AND status = 'blocked'
         )
         AND (username ILIKE $2 OR display_name ILIKE $2)
       ORDER BY username LIMIT 20`,
      [request.userId, term],
    )
    return { users: result.rows.map(toPublicUser) }
  })
}
