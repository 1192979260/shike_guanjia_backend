import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { Config } from "./config.js";
import { nowLocalIso, toLocalIso } from "./date-time.js";
import {
  badRequest,
  businessError,
  forbidden,
  notFound,
  unauthorized,
} from "./errors.js";
import { generateLessonsForClass, nextLessonAfter } from "./schedule.js";
import { MemoryStore } from "./store.js";
import type {
  Attendance,
  ClassCostBreakdown,
  CostTrendPoint,
  FamilyMember,
  LeaveRecord,
  Lesson,
  LessonChangeRecord,
  LessonChangeSource,
  LessonChangeType,
  MonthlyCostStatistics,
  ReminderSettings,
  ThemePreference,
  TrainingClass,
  User,
} from "./types.js";
import {
  assertChildInput,
  assertDateRange,
  assertIsoDate,
  assertMonth,
  assertPassword,
  assertPhone,
  assertRecurringRule,
  assertString,
  assertThemeSkin,
  optionalBoolean,
  optionalReminderAdvanceMinutes,
  optionalString,
} from "./validation.js";

const CHECKIN_EARLY_WINDOW_MS = 15 * 60 * 1000;
const CHECKIN_LATE_WINDOW_MS = 2 * 60 * 60 * 1000;
const BACKDATED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthContext {
  user: User;
  familyId: string;
}

export class AppService {
  constructor(
    public store: MemoryStore,
    private config: Config,
  ) {}

  register(phoneValue: unknown, passwordValue: unknown) {
    const phone = assertPhone(phoneValue);
    const password = assertPassword(passwordValue);
    if (this.store.authCredentials.has(phone))
      throw badRequest("Phone already registered", [
        { field: "phone", message: "该手机号已注册" },
      ]);
    const { user, family } = this.ensureUserAndFamily(phone);
    this.store.authCredentials.set(phone, hashPassword(phone, password));
    const token = this.issueToken(user.id);
    return { token, user, family };
  }

  login(phoneValue: unknown, passwordValue: unknown) {
    const phone = assertPhone(phoneValue);
    const password = assertPassword(passwordValue);
    const credential = this.store.authCredentials.get(phone);
    if (!credential || !verifyPassword(password, credential)) {
      throw unauthorized("Invalid phone or password");
    }
    const user = [...this.store.users.values()].find(
      (item) => item.phone === phone,
    );
    if (!user) throw unauthorized("Invalid phone or password");
    const family = this.ensureFamily(user);
    const token = this.issueToken(user.id);
    return { token, user, family };
  }

  private ensureUserAndFamily(phone: string) {
    let user = [...this.store.users.values()].find(
      (item) => item.phone === phone,
    );
    if (!user) {
      user = {
        id: this.store.id(),
        phone,
        nickname: null,
        avatarUrl: null,
        createdAt: nowIso(),
      };
      this.store.users.set(user.id, user);
    }
    const family = this.ensureFamily(user);
    return { user, family };
  }

  private ensureFamily(user: User) {
    let family = [...this.store.families.values()].find((item) =>
      item.members.some((member) => member.userId === user.id),
    );
    if (!family) {
      const member: FamilyMember = {
        id: this.store.id(),
        userId: user.id,
        relation: "mother",
        displayName: user.nickname ?? null,
        createdAt: nowIso(),
      };
      family = {
        id: this.store.id(),
        name: `${user.phone.slice(-4)}的家庭`,
        members: [member],
      };
      this.store.families.set(family.id, family);
    }
    return family;
  }

  authenticate(header: string | undefined): AuthContext {
    const token = header?.startsWith("Bearer ")
      ? header.slice("Bearer ".length)
      : undefined;
    if (!token) throw unauthorized();
    const session = this.store.sessions.get(token);
    if (!session) throw unauthorized();
    const user = this.store.users.get(session.userId);
    if (!user) throw unauthorized();
    const family = [...this.store.families.values()].find((item) =>
      item.members.some((member) => member.userId === user.id),
    );
    if (!family) throw unauthorized("Family not found");
    return { user, familyId: family.id };
  }

  me(ctx: AuthContext) {
    return { user: ctx.user, family: this.requireFamily(ctx.familyId) };
  }

  logout(tokenHeader: string | undefined) {
    const token = tokenHeader?.startsWith("Bearer ")
      ? tokenHeader.slice("Bearer ".length)
      : undefined;
    if (token) this.store.sessions.delete(token);
    return { success: true };
  }

  getFamily(ctx: AuthContext) {
    return this.requireFamily(ctx.familyId);
  }

  getFamilyMembers(ctx: AuthContext) {
    return this.requireFamily(ctx.familyId).members;
  }

  addFamilyMember(ctx: AuthContext, body: Record<string, unknown>) {
    const phone = assertPhone(body.phone);
    const relation = body.relation === "father" ? "father" : "mother";
    const family = this.requireFamily(ctx.familyId);
    let user = [...this.store.users.values()].find(
      (item) => item.phone === phone,
    );
    if (!user) {
      user = {
        id: this.store.id(),
        phone,
        nickname: null,
        avatarUrl: null,
        createdAt: nowIso(),
      };
      this.store.users.set(user.id, user);
    }
    if (family.members.some((member) => member.userId === user.id))
      throw businessError("USER_ALREADY_IN_FAMILY", "User already in family");
    if (family.members.length >= 2)
      throw businessError(
        "FAMILY_MEMBER_LIMIT_REACHED",
        "Family member limit reached",
      );
    const member: FamilyMember = {
      id: this.store.id(),
      userId: user.id,
      relation,
      displayName: null,
      createdAt: nowIso(),
    };
    this.store.families.set(family.id, {
      ...family,
      members: [...family.members, member],
    });
    return member;
  }

  removeFamilyMember(ctx: AuthContext, memberId: string) {
    const family = this.requireFamily(ctx.familyId);
    if (family.members.length <= 1)
      throw businessError(
        "CANNOT_REMOVE_LAST_MEMBER",
        "Cannot remove last family member",
      );
    const removedMember = family.members.find(
      (member) => member.id === memberId,
    );
    const nextMembers = family.members.filter(
      (member) => member.id !== memberId,
    );
    if (nextMembers.length === family.members.length)
      throw notFound("Family member not found");
    this.store.families.set(family.id, { ...family, members: nextMembers });
    if (removedMember) this.invalidateUserSessions(removedMember.userId);
    return { success: true };
  }

