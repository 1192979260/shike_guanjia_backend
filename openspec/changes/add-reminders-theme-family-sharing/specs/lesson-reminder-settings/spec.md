## ADDED Requirements

### Requirement: Family reminder settings defaults
The system SHALL provide lesson reminder settings for the authenticated user's family, returning default settings when no settings have been saved.

#### Scenario: Read default reminder settings
- **WHEN** an authenticated user requests `GET /api/reminder-settings` for a family with no saved reminder settings
- **THEN** the response data includes `enabled: true`, `advanceMinutes: 60`, `includeTodayLessons: true`, `includeMakeupLessons: true`, the authenticated `familyId`, and an ISO-8601 `updatedAt`

### Requirement: Family reminder settings update
The system SHALL allow authenticated users to update reminder settings for their own family.

#### Scenario: Update reminder settings
- **WHEN** an authenticated user requests `PATCH /api/reminder-settings` with valid reminder fields
- **THEN** the system persists the settings for the authenticated family and returns the updated settings in the standard `{ data }` envelope

#### Scenario: Retrieve updated reminder settings across sessions
- **WHEN** a family member updates reminder settings and another authenticated session from the same family requests `GET /api/reminder-settings`
- **THEN** the second session receives the latest saved family reminder settings

### Requirement: Reminder settings validation
The system SHALL validate reminder settings fields before persisting updates.

#### Scenario: Reject invalid advance minutes
- **WHEN** an authenticated user requests `PATCH /api/reminder-settings` with an `advanceMinutes` value outside `15`, `30`, `60`, `120`, or `1440`
- **THEN** the system rejects the request with a structured error containing a field entry for `advanceMinutes`

#### Scenario: Preserve omitted reminder fields
- **WHEN** an authenticated user requests `PATCH /api/reminder-settings` with only one valid setting field
- **THEN** the system updates that field and preserves the previous or default values for omitted fields

### Requirement: Reminder settings authorization
The system SHALL scope reminder settings to the authenticated family and protect the endpoint with bearer authentication.

#### Scenario: Reject anonymous reminder settings access
- **WHEN** a request to `GET /api/reminder-settings` or `PATCH /api/reminder-settings` does not include a valid bearer token
- **THEN** the system rejects the request with `UNAUTHORIZED`

#### Scenario: Do not expose other family reminder settings
- **WHEN** a user from one family reads reminder settings
- **THEN** the response contains only that user's authenticated `familyId` settings
