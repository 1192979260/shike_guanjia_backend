import { AppService } from './app-service.js';
import type { Config } from './config.js';
import { loadConfig } from './config.js';
import { createApp } from './http.js';
import { FileStore, MemoryStore, MysqlStore, SqliteStore } from './store.js';

const config = loadConfig();
const store = await createStore(config);
const service = new AppService(store, config);
const server = createApp(service);

server.listen(config.port, () => {
  console.info(`shike-guanjia-backend listening on http://localhost:${config.port}`);
});

if (config.reminderScanIntervalMs > 0) {
  setInterval(() => {
    service.processDueLessonReminders().catch((error) => {
      console.error("processDueLessonReminders failed", error);
    });
  }, config.reminderScanIntervalMs).unref();
}

async function createStore(config: Config) {
  if (config.storageMode === 'mysql') {
    if (!config.databaseUrl) throw new Error('DATABASE_URL is required when STORAGE_MODE=mysql');
    return MysqlStore.create(config.databaseUrl);
  }
  if (config.storageMode === 'sqlite') return new SqliteStore(config.sqliteFile);
  if (config.storageMode === 'file') return new FileStore(config.dataFile);
  return new MemoryStore();
}
