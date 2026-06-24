# 课时管家 Backend API

## Runtime

- Default base URL: `http://localhost:3000`
- Online debug docs: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/openapi.json`
- Start dev server: `npm run dev`
- Run checks: `npm test && npm run typecheck`
- Default persistence: MySQL via `DATABASE_URL`.
- Storage override: `STORAGE_MODE=mysql DATABASE_URL=mysql://...` for CloudBase Run / production MySQL, `STORAGE_MODE=memory` for ephemeral test data, or `STORAGE_MODE=file DATA_FILE=.data/shike-guanjia.json` for JSON-file storage. MySQL stores product records in dedicated tables and migrates legacy `kv_store` data on startup before dropping the legacy table.
- Auth header: `Authorization: Bearer <token>`
- JSON response envelope: successful JSON endpoints return `{ "data": ... }`; errors return `{ "error": { "code", "message", "fields" } }`.
- Date fields use ISO-8601 strings. Payload field names and enum values intentionally match app `domain/models` serialization.
- `GET /health` is unauthenticated and returns `{ "data": { "ok": true } }`; `GET /health/ready` also probes MySQL readiness and returns 503 when the database is unavailable.
- Mutation requests can send `Idempotency-Key: <uuid>`; duplicate successful requests with the same user/method/path/key return the cached result for 10 minutes instead of executing the write again.

## Auth And Family

