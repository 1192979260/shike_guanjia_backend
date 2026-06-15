import type { Lesson, LessonTimeSlot, RecurringRule, TrainingClass } from './types.js';
import { toLocalIso } from './date-time.js';

export function generateLessonsForClass(trainingClass: TrainingClass, makeId: () => string, existingManual: Lesson[] = []): Lesson[] {
  const lessons: Lesson[] = [];
  const start = new Date(trainingClass.startTime);
  const end = trainingClass.endTime ? new Date(trainingClass.endTime) : addMonths(start, 18);
  const max = Math.max(0, trainingClass.totalHours);
  const rule = trainingClass.recurringRule;
  const pushLesson = (date: Date, slot: LessonTimeSlot, isMakeup = false) => {
    if (lessons.length >= max || date > end) return;
    const scheduledDate = withTime(date, slot.startHour, slot.startMinute);
    const scheduledEndDate = withTime(date, slot.endHour, slot.endMinute);
    if (scheduledDate.getDay() !== slot.dayOfWeek || scheduledDate < start || scheduledDate > end) return;
    lessons.push({
      id: makeId(),
      classId: trainingClass.id,
      scheduledDate: toLocalIso(scheduledDate),
      scheduledEndDate: toLocalIso(scheduledEndDate),
      status: 'scheduled',
      actualDate: null,
      checkinTime: null,
      isMakeup,
      notes: null,
      leaveReason: null,
      isManual: false,
    });
  };

  if (rule.type === 'custom') {
    const slot = rule.timeSlots[0];
    if (!slot) return existingManual;
    const interval = rule.customIntervalDays ?? 7;
    for (let date = new Date(start); lessons.length < max && date <= end; date = addDays(date, interval)) pushLesson(date, slot);
  } else {
    for (let date = startOfDay(start); lessons.length < max && date <= end; date = addDays(date, 1)) {
      for (const slot of rule.timeSlots) {
        if (lessons.length >= max) break;
        if (rule.type === 'weekly' && slot.dayOfWeek === date.getDay()) pushLesson(date, slot);
        if (rule.type === 'monthly' && slot.dayOfWeek === date.getDay() && nthWeekdayOfMonth(date) === (rule.weekOfMonth ?? 1)) pushLesson(date, slot);
      }
    }
  }
  return [...lessons, ...existingManual].sort((a, b) => Date.parse(a.scheduledDate) - Date.parse(b.scheduledDate));
}

export function findLessonConflicts(target: Lesson, lessons: Lesson[]): Lesson[] {
  const targetStart = Date.parse(target.scheduledDate);
  const targetEnd = Date.parse(target.scheduledEndDate ?? target.scheduledDate);
  return lessons.filter((lesson) => {
    if (lesson.id === target.id || lesson.status === 'cancelled') return false;
    const start = Date.parse(lesson.scheduledDate);
    const end = Date.parse(lesson.scheduledEndDate ?? lesson.scheduledDate);
    return targetStart < end && start < targetEnd;
  });
}

export function nextLessonAfter(trainingClass: TrainingClass, after: Date, makeId: () => string): Lesson | null {
  const synthetic = { ...trainingClass, startTime: toLocalIso(new Date(after.getTime() + 1)), totalHours: 1, endTime: null };
  return generateLessonsForClass(synthetic, makeId)[0] ?? null;
}

function withTime(date: Date, hour: number, minute: number) {
  const copy = new Date(date);
  copy.setHours(hour, minute, 0, 0);
  return copy;
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function addMonths(date: Date, months: number) {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

function nthWeekdayOfMonth(date: Date) {
  return Math.floor((date.getDate() - 1) / 7) + 1;
}
