# 省单管家（Steward）模块设计稿

- 日期：2026-10-24
- 项目：麦门省一单（maimen-save-one）
- 状态：已实施（v1.2.0），实施计划见 `docs/superpowers/plans/2026-10-24-steward-module-plan.md`
- 目标：在现有页面上集成「配备 MCP 的自动化管家模块」，简化主路径操作、减少认知负担，并明确模块定位、MCP 接入方式与自动化覆盖范围/触发条件。

## 1. 背景与问题

现状（改动前）：

- MCP 仅在服务端接入（`lib/mcp-live.js`），页面只通过顶栏徽标区分"演示数据 / 实时数据"，MCP 能力对用户不可见。
- 主路径约 8 步：设参数 → 算 → 选方案 → 开执行中心 → 生成报价 → 点领券 → 点生成订单 → 勾选 → 确认 → 打开支付。
- 两个模态中心（执行中心、提醒中心）职责交叠：提醒中心里放着固定套餐管理，执行中心里放着报价/领券/下单/支付，用户需要自行在两者之间衔接。
- 已有自动化零散且不可见：服务端固定套餐复购（60s tick）、重复单对账（手动"一键对账"）、提醒（报价过期/支付提醒/券到期）。

目标：

1. 模块化：新增用户可见的「省单管家」模块，作为页面的自动化执行层。
2. 简化：主路径从 8+ 步压缩到 3 步（算 → 确认下单 → 确认卡）。
3. 自动化：8 项自动化任务明确触发条件并自动衔接；失败可降级、可手动兜底。
4. 一致性：复用现有设计 token、组件样式、交互逻辑（模态、toast、sticky bar、badge）。
5. 双端可用：桌面（≥921px）与移动（360px 起）均正常。

## 2. 模块功能定位

**一句话**：用户只做两件事——点一次「算」、点一次「确认下单」；其余（备单、领券、续报价、轮询、对账、复购、提醒）由管家按触发条件自动衔接。

三个能力域：

1. **管道可视化**：真实展示服务端 MCP 调用链路（定位门店 → 读取菜单 → 合并券包 → 匹配营养 → 官方核价）与数据模式/降级状态。live 模式展示真实调用轨迹；demo 模式明确标注"演示数据"。
2. **自动化编排**：8 项自动化任务的开关、触发条件说明、运行记录。
3. **待办衔接**：原提醒升级为带一键动作的待办（去支付 / 续报价 / 重算 / 处理重复单等）。

## 3. 信息架构与页面落点

### 3.1 顶栏

- 原铃铛（`#remindersBtn`，提醒中心）升级为管家入口：图标改为管家图标，`aria-label="省单管家"`，badge（`#reminderBadge`）语义改为"未读待办数"。
- 位置、尺寸、badge 样式不变。

### 3.2 结果区「管家状态条」（新增，内联）

位置：`#results` 内、`results-head` 之下、`plan-grid` 之上。

内容（左）：状态图标 + 两行文案
- 第一行：`管家已接管 · 已自动备单`（随状态变化）
- 第二行：`报价 4:59 · 券已领 · 演示数据`（倒计时、券状态、数据模式）

内容（右）：主操作按钮（随状态变化）

状态机（`steward-strip` 数据状态）：

| 状态 | 触发 | 文案 | 主按钮 |
|---|---|---|---|
| hidden | 未算过 | — | — |
| preparing | 算完、备单请求中 | 管家正在备单… | 禁用 |
| ready | 报价生成成功 | 已自动备单 · 报价 m:ss · 券已领/无需领券 | 确认下单 |
| claimed | 领券成功（ready 子态） | 同上，第二行含"券已领" | 确认下单 |
| refreshing | 报价剩余 <30s 自动续期 / 下单时过期 | 报价已自动续期 | 禁用 |
| ordered | 订单创建 | 订单待支付 · 状态自动轮询中 | 去支付 |
| expired | 续期失败或开关关闭 | 报价已过期 | 重新备单 |
| error | 备单失败 | 备单失败，可手动重试 | 重试备单 |

### 3.3 管家中心（模态，吸收提醒中心 + 执行中心）

复用现有模态容器与交互（`modal hidden` + backdrop + Escape 关闭 + 焦点管理），内部 5 区块：

