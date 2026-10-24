# MCP 集成说明

## 1. 使用的 MCP Server

- 名称：麦当劳中国 MCP Server
- 地址：`https://mcp.mcd.cn`
- 传输：Streamable HTTP
- 鉴权：`Authorization: Bearer <MCD_MCP_TOKEN>`，Token 仅保存在服务端环境变量，不下发到浏览器。

## 2. 使用的 Tool

### 只读工具

| Tool | 用途 | 本项目中的调用位置 |
|---|---|---|
| `query-nearby-stores` | 根据城市/商圈查询附近可下单门店 | `lib/mcp-live.js` · `LiveMcp.nearbyStores` |
| `query-meals` | 获取门店当前在售菜单与餐品价格 | `LiveMcp.menu` → `normalizeMenu` |
| `query-store-coupons` | 获取当前门店可用券 | `LiveMcp.coupons` → `normalizeCoupons` |
| `list-nutrition-foods` | 获取餐品营养数据，用于热量/蛋白约束 | `LiveMcp.nutrition` → `normalizeNutrition` |
| `calculate-price` | 对候选方案逐单核价 | `LiveMcp.price` / `LiveMcp.priceQuote` |
| `query-my-coupons` | 实时券包（账号级） | `LiveMcp.accountData` |
| `query-my-account` | 实时积分（账号级） | `LiveMcp.accountData` |
| `campaign-calendar` | 活动日历 | `LiveMcp.accountData` |
| `query-order` / `order-list` | 订单状态轮询与对账 | `LiveMcp.queryOrder` / `listOrders` |

### 写工具（仅单用户私有模式）

| Tool | 用途 | 开关 |
|---|---|---|
| `auto-bind-coupons` | 领取报价中的单张最优券 | `ENABLE_COUPON_CLAIM=true` |
| `create-order` | 创建待支付订单 | `ENABLE_ORDER_CREATE=true` |
| `cancel-order` | 取消未支付重复订单 | `ENABLE_ORDER_CREATE=true` |

写工具只在 `ENABLE_WRITE=true` + `SINGLE_USER_MODE=true` + `WRITE_PASSCODE` 已配置 + 页面已解锁时调用。演示模式只模拟状态，不会触发真实写操作。

> 写工具的具体参数、幂等语义和返回结构需在真实 Token 联调时以官方 MCP schema 为准。未完成联调前，请保持 `ENABLE_WRITE=false`，只使用演示执行。

## 3. 省单管家：模块定位与 MCP 接入方式

省单管家是页面上的**自动化执行层**，不是新的 MCP 客户端。它把"备单 → 领券 → 续报价 → 下单 → 轮询 → 对账"串成一条链路，用户只保留两个主动动作：点一次「一键算最省」、点一次「确认下单」。

### 3.1 浏览器与 MCP 的边界

```text
浏览器                      Node 服务端                     麦当劳 MCP
  │  GET /api/steward          │                                │
  ├───────────────────────────>│  读 runtime.json + 调用轨迹      │
  │<───────────────────────────┤  只返回展示字段（无 Token）       │
  │                            │                                │
  │  POST /api/quote           │  optimize() → calculate-price  │
  ├───────────────────────────>│───────────────────────────────>│
  │  POST /api/coupons/claim   │  auto-bind-coupons             │
  ├───────────────────────────>│───────────────────────────────>│
  │  POST /api/orders          │  create-order                  │
  ├───────────────────────────>│───────────────────────────────>│
  │  GET /api/orders/:id       │  query-order                   │
  ├───────────────────────────>│───────────────────────────────>│
```

- 浏览器永远不直连 `https://mcp.mcd.cn`，`MCD_MCP_TOKEN` 只在服务端环境变量。
- `/api/steward` 是**只读聚合端点**，不新增写能力；写操作仍走既有的 quote / claim / orders / reconcile 端点。
- 响应只包含：模式、管道 5 步状态、8 项自动化目录、最近一条报价/订单摘要。不含 Token、MCP 请求头、账号凭证、门店 id、完整订单链接。

### 3.2 MCP 管道可视化

服务端在 `LiveMcp.call()` 统一埋点，记录每次工具调用的「工具名 / 成败 / 耗时 / 时间」，滚动保留最近 20 条；**不记录入参、出参、地址、手机号或 Token**。页面把它映射成 5 步管道：

