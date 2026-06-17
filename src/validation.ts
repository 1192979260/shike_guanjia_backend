import { parseBusinessDateTime } from "./date-time.js";
import { badRequest } from './errors.js';
import type { LessonTimeSlot, RecurringRule, ThemeSkin } from './types.js';

const REMINDER_ADVANCE_MINUTES = new Set([15, 30, 60, 120, 1440]);

export function assertPhone(phone: unknown): string {
  if (typeof phone !== 'string' || !/^\+?\d{10,15}$/.test(phone)) {
    throw badRequest('Invalid phone number', [{ field: 'phone', message: '手机号格式不正确' }]);
  }
  return phone;
}

export function assertPassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < 6 || password.length > 72) {
    throw badRequest('Invalid password', [{ field: 'password', message: '密码长度需为6到72位' }]);
  }
  return password;
}

export function assertString(value: unknown, field: string, label = field, max = 100): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badRequest('Validation failed', [{ field, message: `${label}不能为空` }]);
  }
  if (value.length > max) {
    throw badRequest('Validation failed', [{ field, message: `${label}不能超过${max}个字符` }]);
  }
  return value.trim();
}

export function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw badRequest('Validation failed');
  return value;
}

export function assertChildInput(input: Record<string, unknown>) {
  const name = assertString(input.name, 'name', '姓名', 50);
  const age = input.age;
  if (age !== undefined && age !== null && (!Number.isInteger(age) || Number(age) < 0 || Number(age) > 18)) {
    throw badRequest('Validation failed', [{ field: 'age', message: '年龄必须在0到18之间' }]);
  }
  return { name, age: age === undefined ? undefined : Number(age), avatarUrl: optionalString(input.avatarUrl) };
}

export function assertIsoDate(value: unknown, field: string): Date {
  if (typeof value !== 'string') throw badRequest('Validation failed', [{ field, message: `${field}必须是日期字符串` }]);
  const date = parseBusinessDateTime(value, field);
  if (Number.isNaN(date.getTime())) throw badRequest('Validation failed', [{ field, message: `${field}日期格式不正确` }]);
  return date;
}

export function assertMonth(year: unknown, month: unknown) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw badRequest('Invalid year');
  if (!Number.isInteger(m) || m < 1 || m > 12) throw badRequest('Invalid month');
  return { year: y, month: m };
}

export function assertDateRange(start: unknown, end: unknown) {
  const startDate = assertIsoDate(start, 'start');
  const endDate = assertIsoDate(end, 'end');
  if (startDate > endDate) throw badRequest('start must be before end');
  return { start: startDate, end: endDate };
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw badRequest('Validation failed', [{ field, message: `${field}必须是布尔值` }]);
  return value;
}

export function optionalReminderAdvanceMinutes(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || !REMINDER_ADVANCE_MINUTES.has(minutes)) {
    throw badRequest('Validation failed', [{ field: 'advanceMinutes', message: '提醒时间只能是15、30、60、120或1440分钟' }]);
  }
  return minutes;
}

export function assertThemeSkin(value: unknown): ThemeSkin {
  if (value === 'warm' || value === 'fresh' || value === 'classic') return value;
  throw badRequest('Validation failed', [{ field: 'skin', message: '主题只能是warm、fresh或classic' }]);
}

export function assertRecurringRule(value: unknown): RecurringRule {
  if (!value || typeof value !== 'object') throw badRequest('Recurring rule is required');
  const input = value as Record<string, unknown>;
  const type = input.type;
  if (type !== 'weekly' && type !== 'monthly' && type !== 'custom') throw badRequest('Invalid recurring rule type');
  const daysOfWeek = Array.isArray(input.daysOfWeek) ? input.daysOfWeek.map(Number) : [1];
  if (daysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw badRequest('Invalid daysOfWeek');
  const slots = Array.isArray(input.timeSlots) ? input.timeSlots.map(assertTimeSlot) : [];
  if (slots.length === 0) throw badRequest('At least one time slot is required');
  const weekOfMonth = input.weekOfMonth == null ? 1 : Number(input.weekOfMonth);
  const customIntervalDays = input.customIntervalDays == null ? null : Number(input.customIntervalDays);
  if (type === 'monthly' && (!Number.isInteger(weekOfMonth) || weekOfMonth < 1 || weekOfMonth > 5)) throw badRequest('Invalid weekOfMonth');
  if (type === 'custom' && (customIntervalDays == null || !Number.isInteger(customIntervalDays) || customIntervalDays < 1)) throw badRequest('Invalid customIntervalDays');
  return { type, daysOfWeek, timeSlots: slots, weekOfMonth, customIntervalDays };
}

function assertTimeSlot(value: unknown): LessonTimeSlot {
  if (!value || typeof value !== 'object') throw badRequest('Invalid time slot');
  const input = value as Record<string, unknown>;
  const slot = {
    dayOfWeek: Number(input.dayOfWeek),
    startHour: Number(input.startHour),
    startMinute: Number(input.startMinute),
    endHour: Number(input.endHour),
    endMinute: Number(input.endMinute),
  };
  if (!Number.isInteger(slot.dayOfWeek) || slot.dayOfWeek < 0 || slot.dayOfWeek > 6) throw badRequest('Invalid time slot dayOfWeek');
  if (!validClock(slot.startHour, slot.startMinute) || !validClock(slot.endHour, slot.endMinute)) throw badRequest('Invalid time slot clock');
  if (slot.endHour * 60 + slot.endMinute <= slot.startHour * 60 + slot.startMinute) throw badRequest('Time slot end must be after start');
  return slot;
}

function validClock(hour: number, minute: number) {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 && Number.isInteger(minute) && minute >= 0 && minute <= 59;
}
