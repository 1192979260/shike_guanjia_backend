## Why

Flutter 端已经按 PRD 完成了核心领域模型、服务接口和 mock 实现，但后端仓库尚未提供可联调的接口服务，导致登录、家庭共享、孩子档案、班级、课表、考勤请假和费用统计都停留在本地模拟数据。现在需要补齐一套与 Flutter 端模型兼容的后端 API，支撑从 mock 切换到真实服务并为后续 LeanCloud/持久化接入留出边界。

## What Changes

- 新增手机号验证码登录、会话获取、退出登录、家庭与家庭成员管理接口。
- 新增孩子档案 CRUD 接口，并支持删除孩子时级联清理关联班级、课次、考勤和请假数据。
- 新增培训班 CRUD、状态流转、续费/续班、冲突检测接口。
- 新增基于排课规则的课次生成、课表范围查询、手动课次增删改、停课区间管理接口。
- 新增上课打卡、补录查询、请假、取消请假、请假历史、补课课次和考勤统计接口。
- 新增月度费用统计、班级费用拆分、费用趋势、剩余价值和 CSV 导出接口。
- 统一 API 响应、错误码、日期枚举序列化和鉴权方式，保持与 Flutter 端 `domain/models` 的 JSON 字段兼容。

## Capabilities

### New Capabilities
- `auth-family-api`: Covers phone-code authentication, session identity, family lookup, and two-member family sharing.
- `children-api`: Covers child profile creation, update, lookup, listing, validation, and cascade deletion behavior.
- `classes-schedule-api`: Covers training class lifecycle, recurring schedule rules, generated lessons, lesson range queries, manual adjustments, suspension periods, and conflict detection.
- `attendance-leave-api`: Covers lesson check-in, backdated attendance, leave request/cancel/history, makeup lessons, and attendance statistics.
- `cost-reporting-api`: Covers per-session allocation, monthly statistics, class breakdowns, cost trends, remaining value, and CSV export.

### Modified Capabilities

## Impact

- Affected backend: new application service, routing, domain models, persistence abstraction, auth middleware, validation, error handling, and tests.
- Affected API clients: Flutter can replace mock services with HTTP implementations using existing model JSON keys and enum names.
- Affected data model: users, families, family members, children, training classes, recurring rules, lessons, attendance records, leave records, suspension periods, and derived cost reports.
- External systems: SMS sending can be implemented behind an adapter; MVP can use deterministic/dev verification code while preserving production extension points.
