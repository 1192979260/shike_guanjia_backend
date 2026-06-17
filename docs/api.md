# 课时管家 Backend API

## Runtime

- Default base URL: `http://localhost:3000`
- Online debug docs: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/openapi.json`
- Start dev server: `npm run dev`
- Run checks: `npm test && npm run typecheck`
- Default persistence: SQLite at `.data/shike-guanjia.sqlite`.
- Storage override: `STORAGE_MODE=mysql DATABASE_URL=mysql://...` for CloudBase Run / production MySQL, `STORAGE_MODE=memory` for ephemeral test data, or `STORAGE_MODE=file DATA_FILE=.data/shike-guanjia.json` for JSON-file storage. MySQL stores users, families, family members, children, classes, lessons, and auth credentials in normalized tables; secondary records remain in `kv_store`.
- SQLite file override: `SQLITE_FILE=.data/custom.sqlite`
- Auth header: `Authorization: Bearer <token>`
- JSON response envelope: successful JSON endpoints return `{ "data": ... }`; errors return `{ "error": { "code", "message", "fields" } }`.
- Date fields use ISO-8601 strings. Payload field names and enum values intentionally match Flutter `domain/models` serialization.
- Non-production verification code defaults to `123456` via `DEV_VERIFICATION_CODE`. `POST /api/auth/send-code` returns `devCode` outside production.
- `GET /health` is unauthenticated and returns `{ "data": { "ok": true } }`.

## Auth And Family

