## 1. Backend Runtime Setup

- [x] 1.1 Choose and scaffold the backend runtime with package scripts for dev, test, lint, and start
- [x] 1.2 Add configuration loading for environment, port, token secret, dev verification code mode, and storage mode
- [x] 1.3 Implement unified JSON response formatting, error classes, validation error payloads, and request logging
- [x] 1.4 Add auth middleware that parses bearer tokens and attaches current user and family context
- [x] 1.5 Define repository interfaces for users, families, children, classes, lessons, attendance, leave records, sessions, verification codes, and suspension periods
- [x] 1.6 Implement the initial local or in-memory repository backend with deterministic test reset support

## 2. Domain Model And Utilities

- [x] 2.1 Create backend domain types matching Flutter JSON fields and enum names for user, family, child, class, recurring rule, lesson, attendance, leave, and cost models
- [x] 2.2 Implement request validators for phone numbers, child profiles, class payloads, recurring rules, date ranges, and month/year inputs
- [x] 2.3 Implement family-scoped authorization helpers for child, class, lesson, attendance, leave, and cost operations
- [x] 2.4 Implement deterministic schedule generation for weekly, monthly, and custom recurring rules
- [x] 2.5 Implement conflict detection for overlapping lesson windows for the same child
- [x] 2.6 Implement cascade deletion helpers for child and class deletion

## 3. Auth And Family API

- [x] 3.1 Implement verification-code request endpoint with validation, expiry, and rate limiting
- [x] 3.2 Implement phone-code login endpoint that creates or reuses user and family records and returns a session token
- [x] 3.3 Implement current session endpoint returning authenticated user and family
- [x] 3.4 Implement logout endpoint that invalidates the current token
- [x] 3.5 Implement family lookup, member list, add member, and remove member endpoints with two-member MVP limit
- [x] 3.6 Add auth/family tests for first login, existing login, invalid code, missing token, rate limiting, member limit, and last-member removal

## 4. Children API

- [x] 4.1 Implement create child endpoint with Flutter-compatible `Child` response payload
- [x] 4.2 Implement update child endpoint with field validation and family ownership checks
- [x] 4.3 Implement get child and list children endpoints scoped to the authenticated family
- [x] 4.4 Implement delete child endpoint with cascade deletion of child classes, lessons, attendance, and leave records
- [x] 4.5 Add children tests for validation, cross-family access denial, list scoping, and cascade deletion

## 5. Classes And Schedule API

- [x] 5.1 Implement create class endpoint that validates payload, creates an active class, and generates scheduled lessons
- [x] 5.2 Implement get class, list classes, get child classes, active classes, and completed classes endpoints
- [x] 5.3 Implement update class endpoint and regenerate future scheduled lessons when recurring fields change
- [x] 5.4 Implement pause, resume, end, renew, and delete class endpoints with correct lifecycle side effects
- [x] 5.5 Implement generate lessons, class lessons, date-range lessons, today lessons, and upcoming lessons endpoints
- [x] 5.6 Implement manual lesson add, lesson update, and lesson delete endpoints
- [x] 5.7 Implement class suspension set/remove endpoints and apply suspension behavior to future schedule queries
- [x] 5.8 Implement class and lesson conflict-check endpoints
- [x] 5.9 Add schedule tests for weekly, monthly, custom interval, end bounds, total-hours bounds, suspension, manual lesson, status filtering, and same-child conflicts

## 6. Attendance And Leave API

- [x] 6.1 Implement lesson check-in endpoint with idempotent attendance creation and completed lesson update
- [x] 6.2 Implement attendance get, lesson attendance, date-range attendance, and backdated candidate endpoints
- [x] 6.3 Implement leave request endpoint that creates approved leave, marks original lesson leave, and links a makeup lesson when possible
- [x] 6.4 Implement cancel leave endpoint that restores original lesson state and unlinks or removes generated makeup lesson when appropriate
- [x] 6.5 Implement leave get and leave history endpoints with date and child filters
- [x] 6.6 Implement makeup lessons endpoint and monthly attendance statistics endpoint
- [x] 6.7 Add attendance/leave tests for idempotent check-in, backdated eligibility, leave rejection on completed lesson, leave cancellation, makeup listing, and monthly stats

## 7. Cost Reporting API

- [x] 7.1 Implement per-session cost and remaining class value helpers
- [x] 7.2 Implement monthly cost calculation endpoint with optional child and class filters
- [x] 7.3 Implement monthly statistics endpoint returning `MonthlyCostStatistics`
- [x] 7.4 Implement class cost breakdown endpoint with zero-total handling
- [x] 7.5 Implement cost trend endpoint for the last N months
- [x] 7.6 Implement total remaining value endpoint scoped to active and paused classes
- [x] 7.7 Implement CSV export endpoint with headers, date filters, and invalid date-range validation
- [x] 7.8 Add cost tests for per-session math, monthly filters, breakdown percentages, zero totals, trend ordering, remaining value, and CSV output

## 8. Integration And Delivery

- [x] 8.1 Document REST endpoint paths, request bodies, response shapes, auth header, and dev verification-code behavior
- [x] 8.2 Add an API smoke script or collection that covers login, child creation, class creation, lesson query, check-in, leave, and cost report flows
- [x] 8.3 Run unit tests, integration tests, lint, and type checks for the backend
- [x] 8.4 Verify a Flutter-compatible happy path manually by comparing returned JSON fields against existing Dart `fromJson` models
- [x] 8.5 Record remaining productionization gaps for SMS provider, durable LeanCloud persistence, push reminders, and file upload storage
