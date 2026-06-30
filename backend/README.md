# new-beginning-mbc-api

Backend API for the New Beginning Missionary Baptist Church dashboard.

## Stack
- Node.js + Express
- Postgres (Render-managed)
- Auto-injected `DATABASE_URL` from `render.yaml` (`fromDatabase`)

## Local dev
```bash
cd backend
npm install
DATABASE_URL=postgres://localhost/nbmc_dev npm start
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Service liveness |
| GET | `/api/health/db` | DB connection + table list |
| GET | `/api/stats/overview` | Dashboard overview counts |
| GET/POST | `/api/members` | List / create |
| GET/PUT/DELETE | `/api/members/:id` | Read / update / delete |
| GET/POST | `/api/sms-signups` | … |
| GET/POST | `/api/events` | … |
| GET/POST | `/api/sermons` | … |
| GET/POST | `/api/prayer-requests` | … |
| GET/POST | `/api/templates` | … |
| GET/POST | `/api/message-history` | … |
| GET/POST | `/api/staff` | … |
| GET | `/api/settings` | List all settings |
| PUT | `/api/settings/:key` | Upsert one setting |

## Tables
Schema mirrors the dashboard's localStorage shapes:
`members`, `sms_signups`, `events`, `sermons`, `prayer_requests`,
`templates`, `message_history`, `staff`, `settings`.

All created on boot via `CREATE TABLE IF NOT EXISTS`.