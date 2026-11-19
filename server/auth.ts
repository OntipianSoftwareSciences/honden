import type { FastifyReply, FastifyRequest } from 'fastify'
import { Algorithm, hash, verify } from '@node-rs/argon2'
import { SignJWT, jwtVerify } from 'jose'
import { config } from './config'

const secret = new TextEncoder().encode(config.JWT_SECRET)

export async function hashPassword(password: string) {
  return hash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19456,
    timeCost: 2,
    outputLen: 32,
    parallelism: 1,
  })
}

export async function verifyPassword(passwordHash: string, password: string) {
  try {
    return await verify(passwordHash, password)
  } catch {
    return false
  }
}

export async function signToken(userId: string) {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(config.JWT_EXPIRES_IN)
    .sign(secret)
}

export async function verifyToken(token: string) {
  const { payload } = await jwtVerify(token, secret)
  return payload.sub
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    await reply.code(401).send({ error: 'Authorization required' })
    return
  }

  const subject = await verifyToken(header.slice(7)).catch(() => undefined)
  if (!subject) {
    await reply.code(401).send({ error: 'Invalid or expired token' })
    return
  }

  request.userId = subject
}
