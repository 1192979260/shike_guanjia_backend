## ADDED Requirements

### Requirement: Lesson check-in records attendance
The system SHALL allow an authenticated family member to check in or backfill attendance for a lesson in the authenticated family and update the lesson/class progress consistently.

#### Scenario: Check in scheduled lesson
- **WHEN** an authenticated client checks in a scheduled lesson with type `checkin`
- **THEN** the system creates an attendance record, marks the lesson `completed`, and increments consumed class hours exactly once

#### Scenario: Duplicate check-in is idempotent
- **WHEN** an authenticated client checks in a lesson that already has an attendance record
- **THEN** the system returns the existing or updated attendance record without double-counting consumed hours

#### Scenario: Backdated attendance is allowed for past lesson
- **WHEN** an authenticated client records attendance for an eligible past lesson
- **THEN** the system records attendance with type `backdated` and marks the lesson completed

### Requirement: Attendance can be queried
The system SHALL support retrieving attendance by id, by lesson, by date range, and listing backdated-eligible lessons for the authenticated family.

#### Scenario: Get attendance in date range
- **WHEN** an authenticated client requests attendance with `familyId`, `start`, `end`, and optional child/class filters
- **THEN** the system returns only matching attendance records in the authenticated family

#### Scenario: Get backdated attendance candidates
- **WHEN** an authenticated client requests backdated attendance candidates
- **THEN** the system returns past lessons within the configured backfill window that have no attendance or leave record

### Requirement: Leave request updates lesson and creates makeup lesson
The system SHALL allow an authenticated family member to request leave for an upcoming lesson, mark the original lesson as leave, and create or link a makeup lesson according to the next available recurrence.

#### Scenario: Request leave for upcoming lesson
- **WHEN** an authenticated client requests leave for a scheduled lesson with an optional reason
- **THEN** the system creates a leave record with status `approved`, marks the lesson `leave`, and links a makeup lesson when one can be generated

#### Scenario: Leave request for completed lesson is rejected
- **WHEN** an authenticated client requests leave for a completed lesson
- **THEN** the system returns a validation error and does not create a leave record

### Requirement: Leave can be cancelled and queried
The system SHALL support cancelling leave, retrieving a leave record, and listing leave history for the authenticated family.

#### Scenario: Cancel approved leave
- **WHEN** an authenticated client cancels an approved leave record
- **THEN** the system marks the leave record `cancelled`, restores the original lesson to `scheduled` when appropriate, and removes or unlinks the generated makeup lesson

#### Scenario: Query leave history
- **WHEN** an authenticated client requests leave history with optional child and date filters
- **THEN** the system returns matching leave records in descending request time or another documented stable order

### Requirement: Makeup lessons can be listed
The system SHALL allow an authenticated client to list makeup lessons for the authenticated family.

#### Scenario: List makeup lessons
- **WHEN** an authenticated client requests makeup lessons
- **THEN** the system returns lessons linked from approved leave records or marked as makeup lessons in the authenticated family

### Requirement: Attendance statistics can be calculated
The system SHALL calculate monthly attendance statistics by family, year, month, and optional child filter.

#### Scenario: Calculate monthly attendance stats
- **WHEN** an authenticated client requests attendance statistics for a month
- **THEN** the system returns total lessons, attended lessons, leave lessons, missed lessons, attendance rate, and leave rate for the requested scope