| 管道步骤 | 对应 Tool |
|---|---|
| 定位门店 | `query-nearby-stores` |
| 读取菜单 | `query-meals` |
| 合并券包 | `query-store-coupons` |
| 匹配营养 | `list-nutrition-foods` |
| 官方核价 | `calculate-price` |

demo 模式没有真实轨迹，管道统一显示「演示」；live 模式下有记录走「已完成 / 失败」，无记录显示「等待」。

### 3.3 轨迹边界

- ring buffer 上限 20 条，进程内内存，不落盘、不进审计日志。
- 只用于页面展示"这条链路刚刚走通了没有"，不作为计费或对账依据。

## 4. 自动化覆盖范围与触发条件

8 项自动化按触发类型分三类：**事件触发**（1/2/4/5）、**时间触发**（3/6/7/8）、**状态触发**（价格变化中止、达上限暂停、live 降级、解锁状态变化）。

| # | id | 名称 | 触发条件 | 动作 | 门控与默认 | 失败/边界 |
|---|---|---|---|---|---|---|
| 1 | autoPrepare | 自动备单 | 事件：optimize 成功 | 后台 `POST /api/quote` 生成报价快照（5 分钟有效）；同输入旧报价标记 superseded | 无门控；默认开 | 失败→状态条 error 态，可手动重试；报价表保留最近 20 条防膨胀 |
| 2 | autoClaim | 自动领券 | 事件：报价生成且含最优券，开关开启 | `POST /api/coupons/claim` 领取单张最优券 | demo 模拟，默认开；live 需 `ENABLE_COUPON_CLAIM` + 解锁，默认关 | 未解锁→显示"待解锁"；失败→保留手动领取入口 |
| 3 | autoRefresh | 自动续期 | 时间：报价剩余 <30s，或下单时发现过期 | 重新核价生成新报价 | 无门控；默认开 | 价格变化→中止并提示重新确认（保留 `PRICE_CHANGED` 语义） |
| 4 | autoPoll | 自动轮询 | 事件：订单创建 | 5s 轮询 `GET /api/orders/:id`，窗口 5 分钟 | 无门控 | 失败静默；管家中心提供手动"刷新状态" |
| 5 | autoReconcile | 自动对账 | 事件：订单创建后 / 打开管家中心（30s 节流） | `POST /api/orders/reconcile` 取消重复未支付单，保留最新一单 | demo 默认开；live 依 `ENABLE_AUTO_CANCEL_UNPAID` | 已支付订单不动 |
| 6 | paymentDue | 支付提醒 | 时间：订单创建 5 分钟未支付 | 写提醒 + 待办（一键"去支付"） | 无门控 | 已支付则清除 |
| 7 | autoRepurchase | 自动复购 | 时间：固定套餐 `nextRunAt` 到点（服务端 60s tick） | 现有 `processSubscriptions` | demo 模拟；live 需 `ENABLE_AUTO_REPURCHASE` + 解锁；默认关 | 达每日上限自动暂停 |
| 8 | couponExpiry | 券到期盯防 | 时间：券距到期 <24h（服务端同步券包时检测） | 写提醒 + 待办（去下单） | 无门控 | — |

端上 5 项（1–5）在管家中心可逐项开关，偏好存在 `localStorage`；服务端 3 项（6–8）由服务端定时器/写操作触发，页面只展示门控说明，不做假开关。

### 4.1 待办动作映射

| 提醒类型 | 待办动作 |
|---|---|
| `payment_due` | 去支付（打开官方支付链接 / 订单卡） |
| `quote_expiry` | 续报价（触发 autoRefresh） |
| `coupon_claimed` | 无动作（信息） |
| `duplicate_orders` | 查看对账结果 |
| `subscription_limit` | 管理固定套餐 |
| `coupon_expiry` | 去下单 |

### 4.2 降级

`GET /api/steward` 失败时只隐藏状态条、管家中心的管道区块降级为提示文案；「算」与「下单」不受影响，顶栏模式徽标仍反映当前数据模式。

## 5. 调用流程

### 只读决策流程

