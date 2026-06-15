import type {
  Attendance,
  Child,
  Family,
  LeaveRecord,
  Lesson,
  LessonChangeRecord,
  ReminderSettings,
  SuspensionPeriod,
  ThemePreference,
  TrainingClass,
  User,
} from "./types.js";
import type { AuthCredential, Session } from "./store.js";

export interface EntityRepository<T> {
  get(id: string): T | undefined;
  set(id: string, value: T): void;
  delete(id: string): boolean;
  values(): IterableIterator<T>;
}

export interface BackendRepositories {
  users: EntityRepository<User>;
  families: EntityRepository<Family>;
  children: EntityRepository<Child>;
  classes: EntityRepository<TrainingClass>;
  lessons: EntityRepository<Lesson>;
  attendance: EntityRepository<Attendance>;
  leaves: EntityRepository<LeaveRecord>;
  lessonChanges: EntityRepository<LessonChangeRecord>;
  sessions: EntityRepository<Session>;
  authCredentials: EntityRepository<AuthCredential>;
  suspensions: EntityRepository<SuspensionPeriod>;
  reminderSettings: EntityRepository<ReminderSettings>;
  themePreferences: EntityRepository<ThemePreference>;
  id(): string;
  reset(): void;
}
