import { pool, withTransaction } from './db'

const migrations = [
  {
    name: '001_core_tables',
    sql: `
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        username text NOT NULL UNIQUE,
        email text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        display_name text NOT NULL,
        avatar_url text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS user_devices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id text NOT NULL,
        platform text,
        last_seen timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (user_id, device_id)
      );

      CREATE TABLE IF NOT EXISTS contacts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        contact_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        alias text,
        status text NOT NULL DEFAULT 'accepted'
          CHECK (status IN ('pending', 'accepted', 'blocked')),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (owner_id, contact_id)
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        kind text NOT NULL CHECK (kind IN ('direct', 'group')),
        name text,
        created_by uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS conversation_members (
        conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
        joined_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (conversation_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id uuid NOT NULL REFERENCES users(id),
        body text NOT NULL,
        edited_at timestamptz,
        deleted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
        ON messages (conversation_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversation_members_user
        ON conversation_members (user_id);
      CREATE INDEX IF NOT EXISTS idx_contacts_owner
        ON contacts (owner_id);
    `,
  },
  {
    name: '002_message_media',
    sql: `
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS gif_url text;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'text';
    `,
  },
  {
    name: '003_profile_presence',
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'online'
        CHECK (status IN ('online', 'dnd', 'offline'));
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_color text NOT NULL DEFAULT '#8B5CF6';
    `,
  },
]

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  for (const migration of migrations) {
    const existing = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE name = $1',
      [migration.name],
    )
    if (existing.rowCount) continue

    await withTransaction(async (client) => {
      await client.query(migration.sql)
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [
        migration.name,
      ])
    })
  }
}
