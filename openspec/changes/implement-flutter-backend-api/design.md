## Context

The backend repository currently only contains OpenSpec configuration. The Flutter app has a complete PRD-aligned domain layer, service interfaces, local persistence, scheduling utilities, and mock implementations for authentication, family sharing, children, classes, lessons, attendance, leave, and cost reporting. The immediate backend need is not a large platform rewrite; it is a production-shaped HTTP API that preserves the Flutter JSON contract and can be swapped from in-memory/mock persistence to LeanCloud or another durable store later.

The first implementation should optimize for fast local integration, clear domain boundaries, and testable business behavior. The API must keep Dart model field names (`camelCase`), enum names (`active`, `weekly`, `scheduled`, etc.), and ISO-8601 date strings so the Flutter side can add HTTP service implementations without model churn.

## Goals / Non-Goals

**Goals:**

- Provide a runnable backend service exposing REST endpoints for the current Flutter service interfaces.
- Preserve compatibility with existing Flutter `domain/models` JSON serialization and PRD business rules.
- Implement deterministic MVP authentication with an SMS adapter boundary for future production SMS delivery.
- Centralize domain logic for schedule generation, class state transitions, check-in/leave side effects, cascade deletion, and cost calculation.
- Use a persistence abstraction so the first implementation can use local storage or in-memory data while remaining replaceable by LeanCloud SDK integration.
- Add focused automated tests for validation, schedule generation, attendance/leave side effects, authorization, and cost calculations.

**Non-Goals:**

- Production SMS vendor integration, payment, push notifications, system calendar sync, or file upload storage.
- Admin console, analytics pipeline, or multi-tenant operations tooling.
- Reworking Flutter domain models as part of this backend change.
- Full LeanCloud migration if the repository does not already contain LeanCloud configuration; only adapter boundaries and compatible domain schema are required.

## Decisions

1. **Expose REST JSON APIs matching Flutter service boundaries.** REST maps directly to the existing service methods and keeps integration simple for mobile clients. GraphQL was considered but would add schema/tooling overhead before the product has query complexity that justifies it.

2. **Use `camelCase` response fields and enum `.name` values.** This avoids custom serializers in Flutter and keeps payloads compatible with existing `fromJson` methods. Snake-case database columns can be hidden behind mappers if introduced later.

3. **Use bearer-token session authentication after phone-code login.** The MVP can accept a deterministic dev code (`123456`) behind environment gating and issue signed opaque tokens or JWTs. Cookie sessions were considered but are less convenient for native mobile clients.

4. **Model family ownership as the authorization boundary.** All child, class, lesson, attendance, leave, and cost queries must be scoped to the authenticated user's current family. This matches the PRD's shared-family model and prevents cross-family data leakage.

5. **Keep schedule generation deterministic and idempotent per class.** Creating or materially updating a class regenerates future scheduled lessons according to `RecurringRule`, excluding suspension periods and preserving historical attended/leave records. Generating on demand only was considered but makes check-in, manual adjustment, and leave extension harder to reason about.

6. **Use derived cost calculations instead of storing mutable report totals.** Monthly reports, breakdowns, trends, and remaining value should be computed from classes and attendance/lesson status. Optional caching can be added later but must be invalidated by attendance, leave, class update, and lesson update events.

7. **Use explicit domain services behind thin route handlers.** Route handlers should handle auth, validation, request parsing, and response formatting, while domain services own class lifecycle, scheduling, attendance, leave, and reporting rules. This keeps future persistence changes contained.

## Risks / Trade-offs

- **Schedule generation edge cases** → Mitigate with unit tests for weekly, monthly, custom interval, end-date, total-hours, suspension, and leave-extension scenarios.
- **Flutter/backend contract drift** → Mitigate by documenting payload shapes in specs and adding response-shape tests using existing Dart field names as fixtures.
- **MVP auth being mistaken for production SMS** → Mitigate by environment-gating dev code behavior and isolating SMS sending behind an adapter interface.
- **In-memory or local-file persistence losing data** → Mitigate by clearly treating it as MVP/dev storage and keeping repository interfaces ready for durable storage.
- **Cascade deletes removing too much data** → Mitigate with family-scoped repository operations and tests proving only related class/lesson/attendance/leave records are deleted.
- **Cost reports becoming slow with larger data** → Mitigate with indexed repository queries and a later cache layer that is derived, invalidatable, and optional.

## Migration Plan

1. Scaffold backend runtime, routing, configuration, error handling, auth middleware, and repository interfaces.
2. Implement in-memory or local persistence repositories and seed-free startup for local Flutter integration.
3. Implement capabilities in dependency order: auth/family, children, classes/schedule, attendance/leave, cost reporting.
4. Add tests and an API smoke script or collection covering the Flutter service method mapping.
5. Update Flutter integration configuration separately to point HTTP services at the backend base URL.
6. Rollback by switching Flutter service locator back to mock services; backend data remains isolated to local/dev storage until durable persistence is introduced.

## Open Questions

- Which concrete backend runtime should be standardized for this repository if no package manifest exists yet: TypeScript/Fastify, TypeScript/Express, or another team default?
- Should MVP persistence be local JSON/SQLite for easier manual inspection, or pure in-memory for faster test iteration?
- What production SMS provider and LeanCloud application credentials will be used after MVP validation?
