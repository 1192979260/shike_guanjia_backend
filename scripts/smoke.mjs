const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';
const phone = `138${Date.now().toString().slice(-8)}`;
const password = 'smoke-test-123';

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers ?? {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${path} failed: ${JSON.stringify(payload)}`);
  return payload.data ?? payload;
}

const register = await request('/api/auth/register', { method: 'POST', body: { phone, password } });
const token = register.token;
const child = await request('/api/children', { method: 'POST', token, body: { name: '小宝', age: 6 } });
const trainingClass = await request('/api/classes', {
  method: 'POST',
  token,
  body: {
    childId: child.id,
    institutionName: '星星美术',
    className: '大班A',
    courseName: '美术启蒙',
    totalHours: 4,
    totalFee: 400,
    startTime: '2026-06-15T09:00:00.000',
    recurringRule: {
      type: 'weekly',
      daysOfWeek: [1],
      timeSlots: [{ dayOfWeek: 1, startHour: 9, startMinute: 0, endHour: 10, endMinute: 0 }],
      weekOfMonth: 1,
      customIntervalDays: null,
    },
  },
});
const lessons = await request(`/api/classes/${trainingClass.id}/lessons`, { token });
await request('/api/attendance/check-in', { method: 'POST', token, body: { lessonId: lessons[0].id, type: 'checkin' } });
const leave = await request('/api/leaves', {
  method: 'POST',
  token,
  body: {
    lessonId: lessons[1].id,
    reason: '生病',
    scheduledDate: '2026-06-24T09:00:00.000',
    scheduledEndDate: '2026-06-24T10:00:00.000',
  },
});
const cost = await request('/api/cost/monthly?year=2026&month=6', { token });

console.log(JSON.stringify({ user: register.user.phone, child: child.name, classId: trainingClass.id, lessonCount: lessons.length, leaveId: leave.id, totalCost: cost.totalCost }, null, 2));
