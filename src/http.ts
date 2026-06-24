import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { businessEndOfDay, businessStartOfDay, toLocalIso } from "./date-time.js";
import { HttpError, errorBody, notFound } from "./errors.js";
import type { AppService, AuthContext } from "./app-service.js";
import type { Config } from "./config.js";
import { openApiSpec, swaggerHtml } from "./openapi.js";

type Handler = (request: RequestContext) => Promise<unknown> | unknown;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  auth: boolean;
  handler: Handler;
}

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: Record<string, unknown>;
  auth?: AuthContext;
  tokenHeader?: string;
  requestId: string;
}

const MAX_BODY_BYTES_DEFAULT = 1024 * 1024;
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

type IdempotencyEntry = {
  result: unknown;
  expiresAt: number;
};

export function createApp(service: AppService, config: Config) {
  const routes = buildRoutes(service);
  // Per-instance request mutex: serializes the refresh → read → write cycle so
  // concurrent requests cannot interleave and observe each other's half-applied
  // state. This is the correctness fix for the cache race; the tradeoff is that
  // request handling is single-threaded per instance (acceptable for this app's
  // low QPS — a future targeted-query repository layer would remove the need).
  let lockChain: Promise<void> = Promise.resolve();
  const withLock = <T>(fn: () => T | Promise<T>): Promise<T> => {
    const run = lockChain.then(fn, fn);
    lockChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  // Per-process idempotency cache for mutation requests. It prevents a client
  // retry with the same key from executing the same state transition twice. This
  // is intentionally short-lived and in-memory; a future multi-instance deploy can
  // back it with MySQL/Redis using the same key semantics.
  const idempotencyCache = new Map<string, IdempotencyEntry>();
  const idempotencyScope = (ctx: RequestContext) => {
    const rawKey = ctx.req.headers["idempotency-key"];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (!key || ctx.req.method === "GET") return null;
    const actor = ctx.auth?.user.id ?? "anonymous";
    return `${actor}:${ctx.req.method}:${ctx.url.pathname}:${key}`;
  };
  const getCachedIdempotentResult = (scope: string) => {
    const entry = idempotencyCache.get(scope);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      idempotencyCache.delete(scope);
      return undefined;
    }
    return entry.result;
  };
  const rememberIdempotentResult = (scope: string, result: unknown) => {
    const now = Date.now();
    for (const [key, entry] of idempotencyCache) {
      if (entry.expiresAt <= now) idempotencyCache.delete(key);
    }
    idempotencyCache.set(scope, {
      result,
      expiresAt: now + IDEMPOTENCY_TTL_MS,
    });
  };
  return createServer(async (req, res) => {
    const startedAt = Date.now();
    const requestId = randomUUID();
    res.setHeader("x-request-id", requestId);
    try {
      setCorsHeaders(req, res, config);
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/openapi.json") {
        sendJson(res, 200, openApiSpec);
        return;
      }
      if (
        req.method === "GET" &&
        (url.pathname === "/docs" || url.pathname === "/docs/")
      ) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(swaggerHtml());
        return;
      }
      const routeMatch = matchRoute(routes, req.method ?? "GET", url.pathname);
      if (!routeMatch) throw notFound("Endpoint not found");
      const body = await parseBody(req, config.maxBodyBytes);
      const tokenHeader = req.headers.authorization;
      const result = await withLock(async () => {
        await service.store.refresh();
        const auth = routeMatch.route.auth
          ? service.authenticate(tokenHeader)
          : undefined;
        const context: RequestContext = {
          req,
          res,
          url,
          params: routeMatch.params,
          body,
          auth,
          tokenHeader,
          requestId,
        };
        const idempotencyKey = idempotencyScope(context);
        if (idempotencyKey) {
          const cached = getCachedIdempotentResult(idempotencyKey);
          if (cached !== undefined) return cached;
        }
        // Wrap the handler in a transaction so all its writes commit atomically
        // (no-op for memory/file stores; real DB transaction for mysql).
        const value = await service.store.runInTransaction(async () =>
          routeMatch.route.handler(context),
        );
        if (idempotencyKey) rememberIdempotentResult(idempotencyKey, value);
        await service.store.waitForIdle();
        return value;
      });
      if (res.writableEnded) return;
      if (
        typeof result === "string" &&
        res.getHeader("content-type") === "text/csv"
      ) {
        res.writeHead(200);
        res.end(result);
      } else {
        sendJson(res, 200, { data: result });
      }
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      sendJson(res, status, errorBody(error));
      if (!(error instanceof HttpError)) {
        console.error(
          JSON.stringify({
            level: "error",
            requestId,
            method: req.method,
            path: req.url,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          }),
        );
      }
    } finally {
      console.info(
        JSON.stringify({
          level: "info",
          requestId,
          method: req.method,
          path: req.url,
          status: res.statusCode,
          durationMs: Date.now() - startedAt,
        }),
      );
    }
  });
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse, config: Config) {
  const origin = req.headers.origin;
  res.setHeader("vary", "Origin");
  const allowed =
    typeof origin === "string" && isOriginAllowed(origin, config);
  if (allowed) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type,authorization,idempotency-key");
    res.setHeader("access-control-max-age", "86400");
  }
}

