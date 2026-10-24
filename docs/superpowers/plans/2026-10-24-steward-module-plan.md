# 省单管家（Steward）模块 · 实施计划

- 日期：2026-10-24
- 状态：已实施（16 个任务全部完成，v1.2.0）
- 设计稿：`docs/superpowers/specs/2026-10-24-steward-module-design.md`（已确认）
- 目标：把主路径从 8+ 步压到 3 步（算 → 确认下单 → 去支付），并让 MCP 调用链与 8 项自动化在页面上可见、可控、可降级
- 代码基线：`ea7135b`，`npm test` 14/14 通过

## 0. 基线与硬约束

### 0.1 代码基线（改动前实测）

| 文件 | 行数 | 现状 |
|---|---|---|
| `server.js` | 901 | 原生 `http`，全部 API 由 `handleApi()` 单函数分发（22 个分支），末尾 `return false` → 404 |
| `lib/mcp-live.js` | 537 | `LiveMcp.call(name,args)` 是所有 MCP 工具调用的唯一出口 |
| `lib/action-service.js` | 668 | quote/order/subscription/reminder 全部持久化在 `runtime.json` |
| `lib/runtime-store.js` | 97 | `getState()` / `mutate()` 串行写盘 |
| `public/index.html` | 310 | 三个模态：`#detailModal`、`#actionModal`（执行中心）、`#remindersModal`（提醒中心） |
| `public/app.js` | 1804 | 全局 `state` + `els` 映射 + 直写 `innerHTML`，无框架、无构建 |
| `public/styles.css` | 2558 | 设计 token 在 `:root`，现有断点 560 / 920 / 921（计划新增 719 用于状态条换行） |
| `test/*.test.js` | 2 个 | `node --test`，14 个用例 |

### 0.2 不变量（任何任务都不得破坏）

1. 浏览器永不直连 MCP；`MCD_MCP_TOKEN` 只在服务端，`/api/steward` 响应不含 Token/请求头/账号标识。
2. 不新增写端点：复购 `quote` / `claim` / `orders` / `orders/reconcile` / `subscriptions`。
3. 不自动支付；已支付订单不自动取消。
4. 所有新 UI 复用现有 token（`--red/--gold/--green/--cream/--paper/--line/--radius-*/--shadow-*`）与既有组件类（`execution-step`、`reminder-item`、`account-card`、`subscription-card`、`empty-state`、`loading-dots`、`switch`）。
5. `prefers-reduced-motion` 下不新增动画依赖；新增动画必须有降级。
6. 服务端写盘只走 `mutate()`，不直接改 `state`。

### 0.3 两个容易被忽略的发布项（必做）

- **Service Worker 缓存**：`public/sw.js` 对 `app.js` / `styles.css` 是 cache-first，`CACHE_NAME` 必须从 `maimen-save-one-v1` 升到 `v2`，否则老用户永远拿到旧 UI。
- **HTTP 静态缓存**：`server.js` 对 js/css 下发 `public, max-age=3600`，需在 `index.html` 引资源时加版本查询串（`styles.css?v=1.2.0`、`app.js?v=1.2.0`），与 `APP_VERSION` 同步。

## 1. 落地架构

### 1.1 文件变更清单

| 文件 | 类型 | 职责 | 预估 |
|---|---|---|---|
| `lib/steward.js` | 新增 | 纯函数 `buildStewardView()` + 静态目录（管道 5 步、自动化 8 项） | ~150 行 |
| `test/steward.test.js` | 新增 | 管道推导 / 报价订单摘要 / 门控矩阵 | ~120 行 |
| `lib/mcp-live.js` | 改 | `call()` 内埋点，ring buffer 20 条，导出 `getToolTrace()` | +35 行 |
| `lib/action-service.js` | 改 | 新增 `latestQuoteAndOrder()`、`latestSubscriptionRun()` | +30 行 |
| `server.js` | 改 | `GET /api/steward`、`readToolTrace` 惰性绑定、版本号 | +35 行 |
| `public/index.html` | 改 | 顶栏管家入口、状态条、确认卡容器、管家中心模态、sticky bar 主按钮 | ±40 行 |
| `public/app.js` | 大改 | 编排层（备单/领券/续期/轮询/对账）+ 状态条 + 管家中心渲染 | +600 / −180 行 |
| `public/styles.css` | 改 | `.steward-*`、`.pipeline-*`、`.automation-*` 及响应式 | +170 行 |
| `public/sw.js` | 改 | `CACHE_NAME` → v2 | 1 行 |
| `MCP_INTEGRATION.md` / `README.md` | 改 | 新增两节、改路径 7、API 表、目录结构 | — |

### 1.2 前端编排层结构（app.js 内部）

```
state.steward = {
  view, failed, phase, confirmOpen, busy,
  auto: { autoPrepare, autoClaim, autoRefresh, autoPoll, autoReconcile },
  lastRunAt, gateNote, tickTimer, refreshLock
}

fetchSteward()        → GET /api/steward，失败置 failed=true，不抛错
setPhase(p)           → 唯一的状态机写入口，写 data-phase 并重绘状态条
prepareQuote()        → POST /api/quote（复用仍有效的报价）
autoClaimCoupon()     → POST /api/coupons/claim（单张最优券）
refreshQuote()        → 续期：prepareQuote({force:true}) + 失败降级 expired
confirmOrderAction()  → POST /api/orders（无复选框，确认卡即确认）
startStewardTimer()   → 1s tick：更新倒计时、<30s 触发续期、过期降级
openSteward()         → 模态 + 5 区块渲染
```

状态机（`data-phase`）唯一合法转移：

```
hidden → preparing → ready ⇄ refreshing
                   ↘ error → preparing
ready → ordered → (paid/cancelled, 停在 ordered 展示)
ready ⇄ expired
```

`claimed` 不是独立 phase，而是 `ready` 的第二行文案子态（`券已领` / `券待领` / `无需领券`）。

## 2. 任务分解

> 每个任务都可独立提交、独立验证。A 阶段先做，C 阶段依赖 A 的接口；B 与 A 可并行。

---

### Phase A · 服务端（4 个任务）

#### A1. MCP 调用轨迹（`lib/mcp-live.js`）

**文件**：`lib/mcp-live.js`

**步骤 1**：文件顶部（`TOOL_TIMEOUT_MS` 附近）加 ring buffer：

```js
const TRACE_LIMIT = 20;
const toolTrace = [];

export function recordToolCall(tool, { ok, ms }) {
  toolTrace.push({ tool, ok: Boolean(ok), ms: Math.max(0, Math.round(ms)), at: new Date().toISOString() });
  if (toolTrace.length > TRACE_LIMIT) toolTrace.splice(0, toolTrace.length - TRACE_LIMIT);
}

export function getToolTrace() {
  return toolTrace.map((entry) => ({ ...entry }));
}
```

**步骤 2**：`LiveMcp.call()`（第 335 行）改造，只记工具名/成败/耗时，**不记 args、不记返回值**：

