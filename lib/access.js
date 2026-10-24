import { ActionError } from "./action-service.js";

/**
 * 写操作门控的唯一判定点。
 * 规则：
 *  - host（未绑定本人 Token）：一律拒绝，提示绑定；绝不借用共享账号。
 *  - none（无任何 MCP）：允许演示写（不触及真实账户），可用 DEMO_WRITE 关闭。
 *  - own（已绑定 + 已授权）：按功能开关放行，连接只能用该用户自己的。
 */
export function writeDecision(ctx, feature, flags = {}) {
  const {
    demoWrite = true,
    enableWrite = false,
    enableCouponClaim = false,
    enableOrderCreate = false,
    enableAutoRepurchase = false,
  } = flags;
  const mode = ctx?.mode || "none";

  if (mode === "host") {
    throw new ActionError(
      "OWN_TOKEN_REQUIRED",
      "这是共享的体验模式，不能下单。请先绑定你自己的麦当劳 MCP Token，系统才会用你的账号提交订单。",
      403,
    );
  }

  if (mode === "none") {
    if (!demoWrite) {
      throw new ActionError("WRITE_DISABLED", "演示执行已关闭，请绑定你自己的 MCP Token", 403);
    }
    return { mode: "demo", live: false, client: null, owner: ctx.uid };
  }

  if (!enableWrite) {
    throw new ActionError("WRITE_DISABLED", "服务端未开启写操作（ENABLE_WRITE）", 403);
  }
  if (!ctx?.binding?.consent?.granted) {
    throw new ActionError("CONSENT_REQUIRED", "需要先在页面确认授权，才可以用你的账号下单", 403);
  }
  if (!ctx?.client) {
    throw new ActionError("OWN_TOKEN_REQUIRED", "你的账号连接已失效，请重新绑定 Token", 403);
  }
  if (feature === "coupon" && !enableCouponClaim) {
    throw new ActionError("FEATURE_DISABLED", "自动领券未开启", 403);
  }
  if ((feature === "order" || feature === "auto") && !enableOrderCreate) {
    throw new ActionError("FEATURE_DISABLED", "创建订单未开启", 403);
  }
  if (feature === "auto" && !enableAutoRepurchase) {
    throw new ActionError("FEATURE_DISABLED", "自动复购未开启", 403);
  }
  return { mode: "own", live: true, client: ctx.client, owner: ctx.uid };
}

export function buildCapabilities(ctx, flags = {}) {
  const {
    demoWrite = true,
    enableWrite = false,
    enableCouponClaim = false,
    enableOrderCreate = false,
    enableAutoRepurchase = false,
    enableAutoCancelUnpaid = false,
    singleUser = false,
    maxOrderCents = 5000,
    maxDailyOrders = 5,
  } = flags;
  const own = ctx?.mode === "own";
  const host = ctx?.mode === "host";
  const demo = !own && !host;
  const liveReady = own && enableWrite;
  const writeMode = own ? "private" : demo && demoWrite ? "demo" : "disabled";
  return {
    mode: own || host ? "live" : "demo",
    access: ctx?.mode || "none",
    live: own || host,
    hostOnly: host,
    bound: own,
    identity: ctx?.identity || null,
    writeMode,
    demoWrite: demo && demoWrite,
    liveWrite: liveReady,
    unlocked: own,
    singleUser,
    couponClaim: (demo && demoWrite) || (liveReady && enableCouponClaim),
    orderCreate: (demo && demoWrite) || (liveReady && enableOrderCreate),
    autoRepurchase: (demo && demoWrite) || (liveReady && enableAutoRepurchase),
    order: (demo && demoWrite) || (liveReady && enableOrderCreate),
    autoCancelUnpaid: own ? enableAutoCancelUnpaid : demo && demoWrite,
    maxOrderCents,
    maxDailyOrders,
    writePasscodeRequired: false,
    needsOwnToken: host,
    nutrition: true,
  };
}
