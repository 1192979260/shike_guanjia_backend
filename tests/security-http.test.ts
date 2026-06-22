import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import { describe, it } from "node:test";
import { AppService } from "../src/app-service.js";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/http.js";
import { MemoryStore } from "../src/store.js";

type TestApp = {
  service: AppService;
  server: Server;
  baseUrl: string;
  close: () => Promise<void>;
};

async function makeApp(env: Record<string, string> = {}): Promise<TestApp> {
  const config = loadConfig({
    NODE_ENV: "test",
    TOKEN_SECRET: "test-secret",
    STORAGE_MODE: "memory",
    MAX_BODY_BYTES: "1024",
    LOGIN_MAX_ATTEMPTS: "2",
    LOGIN_LOCKOUT_MS: "60000",
    LOGIN_ATTEMPT_WINDOW_MS: "60000",
    ...env,
  });
  const store = new MemoryStore();
  const service = new AppService(store, config);
  const server = createApp(service, config);
  server.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    service,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function request(
  app: TestApp,
  path: string,
  options: RequestInit & { token?: string } = {},
) {
  const headers = new Headers(options.headers);
  if (!headers.has("content-type") && options.body) {
    headers.set("content-type", "application/json");
  }
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  const res = await fetch(`${app.baseUrl}${path}`, { ...options, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  return { res, body };
}

describe("security and HTTP boundary", { concurrency: false }, () => {
  it("rejects expired sessions", async () => {
    const app = await makeApp({ MAX_SESSION_AGE_MS: "1" });
    try {
      const login = await app.service.register("13800138000", "password123");
      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.throws(() => app.service.authenticate(`Bearer ${login.token}`), {
        code: "UNAUTHORIZED",
      });
    } finally {
      await app.close();
    }
  });

  it("rejects tokens with tampered HMAC signatures", async () => {
    const app = await makeApp();
    try {
      const login = await app.service.register("13800138001", "password123");
      const tampered = `${login.token.slice(0, -1)}0`;
      assert.throws(() => app.service.authenticate(`Bearer ${tampered}`), {
        code: "UNAUTHORIZED",
      });
    } finally {
      await app.close();
    }
  });

  it("rate-limits repeated failed logins", async () => {
    const app = await makeApp({ LOGIN_MAX_ATTEMPTS: "2" });
    try {
      await app.service.register("13800138002", "password123");
      await assert.rejects(() => app.service.login("13800138002", "wrongpass"), {
        code: "UNAUTHORIZED",
      });
      await assert.rejects(() => app.service.login("13800138002", "wrongpass"), {
        code: "UNAUTHORIZED",
      });
      await assert.rejects(() => app.service.login("13800138002", "wrongpass"), {
        code: "RATE_LIMITED",
      });
    } finally {
      await app.close();
    }
  });

  it("returns 401 for missing auth on protected HTTP routes", async () => {
    const app = await makeApp();
    try {
      const { res, body } = await request(app, "/api/children");
      assert.equal(res.status, 401);
      assert.equal(body.error.code, "UNAUTHORIZED");
    } finally {
      await app.close();
    }
  });

  it("rejects oversized request bodies with 413", async () => {
    const app = await makeApp({ MAX_BODY_BYTES: "16" });
    try {
      const { res, body } = await request(app, "/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ phone: "13800138003", password: "password123" }),
      });
      assert.equal(res.status, 413);
      assert.equal(body.error.code, "PAYLOAD_TOO_LARGE");
    } finally {
      await app.close();
    }
  });
});
