import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { beforeEach, describe, it } from "node:test";
import {
  AppService,
  buildLessonReminderTemplateData,
} from "../src/app-service.js";
import { loadConfig } from "../src/config.js";
import { businessDateParts, parseBusinessDateTime, toLocalIso } from "../src/date-time.js";
import {
  findLessonConflicts,
  generateLessonsForClass,
} from "../src/schedule.js";
import { MemoryStore, SqliteStore } from "../src/store.js";
import type { RecurringRule } from "../src/types.js";

let service: AppService;
let store: MemoryStore;
let token: string;
let auth: ReturnType<AppService["authenticate"]>;

const rule: RecurringRule = {
  type: "weekly",
  daysOfWeek: [1],
  timeSlots: [
    { dayOfWeek: 1, startHour: 9, startMinute: 0, endHour: 10, endMinute: 0 },
  ],
};

beforeEach(() => {
  store = new MemoryStore();
  service = new AppService(store, loadConfig({ NODE_ENV: "test" }));
  const login = service.register("13800138000", "password123");
  token = login.token;
  auth = service.authenticate(`Bearer ${token}`);
});

function mockNow(isoDate: string) {
  const realDate = Date;
  const fixedTime = parseBusinessDateTime(isoDate).getTime();

  class MockDate extends realDate {
    constructor(
      ...args:
        | []
        | [string | number | Date]
        | [number, number, number?, number?, number?, number?, number?]
    ) {
      if (args.length === 0) super(fixedTime);
      else if (args.length === 1) super(args[0]);
      else
        super(
          args[0],
          args[1],
          args[2] ?? 1,
          args[3] ?? 0,
          args[4] ?? 0,
          args[5] ?? 0,
          args[6] ?? 0,
        );
    }

    static now() {
      return fixedTime;
    }
  }

  globalThis.Date = MockDate as DateConstructor;
  return () => {
    globalThis.Date = realDate;
  };
}

function lessonOn(
  lessons: ReturnType<AppService["getClassLessons"]>,
  datePrefix: string,
) {
  const lesson = lessons.find((item) => item.scheduledDate.startsWith(datePrefix));
  assert.ok(lesson, `Expected lesson on ${datePrefix}`);
  return lesson;
}

