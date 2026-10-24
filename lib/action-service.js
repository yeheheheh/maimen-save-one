import crypto from "node:crypto";
import { getState, mutate, newId, appendAudit } from "./runtime-store.js";
import { DEMO_ACCOUNT } from "./demo-data.js";

const QUOTE_TTL_MS = 5 * 60_000;
const PAYMENT_REMINDER_MS = 3 * 60_000;
const MAX_QUOTES = 20;

export class ActionError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ActionError";
    this.code = code;
    this.status = status;
  }
}

const clone = (value) => JSON.parse(JSON.stringify(value));

// 所有租户数据都必须带 owner；未带 owner 的历史数据统一视为 legacy，对任何用户都不可见。
export const LEGACY_OWNER = "__legacy__";

export function ownedBy(record, owner) {
  if (!record) return false;
  return record.owner === owner;
}

function assertOwned(record, owner, code = "NOT_FOUND", message = "记录不存在", status = 404) {
  if (!record) throw new ActionError(code, message, status);
  // 内部/测试调用未传 owner 时只能访问 legacy 数据。
  if (!owner) {
    if (record.owner === LEGACY_OWNER) return record;
    throw new ActionError(code, message, status);
  }
  // 历史数据对任何真实用户都当作不存在，避免泄露「有别人的旧记录」。
  if (record.owner === LEGACY_OWNER) throw new ActionError(code, message, status);
  if (record.owner !== owner) {
    throw new ActionError(
      "OWNER_MISMATCH",
      "这笔记录属于另一个浏览器身份（可能是 Cookie 被清除或被拦截）。请重新算一单。",
      403,
    );
  }
  return record;
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function signToken(state, payload) {
  const body = b64url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", state.secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

async function verifyToken(token, action, quoteId) {
  if (typeof token !== "string" || !token.includes(".")) {
    throw new ActionError("INVALID_CONFIRMATION", "确认令牌无效，请重新生成报价");
  }
  const [body, signature] = token.split(".");
  const state = await getState();
  const expected = crypto.createHmac("sha256", state.secret).update(body).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new ActionError("INVALID_CONFIRMATION", "确认令牌校验失败，请重新生成报价");
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new ActionError("INVALID_CONFIRMATION", "确认令牌内容无效");
  }
  if (payload.action !== action || payload.quoteId !== quoteId) {
    throw new ActionError("INVALID_CONFIRMATION", "确认令牌与当前操作不匹配");
  }
  if (!payload.exp || payload.exp < Date.now()) {
    throw new ActionError("CONFIRMATION_EXPIRED", "确认已过期，请重新生成报价");
  }
  return payload;
}

function isExpired(quote) {
  return Date.parse(quote.expiresAt) <= Date.now();
}

function quoteSignature(planId, query) {
  return crypto
    .createHash("sha1")
    .update(JSON.stringify({ planId, query: query || {} }))
    .digest("hex")
    .slice(0, 12);
}

// 同一输入重复备单会让 runtime.json 里堆满报价；标记 superseded 并只留最近 MAX_QUOTES 条。
function rotateQuotes(state, signature, quoteId) {
  for (const existing of Object.values(state.quotes)) {
    if (existing.id === quoteId) continue;
    if (existing.signature === signature && existing.status !== "ordered") {
      existing.status = "superseded";
      existing.updatedAt = new Date().toISOString();
    }
  }
  const quotes = Object.values(state.quotes);
  if (quotes.length <= MAX_QUOTES) return;
  const keep = new Set(
    quotes
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, MAX_QUOTES)
      .map((quote) => quote.id),
  );
  for (const order of Object.values(state.orders)) {
    if (order.quoteId) keep.add(order.quoteId);
  }
  for (const id of Object.keys(state.quotes)) {
    if (!keep.has(id)) {
      delete state.quotes[id];
      delete state.reminders[`quote_expiry_${id}`];
    }
  }
}

