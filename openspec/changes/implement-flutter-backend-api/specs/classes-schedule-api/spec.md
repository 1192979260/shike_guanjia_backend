## ADDED Requirements

### Requirement: Training class can be created
The system SHALL allow an authenticated family member to create a training class for a child in the authenticated family with PRD-required fields and a valid recurring rule.

#### Scenario: Valid class creates class and lessons
- **WHEN** an authenticated client creates a class with valid institution, class, course, total hours, total fee, start time, and recurring rule
- **THEN** the system creates an `active` training class, generates scheduled lessons up to total hours or end time, and returns the class JSON object

#### Scenario: Invalid class payload is rejected
- **WHEN** required text fields are empty, total hours is not positive, total fee is negative, the child is outside the family, or the recurring rule is invalid
- **THEN** the system returns validation errors and does not create the class or lessons

#### Scenario: Class creation reports non-blocking conflicts
- **WHEN** the new class overlaps an existing class or lesson for the same child
- **THEN** the system allows creation but makes conflict information available through the conflict-check endpoint

### Requirement: Training class lifecycle can be managed
The system SHALL support retrieving, listing, updating, pausing, resuming, ending, renewing, and deleting training classes within the authenticated family.

#### Scenario: List classes with filters
- **WHEN** an authenticated client lists classes with optional `childId` and `status` filters
- **THEN** the system returns only matching classes in the authenticated family

#### Scenario: Pause and resume class
- **WHEN** an authenticated client pauses an active class and later resumes it
- **THEN** the class status changes to `paused` and then back to `active` without losing historical lessons

#### Scenario: End class
- **WHEN** an authenticated client ends a class
- **THEN** the class status changes to `ended` and future scheduled lessons are no longer treated as upcoming active lessons

#### Scenario: Renew class
- **WHEN** an authenticated client renews a class with new total hours and fee
- **THEN** the system creates a new active class record based on the original class context and new package values

#### Scenario: Delete class cascades class records
- **WHEN** an authenticated client deletes a class
- **THEN** the system deletes the class, its lessons, attendance records, leave records, and suspension periods without deleting the child

### Requirement: Lessons are generated from recurring rules
The system SHALL generate lesson records from weekly, monthly, and custom interval recurring rules using ISO date-time values and Flutter-compatible `Lesson` fields.

#### Scenario: Weekly recurring rule generates matching weekdays
- **WHEN** a class has a `weekly` recurring rule with days of week and time slots
- **THEN** the generated lessons occur on those weekdays and use the configured start and end times

#### Scenario: Monthly recurring rule generates nth weekday
- **WHEN** a class has a `monthly` recurring rule with `weekOfMonth`, weekday, and time slot
- **THEN** the generated lessons occur on the configured nth weekday of each eligible month

#### Scenario: Custom interval rule generates interval dates
- **WHEN** a class has a `custom` recurring rule with `customIntervalDays`
- **THEN** the generated lessons occur at the configured day interval from the class start time

#### Scenario: Lesson generation respects bounds
- **WHEN** lessons are generated for a class
- **THEN** generation stops at the class total hours, class end time, or a configured generation horizon, whichever comes first

### Requirement: Lessons can be queried and adjusted
The system SHALL support lesson retrieval by id, class, date range, today, upcoming days, manual addition, update, and deletion within the authenticated family.

#### Scenario: Query lessons in date range
- **WHEN** an authenticated client requests lessons with `familyId`, `start`, `end`, and optional `childId` or `classId`
- **THEN** the system returns lessons in the authenticated family that overlap the requested date range and filters

#### Scenario: Add manual lesson
- **WHEN** an authenticated client adds a manual lesson for a class in its family
- **THEN** the system creates a lesson with `isManual` set to true and returns it

#### Scenario: Update lesson status or date
- **WHEN** an authenticated client updates a lesson's scheduled date, status, or notes
- **THEN** the system persists the update and returns the updated lesson

#### Scenario: Delete lesson
- **WHEN** an authenticated client deletes a lesson in its family
- **THEN** the system removes the lesson and any lesson-specific attendance or leave records

### Requirement: Suspension periods affect future schedules
The system SHALL support adding and removing class suspension periods and SHALL exclude suspended dates from future active schedule results.

#### Scenario: Set suspension period
- **WHEN** an authenticated client sets a suspension start and end date for a class
- **THEN** the system records the suspension and marks or excludes future scheduled lessons in that period from upcoming active lesson queries

#### Scenario: Remove suspension period
- **WHEN** an authenticated client removes a class suspension period
- **THEN** the system restores normal future schedule generation for that class

### Requirement: Schedule conflicts can be checked
The system SHALL detect overlapping lesson time windows for the same child without blocking creation or updates.

#### Scenario: Conflicting lesson is detected
- **WHEN** a class or lesson time overlaps another lesson for the same child
- **THEN** the conflict-check endpoint returns the conflicting classes or lessons

#### Scenario: Different child does not conflict
- **WHEN** two lessons overlap but belong to different children
- **THEN** the conflict-check endpoint does not report them as conflicts for the requested child
