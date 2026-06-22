export interface Config {
  nodeEnv: string;
  port: number;
  tokenSecret: string;
  maxSessionAgeMs: number;
  storageMode: "memory" | "file" | "mysql";
  dataFile: string;
  databaseUrl: string | null;
  wechatAppId: string | null;
  wechatAppSecret: string | null;
  lessonReminderTemplateId: string;
  reminderScanIntervalMs: number;
  corsAllowedOrigins: string[];
  loginMaxAttempts: number;
  loginLockoutMs: number;
  loginAttemptWindowMs: number;
  maxBodyBytes: number;
}

const DEFAULT_TOKEN_SECRET = "dev-secret-change-me";
const DEFAULT_MAX_SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function parseNumber(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function parseOrigins(env: NodeJS.ProcessEnv): string[] {
  const raw = env.CORS_ALLOWED_ORIGINS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadConfig(env = process.env): Config {
  return {
    nodeEnv: env.NODE_ENV ?? "development",
    port: Number(env.PORT ?? 3000),
    tokenSecret: env.TOKEN_SECRET ?? DEFAULT_TOKEN_SECRET,
    maxSessionAgeMs: parseNumber(env, "MAX_SESSION_AGE_MS", DEFAULT_MAX_SESSION_AGE_MS),
    storageMode:
      env.STORAGE_MODE === "memory" ||
      env.STORAGE_MODE === "file" ||
      env.STORAGE_MODE === "mysql"
        ? env.STORAGE_MODE
        : "mysql",
    dataFile: env.DATA_FILE ?? ".data/shike-guanjia.json",
    databaseUrl: env.DATABASE_URL ?? null,
    wechatAppId: env.WECHAT_APP_ID ?? null,
    wechatAppSecret: env.WECHAT_APP_SECRET ?? null,
    lessonReminderTemplateId:
      env.LESSON_REMINDER_TEMPLATE_ID ??
      "pluT-ikzv-p5mBwXhcWIApzQqe4eyYQVyKlhha0h1b4",
    reminderScanIntervalMs: parseNumber(env, "REMINDER_SCAN_INTERVAL_MS", 60_000),
    corsAllowedOrigins: parseOrigins(env),
    loginMaxAttempts: parseNumber(env, "LOGIN_MAX_ATTEMPTS", 5),
    loginLockoutMs: parseNumber(env, "LOGIN_LOCKOUT_MS", 15 * 60 * 1000),
    loginAttemptWindowMs: parseNumber(env, "LOGIN_ATTEMPT_WINDOW_MS", 15 * 60 * 1000),
    maxBodyBytes: parseNumber(env, "MAX_BODY_BYTES", 1024 * 1024),
  };
}

/** Fail-fast validation for production deployments. Throws if required secrets are missing. */
export function validateConfig(config: Config): void {
  if (config.nodeEnv !== "production") return;
  if (!config.tokenSecret || config.tokenSecret === DEFAULT_TOKEN_SECRET) {
    throw new Error(
      "TOKEN_SECRET must be set to a non-default value in production (NODE_ENV=production).",
    );
  }
  if (config.storageMode === "mysql" && !config.databaseUrl) {
    throw new Error("DATABASE_URL is required when STORAGE_MODE=mysql in production.");
  }
}