function todayStart() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

// 每日限额必须按用户统计，否则 A 的下单会占用 B 的额度。
function countOrdersToday(state, owner = null) {
  return Object.values(state.orders).filter(
    (order) =>
      Date.parse(order.createdAt) >= todayStart() &&
      order.status !== "cancelled" &&
      (owner === null || order.owner === owner),
  ).length;
}

function addReminder(state, { id, type, title, body, dueAt, relatedId, owner, meta = {} }) {
  if (!state.reminders[id]) {
    state.reminders[id] = {
      id,
      owner: owner || LEGACY_OWNER,
      type,
      title,
      body,
      dueAt,
      relatedId,
      meta,
      read: false,
      createdAt: new Date().toISOString(),
    };
  }
}

function markRelatedRemindersRead(state, relatedId, types = null) {
  for (const reminder of Object.values(state.reminders)) {
    if (reminder.relatedId !== relatedId) continue;
    if (types && !types.includes(reminder.type)) continue;
    reminder.read = true;
  }
}

function quoteTokens(state, quote) {
  const exp = Date.parse(quote.expiresAt);
  return {
    claim: signToken(state, {
      action: "claim_coupon",
      quoteId: quote.id,
      amountCents: quote.plan.price.finalCents,
      exp,
    }),
    order: signToken(state, {
      action: "create_order",
      quoteId: quote.id,
      amountCents: quote.plan.price.finalCents,
      exp,
    }),
  };
}

export async function createQuote({ result, planId, source = "demo", owner }) {
  const plan = result.plans.find((item) => item.id === planId) || result.plans[0];
  if (!plan) throw new ActionError("NO_PLAN", "没有可执行的方案");
  const state = await getState();
  const now = Date.now();
  const signature = quoteSignature(plan.id, result.query);
  const quote = {
    id: newId("q"),
    owner: owner || LEGACY_OWNER,
    planId: plan.id,
    plan: clone(plan),
    input: clone(result.query),
    store: clone(result.store),
    source,
    signature,
    status: "quoted",
    couponClaimed: false,
    claimedCouponId: null,
    orderId: null,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + QUOTE_TTL_MS).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
  const tokens = quoteTokens(state, quote);
  await mutate((current) => {
    current.quotes[quote.id] = quote;
    rotateQuotes(current, signature, quote.id);
    addReminder(current, {
      id: `quote_expiry_${quote.id}`,
      type: "quote_expiry",
      title: "报价快照即将过期",
      body: `「${quote.plan.label}」的报价将在 5 分钟后过期，过期后需要重新核价。`,
      dueAt: quote.expiresAt,
      relatedId: quote.id,
      owner: quote.owner,
      meta: { amountCents: quote.plan.price.finalCents },
    });
    appendAudit(current, "quote.create", {
      quoteId: quote.id,
      amountCents: quote.plan.price.finalCents,
      mode: source,
    });
  });
  return { quote: clone(quote), tokens };
}

export async function getQuote(quoteId, owner = null) {
  const state = await getState();
  const quote = state.quotes[quoteId];
  if (!quote) throw new ActionError("QUOTE_NOT_FOUND", "报价不存在或已过期", 404);
  if (owner !== null) assertOwned(quote, owner, "QUOTE_NOT_FOUND", "报价不存在或已过期");
  if (isExpired(quote) && quote.status !== "ordered") {
    await mutate((current) => {
      const target = current.quotes[quoteId];
      if (target) target.status = "expired";
    });
    throw new ActionError("QUOTE_EXPIRED", "报价已过期，请重新生成", 410);
  }
  return clone(quote);
}

