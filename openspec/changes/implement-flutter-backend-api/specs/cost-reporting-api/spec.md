## ADDED Requirements

### Requirement: Per-session and remaining class cost can be calculated
The system SHALL calculate per-session cost as `totalFee / totalHours` and remaining value from unconsumed class hours.

#### Scenario: Calculate per-session cost
- **WHEN** a class has positive `totalHours` and `totalFee`
- **THEN** the system calculates per-session cost as `totalFee` divided by `totalHours`

#### Scenario: Calculate remaining value
- **WHEN** a class has consumed completed lessons
- **THEN** the system calculates remaining value from remaining class hours multiplied by per-session cost

### Requirement: Monthly cost statistics can be calculated
The system SHALL calculate monthly cost statistics for an authenticated family by counting completed lessons and leave lessons in the requested month.

#### Scenario: Calculate monthly cost
- **WHEN** an authenticated client requests monthly cost statistics for a year and month
- **THEN** the system returns `MonthlyCostStatistics` with attended lesson count, leave lesson count, total cost, and calculation timestamp

#### Scenario: Monthly cost supports filters
- **WHEN** an authenticated client requests monthly statistics with optional `childId` or `classId`
- **THEN** the system only includes matching lessons in the authenticated family

### Requirement: Class cost breakdown can be calculated
The system SHALL calculate cost breakdown by class for a requested month and family scope.

#### Scenario: Get class cost breakdown
- **WHEN** an authenticated client requests class cost breakdown for a month
- **THEN** the system returns each class's attended lessons, leave lessons, cost, and percentage of total monthly cost

#### Scenario: Zero monthly cost returns zero percentages
- **WHEN** the requested month has no completed lessons and zero total cost
- **THEN** the system returns zero cost and zero percentages without division errors

### Requirement: Cost trend can be calculated
The system SHALL calculate a cost trend for the last N months for the authenticated family and optional child filter.

#### Scenario: Get six-month trend
- **WHEN** an authenticated client requests a six-month cost trend
- **THEN** the system returns six `CostTrendPoint` entries ordered by month with cost and lesson count

### Requirement: Total remaining value can be calculated
The system SHALL calculate total remaining value across active or paused classes in the authenticated family.

#### Scenario: Get total remaining value
- **WHEN** an authenticated client requests total remaining value
- **THEN** the system sums remaining value across eligible classes in the authenticated family and excludes ended classes unless explicitly documented otherwise

### Requirement: Cost data can be exported as CSV
The system SHALL export cost data as CSV for the authenticated family and optional date range.

#### Scenario: Export cost CSV
- **WHEN** an authenticated client requests cost export with optional start and end dates
- **THEN** the system returns CSV text containing headers and rows for matching class, child, lesson, attendance, and cost data

#### Scenario: Export rejects invalid date range
- **WHEN** the export start date is after the end date
- **THEN** the system returns a validation error and does not generate CSV