  getReminderSettings(ctx: AuthContext) {
    return (
      this.store.reminderSettings.get(ctx.familyId) ??
      defaultReminderSettings(ctx.familyId)
    );
  }

  updateReminderSettings(ctx: AuthContext, body: Record<string, unknown>) {
    const current = this.getReminderSettings(ctx);
    const updated: ReminderSettings = {
      ...current,
      enabled: optionalBoolean(body.enabled, "enabled") ?? current.enabled,
      advanceMinutes:
        optionalReminderAdvanceMinutes(body.advanceMinutes) ??
        current.advanceMinutes,
      includeTodayLessons:
        optionalBoolean(body.includeTodayLessons, "includeTodayLessons") ??
        current.includeTodayLessons,
      includeMakeupLessons:
        optionalBoolean(body.includeMakeupLessons, "includeMakeupLessons") ??
        current.includeMakeupLessons,
      updatedAt: nowIso(),
    };
    this.store.reminderSettings.set(ctx.familyId, updated);
    return updated;
  }

  getThemePreference(ctx: AuthContext) {
    return (
      this.store.themePreferences.get(ctx.user.id) ??
      defaultThemePreference(ctx.user.id)
    );
  }

  updateThemePreference(ctx: AuthContext, body: Record<string, unknown>) {
    const updated: ThemePreference = {
      userId: ctx.user.id,
      skin: assertThemeSkin(body.skin),
      updatedAt: nowIso(),
    };
    this.store.themePreferences.set(ctx.user.id, updated);
    return updated;
  }

  createChild(ctx: AuthContext, body: Record<string, unknown>) {
    const input = assertChildInput(body);
    const child = {
      id: this.store.id(),
      name: input.name,
      age: input.age ?? null,
      avatarUrl: input.avatarUrl ?? null,
      familyId: ctx.familyId,
      createdAt: nowIso(),
    };
    this.store.children.set(child.id, child);
    return child;
  }

  updateChild(
    ctx: AuthContext,
    childId: string,
    body: Record<string, unknown>,
  ) {
    const child = this.requireChild(ctx, childId);
    const merged = { ...child, ...body };
    const input = assertChildInput(merged);
    const updated = {
      ...child,
      name: input.name,
      age: input.age ?? null,
      avatarUrl: input.avatarUrl ?? null,
    };
    this.store.children.set(child.id, updated);
    return updated;
  }

  getChild(ctx: AuthContext, childId: string) {
    return this.requireChild(ctx, childId);
  }

  listChildren(ctx: AuthContext) {
    return [...this.store.children.values()].filter(
      (child) => child.familyId === ctx.familyId,
    );
  }

  deleteChild(ctx: AuthContext, childId: string) {
    this.requireChild(ctx, childId);
    for (const trainingClass of [...this.store.classes.values()].filter(
      (item) => item.childId === childId,
    ))
      this.deleteClass(ctx, trainingClass.id);
    this.store.children.delete(childId);
    return { success: true };
  }

  createClass(ctx: AuthContext, body: Record<string, unknown>) {
    const childId = assertString(body.childId, "childId");
    this.requireChild(ctx, childId);
    const totalHours = Number(body.totalHours);
    const usedHours = body.usedHours === undefined ? 0 : Number(body.usedHours);
    const totalFee = Number(body.totalFee);
    if (!Number.isInteger(totalHours) || totalHours <= 0)
      throw badRequest("totalHours must be positive");
    if (!Number.isInteger(usedHours) || usedHours < 0 || usedHours > totalHours)
      throw badRequest("usedHours must be between 0 and totalHours");
    if (!Number.isFinite(totalFee) || totalFee < 0)
      throw badRequest("totalFee must be non-negative");
    const startTime = toLocalIso(assertIsoDate(body.startTime, "startTime"));
    const endTime =
      body.endTime == null
        ? null
        : toLocalIso(assertIsoDate(body.endTime, "endTime"));
    const trainingClass: TrainingClass = {
      id: this.store.id(),
      childId,
      familyId: ctx.familyId,
      institutionName: assertString(
        body.institutionName,
        "institutionName",
        "机构名称",
      ),
      className: assertString(body.className, "className", "班级名称"),
      courseName: assertString(body.courseName, "courseName", "课程名称"),
      teacherName: optionalString(body.teacherName) ?? null,
      teacherPhone: optionalString(body.teacherPhone) ?? null,
      totalHours,
      usedHours,
      remainingHours: Math.max(0, totalHours - usedHours),
      totalFee,
      startTime,
      endTime,
      recurringRule: assertRecurringRule(body.recurringRule),
      status: "active",
      createdAt: nowIso(),
      updatedAt: null,
      notes: optionalString(body.notes) ?? null,
    };
    this.store.classes.set(trainingClass.id, trainingClass);
    this.regenerateFutureLessons(trainingClass);
    return trainingClass;
  }

  updateClass(
    ctx: AuthContext,
    classId: string,
    body: Record<string, unknown>,
  ) {
    const current = this.requireClass(ctx, classId);
    const updated: TrainingClass = {
      ...current,
      institutionName:
        body.institutionName === undefined
          ? current.institutionName
          : assertString(body.institutionName, "institutionName"),
      className:
        body.className === undefined
          ? current.className
          : assertString(body.className, "className"),
      courseName:
        body.courseName === undefined
          ? current.courseName
          : assertString(body.courseName, "courseName"),
      teacherName:
        body.teacherName === undefined
          ? current.teacherName
          : (optionalString(body.teacherName) ?? null),
      teacherPhone:
        body.teacherPhone === undefined
          ? current.teacherPhone
          : (optionalString(body.teacherPhone) ?? null),
      totalHours:
        body.totalHours === undefined
          ? current.totalHours
          : Number(body.totalHours),
      usedHours:
        body.usedHours === undefined
          ? current.usedHours
          : Number(body.usedHours),
      totalFee:
        body.totalFee === undefined ? current.totalFee : Number(body.totalFee),
      startTime:
        body.startTime === undefined
          ? current.startTime
          : toLocalIso(assertIsoDate(body.startTime, "startTime")),
      endTime:
        body.endTime === undefined
          ? current.endTime
          : body.endTime == null
            ? null
            : toLocalIso(assertIsoDate(body.endTime, "endTime")),
      recurringRule:
        body.recurringRule === undefined
          ? current.recurringRule
          : assertRecurringRule(body.recurringRule),
      status:
        body.status === undefined
          ? current.status
          : assertClassStatus(body.status),
      updatedAt: nowIso(),
      notes:
        body.notes === undefined
          ? current.notes
          : (optionalString(body.notes) ?? null),
    };
    if (
      !Number.isInteger(updated.usedHours) ||
      updated.usedHours < 0 ||
      updated.usedHours > updated.totalHours
    )
      throw badRequest("usedHours must be between 0 and totalHours");
    updated.remainingHours = Math.max(
      0,
      updated.totalHours - updated.usedHours,
    );
    this.store.classes.set(updated.id, updated);
    if (
      body.recurringRule !== undefined ||
      body.startTime !== undefined ||
      body.endTime !== undefined ||
      body.totalHours !== undefined
    )
      this.regenerateFutureLessons(updated);
    return updated;
  }

