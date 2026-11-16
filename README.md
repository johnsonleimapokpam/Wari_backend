# Wari Backend

A layered Node.js backend for authenticated REST APIs and reliable real-time chat.

This repository contains the Wari API and Socket.IO server. It provides authentication, user search, conversations, realtime messaging, presence, typing indicators, delivery/read receipts, and backend support for group conversations.

## TECH STACK  
*Node.js, Express, PostgreSQL, Socket.IO, Redis, JWT, Zod*

## Capabilities

- JWT-based authentication for REST and Socket.IO
- Password hashing with bcrypt
- User search and direct conversation creation
- Realtime one-to-one and group messaging
- Online presence, active connection counts, and last-seen timestamps
- Typing indicators with inactivity cleanup
- Sent, delivered, and read message states
- Per-recipient receipts for group messages
- Request and socket payload validation with Zod
- Parameterized PostgreSQL queries
- Helmet, CORS configuration, request logging, and rate limiting
- Graceful shutdown for HTTP, Socket.IO, Redis, and PostgreSQL

## Architecture

```text
HTTP routes ────────┐
                    ▼
             Controllers
                    │
                    ▼
                 Services
                    │
                    ▼
                Repositories
                    │
                    ▼
                PostgreSQL

Socket.IO ──────────┘
   │
   ├── authentication
   ├── conversation rooms
   ├── message events
   ├── presence and typing
   └── delivery/read receipts
```

The backend uses a **route → controller → service → repository** flow so transport handling, business rules, and SQL access remain separate. Socket handlers reuse the service layer where possible instead of duplicating application logic.

### Reliable message writes

Each message send includes a UUID `clientMessageId`. PostgreSQL enforces uniqueness for `(conversation_id, client_message_id)`, allowing retries from reconnects or repeated acknowledgements to return the original message rather than create duplicates.

Message creation and related work run in a transaction. Database constraints and triggers also prevent inactive conversation members from sending messages and prevent message status from moving backward from `READ` to `DELIVERED` or `SENT`.

### Durable and ephemeral state

- PostgreSQL stores users, conversations, messages, memberships, timestamps, and receipt state.
- In-memory services track current presence and typing sessions for the single-server runtime.
- Redis is connected at startup and provides a path toward shared realtime state and multi-instance scaling.

## Repository structure

| Directory | Purpose |
| --- | --- |
| `src/config` | Environment parsing, PostgreSQL, and Redis clients |
| `src/controllers` | HTTP request handlers |
| `src/middleware` | Authentication, validation, error handling, and not-found handling |
| `src/repositories` | Parameterized SQL access |
| `src/routes` | REST route composition |
| `src/services` | Authentication, messaging, membership, presence, delivery, and receipt logic |
| `src/sockets` | Socket authentication, rooms, messages, presence, typing, and receipts |
| `src/validators` | HTTP and socket input schemas |
| `sql` | Ordered PostgreSQL schema and migration scripts |
| `test` | Idempotency and runtime regression tests |

## Run locally

### Prerequisites

- Node.js
- PostgreSQL
- Redis

### Install

```bash
npm install
```

### Configure environment

Create a `.env` file:

```env
NODE_ENV=development
PORT=5000
DATABASE_URL=postgresql://<user>:<password>@localhost:5432/<database>
JWT_SECRET=<at-least-16-character-secret>
JWT_EXPIRES_IN=7d
BCRYPT_SALT_ROUNDS=12
CORS_ORIGIN=http://localhost:5173
REDIS_URL=redis://localhost:6379
```

Apply the SQL files in `sql/` in filename order, then start the server:

```bash
npm run dev
```

The API and Socket.IO server listen on `http://localhost:5000` by default.

## Checks

```bash
npm run lint
npm run test:regressions
```

For the focused idempotency test:

```bash
npm run test:idempotency
```