```js
async call(name, args) {
  const started = Date.now();
  try {
    const result = await withTimeout(
      this.client.callTool({ name, arguments: args }),
      TOOL_TIMEOUT_MS,
      name,
    );
    recordToolCall(name, { ok: true, ms: Date.now() - started });
    return parseToolPayload(result);
  } catch (error) {
    recordToolCall(name, { ok: false, ms: Date.now() - started });
    throw error;
  }
}
```

**验收**：
- `grep -n "args\|payload" lib/mcp-live.js` 的 trace 段落只出现 `name`，无入参出参。
- 起服务并 `ENABLE_LIVE=false` 时 `getToolTrace()` 返回 `[]`（demo 无轨迹，管道按 `demo` 展示）。

**提交**：`feat(steward): record MCP tool trace ring buffer`

---

#### A2. 聚合视图纯函数（`lib/steward.js`）+ 单测

**文件**：`lib/steward.js`（新增）、`test/steward.test.js`（新增）

**步骤 1**：写静态目录。注意 `scope`：只有 client 项给开关，server 项只展示门控说明（否则用户关了也不会生效，是假开关）。

```js
const PIPELINE = [
  { id: "stores",    label: "定位门店", tool: "query-nearby-stores" },
  { id: "menu",      label: "读取菜单", tool: "query-meals" },
  { id: "coupons",   label: "合并券包", tool: "query-store-coupons" },
  { id: "nutrition", label: "匹配营养", tool: "list-nutrition-foods" },
  { id: "price",     label: "官方核价", tool: "calculate-price" },
];

const AUTOMATIONS = [
  { id: "autoPrepare",   label: "自动备单",   scope: "client", trigger: "算完自动生成报价快照", defaultOn: true,  gate: null },
  { id: "autoClaim",     label: "自动领券",   scope: "client", trigger: "报价含最优券时自动领取单张", defaultOn: true, gate: "couponClaim", gateReason: "实时模式需开启领券并解锁私有模式" },
  { id: "autoRefresh",   label: "自动续期",   scope: "client", trigger: "报价剩余不足 30 秒", defaultOn: true, gate: null },
  { id: "autoPoll",      label: "自动轮询",   scope: "client", trigger: "订单创建后每 5 秒，最长 5 分钟", defaultOn: true, gate: null },
  { id: "autoReconcile", label: "自动对账",   scope: "client", trigger: "订单创建后 / 打开管家中心", defaultOn: true, gate: "autoCancelUnpaid", gateReason: "实时模式需开启自动取消未支付单" },
  { id: "paymentDue",    label: "支付提醒",   scope: "server", trigger: "订单创建 5 分钟未支付", defaultOn: true,  gate: null },
  { id: "autoRepurchase",label: "自动复购",   scope: "server", trigger: "固定套餐到点（服务端 60 秒轮询）", defaultOn: false, gate: "autoRepurchase", gateReason: "实时模式需开启自动复购并解锁私有模式" },
  { id: "couponExpiry",  label: "券到期盯防", scope: "server", trigger: "券距到期不足 24 小时", defaultOn: true, gate: null },
];
```

**步骤 2**：推导函数（导出以便单测）：

```js
function lastCall(trace, tool) {
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const entry = trace[index];
    if (entry && entry.tool === tool) return entry;
  }
  return null;
}

export function derivePipelineState(trace, tool, mode) {
  const hit = lastCall(trace, tool);
  if (hit) {
    return { state: hit.ok ? "done" : "failed", lastAt: hit.at || null, lastMs: Number(hit.ms) || 0 };
  }
  return { state: mode === "demo" ? "demo" : "pending", lastAt: null, lastMs: 0 };
}

export function summarizeQuote(quote, now = Date.now()) {
  if (!quote) return null;
  const expiresAt = quote.expiresAt || null;
  const expired = expiresAt ? Date.parse(expiresAt) <= now : false;
  const status = quote.status === "ordered" ? "ordered" : expired ? "expired" : "quoted";
  return {
    id: quote.id,
    status,
    planLabel: quote.plan?.label || "",
    finalCents: Number(quote.plan?.price?.finalCents) || 0,
    couponClaimed: Boolean(quote.couponClaimed),
    expiresAt,
    createdAt: quote.createdAt || null,
  };
}

export function summarizeOrder(order) {
  if (!order) return null;
  return {
    id: order.id,
    status: order.status || "unknown",
    amountCents: Number(order.amountCents) || 0,
    createdAt: order.createdAt || null,
  };
}
```

**步骤 3**：`buildStewardView`：

```js
export function buildStewardView({
  mode = "demo",
  liveState = "disabled",
  trace = [],
  lastQuote = null,
  lastOrder = null,
  capabilities = {},
  subscriptionRunAt = null,
  now = Date.now(),
} = {}) {
  const caps = capabilities || {};
  return {
    mode,
    liveState,
    serverTime: new Date(now).toISOString(),
    pipeline: PIPELINE.map((step) => ({
      id: step.id,
      label: step.label,
      tool: step.tool,
      ...derivePipelineState(trace, step.tool, mode),
    })),
    automations: AUTOMATIONS.map((item) => {
      const gated = Boolean(item.gate) && caps[item.gate] === false;
      return {
        id: item.id,
        label: item.label,
        scope: item.scope,
        trigger: item.trigger,
        defaultOn: item.defaultOn,
        gated,
        gateReason: gated ? item.gateReason : "",
        lastRunAt: item.id === "autoRepurchase" ? subscriptionRunAt : null,
      };
    }),
    lastQuote: summarizeQuote(lastQuote, now),
    lastOrder: summarizeOrder(lastOrder),
  };
}
```

**步骤 4**：`test/steward.test.js`，`node --test` 下至少 9 个用例：

| 用例 | 断言 |
|---|---|
| demo 无轨迹 | 5 步全部 `state === "demo"`、`lastAt === null` |
| live 无轨迹 | 5 步全部 `pending` |
| trace 有 ok | 对应步 `done`，`lastMs` 透传 |
| trace 有 fail | 对应步 `failed` |
| 同工具多次调用 | 取最后一条（`lastCall` 从尾部扫） |
| 报价过期 | `status === "expired"` |
| 报价已下单 | `status === "ordered"`，即使已超时 |
| 门控矩阵 | demo 全 `gated=false`；live 且 caps 缺省 → 3 项 `gated=true` 且 `gateReason` 非空；live 且 caps 齐全 → 全 false |

**验收**：`npm test` → 14（旧）+ 9（新）= 23 通过，0 失败。

**提交**：`feat(steward): add buildStewardView pure module with tests`

---

#### A3. 读取"这一单"（`lib/action-service.js`）

**文件**：`lib/action-service.js`（追加导出，不改既有函数）