describe("auth and family", { concurrency: false }, () => {
  it("parses local business datetime strings independently from server timezone", () => {
    const parsed = parseBusinessDateTime("2026-06-17T16:10:00.000");
    assert.equal(parsed.toISOString(), "2026-06-17T08:10:00.000Z");
    assert.equal(toLocalIso(parsed), "2026-06-17T16:10:00.000");
  });

  it("creates user and family on first login", () => {
    const me = service.me(auth);
    assert.equal(me.user.phone, "13800138000");
    assert.equal(me.family.members.length, 1);
    assert.equal(me.family.members[0]?.relation, "mother");
  });

  it("logs in with password and rejects duplicate registration or wrong password", () => {
    const login = service.login("13800138000", "password123");
    assert.equal(
      service.authenticate(`Bearer ${login.token}`).user.phone,
      "13800138000",
    );
    assert.throws(() => service.login("13800138000", "wrongpass"), {
      code: "UNAUTHORIZED",
    });
    assert.throws(() => service.register("13800138000", "password123"), {
      code: "BAD_REQUEST",
    });
  });

  it("enforces member limit and last member protection", () => {
    service.addFamilyMember(auth, { phone: "13900139000", relation: "father" });
    assert.throws(
      () =>
        service.addFamilyMember(auth, {
          phone: "13700137000",
          relation: "father",
        }),
      { code: "FAMILY_MEMBER_LIMIT_REACHED" },
    );
    const family = service.getFamily(auth);
    service.removeFamilyMember(auth, family.members[1]!.id);
    assert.throws(
      () => service.removeFamilyMember(auth, family.members[0]!.id),
      { code: "CANNOT_REMOVE_LAST_MEMBER" },
    );
  });

  it("uses stable family sharing error codes and invalidates removed member sessions", () => {
    service.addFamilyMember(auth, { phone: "13900139000", relation: "father" });
    assert.throws(
      () =>
        service.addFamilyMember(auth, {
          phone: "13900139000",
          relation: "father",
        }),
      { code: "USER_ALREADY_IN_FAMILY" },
    );
    assert.throws(
      () =>
        service.addFamilyMember(auth, {
          phone: "13700137000",
          relation: "father",
        }),
      { code: "FAMILY_MEMBER_LIMIT_REACHED" },
    );

    const memberLogin = service.register("13900139000", "password123");
    const memberAuth = service.authenticate(`Bearer ${memberLogin.token}`);
    assert.equal(memberAuth.familyId, auth.familyId);

    const member = service
      .getFamily(auth)
      .members.find((item) => item.userId === memberAuth.user.id)!;
    service.removeFamilyMember(auth, member.id);

    assert.throws(() => service.authenticate(`Bearer ${memberLogin.token}`), {
      code: "UNAUTHORIZED",
    });
  });

  it("persists users, sessions, and children across sqlite restart", () => {
    const dbPath = ".data/test-persistence.sqlite";
    rmSync(dbPath, { force: true });

    const firstStore = new SqliteStore(dbPath);
    const firstService = new AppService(
      firstStore,
      loadConfig({ NODE_ENV: "test" }),
    );
    const login = firstService.register("13600136000", "password123");
    const firstAuth = firstService.authenticate(`Bearer ${login.token}`);
    const child = firstService.createChild(firstAuth, { name: "真实宝贝" });

    const secondStore = new SqliteStore(dbPath);
    const secondService = new AppService(
      secondStore,
      loadConfig({ NODE_ENV: "test" }),
    );
    const secondAuth = secondService.authenticate(`Bearer ${login.token}`);
    assert.equal(secondAuth.user.phone, "13600136000");
    assert.equal(secondService.getChild(secondAuth, child.id).name, "真实宝贝");

    rmSync(dbPath, { force: true });
  });

  it("persists reminder settings and theme preferences across sqlite restart", () => {
    const dbPath = ".data/test-preferences.sqlite";
    rmSync(dbPath, { force: true });

    const firstStore = new SqliteStore(dbPath);
    const firstService = new AppService(
      firstStore,
      loadConfig({ NODE_ENV: "test" }),
    );
    const login = firstService.register("13600136000", "password123");
    const firstAuth = firstService.authenticate(`Bearer ${login.token}`);

    firstService.updateReminderSettings(firstAuth, {
      enabled: false,
      advanceMinutes: 120,
    });
    firstService.updateThemePreference(firstAuth, { skin: "classic" });

    const secondStore = new SqliteStore(dbPath);
    const secondService = new AppService(
      secondStore,
      loadConfig({ NODE_ENV: "test" }),
    );
    const secondAuth = secondService.authenticate(`Bearer ${login.token}`);
    assert.equal(secondService.getReminderSettings(secondAuth).enabled, false);
    assert.equal(
      secondService.getReminderSettings(secondAuth).advanceMinutes,
      120,
    );
    assert.equal(secondService.getThemePreference(secondAuth).skin, "classic");

    rmSync(dbPath, { force: true });
  });

  it("persists family member changes across sqlite restart", () => {
    const dbPath = ".data/test-family-members.sqlite";
    rmSync(dbPath, { force: true });

    const firstStore = new SqliteStore(dbPath);
    const firstService = new AppService(
      firstStore,
      loadConfig({ NODE_ENV: "test" }),
    );
    const login = firstService.register("13600136000", "password123");
    const firstAuth = firstService.authenticate(`Bearer ${login.token}`);

    const member = firstService.addFamilyMember(firstAuth, {
      phone: "13900139000",
      relation: "father",
    });

    const secondStore = new SqliteStore(dbPath);
    const secondService = new AppService(
      secondStore,
      loadConfig({ NODE_ENV: "test" }),
    );
    const secondAuth = secondService.authenticate(`Bearer ${login.token}`);
    assert.equal(
      secondService
        .getFamilyMembers(secondAuth)
        .some((item) => item.id === member.id),
      true,
    );

    secondService.removeFamilyMember(secondAuth, member.id);

    const thirdStore = new SqliteStore(dbPath);
    const thirdService = new AppService(
      thirdStore,
      loadConfig({ NODE_ENV: "test" }),
    );
    const thirdAuth = thirdService.authenticate(`Bearer ${login.token}`);
    assert.equal(
      thirdService
        .getFamilyMembers(thirdAuth)
        .some((item) => item.id === member.id),
      false,
    );

    rmSync(dbPath, { force: true });
  });

  it("returns default and partial-updated family reminder settings across member sessions", () => {
    const defaults = service.getReminderSettings(auth);
    assert.equal(defaults.familyId, auth.familyId);
    assert.equal(defaults.enabled, true);
    assert.equal(defaults.advanceMinutes, 60);
    assert.equal(defaults.includeTodayLessons, true);
    assert.equal(defaults.includeMakeupLessons, true);

    const updated = service.updateReminderSettings(auth, {
      enabled: false,
      advanceMinutes: 30,
    });
    assert.equal(updated.enabled, false);
    assert.equal(updated.advanceMinutes, 30);
    assert.equal(updated.includeTodayLessons, true);

    service.addFamilyMember(auth, { phone: "13900139000", relation: "father" });
    const memberLogin = service.register("13900139000", "password123");
    const memberAuth = service.authenticate(`Bearer ${memberLogin.token}`);
    assert.deepEqual(service.getReminderSettings(memberAuth), updated);
  });

  it("rejects invalid reminder advance minutes with a field error", () => {
    assert.throws(
      () => service.updateReminderSettings(auth, { advanceMinutes: 45 }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "BAD_REQUEST");
        assert.deepEqual((error as { fields?: unknown }).fields, [
          {
            field: "advanceMinutes",
            message: "提醒时间只能是15、30、60、120或1440分钟",
          },
        ]);
        return true;
      },
    );
  });

  it("binds wechat openid and registers one pending lesson reminder subscription", async () => {
    const restoreNow = mockNow("2026-06-15T08:00:00.000");
    try {
      await service.bindWeChatSession(auth, { openid: "openid-test" });
      assert.equal(store.users.get(auth.user.id)?.wechatOpenid, "openid-test");

      const child = service.createChild(auth, { name: "小宝" });
      const trainingClass = service.createClass(auth, {
        childId: child.id,
        institutionName: "星星美术",
        className: "大班A",
        courseName: "美术启蒙",
        totalHours: 2,
        totalFee: 200,
        startTime: "2026-06-15T09:00:00.000",
        recurringRule: rule,
      });
      const lesson = service.getClassLessons(auth, trainingClass.id)[0]!;
      const result = service.registerLessonReminders(auth, {
        templateId: "pluT-ikzv-p5mBwXhcWIApzQqe4eyYQVyKlhha0h1b4",
        advanceMinutes: 30,
        lessonIds: [lesson.id],
        page: `/pages/class-detail/index?classId=${trainingClass.id}`,
      });

      assert.deepEqual(result.subscribedLessonIds, [lesson.id]);
      const subscription = [...store.reminderSubscriptions.values()][0]!;
      assert.equal(subscription.status, "pending");
      assert.equal(subscription.userId, auth.user.id);
      assert.equal(subscription.lessonId, lesson.id);
      assert.equal(subscription.remindAt, "2026-06-15T08:30:00.000");
    } finally {
      restoreNow();
    }
  });

  it("rejects registering multiple lessons from one subscribe authorization", () => {
    assert.throws(
      () =>
        service.registerLessonReminders(auth, {
          lessonIds: ["lesson-1", "lesson-2"],
        }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "BAD_REQUEST");
        assert.deepEqual((error as { fields?: unknown }).fields, [
          {
            field: "lessonIds",
            message: "一次订阅授权只能登记一节课提醒",
          },
        ]);
        return true;
      },
    );
  });

  it("rejects registering lesson reminders before binding wechat openid", () => {
    const restoreNow = mockNow("2026-06-15T08:00:00.000");
    try {
      const child = service.createChild(auth, { name: "小宝" });
      const trainingClass = service.createClass(auth, {
        childId: child.id,
        institutionName: "星星美术",
        className: "大班A",
        courseName: "美术启蒙",
        totalHours: 2,
        totalFee: 200,
        startTime: "2026-06-15T09:00:00.000",
        recurringRule: rule,
      });
      const lesson = service.getClassLessons(auth, trainingClass.id)[0]!;

      assert.throws(
        () =>
          service.registerLessonReminders(auth, {
            lessonIds: [lesson.id],
          }),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, "WECHAT_OPENID_MISSING");
          return true;
        },
      );
      assert.equal(store.reminderSubscriptions.size, 0);
    } finally {
      restoreNow();
    }
  });

  it("builds non-empty fallback data for live reminder templates", () => {
    const templateData = buildLessonReminderTemplateData(
      {
        id: "sub-1",
        familyId: auth.familyId,
        userId: auth.user.id,
        lessonId: "lesson-1",
        templateId: "pluT-ikzv-p5mBwXhcWIApzQqe4eyYQVyKlhha0h1b4",
        advanceMinutes: 60,
        scheduledAt: "2026-06-18T13:40:00.000",
        remindAt: "2026-06-18T12:40:00.000",
        page: "/pages/home/index",
        status: "pending",
        sentAt: null,
        failureReason: null,
        createdAt: "2026-06-18T12:00:00.000",
        updatedAt: "2026-06-18T12:00:00.000",
      },
      {
        id: "lesson-1",
        classId: "class-1",
        scheduledDate: "2026-06-18T13:40:00.000",
        scheduledEndDate: "2026-06-18T18:30:00.000",
        status: "scheduled",
        isMakeup: false,
      },
      {
        id: "class-1",
        childId: "child-1",
        familyId: auth.familyId,
        institutionName: "",
        className: "篮球课",
        courseName: "篮球",
        totalHours: 42,
        usedHours: 2,
        remainingHours: 40,
        totalFee: 4200,
        startTime: "2026-06-01T13:40:00.000",
        recurringRule: rule,
        status: "active",
        createdAt: "2026-06-01T08:00:00.000",
      },
      "",
    );

    assert.equal(templateData.thing9.value, "学员");
    assert.equal(templateData.thing8.value, "篮球");
    assert.equal(templateData.time15.value, "2026-06-23 09:00");
  });

  it("returns default and updated user theme preference without sharing it across family members", () => {
    const defaults = service.getThemePreference(auth);
    assert.equal(defaults.userId, auth.user.id);
    assert.equal(defaults.skin, "warm");

    const updated = service.updateThemePreference(auth, { skin: "fresh" });
    assert.equal(updated.skin, "fresh");
    service.logout(`Bearer ${token}`);
    const relogin = service.login("13800138000", "password123");
    const reloginAuth = service.authenticate(`Bearer ${relogin.token}`);
    assert.equal(service.getThemePreference(reloginAuth).skin, "fresh");

    service.addFamilyMember(reloginAuth, {
      phone: "13900139000",
      relation: "father",
    });
    const memberLogin = service.register("13900139000", "password123");
    const memberAuth = service.authenticate(`Bearer ${memberLogin.token}`);
    assert.equal(service.getThemePreference(memberAuth).skin, "warm");
  });

  it("rejects invalid theme skins with a field error", () => {
    assert.throws(
      () => service.updateThemePreference(auth, { skin: "pink" }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "BAD_REQUEST");
        assert.deepEqual((error as { fields?: unknown }).fields, [
          { field: "skin", message: "主题只能是warm、fresh或classic" },
        ]);
        return true;
      },
    );
  });
});

