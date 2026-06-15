## Context

The backend currently provides phone-code authentication, family-scoped business data, class and lesson management, attendance/leave flows, cost reporting, OpenAPI docs, and Map-shaped persistence backed by memory, file, or SQLite stores. Flutter is the runtime client and already depends on bearer auth, `{ data }` response envelopes, string enums, `camelCase` JSON, and ISO-8601 date strings.

The new iteration requires three adjacent but distinct concerns:

- Family-level lesson reminder settings for Flutter local notification scheduling.
- User-level theme preferences for cross-device skin restore.
- A clearer family sharing contract around the existing two-member MVP limit and member removal behavior.

## Goals / Non-Goals

**Goals:**

- Persist reminder settings per family with defaults for families that have never saved settings.
- Persist theme preferences per user with defaults for users that have never saved preferences.
- Preserve the existing direct family-member add/remove endpoints while returning stable business error codes.
- Keep all new APIs protected by the existing bearer auth flow and response envelope conventions.
- Keep runtime OpenAPI and generated docs aligned with the implemented routes and schemas.

**Non-Goals:**

- Do not implement server-side scheduled push delivery, SMS reminders, APNs, FCM, or calendar event creation.
- Do not introduce a job queue, background worker, or external notification provider.
- Do not implement a full invitation lifecycle in this change; the API remains invitation-ready through stable errors and extensible family member contracts.
- Do not change existing child, class, lesson, attendance, leave, or cost behavior except where session invalidation is required after family member removal.

## Decisions

1. Store reminder settings by `familyId`.

   Reminder behavior is a family coordination concern. Both family members should see the same reminder settings, and Flutter remains responsible for whether a specific device has notification permission. The alternative was per-user reminder settings, but that would let one member silently diverge from shared family reminder expectations.

2. Store theme preferences by `userId`.

   Theme skin is a personal visual preference and should not affect another family member. The alternative was a family theme, but that would make one member's UI choice unexpectedly change another member's device.

3. Add explicit store collections instead of embedding optional objects into existing user/family records.

   Separate `reminderSettings` and `themePreferences` collections keep the current user and family payloads backward compatible and fit the existing Map-shaped repository boundary. The alternative was extending `User` and `Family`, but that would mix core identity objects with optional preference state and widen existing API responses.

4. Keep family sharing as direct member management for this backend change.

   The current Flutter service already calls `GET /api/family/members`, `POST /api/family/members`, and `DELETE /api/family/members/:memberId`. This change strengthens that contract with stable error codes and session invalidation after removal. The alternative was introducing invite endpoints now, but that would require additional client flows and expiration semantics beyond the requested backend specification.

5. Invalidate removed members' sessions when a family member is removed.

   Family data access is derived from the authenticated user's current family membership. Removing a member must take effect for existing tokens, not only future logins. The alternative was relying on the next authenticate call to fail only after family lookup changes, but proactively deleting sessions gives cleaner behavior and clearer tests.

## Risks / Trade-offs

- Reminder settings are family-wide while notification permission is device-local -> Flutter must still handle permission-denied states and local scheduling failures.
- Direct member add remains less explicit than an invitation flow -> the API leaves room for future invite endpoints without blocking the current MVP.
- Separate preference collections require persistence updates in every store mode -> tests must cover memory behavior and SQLite restart persistence for at least one preference type.
- Stable error codes may change current generic `BAD_REQUEST` expectations -> update tests and client docs together so Flutter can map errors reliably.

## Migration Plan

- Add new types and store collections with default-read behavior so existing persisted data needs no backfill.
- Extend `StoreSnapshot` and SQLite `kv_store` collection loading for the new collections.
- Add routes and OpenAPI schemas for reminder settings and theme preferences.
- Update family member add/remove business errors without changing endpoint paths.
- Regenerate `docs/openapi.json` and update `docs/api.md`.
- Rollback is safe by removing the new routes and collections; existing core family and lesson data is unaffected.

## Open Questions

- Whether a future invitation flow should replace or sit beside direct member add remains out of scope for this change.