```js
export async function latestQuoteAndOrder(now = Date.now()) {
  const state = await getState();
  const quotes = Object.values(state.quotes || {});
  const orders = Object.values(state.orders || {});
  const byNewest = (a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0);
  return {
    quote: quotes.sort(byNewest)[0] || null,
    order: orders.sort(byNewest)[0] || null,
  };
}

export async function latestSubscriptionRun() {
  const state = await getState();
  const runs = Object.values(state.subscriptions || {})
    .map((item) => item.lastRunAt)
    .filter(Boolean)
    .sort();
  return runs.length ? runs[runs.length - 1] : null;
}
```

**注意**：返回原始对象会被 `buildStewardView` 二次摘要，路由层**不要**直接把 quote 原样返回（含 `plan.items`、`input.storeId` 等）。
**验收**：`getState().quotes` 为空时返回 `{ quote: null, order: null }`，不抛错。

**提交**：`feat(steward): expose latest quote and order snapshot`

---

#### A4. 新增 `GET /api/steward`

**文件**：`server.js`

**步骤 1**：顶部导入：

```js
import { buildStewardView } from "./lib/steward.js";
import { latestQuoteAndOrder, latestSubscriptionRun } from "./lib/action-service.js"; // 并入既有 import 块
```

**步骤 2**：惰性绑定 trace（`mcp-live.js` 是动态 import，demo 模式不能静态引）：

```js
let readToolTrace = () => [];

async function initLive() {
  ...
  const module = await import("./lib/mcp-live.js");
  liveOptimize = module.optimizeLive;
  readToolTrace = typeof module.getToolTrace === "function" ? module.getToolTrace : readToolTrace;
  ...
}
```

**步骤 3**：路由放在 `/api/capabilities` 之后：

```js
if (req.method === "GET" && pathname === "/api/steward") {
  const [{ quote, order }, subscriptionRunAt] = await Promise.all([
    latestQuoteAndOrder(),
    latestSubscriptionRun(),
  ]);
  const view = buildStewardView({
    mode: liveClient ? "live" : "demo",
    liveState,
    trace: readToolTrace(),
    lastQuote: quote,
    lastOrder: order,
    capabilities: capabilities(req),
    subscriptionRunAt,
  });
  sendJson(res, 200, { ok: true, ...view });
  return true;
}
```

**步骤 4**：`APP_VERSION` 升 `1.2.0`，`package.json` 同步。

**验收**：
```bash
node server.js &
curl -s localhost:8899/api/steward | head -c 600
```
- 返回含 `mode/pipeline[5]/automations[8]/lastQuote/lastOrder`。
- 响应中不含 `MCD_MCP_TOKEN`、`passcode`、`token` 字段（`grep -i token` 只允许出现在 `tool` 名的语义里，实际无 `token` 键）。
- demo 模式 `pipeline[].state` 全为 `demo`。

**提交**：`feat(steward): add GET /api/steward aggregate endpoint`

---

### Phase B · 结构与样式（2 个任务，可与 A 并行）

#### B1. `public/index.html` 结构改造

**文件**：`public/index.html`

**改动 1**：顶栏铃铛升级为管家入口（保留 id 与 badge，避免 JS 里 8 处引用翻新）：

```html
<button class="icon-button" id="remindersBtn" type="button" aria-label="省单管家" title="省单管家">
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="4" y="8" width="16" height="11" rx="4"></rect>
    <path d="M12 4.5V8"></path>
    <circle cx="9" cy="13" r="1.2"></circle>
    <circle cx="15" cy="13" r="1.2"></circle>
    <path d="M9.5 16.2h5"></path>
  </svg>
  <span class="notification-badge hidden" id="reminderBadge">0</span>
</button>
```

**改动 2**：`#results` 内、`#warnings` 之后、`#planCards` 之前插入状态条与确认卡容器：

```html
<div class="steward-strip" id="stewardStrip" data-phase="hidden" hidden aria-live="polite">
  <div class="steward-strip-main">
    <span class="steward-avatar" aria-hidden="true">
      <svg viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="11" rx="4"></rect><path d="M12 4.5V8"></path><circle cx="9" cy="13" r="1.2"></circle><circle cx="15" cy="13" r="1.2"></circle></svg>
    </span>
    <div class="steward-strip-copy">
      <b id="stewardStripTitle">管家待命</b>
      <small id="stewardStripMeta">算一单，剩下的交给管家</small>
    </div>
  </div>
  <div class="steward-strip-actions">
    <button type="button" class="ghost-button" id="stewardOpenBtn">查看管家</button>
    <button type="button" class="mini-button mini-button-red" id="stewardPrimaryBtn" disabled>确认下单</button>
  </div>
</div>
<div class="steward-confirm hidden" id="stewardConfirm"></div>
```

**改动 3**：`results-actions` 的「执行中心」改为「查看管家」：

```html
<button class="mini-button mini-button-red" id="stewardBtn" type="button">查看管家</button>
```

**改动 4**：删除 `#actionModal` 与 `#remindersModal` 两个模态块，替换为一个：

```html
<div class="modal hidden" id="stewardModal" role="dialog" aria-modal="true" aria-labelledby="stewardTitle">
  <div class="modal-backdrop" data-close="steward"></div>
  <div class="modal-card modal-card-wide">
    <button class="modal-close" type="button" data-close="steward" aria-label="关闭省单管家">×</button>
    <div id="stewardContent"></div>
  </div>
</div>
```

**改动 5**：sticky bar 的「复制清单」换「确认下单」（复制入口仍在 `#detailModal` 的 `data-action="copy"`）：

```html
<button type="button" class="ghost-button" id="stickyDetail">看明细</button>
<button type="button" class="mini-button mini-button-red" id="stickyOrder">确认下单</button>
```

**改动 6**：资源加版本串（配合 0.3 缓存策略）：

```html
<link rel="stylesheet" href="./styles.css?v=1.2.0">
<script type="module" src="./app.js?v=1.2.0"></script>
```

**改动 7**：`#infoModal` 的「执行模式」段落补一句管家说明（自动化不代付款、可逐项关闭）。

**验收**：纯静态打开页面无 JS 报错（`app.js` 尚未改完时状态条隐藏、模态不出现）。

**提交**：`feat(steward): add strip, confirm slot and steward modal shell`

---

#### B2. `public/styles.css` 新增样式

**文件**：`public/styles.css`（追加到「结果区」段之后，媒体查询并入既有断点块）

关键规则（可直接落地）：

