# 课时管家 Backend

TypeScript HTTP backend for the 课时管家 app family. It exposes REST JSON APIs for phone-password auth, family sharing, children, classes, lessons, attendance, leave, reminders, theme preferences, and cost reporting while preserving client-compatible `camelCase` fields, enum values, and ISO-8601 date strings.

## Quick Start

Requirements:

- Node.js. Verified local runtime: Node `v25.9.0`.

Install and run:

```bash
npm install
npm run dev
```

Default endpoints:

- API base URL: `http://localhost:3000`
- Swagger UI: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/openapi.json`
- Health check: `http://localhost:3000/health`

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listen port |
| `NODE_ENV` | `development` | Enables non-production friendly defaults |
| `TOKEN_SECRET` | `dev-secret-change-me` | HMAC secret for opaque bearer tokens |
| `STORAGE_MODE` | `mysql` | `mysql`, `file`, or `memory` |
| `DATABASE_URL` | unset | MySQL connection string when `STORAGE_MODE=mysql` |
| `DATA_FILE` | `.data/shike-guanjia.json` | JSON file store path when `STORAGE_MODE=file` |

## WeChat CloudBase Run Storage

For 微信云托管 / CloudBase Run, keep the service container stateless. Do not use `memory` or `file` for production data because instances can be recreated or scaled.

Recommended CloudBase Run environment variables:

```bash
NODE_ENV=production
STORAGE_MODE=mysql
DATABASE_URL=mysql://<username>:<password>@<internal-host>:<port>/<database>
TOKEN_SECRET=<long-random-secret>
```

The MySQL store uses normalized tables for product data:

```sql
users
families
family_members
children
classes
lessons
auth_credentials
sessions
attendance
leaves
lesson_changes
suspensions
reminder_settings
reminder_subscriptions
theme_preferences
```

On startup, legacy `kv_store(collection, id, value)` data is migrated into the dedicated MySQL tables and the legacy `kv_store` table is dropped. During request handling, MySQL tables are refreshed before auth and business logic so direct database repairs are visible without relying on stale in-process snapshots.

CloudBase MySQL direct connection should use the internal address from the cloud hosting service. Use external addresses only for local debugging.

## Validation

```bash
npm test
npm run typecheck
```

Smoke test against a running server:

```bash
npm run smoke
```

The smoke script registers or logs in with a phone and password, creates a child and class, checks in, requests leave, and fetches monthly cost.

## Docs

- [API reference](docs/api.md)
- [Architecture notes](docs/architecture.md)
- [OpenAPI JSON](docs/openapi.json)
npm run build
zip -r shike-guanjia-backend-wechat-cloud.zip \
  Dockerfile .dockerignore package.json package-lock.json \
  tsconfig.json tsconfig.build.json src README.md docs scripts \
  -x '*.DS_Store' '*.zip' 'node_modules/*' '.data/*' '.codex/*'
