// 省单管家的服务端视图：纯函数，不读文件、不碰网络，便于单测。
// 只输出展示所需字段，报价明细、门店 id、Token 一律不下发。

const PIPELINE = [
  { id: "stores", label: "定位门店", tool: "query-nearby-stores" },
  { id: "menu", label: "读取菜单", tool: "query-meals" },
  { id: "coupons", label: "合并券包", tool: "query-store-coupons" },
  { id: "nutrition", label: "匹配营养", tool: "list-nutrition-foods" },
  { id: "price", label: "官方核价", tool: "calculate-price" },
];

// scope=client 的项有端上开关；server 项由服务端定时器/写操作触发，只展示门控说明。
const AUTOMATIONS = [
  {
    id: "autoPrepare",
    label: "自动备单",
    scope: "client",
    trigger: "算完自动生成报价快照",
    defaultOn: true,
    gate: null,
    gateReason: "",
  },
  {
    id: "autoClaim",
    label: "自动领券",
    scope: "client",
    trigger: "报价含最优券时自动领取单张",
    defaultOn: true,
    gate: "couponClaim",
    gateReason: "实时模式需开启领券并解锁私有模式",
  },
  {
    id: "autoRefresh",
    label: "自动续期",
    scope: "client",
    trigger: "报价剩余不足 30 秒",
    defaultOn: true,
    gate: null,
    gateReason: "",
  },
  {
    id: "autoPoll",
    label: "自动轮询",
    scope: "client",
    trigger: "订单创建后每 5 秒，最长 5 分钟",
    defaultOn: true,
    gate: null,
    gateReason: "",
  },
  {
    id: "autoReconcile",
    label: "自动对账",
    scope: "client",
    trigger: "订单创建后 / 打开管家中心",
    defaultOn: true,
    gate: "autoCancelUnpaid",
    gateReason: "实时模式需开启自动取消未支付单",
  },
  {
    id: "paymentDue",
    label: "支付提醒",
    scope: "server",
    trigger: "订单创建 5 分钟未支付",
    defaultOn: true,
    gate: null,
    gateReason: "",
  },
  {
    id: "autoRepurchase",
    label: "自动复购",
    scope: "server",
    trigger: "固定套餐到点（服务端 60 秒轮询）",
    defaultOn: false,
    gate: "autoRepurchase",
    gateReason: "实时模式需开启自动复购并解锁私有模式",
  },
  {
    id: "couponExpiry",
    label: "券到期盯防",
    scope: "server",
    trigger: "券距到期不足 24 小时",
    defaultOn: true,
    gate: null,
    gateReason: "",
  },
];

function lastCall(trace, tool) {
  const list = Array.isArray(trace) ? trace : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const entry = list[index];
    if (entry && entry.tool === tool) return entry;
  }
  return null;
}

export function derivePipelineState(trace, tool, mode) {
  const hit = lastCall(trace, tool);
  if (hit) {
    return {
      state: hit.ok ? "done" : "failed",
      lastAt: hit.at || null,
      lastMs: Number(hit.ms) || 0,
    };
  }
  return { state: mode === "demo" ? "demo" : "pending", lastAt: null, lastMs: 0 };
}

export function summarizeQuote(quote, now = Date.now()) {
  if (!quote) return null;
  const expiresAt = quote.expiresAt || null;
  const expired = expiresAt ? Date.parse(expiresAt) <= now : false;
  // superseded：同输入已有更新的报价，接口仍可用，但不再是对外展示的"这一单"。
  const status =
    quote.status === "ordered"
      ? "ordered"
      : expired || quote.status === "superseded"
        ? "expired"
        : "quoted";
  return {
    id: quote.id,
    planId: quote.planId || "",
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
        lastRunAt: item.id === "autoRepurchase" ? subscriptionRunAt || null : null,
      };
    }),
    lastQuote: summarizeQuote(lastQuote, now),
    lastOrder: summarizeOrder(lastOrder),
  };
}