describe("lesson flow contract", { concurrency: false }, () => {
  it("creates only remaining future lessons when historical used hours are provided", () => {
    const child = service.createChild(auth, { name: "小宝" });
    const trainingClass = service.createClass(auth, {
      childId: child.id,
      institutionName: "星星美术",
      className: "大班A",
      courseName: "美术启蒙",
      totalHours: 10,
      historicalUsedHours: 4,
      totalFee: 2000,
      startTime: "2026-06-15T09:00:00.000",
      recurringRule: rule,
    });

    assert.equal(trainingClass.historicalUsedHours, 4);
    assert.equal(trainingClass.usedHours, 4);
    assert.equal(trainingClass.remainingHours, 6);
    assert.equal(service.getClassLessons(auth, trainingClass.id).length, 6);
  });

  it("returns home lessons as today plus overdue backfill and excludes future upcoming lessons", () => {
    const restoreNow = mockNow("2026-06-17T12:00:00.000");
    try {
      const child = service.createChild(auth, { name: "小宝" });
      const trainingClass = service.createClass(auth, {
        childId: child.id,
        institutionName: "星星美术",
        className: "大班A",
        courseName: "美术启蒙",
        totalHours: 4,
        totalFee: 400,
        startTime: "2026-06-16T09:00:00.000",
        recurringRule: {
          type: "weekly",
          daysOfWeek: [2, 3, 4, 5],
          timeSlots: [
            { dayOfWeek: 2, startHour: 9, startMinute: 0, endHour: 10, endMinute: 0 },
            { dayOfWeek: 3, startHour: 9, startMinute: 0, endHour: 10, endMinute: 0 },
            { dayOfWeek: 4, startHour: 9, startMinute: 0, endHour: 10, endMinute: 0 },
            { dayOfWeek: 5, startHour: 9, startMinute: 0, endHour: 10, endMinute: 0 },
          ],
        },
      });
      const lessons = service.getClassLessons(auth, trainingClass.id);
      const home = service.getHomeLessons(auth);
      const upcoming = service.getUpcomingLessons(auth, new URLSearchParams("days=3"));

      assert.equal(home.todayLessons.some((item) => item.id === lessons[1]!.id), false);
      assert.equal(home.needsBackfillLessons.some((item) => item.id === lessons[0]!.id), true);
      assert.equal(home.needsBackfillLessons.some((item) => item.id === lessons[1]!.id), true);
      assert.equal(home.todayLessons.some((item) => item.id === lessons[2]!.id), false);
      assert.equal(upcoming.some((item) => item.id === lessons[2]!.id), true);
      assert.equal(upcoming.some((item) => item.id === lessons[1]!.id), false);
    } finally {
      restoreNow();
    }
  });

  it("does not deduct hours on leave until the makeup lesson is checked in", () => {
    const restoreNow = mockNow("2026-06-15T08:00:00.000");
    try {
      const child = service.createChild(auth, { name: "小宝" });
      const trainingClass = service.createClass(auth, {
        childId: child.id,
        institutionName: "星星美术",
        className: "大班A",
        courseName: "美术启蒙",
        totalHours: 2,
        totalFee: 200,
        startTime: "2026-06-15T09:00:00.000",
        recurringRule: rule,
      });
      const originalLesson = service.getClassLessons(auth, trainingClass.id)[0]!;
      const leave = service.requestLeave(auth, {
        lessonId: originalLesson.id,
        reason: "孩子请假",
        scheduledDate: "2026-06-20T09:00:00.000",
        scheduledEndDate: "2026-06-20T10:00:00.000",
      });
      const afterLeaveClass = service.getClass(auth, trainingClass.id);
      assert.equal(afterLeaveClass.usedHours, 0);
      assert.equal(afterLeaveClass.remainingHours, 2);

      const makeupLesson = service.getLesson(auth, leave.makeupLessonId!);
      const checkinRestoreNow = mockNow("2026-06-20T09:10:00.000");
      try {
        service.checkIn(auth, { lessonId: makeupLesson.id });
      } finally {
        checkinRestoreNow();
      }

      const afterMakeupClass = service.getClass(auth, trainingClass.id);
      assert.equal(afterMakeupClass.usedHours, 1);
      assert.equal(afterMakeupClass.remainingHours, 1);
    } finally {
      restoreNow();
    }
  });
});

