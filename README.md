# HonDen v1

Self-hostable messaging app. Local PostgreSQL/Redis, Fastify + WebSocket backend, React/TypeScript cyberpunk UI. No paid cloud services, no telemetry.

## Requirements (Windows 10/11 PowerShell)

- Node.js 20+
- Docker Desktop (running, Linux containers)
- npm 10+

## Setup

```powershell
Copy-Item .env.example .env
docker compose up -d
npm install
npm run dev
```

For a single command after the first `.env` copy:

```powershell
npm run dev:full
```

Open <http://localhost:5173>. API: <http://localhost:3000>. WebSocket: `ws://localhost:3000/ws?token=<jwt>`.

Change `JWT_SECRET` in `.env` before using this anywhere but localhost.

## What runs

- PostgreSQL 16 on `localhost:5432` (database `honden`)
- Redis 7 on `localhost:6379` (included for future caching; not required by v1 text messaging)
- Fastify API + WS hub on `localhost:3000`
- Vite frontend on `localhost:5173` (Tauri dev URL remains unchanged)

SQL migrations run automatically at API startup. Tables: `users`, `user_devices`, `contacts`, `conversations`, `conversation_members`, `messages`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start API (watch) + Vite together |
| `npm run dev:full` | Start Docker services, then `npm run dev` |
| `npm run typecheck` | Typecheck frontend |
| `npm run typecheck:server` | Typecheck API |
| `npm run build` | Typecheck both + production frontend build |
| `npm run start:server` | Run API without watch |

## API

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `PUT /api/auth/profile`
- `GET/POST /api/contacts`, `GET /api/users/search?q=`
- `GET/POST /api/conversations`, `POST /api/conversations/direct`
- `GET/POST /api/conversations/:id/messages`
- `PATCH/DELETE /api/messages/:messageId`
- `WS /ws?token=<jwt>` — live messages and typing indicators

Passwords are Argon2id hashes; tokens are HS256 JWTs signed with `JWT_SECRET`.

## Stage status

- **Stage 1 — available now:** auth, users, contacts, direct/group conversation records, persisted text messages, live delivery and typing indicators.
- **Stage 2 — partial:** group management is a visible placeholder; conversation creation by API works.
- **Stage 3 — upcoming module:** Double Ratchet / true end-to-end encryption is not implemented. Current message bodies are stored as plaintext in local PostgreSQL.
- **Stage 4 — upcoming module:** incoming/voice/video call screens are UI-only prototypes; no media capture or WebRTC is active.
- **Stage 5 — upcoming module:** multi-device sync hardening and Redis-backed presence/rate limiting are planned.
