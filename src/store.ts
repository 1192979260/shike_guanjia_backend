import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";
import type { BackendRepositories } from "./repositories.js";
import { normalizeDateString } from "./date-time.js";
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

export interface Session {
  token: string;
  userId: string;
  createdAt: string;
}

export interface AuthCredential {
  phone: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
}

export class MemoryStore implements BackendRepositories {
  users = new Map<string, User>();
  families = new Map<string, Family>();
  children = new Map<string, Child>();
  classes = new Map<string, TrainingClass>();
  lessons = new Map<string, Lesson>();
  attendance = new Map<string, Attendance>();
  leaves = new Map<string, LeaveRecord>();
  lessonChanges = new Map<string, LessonChangeRecord>();
  sessions = new Map<string, Session>();
  authCredentials = new Map<string, AuthCredential>();
  suspensions = new Map<string, SuspensionPeriod>();
  reminderSettings = new Map<string, ReminderSettings>();
  themePreferences = new Map<string, ThemePreference>();

  id() {
    return randomUUID();
  }

  reset() {
    this.users.clear();
    this.families.clear();
    this.children.clear();
    this.classes.clear();
    this.lessons.clear();
    this.attendance.clear();
    this.leaves.clear();
    this.lessonChanges.clear();
    this.sessions.clear();
    this.authCredentials.clear();
    this.suspensions.clear();
    this.reminderSettings.clear();
    this.themePreferences.clear();
  }

  async waitForIdle() {}
}

interface StoreSnapshot {
  users: User[];
  families: Family[];
  children: Child[];
  classes: TrainingClass[];
  lessons: Lesson[];
  attendance: Attendance[];
  leaves: LeaveRecord[];
  lessonChanges: LessonChangeRecord[];
  sessions: Session[];
  authCredentials: AuthCredential[];
  suspensions: SuspensionPeriod[];
  reminderSettings: ReminderSettings[];
  themePreferences: ThemePreference[];
}

export class FileStore extends MemoryStore {
  private loading = false;

  constructor(private filePath: string) {
    super();
    this.load();
  }

  override id() {
    return super.id();
  }

  override reset() {
    super.reset();
    this.persist();
  }

  persist() {
    if (this.loading) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.snapshot(), null, 2));
  }

  private load() {
    if (!existsSync(this.filePath)) return;
    this.loading = true;
    try {
      const snapshot = JSON.parse(
        readFileSync(this.filePath, "utf8"),
      ) as Partial<StoreSnapshot>;
      this.users = new PersistedMap(
        snapshot.users?.map((item) => [item.id, item]) ?? [],
        () => this.persist(),
      );
      this.families = new PersistedMap(
        snapshot.families?.map((item) => [item.id, item]) ?? [],
        () => this.persist(),
      );
      this.children = new PersistedMap(
        snapshot.children?.map((item) => [item.id, item]) ?? [],
        () => this.persist(),
      );
      this.classes = new PersistedMap(
        snapshot.classes?.map((item) => [item.id, item]) ?? [],
        () => this.persist(),
      );
      this.lessons = new PersistedMap(
        snapshot.lessons?.map((item) => [item.id, item]) ?? [],
        () => this.persist(),
      );
      this.attendance = new PersistedMap(
        snapshot.attendance?.map((item) => [item.id, item]) ?? [],
        () => this.persist(),
      );
      this.leaves = new PersistedMap(
        snapshot.leaves?.map((item) => [item.id, item]) ?? [],
        () => this.persist(),
      );
      this.lessonChanges = new PersistedMap(
        snapshot.lessonChanges?.map((item) => [item.id, item]) ?? [],
        () => this.persist(),
      );
      this.sessions = new PersistedMap(
        snapshot.sessions?.map((item) => [item.token, item]) ?? [],
        () => this.persist(),
      );
      this.authCredentials = new PersistedMap(
        snapshot.authCredentials?.map((item) => [item.phone, item]) ?? [],
        () => this.persist(),
      );
      this.suspensions = new PersistedMap(
        snapshot.suspensions?.map((item) => [item.id, item]) ?? [],
        () => this.persist(),
      );
      this.reminderSettings = new PersistedMap(
        snapshot.reminderSettings?.map((item) => [item.familyId, item]) ?? [],
        () => this.persist(),
      );
      this.themePreferences = new PersistedMap(
        snapshot.themePreferences?.map((item) => [item.userId, item]) ?? [],
        () => this.persist(),
      );
    } finally {
      this.loading = false;
    }
  }

  private snapshot(): StoreSnapshot {
    return {
      users: [...this.users.values()],
      families: [...this.families.values()],
      children: [...this.children.values()],
      classes: [...this.classes.values()],
      lessons: [...this.lessons.values()],
      attendance: [...this.attendance.values()],
      leaves: [...this.leaves.values()],
      lessonChanges: [...this.lessonChanges.values()],
      sessions: [...this.sessions.values()],
      authCredentials: [...this.authCredentials.values()],
      suspensions: [...this.suspensions.values()],
      reminderSettings: [...this.reminderSettings.values()],
      themePreferences: [...this.themePreferences.values()],
    };
  }
}

