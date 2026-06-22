import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createPool, type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
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

/** How long the in-memory cache is considered fresh before a reload is forced.
 *  Bounds cross-instance staleness; within an instance the cache is always
 *  current because mutations are applied synchronously. */
const REFRESH_MAX_AGE_MS = 5_000;

export interface AuthCredential {
  phone: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
}

export class MemoryStore implements BackendRepositories {
  storageMode: string = "memory";
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

  /** No-op transaction wrapper for in-memory stores. Real stores flush buffered
   *  writes in a single DB transaction. */
  async runInTransaction<T>(fn: () => T | Promise<T>): Promise<T> {
    return fn();
  }

  async healthCheck(_deep = false): Promise<{ ok: boolean; storage: string }> {
    return { ok: true, storage: this.storageMode };
  }

  async close(): Promise<void> {}
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
  storageMode = "file";
  private loading = false;

  constructor(private filePath: string) {
    super();
    this.load();
    this.wrapMaps();
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
      this.users = new Map(snapshot.users?.map((item) => [item.id, item]) ?? []);
      this.families = new Map(snapshot.families?.map((item) => [item.id, item]) ?? []);
      this.children = new Map(snapshot.children?.map((item) => [item.id, item]) ?? []);
      this.classes = new Map(snapshot.classes?.map((item) => [item.id, item]) ?? []);
      this.lessons = new Map(snapshot.lessons?.map((item) => [item.id, item]) ?? []);
      this.attendance = new Map(snapshot.attendance?.map((item) => [item.id, item]) ?? []);
      this.leaves = new Map(snapshot.leaves?.map((item) => [item.id, item]) ?? []);
      this.lessonChanges = new Map(snapshot.lessonChanges?.map((item) => [item.id, item]) ?? []);
      this.sessions = new Map(snapshot.sessions?.map((item) => [item.token, item]) ?? []);
      this.authCredentials = new Map(snapshot.authCredentials?.map((item) => [item.phone, item]) ?? []);
      this.suspensions = new Map(snapshot.suspensions?.map((item) => [item.id, item]) ?? []);
      this.reminderSettings = new Map(snapshot.reminderSettings?.map((item) => [item.familyId, item]) ?? []);
      this.reminderSubscriptions = new Map(snapshot.reminderSubscriptions?.map((item) => [item.id, item]) ?? []);
      this.themePreferences = new Map(snapshot.themePreferences?.map((item) => [item.userId, item]) ?? []);
    } finally {
      this.loading = false;
    }
  }

  private wrapMaps() {
    this.users = this.persistedMap(this.users);
    this.families = this.persistedMap(this.families);
    this.children = this.persistedMap(this.children);
    this.classes = this.persistedMap(this.classes);
    this.lessons = this.persistedMap(this.lessons);
    this.attendance = this.persistedMap(this.attendance);
    this.leaves = this.persistedMap(this.leaves);
    this.lessonChanges = this.persistedMap(this.lessonChanges);
    this.sessions = this.persistedMap(this.sessions);
    this.authCredentials = this.persistedMap(this.authCredentials);
    this.suspensions = this.persistedMap(this.suspensions);
    this.reminderSettings = this.persistedMap(this.reminderSettings);
    this.reminderSubscriptions = this.persistedMap(this.reminderSubscriptions);
    this.themePreferences = this.persistedMap(this.themePreferences);
  }

  private persistedMap<T>(source: Map<string, T>) {
    return new PersistedMap<string, T>(
      [...source.entries()],
      () => this.persist(),
    );
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

interface KvRow extends RowDataPacket {
  id: string;
  value: unknown;
}

export class MysqlStore extends MemoryStore {
  storageMode = "mysql";
  private pendingWrite: Promise<void> = Promise.resolve();
  private refreshing = false;
  private lastRefreshAt = 0;
  private txBuffer: Array<(conn: PoolConnection) => Promise<void>> | null = null;

  private constructor(private pool: Pool) {
    super();
  }

  static async create(databaseUrl: string) {
    const connectionLimit = Number(process.env.MYSQL_CONNECTION_LIMIT ?? 15);
    const pool = createPool({
      uri: databaseUrl,
      waitForConnections: true,
      connectionLimit: Number.isFinite(connectionLimit) && connectionLimit > 0 ? connectionLimit : 15,
      namedPlaceholders: false,
      connectTimeout: 10_000,
    });
    // mysql2's typed events are narrow; attach an error listener so a pool-level
    // connection error is logged instead of crashing the process.
    (pool as unknown as {
      on(event: "error", listener: (err: Error) => void): unknown;
    }).on("error", (error) => {
      console.error(
        JSON.stringify({
          level: "error",
          message: "mysql pool error",
          error: error.message,
        }),
      );
    });
    const store = new MysqlStore(pool);
    await store.initialize();
    return store;
  }

  override reset() {
    super.reset();
    this.enqueueWrite(async () => {
      await this.pool.execute("DELETE FROM theme_preferences");
      await this.pool.execute("DELETE FROM reminder_subscriptions");
      await this.pool.execute("DELETE FROM reminder_settings");
      await this.pool.execute("DELETE FROM suspensions");
      await this.pool.execute("DELETE FROM sessions");
      await this.pool.execute("DELETE FROM lesson_changes");
      await this.pool.execute("DELETE FROM leaves");
      await this.pool.execute("DELETE FROM attendance");
      await this.pool.execute("DELETE FROM lessons");
      await this.pool.execute("DELETE FROM classes");
      await this.pool.execute("DELETE FROM children");
      await this.pool.execute("DELETE FROM family_members");
      await this.pool.execute("DELETE FROM families");
      await this.pool.execute("DELETE FROM users");
      await this.pool.execute("DELETE FROM auth_credentials");
    });
  }

  override async refresh() {
    if (this.refreshing) return;
    // Skip the 14-table reload when the cache is still fresh. Within a single
    // instance the in-memory Maps are kept current by synchronous mutations, so
    // a reload is only needed to pick up writes from OTHER instances — a TTL
    // of a few seconds bounds cross-instance staleness cheaply.
    if (Date.now() - this.lastRefreshAt < REFRESH_MAX_AGE_MS) return;
    this.refreshing = true;
    try {
      await this.waitForIdle();
      await this.refreshTables();
      this.lastRefreshAt = Date.now();
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

  /** Runs `fn` with writes buffered, then flushes them in a single DB
   *  transaction so multi-step operations (check-in + lesson update + class
   *  usage refresh, etc.) commit atomically. Nested calls join the outer txn. */
  override async runInTransaction<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.txBuffer) return fn();
    this.txBuffer = [];
    try {
      const result = await fn();
      const buffer = this.txBuffer;
      this.txBuffer = null;
      if (buffer.length === 0) return result;
      await this.enqueueWrite(async () => {
        const conn = await this.pool.getConnection();
        try {
          await conn.beginTransaction();
          for (const task of buffer) await task(conn);
          await conn.commit();
        } catch (error) {
          await conn.rollback().catch(() => {});
          throw error;
        } finally {
          conn.release();
        }
      });
      return result;
    } catch (error) {
      this.txBuffer = null;
      throw error;
    }
  }

  override async healthCheck(deep = false): Promise<{ ok: boolean; storage: string; db?: string }> {
    if (!deep) return { ok: true, storage: this.storageMode };
    try {
      await this.pool.query("SELECT 1");
      return { ok: true, storage: this.storageMode, db: "up" };
    } catch (error) {
      return {
        ok: false,
        storage: this.storageMode,
        db: "down",
      };
    }
  }

  private async initialize() {
    await this.createCoreTables();
    await this.createAuxiliaryTables();
    await this.ensureSchemaMigrationsTable();
    await this.ensureForeignKeys();
    await this.migrateLegacyKvStore();
    await this.refreshTables();
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
        historical_used_hours DOUBLE NULL,
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
        source_type VARCHAR(32) NULL,
        attendance_status VARCHAR(64) NULL,
        change_status VARCHAR(32) NULL,
        actual_date VARCHAR(64) NULL,
        checkin_time VARCHAR(64) NULL,
        is_makeup BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT NULL,
        leave_reason TEXT NULL,
        is_manual BOOLEAN NULL,
        origin_lesson_id VARCHAR(191) NULL,
        change_batch_id VARCHAR(191) NULL,
        INDEX idx_lessons_class_id (class_id),
        INDEX idx_lessons_scheduled_date (scheduled_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await this.addColumnIfMissing("classes", "historical_used_hours", "DOUBLE NULL");
    await this.addColumnIfMissing("lessons", "source_type", "VARCHAR(32) NULL");
    await this.addColumnIfMissing("lessons", "attendance_status", "VARCHAR(64) NULL");
    await this.addColumnIfMissing("lessons", "change_status", "VARCHAR(32) NULL");
    await this.addColumnIfMissing("lessons", "origin_lesson_id", "VARCHAR(191) NULL");
    await this.addColumnIfMissing("lessons", "change_batch_id", "VARCHAR(191) NULL");
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS auth_credentials (
        phone VARCHAR(32) NOT NULL PRIMARY KEY,
        password_hash VARCHAR(255) NOT NULL,
        salt VARCHAR(255) NOT NULL,
        created_at VARCHAR(64) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  private async createAuxiliaryTables() {
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS sessions (
        token VARCHAR(191) NOT NULL PRIMARY KEY,
        user_id VARCHAR(191) NOT NULL,
        created_at VARCHAR(64) NOT NULL,
        INDEX idx_sessions_user_id (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS attendance (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        lesson_id VARCHAR(191) NOT NULL,
        class_id VARCHAR(191) NOT NULL,
        child_id VARCHAR(191) NOT NULL,
        checkin_time VARCHAR(64) NOT NULL,
        type VARCHAR(32) NOT NULL,
        actual_start_time VARCHAR(64) NULL,
        actual_end_time VARCHAR(64) NULL,
        notes TEXT NULL,
        created_at VARCHAR(64) NOT NULL,
        INDEX idx_attendance_lesson_id (lesson_id),
        INDEX idx_attendance_class_id (class_id),
        INDEX idx_attendance_child_id (child_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS leaves (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        lesson_id VARCHAR(191) NOT NULL,
        class_id VARCHAR(191) NOT NULL,
        child_id VARCHAR(191) NOT NULL,
        request_time VARCHAR(64) NOT NULL,
        status VARCHAR(32) NOT NULL,
        reason TEXT NULL,
        makeup_lesson_id VARCHAR(191) NULL,
        created_at VARCHAR(64) NOT NULL,
        INDEX idx_leaves_lesson_id (lesson_id),
        INDEX idx_leaves_class_id (class_id),
        INDEX idx_leaves_child_id (child_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS lesson_changes (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        lesson_id VARCHAR(191) NOT NULL,
        class_id VARCHAR(191) NOT NULL,
        child_id VARCHAR(191) NOT NULL,
        type VARCHAR(32) NOT NULL,
        source VARCHAR(32) NOT NULL,
        reason TEXT NULL,
        description TEXT NULL,
        original_start_at VARCHAR(64) NOT NULL,
        original_end_at VARCHAR(64) NULL,
        new_scheduled_date VARCHAR(64) NULL,
        new_scheduled_end_date VARCHAR(64) NULL,
        makeup_lesson_id VARCHAR(191) NULL,
        replacement_lesson_id VARCHAR(191) NULL,
        new_lesson_id VARCHAR(191) NULL,
        status VARCHAR(32) NOT NULL,
        created_at VARCHAR(64) NOT NULL,
        INDEX idx_lesson_changes_lesson_id (lesson_id),
        INDEX idx_lesson_changes_class_id (class_id),
        INDEX idx_lesson_changes_child_id (child_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS suspensions (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        class_id VARCHAR(191) NOT NULL,
        start_time VARCHAR(64) NOT NULL,
        end_time VARCHAR(64) NOT NULL,
        INDEX idx_suspensions_class_id (class_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS reminder_settings (
        family_id VARCHAR(191) NOT NULL PRIMARY KEY,
        enabled BOOLEAN NOT NULL,
        advance_minutes INT NOT NULL,
        include_today_lessons BOOLEAN NOT NULL,
        include_makeup_lessons BOOLEAN NOT NULL,
        updated_at VARCHAR(64) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS reminder_subscriptions (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        family_id VARCHAR(191) NOT NULL,
        user_id VARCHAR(191) NOT NULL,
        lesson_id VARCHAR(191) NOT NULL,
        template_id VARCHAR(191) NOT NULL,
        advance_minutes INT NOT NULL,
        scheduled_at VARCHAR(64) NOT NULL,
        remind_at VARCHAR(64) NOT NULL,
        page TEXT NULL,
        status VARCHAR(32) NOT NULL,
        sent_at VARCHAR(64) NULL,
        failure_reason TEXT NULL,
        created_at VARCHAR(64) NOT NULL,
        updated_at VARCHAR(64) NOT NULL,
        INDEX idx_reminder_subscriptions_family_id (family_id),
        INDEX idx_reminder_subscriptions_user_id (user_id),
        INDEX idx_reminder_subscriptions_lesson_id (lesson_id),
        INDEX idx_reminder_subscriptions_remind_at (remind_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS theme_preferences (
        user_id VARCHAR(191) NOT NULL PRIMARY KEY,
        skin VARCHAR(32) NOT NULL,
        updated_at VARCHAR(64) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  /** Restores referential integrity with ON DELETE CASCADE foreign keys.
   *  Best-effort: if legacy orphaned rows prevent a constraint from being added,
   *  the error is logged (non-fatal) so deployment isn't blocked — clean/new
   *  databases get the constraints, dirty ones should be cleaned manually. */
  private async ensureForeignKeys() {
    const constraints: Array<{
      table: string;
      name: string;
      column: string;
      refTable: string;
      refColumn: string;
    }> = [
      { table: "family_members", name: "fk_family_members_family", column: "family_id", refTable: "families", refColumn: "id" },
      { table: "family_members", name: "fk_family_members_user", column: "user_id", refTable: "users", refColumn: "id" },
      { table: "children", name: "fk_children_family", column: "family_id", refTable: "families", refColumn: "id" },
      { table: "classes", name: "fk_classes_family", column: "family_id", refTable: "families", refColumn: "id" },
      { table: "classes", name: "fk_classes_child", column: "child_id", refTable: "children", refColumn: "id" },
      { table: "lessons", name: "fk_lessons_class", column: "class_id", refTable: "classes", refColumn: "id" },
      { table: "attendance", name: "fk_attendance_lesson", column: "lesson_id", refTable: "lessons", refColumn: "id" },
      { table: "attendance", name: "fk_attendance_class", column: "class_id", refTable: "classes", refColumn: "id" },
      { table: "leaves", name: "fk_leaves_lesson", column: "lesson_id", refTable: "lessons", refColumn: "id" },
      { table: "lesson_changes", name: "fk_lesson_changes_lesson", column: "lesson_id", refTable: "lessons", refColumn: "id" },
      { table: "suspensions", name: "fk_suspensions_class", column: "class_id", refTable: "classes", refColumn: "id" },
      { table: "sessions", name: "fk_sessions_user", column: "user_id", refTable: "users", refColumn: "id" },
      { table: "reminder_settings", name: "fk_reminder_settings_family", column: "family_id", refTable: "families", refColumn: "id" },
      { table: "reminder_subscriptions", name: "fk_reminder_subs_family", column: "family_id", refTable: "families", refColumn: "id" },
      { table: "reminder_subscriptions", name: "fk_reminder_subs_lesson", column: "lesson_id", refTable: "lessons", refColumn: "id" },
      { table: "theme_preferences", name: "fk_theme_prefs_user", column: "user_id", refTable: "users", refColumn: "id" },
    ];
    for (const c of constraints) {
      try {
        await this.pool.execute(
          `ALTER TABLE ${c.table} ADD CONSTRAINT ${c.name} FOREIGN KEY (${c.column}) REFERENCES ${c.refTable} (${c.refColumn}) ON DELETE CASCADE`,
        );
      } catch (error) {
        const code = (error as { code?: string }).code;
        // Already exists is fine; anything else is logged but non-fatal.
        if (code !== "ER_FK_DUP_NAME" && code !== "ER_DUP_KEYNAME") {
          console.warn(
            JSON.stringify({
              level: "warn",
              message: `could not add foreign key ${c.name}`,
              code,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }
    }
  }

  private async ensureSchemaMigrationsTable() {
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(64) NOT NULL PRIMARY KEY,
        applied_at VARCHAR(64) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    // Stamp the baseline schema (the idempotent CREATE TABLE DDL above) as
    // migration 0001 so future schema changes have a versioned home.
    await this.pool.execute(
      `INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0001_initial', ?)`,
      [new Date().toISOString()],
    );
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

  private async hasAnyCoreRows() {
    const tables = [
      "users",
      "families",
      "children",
      "classes",
      "lessons",
      "auth_credentials",
    ];
    for (const table of tables) {
      const [rows] = await this.pool.query<RowDataPacket[]>(
        `SELECT 1 FROM ${table} LIMIT 1`,
      );
      if (rows.length > 0) return true;
    }
    return false;
  }

  private async migrateLegacyKvStore() {
    if (!(await this.tableExists("kv_store"))) return;

    if (!(await this.hasAnyCoreRows())) await this.migrateCoreCollectionsFromKv();
    await this.migrateAuxiliaryCollectionsFromKv();
    await this.pool.execute("DROP TABLE kv_store");
  }

  private async migrateAuxiliaryCollectionsFromKv() {
    if (await this.tableIsEmpty("attendance")) {
      for (const item of await this.loadKvCollection<Attendance>("attendance"))
        await this.setAuxiliaryRecordNow("attendance", item.id, item);
    }
    if (await this.tableIsEmpty("leaves")) {
      for (const item of await this.loadKvCollection<LeaveRecord>("leaves"))
        await this.setAuxiliaryRecordNow("leaves", item.id, item);
    }
    if (await this.tableIsEmpty("lesson_changes")) {
      for (const item of await this.loadKvCollection<LessonChangeRecord>(
        "lesson_changes",
      ))
        await this.setAuxiliaryRecordNow("lesson_changes", item.id, item);
    }
    if (await this.tableIsEmpty("sessions")) {
      for (const item of await this.loadKvCollection<Session>("sessions"))
        await this.setAuxiliaryRecordNow("sessions", item.token, item);
    }
    if (await this.tableIsEmpty("suspensions")) {
      for (const item of await this.loadKvCollection<SuspensionPeriod>(
        "suspensions",
      ))
        await this.setAuxiliaryRecordNow("suspensions", item.id, item);
    }
    if (await this.tableIsEmpty("reminder_settings")) {
      for (const item of await this.loadKvCollection<ReminderSettings>(
        "reminderSettings",
      ))
        await this.setAuxiliaryRecordNow("reminderSettings", item.familyId, item);
    }
    if (await this.tableIsEmpty("reminder_subscriptions")) {
      for (const item of await this.loadKvCollection<LessonReminderSubscription>(
        "reminderSubscriptions",
      ))
        await this.setAuxiliaryRecordNow(
          "reminderSubscriptions",
          item.id,
          item,
        );
    }
    if (await this.tableIsEmpty("theme_preferences")) {
      for (const item of await this.loadKvCollection<ThemePreference>(
        "themePreferences",
      ))
        await this.setAuxiliaryRecordNow("themePreferences", item.userId, item);
    }
  }

  private async tableExists(table: string) {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
      [table],
    );
    return rows.length > 0;
  }

  private async tableIsEmpty(table: string) {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT 1 FROM ${table} LIMIT 1`,
    );
    return rows.length === 0;
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

  private async refreshTables() {
    const users = await this.loadUsersTable();
    const families = await this.loadFamiliesTable();
    const children = await this.loadChildrenTable();
    const classes = await this.loadClassesTable();
    const lessons = await this.loadLessonsTable();
    const authCredentials = await this.loadAuthCredentialsTable();
    const attendance = await this.loadAttendanceTable();
    const leaves = await this.loadLeavesTable();
    const lessonChanges = await this.loadLessonChangesTable();
    const sessions = await this.loadSessionsTable();
    const suspensions = await this.loadSuspensionsTable();
    const reminderSettings = await this.loadReminderSettingsTable();
    const reminderSubscriptions = await this.loadReminderSubscriptionsTable();
    const themePreferences = await this.loadThemePreferencesTable();

    this.users = this.persistedMap("users", users);
    this.families = this.persistedMap("families", families);
    this.children = this.persistedMap("children", children);
    this.classes = this.persistedMap("classes", classes);
    this.lessons = this.persistedMap("lessons", lessons);
    this.authCredentials = this.persistedMap(
      "authCredentials",
      authCredentials,
    );
    this.attendance = this.persistedMap("attendance", attendance);
    this.leaves = this.persistedMap("leaves", leaves);
    this.lessonChanges = this.persistedMap("lesson_changes", lessonChanges);
    this.sessions = this.persistedMap("sessions", sessions);
    this.suspensions = this.persistedMap("suspensions", suspensions);
    this.reminderSettings = this.persistedMap(
      "reminderSettings",
      reminderSettings,
    );
    this.reminderSubscriptions = this.persistedMap(
      "reminderSubscriptions",
      reminderSubscriptions,
    );
    this.themePreferences = this.persistedMap(
      "themePreferences",
      themePreferences,
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
          historicalUsedHours:
            row.historical_used_hours === null ||
            row.historical_used_hours === undefined
              ? null
              : Number(row.historical_used_hours),
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
          sourceType: row.source_type,
          attendanceStatus: row.attendance_status,
          changeStatus: row.change_status,
          actualDate: row.actual_date,
          checkinTime: row.checkin_time,
          isMakeup: Boolean(row.is_makeup),
          notes: row.notes,
          leaveReason: row.leave_reason,
          isManual:
            row.is_manual === null || row.is_manual === undefined
              ? undefined
              : Boolean(row.is_manual),
          originLessonId: row.origin_lesson_id,
          changeBatchId: row.change_batch_id,
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

  private async loadAttendanceTable() {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM attendance",
    );
    return new Map(
      rows.map((row) => [
        String(row.id),
        normalizeStoredDates({
          id: row.id,
          lessonId: row.lesson_id,
          classId: row.class_id,
          childId: row.child_id,
          checkinTime: row.checkin_time,
          type: row.type,
          actualStartTime: row.actual_start_time,
          actualEndTime: row.actual_end_time,
          notes: row.notes,
          createdAt: row.created_at,
        }) as Attendance,
      ]),
    );
  }

  private async loadLeavesTable() {
    const [rows] = await this.pool.query<RowDataPacket[]>("SELECT * FROM leaves");
    return new Map(
      rows.map((row) => [
        String(row.id),
        normalizeStoredDates({
          id: row.id,
          lessonId: row.lesson_id,
          classId: row.class_id,
          childId: row.child_id,
          requestTime: row.request_time,
          status: row.status,
          reason: row.reason,
          makeupLessonId: row.makeup_lesson_id,
          createdAt: row.created_at,
        }) as LeaveRecord,
      ]),
    );
  }

  private async loadLessonChangesTable() {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM lesson_changes",
    );
    return new Map(
      rows.map((row) => [
        String(row.id),
        normalizeStoredDates({
          id: row.id,
          lessonId: row.lesson_id,
          classId: row.class_id,
          childId: row.child_id,
          type: row.type,
          source: row.source,
          reason: row.reason,
          description: row.description,
          originalStartAt: row.original_start_at,
          originalEndAt: row.original_end_at,
          newScheduledDate: row.new_scheduled_date,
          newScheduledEndDate: row.new_scheduled_end_date,
          makeupLessonId: row.makeup_lesson_id,
          replacementLessonId: row.replacement_lesson_id,
          newLessonId: row.new_lesson_id,
          status: row.status,
          createdAt: row.created_at,
        }) as LessonChangeRecord,
      ]),
    );
  }

  private async loadSessionsTable() {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM sessions",
    );
    return new Map(
      rows.map((row) => [
        String(row.token),
        normalizeStoredDates({
          token: row.token,
          userId: row.user_id,
          createdAt: row.created_at,
        }) as Session,
      ]),
    );
  }

  private async loadSuspensionsTable() {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM suspensions",
    );
    return new Map(
      rows.map((row) => [
        String(row.id),
        normalizeStoredDates({
          id: row.id,
          classId: row.class_id,
          start: row.start_time,
          end: row.end_time,
        }) as SuspensionPeriod,
      ]),
    );
  }

  private async loadReminderSettingsTable() {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM reminder_settings",
    );
    return new Map(
      rows.map((row) => [
        String(row.family_id),
        normalizeStoredDates({
          familyId: row.family_id,
          enabled: Boolean(row.enabled),
          advanceMinutes: Number(row.advance_minutes),
          includeTodayLessons: Boolean(row.include_today_lessons),
          includeMakeupLessons: Boolean(row.include_makeup_lessons),
          updatedAt: row.updated_at,
        }) as ReminderSettings,
      ]),
    );
  }

  private async loadReminderSubscriptionsTable() {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM reminder_subscriptions",
    );
    return new Map(
      rows.map((row) => [
        String(row.id),
        normalizeStoredDates({
          id: row.id,
          familyId: row.family_id,
          userId: row.user_id,
          lessonId: row.lesson_id,
          templateId: row.template_id,
          advanceMinutes: Number(row.advance_minutes),
          scheduledAt: row.scheduled_at,
          remindAt: row.remind_at,
          page: row.page,
          status: row.status,
          sentAt: row.sent_at,
          failureReason: row.failure_reason,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }) as LessonReminderSubscription,
      ]),
    );
  }

  private async loadThemePreferencesTable() {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM theme_preferences",
    );
    return new Map(
      rows.map((row) => [
        String(row.user_id),
        normalizeStoredDates({
          userId: row.user_id,
          skin: row.skin,
          updatedAt: row.updated_at,
        }) as ThemePreference,
      ]),
    );
  }

  private persistedMap<T>(collection: string, source: Map<string, T>) {
    return new PersistedMap<string, T>(
      [...source.entries()],
      // `clear()` is only invoked by reset(), which already issues explicit
      // per-table DELETEs — so a no-op here avoids the old full-table-wipe +
      // re-insert footgun. Row-level set/delete are handled below.
      () => {},
      (key, value) => this.setRecord(collection, key, value),
      (key) => this.deleteRecord(collection, key),
    );
  }

  private setRecord<T>(collection: string, key: string, value: T) {
    if (this.txBuffer) {
      this.txBuffer.push((conn) => this.setRecordNow(collection, key, value, conn));
      return;
    }
    this.enqueueWrite(() => this.setRecordNow(collection, key, value));
  }

  private async setRecordNow<T>(
    collection: string,
    key: string,
    value: T,
    conn?: PoolConnection,
  ) {
    if (this.isCoreCollection(collection))
      return this.setCoreRecordNow(collection, key, value, conn);
    return this.setAuxiliaryRecordNow(collection, key, value, conn);
  }

  private deleteRecord(collection: string, key: string) {
    if (this.txBuffer) {
      this.txBuffer.push((conn) => this.deleteRecordNow(collection, key, conn));
      return;
    }
    this.enqueueWrite(() => this.deleteRecordNow(collection, key));
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

  private async deleteRecordNow(
    collection: string,
    key: string,
    conn?: PoolConnection,
  ) {
    const db = conn ?? this.pool;
    if (collection === "authCredentials") {
      await db.execute("DELETE FROM auth_credentials WHERE phone = ?", [key]);
      return;
    }
    const table = this.collectionTableName(collection);
    const keyColumn = this.collectionKeyColumn(collection);
    await db.execute(`DELETE FROM ${table} WHERE ${keyColumn} = ?`, [key]);
  }

  private collectionTableName(collection: string) {
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
      case "attendance":
        return "attendance";
      case "leaves":
        return "leaves";
      case "lesson_changes":
        return "lesson_changes";
      case "sessions":
        return "sessions";
      case "suspensions":
        return "suspensions";
      case "reminderSettings":
        return "reminder_settings";
      case "reminderSubscriptions":
        return "reminder_subscriptions";
      case "themePreferences":
        return "theme_preferences";
      default:
        throw new Error(`Unknown collection: ${collection}`);
    }
  }

  private collectionKeyColumn(collection: string) {
    switch (collection) {
      case "authCredentials":
        return "phone";
      case "sessions":
        return "token";
      case "reminderSettings":
        return "family_id";
      case "themePreferences":
        return "user_id";
      default:
        return "id";
    }
  }

  private async setCoreRecordNow<T>(
    collection: string,
    _key: string,
    value: T,
    conn?: PoolConnection,
  ) {
    const db = conn ?? this.pool;
    if (collection === "users") {
      const item = value as User;
      await db.execute(
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
      await db.execute(
        `INSERT INTO families (id, name)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name)`,
        [item.id, item.name],
      );
      await db.execute("DELETE FROM family_members WHERE family_id = ?", [
        item.id,
      ]);
      for (const member of item.members) {
        await db.execute(
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
      await db.execute(
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
      await db.execute(
        `INSERT INTO classes
          (id, child_id, family_id, institution_name, class_name, course_name,
           teacher_name, teacher_phone, total_hours, historical_used_hours, used_hours,
           remaining_hours, total_fee, start_time, end_time, recurring_rule,
           status, created_at, updated_at, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           child_id = VALUES(child_id),
           family_id = VALUES(family_id),
           institution_name = VALUES(institution_name),
           class_name = VALUES(class_name),
           course_name = VALUES(course_name),
           teacher_name = VALUES(teacher_name),
           teacher_phone = VALUES(teacher_phone),
           total_hours = VALUES(total_hours),
           historical_used_hours = VALUES(historical_used_hours),
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
          item.historicalUsedHours ?? null,
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
      await db.execute(
        `INSERT INTO lessons
          (id, class_id, scheduled_date, scheduled_end_date, status,
           source_type, attendance_status, change_status, actual_date, checkin_time,
           is_makeup, notes, leave_reason, is_manual, origin_lesson_id, change_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           class_id = VALUES(class_id),
           scheduled_date = VALUES(scheduled_date),
           scheduled_end_date = VALUES(scheduled_end_date),
           status = VALUES(status),
           source_type = VALUES(source_type),
           attendance_status = VALUES(attendance_status),
           change_status = VALUES(change_status),
           actual_date = VALUES(actual_date),
           checkin_time = VALUES(checkin_time),
           is_makeup = VALUES(is_makeup),
           notes = VALUES(notes),
           leave_reason = VALUES(leave_reason),
           is_manual = VALUES(is_manual),
           origin_lesson_id = VALUES(origin_lesson_id),
           change_batch_id = VALUES(change_batch_id)`,
        [
          item.id,
          item.classId,
          item.scheduledDate,
          item.scheduledEndDate ?? null,
          item.status,
          item.sourceType ?? null,
          item.attendanceStatus ?? null,
          item.changeStatus ?? null,
          item.actualDate ?? null,
          item.checkinTime ?? null,
          item.isMakeup,
          item.notes ?? null,
          item.leaveReason ?? null,
          item.isManual ?? null,
          item.originLessonId ?? null,
          item.changeBatchId ?? null,
        ],
      );
      return;
    }
    if (collection === "authCredentials") {
      const item = value as AuthCredential;
      await db.execute(
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

  private async setAuxiliaryRecordNow<T>(
    collection: string,
    _key: string,
    value: T,
    conn?: PoolConnection,
  ) {
    const db = conn ?? this.pool;
    if (collection === "sessions") {
      const item = value as Session;
      await db.execute(
        `INSERT INTO sessions (token, user_id, created_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           user_id = VALUES(user_id),
           created_at = VALUES(created_at)`,
        [item.token, item.userId, item.createdAt],
      );
      return;
    }
    if (collection === "attendance") {
      const item = value as Attendance;
      await db.execute(
        `INSERT INTO attendance
          (id, lesson_id, class_id, child_id, checkin_time, type,
           actual_start_time, actual_end_time, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           lesson_id = VALUES(lesson_id),
           class_id = VALUES(class_id),
           child_id = VALUES(child_id),
           checkin_time = VALUES(checkin_time),
           type = VALUES(type),
           actual_start_time = VALUES(actual_start_time),
           actual_end_time = VALUES(actual_end_time),
           notes = VALUES(notes),
           created_at = VALUES(created_at)`,
        [
          item.id,
          item.lessonId,
          item.classId,
          item.childId,
          item.checkinTime,
          item.type,
          item.actualStartTime ?? null,
          item.actualEndTime ?? null,
          item.notes ?? null,
          item.createdAt,
        ],
      );
      return;
    }
    if (collection === "leaves") {
      const item = value as LeaveRecord;
      await db.execute(
        `INSERT INTO leaves
          (id, lesson_id, class_id, child_id, request_time, status,
           reason, makeup_lesson_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           lesson_id = VALUES(lesson_id),
           class_id = VALUES(class_id),
           child_id = VALUES(child_id),
           request_time = VALUES(request_time),
           status = VALUES(status),
           reason = VALUES(reason),
           makeup_lesson_id = VALUES(makeup_lesson_id),
           created_at = VALUES(created_at)`,
        [
          item.id,
          item.lessonId,
          item.classId,
          item.childId,
          item.requestTime,
          item.status,
          item.reason ?? null,
          item.makeupLessonId ?? null,
          item.createdAt,
        ],
      );
      return;
    }
    if (collection === "lesson_changes") {
      const item = value as LessonChangeRecord;
      await db.execute(
        `INSERT INTO lesson_changes
          (id, lesson_id, class_id, child_id, type, source, reason, description,
           original_start_at, original_end_at, new_scheduled_date,
           new_scheduled_end_date, makeup_lesson_id, replacement_lesson_id,
           new_lesson_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           lesson_id = VALUES(lesson_id),
           class_id = VALUES(class_id),
           child_id = VALUES(child_id),
           type = VALUES(type),
           source = VALUES(source),
           reason = VALUES(reason),
           description = VALUES(description),
           original_start_at = VALUES(original_start_at),
           original_end_at = VALUES(original_end_at),
           new_scheduled_date = VALUES(new_scheduled_date),
           new_scheduled_end_date = VALUES(new_scheduled_end_date),
           makeup_lesson_id = VALUES(makeup_lesson_id),
           replacement_lesson_id = VALUES(replacement_lesson_id),
           new_lesson_id = VALUES(new_lesson_id),
           status = VALUES(status),
           created_at = VALUES(created_at)`,
        [
          item.id,
          item.lessonId,
          item.classId,
          item.childId,
          item.type,
          item.source,
          item.reason ?? null,
          item.description ?? null,
          item.originalStartAt,
          item.originalEndAt ?? null,
          item.newScheduledDate ?? null,
          item.newScheduledEndDate ?? null,
          item.makeupLessonId ?? null,
          item.replacementLessonId ?? null,
          item.newLessonId ?? null,
          item.status,
          item.createdAt,
        ],
      );
      return;
    }
    if (collection === "suspensions") {
      const item = value as SuspensionPeriod;
      await db.execute(
        `INSERT INTO suspensions (id, class_id, start_time, end_time)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           class_id = VALUES(class_id),
           start_time = VALUES(start_time),
           end_time = VALUES(end_time)`,
        [item.id, item.classId, item.start, item.end],
      );
      return;
    }
    if (collection === "reminderSettings") {
      const item = value as ReminderSettings;
      await db.execute(
        `INSERT INTO reminder_settings
          (family_id, enabled, advance_minutes, include_today_lessons,
           include_makeup_lessons, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           enabled = VALUES(enabled),
           advance_minutes = VALUES(advance_minutes),
           include_today_lessons = VALUES(include_today_lessons),
           include_makeup_lessons = VALUES(include_makeup_lessons),
           updated_at = VALUES(updated_at)`,
        [
          item.familyId,
          item.enabled,
          item.advanceMinutes,
          item.includeTodayLessons,
          item.includeMakeupLessons,
          item.updatedAt,
        ],
      );
      return;
    }
    if (collection === "reminderSubscriptions") {
      const item = value as LessonReminderSubscription;
      await db.execute(
        `INSERT INTO reminder_subscriptions
          (id, family_id, user_id, lesson_id, template_id, advance_minutes,
           scheduled_at, remind_at, page, status, sent_at, failure_reason,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           family_id = VALUES(family_id),
           user_id = VALUES(user_id),
           lesson_id = VALUES(lesson_id),
           template_id = VALUES(template_id),
           advance_minutes = VALUES(advance_minutes),
           scheduled_at = VALUES(scheduled_at),
           remind_at = VALUES(remind_at),
           page = VALUES(page),
           status = VALUES(status),
           sent_at = VALUES(sent_at),
           failure_reason = VALUES(failure_reason),
           created_at = VALUES(created_at),
           updated_at = VALUES(updated_at)`,
        [
          item.id,
          item.familyId,
          item.userId,
          item.lessonId,
          item.templateId,
          item.advanceMinutes,
          item.scheduledAt,
          item.remindAt,
          item.page ?? null,
          item.status,
          item.sentAt ?? null,
          item.failureReason ?? null,
          item.createdAt,
          item.updatedAt,
        ],
      );
      return;
    }
    if (collection === "themePreferences") {
      const item = value as ThemePreference;
      await db.execute(
        `INSERT INTO theme_preferences (user_id, skin, updated_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           skin = VALUES(skin),
           updated_at = VALUES(updated_at)`,
        [item.userId, item.skin, item.updatedAt],
      );
      return;
    }
    throw new Error(`Unknown auxiliary collection: ${collection}`);
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