1. **这一单**：当前报价/订单状态与操作。
   - 报价态：方案名 + 金额 + 门店 + 取餐方式 + 报价倒计时 + 4 步进度（报价已生成 / 领取最优券 / 创建待支付订单 / 完成支付，复用 `execution-step` 样式）。
   - 操作：确认下单、重新生成报价、复制清单、存为固定套餐。
   - 订单态：订单卡（状态、金额、门店、模式、打开官方支付、模拟支付（演示）、取消未支付、刷新状态）。
   - 私有模式未解锁时显示解锁框（复用现有 `unlock-box`）。
2. **待办**：未读提醒列表，每条带类型标签 + 标题/正文/时间 + 一键动作 + "知道了"。
3. **自动化**：8 项任务卡片（名称、触发条件文案、开关（客户端项）、门控说明（live 项）、最近运行时间）。
4. **MCP 管道**：5 步管道状态（完成/演示/等待/失败 + 最近调用时间与耗时）、数据模式、降级说明。
5. **权益与固定套餐**：原提醒中心内容（积分/券/活动 + 固定套餐卡片与管理）。

### 3.4 执行中心退役

- `#actionModal`（执行中心）不再作为独立入口；其内容（报价步骤、领券、订单卡、解锁框、固定套餐表单）并入管家中心「这一单」。
- 结果区 `results-actions` 的「执行中心」按钮改为「查看管家」；主操作由状态条与移动端底部条承担。
- 报价生成不再需要用户手动进入执行中心触发。

### 3.5 主操作按钮

- 全端：管家状态条内的主按钮（确认下单 / 去支付 / 重试备单）。
- 移动端（≤920px，现有 sticky bar 可见区间）：底部固定条 `#stickyBar` 的「复制清单」替换为「确认下单」（复制入口保留在方案明细弹窗）。
- 确认下单为两步：点「确认下单」→ 出现确认卡（金额、门店、取餐方式、券、实付，单按钮「确认生成待支付订单」）→ 创建订单。原复选框勾选步骤取消（确认卡即确认）。
- 下单失败 `PRICE_CHANGED`：自动重新备单并提示"价格已变化，请重新确认"，不静默下单。

## 4. MCP 接入方式

### 4.1 原则（不变）

- 浏览器永不直连 MCP；`MCD_MCP_TOKEN` 只在服务端环境变量；API 响应不含 Token、原始 MCP 请求头或账号凭证。
- 写操作门控不变：demo 模拟；live 需 `ENABLE_WRITE` + `SINGLE_USER_MODE` + `WRITE_PASSCODE` + 页面解锁，且受 `MAX_ORDER_CENTS`、`MAX_DAILY_ORDERS`、一次性确认令牌、二次核价约束。
- 不自动支付；已支付订单不自动取消/退款。

### 4.2 新增只读端点 `GET /api/steward`

聚合返回（不含敏感信息）：

```json
{
  "ok": true,
  "mode": "demo | live",
  "liveState": "connected | disabled | no-token | error | starting",
  "serverTime": "ISO",
  "pipeline": [
    { "id": "stores",    "label": "定位门店", "tool": "query-nearby-stores",  "state": "done | demo | pending | failed", "lastAt": "ISO | null", "lastMs": 812 },
    { "id": "menu",      "label": "读取菜单", "tool": "query-meals",          "state": "...", "lastAt": "...", "lastMs": 0 },
    { "id": "coupons",   "label": "合并券包", "tool": "query-store-coupons",  "state": "...", "lastAt": "...", "lastMs": 0 },
    { "id": "nutrition", "label": "匹配营养", "tool": "list-nutrition-foods", "state": "...", "lastAt": "...", "lastMs": 0 },
    { "id": "price",     "label": "官方核价", "tool": "calculate-price",      "state": "...", "lastAt": "...", "lastMs": 0 }
  ],
  "automations": [
    { "id": "autoPrepare", "label": "自动备单", "scope": "client", "trigger": "算完自动生成报价快照", "gated": false, "gateReason": "", "lastRunAt": null }
  ],
  "lastQuote": { "id": "q_...", "status": "quoted | ordered | expired", "planLabel": "最省", "finalCents": 2500, "expiresAt": "ISO", "createdAt": "ISO" },
  "lastOrder": { "id": "o_...", "status": "pending_payment | paid | cancelled", "amountCents": 2500, "createdAt": "ISO" }
}
```