export async function claimCoupon({ quoteId, token, live = false, mcp = null, owner }) {
  const state = await getState();
  const quote = state.quotes[quoteId];
  assertOwned(quote, owner, "QUOTE_NOT_FOUND", "报价不存在");
  if (isExpired(quote)) throw new ActionError("QUOTE_EXPIRED", "报价已过期，请重新生成", 410);
  if (!quote.plan.coupon) throw new ActionError("NO_COUPON", "当前方案没有可领取的优惠券");
  await verifyToken(token, "claim_coupon", quoteId);
  if (quote.couponClaimed) return { quote: clone(quote), idempotent: true };

  if (live && mcp) {
    await mcp.claimCoupon(quote);
  }

  return mutate((current) => {
    const target = current.quotes[quoteId];
    if (!target) throw new ActionError("QUOTE_NOT_FOUND", "报价不存在", 404);
    target.couponClaimed = true;
    target.claimedCouponId = target.plan.coupon?.id || null;
    target.status = "coupon_claimed";
    target.updatedAt = new Date().toISOString();
    const coupon = target.plan.coupon;
    if (coupon) {
      const wallet = accountFor(current, owner);
      if (!wallet.claimedCouponIds.includes(coupon.id)) {
        wallet.claimedCouponIds.push(coupon.id);
        wallet.claimedCoupons.push({
          ...coupon,
          quoteId,
          claimedAt: new Date().toISOString(),
        });
      }
      addReminder(current, {
        id: `coupon_claim_${quoteId}`,
        type: "coupon_claimed",
        title: "优惠券已领取",
        body: `「${coupon.name}」已领取，下单时记得使用。`,
        dueAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
        relatedId: quoteId,
        owner: target.owner,
      });
    }
    appendAudit(current, "coupon.claim", {
      quoteId,
      couponId: target.claimedCouponId,
      mode: live ? "live" : "demo",
    });
    return { quote: clone(target) };
  });
}

function orderCaps(caps = {}) {
  return {
    maxAmountCents: Number(caps.maxAmountCents) || 5000,
    maxDailyOrders: Number(caps.maxDailyOrders) || 5,
  };
}

export async function createOrder({
  quoteId,
  token,
  live = false,
  mcp = null,
  caps = {},
  system = false,
  subscriptionId = null,
  owner,
}) {
  const state = await getState();
  const quote = state.quotes[quoteId];
  assertOwned(quote, owner, "QUOTE_NOT_FOUND", "报价不存在");
  if (quote.orderId) {
    const existing = state.orders[quote.orderId];
    if (existing) return { order: clone(existing), idempotent: true };
  }
  if (isExpired(quote)) throw new ActionError("QUOTE_EXPIRED", "报价已过期，请重新生成", 410);
  if (!system) await verifyToken(token, "create_order", quoteId);

  const normalizedCaps = orderCaps(caps);
  const amountCents = quote.plan.price.finalCents;
  if (amountCents > normalizedCaps.maxAmountCents) {
    throw new ActionError(
      "AMOUNT_LIMIT",
      `订单金额 ${(amountCents / 100).toFixed(2)} 元超过上限 ${(normalizedCaps.maxAmountCents / 100).toFixed(2)} 元`,
      403,
    );
  }
  if (countOrdersToday(state, owner === undefined ? null : owner) >= normalizedCaps.maxDailyOrders) {
    throw new ActionError("DAILY_LIMIT", `今日订单数已达到上限 ${normalizedCaps.maxDailyOrders} 单`, 429);
  }

  let created;
  if (live && mcp) {
    const verified = await mcp.priceQuote(quote);
    if (verified.totalCents !== undefined && verified.totalCents !== amountCents) {
      throw new ActionError(
        "PRICE_CHANGED",
        `官方核价已变化：${(amountCents / 100).toFixed(2)} → ${(verified.totalCents / 100).toFixed(2)} 元，请重新确认`,
        409,
      );
    }
    created = await mcp.createOrder(quote);
    if (!created.orderId) {
      throw new ActionError("ORDER_CREATE_FAILED", "官方未返回订单号，未创建订单", 502);
    }
  } else {
    created = {
      orderId: newId("o"),
      payUrl: null,
      status: "pending_payment",
    };
  }

  return mutate((current) => {
    const target = current.quotes[quoteId];
    if (!target) throw new ActionError("QUOTE_NOT_FOUND", "报价不存在", 404);
    if (target.orderId) {
      const existing = current.orders[target.orderId];
      if (existing) return { order: clone(existing), idempotent: true };
    }
    const now = new Date();
    const order = {
      id: created.orderId,
      owner: target.owner,
      quoteId,
      subscriptionId: subscriptionId || null,
      plan: target.plan,
      store: target.store,
      amountCents,
      status: created.status || "pending_payment",
      payUrl: created.payUrl || null,
      source: live ? "live" : "demo",
      demo: !live,
      duplicateOf: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      paidAt: null,
      cancelledAt: null,
    };
    current.orders[order.id] = order;
    target.orderId = order.id;
    target.status = "ordered";
    target.updatedAt = now.toISOString();
    addReminder(current, {
      id: `payment_due_${order.id}`,
      type: "payment_due",
      title: "订单待支付",
      body: `订单 ${order.id} 待支付 ${money(amountCents)}，请在官方页面完成支付。`,
      dueAt: new Date(now.getTime() + PAYMENT_REMINDER_MS).toISOString(),
      relatedId: order.id,
      owner: order.owner,
      meta: { quoteId, amountCents, payUrl: order.payUrl },
    });
    markRelatedRemindersRead(current, quoteId, ["quote_expiry"]);
    appendAudit(current, "order.create", {
      quoteId,
      orderId: order.id,
      amountCents,
      mode: live ? "live" : "demo",
      subscriptionId: subscriptionId || null,
      system,
    });
    return { order: clone(order) };
  });
}

