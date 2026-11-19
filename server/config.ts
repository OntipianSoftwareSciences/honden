import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'

function loadDotEnv() {
  try {
    const content = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const separator = trimmed.indexOf('=')
      if (separator < 1) continue
      const key = trimmed.slice(0, separator).trim()
      const raw = trimmed.slice(separator + 1).trim()
      const value = raw.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
      if (!(key in process.env)) process.env[key] = value
    }
  } catch {
    return
  }
}

loadDotEnv()

const schema = z.object({
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z
    .string()
    .default('postgres://honden:honden_local_only@localhost:5432/honden'),
  JWT_SECRET: z
    .string()
    .min(32)
    .default('local-development-only-secret-change-me-please-32'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
})

export const config = schema.parse(process.env)

export const corsOrigins = config.CLIENT_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
