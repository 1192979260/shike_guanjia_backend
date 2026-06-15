## ADDED Requirements

### Requirement: Child profile can be created
The system SHALL allow an authenticated family member to create a child profile with `name`, optional `age`, optional `avatarUrl`, and the authenticated family scope.

#### Scenario: Valid child profile is created
- **WHEN** an authenticated client submits a non-empty child name and valid optional age
- **THEN** the system creates the child under the authenticated family and returns a `Child` JSON object

#### Scenario: Invalid child profile is rejected
- **WHEN** the child name is empty, longer than 50 characters, or age is outside 0 through 18
- **THEN** the system returns field validation errors and does not create the child

### Requirement: Child profile can be updated
The system SHALL allow an authenticated family member to update only children belonging to the authenticated family.

#### Scenario: Existing family child is updated
- **WHEN** an authenticated client updates `name`, `age`, or `avatarUrl` for a child in its family with valid values
- **THEN** the system persists the changes and returns the updated `Child` JSON object

#### Scenario: Cross-family child update is forbidden
- **WHEN** an authenticated client attempts to update a child outside its family
- **THEN** the system returns a not-found or forbidden error without changing the child

### Requirement: Children can be retrieved by family
The system SHALL allow an authenticated family member to retrieve one child by id or list all children for the authenticated family.

#### Scenario: List family children
- **WHEN** an authenticated client requests the child list
- **THEN** the system returns all children whose `familyId` matches the authenticated family and no children from other families

#### Scenario: Get child by id
- **WHEN** an authenticated client requests a child id belonging to its family
- **THEN** the system returns the matching `Child` JSON object

### Requirement: Child deletion cascades related records
The system SHALL allow an authenticated family member to delete a child and SHALL cascade delete that child's classes, generated lessons, attendance records, and leave records.

#### Scenario: Delete child with related data
- **WHEN** an authenticated client deletes a child that has classes, lessons, attendance records, and leave records
- **THEN** the system removes the child and all related records while leaving unrelated family data intact

#### Scenario: Delete missing child returns false-compatible result
- **WHEN** an authenticated client attempts to delete a child id that does not exist in its family
- **THEN** the system returns a not-found error or `success: false` response compatible with the client contract
