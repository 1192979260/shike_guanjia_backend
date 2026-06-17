# 课时管家 Backend

TypeScript HTTP backend for the 课时管家 Flutter app. It exposes REST JSON APIs for auth/family sharing, children, classes, lessons, attendance, leave, and cost reporting while preserving Flutter-compatible `camelCase` fields, enum values, and ISO-8601 date strings.

## Quick Start

Requirements:

- Node.js with `node:sqlite` support. Verified local runtime: Node `v25.9.0`.

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
| `NODE_ENV` | `development` | Enables non-production dev verification-code behavior |
| `TOKEN_SECRET` | `dev-secret-change-me` | HMAC secret for opaque bearer tokens |
| `DEV_VERIFICATION_CODE` | `123456` | Non-production phone-code login value |
| `VERIFICATION_TTL_MS` | `300000` | Verification-code expiry |
| `VERIFICATION_RATE_LIMIT_PER_MINUTE` | `3` | Per-phone send-code limit |
| `STORAGE_MODE` | `sqlite` | `mysql`, `sqlite`, `file`, or `memory` |
| `DATABASE_URL` | unset | MySQL connection string when `STORAGE_MODE=mysql` |
| `SQLITE_FILE` | `.data/shike-guanjia.sqlite` | SQLite key-value store file |
| `DATA_FILE` | `.data/shike-guanjia.json` | JSON file store path when `STORAGE_MODE=file` |

## WeChat CloudBase Run Storage

For 微信云托管 / CloudBase Run, keep the service container stateless. Do not use `memory`, `file`, or local SQLite for production data because instances can be recreated or scaled.

Recommended CloudBase Run environment variables:

```bash
NODE_ENV=production
STORAGE_MODE=mysql
DATABASE_URL=mysql://<username>:<password>@<internal-host>:<port>/<database>
TOKEN_SECRET=<long-random-secret>
```

The MySQL store uses normalized tables for core product data:

```sql
users
families
family_members
children
classes
lessons
auth_credentials
```

Less central or fast-changing data, such as sessions, attendance side records, leaves, preferences, and reminder settings, still uses `kv_store(collection, id, value)`. On startup, legacy core records are migrated from `kv_store` into empty normalized tables. During request handling, MySQL core tables are refreshed before auth and business logic so direct database repairs are visible without relying on stale in-process snapshots.

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

The smoke script logs in with the non-production code `123456`, creates a child and class, checks in, requests leave, and fetches monthly cost.

## Docs

- [API reference](docs/api.md)
- [Architecture notes](docs/architecture.md)
- [OpenAPI JSON](docs/openapi.json)
