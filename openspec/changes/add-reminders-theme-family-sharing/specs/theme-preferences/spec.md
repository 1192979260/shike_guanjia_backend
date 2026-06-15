## ADDED Requirements

### Requirement: User theme preference defaults
The system SHALL provide a theme preference for the authenticated user, returning the default theme when no preference has been saved.

#### Scenario: Read default theme preference
- **WHEN** an authenticated user requests `GET /api/preferences/theme` without a saved theme preference
- **THEN** the response data includes the authenticated `userId`, `skin: "warm"`, and an ISO-8601 `updatedAt`

### Requirement: User theme preference update
The system SHALL allow authenticated users to update only their own theme preference.

#### Scenario: Update theme preference
- **WHEN** an authenticated user requests `PATCH /api/preferences/theme` with `skin: "fresh"` or `skin: "classic"`
- **THEN** the system persists the preference for the authenticated user and returns the updated preference in the standard `{ data }` envelope

#### Scenario: Preserve theme preference after logout
- **WHEN** a user updates their theme preference, logs out, logs back in, and requests `GET /api/preferences/theme`
- **THEN** the system returns the user's previously saved theme preference

### Requirement: Theme preference validation
The system SHALL only accept supported theme skin enum values.

#### Scenario: Reject invalid theme skin
- **WHEN** an authenticated user requests `PATCH /api/preferences/theme` with a `skin` value other than `warm`, `fresh`, or `classic`
- **THEN** the system rejects the request with a structured error containing a field entry for `skin`

### Requirement: Theme preference authorization
The system SHALL protect theme preference APIs with bearer authentication and scope data by authenticated user.

#### Scenario: Reject anonymous theme preference access
- **WHEN** a request to `GET /api/preferences/theme` or `PATCH /api/preferences/theme` does not include a valid bearer token
- **THEN** the system rejects the request with `UNAUTHORIZED`

#### Scenario: Do not share theme preference across family members
- **WHEN** two users belong to the same family and one user updates their theme preference
- **THEN** the other user's `GET /api/preferences/theme` response remains their own default or saved preference