- `POST /api/auth/send-code` body `{ "phone": "13800138000" }`
- `POST /api/auth/login` body `{ "phone": "13800138000", "code": "123456" }` returns `{ token, user, family }`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/family`
- `GET /api/family/members`
- `POST /api/family/members` body `{ "phone": "13900139000", "relation": "father" }`
- `DELETE /api/family/members/:memberId`

Family sharing errors use stable `error.code` values for Flutter display:

- `FAMILY_MEMBER_LIMIT_REACHED`: current family already has the MVP limit of 2 members.
- `USER_ALREADY_IN_FAMILY`: the phone number already belongs to a user in the current family.
- `CANNOT_REMOVE_LAST_MEMBER`: the request would remove the final family member.
- Removing a member invalidates that user's active sessions.

## Preferences

- `GET /api/reminder-settings` returns family-level reminder settings. If no settings were saved, defaults are returned: `{ "enabled": true, "advanceMinutes": 60, "includeTodayLessons": true, "includeMakeupLessons": true }`.
- `PATCH /api/reminder-settings` accepts partial updates:

```json
{
  "enabled": true,
  "advanceMinutes": 60,
  "includeTodayLessons": true,
  "includeMakeupLessons": true
}
```

`advanceMinutes` must be one of `15`, `30`, `60`, `120`, or `1440`.

- `GET /api/preferences/theme` returns the current user's theme preference. If no preference was saved, the default is `{ "skin": "warm" }`.
- `PATCH /api/preferences/theme` body `{ "skin": "fresh" }`; `skin` must be `warm`, `fresh`, or `classic`.

## Children

- `POST /api/children` body `{ "name": "小宝", "age": 6, "avatarUrl": null }`
- `GET /api/children`
- `GET /api/children/:childId`
- `GET /api/children/:childId/classes`
- `PATCH /api/children/:childId`
- `DELETE /api/children/:childId` cascades related classes, lessons, attendance, leave, and suspensions.

## Classes And Lessons

- `POST /api/classes` creates an active class and generated lessons.
- `GET /api/classes?childId=<id>&status=active`
- `GET /api/classes/active`
- `GET /api/classes/completed`
- `GET /api/classes/:classId`
- `PATCH /api/classes/:classId`
- `DELETE /api/classes/:classId`
- `POST /api/classes/:classId/pause`
- `POST /api/classes/:classId/resume`
- `POST /api/classes/:classId/end`
- `POST /api/classes/:classId/renew` body `{ "newTotalHours": 20, "newTotalFee": 3000 }`
- `POST /api/classes/:classId/generate-lessons`
- `GET /api/classes/:classId/lessons`
- `GET /api/classes/:classId/conflicts`
- `GET /api/lessons/range?start=<iso>&end=<iso>&childId=<id>&classId=<id>`
- `GET /api/lessons/today`
- `GET /api/lessons/upcoming?days=3&childId=<id>&classId=<id>` returns scheduled lessons only; `days` is clamped to 1-30.
- `POST /api/lessons/manual` body `{ "classId": "...", "scheduledDate": "2026-06-15T09:00:00.000Z", "scheduledEndDate": "2026-06-15T10:00:00.000Z" }`; if `scheduledEndDate` is omitted, the backend infers it from the class time slot duration.
- `GET /api/lessons/:lessonId`
- `PATCH /api/lessons/:lessonId` supports `{ "scheduledDate", "scheduledEndDate", "status", "notes" }`. Changing `scheduledDate` shifts `scheduledEndDate` by the original lesson duration when no explicit end is provided. Completed lessons cannot change scheduled time.
- `DELETE /api/lessons/:lessonId`
- `GET /api/lessons/:lessonId/conflicts`
- `POST /api/suspensions` body `{ "classId": "...", "start": "...", "end": "..." }`
- `DELETE /api/classes/:classId/suspensions`

### Class Create Example

```json
{
  "childId": "child-id",
  "institutionName": "星星美术",
  "className": "大班A",
  "courseName": "美术启蒙",
  "teacherName": "王老师",
  "teacherPhone": "13800138000",
  "totalHours": 20,
  "usedHours": 0,
  "totalFee": 3000,
  "startTime": "2026-06-15T09:00:00.000Z",
  "endTime": null,
  "recurringRule": {
    "type": "weekly",
    "daysOfWeek": [1],
    "timeSlots": [{ "dayOfWeek": 1, "startHour": 9, "startMinute": 0, "endHour": 10, "endMinute": 0 }],
    "weekOfMonth": 1,
    "customIntervalDays": null
  },
  "notes": null
}
```

## Attendance And Leave

- `POST /api/attendance/check-in` body `{ "lessonId": "...", "type": "checkin", "actualStartTime": null, "actualEndTime": null, "notes": "表现很好" }`
  - `type=checkin` is allowed from 15 minutes before scheduled start through 2 hours after scheduled end.
  - Too-early attempts return `CHECKIN_TOO_EARLY` with `fields.allowedFrom`; late normal attempts return `CHECKIN_REQUIRES_BACKDATED`.
  - `type=backdated` is for past lessons and supports `actualStartTime`/`actualEndTime`; historical backfill after 7 days requires `notes`.
- `POST /api/attendance/lessons/:lessonId/cancel` cancels a mistaken check-in, deletes that lesson's attendance record, restores the lesson to `scheduled`, and returns the consumed class hour.
- `GET /api/attendance?start=<iso>&end=<iso>&childId=<id>&classId=<id>`
- `GET /api/attendance?lessonId=<id>`
- `GET /api/attendance/backdated` returns scheduled, unchecked lessons from the last 7 days with child/class/course display fields.
- `GET /api/attendance/stats?year=2026&month=6&childId=<id>`
- `GET /api/attendance/:attendanceId`
- `POST /api/leaves` body `{ "lessonId": "...", "reason": "生病" }`
- `POST /api/leaves/:leaveId/cancel`
- `GET /api/leaves/:leaveId`
- `GET /api/leaves/history?childId=<id>&startDate=<iso>&endDate=<iso>`
- `GET /api/leaves/makeup-lessons`

## Cost Reporting

- `GET /api/cost/monthly?year=2026&month=6&childId=<id>&classId=<id>`
- `GET /api/cost/statistics?year=2026&month=6`
- `GET /api/cost/breakdown?year=2026&month=6&childId=<id>`
- `GET /api/cost/trend?months=6&childId=<id>`
- `GET /api/cost/remaining-value`
- `GET /api/cost/export.csv?startDate=<iso>&endDate=<iso>`

## Productionization Gaps

- Replace deterministic dev verification code with a production SMS provider adapter.
- Add production migration/backup tooling around the current SQLite key-value store, or replace it with LeanCloud/database repositories.
- Add push reminders, system calendar integration, avatar/file upload storage, and operational monitoring.
