import type { Lesson, LessonTimeSlot, RecurringRule, TrainingClass } from './types.js';
import {
  businessDateFromParts,
  businessDateParts,
  businessAddDays,
  businessAddMonths,
  businessStartOfDay,
  businessTimestamp,
  parseBusinessDateTime,
  toLocalIso,
} from './date-time.js';

export function generateLessonsForClass(trainingClass: TrainingClass, makeId: () => string, existingManual: Lesson[] = []): Lesson[] {
  const lessons: Lesson[] = [];
  const start = parseBusinessDateTime(trainingClass.startTime, "startTime");
  const end = trainingClass.endTime ? parseBusinessDateTime(trainingClass.endTime, "endTime") : addMonths(start, 18);
  const max = Math.max(0, trainingClass.totalHours);
  const rule = trainingClass.recurringRule;
  const pushLesson = (date: Date, slot: LessonTimeSlot, isMakeup = false) => {
    if (lessons.length >= max || date > end) return;
    const scheduledDate = withTime(date, slot.startHour, slot.startMinute);
    const scheduledEndDate = withTime(date, slot.endHour, slot.endMinute);
    if (businessDateParts(scheduledDate).dayOfWeek !== slot.dayOfWeek || scheduledDate < start || scheduledDate > end) return;
    lessons.push({
      id: makeId(),
      classId: trainingClass.id,
      scheduledDate: toLocalIso(scheduledDate),
      scheduledEndDate: toLocalIso(scheduledEndDate),
      status: 'scheduled',
      sourceType: isMakeup ? 'manual_makeup' : 'generated',
      attendanceStatus: 'pending',
      changeStatus: 'normal',
      actualDate: null,
      checkinTime: null,
      isMakeup,
      notes: null,
      leaveReason: null,
      isManual: false,
      originLessonId: null,
      changeBatchId: null,
    });
  };

  if (rule.type === 'custom') {
    const slot = rule.timeSlots[0];
    if (!slot) return existingManual;
    const interval = rule.customIntervalDays ?? 7;
    for (let date = new Date(start); lessons.length < max && date <= end; date = businessAddDays(date, interval)) pushLesson(date, slot);
  } else {
    for (let date = businessStartOfDay(start); lessons.length < max && date <= end; date = businessAddDays(date, 1)) {
      for (const slot of rule.timeSlots) {
        if (lessons.length >= max) break;
        const parts = businessDateParts(date);
        if (rule.type === 'weekly' && slot.dayOfWeek === parts.dayOfWeek) pushLesson(date, slot);
        if (rule.type === 'monthly' && slot.dayOfWeek === parts.dayOfWeek && nthWeekdayOfMonth(date) === (rule.weekOfMonth ?? 1)) pushLesson(date, slot);
      }
    }
  }
  return [...lessons, ...existingManual].sort((a, b) => businessTimestamp(a.scheduledDate) - businessTimestamp(b.scheduledDate));
}

export function findLessonConflicts(target: Lesson, lessons: Lesson[]): Lesson[] {
  const targetStart = businessTimestamp(target.scheduledDate);
  const targetEnd = businessTimestamp(target.scheduledEndDate ?? target.scheduledDate);
  return lessons.filter((lesson) => {
    if (lesson.id === target.id || lesson.status === 'cancelled') return false;
    const start = businessTimestamp(lesson.scheduledDate);
    const end = businessTimestamp(lesson.scheduledEndDate ?? lesson.scheduledDate);
    return targetStart < end && start < targetEnd;
  });
}

export function nextLessonAfter(trainingClass: TrainingClass, after: Date, makeId: () => string): Lesson | null {
  const synthetic = { ...trainingClass, startTime: toLocalIso(new Date(after.getTime() + 1)), totalHours: 1, endTime: null };
  return generateLessonsForClass(synthetic, makeId)[0] ?? null;
}

function withTime(date: Date, hour: number, minute: number) {
  const parts = businessDateParts(date);
  return businessDateFromParts(parts.year, parts.month, parts.day, hour, minute);
}

function addMonths(date: Date, months: number) {
  return businessAddMonths(date, months);
}

function nthWeekdayOfMonth(date: Date) {
  return Math.floor((businessDateParts(date).day - 1) / 7) + 1;
}
