# 课时管家三项迭代需求文档（后端）

> 版本：v0.1  
> 日期：2026-06-12  
> 状态：需求沉淀，待拆分 OpenSpec  
> 适用工程：`shike_guanjia_backend`

## 1. 概述

本轮迭代沉淀三个后续待开发能力：上课提醒、主题与皮肤选择、家庭共享增强。后端侧重点是保存跨设备一致的家庭级或用户级偏好、维持家庭数据授权边界、为 Flutter 端提供稳定的 JSON API 契约。

本文件只定义需求和接口方向，不直接修改运行时代码、OpenAPI 或数据库结构。后续进入规格阶段时，需要同步更新 `src/openapi.ts`、`docs/openapi.json`、`docs/api.md` 和对应测试。

## 2. 通用约定

- API 字段继续使用 `camelCase`。
- 枚举值继续使用字符串值。
- 时间字段继续使用 ISO-8601 字符串。
- 所有新增业务接口默认需要 `Authorization: Bearer <token>`。
- 成功响应保持 `{ "data": ... }`，错误响应保持 `{ "error": { "code", "message", "fields" } }`。
- 家庭仍是儿童、班级、课次、打卡、请假、费用等核心数据的授权边界。

## 3. 上课提醒功能

### 3.1 业务目标

帮助家庭成员在课前及时收到上课提醒，并在不同设备登录时保持一致的提醒偏好。Flutter 端负责本地通知调度、权限申请和系统通知展示；后端负责保存提醒设置并返回给客户端，不做服务端定时推送。

### 3.2 数据模型方向

新增提醒设置建议按家庭维度保存，保证同一家庭两个成员看到一致设置。

```ts
interface ReminderSettings {
  familyId: string;
  enabled: boolean;
  advanceMinutes: number;
  includeTodayLessons: boolean;
  includeMakeupLessons: boolean;
  updatedAt: string;
}
```

默认值：

- `enabled`: `true`
- `advanceMinutes`: `60`
- `includeTodayLessons`: `true`
- `includeMakeupLessons`: `true`

约束：

- `advanceMinutes` 只允许常用档位，例如 `15 | 30 | 60 | 120 | 1440`。
- 只提醒 `scheduled` 状态课次。
- 已打卡、已请假、已取消课次不进入提醒候选。

### 3.3 API 契约方向

#### GET /api/reminder-settings

获取当前家庭提醒设置。若尚未显式保存，返回默认设置。

#### PATCH /api/reminder-settings

更新当前家庭提醒设置。

请求体字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `enabled` | `boolean` | 否 | 是否启用提醒 |
| `advanceMinutes` | `number` | 否 | 提前提醒分钟数 |
| `includeTodayLessons` | `boolean` | 否 | 是否包含今日课次 |
| `includeMakeupLessons` | `boolean` | 否 | 是否包含补课课次 |

### 3.4 权限边界

- 登录用户只能读取和更新自己所属家庭的提醒设置。
- 提醒设置不按单个成员拆分，避免同一家庭成员看到的提醒策略不一致。
- 课次候选仍通过现有家庭范围查询，例如 `/api/lessons/upcoming`。

### 3.5 兼容性

- 不影响现有课次、打卡、请假逻辑。
- 未保存设置的老用户自动获得默认提醒设置。
- 后端不新增服务端定时任务，避免引入任务系统和消息通道依赖。

### 3.6 验收标准

- 已登录用户可以读取默认提醒设置。
- 修改提醒设置后，重新登录或换设备读取结果一致。
- 非当前家庭用户不能读取或修改其他家庭设置。
- 非法 `advanceMinutes` 返回字段级错误。

## 4. 主题与皮肤选择

### 4.1 业务目标

支持用户在 Flutter 端切换不同视觉主题，并在换设备登录后恢复上次选择。Flutter 端负责主题定义、即时切换和本地缓存；后端保存用户级主题偏好。

### 4.2 数据模型方向

主题偏好建议按用户维度保存，因为同一家庭成员可能有不同视觉偏好。

```ts
type ThemeSkin = 'warm' | 'fresh' | 'classic';

interface ThemePreference {
  userId: string;
  skin: ThemeSkin;
  updatedAt: string;
}
```

默认值：

- `skin`: `warm`

### 4.3 API 契约方向

#### GET /api/preferences/theme

获取当前用户主题偏好。若尚未保存，返回默认主题。

#### PATCH /api/preferences/theme

更新当前用户主题偏好。

请求体字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `skin` | `ThemeSkin` | 是 | 主题皮肤标识 |

