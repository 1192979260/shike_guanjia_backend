## Why

The backend already supports the core 课时管家 flows, but upcoming Flutter iterations need server-backed preferences and a clearer family sharing contract. Persisting reminder settings, theme preferences, and family sharing behavior now gives the client stable APIs for cross-device sync while preserving the existing family authorization boundary.

## What Changes

- Add family-level lesson reminder settings that Flutter can read and update before scheduling local notifications.
- Add user-level theme preference APIs so theme selection can survive login on another device.
- Enhance the family sharing contract with explicit member limits, stable error codes, member removal rules, and an invitation-ready path.
- Keep all new payloads compatible with current API conventions: `camelCase` fields, string enums, ISO-8601 dates, bearer auth, `{ data }` success envelopes, and structured `{ error }` failures.
- No server-side scheduled push delivery is introduced; Flutter remains responsible for notification permission handling and local notification scheduling.

## Capabilities

### New Capabilities

- `lesson-reminder-settings`: Covers authenticated family reminder preferences, default settings, update validation, and cross-device retrieval for local notification scheduling.
- `theme-preferences`: Covers authenticated user theme preference retrieval and update with stable theme skin enum values.
- `family-sharing-enhancements`: Covers the existing two-member family sharing contract, explicit error behavior, removal constraints, and invitation-ready API requirements.

### Modified Capabilities

## Impact

- Affected backend: domain types, store collections, application service rules, HTTP routes, validation, OpenAPI runtime source, generated docs, and API tests.
- Affected API clients: Flutter can add reminder settings, theme selection, and improved family sharing screens without inventing local-only contracts.
- Affected data model: reminder settings are scoped by `familyId`; theme preferences are scoped by `userId`; family sharing continues to scope core business data by authenticated family.
- Compatibility: existing auth, family, children, classes, lessons, attendance, leave, and cost APIs must continue to behave as they do today.
