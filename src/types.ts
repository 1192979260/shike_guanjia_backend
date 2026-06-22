export type FamilyRelation = 'mother' | 'father';
export type ClassStatus = 'active' | 'paused' | 'ended';
export type RecurringRuleType = 'weekly' | 'monthly' | 'custom';
export type LessonStatus = 'scheduled' | 'completed' | 'leave' | 'rescheduled' | 'cancelled';
export type LessonSourceType = 'generated' | 'manual_makeup';
export type LessonAttendanceStatus = 'pending' | 'checked_in' | 'missed_needs_makeup_checkin';
export type AttendanceType = 'checkin' | 'early_attempt' | 'backdated';
export type LeaveStatus = 'approved' | 'cancelled';
export type LessonChangeType = 'leave' | 'reschedule';
export type LessonChangeSource = 'student' | 'teacher' | 'institution' | 'holiday' | 'other';
export type LessonChangeLifecycleStatus = 'active' | 'cancelled';
export type LessonChangeStatus = 'normal' | 'leave' | 'rescheduled' | 'cancelled';
export type ThemeSkin = 'warm' | 'fresh' | 'classic';
export type ReminderSubscriptionStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';

export interface User {
  id: string;
  phone: string;
  nickname?: string | null;
  avatarUrl?: string | null;
  wechatOpenid?: string | null;
  createdAt: string;
}

export interface FamilyMember {
  id: string;
  userId: string;
  relation: FamilyRelation;
  displayName?: string | null;
  createdAt: string;
}

export interface Family {
  id: string;
  name: string;
  members: FamilyMember[];
}

export interface Child {
  id: string;
  name: string;
  age?: number | null;
  avatarUrl?: string | null;
  familyId: string;
  createdAt: string;
}

export interface LessonTimeSlot {
  dayOfWeek: number;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

export interface RecurringRule {
  type: RecurringRuleType;
  daysOfWeek: number[];
  timeSlots: LessonTimeSlot[];
  weekOfMonth?: number | null;
  customIntervalDays?: number | null;
}

export interface TrainingClass {
  id: string;
  childId: string;
  familyId: string;
  institutionName: string;
  className: string;
  courseName: string;
  teacherName?: string | null;
  teacherPhone?: string | null;
  totalHours: number;
  historicalUsedHours?: number | null;
  usedHours: number;
  remainingHours: number;
  totalFee: number;
  startTime: string;
  endTime?: string | null;
  recurringRule: RecurringRule;
  status: ClassStatus;
  createdAt: string;
  updatedAt?: string | null;
  notes?: string | null;
}

export interface Lesson {
  id: string;
  classId: string;
  scheduledDate: string;
  scheduledEndDate?: string | null;
  status: LessonStatus;
  sourceType?: LessonSourceType | null;
  attendanceStatus?: LessonAttendanceStatus | null;
  changeStatus?: LessonChangeStatus | null;
  actualDate?: string | null;
  checkinTime?: string | null;
  isMakeup: boolean;
  notes?: string | null;
  leaveReason?: string | null;
  isManual?: boolean;
  originLessonId?: string | null;
  changeBatchId?: string | null;
}

export interface Attendance {
  id: string;
  lessonId: string;
  classId: string;
  childId: string;
  checkinTime: string;
  type: AttendanceType;
  actualStartTime?: string | null;
  actualEndTime?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface LeaveRecord {
  id: string;
  lessonId: string;
  classId: string;
  childId: string;
  requestTime: string;
  status: LeaveStatus;
  reason?: string | null;
  makeupLessonId?: string | null;
  createdAt: string;
}


export interface LessonChangeRecord {
  id: string;
  lessonId: string;
  classId: string;
  childId: string;
  type: LessonChangeType;
  source: LessonChangeSource;
  reason?: string | null;
  description?: string | null;
  originalStartAt: string;
  originalEndAt?: string | null;
  newScheduledDate?: string | null;
  newScheduledEndDate?: string | null;
  makeupLessonId?: string | null;
  replacementLessonId?: string | null;
  newLessonId?: string | null;
  status: LessonChangeLifecycleStatus;
  createdAt: string;
}

export interface LessonHomePayload {
  todayLessons: Lesson[];
  needsBackfillLessons: Lesson[];
}

export interface SuspensionPeriod {
  id: string;
  classId: string;
  start: string;
  end: string;
}

export interface ReminderSettings {
  familyId: string;
  enabled: boolean;
  advanceMinutes: number;
  includeTodayLessons: boolean;
  includeMakeupLessons: boolean;
  updatedAt: string;
}

export interface LessonReminderSubscription {
  id: string;
  familyId: string;
  userId: string;
  lessonId: string;
  templateId: string;
  advanceMinutes: number;
  scheduledAt: string;
  remindAt: string;
  page?: string | null;
  status: ReminderSubscriptionStatus;
  sentAt?: string | null;
  failureReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ThemePreference {
  userId: string;
  skin: ThemeSkin;
  updatedAt: string;
}

export interface MonthlyCostStatistics {
  id: string;
  familyId: string;
  childId?: string | null;
  classId?: string | null;
  year: number;
  month: number;
  totalAttendedLessons: number;
  totalLeaveLessons: number;
  totalCost: number;
  calculatedAt: string;
}

export interface ClassCostBreakdown {
  classId: string;
  className: string;
  childName: string;
  attendedLessons: number;
  leaveLessons: number;
  cost: number;
  percentage: number;
}

export interface CostTrendPoint {
  year: number;
  month: number;
  cost: number;
  lessonCount: number;
}
