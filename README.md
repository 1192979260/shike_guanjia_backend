# 课时管家 Backend

TypeScript HTTP backend for the 课时管家 app family. It exposes REST JSON APIs for WeChat phone authorization auth, family sharing, children, classes, lessons, attendance, leave, reminders, theme preferences, and cost reporting while preserving client-compatible `camelCase` fields, enum values, and ISO-8601 date strings.

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
- Liveness: `http://localhost:3000/health`
- Readiness (deep, probes DB): `http://localhost:3000/health/ready`

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listen port |
| `NODE_ENV` | `development` | Enables non-production friendly defaults |
| `TOKEN_SECRET` | `dev-secret-change-me` | HMAC secret for opaque bearer tokens. **Required** in production — the server refuses to start with the default when `NODE_ENV=production`. |
| `MAX_SESSION_AGE_MS` | `2592000000` (30d) | Session lifetime; expired sessions are rejected at auth time. |
| `STORAGE_MODE` | `mysql` | `mysql`, `file`, or `memory` |
| `DATABASE_URL` | unset | MySQL connection string when `STORAGE_MODE=mysql` |
| `DATA_FILE` | `.data/shike-guanjia.json` | JSON file store path when `STORAGE_MODE=file` |
| `CORS_ALLOWED_ORIGINS` | empty | Comma-separated allowed origins. Empty = same-origin only in production (any origin in dev). |
| `LOGIN_MAX_ATTEMPTS` | `5` | Failed login attempts before temporary lockout. |
| `LOGIN_LOCKOUT_MS` | `900000` (15m) | Lockout duration after too many failed logins. |
| `LOGIN_ATTEMPT_WINDOW_MS` | `900000` | Window over which failed attempts accumulate. |
| `MAX_BODY_BYTES` | `1048576` (1 MiB) | Maximum inbound request body size; 413 if exceeded. |
| `UPLOAD_DIR` | `.data/uploads` | Directory used for uploaded avatar image files. |
| `MAX_IMAGE_UPLOAD_BYTES` | `524288` (512 KiB) | Maximum decoded avatar image size. `MAX_BODY_BYTES` still applies to the JSON/base64 request body. |
| `PUBLIC_BASE_URL` | unset | Optional public origin used when generating absolute upload URLs. Falls back to forwarded request headers. |
| `MYSQL_CONNECTION_LIMIT` | `15` | MySQL pool size. |
| `REMINDER_SCAN_INTERVAL_MS` | `60000` | Reminder scheduler interval. Runs are serialized (no overlap). |

Mutation requests may include an `Idempotency-Key` header. The server caches successful mutation results for 10 minutes per user/method/path/key and returns the cached result on duplicate retries, preventing double execution after client network timeouts.

### Production startup validation

On boot the server validates its config and **refuses to start** in production (`NODE_ENV=production`) when required secrets are missing or left at insecure defaults — specifically `TOKEN_SECRET` must be set to a non-default value, and `DATABASE_URL` must be present when `STORAGE_MODE=mysql`. This prevents accidentally deploying with the public `dev-secret-change-me` token secret.

## WeChat CloudBase Run Storage

For 微信云托管 / CloudBase Run, keep the service container stateless. Do not use `memory` or `file` for production data because instances can be recreated or scaled.

Recommended CloudBase Run environment variables:

```bash
NODE_ENV=production
STORAGE_MODE=mysql
DATABASE_URL=mysql://<username>:<password>@<internal-host>:<port>/<database>
TOKEN_SECRET=<long-random-secret>
CORS_ALLOWED_ORIGINS=https://your-h5-domain.example.com
```

### TLS verification for WeChat API calls

Outbound calls to `api.weixin.qq.com` (openid exchange, access token, reminder delivery) verify TLS certificates **by default**. 微信云托管会在容器内挂载平台根证书 `/app/cert/certificate.crt`；Dockerfile 已设置 `NODE_EXTRA_CA_CERTS=/app/cert/certificate.crt`，并保留 `NODE_OPTIONS=--use-system-ca` 使用系统信任库。If subscription delivery fails with `DEPTH_ZERO_SELF_SIGNED_CERT`, rebuild and redeploy the latest image, then confirm the CloudBase runtime environment has not overridden either variable. Do not set `WECHAT_TLS_REJECT_UNAUTHORIZED=false` in production; disabling verification exposes the appSecret and access token to man-in-the-middle attacks.

### Data integrity

Multi-step write operations (e.g. check-in: create attendance + update lesson + refresh class usage) run inside a single MySQL transaction via `store.runInTransaction`, so they commit atomically or roll back entirely. The store no longer wipes-and-reinserts whole tables on a single record change. Referential integrity is enforced with `ON DELETE CASCADE` foreign keys (added on startup, best-effort on legacy databases). `usedHours` / `remainingHours` on classes are always derived from attendance + history rather than trusted from client input, preventing drift.

### Request handling and concurrency

Requests within an instance are serialized through a per-instance mutex around the refresh → read → write cycle, so concurrent requests cannot interleave and observe each other's half-applied state. The in-memory cache is considered fresh for 5 seconds between reloads, bounding cross-instance staleness cheaply. Mutation requests support a short-lived `Idempotency-Key` cache so safe client retries reuse the original result instead of repeating a write. The reminder scheduler runs are also serialized with an `isRunning` guard so two intervals cannot process the same pending subscriptions; subscriptions move to a `processing` state before the WeChat send and are re-queued if a run crashes mid-send.

### Graceful shutdown

The server handles `SIGTERM` / `SIGINT` by stopping new connections, flushing pending DB writes (`waitForIdle`), closing the pool, and exiting. `unhandledRejection` and `uncaughtException` are logged and trigger a graceful shutdown. This prevents losing in-flight writes during container recreation.

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

On startup, legacy `kv_store(collection, id, value)` data is migrated into the dedicated MySQL tables and the legacy `kv_store` table is dropped. The in-memory cache is refreshed before auth and business logic with a 5-second freshness TTL; within a single instance the cache is kept current by synchronous mutations, so a reload is only needed to pick up writes from other instances. A versioned `schema_migrations` table tracks applied schema versions for future migrations.

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
- Runtime OpenAPI: `GET /openapi.json` (served from `src/openapi.ts`)

CloudBase Run package example:

```bash
npm run build
zip -r shike-guanjia-backend-wechat-cloud.zip \
  Dockerfile .dockerignore package.json package-lock.json \
  tsconfig.json tsconfig.build.json src README.md docs scripts \
  -x '*.DS_Store' '*.zip' 'node_modules/*' '.data/*' '.codex/*'
```