```css
.steward-strip {
  display: flex;
  gap: 14px;
  align-items: center;
  justify-content: space-between;
  margin: 0 0 14px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: linear-gradient(180deg, var(--cream), var(--paper));
  box-shadow: var(--shadow-sm);
}
.steward-strip[hidden] { display: none; }
.steward-strip-main { display: flex; gap: 11px; align-items: center; min-width: 0; }
.steward-avatar {
  display: grid; place-items: center; flex: none;
  width: 34px; height: 34px;
  border-radius: 12px;
  color: var(--paper); background: var(--red);
}
.steward-avatar svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; }
.steward-strip-copy { min-width: 0; }
.steward-strip-copy b { display: block; font-size: 13px; }
.steward-strip-copy small { display: block; margin-top: 2px; color: var(--muted); font-size: 11px; }
.steward-strip-actions { display: flex; gap: 8px; align-items: center; flex: none; }

.steward-strip[data-phase="preparing"] .steward-avatar,
.steward-strip[data-phase="refreshing"] .steward-avatar { animation: steward-pulse 1.4s ease-in-out infinite; }
.steward-strip[data-phase="error"] { border-color: rgba(218, 41, 28, 0.35); background: var(--red-soft); }
.steward-strip[data-phase="expired"] { border-color: rgba(27, 26, 24, 0.14); }

@keyframes steward-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }

.steward-confirm {
  margin: 0 0 14px;
  padding: 14px 15px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--gold-soft);
}
.steward-confirm[hidden] { display: none; }
.steward-confirm-rows { display: grid; gap: 7px; margin: 10px 0 12px; }
.steward-confirm-rows div { display: flex; justify-content: space-between; font-size: 12px; }
.steward-confirm-rows b { font-family: var(--mono); }

/* 管家中心 */
.steward-hero-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.steward-nav { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0 6px; }
.steward-nav button { font-size: 11px; padding: 5px 10px; border-radius: var(--radius-pill); border: 1px solid var(--line); background: transparent; color: var(--muted); }
.steward-nav button.is-active { color: var(--paper); background: var(--ink); border-color: var(--ink); }

.pipeline { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.pipeline-step { display: flex; gap: 10px; align-items: center; padding: 10px 12px; border: 1px solid var(--line); border-radius: 13px; background: rgba(255, 255, 255, 0.6); }
.pipeline-dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--faint); }
.pipeline-step[data-state="done"] .pipeline-dot { background: var(--green); }
.pipeline-step[data-state="demo"] .pipeline-dot { background: var(--gold); }
.pipeline-step[data-state="failed"] .pipeline-dot { background: var(--red); }
.pipeline-step[data-state="pending"] .pipeline-dot { background: transparent; border: 1px solid var(--faint); }
.pipeline-step div { min-width: 0; flex: 1; }
.pipeline-step b { display: block; font-size: 12.5px; }
.pipeline-step small { color: var(--muted); font-size: 10.5px; font-family: var(--mono); }
.pipeline-tag { font-size: 10.5px; color: var(--muted); }

.automation-grid { display: grid; gap: 9px; }
.automation-card { padding: 12px 13px; border: 1px solid var(--line); border-radius: 14px; background: rgba(255, 255, 255, 0.6); }
.automation-card[data-gated="true"] { background: rgba(255, 248, 236, 0.9); }
.automation-head { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
.automation-head b { font-size: 13px; }
.automation-scope { font-size: 10px; padding: 2px 7px; border-radius: var(--radius-pill); background: rgba(27, 26, 24, 0.07); color: var(--muted); }
.automation-trigger { margin: 6px 0 9px; color: var(--muted); font-size: 11.5px; }
.automation-foot { display: flex; gap: 10px; align-items: center; justify-content: space-between; }
.automation-foot small { color: var(--faint); font-size: 10.5px; }
.automation-gate { color: var(--red); font-size: 10.5px; }
.switch-row-compact { gap: 0; padding: 0; }

@media (max-width: 719px) {
  .steward-strip { flex-direction: column; align-items: stretch; }
  .steward-strip-actions { justify-content: flex-end; }
  .steward-strip-actions .mini-button,
  .steward-strip-actions .ghost-button { min-height: 44px; }
}

@media (prefers-reduced-motion: reduce) {
  .steward-strip[data-phase="preparing"] .steward-avatar,
  .steward-strip[data-phase="refreshing"] .steward-avatar { animation: none; }
}
```

**验收**：
- 360 / 768 / 1440 三档下状态条不溢出，按钮可点（≥44px 仅在 <720px）。
- 深色系统偏好下不依赖硬编码深色底（沿用 token，页面本身是浅色主题，无需额外适配）。
- 无新字体、无外部资源（CSP 不变）。

**提交**：`feat(steward): style strip, confirm card, pipeline and automation cards`

---

### Phase C · 前端编排（8 个任务，按顺序做）

#### C1. 状态、偏好与 els 映射迁移

**文件**：`public/app.js`

**步骤 1**：`state` 增加管家子状态，删除 `actionLoading` / `showOrderConfirm` / `showSubForm` 的旧语义（改挂到 `state.steward`）：

```js
const STEWARD_KEY = "maimen-save-one-steward-v1";

// 在 state 里新增
steward: {
  view: null,
  failed: false,
  phase: "hidden",
  confirmOpen: false,
  busy: false,
  refreshLock: false,
  tickTimer: null,
  auto: { autoPrepare: true, autoClaim: true, autoRefresh: true, autoPoll: true, autoReconcile: true },
  lastRunAt: {},
  gateNote: {},
},
```

**步骤 2**：`els` 去掉 `actionModal/actionContent/remindersModal/remindersContent/stickyCopy`，改为：

```js
stewardModal: $("#stewardModal"),
stewardContent: $("#stewardContent"),
stewardBtn: $("#stewardBtn"),
stewardStrip: $("#stewardStrip"),
stewardStripTitle: $("#stewardStripTitle"),
stewardStripMeta: $("#stewardStripMeta"),
stewardPrimaryBtn: $("#stewardPrimaryBtn"),
stewardOpenBtn: $("#stewardOpenBtn"),
stewardConfirm: $("#stewardConfirm"),
stickyOrder: $("#stickyOrder"),
```

**步骤 3**：`modalByName` / `closeModal` / `closeAllModals` 里的 `action`、`reminders` 统一换成 `steward`；`closeModal('steward')` 关闭时清理 `state.steward.tickTimer` 与订单轮询（沿用原 `action` 分支逻辑）。

**步骤 4**：偏好读写（沿用 `PREF_KEY` 的 try/catch 风格）：

```js
function loadStewardPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(STEWARD_KEY) || "{}");
    Object.assign(state.steward.auto, raw.auto || {});
    state.steward.lastRunAt = raw.lastRunAt || {};
  } catch {
    // 忽略损坏的本地偏好
  }
}

function saveStewardPrefs() {
  try {
    localStorage.setItem(STEWARD_KEY, JSON.stringify({
      auto: state.steward.auto,
      lastRunAt: state.steward.lastRunAt,
    }));
  } catch {
    // 隐私模式写入失败时忽略
  }
}

function markAutomationRun(id) {
  state.steward.lastRunAt[id] = new Date().toISOString();
  saveStewardPrefs();
}
```

在 `init()` 里 `loadPrefs()` 之后调用 `loadStewardPrefs()`。

**验收**：页面加载无 `Cannot read properties of null`（旧 els 引用已清干净：`grep -n "actionModal\|remindersModal\|stickyCopy" public/app.js` 应为 0 命中）。

**提交**：`refactor(steward): centralize steward state and element map`

---

#### C2. 状态条渲染器