export async function refreshOrder(orderId, { live = false, mcp = null, owner } = {}) {
  const state = await getState();
  const order = state.orders[orderId];
  assertOwned(order, owner, "ORDER_NOT_FOUND", "订单不存在");
  if (live && mcp && order.status === "pending_payment") {
    const remote = await mcp.queryOrder(orderId);
    if (remote?.status && remote.status !== order.status) {
      return mutate((current) => {
        const target = current.orders[orderId];
        if (!target) throw new ActionError("ORDER_NOT_FOUND", "订单不存在", 404);
        target.status = remote.status;
        target.updatedAt = new Date().toISOString();
        if (remote.payUrl) target.payUrl = remote.payUrl;
        if (remote.status === "paid") target.paidAt = new Date().toISOString();
        if (remote.status === "paid" || remote.status === "cancelled") {
          markRelatedRemindersRead(current, orderId, ["payment_due"]);
        }
        appendAudit(current, "order.refresh", { orderId, status: remote.status, mode: "live" });
        return { order: clone(target) };
      });
    }
  }
  return { order: clone(order) };
}

export async function cancelOrder(orderId, { live = false, mcp = null, owner } = {}) {
  const state = await getState();
  const order = state.orders[orderId];
  assertOwned(order, owner, "ORDER_NOT_FOUND", "订单不存在");
  if (order.status !== "pending_payment") {
    throw new ActionError("ORDER_NOT_CANCELLABLE", "只有待支付订单可以取消；已支付订单请走官方客服", 409);
  }
  if (live && mcp) await mcp.cancelOrder(orderId);
  return mutate((current) => {
    const target = current.orders[orderId];
    if (!target) throw new ActionError("ORDER_NOT_FOUND", "订单不存在", 404);
    if (target.status !== "pending_payment") {
      throw new ActionError("ORDER_NOT_CANCELLABLE", "订单状态已变化，请刷新后重试", 409);
    }
    target.status = "cancelled";
    target.cancelledAt = new Date().toISOString();
    target.updatedAt = new Date().toISOString();
    markRelatedRemindersRead(current, orderId, ["payment_due"]);
    appendAudit(current, "order.cancel", { orderId, mode: live ? "live" : "demo" });
    return { order: clone(target) };
  });
}

