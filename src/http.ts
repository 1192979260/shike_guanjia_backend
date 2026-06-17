import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { HttpError, errorBody, notFound } from "./errors.js";
import type { AppService, AuthContext } from "./app-service.js";
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
}

export function createApp(service: AppService) {
  const routes = buildRoutes(service);
  return createServer(async (req, res) => {
    const startedAt = Date.now();
    try {
      setCorsHeaders(req, res);
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
      const body = await parseBody(req);
      const tokenHeader = req.headers.authorization;
      await service.store.refresh();
      const auth = routeMatch.route.auth
        ? service.authenticate(tokenHeader)
        : undefined;
      const result = await routeMatch.route.handler({
        req,
        res,
        url,
        params: routeMatch.params,
        body,
        auth,
        tokenHeader,
      });
      await service.store.waitForIdle();
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
      if (!(error instanceof HttpError)) console.error(error);
    } finally {
      console.info(
        `${req.method} ${req.url} ${res.statusCode} ${Date.now() - startedAt}ms`,
      );
    }
  });
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  res.setHeader("vary", "Origin");
  res.setHeader(
    "access-control-allow-origin",
    typeof origin === "string" ? origin : "*",
  );
  res.setHeader(
    "access-control-allow-methods",
    "GET,POST,PATCH,DELETE,OPTIONS",
  );
  res.setHeader("access-control-allow-headers", "content-type,authorization");
  res.setHeader("access-control-max-age", "86400");
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
    route("GET", "/health", false, () => ({ ok: true })),
    route("POST", "/api/auth/register", false, (ctx) =>
      service.register(ctx.body.phone, ctx.body.password),
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
    route("GET", "/api/children", true, (ctx) => service.listChildren(a(ctx))),
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
    route("GET", "/api/classes", true, (ctx) =>
      service.listClasses(a(ctx), q(ctx)),
    ),
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
    route("POST", "/api/classes/:classId/generate-lessons", true, (ctx) =>
      service.generateClassLessons(a(ctx), p(ctx, "classId")),
    ),
    route("GET", "/api/classes/:classId/lessons", true, (ctx) =>
      service.getClassLessons(a(ctx), p(ctx, "classId")),
    ),
    route("GET", "/api/classes/:classId/conflicts", true, (ctx) =>
      service
        .getClassLessons(a(ctx), p(ctx, "classId"))
        .flatMap((lesson) => service.checkLessonConflicts(a(ctx), lesson.id)),
    ),

    route("GET", "/api/lessons/range", true, (ctx) =>
      service.getLessonsInRange(a(ctx), q(ctx)),
    ),
    route("GET", "/api/lessons/today", true, (ctx) => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return service.getLessonsInRange(
        a(ctx),
        new URLSearchParams({
          start: start.toISOString(),
          end: end.toISOString(),
        }),
      );
    }),
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
    route("GET", "/api/attendance", true, (ctx) =>
      service.listAttendance(a(ctx), q(ctx)),
    ),
    route("POST", "/api/lesson-changes", true, (ctx) =>
      service.createLessonChange(a(ctx), ctx.body),
    ),
    route("GET", "/api/lesson-changes/history", true, (ctx) =>
      service.lessonChangeHistory(a(ctx), q(ctx)),
    ),
    route("POST", "/api/lesson-changes/:changeId/cancel", true, (ctx) =>
      service.cancelLessonChange(a(ctx), p(ctx, "changeId")),
    ),
    route("POST", "/api/leaves", true, (ctx) =>
      service.requestLeave(a(ctx), ctx.body),
    ),
    route("GET", "/api/leaves/history", true, (ctx) =>
      service.leaveHistory(a(ctx), q(ctx)),
    ),
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
): Promise<Record<string, unknown>> {
  if (req.method === "GET" || req.method === "DELETE") return {};
  const chunks: Buffer[] = [];
  for await (const chunk of req)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