**文件**：`public/app.js`

```js
const STEWARD_COPY = {
  hidden: ["管家待命", "算一单，剩下的交给管家"],
  preparing: ["管家正在备单…", "锁定门店、餐品、券和金额"],
  ready: ["管家已接管 · 已自动备单", ""],
  refreshing: ["管家正在续期报价…", "价格不变时不用重新确认"],
  ordered: ["订单待支付 · 状态自动轮询中", ""],
  expired: ["报价已过期", "让管家重新备单"],
  error: ["备单失败，可手动重试", "不影响算价和手动下单"],
};

const STEWARD_ACTION = {
  ready: { label: "确认下单", action: "confirm", kind: "primary" },
  ordered: { label: "去支付", action: "pay", kind: "primary" },
  expired: { label: "重新备单", action: "prepare", kind: "primary" },
  error: { label: "重试备单", action: "prepare", kind: "primary" },
  preparing: { label: "备单中…", action: "", kind: "primary" },
  refreshing: { label: "续期中…", action: "", kind: "primary" },
};

function stewardMetaLine(phase) {
  const parts = [];
  if (phase === "ready" || phase === "refreshing" || phase === "expired") {
    const left = state.quote ? Date.parse(state.quote.expiresAt) - Date.now() : 0;
    parts.push(left > 0 ? `报价 ${countdownText(left)}` : "报价已过期");
    if (state.quote?.plan?.coupon) parts.push(state.quote.couponClaimed ? "券已领" : "券待领");
    else parts.push("无需领券");
  }
  if (phase === "ordered" && state.order) {
    parts.push(money(state.order.amountCents));
    parts.push(orderStatusLabel(state.order.status));
  }
  parts.push(state.dataMode === "live" ? "实时数据" : "演示数据");
  return parts.join(" · ");
}

function setPhase(phase) {
  state.steward.phase = phase;
  renderStewardStrip();
}

function renderStewardStrip() {
  if (!els.stewardStrip) return;
  const phase = state.steward.phase;
  if (state.steward.failed && !state.quote && !state.order) {
    els.stewardStrip.hidden = true;   // 降级：回退为顶栏 mode 徽标
    return;
  }
  els.stewardStrip.hidden = phase === "hidden";
  els.stewardStrip.dataset.phase = phase;
  const [title, fallbackMeta] = STEWARD_COPY[phase] || STEWARD_COPY.hidden;
  els.stewardStripTitle.textContent = title;
  els.stewardStripMeta.textContent = stewardMetaLine(phase) || fallbackMeta;
  const action = STEWARD_ACTION[phase];
  els.stewardPrimaryBtn.textContent = action ? action.label : "确认下单";
  els.stewardPrimaryBtn.disabled = !action || !action.action || state.steward.busy;
  els.stewardPrimaryBtn.dataset.stewardAction = action?.action || "";
  els.stewardConfirm.classList.toggle("hidden", !state.steward.confirmOpen);
  if (state.steward.confirmOpen) els.stewardConfirm.innerHTML = stewardConfirmHtml();
}
```

**验收**：手动把 `state.steward.phase` 依次改 7 个值，状态条文案/按钮/禁用态符合设计稿 3.2 表格；`hidden` 时整条不占位。

**提交**：`feat(steward): render steward status strip with phase machine`

---

#### C3. 自动备单 + 自动领券（编排入口）

**文件**：`public/app.js`

**步骤 1**：把 `openActionCenter()`（883 行）拆成两个函数，删除"打开模态才备单"的旧行为：

```js
async function prepareQuote({ force = false } = {}) {
  const plan = selectedPlan();
  if (!plan || !state.result) throw new Error("先算一单再备单");
  const fresh = state.quote && Date.parse(state.quote.expiresAt) - Date.now() > 30_000;
  if (!force && fresh) return state.quote;
  const data = await api("api/quote", {
    method: "POST",
    body: JSON.stringify({ input: buildInput(), planId: plan.id }),
  });
  state.quote = data.quote;
  state.quoteTokens = data.tokens;
  state.capabilities = data.capabilities || state.capabilities;
  state.quoteExpired = false;
  return state.quote;
}

async function autoClaimCoupon() {
  const quote = state.quote;
  const caps = state.capabilities || {};
  if (!quote?.plan?.coupon || quote.couponClaimed) return;
  if (!caps.couponClaim) {
    state.steward.gateNote.autoClaim = "待解锁";
    return;
  }
  try {
    const data = await api("api/coupons/claim", {
      method: "POST",
      body: JSON.stringify({ quoteId: quote.id, token: state.quoteTokens.claim }),
    });
    state.quote = data.quote;
    state.capabilities = data.capabilities || state.capabilities;
    markAutomationRun("autoClaim");
  } catch {
    // 失败保留手动领取入口，不阻塞下单
  }
}

async function enterStewardFlow() {
  if (!state.steward.auto.autoPrepare) {
    setPhase("hidden");
    return;
  }
  setPhase("preparing");
  try {
    await prepareQuote({ force: true });
    markAutomationRun("autoPrepare");
    setPhase("ready");
    if (state.steward.auto.autoClaim) await autoClaimCoupon();
    setPhase("ready");
    startStewardTimer();
  } catch {
    setPhase("error");
  }
}
```

**步骤 2**：`optimizeNow()` 成功后（`renderResult(data)` 之后）调用 `enterStewardFlow()`，`renderResult` 里清空 `state.quote/order` 的旧逻辑保留。

**步骤 3**：`api()` 抛错时 `error.code` 已透传，无需改。

**验收**（demo）：点「一键算最省」→ 状态条 `preparing`（<1.5s）→ `ready` 且第二行含"报价 4:xx · 券已领"；中途切到「更多选项」改预算再算，旧报价被新报价替换。

**提交**：`feat(steward): auto prepare quote and claim best coupon`

---

#### C4. 自动续期 + 计时器

**文件**：`public/app.js`

删除 `startQuoteTimer()`，新增：

```js
function startStewardTimer() {
  clearInterval(state.steward.tickTimer);
  state.steward.tickTimer = setInterval(() => {
    if (state.steward.phase === "ready") {
      const left = state.quote ? Date.parse(state.quote.expiresAt) - Date.now() : 0;
      els.stewardStripMeta.textContent = stewardMetaLine("ready");
      if (left <= 0) setPhase("expired");
      else if (left < 30_000 && state.steward.auto.autoRefresh) refreshQuote();
    }
    const modalCountdown = $("#quoteCountdown");
    if (modalCountdown && state.quote) {
      modalCountdown.textContent = countdownText(Date.parse(state.quote.expiresAt) - Date.now());
    }
  }, 1000);
}

async function refreshQuote() {
  if (state.steward.refreshLock) return;
  state.steward.refreshLock = true;
  setPhase("refreshing");
  try {
    await prepareQuote({ force: true });
    markAutomationRun("autoRefresh");
    if (state.steward.auto.autoClaim) await autoClaimCoupon();
    setPhase(state.order ? "ordered" : "ready");
  } catch {
    setPhase("expired");
  } finally {
    state.steward.refreshLock = false;
  }
}
```

