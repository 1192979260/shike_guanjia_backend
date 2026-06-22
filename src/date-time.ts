export const BUSINESS_TIMEZONE_OFFSET_MINUTES = 8 * 60;
const LOCAL_DATE_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

const hasExplicitTimezone = (value: string) => /[zZ]|[+-]\d{2}:?\d{2}$/.test(value);

export function parseLocalDateTime(value: unknown, field: string): Date {
  if (typeof value !== "string") throw new Error(`${field} must be a date string`);
  return parseBusinessDateTime(value, field);
}

export function parseBusinessDateTime(value: string, field = "date"): Date {
  const localMatch = value.match(LOCAL_DATE_TIME_RE);
  if (localMatch && !hasExplicitTimezone(value)) {
    const [
      ,
      yearText,
      monthText,
      dayText,
      hourText,
      minuteText,
      secondText = "0",
      millisecondText = "0",
    ] = localMatch;

    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const millisecond = Number(millisecondText.padEnd(3, "0"));
    const utcMillis =
      Date.UTC(year, month - 1, day, hour, minute, second, millisecond) -
      BUSINESS_TIMEZONE_OFFSET_MINUTES * 60_000;
    const date = new Date(utcMillis);
    if (Number.isNaN(date.getTime())) throw new Error(`${field} is invalid`);
    return date;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} is invalid`);
  return date;
}

export function toLocalIso(date: Date) {
  const shifted = new Date(
    date.getTime() + BUSINESS_TIMEZONE_OFFSET_MINUTES * 60_000,
  );
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}.${pad(shifted.getUTCMilliseconds(), 3)}`;
}

export function nowLocalIso() {
  return toLocalIso(new Date());
}

export function normalizeDateString(value: string) {
  return toLocalIso(parseBusinessDateTime(value));
}

export function businessTimestamp(value: string | Date) {
  return (typeof value === "string" ? parseBusinessDateTime(value) : value).getTime();
}

export function businessDateParts(date: Date) {
  const shifted = new Date(date.getTime() + BUSINESS_TIMEZONE_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    millisecond: shifted.getUTCMilliseconds(),
    dayOfWeek: shifted.getUTCDay(),
  };
}

export function businessDateFromParts(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
) {
  return new Date(
    Date.UTC(year, month, day, hour, minute, second, millisecond) -
      BUSINESS_TIMEZONE_OFFSET_MINUTES * 60_000,
  );
}

export function businessStartOfDay(date = new Date()) {
  const parts = businessDateParts(date);
  return businessDateFromParts(parts.year, parts.month, parts.day);
}

export function businessEndOfDay(date = new Date()) {
  const parts = businessDateParts(date);
  return businessDateFromParts(parts.year, parts.month, parts.day, 23, 59, 59, 999);
}

export function businessAddDays(date: Date, days: number) {
  const parts = businessDateParts(date);
  return businessDateFromParts(
    parts.year,
    parts.month,
    parts.day + days,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
}

export function businessAddMonths(date: Date, months: number) {
  const parts = businessDateParts(date);
  return businessDateFromParts(
    parts.year,
    parts.month + months,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
}

export function businessMonthStart(date = new Date()) {
  const parts = businessDateParts(date);
  return businessDateFromParts(parts.year, parts.month, 1);
}
