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
  LessonReminderSubscription,
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
  reminderSubscriptions = new Map<string, LessonReminderSubscription>();
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
    this.reminderSubscriptions.clear();
    this.themePreferences.clear();
  }

  async refresh() {}

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
  reminderSubscriptions: LessonReminderSubscription[];
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
      this.reminderSubscriptions = new PersistedMap(
        snapshot.reminderSubscriptions?.map((item) => [item.id, item]) ?? [],
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
      reminderSubscriptions: [...this.reminderSubscriptions.values()],
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
      "reminderSubscriptions",
      this.reminderSubscriptions,
      (item: LessonReminderSubscription) => item.id,
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
    this.reminderSubscriptions = this.persistedMap(
      "reminderSubscriptions",
      this.reminderSubscriptions,
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
  private refreshing = false;

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
      await this.pool.execute("DELETE FROM lessons");
      await this.pool.execute("DELETE FROM classes");
      await this.pool.execute("DELETE FROM children");
      await this.pool.execute("DELETE FROM family_members");
      await this.pool.execute("DELETE FROM families");
      await this.pool.execute("DELETE FROM users");
      await this.pool.execute("DELETE FROM auth_credentials");
      await this.pool.execute("DELETE FROM kv_store");
    });
  }

  override async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      await this.waitForIdle();
      await this.refreshCoreTables();
    } finally {
      this.refreshing = false;
    }
  }

  override async waitForIdle() {
    await this.pendingWrite;
  }

  async close() {
    await this.waitForIdle();
    await this.pool.end();
  }

  private async initialize() {
    await this.createCoreTables();
    await this.dropCoreForeignKeys();
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS kv_store (
        collection VARCHAR(64) NOT NULL,
        id VARCHAR(191) NOT NULL,
        value JSON NOT NULL,
        PRIMARY KEY (collection, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await this.migrateCoreCollectionsFromKv();
    await this.refreshCoreTables();
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
      "reminderSubscriptions",
      this.reminderSubscriptions,
      (item: LessonReminderSubscription) => item.id,
    );
    await this.loadCollection(
      "themePreferences",
      this.themePreferences,
      (item: ThemePreference) => item.userId,
    );
    this.wrapKvMaps();
  }

  private async createCoreTables() {
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        phone VARCHAR(32) NOT NULL UNIQUE,
        nickname VARCHAR(255) NULL,
        avatar_url TEXT NULL,
        wechat_openid VARCHAR(191) NULL,
        created_at VARCHAR(64) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await this.addColumnIfMissing("users", "wechat_openid", "VARCHAR(191) NULL");
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS families (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        name VARCHAR(255) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS family_members (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        family_id VARCHAR(191) NOT NULL,
        user_id VARCHAR(191) NOT NULL UNIQUE,
        relation VARCHAR(32) NOT NULL,
        display_name VARCHAR(255) NULL,
        created_at VARCHAR(64) NOT NULL,
        INDEX idx_family_members_family_id (family_id),
        INDEX idx_family_members_user_id (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS children (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        family_id VARCHAR(191) NOT NULL,
        name VARCHAR(255) NOT NULL,
        age INT NULL,
        avatar_url TEXT NULL,
        created_at VARCHAR(64) NOT NULL,
        INDEX idx_children_family_id (family_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS classes (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        child_id VARCHAR(191) NOT NULL,
        family_id VARCHAR(191) NOT NULL,
        institution_name VARCHAR(255) NOT NULL,
        class_name VARCHAR(255) NOT NULL,
        course_name VARCHAR(255) NOT NULL,
        teacher_name VARCHAR(255) NULL,
        teacher_phone VARCHAR(32) NULL,
        total_hours DOUBLE NOT NULL,
        used_hours DOUBLE NOT NULL,
        remaining_hours DOUBLE NOT NULL,
        total_fee DOUBLE NOT NULL,
        start_time VARCHAR(64) NOT NULL,
        end_time VARCHAR(64) NULL,
        recurring_rule JSON NOT NULL,
        status VARCHAR(32) NOT NULL,
        created_at VARCHAR(64) NOT NULL,
        updated_at VARCHAR(64) NULL,
        notes TEXT NULL,
        INDEX idx_classes_family_id (family_id),
        INDEX idx_classes_child_id (child_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS lessons (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        class_id VARCHAR(191) NOT NULL,
        scheduled_date VARCHAR(64) NOT NULL,
        scheduled_end_date VARCHAR(64) NULL,
        status VARCHAR(32) NOT NULL,
        actual_date VARCHAR(64) NULL,
        checkin_time VARCHAR(64) NULL,
        is_makeup BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT NULL,
        leave_reason TEXT NULL,
        is_manual BOOLEAN NULL,
        INDEX idx_lessons_class_id (class_id),
        INDEX idx_lessons_scheduled_date (scheduled_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS auth_credentials (
        phone VARCHAR(32) NOT NULL PRIMARY KEY,
        password_hash VARCHAR(255) NOT NULL,
        salt VARCHAR(255) NOT NULL,
        created_at VARCHAR(64) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  private async dropCoreForeignKeys() {
    await this.dropForeignKeyIfExists("family_members", "fk_family_members_family");
    await this.dropForeignKeyIfExists("family_members", "fk_family_members_user");
    await this.dropForeignKeyIfExists("children", "fk_children_family");
    await this.dropForeignKeyIfExists("classes", "fk_classes_family");
    await this.dropForeignKeyIfExists("classes", "fk_classes_child");
    await this.dropForeignKeyIfExists("lessons", "fk_lessons_class");
  }

  private async dropForeignKeyIfExists(table: string, constraint: string) {
    try {
      await this.pool.execute(`ALTER TABLE ${table} DROP FOREIGN KEY ${constraint}`);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "ER_CANT_DROP_FIELD_OR_KEY") throw error;
    }
  }

  private async addColumnIfMissing(table: string, column: string, definition: string) {
    try {
      await this.pool.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "ER_DUP_FIELDNAME") throw error;
    }
  }

  private async migrateCoreCollectionsFromKv() {
    const users = await this.loadKvCollection<User>("users");
    const families = await this.loadKvCollection<Family>("families");
    const children = await this.loadKvCollection<Child>("children");
    const classes = await this.loadKvCollection<TrainingClass>("classes");
    const lessons = await this.loadKvCollection<Lesson>("lessons");
    const authCredentials =
      await this.loadKvCollection<AuthCredential>("authCredentials");

    for (const item of users) await this.setCoreRecordNow("users", item.id, item);

    const referencedFamilyIds = new Set<string>([
      ...children.map((item) => item.familyId),
      ...classes.map((item) => item.familyId),
    ]);
    const orderedFamilies = [...families].sort((a, b) => {
      const aReferenced = referencedFamilyIds.has(a.id);
      const bReferenced = referencedFamilyIds.has(b.id);
      return Number(aReferenced) - Number(bReferenced);
    });
    for (const item of orderedFamilies)
      await this.setCoreRecordNow("families", item.id, item);

    for (const item of children)
      await this.setCoreRecordNow("children", item.id, item);
    for (const item of classes)
      await this.setCoreRecordNow("classes", item.id, item);
    for (const item of lessons)
      await this.setCoreRecordNow("lessons", item.id, item);
    for (const item of authCredentials)
      await this.setCoreRecordNow("authCredentials", item.phone, item);
  }

  private async loadKvCollection<T>(collection: string) {
    const [rows] = await this.pool.query<KvRow[]>(
      "SELECT value FROM kv_store WHERE collection = ?",
      [collection],
    );
    return rows.map(
      (row) => normalizeStoredDates(parseStoredValue(row.value)) as T,
    );
  }

  private async refreshCoreTables() {
    const users = await this.loadUsersTable();
    const families = await this.loadFamiliesTable();
    const children = await this.loadChildrenTable();
    const classes = await this.loadClassesTable();
    const lessons = await this.loadLessonsTable();
    const authCredentials = await this.loadAuthCredentialsTable();

    this.users = this.persistedMap("users", users);
    this.families = this.persistedMap("families", families);
    this.children = this.persistedMap("children", children);
    this.classes = this.persistedMap("classes", classes);
    this.lessons = this.persistedMap("lessons", lessons);
    this.authCredentials = this.persistedMap(
      "authCredentials",
      authCredentials,
    );
  }

  private async loadUsersTable() {
    const [rows] = await this.pool.query<RowDataPacket[]>("SELECT * FROM users");
    return new Map(
      rows.map((row) => [
        String(row.id),
        normalizeStoredDates({
          id: row.id,
          phone: row.phone,
          nickname: row.nickname,
          avatarUrl: row.avatar_url,
          wechatOpenid: row.wechat_openid,
          createdAt: row.created_at,
        }) as User,
      ]),
    );
  }

  private async loadFamiliesTable() {
    const [familyRows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM families",
    );
    const [memberRows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM family_members ORDER BY created_at ASC",
    );
    const families = new Map<string, Family>();
    for (const row of familyRows) {
      families.set(String(row.id), {
        id: row.id,
        name: row.name,
        members: [],
      });
    }
    for (const row of memberRows) {
      const family = families.get(String(row.family_id));
      if (!family) continue;
      family.members.push(
        normalizeStoredDates({
          id: row.id,
          userId: row.user_id,
          relation: row.relation,
          displayName: row.display_name,
          createdAt: row.created_at,
        }) as Family["members"][number],
      );
    }
    return families;
  }

  private async loadChildrenTable() {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM children",
    );
    return new Map(
      rows.map((row) => [
        String(row.id),
        normalizeStoredDates({
          id: row.id,
          name: row.name,
          age: row.age,
          avatarUrl: row.avatar_url,
          familyId: row.family_id,
          createdAt: row.created_at,
        }) as Child,
      ]),
    );
  }

  private async loadClassesTable() {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM classes",
    );
    return new Map(
      rows.map((row) => [
        String(row.id),
        normalizeStoredDates({
          id: row.id,
          childId: row.child_id,
          familyId: row.family_id,
          institutionName: row.institution_name,
          className: row.class_name,
          courseName: row.course_name,
          teacherName: row.teacher_name,
          teacherPhone: row.teacher_phone,
          totalHours: Number(row.total_hours),
          usedHours: Number(row.used_hours),
          remainingHours: Number(row.remaining_hours),
          totalFee: Number(row.total_fee),
          startTime: row.start_time,
          endTime: row.end_time,
          recurringRule: parseStoredValue(row.recurring_rule),
          status: row.status,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          notes: row.notes,
        }) as TrainingClass,
      ]),
    );
  }

  private async loadLessonsTable() {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM lessons",
    );
    return new Map(
      rows.map((row) => [
        String(row.id),
        normalizeStoredDates({
          id: row.id,
          classId: row.class_id,
          scheduledDate: row.scheduled_date,
          scheduledEndDate: row.scheduled_end_date,
          status: row.status,
          actualDate: row.actual_date,
          checkinTime: row.checkin_time,
          isMakeup: Boolean(row.is_makeup),
          notes: row.notes,
          leaveReason: row.leave_reason,
          isManual:
            row.is_manual === null || row.is_manual === undefined
              ? undefined
              : Boolean(row.is_manual),
        }) as Lesson,
      ]),
    );
  }

  private async loadAuthCredentialsTable() {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM auth_credentials",
    );
    return new Map(
      rows.map((row) => [
        String(row.phone),
        {
          phone: row.phone,
          passwordHash: row.password_hash,
          salt: row.salt,
          createdAt: row.created_at,
        } as AuthCredential,
      ]),
    );
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

  private wrapKvMaps() {
    this.attendance = this.persistedMap("attendance", this.attendance);
    this.leaves = this.persistedMap("leaves", this.leaves);
    this.lessonChanges = this.persistedMap(
      "lesson_changes",
      this.lessonChanges,
    );
    this.sessions = this.persistedMap("sessions", this.sessions);
    this.suspensions = this.persistedMap("suspensions", this.suspensions);
    this.reminderSettings = this.persistedMap(
      "reminderSettings",
      this.reminderSettings,
    );
    this.reminderSubscriptions = this.persistedMap(
      "reminderSubscriptions",
      this.reminderSubscriptions,
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
      if (this.isCoreCollection(collection)) {
        await this.deleteCoreCollectionNow(collection);
        for (const [key, value] of source.entries())
          await this.setCoreRecordNow(collection, key, value);
        return;
      }
      await this.pool.execute("DELETE FROM kv_store WHERE collection = ?", [
        collection,
      ]);
      for (const [key, value] of source.entries())
        await this.setRecordNow(collection, key, value);
    });
  }

  private setRecord<T>(collection: string, key: string, value: T) {
    this.enqueueWrite(() =>
      this.isCoreCollection(collection)
        ? this.setCoreRecordNow(collection, key, value)
        : this.setRecordNow(collection, key, value),
    );
  }

  private async setRecordNow<T>(collection: string, key: string, value: T) {
    await this.pool.execute(
      "INSERT INTO kv_store (collection, id, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
      [collection, key, JSON.stringify(value)],
    );
  }

  private deleteRecord(collection: string, key: string) {
    this.enqueueWrite(async () => {
      if (this.isCoreCollection(collection)) {
        await this.deleteCoreRecordNow(collection, key);
        return;
      }
      await this.pool.execute(
        "DELETE FROM kv_store WHERE collection = ? AND id = ?",
        [collection, key],
      );
    });
  }

  private isCoreCollection(collection: string) {
    return (
      collection === "users" ||
      collection === "families" ||
      collection === "children" ||
      collection === "classes" ||
      collection === "lessons" ||
      collection === "authCredentials"
    );
  }

  private async deleteCoreCollectionNow(collection: string) {
    const table = this.coreTableName(collection);
    await this.pool.execute(`DELETE FROM ${table}`);
  }

  private async deleteCoreRecordNow(collection: string, key: string) {
    if (collection === "authCredentials") {
      await this.pool.execute("DELETE FROM auth_credentials WHERE phone = ?", [
        key,
      ]);
      return;
    }
    await this.pool.execute(`DELETE FROM ${this.coreTableName(collection)} WHERE id = ?`, [
      key,
    ]);
  }

  private coreTableName(collection: string) {
    switch (collection) {
      case "users":
        return "users";
      case "families":
        return "families";
      case "children":
        return "children";
      case "classes":
        return "classes";
      case "lessons":
        return "lessons";
      case "authCredentials":
        return "auth_credentials";
      default:
        throw new Error(`Unknown core collection: ${collection}`);
    }
  }

  private async setCoreRecordNow<T>(
    collection: string,
    key: string,
    value: T,
  ) {
    if (collection === "users") {
      const item = value as User;
      await this.pool.execute(
        `INSERT INTO users (id, phone, nickname, avatar_url, wechat_openid, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           phone = VALUES(phone),
           nickname = VALUES(nickname),
           avatar_url = VALUES(avatar_url),
           wechat_openid = VALUES(wechat_openid),
           created_at = VALUES(created_at)`,
        [
          item.id,
          item.phone,
          item.nickname ?? null,
          item.avatarUrl ?? null,
          item.wechatOpenid ?? null,
          item.createdAt,
        ],
      );
      return;
    }
    if (collection === "families") {
      const item = value as Family;
      await this.pool.execute(
        `INSERT INTO families (id, name)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name)`,
        [item.id, item.name],
      );
      await this.pool.execute("DELETE FROM family_members WHERE family_id = ?", [
        item.id,
      ]);
      for (const member of item.members) {
        await this.pool.execute(
          `INSERT INTO family_members
             (id, family_id, user_id, relation, display_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             family_id = VALUES(family_id),
             relation = VALUES(relation),
             display_name = VALUES(display_name),
             created_at = VALUES(created_at)`,
          [
            member.id,
            item.id,
            member.userId,
            member.relation,
            member.displayName ?? null,
            member.createdAt,
          ],
        );
      }
      return;
    }
    if (collection === "children") {
      const item = value as Child;
      await this.pool.execute(
        `INSERT INTO children (id, family_id, name, age, avatar_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           family_id = VALUES(family_id),
           name = VALUES(name),
           age = VALUES(age),
           avatar_url = VALUES(avatar_url),
           created_at = VALUES(created_at)`,
        [
          item.id,
          item.familyId,
          item.name,
          item.age ?? null,
          item.avatarUrl ?? null,
          item.createdAt,
        ],
      );
      return;
    }
    if (collection === "classes") {
      const item = value as TrainingClass;
      await this.pool.execute(
        `INSERT INTO classes
          (id, child_id, family_id, institution_name, class_name, course_name,
           teacher_name, teacher_phone, total_hours, used_hours,
           remaining_hours, total_fee, start_time, end_time, recurring_rule,
           status, created_at, updated_at, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           child_id = VALUES(child_id),
           family_id = VALUES(family_id),
           institution_name = VALUES(institution_name),
           class_name = VALUES(class_name),
           course_name = VALUES(course_name),
           teacher_name = VALUES(teacher_name),
           teacher_phone = VALUES(teacher_phone),
           total_hours = VALUES(total_hours),
           used_hours = VALUES(used_hours),
           remaining_hours = VALUES(remaining_hours),
           total_fee = VALUES(total_fee),
           start_time = VALUES(start_time),
           end_time = VALUES(end_time),
           recurring_rule = VALUES(recurring_rule),
           status = VALUES(status),
           created_at = VALUES(created_at),
           updated_at = VALUES(updated_at),
           notes = VALUES(notes)`,
        [
          item.id,
          item.childId,
          item.familyId,
          item.institutionName,
          item.className,
          item.courseName,
          item.teacherName ?? null,
          item.teacherPhone ?? null,
          item.totalHours,
          item.usedHours,
          item.remainingHours,
          item.totalFee,
          item.startTime,
          item.endTime ?? null,
          JSON.stringify(item.recurringRule),
          item.status,
          item.createdAt,
          item.updatedAt ?? null,
          item.notes ?? null,
        ],
      );
      return;
    }
    if (collection === "lessons") {
      const item = value as Lesson;
      await this.pool.execute(
        `INSERT INTO lessons
          (id, class_id, scheduled_date, scheduled_end_date, status,
           actual_date, checkin_time, is_makeup, notes, leave_reason, is_manual)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           class_id = VALUES(class_id),
           scheduled_date = VALUES(scheduled_date),
           scheduled_end_date = VALUES(scheduled_end_date),
           status = VALUES(status),
           actual_date = VALUES(actual_date),
           checkin_time = VALUES(checkin_time),
           is_makeup = VALUES(is_makeup),
           notes = VALUES(notes),
           leave_reason = VALUES(leave_reason),
           is_manual = VALUES(is_manual)`,
        [
          item.id,
          item.classId,
          item.scheduledDate,
          item.scheduledEndDate ?? null,
          item.status,
          item.actualDate ?? null,
          item.checkinTime ?? null,
          item.isMakeup,
          item.notes ?? null,
          item.leaveReason ?? null,
          item.isManual ?? null,
        ],
      );
      return;
    }
    if (collection === "authCredentials") {
      const item = value as AuthCredential;
      await this.pool.execute(
        `INSERT INTO auth_credentials (phone, password_hash, salt, created_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           password_hash = VALUES(password_hash),
           salt = VALUES(salt),
           created_at = VALUES(created_at)`,
        [item.phone, item.passwordHash, item.salt, item.createdAt],
      );
    }
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
