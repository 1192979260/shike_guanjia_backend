## 1. Domain Types And Persistence

- [x] 1.1 Add `ReminderSettings`, `ThemeSkin`, and `ThemePreference` types in `src/types.ts`.
- [x] 1.2 Add `reminderSettings` and `themePreferences` repositories to `MemoryStore` and `BackendRepositories`.
- [x] 1.3 Persist the new collections through `FileStore` snapshots.
- [x] 1.4 Persist the new collections through `SqliteStore` `kv_store` loading and map wrapping.

## 2. Validation And Business Rules

- [x] 2.1 Add validation helpers for reminder settings booleans and allowed `advanceMinutes` values.
- [x] 2.2 Add validation helpers for `ThemeSkin` values `warm`, `fresh`, and `classic`.
- [x] 2.3 Implement `getReminderSettings` and `updateReminderSettings` in `AppService` with family-scoped defaults and partial update preservation.
- [x] 2.4 Implement `getThemePreference` and `updateThemePreference` in `AppService` with user-scoped defaults.
- [x] 2.5 Replace generic family sharing limit, duplicate, and last-member errors with stable business error codes.
- [x] 2.6 Invalidate sessions for a removed family member when `removeFamilyMember` succeeds.

## 3. HTTP API And Documentation

- [x] 3.1 Add protected routes for `GET /api/reminder-settings` and `PATCH /api/reminder-settings` in `src/http.ts`.
- [x] 3.2 Add protected routes for `GET /api/preferences/theme` and `PATCH /api/preferences/theme` in `src/http.ts`.
- [x] 3.3 Add OpenAPI schemas and path entries for reminder settings, theme preferences, and stable family sharing errors in `src/openapi.ts`.
- [x] 3.4 Regenerate or sync `docs/openapi.json` from the runtime OpenAPI source.
- [x] 3.5 Update `docs/api.md` with the new preference APIs and family sharing error codes.

## 4. Tests And Verification

- [x] 4.1 Add API service tests for default reminder settings, partial reminder updates, invalid `advanceMinutes`, and same-family cross-session reads.
- [x] 4.2 Add API service tests for default theme preference, theme updates, invalid `skin`, logout persistence, and same-family member isolation.
- [x] 4.3 Add family sharing tests for stable error codes and removed-member session invalidation.
- [x] 4.4 Run `npm test` and fix any failures.
- [x] 4.5 Run `npm run typecheck` and fix any failures.
- [x] 4.6 Run `openspec validate add-reminders-theme-family-sharing` and confirm the change is apply-ready.