export async function mockPay(orderId, { owner } = {}) {
  const state = await getState();
  const order = state.orders[orderId];
  assertOwned(order, owner, "ORDER_NOT_FOUND", "订单不存在");
  if (!order.demo) throw new ActionError("MOCK_PAY_FORBIDDEN", "只有演示订单可以模拟支付", 403);
  if (order.status !== "pending_payment") {
    throw new ActionError("ORDER_NOT_PAYABLE", "订单当前不是待支付状态", 409);
  }
  return mutate((current) => {
    const target = current.orders[orderId];
    if (!target) throw new ActionError("ORDER_NOT_FOUND", "订单不存在", 404);
    target.status = "paid";
    target.paidAt = new Date().toISOString();
    target.updatedAt = new Date().toISOString();
    markRelatedRemindersRead(current, orderId, ["payment_due"]);
    appendAudit(current, "order.mock_pay", { orderId, mode: "demo" });
    return { order: clone(target) };
  });
}

function orderSignature(order) {
  const items = (order.plan?.items || [])
    .map((item) => `${item.id}:${item.qty}`)
    .sort()
    .join(",");
  return `${order.store?.id || ""}|${items}|${order.amountCents}`;
}

export async function reconcileOrders({ live = false, mcp = null, autoCancel = true, owner } = {}) {
  const state = await getState();
  // 保留最新一单：自动对账紧跟在用户确认下单之后，最新单才对应刚确认的价格与门店。
  const pending = Object.values(state.orders)
    .filter((order) => order.status === "pending_payment")
    .filter((order) => owner === undefined || ownedBy(order, owner))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const groups = new Map();
  for (const order of pending) {
    const key = orderSignature(order);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(order);
  }
  const duplicates = [];
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const [keep, ...rest] = group;
    for (const order of rest) duplicates.push({ order, keep });
  }
  if (duplicates.length === 0) return { groups: groups.size, duplicates: 0, cancelled: 0, items: [] };

  const cancelled = [];
  for (const { order, keep } of duplicates) {
    if (!autoCancel) {
      await mutate((current) => {
        const target = current.orders[order.id];
        if (target) target.duplicateOf = keep.id;
      });
      continue;
    }
    try {
      await mutate((current) => {
        const target = current.orders[order.id];
        if (target) target.duplicateOf = keep.id;
      });
      await cancelOrder(order.id, { live, mcp, owner });
      cancelled.push(order.id);
    } catch {
      // keep the original order; report it for manual handling
    }
  }
  await mutate((current) => {
    addReminder(current, {
      id: `duplicate_orders_${Date.now()}`,
      type: "duplicate_orders",
      title: "检测到重复未支付订单",
      body: `发现 ${duplicates.length} 个重复订单，已取消 ${cancelled.length} 个，请核对订单列表。`,
      dueAt: new Date().toISOString(),
      relatedId: null,
      meta: { duplicateIds: duplicates.map((row) => row.order.id), cancelled },
    });
    appendAudit(current, "order.reconcile", {
      duplicates: duplicates.length,
      cancelled: cancelled.length,
      mode: live ? "live" : "demo",
    });
  });
  return {
    groups: groups.size,
    duplicates: duplicates.length,
    cancelled: cancelled.length,
    items: duplicates.map((row) => row.order.id),
  };
}