describe("children, classes, lessons", { concurrency: false }, () => {
  it("creates child, class, and generated lessons", () => {
    const child = service.createChild(auth, { name: "小宝", age: 6 });
    const trainingClass = service.createClass(auth, {
      childId: child.id,
      institutionName: "星星美术",
      className: "大班A",
      courseName: "美术启蒙",
      totalHours: 4,
      totalFee: 400,
      startTime: "2026-06-15T09:00:00.000Z",
      recurringRule: rule,
    });
    const lessons = service.getClassLessons(auth, trainingClass.id);
    assert.equal(lessons.length, 4);
    assert.equal(lessons[0]?.status, "scheduled");
  });

  it("supports quick backfill of historical used hours without monthly cost", () => {
    const child = service.createChild(auth, { name: "小宝", age: 6 });
    const trainingClass = service.createClass(auth, {
      childId: child.id,
      institutionName: "星星美术",
      className: "大班A",
      courseName: "美术启蒙",
      totalHours: 20,
      usedHours: 6,
      totalFee: 2000,
      startTime: "2026-06-15T09:00:00.000",
      recurringRule: rule,
    });
    assert.equal(trainingClass.usedHours, 6);
    assert.equal(trainingClass.remainingHours, 14);
    const stats = service.monthlyCost(
      auth,
      new URLSearchParams({ year: "2026", month: "6" }),
    );
    assert.equal(stats.totalAttendedLessons, 0);
    assert.equal(stats.totalCost, 0);
  });

  it("keeps Wednesday and Thursday time slots in generated lessons", () => {
    const child = service.createChild(auth, { name: "小宝" });
    const trainingClass = service.createClass(auth, {
      childId: child.id,
      institutionName: "小蓝星",
      className: "篮球班",
      courseName: "篮球",
      totalHours: 4,
      totalFee: 400,
      startTime: "2026-06-12T16:10:00.000Z",
      recurringRule: {
        type: "weekly",
        daysOfWeek: [3, 4],
        timeSlots: [
          {
            dayOfWeek: 3,
            startHour: 16,
            startMinute: 10,
            endHour: 17,
            endMinute: 10,
          },
          {
            dayOfWeek: 4,
            startHour: 17,
            startMinute: 30,
            endHour: 18,
            endMinute: 30,
          },
        ],
      },
    });
    const lessons = service.getClassLessons(auth, trainingClass.id);
    assert.equal(businessDateParts(parseBusinessDateTime(lessons[0]!.scheduledDate)).dayOfWeek, 3);
    assert.equal(businessDateParts(parseBusinessDateTime(lessons[0]!.scheduledDate)).hour, 16);
    assert.equal(businessDateParts(parseBusinessDateTime(lessons[0]!.scheduledEndDate!)).hour, 17);
    assert.equal(businessDateParts(parseBusinessDateTime(lessons[1]!.scheduledDate)).dayOfWeek, 4);
    assert.equal(businessDateParts(parseBusinessDateTime(lessons[1]!.scheduledDate)).hour, 17);
    assert.equal(businessDateParts(parseBusinessDateTime(lessons[1]!.scheduledEndDate!)).hour, 18);
  });

  it("generates the first lesson when class start time is on a selected weekday", () => {
    const child = service.createChild(auth, { name: "小宝" });
    const trainingClass = service.createClass(auth, {
      childId: child.id,
      institutionName: "小蓝星",
      className: "篮球班",
      courseName: "篮球",
      totalHours: 3,
      totalFee: 300,
      startTime: "2026-06-15T16:30:00.000",
      recurringRule: {
        type: "weekly",
        daysOfWeek: [1, 3],
        timeSlots: [
          {
            dayOfWeek: 1,
            startHour: 16,
            startMinute: 30,
            endHour: 17,
            endMinute: 0,
          },
          {
            dayOfWeek: 3,
            startHour: 16,
            startMinute: 10,
            endHour: 17,
            endMinute: 10,
          },
        ],
      },
    });

    const lessons = service.getClassLessons(auth, trainingClass.id);
    assert.equal(lessons[0]!.scheduledDate, "2026-06-15T16:30:00.000");
    assert.equal(lessons[0]!.scheduledEndDate, "2026-06-15T17:00:00.000");
  });

  it("does not shift evening generated lessons on UTC servers", () => {
    const child = service.createChild(auth, { name: "小宝" });
    const trainingClass = service.createClass(auth, {
      childId: child.id,
      institutionName: "小蓝星",
      className: "篮球班",
      courseName: "篮球",
      totalHours: 1,
      totalFee: 100,
      startTime: "2026-06-18T17:30:00.000",
      recurringRule: {
        type: "weekly",
        daysOfWeek: [4],
        timeSlots: [
          {
            dayOfWeek: 4,
            startHour: 17,
            startMinute: 30,
            endHour: 18,
            endMinute: 30,
          },
        ],
      },
    });

    const lessons = service.getClassLessons(auth, trainingClass.id);
    assert.equal(lessons[0]!.scheduledDate, "2026-06-18T17:30:00.000");
    assert.equal(lessons[0]!.scheduledEndDate, "2026-06-18T18:30:00.000");
  });

  it("does not generate a lesson on a non-matching class start weekday", () => {
    const child = service.createChild(auth, { name: "小宝" });
    const trainingClass = service.createClass(auth, {
      childId: child.id,
      institutionName: "测试机构",
      className: "测试班",
      courseName: "测试",
      totalHours: 2,
      totalFee: 200,
      startTime: "2026-06-12T10:30:00.000",
      recurringRule: {
        type: "weekly",
        daysOfWeek: [6],
        timeSlots: [
          {
            dayOfWeek: 6,
            startHour: 10,
            startMinute: 30,
            endHour: 12,
            endMinute: 0,
          },
        ],
      },
    });

    const lessons = service.getClassLessons(auth, trainingClass.id);
    assert.equal(businessDateParts(parseBusinessDateTime(lessons[0]!.scheduledDate)).dayOfWeek, 6);
    assert.equal(lessons[0]!.scheduledDate, "2026-06-13T10:30:00.000");
  });

  it("returns only stable scheduled lessons in the upcoming window", () => {
    const restoreNow = mockNow("2026-06-16T09:10:00.000");
    try {
      const child = service.createChild(auth, { name: "小宝" });
      const trainingClass = service.createClass(auth, {
        childId: child.id,
        institutionName: "星星美术",
        className: "大班A",
        courseName: "美术启蒙",
        totalHours: 4,
        totalFee: 400,
        startTime: "2026-06-16T09:00:00.000",
        recurringRule: {
          type: "weekly",
          daysOfWeek: [2, 3, 4, 5],
          timeSlots: [
            { dayOfWeek: 2, startHour: 9, startMinute: 0, endHour: 10, endMinute: 0 },
            { dayOfWeek: 3, startHour: 9, startMinute: 0, endHour: 10, endMinute: 0 },
            { dayOfWeek: 4, startHour: 9, startMinute: 0, endHour: 10, endMinute: 0 },
            { dayOfWeek: 5, startHour: 9, startMinute: 0, endHour: 10, endMinute: 0 },
          ],
        },
      });
      const [first, second, third] = service.getClassLessons(auth, trainingClass.id);
      assert.ok(first);
      assert.ok(second);
      assert.ok(third);
      const upcoming = service.getUpcomingLessons(auth, new URLSearchParams({ days: "3" }));
      assert.equal(upcoming.length > 0, true);
      service.updateLesson(auth, third.id, { status: "leave" });
      assert.equal(
        service.getUpcomingLessons(auth, new URLSearchParams({ days: "3" }))
          .length < upcoming.length,
        true,
      );
    } finally {
      restoreNow();
    }
  });

  it("supports monthly and custom schedule generation plus conflict detection", () => {
    const baseClass = {
      id: "class-1",
      childId: "child-1",
      familyId: "family-1",
      institutionName: "机构",
      className: "班级",
      courseName: "课程",
      teacherName: null,
      teacherPhone: null,
      totalHours: 2,
      usedHours: 0,
      remainingHours: 2,
      totalFee: 200,
      startTime: "2026-06-01T00:00:00.000Z",
      endTime: null,
      status: "active" as const,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: null,
      notes: null,
    };
    const monthly = generateLessonsForClass(
      {
        ...baseClass,
        recurringRule: {
          type: "monthly",
          daysOfWeek: [6],
          weekOfMonth: 1,
          customIntervalDays: null,
          timeSlots: [
            {
              dayOfWeek: 6,
              startHour: 9,
              startMinute: 0,
              endHour: 10,
              endMinute: 0,
            },
          ],
        },
      },
      () => crypto.randomUUID(),
    );
    assert.equal(businessDateParts(parseBusinessDateTime(monthly[0]!.scheduledDate)).dayOfWeek, 6);
    assert.equal(businessDateParts(parseBusinessDateTime(monthly[0]!.scheduledDate)).day, 6);
    const custom = generateLessonsForClass(
      {
        ...baseClass,
        recurringRule: {
          type: "custom",
          daysOfWeek: [1],
          weekOfMonth: 1,
          customIntervalDays: 14,
          timeSlots: [
            {
              dayOfWeek: 1,
              startHour: 9,
              startMinute: 0,
              endHour: 10,
              endMinute: 0,
            },
          ],
        },
      },
      () => crypto.randomUUID(),
    );
    assert.equal(
      (Date.parse(custom[1]!.scheduledDate) -
        Date.parse(custom[0]!.scheduledDate)) /
        86_400_000,
      14,
    );
    assert.equal(
      findLessonConflicts(monthly[0]!, [
        monthly[0]!,
        { ...monthly[0]!, id: "other" },
      ]).length,
      1,
    );
  });

  it("filters suspended lessons from range queries", () => {
    const child = service.createChild(auth, { name: "小宝" });
    const trainingClass = service.createClass(auth, {
      childId: child.id,
      institutionName: "星星美术",
      className: "大班A",
      courseName: "美术启蒙",
      totalHours: 2,
      totalFee: 200,
      startTime: "2026-06-15T09:00:00.000Z",
      recurringRule: rule,
    });
    const first = service.getClassLessons(auth, trainingClass.id)[0]!;
    service.setSuspension(auth, {
      classId: trainingClass.id,
      start: first.scheduledDate,
      end: first.scheduledEndDate,
    });
    const lessons = service.getLessonsInRange(
      auth,
      new URLSearchParams({
        start: "2026-06-01T00:00:00.000Z",
        end: "2026-07-30T00:00:00.000Z",
      }),
    );
    assert.equal(
      lessons.some((lesson) => lesson.id === first.id),
      false,
    );
  });

  it("cascades child deletion", () => {
    const child = service.createChild(auth, { name: "小宝" });
    const trainingClass = service.createClass(auth, {
      childId: child.id,
      institutionName: "星星美术",
      className: "大班A",
      courseName: "美术启蒙",
      totalHours: 2,
      totalFee: 200,
      startTime: "2026-06-15T09:00:00.000Z",
      recurringRule: rule,
    });
    service.deleteChild(auth, child.id);
    assert.equal(store.children.size, 0);
    assert.equal(store.classes.has(trainingClass.id), false);
    assert.equal(store.lessons.size, 0);
  });
});

