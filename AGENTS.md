# Project Rules

This is a TypeScript Node.js backend for the 课时管家 Flutter app. Keep API payloads compatible with the Flutter models: `camelCase` fields, enum string values, and ISO-8601 date strings.

## Commands

- Install: `npm install`
- Dev server: `npm run dev`
- Tests: `npm test`
- Type check: `npm run typecheck`
- Smoke against running server: `npm run smoke`

## Architecture Boundaries

- Route wiring and response envelopes live in `src/http.ts`.
- Business rules live in `src/app-service.ts`; avoid moving domain side effects into route handlers.
- Schedule generation and conflict logic live in `src/schedule.ts`.
- Persistence implementations live in `src/store.ts` and should keep the `MemoryStore` map shape unless intentionally migrating the repository boundary.
- `src/openapi.ts` is the runtime OpenAPI source. Keep `docs/openapi.json` and `docs/api.md` aligned when API routes or schemas change.

## API Invariants

- Protected routes use `Authorization: Bearer <token>` and scope access by authenticated family.
- Successful JSON responses are `{ "data": ... }`; errors are `{ "error": { "code", "message", "fields" } }`.
- Default storage is SQLite at `.data/shike-guanjia.sqlite`; `STORAGE_MODE=memory` is disposable and `STORAGE_MODE=file` uses `DATA_FILE`.
- Non-production verification code defaults to `123456`; do not treat it as production SMS behavior.
- Check-in must remain idempotent per lesson. Leave cancellation must restore the original lesson and remove generated makeup lessons.