  listClasses(ctx: AuthContext, query: URLSearchParams) {
    const childId = query.get("childId");
    const status = query.get("status");
    return [...this.store.classes.values()].filter(
      (item) =>
        item.familyId === ctx.familyId &&
        (!childId || item.childId === childId) &&
        (!status || item.status === status),
    );
  }

  getClass(ctx: AuthContext, classId: string) {
    return this.requireClass(ctx, classId);
  }

  setClassStatus(
    ctx: AuthContext,
    classId: string,
    status: TrainingClass["status"],
  ) {
    const trainingClass = this.requireClass(ctx, classId);
    const updated = { ...trainingClass, status, updatedAt: nowIso() };
    this.store.classes.set(classId, updated);
    return updated;
  }

  renewClass(ctx: AuthContext, classId: string, body: Record<string, unknown>) {
    const original = this.requireClass(ctx, classId);
    return this.createClass(ctx, {
      ...original,
      totalHours: body.newTotalHours,
      totalFee: body.newTotalFee,
      startTime: nowIso(),
    });
  }

  deleteClass(ctx: AuthContext, classId: string) {
    this.requireClass(ctx, classId);
    for (const lesson of [...this.store.lessons.values()].filter(
      (item) => item.classId === classId,
    ))
      this.deleteLesson(ctx, lesson.id);
    for (const suspension of [...this.store.suspensions.values()].filter(
      (item) => item.classId === classId,
    ))
      this.store.suspensions.delete(suspension.id);
    this.store.classes.delete(classId);
    return { success: true };
  }

  getClassLessons(ctx: AuthContext, classId: string) {
    this.requireClass(ctx, classId);
    return [...this.store.lessons.values()]
      .filter((lesson) => lesson.classId === classId)
      .sort(byScheduledDate);
  }

  generateClassLessons(ctx: AuthContext, classId: string) {
    const trainingClass = this.requireClass(ctx, classId);
    this.regenerateFutureLessons(trainingClass);
    return this.getClassLessons(ctx, classId);
  }

  getLessonsInRange(ctx: AuthContext, query: URLSearchParams) {
    const { start, end } = assertDateRange(
      query.get("start"),
      query.get("end"),
    );
    const childId = query.get("childId");
    const classId = query.get("classId");
    return this.familyLessons(ctx)
      .filter((lesson) => {
        const trainingClass = this.store.classes.get(lesson.classId);
        const date = new Date(lesson.scheduledDate);
        return (
          date >= start &&
          date <= end &&
          (!childId || trainingClass?.childId === childId) &&
          (!classId || lesson.classId === classId) &&
          !this.isSuspended(lesson)
        );
      })
      .sort(byScheduledDate);
  }

  getUpcomingLessons(ctx: AuthContext, query: URLSearchParams) {
    const days = Math.max(1, Math.min(30, Number(query.get("days") ?? 3)));
    const start = new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + days - 1);
    end.setHours(23, 59, 59, 999);

