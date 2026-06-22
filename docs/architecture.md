# Architecture Notes

## Runtime Shape

The backend is a small Node.js TypeScript service with no web framework dependency. `src/server.ts` loads config, validates it for production, chooses a store, builds the HTTP server, installs graceful-shutdown and process-error handlers, and listens on `PORT`.

Request handling is split this way:

- `src/http.ts`: route matching, body parsing (with a `MAX_BODY_BYTES` cap), CORS allowlist enforcement, request-id + structured JSON logging, per-instance request mutex, transaction wrapping, JSON/CSV response formatting.
- `src/app-service.ts`: auth (HMAC-signed, TTL-enforced sessions, login rate-limiting), family scoping, class lifecycle, scheduling side effects, attendance, leave, and cost-reporting rules, WeChat integration, reminder dispatch.
- `src/schedule.ts`: deterministic weekly/monthly/custom lesson generation and overlap checks.
- `src/store.ts`: `MemoryStore`, JSON `FileStore`, and MySQL-backed `MysqlStore`. All expose `refresh`, `waitForIdle`, `runInTransaction`, `healthCheck`, and `close`.
- `src/config.ts`: config loading + `validateConfig` production fail-fast.
- `src/openapi.ts`: source of truth for Swagger UI and `docs/openapi.json`.

## Data And Storage

The default store is MySQL via `DATABASE_URL`. The JSON file store is still available for manual inspection, and `STORAGE_MODE=memory` is intended for disposable local runs and tests.

For 微信云托管 / CloudBase Run, use `STORAGE_MODE=mysql` with `DATABASE_URL=mysql://<username>:<password>@<internal-host>:<port>/<database>`. The MySQL store keeps product records in dedicated tables, including `users`, `families`, `family_members`, `children`, `classes`, `lessons`, `auth_credentials`, `sessions`, `attendance`, `leaves`, `lesson_changes`, `suspensions`, `reminder_settings`, `reminder_subscriptions`, and `theme_preferences`, plus a `schema_migrations` version table. On startup it migrates legacy `kv_store` data into those tables, skips stale core KV data when normalized core rows already exist, restores `ON DELETE CASCADE` foreign keys (best-effort on legacy databases with orphaned rows), and drops the legacy `kv_store` table after migration.

The in-memory cache is refreshed before auth and business logic with a 5-second freshness TTL; within a single instance the cache is kept current by synchronous mutations, so a reload is only needed to pick up writes from other instances. Cloud hosting containers should be treated as stateless; local file and memory modes are not production-safe when instances are recreated or scaled.

### Concurrency and integrity

Requests within an instance are serialized through a per-instance mutex around the refresh → read → write cycle, so concurrent requests cannot interleave and observe each other's half-applied state. Multi-step writes are buffered and flushed in a single MySQL transaction via `store.runInTransaction`, committing atomically or rolling back entirely. Row-level persistence uses `INSERT ... ON DUPLICATE KEY UPDATE` and targeted `DELETE`; the old whole-table wipe-and-reinsert path has been removed. Mutations can include an `Idempotency-Key` header; successful results are cached for 10 minutes per user/method/path/key to make client retries safe after timeouts. `usedHours` / `remainingHours` on classes are always derived from attendance + history rather than trusted from client input.

Domain collections and tables:

- users, families, children
- classes, lessons, suspensions
- attendance, leaves
- sessions, auth_credentials, lesson_changes, reminder_settings, reminder_subscriptions, theme_preferences

Family ownership is the authorization boundary. Child, class, lesson, attendance, leave, and cost reads all resolve through the authenticated user's family.

## Business Rules

- Phone-password registration creates a user and default one-member family on first login.
- Login uses the stored password credential and issues an HMAC-signed opaque bearer token-backed session. Sessions expire after `MAX_SESSION_AGE_MS`. Failed logins are rate-limited per phone.
- A family has a two-member MVP limit and cannot remove its final member.
- Creating a class generates scheduled lessons up to `totalHours` or `endTime`; if `endTime` is missing, generation uses an 18-month horizon.
- Updating recurring fields, `startTime`, `endTime`, or `totalHours` regenerates future scheduled lessons while preserving completed, leave, manual, and makeup lessons.
- Check-in is idempotent per lesson; mutation retries can also use `Idempotency-Key`; successful check-in updates class used/remaining hours (derived).
- Leave marks the original lesson as `leave` and creates a makeup lesson when the schedule can produce one.
- Cost reports are derived from completed lessons and class fee/hour values; report totals are not stored.
- Reminder subscriptions move to a `processing` state before the WeChat send; a crashed run leaves them re-queueable. Scheduler runs are serialized to prevent duplicate sends.

## Integration Contract

The API intentionally keeps Flutter-compatible `camelCase` fields, enum names, and ISO-8601 date strings. Successful JSON endpoints are wrapped as `{ "data": ... }`; errors are wrapped as `{ "error": { "code", "message", "fields" } }`.

When routes or payload schemas change, update both `src/openapi.ts` and `docs/api.md`. The runtime `/openapi.json` is served directly from `src/openapi.ts`; do not edit `docs/openapi.json` by hand unless a release process explicitly regenerates it.
