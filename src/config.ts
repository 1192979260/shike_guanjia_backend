export interface Config {
  nodeEnv: string;
  port: number;
  tokenSecret: string;
  storageMode: "memory" | "file" | "sqlite" | "mysql";
  dataFile: string;
  sqliteFile: string;
  databaseUrl: string | null;
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
  };
}