```text
浏览器
  │  只发送预算 / 目标 / 人数 / 忌口 / 门店
  ▼
麦门省一单 Node 服务端
  │  1. query-nearby-stores  定位门店
  │  2. query-meals          拉取在售菜单
  │  3. query-store-coupons  拉取当前门店可用券
  │  4. list-nutrition-foods 匹配热量 / 蛋白质
  │  5. 本地确定性优化器      生成候选组合
  │  6. calculate-price       对 Top 方案逐单核价
  ▼
返回三套方案：最省 / 最饱 / 最均衡
```

### 执行流程（演示模拟 / 私有实时）

```text
点「一键算最省」
  → 管家自动备单：生成报价快照（锁定门店/商品/券/金额，5 分钟有效）
  → 管家自动领券：领取单张最优券（未解锁则保留手动入口）
  → 点「确认下单」→ 确认卡核对金额/门店/取餐/券/实付
  → 创建待支付订单（二次核价，无需复选框）
  → 返回订单号与官方支付链接，管家 5 秒轮询订单状态
  → 未支付重复单自动对账并 cancel-order（保留最新一单）
  → 报价剩余 <30 秒时自动续期，价格变化则要求重新确认
```

优化器只负责枚举、约束过滤和排序，不做价格猜测；实时模式最终金额以 `calculate-price` 返回为准。若任一实时工具失败，服务端自动降级为演示数据，并在页面明确提示，不会静默使用假价格。

## 6. 业务价值

1. **把“领券 + 选品 + 比价 + 核价”压缩成一个动作。** 用户不需要理解券门槛、套餐结构和渠道差异。
2. **把分散的省钱能力合并成一个决策结果。** 预算、热量、人数、忌口、积分抵扣同时进入求解器，输出可执行的三套方案。
3. **把“凑单陷阱”显式化。** 当为触发满减而加购会导致实付上升时，方案中会标注“已避开 N 个凑单陷阱”。
4. **零客户端配置。** MCP Token 在服务端统一管理，终端用户打开网页即可使用，不需要安装 MCP Client 或填写 Token。
5. **可审计。** 每个金额都有商品小计、券、积分、配送/包装费拆解；实时模式保留 `calculate-price` 核价标记。

## 7. 隐私与安全

- Token 只在服务端保存：每个浏览器身份的 Token 写入 `data/users/<uid>.json`（`0600`、已 gitignore）；环境变量 `MCD_MCP_TOKEN` 只作为共享体验账号，不参与任何用户写操作。
- 页面接入时 Token 只在提交瞬间经同源请求到服务端，浏览器不写 localStorage、不回显；`/api/live/status` 只返回连接状态、来源与错误码，任何 API 响应都不含 Token。
- 前端不接收账号、订单、手机号等个人信息；实时账号数据只在服务端调用。
- API 响应不包含 Token、原始 MCP 请求头或账号凭证。
- 服务仅监听 `127.0.0.1`，由 Nginx 反向代理对外提供页面。
- 演示模式只模拟写操作；实时写操作需要单用户私有模式 + 口令解锁。
- 写操作使用一次性确认令牌、二次核价、金额/频次上限、幂等状态机与审计日志。
- 不自动支付；支付在麦当劳官方渠道完成；已支付订单不自动取消或退款。
- 演示模式与实时模式、演示执行与私有实时在页面有明确标识。

## 8. 实时模式启用

### 8.1 页面绑定（推荐给终端用户）

首页「用你自己的麦当劳账号下单」卡片 → 粘贴 Token → 勾选授权 → 「绑定我的账号」。

服务端流程：

1. 形状校验（长度 8–512、无空白、仅 base64url/JWT 字符）；
2. 用该 Token 建立 Streamable HTTP 连接，并调用 `query-my-account` 读取身份；
3. 身份字段脱敏后写入 `data/users/<uid>.json`（`0600`），热切换该 uid 的专属连接；
4. 失败 → 不落盘、不覆盖已有绑定，返回 `INVALID_TOKEN` / `IDENTITY_FAILED` / `TIMEOUT` / `NETWORK`，页面给出对应说明。

三层身份与写权限（`lib/access.js` 是唯一判定点）：

| mode | 条件 | 读数据 | 写操作 |
|---|---|---|---|
| `own` | 已绑定 + 已授权 + 连接可用 | 该用户自己的 MCP | 允许，受 `ENABLE_*` 与限额约束 |
| `host` | 未绑定，但配置了 `MCD_MCP_TOKEN` | 我方 MCP（只读） | 拒绝，返回 `OWN_TOKEN_REQUIRED` |
| `none` | 未绑定且无共享 Token | 演示数据 | 仅演示写（`DEMO_WRITE`），不触真实账户 |