function isOriginAllowed(origin: string, config: Config): boolean {
  if (config.corsAllowedOrigins.length > 0)
    return config.corsAllowedOrigins.includes(origin);
  // No explicit allowlist: permit any origin in development for convenience,
  // but in production an empty allowlist means no cross-origin access (same-origin
  // and cloud-container traffic are unaffected).
  return config.nodeEnv !== "production";
}

/** Wraps a list handler so that `?page=&pageSize=` returns a paginated envelope
 *  `{ items, page, pageSize, total, hasMore }`. Without those params the raw
 *  array is returned (backward compatible). */
function paginate(handler: Handler): Handler {
  return async (ctx) => {
    const result = await handler(ctx);
    if (!Array.isArray(result)) return result;
    const page = Number(ctx.url.searchParams.get("page"));
    const pageSize = Number(ctx.url.searchParams.get("pageSize"));
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1)
      return result;
    const total = result.length;
    const start = (page - 1) * pageSize;
    const items = result.slice(start, start + pageSize);
    return { items, page, pageSize, total, hasMore: start + pageSize < total };
  };
}

function buildRoutes(service: AppService): Route[] {
  const route = (
    method: string,
    path: string,
    auth: boolean,
    handler: Handler,
  ): Route => {
    const keys: string[] = [];
    const pattern = new RegExp(
      `^${path.replace(/:([A-Za-z0-9_]+)/g, (_, key: string) => {
        keys.push(key);
        return "([^/]+)";
      })}$`,
    );
    return { method, pattern, keys, auth, handler };
  };
  const q = (ctx: RequestContext) => ctx.url.searchParams;
  const a = (ctx: RequestContext) => ctx.auth!;
  const p = (ctx: RequestContext, key: string) => {
    const value = ctx.params[key];
    if (!value) throw notFound("Route parameter not found");
    return value;
  };
  return [
    route("GET", "/health", false, async () => service.healthCheck()),
    route("GET", "/health/ready", false, async () => service.healthCheck(true)),
    route("POST", "/api/auth/register", false, (ctx) =>
      service.register(ctx.body.phone, ctx.body.password, ctx.body.relation),
    ),
    route("GET", "/api/auth/register-context", false, (ctx) =>
      service.getRegisterContext(q(ctx).get("phone")),
    ),
    route("POST", "/api/auth/login", false, (ctx) =>
      service.login(ctx.body.phone, ctx.body.password),
    ),
    route("GET", "/api/auth/me", true, (ctx) => service.me(a(ctx))),
    route("POST", "/api/auth/logout", true, (ctx) =>
      service.logout(ctx.tokenHeader),
    ),
    route("POST", "/api/auth/wechat-session", true, (ctx) =>
      service.bindWeChatSession(a(ctx), ctx.body),
    ),
    route("GET", "/api/family", true, (ctx) => service.getFamily(a(ctx))),
    route("GET", "/api/family/members", true, (ctx) =>
      service.getFamilyMembers(a(ctx)),
    ),
    route("POST", "/api/family/members", true, (ctx) =>
      service.addFamilyMember(a(ctx), ctx.body),
    ),
    route("DELETE", "/api/family/members/:memberId", true, (ctx) =>
      service.removeFamilyMember(a(ctx), p(ctx, "memberId")),
    ),
    route("GET", "/api/reminder-settings", true, (ctx) =>
      service.getReminderSettings(a(ctx)),
    ),
    route("PATCH", "/api/reminder-settings", true, (ctx) =>
      service.updateReminderSettings(a(ctx), ctx.body),
    ),
    route("POST", "/api/reminder-subscriptions", true, (ctx) =>
      service.registerLessonReminders(a(ctx), ctx.body),
    ),
    route("GET", "/api/preferences/theme", true, (ctx) =>
      service.getThemePreference(a(ctx)),
    ),
    route("PATCH", "/api/preferences/theme", true, (ctx) =>
      service.updateThemePreference(a(ctx), ctx.body),
    ),

    route("POST", "/api/children", true, (ctx) =>
      service.createChild(a(ctx), ctx.body),
    ),
    route("GET", "/api/children", true, paginate((ctx) => service.listChildren(a(ctx)))),
    route("GET", "/api/children/:childId", true, (ctx) =>
      service.getChild(a(ctx), p(ctx, "childId")),
    ),
    route("GET", "/api/children/:childId/classes", true, (ctx) =>
      service.listClasses(
        a(ctx),
        new URLSearchParams({ childId: p(ctx, "childId") }),
      ),
    ),
    route("PATCH", "/api/children/:childId", true, (ctx) =>
      service.updateChild(a(ctx), p(ctx, "childId"), ctx.body),
    ),
    route("DELETE", "/api/children/:childId", true, (ctx) =>
      service.deleteChild(a(ctx), p(ctx, "childId")),
    ),

    route("POST", "/api/classes", true, (ctx) =>
      service.createClass(a(ctx), ctx.body),
    ),
    route("GET", "/api/classes", true, paginate((ctx) => service.listClasses(a(ctx), q(ctx)))),
    route("GET", "/api/classes/active", true, (ctx) =>
      service.listClasses(a(ctx), new URLSearchParams("status=active")),
    ),
    route("GET", "/api/classes/completed", true, (ctx) =>
      service.listClasses(a(ctx), new URLSearchParams("status=ended")),
    ),
    route("GET", "/api/classes/:classId", true, (ctx) =>
      service.getClass(a(ctx), p(ctx, "classId")),
    ),
    route("PATCH", "/api/classes/:classId", true, (ctx) =>
      service.updateClass(a(ctx), p(ctx, "classId"), ctx.body),
    ),
    route("DELETE", "/api/classes/:classId", true, (ctx) =>
      service.deleteClass(a(ctx), p(ctx, "classId")),
    ),
    route("POST", "/api/classes/:classId/pause", true, (ctx) =>
      service.setClassStatus(a(ctx), p(ctx, "classId"), "paused"),
    ),
    route("POST", "/api/classes/:classId/resume", true, (ctx) =>
      service.setClassStatus(a(ctx), p(ctx, "classId"), "active"),
    ),
    route("POST", "/api/classes/:classId/end", true, (ctx) =>
      service.setClassStatus(a(ctx), p(ctx, "classId"), "ended"),
    ),
    route("POST", "/api/classes/:classId/renew", true, (ctx) =>
      service.renewClass(a(ctx), p(ctx, "classId"), ctx.body),
    ),
    route("PATCH", "/api/classes/:classId/schedule-rule", true, (ctx) =>
      service.updateClass(a(ctx), p(ctx, "classId"), ctx.body),
    ),
    route("POST", "/api/classes/:classId/generate-lessons", true, (ctx) =>
      service.generateClassLessons(a(ctx), p(ctx, "classId")),
    ),
    route("POST", "/api/classes/:classId/regenerate-lessons", true, (ctx) =>
      service.generateClassLessons(a(ctx), p(ctx, "classId")),
    ),
    route("GET", "/api/classes/:classId/lessons", true, (ctx) =>
      service.getClassLessons(a(ctx), p(ctx, "classId")),
    ),
    route("GET", "/api/classes/:classId/lesson-change-records", true, (ctx) =>
      service.lessonChangeHistory(
        a(ctx),
        new URLSearchParams({ classId: p(ctx, "classId") }),
      ),
    ),
    route("GET", "/api/classes/:classId/conflicts", true, (ctx) =>
      service
        .getClassLessons(a(ctx), p(ctx, "classId"))
        .flatMap((lesson) => service.checkLessonConflicts(a(ctx), lesson.id)),
    ),

    route("GET", "/api/lessons/range", true, paginate((ctx) => service.getLessonsInRange(a(ctx), q(ctx)))),
    route("GET", "/api/lessons/today", true, (ctx) => {
      const start = businessStartOfDay();
      const end = businessEndOfDay(start);
      return service.getLessonsInRange(
        a(ctx),
        new URLSearchParams({
          start: toLocalIso(start),
          end: toLocalIso(end),
        }),
      );
    }),
    route("GET", "/api/lessons/home", true, (ctx) =>
      service.getHomeLessons(a(ctx)),
    ),
    route("GET", "/api/lessons/upcoming", true, (ctx) => {
      return service.getUpcomingLessons(a(ctx), q(ctx));
    }),
    route("POST", "/api/lessons/manual", true, (ctx) =>
      service.addManualLesson(a(ctx), ctx.body),
    ),
    route("GET", "/api/lessons/:lessonId", true, (ctx) =>
      service.getLesson(a(ctx), p(ctx, "lessonId")),
    ),
    route("PATCH", "/api/lessons/:lessonId", true, (ctx) =>
      service.updateLesson(a(ctx), p(ctx, "lessonId"), ctx.body),
    ),
    route("POST", "/api/lessons/:lessonId/reschedule", true, (ctx) =>
      service.createLessonChange(a(ctx), {
        ...ctx.body,
        lessonId: p(ctx, "lessonId"),
        type: "reschedule",
      }),
    ),
    route("POST", "/api/lessons/:lessonId/leave", true, (ctx) =>
      service.requestLeave(a(ctx), {
        ...ctx.body,
        lessonId: p(ctx, "lessonId"),
      }),
    ),
    route("DELETE", "/api/lessons/:lessonId", true, (ctx) =>
      service.deleteLesson(a(ctx), p(ctx, "lessonId")),
    ),
    route("GET", "/api/lessons/:lessonId/conflicts", true, (ctx) =>
      service.checkLessonConflicts(a(ctx), p(ctx, "lessonId")),
    ),
    route("POST", "/api/suspensions", true, (ctx) =>
      service.setSuspension(a(ctx), ctx.body),
    ),
    route("DELETE", "/api/classes/:classId/suspensions", true, (ctx) =>
      service.removeSuspension(a(ctx), p(ctx, "classId")),
    ),

    route("POST", "/api/attendance/check-in", true, (ctx) =>
      service.checkIn(a(ctx), ctx.body),
    ),
    route("POST", "/api/lessons/backfill-check-in", true, (ctx) =>
      service.checkIn(a(ctx), { ...ctx.body, type: "backdated" }),
    ),
    route("POST", "/api/attendance/lessons/:lessonId/cancel", true, (ctx) =>
      service.cancelCheckIn(a(ctx), p(ctx, "lessonId")),
    ),
    route("GET", "/api/attendance/backdated", true, (ctx) =>
      service.getBackdatedCandidates(a(ctx)),
    ),
    route("GET", "/api/attendance/stats", true, (ctx) =>
      service.attendanceStats(a(ctx), q(ctx)),
    ),
    route("GET", "/api/attendance/:attendanceId", true, (ctx) =>
      service.getAttendance(a(ctx), p(ctx, "attendanceId")),
    ),
    route("GET", "/api/attendance", true, paginate((ctx) => service.listAttendance(a(ctx), q(ctx)))),
    route("POST", "/api/lesson-changes", true, (ctx) =>
      service.createLessonChange(a(ctx), ctx.body),
    ),
    route("GET", "/api/lesson-changes/history", true, paginate((ctx) => service.lessonChangeHistory(a(ctx), q(ctx)))),
    route("POST", "/api/lesson-changes/:changeId/cancel", true, (ctx) =>
      service.cancelLessonChange(a(ctx), p(ctx, "changeId")),
    ),
    route("POST", "/api/lesson-change-records/:changeId/revoke", true, (ctx) =>
      service.cancelLessonChange(a(ctx), p(ctx, "changeId")),
    ),
    route("POST", "/api/leaves", true, (ctx) =>
      service.requestLeave(a(ctx), ctx.body),
    ),
    route("GET", "/api/leaves/history", true, paginate((ctx) => service.leaveHistory(a(ctx), q(ctx)))),
    route("GET", "/api/leaves/makeup-lessons", true, (ctx) =>
      service.makeupLessons(a(ctx)),
    ),
    route("GET", "/api/leaves/:leaveId", true, (ctx) =>
      service.requireLeave(a(ctx), p(ctx, "leaveId")),
    ),
    route("POST", "/api/leaves/:leaveId/cancel", true, (ctx) =>
      service.cancelLeave(a(ctx), p(ctx, "leaveId")),
    ),

    route("GET", "/api/cost/monthly", true, (ctx) =>
      service.monthlyCost(a(ctx), q(ctx)),
    ),
    route("GET", "/api/cost/statistics", true, (ctx) =>
      service.monthlyCost(a(ctx), q(ctx)),
    ),
    route("GET", "/api/cost/breakdown", true, (ctx) =>
      service.costBreakdown(a(ctx), q(ctx)),
    ),
    route("GET", "/api/cost/trend", true, (ctx) =>
      service.costTrend(a(ctx), q(ctx)),
    ),
    route("GET", "/api/cost/remaining-value", true, (ctx) =>
      service.totalRemainingValue(a(ctx)),
    ),
    route("GET", "/api/cost/export.csv", true, (ctx) => {
      ctx.res.setHeader("content-type", "text/csv; charset=utf-8");
      ctx.res.setHeader(
        "content-disposition",
        'attachment; filename="cost-export.csv"',
      );
      return service.exportCostCsv(a(ctx), q(ctx));
    }),
  ];
}

function matchRoute(routes: Route[], method: string, pathname: string) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(pathname);
    if (!match) continue;
    const params: Record<string, string> = {};
    for (const [index, key] of route.keys.entries())
      params[key] = decodeURIComponent(match[index + 1] ?? "");
    return { route, params };
  }
  return null;
}

async function parseBody(
  req: IncomingMessage,
  maxBodyBytes = MAX_BODY_BYTES_DEFAULT,
): Promise<Record<string, unknown>> {
  if (req.method === "GET" || req.method === "DELETE") return {};
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > maxBodyBytes) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body too large");
  }
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buf.length;
    if (received > maxBodyBytes) {
      throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body too large");
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
