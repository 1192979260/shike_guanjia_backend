## ADDED Requirements

### Requirement: Phone verification code can be requested
The system SHALL allow a client to request a login verification code for a valid phone number and SHALL rate-limit repeated requests per phone number.

#### Scenario: Valid phone requests code
- **WHEN** a client submits a valid phone number to request a verification code
- **THEN** the system records a pending verification code and returns a successful response without exposing the code in production mode

#### Scenario: Invalid phone is rejected
- **WHEN** a client submits an invalid phone number to request a verification code
- **THEN** the system returns a validation error and does not create a pending verification code

#### Scenario: Repeated code requests are rate limited
- **WHEN** a phone number exceeds the configured request limit within the configured time window
- **THEN** the system returns a rate-limit error and does not create a new verification code

### Requirement: User can login with phone verification code
The system SHALL authenticate a user with a valid phone verification code, create the user and default family on first login, and return an authenticated session token.

#### Scenario: First login creates user and family
- **WHEN** a valid phone number and valid verification code are submitted for a phone with no existing user
- **THEN** the system creates a user, creates a family with the user as `mother`, and returns the user, family, and session token

#### Scenario: Existing user login reuses family
- **WHEN** a valid phone number and verification code are submitted for an existing family member
- **THEN** the system returns the existing user, associated family, and a fresh session token

#### Scenario: Invalid or expired code is rejected
- **WHEN** the verification code is missing, wrong, or expired
- **THEN** the system returns an authentication error and does not issue a session token

### Requirement: Authenticated client can access session identity
The system SHALL allow an authenticated client to retrieve its current user and family identity using a bearer session token.

#### Scenario: Valid token returns current session
- **WHEN** a request includes a valid bearer token
- **THEN** the system returns the current user and current family using Flutter-compatible JSON fields

#### Scenario: Missing token is unauthorized
- **WHEN** a protected endpoint is called without a bearer token
- **THEN** the system returns an unauthorized error

### Requirement: User can logout
The system SHALL allow an authenticated client to invalidate its current session token.

#### Scenario: Logout invalidates token
- **WHEN** an authenticated client logs out
- **THEN** the system invalidates the session token and later protected requests with that token are unauthorized

### Requirement: Family members can be managed
The system SHALL support family lookup, member listing, adding one additional family member, and removing non-final members within the authenticated user's family.

#### Scenario: Add second family member
- **WHEN** an authenticated user adds a valid phone number with relation `father` or `mother` and the family has fewer than two members
- **THEN** the system creates or reuses the target user, adds a family member, and returns the new member

#### Scenario: Family member limit is enforced
- **WHEN** an authenticated user adds a member to a family that already has two members
- **THEN** the system returns a validation error and does not add the member

#### Scenario: Last family member cannot be removed
- **WHEN** an authenticated user attempts to remove the only remaining family member
- **THEN** the system returns a validation error and keeps the member