### 4.4 权限边界

- 主题偏好只能由当前登录用户读取和修改。
- 主题偏好不影响家庭其他成员。
- 主题偏好不参与家庭共享数据授权。

### 4.5 兼容性

- 不改变现有用户模型的核心登录流程。
- 可先在现有存储边界上增加偏好集合，后续如迁移数据库表，不改变 API 返回结构。
- Flutter 端没有读取到服务端偏好时，可以继续使用本地默认主题。

### 4.6 验收标准

- 新用户读取主题偏好时返回 `warm`。
- 修改主题后再次读取返回最新值。
- 非法主题枚举返回校验错误。
- 退出登录不删除服务端主题偏好。

## 5. 家庭共享增强

### 5.1 业务目标

补齐家庭共享从“直接添加手机号成员”到“可理解、可处理异常、可后续扩展邀请态”的完整需求。MVP 继续保持一个家庭最多 2 人，共享成员拥有相同读写权限。

### 5.2 当前基础

当前后端已有以下能力：

- 登录首次创建用户和默认家庭。
- `GET /api/family`
- `GET /api/family/members`
- `POST /api/family/members`
- `DELETE /api/family/members/:memberId`
- 家庭最多 2 人。
- 不允许移除最后一个家庭成员。

### 5.3 数据模型方向

现有 `FamilyMember` 可继续保留。后续规格阶段可以补充邀请态模型，避免直接把未确认用户加入家庭。

```ts
type FamilyInviteStatus = 'pending' | 'accepted' | 'expired' | 'cancelled';

interface FamilyInvite {
  id: string;
  familyId: string;
  inviterUserId: string;
  inviteePhone: string;
  relation: 'mother' | 'father';
  status: FamilyInviteStatus;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string | null;
}
```

### 5.4 API 契约方向

规格阶段需要在两种方案中二选一：

- 保守方案：保留 `POST /api/family/members` 的直接添加语义，并增强错误码、展示字段和 Flutter 提示。
- 邀请方案：新增邀请接口，例如 `POST /api/family/invites`、`GET /api/family/invites`、`POST /api/family/invites/:inviteId/accept`、`DELETE /api/family/invites/:inviteId`。

无论采用哪种方案，都必须保持现有家庭共享查询接口可用。

### 5.5 权限边界

- 家庭成员对家庭内儿童、班级、课次、打卡、请假、费用拥有完整读写权限。
- 家庭最多 2 人的 MVP 限制继续保留。
- 不能移除最后一个家庭成员。
- 成员移除后，该用户再次登录不应继续访问原家庭数据。
- 不允许把同一个用户重复加入同一家庭。

### 5.6 兼容性

- 不破坏当前 Flutter 已接入的成员列表、添加成员、移除成员接口。
- 如果后续引入邀请态，需要兼容旧接口或在规格中明确迁移策略。
- 错误码和提示需要稳定，方便 Flutter 做定向展示。

建议错误码方向：

| 场景 | 错误码 |
|------|--------|
| 家庭成员已满 | `FAMILY_MEMBER_LIMIT_REACHED` |
| 用户已在家庭中 | `USER_ALREADY_IN_FAMILY` |
| 不能移除最后成员 | `CANNOT_REMOVE_LAST_MEMBER` |
| 邀请已过期 | `FAMILY_INVITE_EXPIRED` |
| 邀请不存在 | `FAMILY_INVITE_NOT_FOUND` |

### 5.7 验收标准

- 成员列表能返回当前家庭所有成员。
- 家庭最多只能保留 2 个成员。
- 添加重复成员返回明确错误。
- 移除最后一个成员失败。
- 被移除成员不能继续访问原家庭数据。
- Flutter 可根据错误码展示准确文案。

## 6. 后续规格拆分建议

建议后续拆成三个独立 OpenSpec change：

1. `add-lesson-reminder-settings`
2. `add-theme-preferences`
3. `enhance-family-sharing`

每个 change 至少包含：

- 后端 API spec delta。
- `src/types.ts` 类型变更。
- `src/store.ts` 持久化边界变更。
- `src/app-service.ts` 业务规则。
- `src/http.ts` 路由。
- `src/openapi.ts`、`docs/openapi.json`、`docs/api.md` 文档同步。
- `tests/api.test.ts` 对应用例。

## 7. 最小验证要求

后续进入代码实现时，后端最小验证为：

```bash
npm test
npm run typecheck
```

如果只修改文档，至少检查两端需求文档中的字段、枚举和业务边界一致。
