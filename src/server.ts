import { AppService } from './app-service.js';
import type { Config } from './config.js';
import { loadConfig, validateConfig } from './config.js';
import { createApp } from './http.js';
import { FileStore, MemoryStore, MysqlStore } from './store.js';

const config = loadConfig();
validateConfig(config);
const store = await createStore(config);
const service = new AppService(store, config);
const server = createApp(service, config);

server.listen(config.port, () => {
  console.info(
    JSON.stringify({
      level: 'info',
      message: 'shike-guanjia-backend listening',
      port: config.port,
      storageMode: config.storageMode,
    }),
  );
});

let reminderTimer: NodeJS.Timeout | undefined;
let reminderRunning = false;

function scheduleReminders() {
  if (config.reminderScanIntervalMs <= 0) return;
  reminderTimer = setTimeout(runReminders, config.reminderScanIntervalMs);
  reminderTimer.unref();
}

async function runReminders() {
  if (reminderRunning) {
    scheduleReminders();
    return;
  }
  reminderRunning = true;
  try {
    await service.processDueLessonReminders().catch((error) => {
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'processDueLessonReminders failed',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  } finally {
    reminderRunning = false;
    scheduleReminders();
  }
}

scheduleReminders();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(JSON.stringify({ level: 'info', message: 'shutdown', signal }));
  if (reminderTimer) clearTimeout(reminderTimer);
  server.close(() => {
    void (async () => {
      try {
        await store.waitForIdle();
        await store.close();
      } catch (error) {
        console.error(
          JSON.stringify({
            level: 'error',
            message: 'shutdown flush failed',
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      process.exit(0);
    })();
  });
  // Force-exit if graceful close stalls.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error(
    JSON.stringify({
      level: 'error',
      message: 'unhandledRejection',
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    }),
  );
});
process.on('uncaughtException', (error) => {
  console.error(
    JSON.stringify({
      level: 'error',
      message: 'uncaughtException',
      error: error.message,
      stack: error.stack,
    }),
  );
  void shutdown('uncaughtException');
});

async function createStore(config: Config) {
  if (config.storageMode === 'mysql') {
    if (!config.databaseUrl) throw new Error('DATABASE_URL is required when STORAGE_MODE=mysql');
    return MysqlStore.create(config.databaseUrl);
  }
  if (config.storageMode === 'file') return new FileStore(config.dataFile);
  return new MemoryStore();
}
