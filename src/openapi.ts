export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "课时管家 Backend API",
    version: "0.1.0",
    description: "Flutter 端联调用后端 API。认证使用手机号和密码。",
  },
  servers: [{ url: "http://localhost:3000", description: "Local dev server" }],
  tags: [
    { name: "Auth", description: "登录、会话、家庭共享" },
    { name: "Children", description: "孩子档案管理" },
    { name: "Classes", description: "培训班管理" },
    { name: "Lessons", description: "课表和课次管理" },
    { name: "Preferences", description: "提醒设置和主题偏好" },
    { name: "Attendance", description: "上课打卡" },
    { name: "Leaves", description: "请假和补课" },
    { name: "Cost", description: "费用统计和导出" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "opaque token",
      },
    },
    schemas: {
      RegisterRequest: {
        type: "object",
        required: ["phone", "password"],
        properties: {
          phone: { type: "string", example: "13800138000" },
          password: { type: "string", minLength: 6, example: "password123" },
        },
      },
      LoginRequest: {
        type: "object",
        required: ["phone", "password"],
        properties: {
          phone: { type: "string", example: "13800138000" },
          password: { type: "string", example: "password123" },
        },
      },
      ChildCreateRequest: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", example: "小宝" },
          age: { type: "integer", example: 6 },
          avatarUrl: { type: "string", nullable: true },
        },
      },
      FamilyMemberCreateRequest: {
        type: "object",
        required: ["phone", "relation"],
        properties: {
          phone: { type: "string", example: "13900139000" },
          relation: {
            type: "string",
            enum: ["mother", "father"],
            example: "father",
          },
        },
      },
      ReminderSettingsUpdateRequest: {
        type: "object",
        properties: {
          enabled: { type: "boolean", example: true },
          advanceMinutes: {
            type: "integer",
            enum: [15, 30, 60, 120, 1440],
            example: 60,
          },
          includeTodayLessons: { type: "boolean", example: true },
          includeMakeupLessons: { type: "boolean", example: true },
        },
      },
      ThemePreferenceUpdateRequest: {
        type: "object",
        required: ["skin"],
        properties: {
          skin: {
            type: "string",
            enum: ["warm", "fresh", "classic"],
            example: "warm",
          },
        },
      },
      ReminderSettings: {
        type: "object",
        required: [
          "familyId",
          "enabled",
          "advanceMinutes",
          "includeTodayLessons",
          "includeMakeupLessons",
          "updatedAt",
        ],
        properties: {
          familyId: { type: "string" },
          enabled: { type: "boolean" },
          advanceMinutes: { type: "integer", enum: [15, 30, 60, 120, 1440] },
          includeTodayLessons: { type: "boolean" },
          includeMakeupLessons: { type: "boolean" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      ThemePreference: {
        type: "object",
        required: ["userId", "skin", "updatedAt"],
        properties: {
          userId: { type: "string" },
          skin: { type: "string", enum: ["warm", "fresh", "classic"] },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      RecurringRule: {
        type: "object",
        required: ["type", "daysOfWeek", "timeSlots"],
        properties: {
          type: {
            type: "string",
            enum: ["weekly", "monthly", "custom"],
            example: "weekly",
          },
          daysOfWeek: {
            type: "array",
            items: { type: "integer", minimum: 0, maximum: 6 },
            example: [1],
          },
          weekOfMonth: { type: "integer", nullable: true, example: 1 },
          customIntervalDays: {
            type: "integer",
            nullable: true,
            example: null,
          },
          timeSlots: {
            type: "array",
            items: { $ref: "#/components/schemas/LessonTimeSlot" },
          },
        },
      },
      LessonTimeSlot: {
        type: "object",
        required: [
          "dayOfWeek",
          "startHour",
          "startMinute",
          "endHour",
          "endMinute",
        ],
        properties: {
          dayOfWeek: { type: "integer", example: 1 },
          startHour: { type: "integer", example: 9 },
          startMinute: { type: "integer", example: 0 },
          endHour: { type: "integer", example: 10 },
          endMinute: { type: "integer", example: 0 },
        },
      },
      ClassCreateRequest: {
        type: "object",
        required: [
          "childId",
          "institutionName",
          "className",
          "courseName",
          "totalHours",
          "totalFee",
          "startTime",
          "recurringRule",
        ],
        properties: {
          childId: { type: "string", example: "child-id" },
          institutionName: { type: "string", example: "星星美术" },
          className: { type: "string", example: "大班A" },
          courseName: { type: "string", example: "美术启蒙" },
          teacherName: { type: "string", nullable: true, example: "王老师" },
          teacherPhone: {
            type: "string",
            nullable: true,
            example: "13800138000",
          },
          totalHours: { type: "integer", example: 20 },
          usedHours: { type: "integer", example: 0 },
          totalFee: { type: "number", example: 3000 },
          startTime: {
            type: "string",
            format: "date-time",
            example: "2026-06-15T09:00:00.000Z",
          },
          endTime: {
            type: "string",
            format: "date-time",
            nullable: true,
            example: null,
          },
          recurringRule: { $ref: "#/components/schemas/RecurringRule" },
          notes: { type: "string", nullable: true, example: null },
        },
      },
      ManualLessonRequest: {
        type: "object",
        required: ["classId", "scheduledDate"],
        properties: {
          classId: { type: "string" },
          scheduledDate: { type: "string", format: "date-time" },
          scheduledEndDate: {
            type: "string",
            format: "date-time",
            nullable: true,
          },
        },
      },
      LessonUpdateRequest: {
        type: "object",
        properties: {
          scheduledDate: { type: "string", format: "date-time" },
          scheduledEndDate: {
            type: "string",
            format: "date-time",
            nullable: true,
          },
          status: {
            type: "string",
            enum: ["scheduled", "completed", "leave", "cancelled"],
          },
          notes: { type: "string", nullable: true },
        },
      },
      SuspensionRequest: {
        type: "object",
        required: ["classId", "start", "end"],
        properties: {
          classId: { type: "string" },
          start: { type: "string", format: "date-time" },
          end: { type: "string", format: "date-time" },
        },
      },
      CheckInRequest: {
        type: "object",
        required: ["lessonId"],
        properties: {
          lessonId: { type: "string" },
          type: {
            type: "string",
            enum: ["checkin", "backdated"],
            example: "checkin",
          },
          actualStartTime: {
            type: "string",
            format: "date-time",
            nullable: true,
          },
          actualEndTime: {
            type: "string",
            format: "date-time",
            nullable: true,
          },
          notes: { type: "string", nullable: true },
        },
      },
      LeaveRequest: {
        type: "object",
        required: ["lessonId"],
        properties: {
          lessonId: { type: "string" },
          reason: { type: "string", nullable: true, example: "生病" },
        },
      },
      RenewClassRequest: {
        type: "object",
        required: ["newTotalHours", "newTotalFee"],
        properties: {
          newTotalHours: { type: "integer", example: 20 },
          newTotalFee: { type: "number", example: 3000 },
        },
      },
      ApiResponse: {
        type: "object",
        properties: { data: {} },
      },
      ErrorResponse: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              fields: { type: "array", items: { type: "object" } },
            },
          },
        },
      },
    },
  },
  paths: {
    "/health": { get: operation("Auth", "健康检查", false) },
    "/api/auth/register": {
      post: operation("Auth", "手机号密码注册", false, "RegisterRequest"),
    },
    "/api/auth/login": {
      post: operation("Auth", "手机号密码登录", false, "LoginRequest"),
    },
    "/api/auth/me": { get: operation("Auth", "获取当前用户和家庭") },
    "/api/auth/logout": { post: operation("Auth", "退出登录") },
    "/api/family": { get: operation("Auth", "获取当前家庭") },
    "/api/family/members": {
      get: operation("Auth", "获取家庭成员"),
      post: operation(
        "Auth",
        "添加家庭成员",
        true,
        "FamilyMemberCreateRequest",
      ),
    },
    "/api/family/members/{memberId}": {
      delete: operation("Auth", "移除家庭成员", true, undefined, [
        {
          name: "memberId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ]),
    },
    "/api/reminder-settings": {
      get: operation("Preferences", "获取上课提醒设置"),
      patch: operation(
        "Preferences",
        "更新上课提醒设置",
        true,
        "ReminderSettingsUpdateRequest",
      ),
    },
    "/api/preferences/theme": {
      get: operation("Preferences", "获取主题偏好"),
      patch: operation(
        "Preferences",
        "更新主题偏好",
        true,
        "ThemePreferenceUpdateRequest",
      ),
    },

    "/api/children": {
      get: operation("Children", "孩子列表"),
      post: operation("Children", "创建孩子", true, "ChildCreateRequest"),
    },
    "/api/children/{childId}": pathItem(
      "Children",
      "childId",
      ["get", "patch", "delete"],
      "ChildCreateRequest",
    ),
    "/api/children/{childId}/classes": {
      get: operation(
        "Children",
        "获取孩子的班级",
        true,
        undefined,
        pathParam("childId"),
      ),
    },

    "/api/classes": {
      get: operation(
        "Classes",
        "班级列表",
        true,
        undefined,
        queryParams(["childId", "status"]),
      ),
      post: operation(
        "Classes",
        "创建班级并生成课次",
        true,
        "ClassCreateRequest",
      ),
    },
    "/api/classes/active": { get: operation("Classes", "进行中班级") },
    "/api/classes/completed": { get: operation("Classes", "已结束班级") },
    "/api/classes/{classId}": pathItem(
      "Classes",
      "classId",
      ["get", "patch", "delete"],
      "ClassCreateRequest",
    ),
    "/api/classes/{classId}/pause": {
      post: operation(
        "Classes",
        "暂停班级",
        true,
        undefined,
        pathParam("classId"),
      ),
    },
    "/api/classes/{classId}/resume": {
      post: operation(
        "Classes",
        "恢复班级",
        true,
        undefined,
        pathParam("classId"),
      ),
    },
    "/api/classes/{classId}/end": {
      post: operation(
        "Classes",
        "结束班级",
        true,
        undefined,
        pathParam("classId"),
      ),
    },
    "/api/classes/{classId}/renew": {
      post: operation(
        "Classes",
        "续班",
        true,
        "RenewClassRequest",
        pathParam("classId"),
      ),
    },
    "/api/classes/{classId}/generate-lessons": {
      post: operation(
        "Classes",
        "重新生成课次",
        true,
        undefined,
        pathParam("classId"),
      ),
    },
    "/api/classes/{classId}/lessons": {
      get: operation(
        "Lessons",
        "班级课次",
        true,
        undefined,
        pathParam("classId"),
      ),
    },
    "/api/classes/{classId}/conflicts": {
      get: operation(
        "Classes",
        "班级冲突检测",
        true,
        undefined,
        pathParam("classId"),
      ),
    },

    "/api/lessons/range": {
      get: operation(
        "Lessons",
        "按日期范围查询课次",
        true,
        undefined,
        queryParams(["start", "end", "childId", "classId"]),
      ),
    },
    "/api/lessons/today": { get: operation("Lessons", "今日课次") },
    "/api/lessons/upcoming": {
      get: operation(
        "Lessons",
        "未来课次",
        true,
        undefined,
        queryParams(["days", "childId", "classId"]),
      ),
    },
    "/api/lessons/manual": {
      post: operation("Lessons", "新增手动课次", true, "ManualLessonRequest"),
    },
    "/api/lessons/{lessonId}": pathItem(
      "Lessons",
      "lessonId",
      ["get", "patch", "delete"],
      "LessonUpdateRequest",
    ),
    "/api/lessons/{lessonId}/conflicts": {
      get: operation(
        "Lessons",
        "课次冲突检测",
        true,
        undefined,
        pathParam("lessonId"),
      ),
    },
    "/api/suspensions": {
      post: operation("Lessons", "设置停课区间", true, "SuspensionRequest"),
    },
    "/api/classes/{classId}/suspensions": {
      delete: operation(
        "Lessons",
        "删除班级停课区间",
        true,
        undefined,
        pathParam("classId"),
      ),
    },

    "/api/attendance/check-in": {
      post: operation("Attendance", "上课打卡/补录", true, "CheckInRequest"),
    },
    "/api/attendance/lessons/{lessonId}/cancel": {
      post: operation(
        "Attendance",
        "取消课次打卡",
        true,
        undefined,
        pathParam("lessonId"),
      ),
    },
    "/api/attendance": {
      get: operation(
        "Attendance",
        "查询考勤记录",
        true,
        undefined,
        queryParams(["start", "end", "childId", "classId", "lessonId"]),
      ),
    },
    "/api/attendance/backdated": { get: operation("Attendance", "可补录课次") },
    "/api/attendance/stats": {
      get: operation(
        "Attendance",
        "月度考勤统计",
        true,
        undefined,
        queryParams(["year", "month", "childId"]),
      ),
    },
    "/api/attendance/{attendanceId}": {
      get: operation(
        "Attendance",
        "获取考勤记录",
        true,
        undefined,
        pathParam("attendanceId"),
      ),
    },

    "/api/leaves": { post: operation("Leaves", "请假", true, "LeaveRequest") },
    "/api/leaves/history": {
      get: operation(
        "Leaves",
        "请假历史",
        true,
        undefined,
        queryParams(["childId", "startDate", "endDate"]),
      ),
    },
    "/api/leaves/makeup-lessons": { get: operation("Leaves", "补课课次") },
    "/api/leaves/{leaveId}": {
      get: operation(
        "Leaves",
        "获取请假记录",
        true,
        undefined,
        pathParam("leaveId"),
      ),
    },
    "/api/leaves/{leaveId}/cancel": {
      post: operation(
        "Leaves",
        "取消请假",
        true,
        undefined,
        pathParam("leaveId"),
      ),
    },

    "/api/cost/monthly": {
      get: operation(
        "Cost",
        "月度费用",
        true,
        undefined,
        queryParams(["year", "month", "childId", "classId"]),
      ),
    },
    "/api/cost/statistics": {
      get: operation(
        "Cost",
        "月度费用统计",
        true,
        undefined,
        queryParams(["year", "month", "childId", "classId"]),
      ),
    },
    "/api/cost/breakdown": {
      get: operation(
        "Cost",
        "班级费用拆分",
        true,
        undefined,
        queryParams(["year", "month", "childId"]),
      ),
    },
    "/api/cost/trend": {
      get: operation(
        "Cost",
        "费用趋势",
        true,
        undefined,
        queryParams(["months", "childId"]),
      ),
    },
    "/api/cost/remaining-value": { get: operation("Cost", "剩余课时价值") },
    "/api/cost/export.csv": {
      get: operation(
        "Cost",
        "导出费用 CSV",
        true,
        undefined,
        queryParams(["startDate", "endDate"]),
      ),
    },
  },
} as const;

export function swaggerHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>课时管家 API 调试文档</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>body{margin:0}.topbar{display:none}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      persistAuthorization: true,
      displayRequestDuration: true,
      tryItOutEnabled: true
    });
  </script>
