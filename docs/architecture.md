# Architecture Notes

## Runtime Shape

The backend is a small Node.js TypeScript service with no web framework dependency. `src/server.ts` loads config, chooses a store, builds the HTTP server, and listens on `PORT`.

Request handling is split this way:

- `src/http.ts`: route matching, body parsing, auth attachment, JSON/CSV response formatting, request logging.
- `src/app-service.ts`: auth, family scoping, class lifecycle, scheduling side effects, attendance, leave, and cost-reporting rules.
- `src/schedule.ts`: deterministic weekly/monthly/custom lesson generation and overlap checks.
- `src/store.ts`: `MemoryStore`, JSON `FileStore`, and SQLite `SqliteStore`.
- `src/openapi.ts`: source of truth for Swagger UI and `docs/openapi.json`.

## Data And Storage

The default store is SQLite at `.data/shike-guanjia.sqlite`. It uses a single `kv_store(collection, id, value)` table and persists domain objects as JSON values. The JSON file store has the same collection shape and is useful for manual inspection. `STORAGE_MODE=memory` is intended for disposable local runs and tests.

For 微信云托管 / CloudBase Run, use `STORAGE_MODE=mysql` with `DATABASE_URL=mysql://<username>:<password>@<internal-host>:<port>/<database>`. The MySQL store keeps the same key-value collection shape so the API and business service do not change, but persistence lives outside the container. Cloud hosting containers should be treated as stateless; local file, SQLite, and memory modes are not production-safe when instances are recreated or scaled.

Domain collections:

- users, families, children
- classes, lessons, suspensions
- attendance, leaves
- sessions, verificationCodes, verificationRequests

Family ownership is the authorization boundary. Child, class, lesson, attendance, leave, and cost reads all resolve through the authenticated user's family.

## Business Rules

- Phone-code login creates a user and default one-member family on first login.
- Non-production login can use `DEV_VERIFICATION_CODE`; production must rely on a recorded verification code.
- A family has a two-member MVP limit and cannot remove its final member.
- Creating a class generates scheduled lessons up to `totalHours` or `endTime`; if `endTime` is missing, generation uses an 18-month horizon.
- Updating recurring fields, `startTime`, `endTime`, or `totalHours` regenerates future scheduled lessons while preserving completed, leave, manual, and makeup lessons.
- Check-in is idempotent per lesson and updates class used/remaining hours.
- Leave marks the original lesson as `leave` and creates a makeup lesson when the schedule can produce one.
- Cost reports are derived from completed lessons and class fee/hour values; report totals are not stored.

## Integration Contract

The API intentionally keeps Flutter-compatible `camelCase` fields, enum names, and ISO-8601 date strings. Successful JSON endpoints are wrapped as `{ "data": ... }`; errors are wrapped as `{ "error": { "code", "message", "fields" } }`.

When routes or payload schemas change, update both `src/openapi.ts` and `docs/api.md`. If `docs/openapi.json` is committed, regenerate it from `src/openapi.ts` and verify it matches the runtime `/openapi.json`.