- `POST /api/auth/wechat-phone-login` body `{ "loginCode": "<wx-login-code>", "phoneCode": "<getPhoneNumber-code>" }` returns `{ token, user, family }`. Non-production may pass `{ "phone": "13800138000", "openid": "debug-openid" }` for local testing.
- `GET /api/auth/register-context?phone=13900139000` returns `{ "phone": "13900139000", "invited": true, "relation": "father" }` when the phone number is already an invited family member; clients should lock the registration role to that value.
- `POST /api/auth/register` body `{ "phone": "13800138000", "password": "password123", "relation": "mother" }` creates the first family member as `mother` or `father`; `relation` is optional and defaults to `mother`. If the phone number was already invited through `POST /api/family/members`, the server ignores the submitted `relation` and forces the invited member relation.
- `POST /api/auth/login` is the legacy phone-password compatibility login endpoint.
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/auth/wechat-session` body `{ "code": "<wx-login-code>" }` binds the current user to a WeChat openid. Non-production may pass `{ "openid": "debug-openid" }` for local testing.
- `GET /api/family`
- `GET /api/family/members` returns members with `phone` and `status`; `status: "pending"` means the invited phone has not registered yet, and `status: "active"` means the member has completed registration.
- `POST /api/family/members` body `{ "phone": "13900139000", "relation": "father" }`
- `DELETE /api/family/members/:memberId`

Family sharing errors use stable `error.code` values for Flutter display:

- `FAMILY_MEMBER_LIMIT_REACHED`: current family already has the MVP limit of 2 members.
- `USER_ALREADY_IN_FAMILY`: the phone number already belongs to a user in the current family.
- `USER_ALREADY_IN_OTHER_FAMILY`: the phone number already belongs to another family and cannot be invited into the current family.
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
- `POST /api/reminder-subscriptions` body `{ "templateId": "...", "lessonIds": ["lesson-id"], "advanceMinutes": 60, "page": "/pages/class-detail/index?classId=..." }` records a WeChat subscription-message authorization for one scheduled lesson. The user must first bind a WeChat openid and enable reminders.

## Children

- `POST /api/children` body `{ "name": "小宝", "gender": "female", "color": "#BE6B45", "age": 6, "avatarUrl": null }`; `gender` is optional and may be `male`, `female`, or `null`; `color` is optional and must be one of the configured child marker colors.
- `GET /api/children?page=1&pageSize=20`
- `GET /api/children/:childId`
- `GET /api/children/:childId/classes`
- `PATCH /api/children/:childId`
- `DELETE /api/children/:childId` cascades related classes, lessons, attendance, leave, and suspensions.

## Classes And Lessons

- `POST /api/classes` creates an active class and generated lessons.
- `GET /api/classes?childId=<id>&status=active&page=1&pageSize=20`
- `GET /api/classes/active`
- `GET /api/classes/completed`
- `GET /api/classes/:classId`
- `PATCH /api/classes/:classId`
- `DELETE /api/classes/:classId`
- `POST /api/classes/:classId/pause`
- `POST /api/classes/:classId/resume`
- `POST /api/classes/:classId/end`
- `POST /api/classes/:classId/renew` body `{ "newTotalHours": 20, "newTotalFee": 3000 }`
- `PATCH /api/classes/:classId/schedule-rule` updates the class recurring rule/start time and regenerates future scheduled lessons.
- `POST /api/classes/:classId/generate-lessons`
- `POST /api/classes/:classId/regenerate-lessons` is a compatibility alias for generation.
- `GET /api/classes/:classId/lessons`
- `GET /api/classes/:classId/lesson-change-records`
- `GET /api/classes/:classId/conflicts`
- `GET /api/lessons/range?start=<iso>&end=<iso>&childId=<id>&classId=<id>&page=1&pageSize=20`
- `GET /api/lessons/today`
- `GET /api/lessons/home` returns `{ todayLessons, needsBackfillLessons }` for home-page loading.
- `GET /api/lessons/upcoming?days=3&childId=<id>&classId=<id>` returns scheduled lessons only; `days` is clamped to 1-30.
- `POST /api/lessons/manual` body `{ "classId": "...", "scheduledDate": "2026-06-15T09:00:00.000Z", "scheduledEndDate": "2026-06-15T10:00:00.000Z" }`; if `scheduledEndDate` is omitted, the backend infers it from the class time slot duration.
- `GET /api/lessons/:lessonId`
- `PATCH /api/lessons/:lessonId` supports `{ "scheduledDate", "scheduledEndDate", "status", "notes" }`. Changing `scheduledDate` shifts `scheduledEndDate` by the original lesson duration when no explicit end is provided. Completed lessons cannot change scheduled time.
- `POST /api/lessons/:lessonId/reschedule` body `{ "newScheduledDate": "...", "newScheduledEndDate": "...", "reason": "...", "description": "..." }` creates a lesson-change record and moves the lesson.
- `POST /api/lessons/:lessonId/leave` body `{ "scheduledDate": "...", "scheduledEndDate": "...", "reason": "..." }` requests leave and records the replacement time; `newScheduledDate`/`newScheduledEndDate` are also accepted.
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
  "icon": "palette",
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
- `POST /api/lessons/backfill-check-in` body `{ "lessonId": "...", "actualStartTime": "...", "actualEndTime": "...", "notes": "..." }` is a compatibility endpoint that forces `type=backdated`.
- `POST /api/attendance/lessons/:lessonId/cancel` cancels a mistaken check-in, deletes that lesson's attendance record, restores the lesson to `scheduled`, and returns the consumed class hour.
- `GET /api/attendance?start=<iso>&end=<iso>&childId=<id>&classId=<id>&page=1&pageSize=20`
- `GET /api/attendance?lessonId=<id>`
- `GET /api/attendance/backdated` returns scheduled, unchecked lessons from the last 7 days with child/class/course display fields.
- `GET /api/attendance/stats?year=2026&month=6&childId=<id>`
- `GET /api/attendance/:attendanceId`
- `POST /api/leaves` body `{ "lessonId": "...", "reason": "生病", "scheduledDate": "...", "scheduledEndDate": "..." }`
- `POST /api/leaves/:leaveId/cancel`
- `GET /api/leaves/:leaveId`
- `GET /api/leaves/history?childId=<id>&startDate=<iso>&endDate=<iso>&page=1&pageSize=20`
- `GET /api/leaves/makeup-lessons`
- `POST /api/lesson-changes` body `{ "lessonId": "...", "type": "reschedule", "newScheduledDate": "...", "newScheduledEndDate": "...", "source": "other", "reason": "..." }`
- `GET /api/lesson-changes/history?childId=<id>&classId=<id>&startDate=<iso>&endDate=<iso>&page=1&pageSize=20`
- `POST /api/lesson-changes/:changeId/cancel`
- `POST /api/lesson-change-records/:changeId/revoke` is a compatibility alias for cancelling a change record.

## Cost Reporting

- `GET /api/cost/monthly?year=2026&month=6&childId=<id>&classId=<id>`
- `GET /api/cost/statistics?year=2026&month=6`
- `GET /api/cost/breakdown?year=2026&month=6&childId=<id>`
- `GET /api/cost/trend?months=6&childId=<id>`
- `GET /api/cost/remaining-value`
- `GET /api/cost/export.csv?startDate=<iso>&endDate=<iso>`

## Productionization Gaps

- AppService is still a large domain-service class; split it into auth, class, lesson, attendance, cost, reminder, and WeChat services as the next maintainability iteration.
- Convert synchronous `scryptSync` password operations to async `scrypt` or a worker when login throughput becomes material.
- Add `/api/v1` versioned routes through a coordinated frontend/backend release.
- Add production backup/restore runbooks, operational dashboards, and alerting around MySQL and reminder delivery.
