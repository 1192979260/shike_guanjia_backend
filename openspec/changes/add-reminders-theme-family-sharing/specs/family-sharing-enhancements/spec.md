## ADDED Requirements

### Requirement: Stable family member limit error
The system SHALL enforce the MVP two-member family limit with a stable business error code.

#### Scenario: Reject third family member
- **WHEN** an authenticated user requests `POST /api/family/members` for a family that already has two members
- **THEN** the system rejects the request with error code `FAMILY_MEMBER_LIMIT_REACHED`

### Requirement: Stable duplicate family member error
The system SHALL reject adding a user who already belongs to the authenticated family with a stable business error code.

#### Scenario: Reject duplicate family member
- **WHEN** an authenticated user requests `POST /api/family/members` with a phone number for a user already in the same family
- **THEN** the system rejects the request with error code `USER_ALREADY_IN_FAMILY`

### Requirement: Stable last member removal error
The system SHALL prevent removing the final member from a family with a stable business error code.

#### Scenario: Reject removing final member
- **WHEN** an authenticated user requests `DELETE /api/family/members/:memberId` and the family has only one member
- **THEN** the system rejects the request with error code `CANNOT_REMOVE_LAST_MEMBER`

### Requirement: Removed member access revocation
The system SHALL revoke a removed member's access to the original family data.

#### Scenario: Removed member token cannot access family data
- **WHEN** a family member is removed from a family
- **THEN** existing sessions for the removed user are invalidated and subsequent requests with those tokens fail with `UNAUTHORIZED`

### Requirement: Family sharing endpoint compatibility
The system SHALL keep the existing family sharing endpoint paths and response envelope conventions.

#### Scenario: Existing family member APIs remain available
- **WHEN** an authenticated Flutter client calls `GET /api/family`, `GET /api/family/members`, `POST /api/family/members`, or `DELETE /api/family/members/:memberId`
- **THEN** the system serves the request using the existing path and the standard success or error envelope

### Requirement: Invitation-ready family sharing contract
The system SHALL reserve stable invitation-related error semantics for future invite flows without requiring invite endpoints in this change.

#### Scenario: No invite endpoint required for current implementation
- **WHEN** this change is implemented
- **THEN** family sharing continues to add members through `POST /api/family/members` and does not require `POST /api/family/invites`