</body>
</html>`;
}

function operation(
  tag: string,
  summary: string,
  secured = true,
  requestSchema?: string,
  parameters: unknown[] = [],
) {
  return {
    tags: [tag],
    summary,
    security: secured ? [{ bearerAuth: [] }] : [],
    parameters,
    requestBody: requestSchema
      ? {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${requestSchema}` },
            },
          },
        }
      : undefined,
    responses: {
      "200": {
        description: "OK",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ApiResponse" },
          },
        },
      },
      "400": {
        description: "Bad Request",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      "401": {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      "404": {
        description: "Not Found",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
    },
  };
}

function pathItem(
  tag: string,
  idName: string,
  methods: Array<"get" | "patch" | "delete">,
  requestSchema?: string,
) {
  return Object.fromEntries(
    methods.map((method) => [
      method,
      operation(
        tag,
        `${method.toUpperCase()} ${idName}`,
        true,
        method === "patch" ? requestSchema : undefined,
        pathParam(idName),
      ),
    ]),
  );
}

function pathParam(name: string) {
  return [{ name, in: "path", required: true, schema: { type: "string" } }];
}

function queryParams(names: string[]) {
  return names.map((name) => ({
    name,
    in: "query",
    required:
      name === "start" || name === "end" || name === "year" || name === "month",
    schema: {
      type:
        name === "year" ||
        name === "month" ||
        name === "days" ||
        name === "months"
          ? "integer"
          : "string",
    },
  }));
}