- `lastQuote` / `lastOrder` 取自服务端持久化（`runtime.json`），页面刷新后"这一单"不丢。
- `automations` 为静态目录 + 服务端门控状态（`gated`/`gateReason` 由 capabilities 推导）；客户端开关状态由浏览器本地合并展示。
- 客户端在：算完、打开管家中心、订单状态变化时拉取。
- 降级：`/api/steward` 失败只隐藏/降级管家状态条（回退为现有 mode 徽标信息），不阻塞「算」与「下单」。

### 4.3 新增 MCP 调用轨迹（lib/mcp-live.js）

- 模块内存 ring buffer（上限 20 条），每次工具调用记录：`{ tool, ok, ms, at }`。
- 覆盖调用点：`query-nearby-stores`、`query-meals`、`query-store-coupons`、`list-nutrition-foods`、`calculate-price`、`query-order`、`order-list`、`auto-bind-coupons`、`create-order`、`cancel-order`。
- **不记录**：入参、出参、地址、手机号、Token 或任何账号标识。
- 导出 `recordToolCall()` 与 `getToolTrace()`；demo 模式无轨迹时管道按 `demo` 状态展示。

### 4.4 服务端聚合逻辑

- 新增 `lib/steward.js`：纯函数 `buildStewardView({ mode, liveState, trace, lastQuote, lastOrder, capabilities })`，可单测。
- `server.js` 增加 `GET /api/steward` 路由；报价/订单摘要由 action-service/runtime-store 提供（新增 `latestQuoteAndOrder()` 读取函数）。

## 5. 自动化目录（覆盖范围与触发条件）

| # | id | 名称 | 触发条件（类型） | 动作 | 门控与默认 | 失败/边界 |
|---|---|---|---|---|---|---|
| 1 | autoPrepare | 自动备单 | 事件：optimize 成功 | 后台 `POST /api/quote` 生成报价快照（5 分钟有效）；同一输入的旧报价标记 superseded | 无门控；默认开 | 失败→状态条 error 态，可手动重试；报价表保留最近 20 条防膨胀 |
| 2 | autoClaim | 自动领券 | 事件：报价生成且含最优券，开关开启 | `POST /api/coupons/claim` 领取单张最优券 | demo 模拟，默认开；live 需 `ENABLE_COUPON_CLAIM` + 解锁，默认关 | 未解锁→状态条提示"待解锁"；失败→保留手动领取入口 |
| 3 | autoRefresh | 自动续期 | 时间：报价剩余 <30s，或下单时发现过期 | 重新核价生成新报价 | 无门控；默认开 | 价格变化→中止并提示重新确认（保留 PRICE_CHANGED 语义） |
| 4 | autoPoll | 自动轮询 | 事件：订单创建 | 5s 轮询订单状态，窗口 2 → 5 分钟 | 无门控 | 失败静默；管家中心提供手动"刷新状态" |
| 5 | autoReconcile | 自动对账 | 事件：订单创建后 / 打开管家中心 | `POST /api/orders/reconcile` 取消重复未支付单 | demo 默认开；live 依 `ENABLE_AUTO_CANCEL_UNPAID` | 已支付订单不动 |
| 6 | paymentDue | 支付提醒 | 时间：订单创建 5 分钟未支付 | 写提醒 + 待办（一键"去支付"） | 无门控 | 已支付则清除 |
| 7 | autoRepurchase | 自动复购 | 时间：固定套餐 `nextRunAt` 到点（服务端 60s tick） | 现有 `processSubscriptions` | demo 模拟；live 需 `ENABLE_AUTO_REPURCHASE` + 解锁；默认关 | 达每日上限自动暂停（现有） |
| 8 | couponExpiry | 券到期盯防 | 时间：券距到期 <24h（管家刷新时检测） | 写提醒 + 待办（去下单） | 无门控 | — |

触发类型归纳：**事件触发**（1/2/4/5）、**时间触发**（3/6/7/8）、**状态触发**（价格变化中止、达上限暂停、live 降级、解锁状态变化）。

### 5.1 待办动作映射

| 提醒类型 | 待办动作 |
|---|---|
| payment_due | 去支付（打开订单卡/支付链接） |
| quote_expiry | 续报价（触发 autoRefresh） |
| coupon_claimed | 无动作（信息） |
| duplicate_orders | 查看对账结果 |
| subscription_limit | 管理固定套餐 |
| coupon_expiry | 去下单 |