数据隔离：报价、订单、提醒、固定套餐、券包都带 `owner`（匿名 uid）；列表按 owner 过滤，单条读写失败即 404；访问他人记录返回 `OWNER_MISMATCH`。身份是签名 Cookie `ms_uid`（HttpOnly、SameSite=Lax、1 年），换浏览器/清 Cookie 等于换身份。

边界：只接受同源请求，每分钟最多 5 次绑定；`DISABLE_LIVE_SETUP=true` 可整体关闭该入口；环境变量 Token 永远只用于只读体验。

### 8.2 环境变量接入（推荐给部署者）

**注意：`MCD_MCP_TOKEN` 现在只作为「我方 MCP 体验账号」，不会替任何用户下单。** 想用自己的账号下单，必须在页面绑定自己的 Token。


只读实时模式：

```bash
MCD_MCP_TOKEN=你的_MCP_Token
ENABLE_LIVE=true
```

私有实时写模式：

```bash
MCD_MCP_TOKEN=你的_MCP_Token
ENABLE_LIVE=true
SINGLE_USER_MODE=true
ENABLE_WRITE=true
ENABLE_COUPON_CLAIM=true
ENABLE_ORDER_CREATE=true
ENABLE_AUTO_REPURCHASE=true
ENABLE_AUTO_CANCEL_UNPAID=true
WRITE_PASSCODE=设置一个私有口令
SESSION_SECRET=设置一个随机长字符串
MAX_ORDER_CENTS=5000
MAX_DAILY_ORDERS=5
```

### 8.3 接入后的页面变化

1. 顶部模式徽标从「体验模式」变为「已绑定我的账号」，卡片显示脱敏昵称与会员号；
2. MCP 管道从「演示」变为该用户真实的工具调用耗时；
3. 「确认下单」走本人账号，订单卡标注「已用你的账号提交 · 待你支付」；
4. 每单仍需在页面点确认，系统不自动付款。

### 8.4 解绑

点卡片的「解绑」：关闭该 uid 的连接、删除 `data/users/<uid>.json`，页面回到体验模式。解绑只影响当前浏览器身份，其他用户不受影响。

## 9. 降级策略

| 异常 | 处理 |
|---|---|
| 未配置 Token | 使用演示数据，页面显示“演示数据”，接入卡片提示填写 |
| Token 校验失败（401） | 不落盘，返回 `INVALID_TOKEN`，卡片显示“校验失败”并保留输入 |
| 页面接入时 MCP 不可达 | 返回 `TIMEOUT` / `NETWORK`，不改变当前数据模式 |
| 接入后 MCP 掉线 | 单次算价回退演示数据并提示；接入状态保留，可重试或断开 |
| Token 失效 / 401 | 回退演示数据，并提示实时接口不可用 |
| 实时菜单为空 | 回退演示数据 |
| `calculate-price` 失败 | 保留本地试算价，标注“本地试算”，并提示官方核价暂未成功 |
| 外送模式缺少账号地址 | 实时模式暂不支持，回退演示外送数据 |
| 写操作未开启 / 未解锁 | 返回 `WRITE_DISABLED` / `WRITE_LOCKED`，不产生任何写操作 |
| 创建订单时价格变化 | 返回 `PRICE_CHANGED`，中止下单并要求重新生成报价 |
| 创建订单超时 | 不盲目重试；通过 `order-list` / `query-order` 对账 |
| 重复未支付订单 | 对账后取消重复单；已支付订单转官方客服 |
| 自动复购达到上限 | 自动关闭该固定套餐并写入提醒 |
| 自动复购异常 | 记录失败运行、保留下一次排期，不无限重试 |

## 10. 数据口径

- 演示数据为产品演示用示例价格，不代表任何真实门店库存或实际售价。
- 演示写操作只改变本地运行时状态，不产生真实订单或扣款。
- 实时模式价格来自麦当劳 MCP，最终以官方结算页为准。
- 实时写操作只在单用户私有模式解锁后开启；支付、退款、客诉均以麦当劳官方渠道为准。
- 营养数据用于排序和展示，不构成医疗或营养建议。
