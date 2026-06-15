export function parseLocalDateTime(value: unknown, field: string): Date {
  if (typeof value !== 'string') throw new Error(`${field} must be a date string`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} is invalid`);
  return date;
}

export function toLocalIso(date: Date) {
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function nowLocalIso() {
  return toLocalIso(new Date());
}

export function normalizeDateString(value: string) {
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) return value;
  return toLocalIso(new Date(value));
}