**边界**：续期后金额若变化，不静默下单——`confirmOpen` 时重绘确认卡（`renderStewardStrip` 已含），用户必须再点一次「确认生成待支付订单」。

**验收**：把 `QUOTE_TTL_MS` 临时改 40s（或直接改系统时间无法做到时的等价手段：在 DevTools 里把 `state.quote.expiresAt` 改到 25s 后），观察自动进入 `refreshing` → `ready`，金额不变时无 toast 骚扰。

**提交**：`feat(steward): auto refresh quote before expiry`

---

#### C5. 两步确认下单（取消复选框）

**文件**：`public/app.js`

```js
function stewardConfirmHtml() {
  const quote = state.quote;
  if (!quote) return "";
  const plan = quote.plan;
  const coupon = plan.coupon;
  return `
    <b>确认这一单</b>
    <div class="steward-confirm-rows">
      <div><span>方案</span><b>${escapeHtml(plan.label)}</b></div>
      <div><span>门店</span><b>${escapeHtml(quote.store?.name || "")}</b></div>
      <div><span>取餐</span><b>${modeText(plan.mode)}</b></div>
      <div><span>优惠券</span><b>${coupon ? (quote.couponClaimed ? `已领 · ${escapeHtml(coupon.name)}` : `待领 · ${escapeHtml(coupon.name)}`) : "无"}</b></div>
      <div><span>实付</span><b>${money(plan.price.finalCents)}</b></div>
    </div>
    <button type="button" class="select-button" data-steward-action="confirm-create" ${state.steward.busy ? "disabled" : ""}>确认生成待支付订单</button>
    <button type="button" class="text-button" data-steward-action="confirm-cancel">再想想</button>`;
}

async function requestOrder() {
  if (state.steward.phase === "ordered") {
    openSteward();
    return;
  }
  if (!state.quote) {
    setPhase("preparing");
    try {
      await prepareQuote({ force: true });
      setPhase("ready");
    } catch {
      setPhase("error");
      return;
    }
  }
  state.steward.confirmOpen = true;
  renderStewardStrip();
  els.stewardConfirm.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function confirmOrderAction() {
  if (state.steward.busy) return;
  state.steward.busy = true;
  renderStewardStrip();
  try {
    if (!state.quote || !state.quoteTokens) {
      await prepareQuote({ force: true });
    }
    const data = await api("api/orders", {
      method: "POST",
      body: JSON.stringify({ quoteId: state.quote.id, token: state.quoteTokens.order }),
    });
    state.order = data.order;
    state.steward.confirmOpen = false;
    setPhase("ordered");
    startOrderPolling();
    if (state.steward.auto.autoReconcile) reconcileSilently();
    fetchSteward();
    loadReminders(true);
    showToast("订单已创建，请核对支付页");
  } catch (error) {
    if (error.code === "PRICE_CHANGED") {
      state.quote = null;
      state.quoteTokens = null;
      try {
        await prepareQuote({ force: true });
        state.steward.confirmOpen = true;
        setPhase("ready");
      } catch {
        setPhase("error");
      }
      showToast("价格已变化，请重新确认", true);
      return;
    }
    showToast(error.message, true);
  } finally {
    state.steward.busy = false;
    renderStewardStrip();
  }
}
```

**要点**：
- 原 `createOrderAction()` 与 `#orderConfirmCheck` 整体删除（`grep -n "orderConfirmCheck" public/app.js` 应为 0）。
- `PRICE_CHANGED` 分支必须"重新备单 + 重开确认卡"，绝不静默下单。

**验收**：demo 模式点「确认下单」→ 确认卡显示 5 行 → 点「确认生成待支付订单」→ 状态条变 `ordered`、按钮变「去支付」；把服务端 `QUOTE_TTL_MS` 调成 1s 制造过期后下单，报 `PRICE_CHANGED` 并回到确认卡。

**提交**：`feat(steward): two-step order confirmation without checkbox`

---

#### C6. 订单轮询 + 自动对账

**文件**：`public/app.js`

**步骤 1**：`startOrderPolling()` 窗口从 2 分钟延长到 5 分钟（设计 5.2），并把渲染目标从 `actionModal` 改为 `stewardModal`：

```js
if (Date.now() - state.orderPollStarted > 5 * 60_000) { stopOrderPolling(); return; }
...
if (!els.stewardModal.classList.contains("hidden")) renderSteward();
```

**步骤 2**：新增静默对账（不抢 toast）：

```js
async function reconcileSilently() {
  try {
    const data = await api("api/orders/reconcile", { method: "POST", body: "{}" });
    if (data.cancelled > 0) {
      markAutomationRun("autoReconcile");
      showToast(`已自动取消 ${data.cancelled} 个重复未支付订单`);
      loadReminders(true);
    }
  } catch {
    // 对账失败静默，管家中心仍可手动触发
  }
}
```

**步骤 3**：`openSteward()` 打开时也触发一次 `reconcileSilently()`（设计 5.#5 触发条件之二），但加 30s 节流，避免频繁开会话刷接口。

**验收**：创建订单后 5 秒内状态条/订单卡状态被刷新；连续创建两单（demo 下先不取消前一单）→ 打开管家中心触发对账，显示"已自动取消 N 个"。

**提交**：`feat(steward): poll order status and auto reconcile duplicates`

---

#### C7. 管家中心五区块

**文件**：`public/app.js`

**步骤 1**：`openSteward()`：

```js
async function openSteward() {
  openModal("steward");
  els.stewardContent.innerHTML = `
    <div class="empty-state">
      <p class="card-kicker">省单管家</p>
      <h2 id="stewardTitle">正在汇总这一单</h2>
      <p>报价、待办、自动化与 MCP 管道会在这里汇总。</p>
      <div class="loading-dots" aria-hidden="true"><span></span><span></span><span></span></div>
    </div>`;
  await Promise.allSettled([fetchSteward(), loadReminders(false), loadAccount(), loadSubscriptions(), loadCapabilities()]);
  renderSteward();
  if (state.steward.auto.autoReconcile) reconcileSilently();
}
```

**步骤 2**：`fetchSteward()`：

```js
async function fetchSteward() {
  try {
    const data = await api("api/steward");
    state.steward.view = data;
    state.steward.failed = false;
    return data;
  } catch {
    state.steward.failed = true;
    return null;
  }
}
```

**步骤 3**：`renderSteward()` 组装 5 个 `detail-section`：这一单 / 待办 / 自动化 / MCP 管道 / 权益与固定套餐。**复用** `renderAccountSection()`、`renderSubscriptionCards()`、`execution-step`、`reminder-item` 原样类名，不新造视觉语言。

这一单区块的四种形态：