## 6. 主路径对照

改动前（8+ 步）：
打开 → 设参数 → 算 → 选方案 → 开执行中心 → 生成报价 → 点领券 → 点生成订单 → 勾选 → 确认 → 打开支付 →（提醒中心跟进）

改动后（3 步）：
打开（默认参数已给）→ 点「一键算最省」（自动备单 + 自动领券）→ 点「确认下单」→ 确认卡（一步核对金额/门店/券）→ 去支付

用户主动操作：算 → 确认下单 → 确认 = 3 次点击。其余由管家自动衔接。

## 7. 桌面 / 移动适配

- 状态条：≥720px 单行（状态左、按钮右）；<720px 两行（状态行 + 操作行），按钮高度 ≥44px。
- 移动端（≤920px）底部固定条承接主操作；桌面端（≥921px）保持现有"隐藏 sticky bar"的行为，主操作在状态条内。
- 全部复用现有 token（`--red/--gold/--green/--cream/--paper/--radius-*/--shadow-*`）与既有组件样式（`execution-step`、`reminder-item`、`account-card`、`subscription-card`、`empty-state`、`loading-dots`）。
- 模态沿用现有移动端行为（`modal-card` 全宽、`max-height: min(86dvh, 820px)`、Escape 关闭、焦点还原）。
- 键盘可达：状态条按钮、待办动作、自动化开关均可聚焦；开关使用 checkbox + 现有 `.switch` 样式。
- `prefers-reduced-motion` 下不新增动画依赖。

## 8. 测试与验证

- 新增 `test/steward.test.js`（`node --test`）覆盖 `buildStewardView`：
  - 管道状态推导：trace 有 ok/fail 记录 → done/failed；无记录且 demo → demo；无记录且 live → pending。
  - `lastQuote`/`lastOrder` 选取（最新一条）与过期状态推导。
  - 自动化门控矩阵（demo/live × 各 ENABLE_* 开关 × 解锁状态）。
- 现有 `test/optimizer.test.js`、`test/action-service.test.js` 必须保持通过。
- 前端手工验证清单：
  - demo 模式：算 → 自动备单/领券 → 状态条就绪 → 确认下单 → 订单待支付 → 模拟支付 → 待办清空。
  - 自动化触发点：报价剩余 <30s 自动续期；重复单自动对账；固定套餐到点自动复购（模拟）。
  - 视口：360px（iPhone SE 级）、768px、1440px；键盘 Tab 顺序与 Escape 关闭。
  - 降级：断开服务端 → `/api/steward` 失败不影响算与下单（回退徽标信息）。
- live 模式验证受限于 Token（当前部署为演示数据模式），未联调项在文档中标注。

## 9. 文档更新

- `MCP_INTEGRATION.md`：新增"模块定位与 MCP 接入方式"、"自动化覆盖范围与触发条件"两节（含第 4、5 节内容），更新调用流程图为含管家的版本。
- `README.md`：更新关键路径（路径 7 重写为管家自动衔接）、界面交互原则（补充状态条与管家中心）、执行 API 表（新增 `GET /api/steward`）、目录结构（新增 `lib/steward.js`）。

## 10. 明确不做（YAGNI / 安全边界）

- 不新增写端点（复用 quote/claim/orders/subscriptions）。
- 不做自动支付；不自动取消/退款已支付订单。
- 不伪造实时价格；demo 模式所有自动化明确标注"演示"。
- 不做对话式自然语言输入；不做独立"盯价"任务（避免演示模式假价格）。
- 不改现有安全边界与限流、CSP 等响应头。

## 11. 风险与对策

| 风险 | 对策 |
|---|---|
| 自动备单导致 runtime.json 报价膨胀 | 同输入旧报价标记 superseded；报价保留最近 20 条 |
| live 模式自动领券误领 | live 默认关 + 需解锁 + 明确开关文案；demo 仅模拟 |
| 客户端新增定时器泄漏 | 复用现有 timer 模式，关闭模态/重算时清理 |
| 刷新后本地报价令牌丢失 | 刷新后"这一单"读服务端状态；确认下单前自动重新备单（自动续期） |
| 状态条/管家中心与现有模态冲突 | 复用现有 modal/closeAllModals 体系，不新增滚动锁逻辑 |
