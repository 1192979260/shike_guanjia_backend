import { lookup as dnsLookup } from "node:dns";
import { request as httpsRequest } from "node:https";
import type { Config } from "./config.js";
import { businessDateParts, parseBusinessDateTime } from "./date-time.js";
import { badRequest, businessError } from "./errors.js";
import type {
  Lesson,
  LessonReminderSubscription,
  TrainingClass,
} from "./types.js";

interface WeChatErrorBody {
  errcode?: number;
  errmsg?: string;
}

interface JsonResponse<T> {
  status: number;
  body: T;
}

interface JsonRequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
}

/** Encapsulates all outbound WeChat Platform API calls (openid exchange,
 *  access-token caching, subscription-message delivery). The access-token
 *  cache is instance-level so tests can isolate it (previously it was a
 *  module-level mutable shared across all AppService instances). */
export class WeChatClient {
  private accessToken: { token: string; expiresAt: number } | undefined;

  constructor(private config: Config) {}

  async fetchOpenid(code: string): Promise<string> {
    if (!this.config.wechatAppId || !this.config.wechatAppSecret) {
      throw badRequest("WECHAT_APP_ID and WECHAT_APP_SECRET are required", [
        { field: "code", message: "服务端尚未配置微信小程序 appid/secret" },
      ]);
    }
    const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
    url.searchParams.set("appid", this.config.wechatAppId);
    url.searchParams.set("secret", this.config.wechatAppSecret);
    url.searchParams.set("js_code", code);
    url.searchParams.set("grant_type", "authorization_code");
    let result: JsonResponse<WeChatErrorBody & { openid?: string }>;
    try {
      result = await requestJson<WeChatErrorBody & { openid?: string }>(url);
    } catch (error) {
      throw businessError("WECHAT_SESSION_REQUEST_FAILED", "微信登录凭证校验请求失败", [
        {
          field: "code",
          message: error instanceof Error ? error.message : "无法连接微信接口",
        },
      ]);
    }
    const body = result.body;
    if (result.status < 200 || result.status >= 300 || !body.openid) {
      const detail = body.errcode
        ? `${body.errmsg ?? "微信登录凭证校验失败"} (${body.errcode})`
        : (body.errmsg ?? `微信接口返回 HTTP ${result.status}`);
      throw businessError("WECHAT_SESSION_FAILED", "微信登录凭证校验失败", [
        {
          field: "code",
          message: detail,
        },
      ]);
    }
    return body.openid;
  }

  async getAccessToken(): Promise<string> {
    if (!this.config.wechatAppId || !this.config.wechatAppSecret) {
      throw new Error("WECHAT_APP_ID and WECHAT_APP_SECRET are required");
    }
    if (
      this.accessToken &&
      this.accessToken.expiresAt > Date.now() + 60_000
    ) {
      return this.accessToken.token;
    }
    const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
    url.searchParams.set("grant_type", "client_credential");
    url.searchParams.set("appid", this.config.wechatAppId);
    url.searchParams.set("secret", this.config.wechatAppSecret);
    const result = await requestJson<{
      access_token?: string;
      expires_in?: number;
      errcode?: number;
      errmsg?: string;
    }>(url);
    const body = result.body;
    if (result.status < 200 || result.status >= 300 || !body.access_token) {
      throw new Error(body.errmsg ?? "获取微信 access_token 失败");
    }
    this.accessToken = {
      token: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 7200) * 1000,
    };
    return body.access_token;
  }

  async sendLessonReminder(
    openid: string,
    subscription: LessonReminderSubscription,
    lesson: Lesson,
    trainingClass: TrainingClass,
    childName?: string | null,
  ): Promise<void> {
    const accessToken = await this.getAccessToken();
    const result = await requestJson<WeChatErrorBody>(
      `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        body: {
          touser: openid,
          template_id: subscription.templateId,
          page: subscription.page ?? `/pages/class-detail/index?classId=${trainingClass.id}`,
          data: buildLessonReminderTemplateData(
            subscription,
            lesson,
            trainingClass,
            childName,
          ),
        },
      },
    );
    const body = result.body;
    if (result.status < 200 || result.status >= 300 || body.errcode !== 0) {
      throw new Error(body.errmsg ?? "微信订阅消息发送失败");
    }
  }
}

export function buildLessonReminderTemplateData(
  _subscription: LessonReminderSubscription,
  lesson: Lesson,
  trainingClass: TrainingClass,
  childName?: string | null,
) {
  const courseName = truncateTemplateValue(
    trainingClass.courseName || trainingClass.className || "课程提醒",
    20,
  );
  const studentName = truncateTemplateValue(childName || "学员", 20);

  return {
    thing9: { value: studentName },
    thing8: { value: courseName },
    time15: { value: formatTemplateDateTime(lesson.scheduledDate) },
  };
}

function truncateTemplateValue(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function formatTemplateDateTime(value: string) {
  const date = parseBusinessDateTime(value);
  const parts = businessDateParts(date);
  const month = `${parts.month + 1}`.padStart(2, "0");
  const day = `${parts.day}`.padStart(2, "0");
  const hour = `${parts.hour}`.padStart(2, "0");
  const minute = `${parts.minute}`.padStart(2, "0");
  return `${parts.year}年${month}月${day}日 ${hour}:${minute}`;
}

function requestJson<T>(
  input: URL | string,
  options: JsonRequestOptions = {},
): Promise<JsonResponse<T>> {
  const url = typeof input === "string" ? new URL(input) : input;
  const body =
    options.body === undefined ? undefined : JSON.stringify(options.body);

  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: options.method ?? (body ? "POST" : "GET"),
        timeout: 10_000,
        rejectUnauthorized:
          process.env.WECHAT_TLS_REJECT_UNAUTHORIZED !== "false",
        headers: {
          accept: "application/json",
          ...(body
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(body),
              }
            : {}),
        },
        lookup(hostname, opts, callback) {
          dnsLookup(hostname, { ...opts, family: 4 }, callback);
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({
              status: res.statusCode ?? 0,
              body: (raw ? JSON.parse(raw) : {}) as T,
            });
          } catch {
            reject(
              new Error(
                `微信接口返回非 JSON 响应 HTTP ${res.statusCode ?? 0}`,
              ),
            );
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("微信接口请求超时")));
    req.on("error", (error) => {
      const detail =
        "code" in error && typeof error.code === "string"
          ? `${error.message} (${error.code})`
          : error.message;
      reject(new Error(detail));
    });
    if (body) req.write(body);
    req.end();
  });
}