| 本地状态 | 展示 |
|---|---|
| `state.order` 存在 | 订单卡（沿用原 `order-card` 结构 + `data-steward-action="pay/mock-pay/cancel-order/refresh-order"`）+ 解锁框 |
| `state.quote` 存在 | 方案名/金额/门店/取餐/倒计时 + 4 步 `execution-step`（第 1 步标注"管家自动完成"、第 2 步自动领券结果、第 3 步确认下单、第 4 步支付）+ 动作行（重新生成报价 / 复制清单 / 存为固定套餐） |
| 仅 `view.lastQuote` | 灰态"上次报价 · 已过期/待续"卡片 + 「重新备单」按钮；**不下单**（本地无 token） |
| 都没有 | `empty-state`：先算一单 |

**步骤 4**：自动化区块：

```js
function automationCardHtml(item) {
  const scopeTag = item.scope === "client" ? "端上" : "服务端";
  const on = state.steward.auto[item.id] !== undefined ? state.steward.auto[item.id] : item.defaultOn;
  const lastRun = state.steward.lastRunAt[item.id] || item.lastRunAt;
  const control = item.scope !== "client"
    ? `<span class="automation-scope">服务端常开</span>`
    : item.gated
      ? `<span class="automation-gate">${escapeHtml(item.gateReason)}</span>`
      : `<label class="switch-row switch-row-compact">
           <input type="checkbox" data-steward-action="toggle-auto" data-auto-id="${escapeAttr(item.id)}" ${on ? "checked" : ""}>
           <span class="switch" aria-hidden="true"></span>
         </label>`;
  return `
    <div class="automation-card" data-gated="${item.gated}">
      <div class="automation-head"><b>${escapeHtml(item.label)}</b><span class="automation-scope">${scopeTag}</span></div>
      <p class="automation-trigger">${escapeHtml(item.trigger)}</p>
      <div class="automation-foot">
        <small>${lastRun ? `最近运行 ${formatDateTime(lastRun)}` : "尚未运行"}</small>
        ${control}
      </div>
    </div>`;
}
```

**步骤 5**：管道区块按 `view.pipeline` 渲染，`state` 文案映射 `done=已完成 / demo=演示 / pending=等待 / failed=失败`，副行显示 `tool · ${lastMs}ms · ${formatDateTime(lastAt)}`；`view.mode === "demo"` 时区块顶部加 `.action-note`："演示模式无真实 MCP 轨迹，管道仅示意"。

**步骤 6**：顶部导航（可选但推荐，纯锚点不换页）：

```html
<div class="steward-nav">
  <button type="button" data-steward-action="scroll" data-target="steward-sec-order" class="is-active">这一单</button>
  <button type="button" data-steward-action="scroll" data-target="steward-sec-todo">待办</button>
  <button type="button" data-steward-action="scroll" data-target="steward-sec-auto">自动化</button>
  <button type="button" data-steward-action="scroll" data-target="steward-sec-pipe">MCP 管道</button>
  <button type="button" data-steward-action="scroll" data-target="steward-sec-benefit">权益</button>
</div>
```

**验收**：
- 模态高度受 `max-height: min(86dvh,820px)` 约束内部滚动，5 区块均可到达。
- `Escape` 关闭、焦点还原到触发按钮。
- 无报价时"这一单"显示 `empty-state`，不报错。
- 刷新页面后打开管家中心，能从 `view.lastQuote` 看到"上次报价"，明确标注不可直接下单。

**提交**：`feat(steward): build five-section steward center`

---

#### C8. 待办动作映射 + 移动端主操作

**文件**：`public/app.js`

**步骤 1**：待办渲染替换 `renderReminders()`：

```js
const TODO_ACTION = {
  payment_due: { label: "去支付", action: "todo-pay" },
  quote_expiry: { label: "续报价", action: "todo-refresh" },
  duplicate_orders: { label: "查看对账", action: "todo-reconcile" },
  subscription_limit: { label: "管理套餐", action: "todo-subs" },
  coupon_expiry: { label: "去下单", action: "todo-order" },
  coupon_claimed: null,
};
```

`todo-pay` → 有 `state.order` 且有 `payUrl` 则 `window.open`，否则打开管家中心并滚动到订单卡；`todo-refresh` → `refreshQuote()`；`todo-order` → `requestOrder()`；`todo-subs` → 滚动到权益区块。

**步骤 2**：`#stickyOrder` 点击 → `requestOrder()`；`#stewardBtn`、`#stewardOpenBtn`、`#remindersBtn` → `openSteward()`。

**步骤 3**：`bindEvents()` 里把 `els.actionContent` / `els.remindersContent` 两段委托合并为 `els.stewardContent` 一段，统一 `data-steward-action`：