class PersistedMap<K, V> extends Map<K, V> {
  private onChange: () => void;
  private onSet?: (key: K, value: V) => void;
  private onDelete?: (key: K) => void;

  constructor(
    entries: readonly (readonly [K, V])[],
    onChange: () => void,
    onSet?: (key: K, value: V) => void,
    onDelete?: (key: K) => void,
  ) {
    super();
    this.onChange = onChange;
    this.onSet = onSet;
    this.onDelete = onDelete;
    for (const [key, value] of entries) super.set(key, value);
  }

  override set(key: K, value: V): this {
    super.set(key, value);
    if (this.onSet) this.onSet(key, value);
    else this.onChange();
    return this;
  }

  override delete(key: K): boolean {
    const result = super.delete(key);
    if (result) {
      if (this.onDelete) this.onDelete(key);
      else this.onChange();
    }
    return result;
  }

  override clear(): void {
    if (this.size === 0) return;
    super.clear();
    this.onChange();
  }
}

export class SqliteStore extends MemoryStore {
  private db: DatabaseSync;
  private loading = false;

  constructor(private filePath: string) {
    super();
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv_store (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );
    `);
    this.loadCollection("users", this.users, (item: User) => item.id);
    this.loadCollection("families", this.families, (item: Family) => item.id);
    this.loadCollection("children", this.children, (item: Child) => item.id);
    this.loadCollection(
      "classes",
      this.classes,
      (item: TrainingClass) => item.id,
    );
    this.loadCollection("lessons", this.lessons, (item: Lesson) => item.id);
    this.loadCollection(
      "attendance",
      this.attendance,
      (item: Attendance) => item.id,
    );
    this.loadCollection("leaves", this.leaves, (item: LeaveRecord) => item.id);
    this.loadCollection(
      "lesson_changes",
      this.lessonChanges,
      (item: LessonChangeRecord) => item.id,
    );
    this.loadCollection(
      "sessions",
      this.sessions,
      (item: Session) => item.token,
    );
    this.loadCollection(
      "authCredentials",
      this.authCredentials,
      (item: AuthCredential) => item.phone,
    );
    this.loadCollection(
      "suspensions",
      this.suspensions,
      (item: SuspensionPeriod) => item.id,
    );
    this.loadCollection(
      "reminderSettings",
      this.reminderSettings,
      (item: ReminderSettings) => item.familyId,
    );
    this.loadCollection(
      "themePreferences",
      this.themePreferences,
      (item: ThemePreference) => item.userId,
    );
    this.wrapMaps();
  }

  override reset() {
    super.reset();
    this.db.exec("DELETE FROM kv_store");
  }

  private loadCollection<T>(
    collection: string,
    target: Map<string, T>,
    getId: (item: T) => string,
  ) {
    this.loading = true;
    try {
      const rows = this.db
        .prepare("SELECT value FROM kv_store WHERE collection = ?")
        .all(collection) as Array<{ value: string }>;
      for (const row of rows) {
        const item = normalizeStoredDates(JSON.parse(row.value)) as T;
        target.set(getId(item), item);
      }
    } finally {
      this.loading = false;
    }
  }

  private wrapMaps() {
    this.users = this.persistedMap("users", this.users);
    this.families = this.persistedMap("families", this.families);
    this.children = this.persistedMap("children", this.children);
    this.classes = this.persistedMap("classes", this.classes);
    this.lessons = this.persistedMap("lessons", this.lessons);
    this.attendance = this.persistedMap("attendance", this.attendance);
    this.leaves = this.persistedMap("leaves", this.leaves);
    this.lessonChanges = this.persistedMap(
      "lesson_changes",
      this.lessonChanges,
    );
    this.sessions = this.persistedMap("sessions", this.sessions);
    this.authCredentials = this.persistedMap(
      "authCredentials",
      this.authCredentials,
    );
    this.suspensions = this.persistedMap("suspensions", this.suspensions);
    this.reminderSettings = this.persistedMap(
      "reminderSettings",
      this.reminderSettings,
    );
    this.themePreferences = this.persistedMap(
      "themePreferences",
      this.themePreferences,
    );
  }

  private persistedMap<T>(collection: string, source: Map<string, T>) {
    return new PersistedMap<string, T>(
      [...source.entries()],
      () => {
        if (!this.loading) this.persistCollection(collection, source);
      },
      (key, value) => this.setRecord(collection, key, value),
      (key) => this.deleteRecord(collection, key),
    );
  }

  private persistCollection<T>(collection: string, source: Map<string, T>) {
    const deleteStmt = this.db.prepare(
      "DELETE FROM kv_store WHERE collection = ?",
    );
    deleteStmt.run(collection);
    for (const [key, value] of source.entries())
      this.setRecord(collection, key, value);
  }

  private setRecord<T>(collection: string, key: string, value: T) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO kv_store (collection, id, value) VALUES (?, ?, ?)",
      )
      .run(collection, key, JSON.stringify(value));
  }

  private deleteRecord(collection: string, key: string) {
    this.db
      .prepare("DELETE FROM kv_store WHERE collection = ? AND id = ?")
      .run(collection, key);
  }
}

interface KvRow extends RowDataPacket {
  id: string;
  value: unknown;
}

export class MysqlStore extends MemoryStore {
  private pendingWrite: Promise<void> = Promise.resolve();

  private constructor(private pool: Pool) {
    super();
  }

  static async create(databaseUrl: string) {
    const store = new MysqlStore(
      createPool({
        uri: databaseUrl,
        waitForConnections: true,
        connectionLimit: 5,
        namedPlaceholders: false,
      }),
    );
    await store.initialize();
    return store;
  }

  override reset() {
    super.reset();
    this.enqueueWrite(async () => {
      await this.pool.execute("DELETE FROM kv_store");
    });
  }

  override async waitForIdle() {
    await this.pendingWrite;
  }

  async close() {
    await this.waitForIdle();
    await this.pool.end();
  }

  private async initialize() {
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS kv_store (
        collection VARCHAR(64) NOT NULL,
        id VARCHAR(191) NOT NULL,
        value JSON NOT NULL,
        PRIMARY KEY (collection, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await this.loadCollection("users", this.users, (item: User) => item.id);
    await this.loadCollection(
      "families",
      this.families,
      (item: Family) => item.id,
    );
    await this.loadCollection(
      "children",
      this.children,
      (item: Child) => item.id,
    );
    await this.loadCollection(
      "classes",
      this.classes,
      (item: TrainingClass) => item.id,
    );
    await this.loadCollection(
      "lessons",
      this.lessons,
      (item: Lesson) => item.id,
    );
    await this.loadCollection(
      "attendance",
      this.attendance,
      (item: Attendance) => item.id,
    );
    await this.loadCollection(
      "leaves",
      this.leaves,
      (item: LeaveRecord) => item.id,
    );
    await this.loadCollection(
      "lesson_changes",
      this.lessonChanges,
      (item: LessonChangeRecord) => item.id,
    );
    await this.loadCollection(
      "sessions",
      this.sessions,
      (item: Session) => item.token,
    );
    await this.loadCollection(
      "authCredentials",
      this.authCredentials,
      (item: AuthCredential) => item.phone,
    );
    await this.loadCollection(
      "suspensions",
      this.suspensions,
      (item: SuspensionPeriod) => item.id,
    );
    await this.loadCollection(
      "reminderSettings",
      this.reminderSettings,
      (item: ReminderSettings) => item.familyId,
    );
    await this.loadCollection(
      "themePreferences",
      this.themePreferences,
      (item: ThemePreference) => item.userId,
    );
    this.wrapMaps();
  }

  private async loadCollection<T>(
    collection: string,
    target: Map<string, T>,
    getId: (item: T) => string,
  ) {
    const [rows] = await this.pool.query<KvRow[]>(
      "SELECT value FROM kv_store WHERE collection = ?",
      [collection],
    );
    for (const row of rows) {
      const item = normalizeStoredDates(parseStoredValue(row.value)) as T;
      target.set(getId(item), item);
    }
  }

  private wrapMaps() {
    this.users = this.persistedMap("users", this.users);
    this.families = this.persistedMap("families", this.families);
    this.children = this.persistedMap("children", this.children);
    this.classes = this.persistedMap("classes", this.classes);
    this.lessons = this.persistedMap("lessons", this.lessons);
    this.attendance = this.persistedMap("attendance", this.attendance);
    this.leaves = this.persistedMap("leaves", this.leaves);
    this.lessonChanges = this.persistedMap(
      "lesson_changes",
      this.lessonChanges,
    );
    this.sessions = this.persistedMap("sessions", this.sessions);
    this.authCredentials = this.persistedMap(
      "authCredentials",
      this.authCredentials,
    );
    this.suspensions = this.persistedMap("suspensions", this.suspensions);
    this.reminderSettings = this.persistedMap(
      "reminderSettings",
      this.reminderSettings,
    );
    this.themePreferences = this.persistedMap(
      "themePreferences",
      this.themePreferences,
    );
  }

  private persistedMap<T>(collection: string, source: Map<string, T>) {
    return new PersistedMap<string, T>(
      [...source.entries()],
      () => this.persistCollection(collection, source),
      (key, value) => this.setRecord(collection, key, value),
      (key) => this.deleteRecord(collection, key),
    );
  }

  private persistCollection<T>(collection: string, source: Map<string, T>) {
    this.enqueueWrite(async () => {
      await this.pool.execute("DELETE FROM kv_store WHERE collection = ?", [
        collection,
      ]);
      for (const [key, value] of source.entries())
        await this.setRecordNow(collection, key, value);
    });
  }

  private setRecord<T>(collection: string, key: string, value: T) {
    this.enqueueWrite(() => this.setRecordNow(collection, key, value));
  }

  private async setRecordNow<T>(collection: string, key: string, value: T) {
    await this.pool.execute(
      "INSERT INTO kv_store (collection, id, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
      [collection, key, JSON.stringify(value)],
    );
  }

  private deleteRecord(collection: string, key: string) {
    this.enqueueWrite(async () => {
      await this.pool.execute(
        "DELETE FROM kv_store WHERE collection = ? AND id = ?",
        [collection, key],
      );
    });
  }

  private enqueueWrite(task: () => Promise<void>) {
    this.pendingWrite = this.pendingWrite.then(task, task);
  }
}

function normalizeStoredDates(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeStoredDates);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] =
      typeof item === "string" && isDateField(key)
        ? normalizeDateString(item)
        : normalizeStoredDates(item);
  }
  return output;
}

function isDateField(key: string) {
  return (
    key.endsWith("At") ||
    key.endsWith("Time") ||
    key.endsWith("Date") ||
    key === "scheduledEndDate"
  );
}

function parseStoredValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return JSON.parse(value.toString("utf8"));
  if (typeof value === "string") return JSON.parse(value);
  return value;
}
