# Architecture Notes

## Runtime Shape

The backend is a small Node.js TypeScript service with no web framework dependency. `src/server.ts` loads config, chooses a store, builds the HTTP server, and listens on `PORT`.

Request handling is split this way:

- `src/http.ts`: route matching, body parsing, auth attachment, JSON/CSV response formatting, request logging.
- `src/app-service.ts`: auth, family scoping, class lifecycle, scheduling side effects, attendance, leave, and cost-reporting rules.
- `src/schedule.ts`: deterministic weekly/monthly/custom lesson generation and overlap checks.
- `src/store.ts`: `MemoryStore`, JSON `FileStore`, and MySQL-backed `MysqlStore`.
- `src/openapi.ts`: source of truth for Swagger UI and `docs/openapi.json`.

## Data And Storage

The default store is MySQL via `DATABASE_URL`. The JSON file store is still available for manual inspection, and `STORAGE_MODE=memory` is intended for disposable local runs and tests.

For 微信云托管 / CloudBase Run, use `STORAGE_MODE=mysql` with `DATABASE_URL=mysql://<username>:<password>@<internal-host>:<port>/<database>`. The MySQL store keeps product records in dedicated tables, including `users`, `families`, `family_members`, `children`, `classes`, `lessons`, `auth_credentials`, `sessions`, `attendance`, `leaves`, `lesson_changes`, `suspensions`, `reminder_settings`, `reminder_subscriptions`, and `theme_preferences`. On startup it migrates legacy `kv_store` data into those tables, skips stale core KV data when normalized core rows already exist, and drops the legacy `kv_store` table after migration. MySQL tables are refreshed at the beginning of each HTTP request before authentication and business logic run. Cloud hosting containers should be treated as stateless; local file and memory modes are not production-safe when instances are recreated or scaled.

Domain collections and tables:

- users, families, children
- classes, lessons, suspensions
- attendance, leaves
- sessions, auth_credentials, lesson_changes, reminder_settings, reminder_subscriptions, theme_preferences

Family ownership is the authorization boundary. Child, class, lesson, attendance, leave, and cost reads all resolve through the authenticated user's family.

## Business Rules

- Phone-password registration creates a user and default one-member family on first login.
- Login uses the stored password credential and issues an opaque bearer token-backed session.
- A family has a two-member MVP limit and cannot remove its final member.
- Creating a class generates scheduled lessons up to `totalHours` or `endTime`; if `endTime` is missing, generation uses an 18-month horizon.
- Updating recurring fields, `startTime`, `endTime`, or `totalHours` regenerates future scheduled lessons while preserving completed, leave, manual, and makeup lessons.
- Check-in is idempotent per lesson and updates class used/remaining hours.
- Leave marks the original lesson as `leave` and creates a makeup lesson when the schedule can produce one.
- Cost reports are derived from completed lessons and class fee/hour values; report totals are not stored.

## Integration Contract

The API intentionally keeps Flutter-compatible `camelCase` fields, enum names, and ISO-8601 date strings. Successful JSON endpoints are wrapped as `{ "data": ... }`; errors are wrapped as `{ "error": { "code", "message", "fields" } }`.

When routes or payload schemas change, update both `src/openapi.ts` and `docs/api.md`. If `docs/openapi.json` is committed, regenerate it from `src/openapi.ts` and verify it matches the runtime `/openapi.json`.