```js
if (els.stewardContent) {
  els.stewardContent.addEventListener("click", (event) => {
    const target = event.target.closest("[data-steward-action]");
    if (!target) return;
    const name = target.dataset.stewardAction;
    if (name === "claim-coupon") autoClaimCoupon().then(() => { renderSteward(); renderStewardStrip(); });
    if (name === "prepare") refreshQuote();
    if (name === "confirm") requestOrder();
    if (name === "confirm-create") confirmOrderAction();
    if (name === "confirm-cancel") { state.steward.confirmOpen = false; renderStewardStrip(); }
    if (name === "pay") openSteward();
    if (name === "refresh-order") refreshOrderAction();
    if (name === "cancel-order") cancelOrderAction();
    if (name === "mock-pay") mockPayAction();
    if (name === "copy-quote") copyQuoteAction();
    if (name === "reconcile") { reconcileAction(); renderSteward(); }
    if (name === "toggle-sub") toggleSubscriptionAction(target.dataset.subId, target.dataset.enabled === "true");
    if (name === "run-sub") runSubscriptionAction(target.dataset.subId);
    if (name === "delete-sub") deleteSubscriptionAction(target.dataset.subId);
    if (name === "mark-reminder") markReminderAction(target.dataset.reminderId);
    if (name === "mark-all-read") markAllRemindersRead();
    if (name === "scroll") $(`#${target.dataset.target}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  els.stewardContent.addEventListener("change", (event) => {
    const input = event.target.closest("[data-steward-action='toggle-auto']");
    if (!input) return;
    state.steward.auto[input.dataset.autoId] = input.checked;
    saveStewardPrefs();
  });
}
```

**步骤 4**：所有渲染函数里 `renderReminders()` / `renderActionCenter()` 的调用点替换为 `renderSteward()` + `renderStewardStrip()`（涉及 `loadReminders`、`loadAccount`、`loadSubscriptions`、`markReminderAction`、`runSubscriptionAction`、`reconcileAction` 等约 12 处）。

**验收**：
- 360px 视口：底部条只显示「看明细 / 确认下单」，确认下单可走完整流程。
- Tab 顺序：状态条按钮 → 方案卡 → sticky 主按钮；开关可空格切换并持久化（刷新后保持）。
- 待办 6 类型逐一构造（可用 `/api/reminders` 已有数据），动作按钮命中正确分支。

**提交**：`feat(steward): wire todo actions and mobile primary CTA`

---

### Phase D · 验证与文档（2 个任务）

#### D1. 自动化回归 + 手工验证矩阵

**测试**：`npm test`（23 用例全绿），并新增一条端到端冒烟脚本（可选，手工执行即可）：

```bash
node server.js &
B=http://127.0.0.1:8899
curl -s -X POST $B/api/optimize -H 'content-type: application/json' -d '{"budgetCents":3000,"goal":"save","people":1,"mode":"pickup","storeId":"p2","city":"上海","keyword":"人民广场"}' > /tmp/opt.json
curl -s -X POST $B/api/quote -H 'content-type: application/json' -d "{\"input\":$(jq -c .query /tmp/opt.json),\"planId\":\"$(jq -r .recommendedId /tmp/opt.json)\"}" > /tmp/quote.json
curl -s $B/api/steward | jq '{mode, lastQuote}'
```

手工矩阵（必须在 360 / 768 / 1440 三档各过一遍）：

| # | 场景 | 期望 |
|---|---|---|
| 1 | demo：算 → 等 1.5s | 状态条 `ready`，第二行含倒计时与"券已领" |
| 2 | 点确认下单 | 确认卡 5 行，金额与方案卡一致 |
| 3 | 确认生成订单 | 状态条 `ordered`，订单卡 `待支付`，5s 内轮询 |
| 4 | 模拟支付 | 订单 `已支付`，支付提醒待办消失 |
| 5 | 报价剩 25s | 自动 `refreshing` → `ready`，无金额变化 |
| 6 | 关掉自动续期开关 | 报价到时进入 `expired`，按钮"重新备单" |
| 7 | 断网/停服务端后刷新 | 状态条隐藏，顶栏徽标仍显示模式；「算」报错 toast，不白屏 |
| 8 | 关掉自动备单后算 | 状态条 `hidden`，「查看管家」仍可手动备单 |
| 9 | 键盘 | Tab 可达全部按钮，Escape 关闭模态，焦点回原按钮 |
| 10 | 减少动效 | 系统开启 reduced-motion 后无脉冲动画 |

#### D2. 文档与版本

**文件**：`MCP_INTEGRATION.md`、`README.md`、`public/sw.js`、`package.json`、`server.js`

1. `MCP_INTEGRATION.md` 新增两节：
   - 「模块定位与 MCP 接入方式」：管家是执行层，浏览器只读 `/api/steward`，Token 不下发；管道 5 步对应的 tool 名。
   - 「自动化覆盖范围与触发条件」：8 项表格（id / 触发类型 / 动作 / 门控 / 失败边界），直接复用设计稿第 5 节。
   - 调用流程图更新为：`optimize → /api/quote → /api/coupons/claim → /api/orders → 轮询`。
2. `README.md`：路径 7 重写为管家自动衔接；界面交互原则补状态条与管家中心；API 表加 `GET /api/steward`；目录结构加 `lib/steward.js`；功能列表加"8 项自动化"。
3. `public/sw.js`：`CACHE_NAME = "maimen-save-one-v2"`。
4. 版本：`APP_VERSION = "1.2.0"`、`package.json` version 同步、`index.html` 资源查询串同步。
5. `docs/superpowers/specs/...-design.md` 状态行改为「已实施」，并链接本计划。

**提交**：`docs(steward): document module positioning, automations and new endpoint`

---

## 3. 执行顺序与依赖

```
A1 ──┐
A2 ──┼── A4 ──┐
A3 ──┘        │
B1 ── B2 ─────┼── C1 ── C2 ── C3 ── C4 ── C5 ── C6 ── C7 ── C8 ── D1 ── D2
```

- A 与 B 可并行（B 只动结构与样式，不依赖接口）。
- C1 必须先于 C2-C8（状态与 els 迁移是地基）。
- C3 之后即可在 demo 下跑通主路径；C5 是主路径闭环点。
- 每个 C 任务结束都应能回到 `npm test` 全绿。

**建议提交序列（7 次）**：

1. `feat(steward): record MCP tool trace ring buffer`
2. `feat(steward): add buildStewardView pure module and endpoint`
3. `feat(steward): add strip, confirm slot and steward modal shell`
4. `refactor(steward): centralize steward state and element map`
5. `feat(steward): auto prepare, claim and refresh quote`
6. `feat(steward): two-step order confirmation, polling and reconcile`
7. `feat(steward): steward center, todo actions and mobile CTA`
8. `docs(steward): update MCP integration, README and cache version`

## 4. 风险与对策（实施期专属）

| 风险 | 触发点 | 对策 |
|---|---|---|
| `app.js` 改到一半新旧引用混用 | C1 迁移不彻底 | 先 `grep` 清零 `actionModal/remindersModal/stickyCopy/orderConfirmCheck`，再写新逻辑 |
| 自动备单放大 `runtime.json` | 每次算都新增报价 | `createQuote` 前把同 `planId+input` 的旧 quote 标 `superseded`；`quotes` 只保留最近 20 条（在 `latestQuoteAndOrder` 之外单独加清理函数，`mutate` 内执行） |
| 计时器泄漏 | 反复算/开关模态 | 只保留一个 `state.steward.tickTimer`，`startStewardTimer` 首行 `clearInterval`；`closeModal('steward')` 不清（状态条仍需跑），页面 `visibilitychange` 隐藏时跳过 tick |
| 模态内确认卡与状态条确认卡双份状态 | 两处都能下单 | 二者共用 `state.steward.confirmOpen` 与 `confirmOrderAction()`，不复制逻辑 |
| 静默对账打断用户操作 | 每次开管家都调 | 30s 节流 + 仅在 `cancelled > 0` 时 toast |
| 老用户看到旧 UI | SW / HTTP 缓存 | `CACHE_NAME` v2 + 资源 `?v=1.2.0`（D2 与 B1 同步落地） |

## 5. 设计稿 → 任务映射（自检用）

| 设计稿 | 落地任务 |
|---|---|
| 3.1 顶栏入口 | B1 改动 1、C8 步骤 2 |
| 3.2 状态条 + 状态机 | B1 改动 2、B2、C2 |
| 3.3 管家中心 5 区块 | B1 改动 4、C7 |
| 3.4 执行中心退役 | B1 改动 3/4、C1、C7 |
| 3.5 主操作按钮 / 两步确认 | B1 改动 5、C5、C8 |
| 4.2 `GET /api/steward` | A2、A3、A4 |
| 4.3 MCP 轨迹 | A1 |
| 4.4 服务端聚合 | A2、A3、A4 |
| 5 自动化目录 8 项 | A2（目录）、C3/C4/C6（端上 5 项）、C7（展示） |
| 5.1 待办动作映射 | C8 |
| 6 主路径 3 步 | C3 → C5 → 去支付 |
| 7 双端适配 | B2、C8 |
| 8 测试与验证 | A2 单测、D1 矩阵 |
| 9 文档更新 | D2 |
| 10 明确不做 | 全局不变量 0.2 |
