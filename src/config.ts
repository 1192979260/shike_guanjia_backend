export interface Config {
  nodeEnv: string;
  port: number;
  tokenSecret: string;
  storageMode: "memory" | "file" | "sqlite" | "mysql";
  dataFile: string;
  sqliteFile: string;
  databaseUrl: string | null;
  wechatAppId: string | null;
  wechatAppSecret: string | null;
  lessonReminderTemplateId: string;
  reminderScanIntervalMs: number;
}

export function loadConfig(env = process.env): Config {
  return {
    nodeEnv: env.NODE_ENV ?? "development",
    port: Number(env.PORT ?? 3000),
    tokenSecret: env.TOKEN_SECRET ?? "dev-secret-change-me",
    storageMode:
      env.STORAGE_MODE === "memory" ||
      env.STORAGE_MODE === "file" ||
      env.STORAGE_MODE === "mysql"
        ? env.STORAGE_MODE
        : "sqlite",
    dataFile: env.DATA_FILE ?? ".data/shike-guanjia.json",
    sqliteFile: env.SQLITE_FILE ?? ".data/shike-guanjia.sqlite",
    databaseUrl: env.DATABASE_URL ?? null,
    wechatAppId: env.WECHAT_APP_ID ?? null,
    wechatAppSecret: env.WECHAT_APP_SECRET ?? null,
    lessonReminderTemplateId:
      env.LESSON_REMINDER_TEMPLATE_ID ??
      "pluT-ikzv-p5mBwXhcWIApzQqe4eyYQVyKlhha0h1b4",
    reminderScanIntervalMs: Number(env.REMINDER_SCAN_INTERVAL_MS ?? 60_000),
  };
}