export async function listOrders(owner = null) {
  const state = await getState();
  return Object.values(state.orders)
    .filter((order) => owner === null || ownedBy(order, owner))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function createSubscription({ quoteId, maxAmountCents, maxRunsPerDay, intervalMinutes, autoOrder = false, owner }) {
  const state = await getState();
  const quote = state.quotes[quoteId];
  assertOwned(quote, owner, "QUOTE_NOT_FOUND", "报价不存在");
  const interval = Math.max(1, Math.round(Number(intervalMinutes) || 1440));
  const cap = Math.max(100, Math.round(Number(maxAmountCents) || quote.plan.price.finalCents));
  const runs = Math.max(1, Math.round(Number(maxRunsPerDay) || 1));
  return mutate((current) => {
    const subscription = {
      id: newId("sub"),
      owner: quote.owner,
      quoteId,
      plan: clone(quote.plan),
      input: clone(quote.input),
      store: clone(quote.store),
      caps: {
        maxAmountCents: cap,
        maxRunsPerDay: runs,
        intervalMinutes: interval,
      },
      autoOrder: Boolean(autoOrder),
      enabled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastRunAt: null,
      nextRunAt: null,
      runs: [],
    };
    current.subscriptions[subscription.id] = subscription;
    appendAudit(current, "subscription.create", {
      subscriptionId: subscription.id,
      maxAmountCents: cap,
      maxRunsPerDay: runs,
      intervalMinutes: interval,
    });
    return clone(subscription);
  });
}

async function subscriptionState(subscriptionId) {
  const state = await getState();
  const subscription = state.subscriptions[subscriptionId];
  if (!subscription) throw new ActionError("SUBSCRIPTION_NOT_FOUND", "固定套餐不存在", 404);
  return subscription;
}

function subscriptionRunsToday(subscription) {
  return (subscription.runs || []).filter((run) => Date.parse(run.ts) >= todayStart()).length;
}

export async function toggleSubscription(subscriptionId, enabled, owner) {
  const state = await getState();
  const subscription = state.subscriptions[subscriptionId];
  assertOwned(subscription, owner, "SUBSCRIPTION_NOT_FOUND", "固定套餐不存在");
  return mutate((current) => {
    const target = current.subscriptions[subscriptionId];
    target.enabled = Boolean(enabled);
    target.updatedAt = new Date().toISOString();
    target.nextRunAt = target.enabled && target.autoOrder
      ? new Date(Date.now() + target.caps.intervalMinutes * 60_000).toISOString()
      : null;
    appendAudit(current, "subscription.toggle", {
      subscriptionId,
      enabled: target.enabled,
    });
    return clone(target);
  });
}

export async function deleteSubscription(subscriptionId, owner) {
  const state = await getState();
  assertOwned(state.subscriptions[subscriptionId], owner, "SUBSCRIPTION_NOT_FOUND", "固定套餐不存在");
  return mutate((current) => {
    delete current.subscriptions[subscriptionId];
    appendAudit(current, "subscription.delete", { subscriptionId });
    return { ok: true };
  });
}

export async function listSubscriptions(owner = null) {
  const state = await getState();
  return Object.values(state.subscriptions)
    .filter((subscription) => owner === null || ownedBy(subscription, owner))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function dueSubscriptions(now = Date.now()) {
  const state = await getState();
  return Object.values(state.subscriptions).filter((subscription) => {
    if (!subscription.enabled || !subscription.autoOrder) return false;
    if (!subscription.nextRunAt || Date.parse(subscription.nextRunAt) > now) return false;
    if (subscriptionRunsToday(subscription) >= subscription.caps.maxRunsPerDay) return false;
    return true;
  });
}

export async function markSubscriptionRun(subscriptionId, { quoteId, orderId, success, error = "" }) {
  return mutate((current) => {
    const subscription = current.subscriptions[subscriptionId];
    if (!subscription) return null;
    const now = new Date();
    subscription.runs = [
      ...(subscription.runs || []),
      { ts: now.toISOString(), quoteId, orderId, success, error },
    ].slice(-50);
    subscription.lastRunAt = now.toISOString();
    subscription.nextRunAt = new Date(
      now.getTime() + subscription.caps.intervalMinutes * 60_000,
    ).toISOString();
    const runsToday = subscriptionRunsToday(subscription);
    if (runsToday >= subscription.caps.maxRunsPerDay) {
      subscription.enabled = false;
      subscription.nextRunAt = null;
      addReminder(current, {
        id: `subscription_limit_${subscriptionId}_${runsToday}`,
        type: "subscription_limit",
        title: "固定套餐自动复购已暂停",
        body: `已达到每日 ${subscription.caps.maxRunsPerDay} 次上限，自动复购已关闭。`,
        dueAt: now.toISOString(),
        relatedId: subscriptionId,
        owner: subscription.owner,
      });
    }
    subscription.updatedAt = now.toISOString();
    appendAudit(current, "subscription.run", {
      subscriptionId,
      quoteId,
      orderId,
      success,
      error: error || undefined,
    });
    return clone(subscription);
  });
}

function accountFor(state, owner) {
  const key = owner || LEGACY_OWNER;
  if (!state.accounts) state.accounts = {};
  if (!state.accounts[key]) {
    state.accounts[key] = { claimedCouponIds: [], claimedCoupons: [] };
  }
  return state.accounts[key];
}

export async function getAccountData(liveAccount = null, owner = null) {
  const state = await getState();
  const base = liveAccount || DEMO_ACCOUNT;
  const wallet = owner ? accountFor(state, owner) : state.account;
  const claimed = new Set(wallet.claimedCouponIds || []);
  return {
    pointsBalance: base.pointsBalance || 0,
    pointsExpiringAt: base.pointsExpiringAt || null,
    coupons: (base.coupons || []).map((coupon) => ({
      ...coupon,
      claimed: claimed.has(coupon.id),
    })),
    activities: base.activities || [],
    claimedCoupons: wallet.claimedCoupons || [],
  };
}

export async function syncCouponReminders(coupons = DEMO_ACCOUNT.coupons) {
  await mutate((current) => {
    for (const coupon of coupons) {
      if (!coupon.expiresAt) continue;
      addReminder(current, {
        id: `coupon_expiry_${coupon.id}`,
        type: "coupon_expiry",
        title: `优惠券即将过期：${coupon.name}`,
        body: `「${coupon.name}」将在 ${new Date(coupon.expiresAt).toLocaleString("zh-CN")} 过期。`,
        dueAt: coupon.expiresAt,
        relatedId: coupon.id,
        meta: { couponId: coupon.id, discountCents: coupon.discountCents },
      });
    }
  });
}

export async function listReminders(owner = null) {
  const state = await getState();
  return Object.values(state.reminders)
    .filter((reminder) => owner === null || ownedBy(reminder, owner))
    .map((reminder) => ({
      ...reminder,
      due: Date.parse(reminder.dueAt) <= Date.now(),
    }))
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
}

export async function markReminderRead(reminderId, owner = null) {
  return mutate((current) => {
    const reminder = current.reminders[reminderId];
    assertOwned(reminder, owner, "REMINDER_NOT_FOUND", "提醒不存在");
    reminder.read = true;
    return clone(reminder);
  });
}

export async function listAudit() {
  const state = await getState();
  return state.audit.slice(-50).reverse();
}

// 给 /api/steward 用：只返回最近一条原始记录，摘要由 lib/steward.js 负责。
export async function latestQuoteAndOrder(owner = null) {
  const state = await getState();
  const byNewest = (a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0);
  const mine = (record) => owner === null || record.owner === owner;
  return {
    quote: Object.values(state.quotes || {}).filter(mine).sort(byNewest)[0] || null,
    order: Object.values(state.orders || {}).filter(mine).sort(byNewest)[0] || null,
  };
}

export async function latestSubscriptionRun(owner = null) {
  const state = await getState();
  const runs = Object.values(state.subscriptions || {})
    .filter((item) => owner === null || item.owner === owner)
    .map((item) => item.lastRunAt)
    .filter(Boolean)
    .sort();
  return runs.length ? runs[runs.length - 1] : null;
}

export function money(cents) {
  return `¥${(Number(cents) / 100).toFixed(2)}`;
}