    const childId = query.get("childId");
    const classId = query.get("classId");
    return this.familyLessons(ctx)
      .filter((lesson) => {
        const trainingClass = this.store.classes.get(lesson.classId);
        const date = new Date(lesson.scheduledDate);
        return (
          lesson.status === "scheduled" &&
          date >= start &&
          date <= end &&
          (!childId || trainingClass?.childId === childId) &&
          (!classId || lesson.classId === classId) &&
          !this.isSuspended(lesson)
        );
      })
      .sort(byScheduledDate);
  }

  getLesson(ctx: AuthContext, lessonId: string) {
    return this.requireLesson(ctx, lessonId);
  }

  addManualLesson(ctx: AuthContext, body: Record<string, unknown>) {
    const classId = assertString(body.classId, "classId");
    const trainingClass = this.requireClass(ctx, classId);
    const scheduledDate = assertIsoDate(body.scheduledDate, "scheduledDate");
    const scheduledEndDate =
      body.scheduledEndDate === undefined
        ? inferLessonEndDate(trainingClass, scheduledDate)
        : assertIsoDate(body.scheduledEndDate, "scheduledEndDate");
    if (!scheduledEndDate)
      throw badRequest(
        "scheduledEndDate is required when class duration cannot be inferred",
        [{ field: "scheduledEndDate", message: "请提供结束时间" }],
      );
    if (scheduledEndDate <= scheduledDate)
      throw badRequest("scheduledEndDate must be after scheduledDate", [
        { field: "scheduledEndDate", message: "结束时间必须晚于开始时间" },
      ]);
    const lesson: Lesson = {
      id: this.store.id(),
      classId,
      scheduledDate: toLocalIso(scheduledDate),
      scheduledEndDate: toLocalIso(scheduledEndDate),
      status: "scheduled",
      actualDate: null,
      checkinTime: null,
      isMakeup: false,
      notes: null,
      leaveReason: null,
      isManual: true,
    };
    this.store.lessons.set(lesson.id, lesson);
    return lesson;
  }

  updateLesson(
    ctx: AuthContext,
    lessonId: string,
    body: Record<string, unknown>,
  ) {
    const lesson = this.requireLesson(ctx, lessonId);
    const trainingClass = this.requireClass(ctx, lesson.classId);
    const changesSchedule =
      body.scheduledDate !== undefined || body.scheduledEndDate !== undefined;
    if (lesson.status === "completed" && changesSchedule) {
      throw badRequest("Cannot change scheduled time for completed lesson", [
        { field: "scheduledDate", message: "已打卡课次不能调整计划时间" },
      ]);
    }
    const currentStart = new Date(lesson.scheduledDate);
    const currentEnd = lesson.scheduledEndDate
      ? new Date(lesson.scheduledEndDate)
      : inferLessonEndDate(trainingClass, currentStart);
    const scheduledDate =
      body.scheduledDate === undefined
        ? currentStart
        : assertIsoDate(body.scheduledDate, "scheduledDate");
    let scheduledEndDate: Date | null;
    if (body.scheduledEndDate !== undefined) {
      scheduledEndDate =
        body.scheduledEndDate === null
          ? null
          : assertIsoDate(body.scheduledEndDate, "scheduledEndDate");
    } else if (body.scheduledDate !== undefined && currentEnd) {
      scheduledEndDate = new Date(
        scheduledDate.getTime() +
          (currentEnd.getTime() - currentStart.getTime()),
      );
    } else {
      scheduledEndDate = currentEnd;
    }
    if (scheduledEndDate && scheduledEndDate <= scheduledDate)
      throw badRequest("scheduledEndDate must be after scheduledDate", [
        { field: "scheduledEndDate", message: "结束时间必须晚于开始时间" },
      ]);
    const updated: Lesson = {
      ...lesson,
      scheduledDate: toLocalIso(scheduledDate),
      scheduledEndDate: scheduledEndDate ? toLocalIso(scheduledEndDate) : null,
      status:
        body.status === undefined
          ? lesson.status
          : assertLessonStatus(body.status),
      notes:
        body.notes === undefined
          ? lesson.notes
          : (optionalString(body.notes) ?? null),
    };
    this.store.lessons.set(lesson.id, updated);
    return updated;
  }

  deleteLesson(ctx: AuthContext, lessonId: string) {
    this.requireLesson(ctx, lessonId);
    for (const attendance of [...this.store.attendance.values()].filter(
      (item) => item.lessonId === lessonId,
    ))
      this.store.attendance.delete(attendance.id);
    for (const leave of [...this.store.leaves.values()].filter(
      (item) => item.lessonId === lessonId || item.makeupLessonId === lessonId,
    ))
      this.store.leaves.delete(leave.id);
    for (const change of [...this.store.lessonChanges.values()].filter(
      (item) => item.lessonId === lessonId || item.newLessonId === lessonId,
    ))
      this.store.lessonChanges.delete(change.id);
    this.store.lessons.delete(lessonId);
    return { success: true };
  }

  setSuspension(ctx: AuthContext, body: Record<string, unknown>) {
    const classId = assertString(body.classId, "classId");
    this.requireClass(ctx, classId);
    const { start, end } = assertDateRange(body.start, body.end);
    const suspension = {
      id: this.store.id(),
      classId,
      start: toLocalIso(start),
      end: toLocalIso(end),
    };
    this.store.suspensions.set(suspension.id, suspension);
    return { success: true, suspension };
  }

  removeSuspension(ctx: AuthContext, classId: string) {
    this.requireClass(ctx, classId);
    for (const suspension of [...this.store.suspensions.values()].filter(
      (item) => item.classId === classId,
    ))
      this.store.suspensions.delete(suspension.id);
    return { success: true };
  }

  checkLessonConflicts(ctx: AuthContext, lessonId: string) {
    const lesson = this.requireLesson(ctx, lessonId);
    const trainingClass = this.requireClass(ctx, lesson.classId);
    return this.familyLessons(ctx).filter((candidate) => {
      if (candidate.id === lesson.id) return false;
      const candidateClass = this.store.classes.get(candidate.classId);
      return (
        candidateClass?.childId === trainingClass.childId &&
        overlaps(lesson, candidate)
      );
    });
  }

  checkIn(ctx: AuthContext, body: Record<string, unknown>) {
    const lesson = this.requireLesson(
      ctx,
      assertString(body.lessonId, "lessonId"),
    );
    const trainingClass = this.requireClass(ctx, lesson.classId);
    const existing = [...this.store.attendance.values()].find(
      (item) => item.lessonId === lesson.id,
    );
    if (existing) return existing;
    if (lesson.status === "leave")
      throw badRequest("Cannot check in a leave lesson");
    if (lesson.status === "rescheduled")
      throw badRequest("Cannot check in a rescheduled lesson");
    if (lesson.status === "cancelled")
      throw badRequest("Cannot check in a cancelled lesson");
    const type = body.type === "backdated" ? "backdated" : "checkin";
    const now = new Date();
    const scheduledStart = new Date(lesson.scheduledDate);
    const scheduledEnd = lesson.scheduledEndDate
      ? new Date(lesson.scheduledEndDate)
      : inferLessonEndDate(trainingClass, scheduledStart);
    if (!scheduledEnd)
      throw badRequest("Lesson has no scheduled end time", [
        { field: "scheduledEndDate", message: "课次缺少结束时间" },
      ]);
    if (type === "checkin") {
      const allowedFrom = new Date(
        scheduledStart.getTime() - CHECKIN_EARLY_WINDOW_MS,
      );
      const allowedUntil = new Date(
        scheduledEnd.getTime() + CHECKIN_LATE_WINDOW_MS,
      );
      if (now < allowedFrom) {
        throw businessError(
          "CHECKIN_TOO_EARLY",
          "还没到上课时间，可先查看课程或申请临时调课。",
          [{ field: "allowedFrom", message: toLocalIso(allowedFrom) }],
        );
      }
      if (now > allowedUntil) {
        throw businessError(
          "CHECKIN_REQUIRES_BACKDATED",
          "当前课程已超过正常打卡时间，请走补打卡流程。",
          [
            {
              field: "backdatedUntil",
              message: toLocalIso(
                new Date(scheduledStart.getTime() + BACKDATED_WINDOW_MS),
              ),
            },
          ],
        );
      }
    } else {
      const backdatedUntil = new Date(
        scheduledStart.getTime() + BACKDATED_WINDOW_MS,
      );
      if (now < scheduledStart)
        throw badRequest("Cannot backdate a future lesson", [
          { field: "lessonId", message: "未开始课程不能补打卡" },
        ]);
      if (now > backdatedUntil && optionalString(body.notes) == null) {
        throw badRequest(
          "notes is required for historical backdated check-in",
          [{ field: "notes", message: "超过7天的历史补录需要填写备注" }],
        );
      }
    }
    const actualStartTime =
      body.actualStartTime === undefined
        ? null
        : toLocalIso(assertIsoDate(body.actualStartTime, "actualStartTime"));
    const actualEndTime =
      body.actualEndTime === undefined
        ? null
        : toLocalIso(assertIsoDate(body.actualEndTime, "actualEndTime"));
    if (
      actualStartTime &&
      actualEndTime &&
      new Date(actualEndTime) <= new Date(actualStartTime)
    ) {
      throw badRequest("actualEndTime must be after actualStartTime", [
        { field: "actualEndTime", message: "实际结束时间必须晚于实际开始时间" },
      ]);
    }
    const checkinTime = nowIso();
    const attendance: Attendance = {
      id: this.store.id(),
      lessonId: lesson.id,
      classId: trainingClass.id,
      childId: trainingClass.childId,
      checkinTime,
      type,
      actualStartTime,
      actualEndTime,
      notes: optionalString(body.notes) ?? null,
      createdAt: checkinTime,
    };
    this.store.attendance.set(attendance.id, attendance);
    this.store.lessons.set(lesson.id, {
      ...lesson,
      status: "completed",
      actualDate: checkinTime,
      checkinTime,
      notes: attendance.notes,
    });
    this.refreshClassUsage(trainingClass.id);
    return attendance;
  }

  getAttendance(ctx: AuthContext, attendanceId: string) {
    const attendance = this.store.attendance.get(attendanceId);
    if (!attendance) throw notFound("Attendance not found");
    this.requireClass(ctx, attendance.classId);
    return attendance;
  }

  cancelCheckIn(ctx: AuthContext, lessonId: string) {
    const lesson = this.requireLesson(ctx, lessonId);
    const attendance = [...this.store.attendance.values()].find(
      (item) => item.lessonId === lesson.id,
    );
    if (!attendance) throw notFound("Attendance not found");
    this.requireClass(ctx, attendance.classId);
    this.store.attendance.delete(attendance.id);
    this.store.lessons.set(lesson.id, {
      ...lesson,
      status: "scheduled",
      actualDate: null,
      checkinTime: null,
    });
    this.revertClassUsage(lesson.classId);
    return { success: true, lesson: this.requireLesson(ctx, lesson.id) };
  }

  listAttendance(ctx: AuthContext, query: URLSearchParams) {
    if (query.has("lessonId"))
      return [...this.store.attendance.values()].filter(
        (item) =>
          item.lessonId === query.get("lessonId") &&
          this.canAccessClass(ctx, item.classId),
      );
    const { start, end } = assertDateRange(
      query.get("start"),
      query.get("end"),
    );
    const childId = query.get("childId");
    const classId = query.get("classId");
    return [...this.store.attendance.values()].filter((item) => {
      const date = new Date(item.checkinTime);
      return (
        date >= start &&
        date <= end &&
        this.canAccessClass(ctx, item.classId) &&
        (!childId || item.childId === childId) &&
        (!classId || item.classId === classId)
      );
    });
  }

  getBackdatedCandidates(ctx: AuthContext) {
    const since = Date.now() - BACKDATED_WINDOW_MS;
    return this.familyLessons(ctx)
      .filter(
        (lesson) =>
          Date.parse(lesson.scheduledDate) < Date.now() &&
          Date.parse(lesson.scheduledDate) >= since &&
          lesson.status === "scheduled" &&
          ![...this.store.attendance.values()].some(
            (item) => item.lessonId === lesson.id,
          ),
      )
      .sort(byScheduledDate)
      .map((lesson) => {
        const trainingClass = this.store.classes.get(lesson.classId);
        const child = trainingClass
          ? this.store.children.get(trainingClass.childId)
          : undefined;
        return {
          ...lesson,
          childId: trainingClass?.childId ?? null,
          childName: child?.name ?? "",
          className: trainingClass?.className ?? "",
          courseName: trainingClass?.courseName ?? "",
          institutionName: trainingClass?.institutionName ?? "",
        };
      });
  }

  createLessonChange(ctx: AuthContext, body: Record<string, unknown>) {
    const lesson = this.requireLesson(
      ctx,
      assertString(body.lessonId, "lessonId"),
    );
    if (lesson.status !== "scheduled")
      throw badRequest("Only scheduled lessons can be changed");
    const trainingClass = this.requireClass(ctx, lesson.classId);
    const type = assertLessonChangeType(body.type);
    const source = assertLessonChangeSource(body.source);
    const newStart = assertIsoDate(body.newScheduledDate, "newScheduledDate");
    const requestedNewEnd =
      body.newScheduledEndDate === undefined || body.newScheduledEndDate === null
        ? null
        : assertIsoDate(body.newScheduledEndDate, "newScheduledEndDate");
    if (newStart < new Date())
      throw badRequest("newScheduledDate must not be in the past", [
        { field: "newScheduledDate", message: "新上课时间不能早于当前时间" },
      ]);
    if (requestedNewEnd && requestedNewEnd <= newStart)
      throw badRequest("newScheduledEndDate must be after newScheduledDate", [
        { field: "newScheduledEndDate", message: "结束时间必须晚于开始时间" },
      ]);
    const originalStart = new Date(lesson.scheduledDate);
    const originalEnd = lesson.scheduledEndDate
      ? new Date(lesson.scheduledEndDate)
      : inferLessonEndDate(trainingClass, originalStart);
    const duration = originalEnd
      ? originalEnd.getTime() - originalStart.getTime()
      : 60 * 60 * 1000;
    const newEnd = requestedNewEnd ?? new Date(newStart.getTime() + duration);
    const newLesson: Lesson = {
      ...lesson,
      id: this.store.id(),
      scheduledDate: toLocalIso(newStart),
      scheduledEndDate: toLocalIso(newEnd),
      status: "scheduled",
      actualDate: null,
      checkinTime: null,
      isMakeup: true,
      leaveReason: null,
      isManual: false,
    };
    const change: LessonChangeRecord = {
      id: this.store.id(),
      lessonId: lesson.id,
      classId: trainingClass.id,
      childId: trainingClass.childId,
      type,
      source,
      reason: optionalString(body.reason) ?? null,
      originalStartAt: lesson.scheduledDate,
      originalEndAt: lesson.scheduledEndDate ?? null,
      newLessonId: newLesson.id,
      status: "active",
      createdAt: nowIso(),
    };
    this.store.lessonChanges.set(change.id, change);
    this.store.lessons.set(lesson.id, {
      ...lesson,
      status: type === "leave" ? "leave" : "rescheduled",
      leaveReason: change.reason,
    });
    this.store.lessons.set(newLesson.id, newLesson);
    return change;
  }

  cancelLessonChange(ctx: AuthContext, changeId: string) {
    const change = this.requireLessonChange(ctx, changeId);
    const newLesson = this.store.lessons.get(change.newLessonId);
    if (newLesson?.status === "completed")
      throw badRequest("Cannot cancel change after replacement lesson is completed");
    this.store.lessonChanges.set(change.id, { ...change, status: "cancelled" });
    const original = this.store.lessons.get(change.lessonId);
    if (original)
      this.store.lessons.set(original.id, {
        ...original,
        status: "scheduled",
        leaveReason: null,
      });
    this.store.lessons.delete(change.newLessonId);
    return { success: true };
  }

  lessonChangeHistory(ctx: AuthContext, query: URLSearchParams) {
    const childId = query.get("childId");
    const start = query.get("startDate")
      ? new Date(query.get("startDate") as string)
      : null;
    const end = query.get("endDate")
      ? new Date(query.get("endDate") as string)
      : null;
    return [...this.store.lessonChanges.values()]
      .filter((change) => {
        const date = new Date(change.createdAt);
        return (
          this.canAccessClass(ctx, change.classId) &&
          (!childId || change.childId === childId) &&
          (!start || date >= start) &&
          (!end || date <= end)
        );
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  requireLessonChange(ctx: AuthContext, changeId: string) {
    const change = this.store.lessonChanges.get(changeId);
    if (!change) throw notFound("Lesson change not found");
    this.requireClass(ctx, change.classId);
    return change;
  }

  requestLeave(ctx: AuthContext, body: Record<string, unknown>) {
    const lesson = this.requireLesson(
      ctx,
      assertString(body.lessonId, "lessonId"),
    );
    if (lesson.status === "completed")
      throw badRequest("Cannot request leave for completed lesson");
    const trainingClass = this.requireClass(ctx, lesson.classId);
    const makeup = nextLessonAfter(
      trainingClass,
      new Date(lesson.scheduledDate),
      () => this.store.id(),
    );
    if (makeup) {
      makeup.isMakeup = true;
      this.store.lessons.set(makeup.id, makeup);
    }
    const leave: LeaveRecord = {
      id: this.store.id(),
      lessonId: lesson.id,
      classId: trainingClass.id,
      childId: trainingClass.childId,
      requestTime: nowIso(),
      status: "approved",
      reason: optionalString(body.reason) ?? null,
      makeupLessonId: makeup?.id ?? null,
      createdAt: nowIso(),
    };
    this.store.leaves.set(leave.id, leave);
    this.store.lessons.set(lesson.id, {
      ...lesson,
      status: "leave",
      leaveReason: leave.reason,
    });
    return leave;
  }

  cancelLeave(ctx: AuthContext, leaveId: string) {
    const leave = this.requireLeave(ctx, leaveId);
    const makeupLesson = leave.makeupLessonId
      ? this.store.lessons.get(leave.makeupLessonId)
      : undefined;
    if (makeupLesson?.status === "completed")
      throw badRequest("Cannot cancel leave after makeup lesson is completed");
    const updated = { ...leave, status: "cancelled" as const };
    this.store.leaves.set(leave.id, updated);
    const lesson = this.store.lessons.get(leave.lessonId);
    if (lesson)
      this.store.lessons.set(lesson.id, {
        ...lesson,
        status: "scheduled",
        leaveReason: null,
      });
    if (leave.makeupLessonId) this.store.lessons.delete(leave.makeupLessonId);
    return { success: true };
  }

  requireLeave(ctx: AuthContext, leaveId: string) {
    const leave = this.store.leaves.get(leaveId);
    if (!leave) throw notFound("Leave not found");
    this.requireClass(ctx, leave.classId);
    return leave;
  }

  leaveHistory(ctx: AuthContext, query: URLSearchParams) {
    const childId = query.get("childId");
    const start = query.get("startDate")
      ? new Date(query.get("startDate") as string)
      : null;
    const end = query.get("endDate")
      ? new Date(query.get("endDate") as string)
      : null;
    return [...this.store.leaves.values()]
      .filter((leave) => {
        const date = new Date(leave.requestTime);
        return (
          this.canAccessClass(ctx, leave.classId) &&
          (!childId || leave.childId === childId) &&
          (!start || date >= start) &&
          (!end || date <= end)
        );
      })
      .sort((a, b) => Date.parse(b.requestTime) - Date.parse(a.requestTime));
  }

  makeupLessons(ctx: AuthContext) {
    return this.familyLessons(ctx).filter((lesson) => lesson.isMakeup);
  }

  attendanceStats(ctx: AuthContext, query: URLSearchParams) {
    const { year, month } = assertMonth(query.get("year"), query.get("month"));
    const lessons = this.monthLessons(
      ctx,
      year,
      month,
      query.get("childId"),
      null,
    );
    const attended = lessons.filter(
      (lesson) => lesson.status === "completed",
    ).length;
    const leaves = lessons.filter((lesson) => lesson.status === "leave").length;
    const total = lessons.length;
    return {
      total,
      attended,
      leave: leaves,
      missed: total - attended - leaves,
      attendanceRate: total === 0 ? 0 : attended / total,
      leaveRate: total === 0 ? 0 : leaves / total,
    };
  }

  monthlyCost(ctx: AuthContext, query: URLSearchParams): MonthlyCostStatistics {
    const { year, month } = assertMonth(query.get("year"), query.get("month"));
    const childId = query.get("childId");
    const classId = query.get("classId");
    const lessons = this.monthLessons(ctx, year, month, childId, classId);
    const attended = lessons.filter(
      (lesson) => lesson.status === "completed",
    ).length;
    const leaves = lessons.filter((lesson) => lesson.status === "leave").length;
    const totalCost = lessons
      .filter((lesson) => lesson.status === "completed")
      .reduce(
        (sum, lesson) =>
          sum + this.perSessionCost(this.store.classes.get(lesson.classId)),
        0,
      );
    return {
      id: `${ctx.familyId}-${year}-${month}-${childId ?? "all"}-${classId ?? "all"}`,
      familyId: ctx.familyId,
      childId,
      classId,
      year,
      month,
      totalAttendedLessons: attended,
      totalLeaveLessons: leaves,
      totalCost,
      calculatedAt: nowIso(),
    };
  }

  costBreakdown(
    ctx: AuthContext,
    query: URLSearchParams,
  ): ClassCostBreakdown[] {
    const stats = this.monthlyCost(ctx, query);
    const { year, month } = assertMonth(query.get("year"), query.get("month"));
    const rows = this.listClasses(ctx, new URLSearchParams()).map(
      (trainingClass) => {
        const child = this.store.children.get(trainingClass.childId);
        const lessons = this.monthLessons(
          ctx,
          year,
          month,
          trainingClass.childId,
          trainingClass.id,
        );
        const attendedLessons = lessons.filter(
          (lesson) => lesson.status === "completed",
        ).length;
        const leaveLessons = lessons.filter(
          (lesson) => lesson.status === "leave",
        ).length;
        const cost = attendedLessons * this.perSessionCost(trainingClass);
        return {
          classId: trainingClass.id,
          className: trainingClass.className,
          childName: child?.name ?? "",
          attendedLessons,
          leaveLessons,
          cost,
          percentage: stats.totalCost === 0 ? 0 : cost / stats.totalCost,
        };
      },
    );
    return rows.filter(
      (row) => row.attendedLessons > 0 || row.leaveLessons > 0 || row.cost > 0,
    );
  }

  costTrend(ctx: AuthContext, query: URLSearchParams): CostTrendPoint[] {
    const months = Math.max(1, Math.min(24, Number(query.get("months") ?? 6)));
    const result: CostTrendPoint[] = [];
    const date = new Date();
    date.setDate(1);
    for (let index = months - 1; index >= 0; index -= 1) {
      const cursor = new Date(date);
      cursor.setMonth(cursor.getMonth() - index);
      const year = cursor.getFullYear();
      const month = cursor.getMonth() + 1;
      const params = new URLSearchParams({
        year: String(year),
        month: String(month),
      });
      const childId = query.get("childId");
      if (childId) params.set("childId", childId);
      const stats = this.monthlyCost(ctx, params);
      result.push({
        year,
        month,
        cost: stats.totalCost,
        lessonCount: stats.totalAttendedLessons,
      });
    }
    return result;
  }

  totalRemainingValue(ctx: AuthContext) {
    return this.listClasses(ctx, new URLSearchParams())
      .filter((item) => item.status !== "ended")
      .reduce(
        (sum, item) => sum + item.remainingHours * this.perSessionCost(item),
        0,
      );
  }

  exportCostCsv(ctx: AuthContext, query: URLSearchParams) {
    const startParam = query.get("startDate");
    const endParam = query.get("endDate");
    let lessons = this.familyLessons(ctx);
    if (startParam || endParam) {
      const { start, end } = assertDateRange(startParam, endParam);
      lessons = lessons.filter(
        (lesson) =>
          new Date(lesson.scheduledDate) >= start &&
          new Date(lesson.scheduledDate) <= end,
      );
    }
    const rows = ["childName,className,courseName,scheduledDate,status,cost"];
    for (const lesson of lessons) {
      const trainingClass = this.store.classes.get(lesson.classId);
      if (!trainingClass) continue;
      const child = this.store.children.get(trainingClass.childId);
      rows.push(
        [
          child?.name ?? "",
          trainingClass.className,
          trainingClass.courseName,
          lesson.scheduledDate,
          lesson.status,
          lesson.status === "completed"
            ? this.perSessionCost(trainingClass).toFixed(2)
            : "0.00",
        ]
          .map(csvEscape)
          .join(","),
      );
    }
    return rows.join("\n");
  }

  private issueToken(userId: string) {
    const raw = `${userId}.${Date.now()}.${randomBytes(12).toString("hex")}`;
    const signature = createHmac("sha256", this.config.tokenSecret)
      .update(raw)
      .digest("hex");
    const token = `${raw}.${signature}`;
    this.store.sessions.set(token, { token, userId, createdAt: nowIso() });
    return token;
  }

  private invalidateUserSessions(userId: string) {
    for (const session of [...this.store.sessions.values()].filter(
      (item) => item.userId === userId,
    )) {
      this.store.sessions.delete(session.token);
    }
  }

  private requireFamily(familyId: string) {
    const family = this.store.families.get(familyId);
    if (!family) throw notFound("Family not found");
    return family;
  }

  private requireChild(ctx: AuthContext, childId: string) {
    const child = this.store.children.get(childId);
    if (!child || child.familyId !== ctx.familyId)
      throw notFound("Child not found");
    return child;
  }

  private requireClass(ctx: AuthContext, classId: string) {
    const trainingClass = this.store.classes.get(classId);
    if (!trainingClass) throw notFound("Class not found");
    if (trainingClass.familyId !== ctx.familyId) throw forbidden();
    return trainingClass;
  }

  private requireLesson(ctx: AuthContext, lessonId: string) {
    const lesson = this.store.lessons.get(lessonId);
    if (!lesson) throw notFound("Lesson not found");
    this.requireClass(ctx, lesson.classId);
    return lesson;
  }

  private canAccessClass(ctx: AuthContext, classId: string) {
    const trainingClass = this.store.classes.get(classId);
    return trainingClass?.familyId === ctx.familyId;
  }

  private familyLessons(ctx: AuthContext) {
    return [...this.store.lessons.values()].filter((lesson) =>
      this.canAccessClass(ctx, lesson.classId),
    );
  }

  private monthLessons(
    ctx: AuthContext,
    year: number,
    month: number,
    childId: string | null,
    classId: string | null,
  ) {
    return this.familyLessons(ctx).filter((lesson) => {
      const date = new Date(lesson.scheduledDate);
      const trainingClass = this.store.classes.get(lesson.classId);
      return (
        date.getFullYear() === year &&
        date.getMonth() + 1 === month &&
        (!childId || trainingClass?.childId === childId) &&
        (!classId || lesson.classId === classId)
      );
    });
  }

  private regenerateFutureLessons(trainingClass: TrainingClass) {
    const preserved = [...this.store.lessons.values()].filter(
      (lesson) =>
        lesson.classId === trainingClass.id &&
        (lesson.status !== "scheduled" || lesson.isManual || lesson.isMakeup),
    );
    for (const lesson of [...this.store.lessons.values()].filter(
      (item) =>
        item.classId === trainingClass.id &&
        item.status === "scheduled" &&
        !item.isManual &&
        !item.isMakeup,
    ))
      this.store.lessons.delete(lesson.id);
    const generatedCount = Math.max(
      0,
      trainingClass.totalHours -
        preserved.filter(countsTowardClassHours).length,
    );
    const latestCompletedDate = preserved
      .filter((lesson) => lesson.status === "completed")
      .map((lesson) => Date.parse(lesson.scheduledDate))
      .filter(Number.isFinite)
      .reduce((latest, date) => Math.max(latest, date), 0);
    const latestCompletedDayEnd =
      latestCompletedDate === 0 ? 0 : endOfDayTimestamp(latestCompletedDate);
    const generated = generateLessonsForClass(
      {
        ...trainingClass,
        totalHours: Math.max(
          trainingClass.totalHours + preserved.length,
          generatedCount,
        ),
      },
      () => this.store.id(),
    )
      .filter(
        (lesson) => Date.parse(lesson.scheduledDate) > latestCompletedDayEnd,
      )
      .filter(
        (lesson) =>
          !preserved.some(
            (item) =>
              item.scheduledDate === lesson.scheduledDate &&
              item.classId === lesson.classId,
          ),
      )
      .slice(0, generatedCount);
    for (const lesson of generated) this.store.lessons.set(lesson.id, lesson);
  }

  private refreshClassUsage(classId: string) {
    const trainingClass = this.store.classes.get(classId);
    if (!trainingClass) return;
    const usedHours = Math.max(
      trainingClass.usedHours,
      this.countUsedHours(classId),
    );
    this.store.classes.set(classId, {
      ...trainingClass,
      usedHours,
      remainingHours: Math.max(0, trainingClass.totalHours - usedHours),
      status:
        usedHours >= trainingClass.totalHours ? "ended" : trainingClass.status,
      updatedAt: nowIso(),
    });
  }

  private revertClassUsage(classId: string) {
    const trainingClass = this.store.classes.get(classId);
    if (!trainingClass) return;
    const usedHours = Math.max(0, trainingClass.usedHours - 1);
    this.store.classes.set(classId, {
      ...trainingClass,
      usedHours,
      remainingHours: Math.max(0, trainingClass.totalHours - usedHours),
      status:
        trainingClass.status === "ended" && usedHours < trainingClass.totalHours
          ? "active"
          : trainingClass.status,
      updatedAt: nowIso(),
    });
  }

  private countUsedHours(classId: string) {
    return [...this.store.lessons.values()].filter(
      (lesson) => lesson.classId === classId && lesson.status === "completed",
    ).length;
  }

  private isSuspended(lesson: Lesson) {
    const date = new Date(lesson.scheduledDate);
    return [...this.store.suspensions.values()].some(
      (item) =>
        item.classId === lesson.classId &&
        date >= new Date(item.start) &&
        date <= new Date(item.end),
    );
  }

  private perSessionCost(trainingClass: TrainingClass | undefined) {
    if (!trainingClass || trainingClass.totalHours <= 0) return 0;
    return trainingClass.totalFee / trainingClass.totalHours;
  }
}

function nowIso() {
  return nowLocalIso();
}

function hashPassword(phone: string, password: string) {
  const salt = randomBytes(16).toString("hex");
  const passwordHash = scryptSync(password, salt, 64).toString("hex");
  return { phone, passwordHash, salt, createdAt: nowIso() };
}

function verifyPassword(
  password: string,
  credential: { passwordHash: string; salt: string },
) {
  const expected = Buffer.from(credential.passwordHash, "hex");
  const actual = scryptSync(password, credential.salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function defaultReminderSettings(familyId: string): ReminderSettings {
  return {
    familyId,
    enabled: true,
    advanceMinutes: 60,
    includeTodayLessons: true,
    includeMakeupLessons: true,
    updatedAt: nowIso(),
  };
}

function defaultThemePreference(userId: string): ThemePreference {
  return { userId, skin: "warm", updatedAt: nowIso() };
}

function byScheduledDate(a: Lesson, b: Lesson) {
  return Date.parse(a.scheduledDate) - Date.parse(b.scheduledDate);
}

function countsTowardClassHours(lesson: Lesson) {
  return (
    lesson.status === "completed" ||
    lesson.status === "leave" ||
    lesson.status === "rescheduled" ||
    lesson.isManual === true
  );
}

function inferLessonEndDate(trainingClass: TrainingClass, scheduledDate: Date) {
  const slot =
    trainingClass.recurringRule.timeSlots.find(
      (item) => item.dayOfWeek === scheduledDate.getDay(),
    ) ?? trainingClass.recurringRule.timeSlots[0];
  if (!slot) return null;
  const durationMinutes =
    slot.endHour * 60 +
    slot.endMinute -
    (slot.startHour * 60 + slot.startMinute);
  if (durationMinutes <= 0) return null;
  return new Date(scheduledDate.getTime() + durationMinutes * 60 * 1000);
}

function endOfDayTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function overlaps(a: Lesson, b: Lesson) {
  const aStart = Date.parse(a.scheduledDate);
  const aEnd = Date.parse(a.scheduledEndDate ?? a.scheduledDate);
  const bStart = Date.parse(b.scheduledDate);
  const bEnd = Date.parse(b.scheduledEndDate ?? b.scheduledDate);
  return aStart < bEnd && bStart < aEnd;
}

function assertClassStatus(value: unknown): TrainingClass["status"] {
  if (value === "active" || value === "paused" || value === "ended")
    return value;
  throw badRequest("Invalid class status");
}


function assertLessonChangeType(value: unknown): LessonChangeType {
  const allowed = ["leave", "reschedule"] as const;
  if (typeof value !== "string" || !allowed.includes(value as LessonChangeType))
    throw badRequest("Invalid lesson change type", [
      { field: "type", message: "请选择有效的变更类型" },
    ]);
  return value as LessonChangeType;
}

function assertLessonChangeSource(value: unknown): LessonChangeSource {
  const allowed = ["student", "teacher", "institution", "holiday", "other"] as const;
  if (typeof value !== "string" || !allowed.includes(value as LessonChangeSource))
    throw badRequest("Invalid lesson change source", [
      { field: "source", message: "请选择有效的原因归因" },
    ]);
  return value as LessonChangeSource;
}

function assertLessonStatus(value: unknown): Lesson["status"] {
  if (
    value === "scheduled" ||
    value === "completed" ||
    value === "leave" ||
    value === "cancelled"
  )
    return value;
  throw badRequest("Invalid lesson status");
}

function csvEscape(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