describe("attendance, leave, cost", { concurrency: false }, () => {
  it("checks in idempotently and updates cost", () => {
    const restoreNow = mockNow("2026-06-22T08:45:00.000");
    try {
      const child = service.createChild(auth, { name: "小宝" });
      const trainingClass = service.createClass(auth, {
        childId: child.id,
        institutionName: "星星美术",
        className: "大班A",
        courseName: "美术启蒙",
        totalHours: 2,
        totalFee: 200,
        startTime: "2026-06-15T09:00:00.000",
        recurringRule: rule,
      });
      const lesson = lessonOn(
        service.getClassLessons(auth, trainingClass.id),
        "2026-06-22",
      );
      const first = service.checkIn(auth, {
        lessonId: lesson.id,
        type: "checkin",
      });
      const second = service.checkIn(auth, {
        lessonId: lesson.id,
        type: "checkin",
      });
      assert.equal(first.id, second.id);
      assert.equal(service.getClass(auth, trainingClass.id).usedHours, 1);
      const stats = service.monthlyCost(
        auth,
        new URLSearchParams({ year: "2026", month: "6" }),
      );
      assert.equal(stats.totalAttendedLessons, 1);
      assert.equal(stats.totalCost, 100);
      const breakdown = service.costBreakdown(
        auth,
        new URLSearchParams({ year: "2026", month: "6" }),
      );
      assert.equal(breakdown[0]?.percentage, 1);
      assert.equal(service.totalRemainingValue(auth), 100);
      const trend = service.costTrend(
        auth,
        new URLSearchParams({ months: "2" }),
      );
      assert.equal(trend.length, 2);
      const csv = service.exportCostCsv(
        auth,
        new URLSearchParams({
          startDate: "2026-06-01T00:00:00.000Z",
          endDate: "2026-06-30T23:59:59.999Z",
        }),
      );
      assert.match(
        csv,
        /childName,className,courseName,scheduledDate,status,cost/,
      );
    } finally {
      restoreNow();
    }
  });

  it("preserves checked-in lessons when class schedule changes", () => {
    const restoreNow = mockNow("2026-06-22T08:45:00.000");
    try {
      const child = service.createChild(auth, { name: "小宝" });
      const trainingClass = service.createClass(auth, {
        childId: child.id,
        institutionName: "星星美术",
        className: "大班A",
        courseName: "美术启蒙",
        totalHours: 3,
        totalFee: 300,
        startTime: "2026-06-15T09:00:00.000",
        recurringRule: rule,
      });
      const checkedInLesson = lessonOn(
        service.getClassLessons(auth, trainingClass.id),
        "2026-06-22",
      );
      service.checkIn(auth, { lessonId: checkedInLesson.id, type: "checkin" });
      service.updateClass(auth, trainingClass.id, {
        recurringRule: {
          type: "weekly",
          daysOfWeek: [3],
          timeSlots: [
            {
              dayOfWeek: 3,
              startHour: 15,
              startMinute: 30,
              endHour: 17,
              endMinute: 30,
            },
          ],
        },
      });

      const lessons = service.getClassLessons(auth, trainingClass.id);
      assert.equal(
        service.getLesson(auth, checkedInLesson.id).status,
        "completed",
      );
      assert.equal(
        lessons.filter((lesson) => lesson.status === "completed").length,
        1,
      );
      assert.equal(
        lessons.filter((lesson) => lesson.status === "scheduled").length,
        2,
      );
      assert.equal(
        lessons
          .filter((lesson) => lesson.status === "scheduled")
          .every(
            (lesson) =>
              businessDateParts(parseBusinessDateTime(lesson.scheduledDate)).dayOfWeek === 3,
          ),
        true,
      );
    } finally {
      restoreNow();
    }
  });

  it("rejects early check-in without completing or billing the lesson", () => {
    const restoreNow = mockNow("2026-06-22T08:44:00.000");
    try {
      const child = service.createChild(auth, { name: "小宝" });
      const trainingClass = service.createClass(auth, {
        childId: child.id,
        institutionName: "星星美术",
        className: "大班A",
        courseName: "美术启蒙",
        totalHours: 2,
        totalFee: 200,
        startTime: "2026-06-15T09:00:00.000",
        recurringRule: rule,
      });
      const lesson = lessonOn(
        service.getClassLessons(auth, trainingClass.id),
        "2026-06-22",
      );

      assert.throws(
        () => service.checkIn(auth, { lessonId: lesson.id, type: "checkin" }),
        { code: "CHECKIN_TOO_EARLY" },
      );
      assert.equal(service.getLesson(auth, lesson.id).status, "scheduled");
      assert.equal(service.getClass(auth, trainingClass.id).usedHours, 0);
      assert.equal(
        service.monthlyCost(
          auth,
          new URLSearchParams({ year: "2026", month: "6" }),
        ).totalCost,
        0,
      );
    } finally {
      restoreNow();
    }
  });

  it("requires backdated flow after the normal check-in window", () => {
    const restoreNow = mockNow("2026-06-22T12:01:00.000");
    try {
      const child = service.createChild(auth, { name: "小宝" });
      const trainingClass = service.createClass(auth, {
        childId: child.id,
        institutionName: "星星美术",
        className: "大班A",
        courseName: "美术启蒙",
        totalHours: 2,
        totalFee: 200,
        startTime: "2026-06-15T09:00:00.000",
        recurringRule: rule,
      });
      const lesson = lessonOn(
        service.getClassLessons(auth, trainingClass.id),
        "2026-06-22",
      );

      assert.throws(
        () => service.checkIn(auth, { lessonId: lesson.id, type: "checkin" }),
        { code: "CHECKIN_REQUIRES_BACKDATED" },
      );
      const attendance = service.checkIn(auth, {
        lessonId: lesson.id,
        type: "backdated",
        actualStartTime: "2026-06-22T09:00:00.000",
        actualEndTime: "2026-06-22T10:00:00.000",
      });
      assert.equal(attendance.type, "backdated");
      assert.equal(attendance.actualStartTime, "2026-06-22T09:00:00.000");
      assert.equal(service.getLesson(auth, lesson.id).status, "completed");
    } finally {
      restoreNow();
    }
  });

  it("cancels a mistaken check-in and restores lesson and class usage", () => {
    const restoreNow = mockNow("2026-06-22T08:45:00.000");
    try {
      const child = service.createChild(auth, { name: "小宝" });
      const trainingClass = service.createClass(auth, {
        childId: child.id,
        institutionName: "星星美术",
        className: "大班A",
        courseName: "美术启蒙",
        totalHours: 2,
        totalFee: 200,
        startTime: "2026-06-15T09:00:00.000",
        recurringRule: rule,
      });
      const lesson = lessonOn(
        service.getClassLessons(auth, trainingClass.id),
        "2026-06-22",
      );
      service.checkIn(auth, { lessonId: lesson.id, type: "checkin" });

      const result = service.cancelCheckIn(auth, lesson.id);

      assert.equal(result.success, true);
      assert.equal(service.getLesson(auth, lesson.id).status, "scheduled");
      assert.equal(service.getLesson(auth, lesson.id).checkinTime, null);
      assert.equal(
        service.listAttendance(
          auth,
          new URLSearchParams({ lessonId: lesson.id }),
        ).length,
        0,
      );
      assert.equal(service.getClass(auth, trainingClass.id).usedHours, 0);
      assert.equal(service.getClass(auth, trainingClass.id).remainingHours, 2);
      assert.equal(
        service.monthlyCost(
          auth,
          new URLSearchParams({ year: "2026", month: "6" }),
        ).totalCost,
        0,
      );
    } finally {
      restoreNow();
    }
  });

  it("returns enriched backdated candidates for the last seven days", () => {
    const restoreNow = mockNow("2026-06-25T08:00:00.000");
    try {
      const child = service.createChild(auth, { name: "小宝" });
      const trainingClass = service.createClass(auth, {
        childId: child.id,
        institutionName: "星星美术",
        className: "大班A",
        courseName: "美术启蒙",
        totalHours: 2,
        totalFee: 200,
        startTime: "2026-06-15T09:00:00.000",
        recurringRule: rule,
      });
      const candidates = service.getBackdatedCandidates(auth);
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0]?.className, trainingClass.className);
      assert.equal(candidates[0]?.courseName, trainingClass.courseName);
      assert.equal(candidates[0]?.childName, child.name);
    } finally {
      restoreNow();
    }
  });

  it("keeps lesson start and end time consistent when rescheduling one lesson", () => {
    const child = service.createChild(auth, { name: "小宝" });
    const trainingClass = service.createClass(auth, {
      childId: child.id,
      institutionName: "星星美术",
      className: "大班A",
      courseName: "美术启蒙",
      totalHours: 2,
      totalFee: 200,
      startTime: "2026-06-15T09:00:00.000",
      recurringRule: rule,
    });
    const lesson = service.getClassLessons(auth, trainingClass.id)[0]!;
    const updated = service.updateLesson(auth, lesson.id, {
      scheduledDate: "2026-06-15T10:30:00.000",
    });
    assert.equal(updated.scheduledDate, "2026-06-15T10:30:00.000");
    assert.equal(updated.scheduledEndDate, "2026-06-15T11:30:00.000");
    assert.throws(
      () =>
        service.updateLesson(auth, lesson.id, {
          scheduledEndDate: "2026-06-15T10:00:00.000",
        }),
      /scheduledEndDate/,
    );
  });

  it("adds manual lessons with an inferred or explicit end time", () => {
    const child = service.createChild(auth, { name: "小宝" });
    const trainingClass = service.createClass(auth, {
      childId: child.id,
      institutionName: "星星美术",
      className: "大班A",
      courseName: "美术启蒙",
      totalHours: 2,
      totalFee: 200,
      startTime: "2026-06-15T09:00:00.000",
      recurringRule: rule,
    });
    const inferred = service.addManualLesson(auth, {
      classId: trainingClass.id,
      scheduledDate: "2026-06-18T10:30:00.000",
    });
    const explicit = service.addManualLesson(auth, {
      classId: trainingClass.id,
      scheduledDate: "2026-06-19T10:30:00.000",
      scheduledEndDate: "2026-06-19T12:00:00.000",
    });
    assert.equal(inferred.scheduledEndDate, "2026-06-18T11:30:00.000");
    assert.equal(explicit.scheduledEndDate, "2026-06-19T12:00:00.000");
  });


  it("creates and cancels lesson changes for leave and reschedule", () => {
    const child = service.createChild(auth, { name: "小宝" });
    const trainingClass = service.createClass(auth, {
      childId: child.id,
      institutionName: "星星美术",
      className: "大班A",
      courseName: "美术启蒙",
      totalHours: 3,
      totalFee: 300,
      startTime: "2026-06-15T09:00:00.000",
      recurringRule: rule,
    });
    const lessons = service.getClassLessons(auth, trainingClass.id);
    const leaveChange = service.createLessonChange(auth, {
      lessonId: lessons[0]!.id,
      type: "leave",
      source: "student",
      reason: "身体不适",
      newScheduledDate: "2026-07-01T10:00:00.000",
      newScheduledEndDate: "2026-07-01T11:30:00.000",
    });
    assert.equal(service.getLesson(auth, lessons[0]!.id).status, "leave");
    assert.equal(service.getLesson(auth, leaveChange.newLessonId!).status, "scheduled");
    assert.equal(
      service.getLesson(auth, leaveChange.newLessonId!).scheduledEndDate,
      "2026-07-01T11:30:00.000",
    );
    const rescheduleChange = service.createLessonChange(auth, {
      lessonId: lessons[1]!.id,
      type: "reschedule",
      source: "teacher",
      reason: "老师临时有事",
      newScheduledDate: "2026-07-02T10:00:00.000",
    });
    assert.equal(service.getLesson(auth, lessons[1]!.id).status, "rescheduled");
    assert.equal(service.lessonChangeHistory(auth, new URLSearchParams()).length, 2);
    service.cancelLessonChange(auth, rescheduleChange.id);
    assert.equal(service.getLesson(auth, lessons[1]!.id).status, "scheduled");
    assert.throws(() => service.getLesson(auth, rescheduleChange.newLessonId!), /not found/i);
  });

  it("does not cancel a lesson change after replacement is completed", () => {
    const child = service.createChild(auth, { name: "小宝" });
    const trainingClass = service.createClass(auth, {
      childId: child.id,
      institutionName: "星星美术",
      className: "大班A",
      courseName: "美术启蒙",
      totalHours: 2,
      totalFee: 200,
      startTime: "2026-06-15T09:00:00.000",
      recurringRule: rule,
    });
    const lesson = service.getClassLessons(auth, trainingClass.id)[0]!;
    const change = service.createLessonChange(auth, {
      lessonId: lesson.id,
      type: "reschedule",
      source: "institution",
      newScheduledDate: "2026-07-03T10:00:00.000",
    });
    const restoreNow = mockNow("2026-07-03T10:05:00.000");
    try {
      service.checkIn(auth, { lessonId: change.newLessonId, type: "checkin" });
      assert.throws(
        () => service.cancelLessonChange(auth, change.id),
        /Cannot cancel change/,
      );
    } finally {
      restoreNow();
    }
  });


  it("requests and cancels leave with makeup lesson", () => {
    const child = service.createChild(auth, { name: "小宝" });
    const trainingClass = service.createClass(auth, {
      childId: child.id,
      institutionName: "星星美术",
      className: "大班A",
      courseName: "美术启蒙",
      totalHours: 2,
      totalFee: 200,
      startTime: "2026-06-15T09:00:00.000Z",
      recurringRule: rule,
    });
    const lesson = service.getClassLessons(auth, trainingClass.id)[0]!;
    const leave = service.requestLeave(auth, {
      lessonId: lesson.id,
      reason: "生病",
    });
    assert.equal(service.getLesson(auth, lesson.id).status, "leave");
    assert.equal(service.makeupLessons(auth).length, 1);
    service.cancelLeave(auth, leave.id);
    assert.equal(service.getLesson(auth, lesson.id).status, "scheduled");
    assert.equal(service.makeupLessons(auth).length, 0);
  });

  it("does not delete a completed makeup lesson when cancelling leave", () => {
    const restoreNow = mockNow("2026-06-29T08:45:00.000");
    try {
      const child = service.createChild(auth, { name: "小宝" });
      const trainingClass = service.createClass(auth, {
        childId: child.id,
        institutionName: "星星美术",
        className: "大班A",
        courseName: "美术启蒙",
        totalHours: 2,
        totalFee: 200,
        startTime: "2026-06-15T09:00:00.000",
        recurringRule: rule,
      });
      const lesson = lessonOn(
        service.getClassLessons(auth, trainingClass.id),
        "2026-06-22",
      );
      const leave = service.requestLeave(auth, {
        lessonId: lesson.id,
        reason: "生病",
      });
      const makeup = service.makeupLessons(auth)[0]!;
      service.checkIn(auth, { lessonId: makeup.id, type: "checkin" });
      assert.throws(
        () => service.cancelLeave(auth, leave.id),
        /Cannot cancel leave/,
      );
      assert.equal(service.getLesson(auth, makeup.id).status, "completed");
    } finally {
      restoreNow();
    }
  });
});
