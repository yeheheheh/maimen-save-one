import http from "node:http";
import crypto from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEMO_DATA, DEMO_DEFAULTS, DEMO_POINTS, DEMO_STORES, DEMO_ITEMS, DEMO_COMBOS, DEMO_COUPONS } from "./lib/demo-data.js";
import { optimize } from "./lib/optimizer.js";
import {
  ActionError,
  createQuote,
  claimCoupon,
  createOrder,
  refreshOrder,
  cancelOrder,
  mockPay,
  reconcileOrders,
  listOrders,
  createSubscription,
  toggleSubscription,
  deleteSubscription,
  listSubscriptions,
  dueSubscriptions,
  markSubscriptionRun,
  getAccountData,
  syncCouponReminders,
  listReminders,
  markReminderRead,
  listAudit,
  latestQuoteAndOrder,
  latestSubscriptionRun,
} from "./lib/action-service.js";
import { buildStewardView } from "./lib/steward.js";
import { LiveRegistry } from "./lib/live-registry.js";
import { loadStoredToken } from "./lib/live-config.js";
import { buildCapabilities, writeDecision } from "./lib/access.js";
import { getUser, listUsers, publicBinding, CONSENT_VERSION } from "./lib/user-store.js";
import {
  UID_COOKIE,
  uidCookie,
  readUid,
  parseCookies,
  createUserId,
} from "./lib/session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("export ")) trimmed = trimmed.slice(7).trim();
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(__dirname, ".env"));

const PUBLIC_DIR = path.join(__dirname, "public");
const APP_VERSION = "2.0.0";
const PORT = Number(process.env.PORT || 8899);
const HOST = process.env.HOST || "127.0.0.1";
const MCD_MCP_TOKEN = (process.env.MCD_MCP_TOKEN || "").trim();
const ENABLE_LIVE = process.env.ENABLE_LIVE === "true";
const ENABLE_ORDER = process.env.ENABLE_ORDER === "true";
const DEMO_WRITE = process.env.DEMO_WRITE !== "false";
const SINGLE_USER_MODE = process.env.SINGLE_USER_MODE === "true";
const ENABLE_WRITE = process.env.ENABLE_WRITE === "true";
const ENABLE_COUPON_CLAIM = process.env.ENABLE_COUPON_CLAIM === "true";
const ENABLE_ORDER_CREATE =
  process.env.ENABLE_ORDER_CREATE === "true" || ENABLE_ORDER;
const ENABLE_AUTO_REPURCHASE = process.env.ENABLE_AUTO_REPURCHASE === "true";
const ENABLE_AUTO_CANCEL_UNPAID = process.env.ENABLE_AUTO_CANCEL_UNPAID === "true";
const MAX_ORDER_CENTS = Math.max(100, Number(process.env.MAX_ORDER_CENTS || 5000));
const MAX_DAILY_ORDERS = Math.max(1, Number(process.env.MAX_DAILY_ORDERS || 5));
const SUBSCRIPTION_TICK_MS = Math.max(5000, Number(process.env.SUBSCRIPTION_TICK_MS || 60000));
const WRITE_PASSCODE = (process.env.WRITE_PASSCODE || "").trim();
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const WRITE_COOKIE = "ms_private";
const SESSION_TTL_MS = 8 * 3600_000;

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(self), camera=(), microphone=()",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

const LIVE_SETUP_DISABLED = process.env.DISABLE_LIVE_SETUP === "true";

// 我方 MCP：只用于「未绑定用户」的只读体验，任何情况下都不替用户下单。
const registry = new LiveRegistry({ hostToken: MCD_MCP_TOKEN });
let liveOptimize = null;
let hostError = "";

async function loadMcpModule() {
  const module = await import("./lib/mcp-live.js");
  liveOptimize = module.optimizeLive;
  return module;
}

function registerCookieHeader(req, res, uid) {
  const secure = req.headers["x-forwarded-proto"] === "https";
  res.setHeader("Set-Cookie", uidCookie(uid, SESSION_SECRET, secure));
}

/**
 * 每个请求先确定身份：匿名设备 uid + 该用户是否已绑定自己的 Token。
 * mode:
 *   own  —— 已绑定本人 Token，可读写（写仍要逐单确认）
 *   host —— 未绑定，用我方 MCP 的只读体验，下单会被拦截
 *   none —— 连我方 MCP 都没有，退回演示数据（允许模拟写）
 */
async function resolveContext(req, res) {
  let uid = readUid(parseCookies(req.headers.cookie)[UID_COOKIE], SESSION_SECRET);
  if (!uid) {
    uid = createUserId();
    registerCookieHeader(req, res, uid);
  }
  const record = await getUser(uid);
  const client = registry.clientFor(uid);
  let mode = "none";
  if (client && record?.consent?.granted) mode = "own";
  else if (registry.hostClient) mode = "host";
  const readClient = mode === "own" ? client : registry.hostClient;
  return {
    uid,
    mode,
    client: mode === "own" ? client : null,
    readClient: readClient || null,
    binding: publicBinding(record),
    identity: record?.identity || null,
  };
}

function liveStatus(ctx = null) {
  return {
    setupEnabled: !LIVE_SETUP_DISABLED,
    hostAvailable: Boolean(registry.hostClient),
    hostState: registry.hostState,
    connected: ctx ? ctx.mode === "own" : Boolean(registry.hostClient),
    mode: ctx ? ctx.mode : "unknown",
    bound: Boolean(ctx?.binding),
    identity: ctx?.identity || null,
    checkedAt: ctx?.binding?.updatedAt || null,
    lastError: null,
    envManaged: Boolean(MCD_MCP_TOKEN),
    storedToken: Boolean(ctx?.binding),
  };
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.headers.host || "");
  } catch {
    return false;
  }
}

async function initLive() {
  // 1.x 只支持一份全局 Token（data/live-token.json）。2.0 起用户各自的 Token 存在
  // data/users/，旧文件降级为「我方 MCP 体验账号」，只读、不替任何人下单。
  if (!registry.hostToken) {
    try {
      const legacy = await loadStoredToken();
      if (legacy?.token) {
        registry.hostToken = legacy.token;
        console.log("[maimen-save-one] adopted legacy token as read-only host account");
      }
    } catch {
      // 旧文件损坏时忽略，退回演示数据
    }
  }
  await registry.initHost();
  hostError = registry.host.lastError?.message || "";
  if (registry.host.state === "connected") {
    console.log("[maimen-save-one] host MCP connected (read-only for guests)");
  } else if (registry.host.state === "error") {
    console.error("[maimen-save-one] host MCP unavailable:", hostError);
  }

  // 恢复已绑定用户的连接；单个失败不影响其他人。
  const uids = await listUsers();
  let restored = 0;
  for (const uid of uids) {
    const entry = await registry.restore(uid);
    if (entry) restored += 1;
  }
  if (restored) console.log(`[maimen-save-one] restored ${restored} user binding(s)`);
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    ...extraHeaders,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

function createSessionToken() {
  const payload = Buffer.from(
    JSON.stringify({ scope: "write", exp: Date.now() + SESSION_TTL_MS }),
  ).toString("base64url");
  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function verifySessionToken(token) {
  if (typeof token !== "string" || !token.includes(".")) return false;
  const [payload, signature] = token.split(".");
  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.scope === "write" && Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

function isUnlocked(req) {
  return verifySessionToken(parseCookies(req.headers.cookie)[WRITE_COOKIE]);
}

function writeCookie(req) {
  const secure = req.headers["x-forwarded-proto"] === "https";
  return `${WRITE_COOKIE}=${createSessionToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? "; Secure" : ""}`;
}

function clearWriteCookie() {
  return `${WRITE_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

const WRITE_FLAGS = () => ({
  demoWrite: DEMO_WRITE,
  enableWrite: ENABLE_WRITE,
  enableCouponClaim: ENABLE_COUPON_CLAIM,
  enableOrderCreate: ENABLE_ORDER_CREATE,
  enableAutoRepurchase: ENABLE_AUTO_REPURCHASE,
  enableAutoCancelUnpaid: ENABLE_AUTO_CANCEL_UNPAID,
  singleUser: SINGLE_USER_MODE,
  maxOrderCents: MAX_ORDER_CENTS,
  maxDailyOrders: MAX_DAILY_ORDERS,
});

function capabilities(ctx) {
  return buildCapabilities(ctx, WRITE_FLAGS());
}

function requireWrite(ctx, feature) {
  return writeDecision(ctx, feature, WRITE_FLAGS());
}

function sendActionError(res, error) {
  if (error instanceof ActionError) {
    sendJson(res, error.status, { ok: false, code: error.code, error: error.message });
    return;
  }
  console.error("[maimen-save-one] action error:", error);
  sendJson(res, 500, { ok: false, error: "服务器内部错误" });
}

const buckets = new Map();
// 按「作用域 + IP」分桶：绑定接口的 5 次/分钟不应被普通请求挤占。
function allowRequest(ip, limit = 60, windowMs = 60_000, scope = "default") {
  const now = Date.now();
  const key = `${scope}:${ip}`;
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(ip);
  }
}, 60_000).unref();

function readJson(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendText(res, 400, "Bad Request");
    return;
  }
  const safePath = decoded.replace(/^\/+/, "");
  let filePath = path.resolve(PUBLIC_DIR, safePath || "index.html");
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, "index.html");
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const isShell = [".html", ".webmanifest"].includes(ext) || filePath.endsWith("sw.js");
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": isShell ? "no-cache" : "public, max-age=3600",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    if (!path.extname(safePath)) {
      try {
        const data = await readFile(path.join(PUBLIC_DIR, "index.html"));
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          "Content-Type": MIME[".html"],
          "Content-Length": data.length,
          "Cache-Control": "no-cache",
        });
        res.end(data);
        return;
      } catch {
        // fall through to 404
      }
    }
    sendText(res, 404, "Not Found");
  }
}

async function bodyOr400(req, res) {
  try {
    return await readJson(req);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message });
    return null;
  }
}

async function runOptimize(input, ctx = null) {
  const client = ctx?.readClient || null;
  if (client) {
    try {
      if (!liveOptimize) await loadMcpModule();
      const result = await liveOptimize(input, client);
      // 共享体验模式必须标明数据来自我方账号，避免误以为是自己的数据。
      if (ctx?.mode === "host") {
        result.warnings = [
          "当前是我方 MCP 的体验数据，不能下单；绑定你自己的 Token 后才会用你的账号。",
          ...(result.warnings || []),
        ];
        result.hostMode = true;
      }
      return result;
    } catch (error) {
      console.error(
        "[maimen-save-one] live optimize failed:",
        error instanceof Error ? error.message : error,
      );
      const result = optimize(input, DEMO_DATA);
      result.warnings = [
        "实时接口暂不可用，已切换到演示数据；请稍后重试。",
        ...result.warnings,
      ];
      result.liveError = true;
      return result;
    }
  }
  return optimize(input, DEMO_DATA);
}

async function runSubscriptionQuote(subscription) {
  const result = await runOptimize(subscription.input);
  const plan =
    result.plans.find((item) => item.label === subscription.plan?.label) ||
    result.plans.find((item) => item.id === subscription.plan?.id) ||
    result.plans[0];
  if (!plan) throw new ActionError("NO_PLAN", "当前条件下没有可执行的固定套餐", 422);
  if (plan.price.finalCents > subscription.caps.maxAmountCents) {
    throw new ActionError(
      "AMOUNT_LIMIT",
      `复购金额 ${(plan.price.finalCents / 100).toFixed(2)} 元超过上限 ${(subscription.caps.maxAmountCents / 100).toFixed(2)} 元`,
      403,
    );
  }
  const quote = await createQuote({
    result,
    planId: plan.id,
    source: result.mode,
    owner: subscription.owner,
  });
  return { ...quote, plan, result };
}

async function runSubscriptionOnce(subscription, { autoCreate }) {
  try {
    const result = await runSubscriptionQuote(subscription);
    let order = null;
    if (autoCreate) {
      // 自动复购只能用电户自己的连接；没有连接就拒绝，绝不借用共享账号。
      const client = registry.clientFor(subscription.owner);
      if (!client) throw new ActionError("OWN_TOKEN_REQUIRED", "该固定套餐的所属用户尚未绑定 Token，已跳过自动复购", 403);
      const created = await createOrder({
        quoteId: result.quote.id,
        system: true,
        live: true,
        mcp: client,
        owner: subscription.owner,
        caps: {
          maxAmountCents: subscription.caps.maxAmountCents,
          maxDailyOrders: MAX_DAILY_ORDERS,
        },
        subscriptionId: subscription.id,
      });
      order = created.order;
    }
    const updated = await markSubscriptionRun(subscription.id, {
      quoteId: result.quote.id,
      orderId: order?.id || null,
      success: true,
    });
    return { ...result, order, subscription: updated };
  } catch (error) {
    await markSubscriptionRun(subscription.id, {
      quoteId: null,
      orderId: null,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function handleApi(req, res, pathname) {
  if (!allowRequest(clientIp(req))) {
    sendJson(res, 429, { ok: false, error: "请求过于频繁，请稍后再试" });
    return true;
  }
  const ctx = await resolveContext(req, res);

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      app: "maimen-save-one",
      name: "麦门省一单",
      version: APP_VERSION,
      mode: ctx.mode === "own" || ctx.mode === "host" ? "live" : "demo",
      access: ctx.mode,
      hostAvailable: Boolean(registry.hostClient),
      hostState: registry.hostState,
      bound: ctx.mode === "own",
      writeMode: capabilities(ctx).writeMode,
      liveSetup: !LIVE_SETUP_DISABLED,
      uptimeSeconds: Math.round(process.uptime()),
      time: new Date().toISOString(),
    });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/capabilities") {
    sendJson(res, 200, { ok: true, ...capabilities(ctx) });
    return true;
  }

  // 兼容旧入口：语义等同于「当前浏览器的绑定状态」。
  if (req.method === "GET" && pathname === "/api/live/status") {
    const status = await registry.status(ctx.uid);
    sendJson(res, 200, {
      ok: true,
      setupEnabled: !LIVE_SETUP_DISABLED,
      connected: ctx.mode === "own",
      mode: ctx.mode,
      source: ctx.mode === "own" ? "own" : ctx.mode === "host" ? "host" : "none",
      envManaged: Boolean(MCD_MCP_TOKEN),
      storedToken: Boolean(ctx.binding),
      checkedAt: ctx.binding?.updatedAt || null,
      lastError: status.session?.lastError || null,
      hostAvailable: status.hostAvailable,
    });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/account/binding") {
    const status = await registry.status(ctx.uid);
    sendJson(res, 200, {
      ok: true,
      mode: ctx.mode,
      setupEnabled: !LIVE_SETUP_DISABLED,
      binding: status.binding,
      identity: ctx.identity,
      session: status.session,
      host: { available: status.hostAvailable, state: status.hostState },
      consentVersion: CONSENT_VERSION,
      capabilities: capabilities(ctx),
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/account/bind") {
    if (LIVE_SETUP_DISABLED) {
      throw new ActionError("SETUP_DISABLED", "当前部署已关闭页面绑定，请联系部署者", 403);
    }
    if (!sameOrigin(req)) throw new ActionError("CROSS_ORIGIN", "只接受站内请求", 403);
    if (!allowRequest(clientIp(req), 5, 60_000, "bind")) {
      sendJson(res, 429, { ok: false, code: "RATE_LIMITED", error: "绑定太频繁，请 1 分钟后再试" });
      return true;
    }
    const body = await bodyOr400(req, res);
    if (!body) return true;
    try {
      await registry.bind(ctx.uid, { token: body.token, consent: Boolean(body.consent) });
      const next = await resolveContext(req, res);
      sendJson(res, 200, {
        ok: true,
        mode: next.mode,
        binding: next.binding,
        identity: next.identity,
        capabilities: capabilities(next),
        message: "已绑定你的账号，下单将使用你自己的 McDonald's 身份",
      });
    } catch (error) {
      const code = error.code || "BIND_FAILED";
      const status = error.status || 502;
      console.error("[maimen-save-one] bind failed:", code);
      sendJson(res, status, { ok: false, code, error: error.message, mode: ctx.mode });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/account/unbind") {
    if (!sameOrigin(req)) throw new ActionError("CROSS_ORIGIN", "只接受站内请求", 403);
    await registry.unbind(ctx.uid);
    sendJson(res, 200, {
      ok: true,
      mode: registry.hostClient ? "host" : "none",
      message: "已解绑，本机不再保存你的 Token；未支付的演示订单不影响任何真实账户",
    });
    return true;
  }

  // 旧接口保留为别名，但同样要求显式授权，避免绕过 consent。
  if (req.method === "POST" && pathname === "/api/live/token") {
    if (LIVE_SETUP_DISABLED) {
      throw new ActionError("SETUP_DISABLED", "当前部署已关闭页面接入", 403);
    }
    if (!sameOrigin(req)) throw new ActionError("CROSS_ORIGIN", "只接受站内请求", 403);
    const body = await bodyOr400(req, res);
    if (!body) return true;
    try {
      await registry.bind(ctx.uid, { token: body.token, consent: Boolean(body.consent) });
      const next = await resolveContext(req, res);
      sendJson(res, 200, { ok: true, mode: next.mode, binding: next.binding, capabilities: capabilities(next) });
    } catch (error) {
      sendJson(res, error.status || 502, { ok: false, code: error.code || "BIND_FAILED", error: error.message });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/live/disconnect") {
    if (!sameOrigin(req)) throw new ActionError("CROSS_ORIGIN", "只接受站内请求", 403);
    await registry.unbind(ctx.uid);
    sendJson(res, 200, { ok: true, mode: registry.hostClient ? "host" : "none" });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/steward") {
    const [{ quote, order }, subscriptionRunAt] = await Promise.all([
      latestQuoteAndOrder(),
      latestSubscriptionRun(),
    ]);
    const view = buildStewardView({
      mode: ctx.mode === "own" || ctx.mode === "host" ? "live" : "demo",
      liveState: ctx.mode,
      trace: registry.trace(),
      lastQuote: quote,
      lastOrder: order,
      capabilities: capabilities(ctx),
      subscriptionRunAt,
    });
    sendJson(res, 200, { ok: true, ...view });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/bootstrap") {
    sendJson(res, 200, {
      ok: true,
      app: "maimen-save-one",
      version: APP_VERSION,
      mode: ctx.mode === "own" || ctx.mode === "host" ? "live" : "demo",
      liveState: ctx.mode,
      defaults: DEMO_DEFAULTS,
      stores: DEMO_STORES,
      pointsBalance: DEMO_POINTS,
      counts: {
        items: DEMO_ITEMS.length,
        combos: DEMO_COMBOS.length,
        coupons: DEMO_COUPONS.length,
      },
      capabilities: capabilities(ctx),
      live: liveStatus(),
      generatedAt: new Date().toISOString(),
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/optimize") {
    let input;
    try {
      input = await readJson(req);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
      return true;
    }
    try {
      const result = await runOptimize(input, ctx);
      const caps = capabilities(ctx);
      result.deployment = {
        mode: result.mode,
        liveState: ctx.mode,
        orderEnabled: caps.orderCreate,
        writeMode: caps.writeMode,
        serverTime: new Date().toISOString(),
      };
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 422, {
        ok: false,
        error: error instanceof Error ? error.message : "无法生成方案",
      });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/order") {
    sendJson(res, ENABLE_ORDER ? 501 : 403, {
      ok: false,
      code: "ORDER_DISABLED",
      message:
        "当前版本是只读省钱助手，不代替用户提交真实订单；请复制清单后前往麦当劳官方渠道完成支付。",
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/private/unlock") {
    if (!SINGLE_USER_MODE || !WRITE_PASSCODE) {
      sendJson(res, 403, {
        ok: false,
        code: "PRIVATE_MODE_DISABLED",
        error: "当前未开启单用户私有模式，或未配置 WRITE_PASSCODE",
      });
      return true;
    }
    const body = await bodyOr400(req, res);
    if (!body) return true;
    const supplied = Buffer.from(String(body.passcode || ""));
    const expected = Buffer.from(WRITE_PASSCODE);
    const valid =
      supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    if (!valid) {
      sendJson(res, 401, { ok: false, code: "BAD_PASSCODE", error: "私有模式口令不正确" });
      return true;
    }
    sendJson(
      res,
      200,
      { ok: true, unlocked: true, message: "私有模式已解锁，写操作仍受限额与频次控制" },
      { "Set-Cookie": writeCookie(req) },
    );
    return true;
  }

  if (req.method === "POST" && pathname === "/api/private/lock") {
    sendJson(res, 200, { ok: true, unlocked: false }, { "Set-Cookie": clearWriteCookie() });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/quote") {
    const body = await bodyOr400(req, res);
    if (!body) return true;
    const input = body.input && typeof body.input === "object" ? body.input : body;
    const result = await runOptimize(input, ctx);
    const quote = await createQuote({
      result,
      planId: body.planId,
      source: result.mode,
      owner: ctx.uid,
    });
    sendJson(res, 200, {
      ok: true,
      ...quote,
      source: result.mode,
      capabilities: capabilities(ctx),
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/coupons/claim") {
    const access = requireWrite(ctx, "coupon");
    const body = await bodyOr400(req, res);
    if (!body) return true;
    const result = await claimCoupon({
      quoteId: body.quoteId,
      token: body.token,
      live: access.live,
      mcp: access.client,
      owner: ctx.uid,
    });
    sendJson(res, 200, { ok: true, ...result, capabilities: capabilities(ctx) });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/orders") {
    sendJson(res, 200, { ok: true, orders: await listOrders(ctx.uid) });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/orders") {
    const access = requireWrite(ctx, "order");
    const body = await bodyOr400(req, res);
    if (!body) return true;
    const result = await createOrder({
      quoteId: body.quoteId,
      token: body.token,
      live: access.live,
      mcp: access.client,
      owner: ctx.uid,
      caps: {
        maxAmountCents: MAX_ORDER_CENTS,
        maxDailyOrders: MAX_DAILY_ORDERS,
      },
    });
    sendJson(res, 200, {
      ok: true,
      ...result,
      submittedWith: access.mode === "own" ? "own-account" : "demo",
      identity: ctx.identity,
      capabilities: capabilities(ctx),
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/orders/reconcile") {
    const access = requireWrite(ctx, "order");
    const autoCancel = access.mode === "demo" ? true : ENABLE_AUTO_CANCEL_UNPAID;
    const result = await reconcileOrders({
      live: access.live,
      mcp: access.client,
      autoCancel,
      owner: ctx.uid,
    });
    sendJson(res, 200, { ok: true, ...result, capabilities: capabilities(ctx) });
    return true;
  }

  let match = pathname.match(/^\/api\/orders\/([^/]+)\/mock-pay$/);
  if (req.method === "POST" && match) {
    const access = requireWrite(ctx, "order");
    if (access.live) {
      throw new ActionError("MOCK_PAY_FORBIDDEN", "实时模式不允许模拟支付", 403);
    }
    const result = await mockPay(decodeURIComponent(match[1]), { owner: ctx.uid });
    sendJson(res, 200, { ok: true, ...result });
    return true;
  }

  match = pathname.match(/^\/api\/orders\/([^/]+)\/cancel$/);
  if (req.method === "POST" && match) {
    const access = requireWrite(ctx, "order");
    const result = await cancelOrder(decodeURIComponent(match[1]), {
      live: access.live,
      mcp: access.client,
      owner: ctx.uid,
    });
    sendJson(res, 200, { ok: true, ...result, capabilities: capabilities(ctx) });
    return true;
  }

  match = pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (req.method === "GET" && match) {
    const client = registry.clientFor(ctx.uid);
    const result = await refreshOrder(decodeURIComponent(match[1]), {
      live: Boolean(client),
      mcp: client,
      owner: ctx.uid,
    });
    sendJson(res, 200, { ok: true, ...result });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/reminders") {
    sendJson(res, 200, { ok: true, reminders: await listReminders(ctx.uid) });
    return true;
  }

  match = pathname.match(/^\/api\/reminders\/([^/]+)\/read$/);
  if (req.method === "POST" && match) {
    const reminder = await markReminderRead(decodeURIComponent(match[1]), ctx.uid);
    sendJson(res, 200, { ok: true, reminder });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/account") {
    let account = null;
    let source = "demo";
    const warnings = [];
    const client = ctx.mode === "own" ? ctx.client : null;
    if (client) {
      try {
        account = await client.accountData();
        source = "own";
        warnings.push(...(account.warnings || []));
      } catch (error) {
        warnings.push("你的实时账户暂不可用，已展示演示权益");
        registry.markError(ctx.uid, error);
      }
    }
    if (!account) {
      // 未绑定用户只看演示权益，绝不读共享账号的券包/积分。
      account = await getAccountData(null, ctx.uid);
      source = "demo";
      if (ctx.mode === "host") warnings.push("绑定你自己的 Token 后可查看你的真实积分与券包");
    }
    await syncCouponReminders(account.coupons || []);
    sendJson(res, 200, { ok: true, source, account, warnings, identity: ctx.identity });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/subscriptions") {
    sendJson(res, 200, { ok: true, subscriptions: await listSubscriptions(ctx.uid) });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/subscriptions") {
    requireWrite(ctx, "order");
    const body = await bodyOr400(req, res);
    if (!body) return true;
    if (body.autoOrder && !capabilities(ctx).autoRepurchase) {
      throw new ActionError("FEATURE_DISABLED", "自动复购未开启，请先配置单用户私有模式", 403);
    }
    const subscription = await createSubscription({
      quoteId: body.quoteId,
      maxAmountCents: body.maxAmountCents,
      maxRunsPerDay: body.maxRunsPerDay,
      intervalMinutes: body.intervalMinutes,
      autoOrder: Boolean(body.autoOrder),
      owner: ctx.uid,
    });
    sendJson(res, 200, { ok: true, subscription, capabilities: capabilities(ctx) });
    return true;
  }

  match = pathname.match(/^\/api\/subscriptions\/([^/]+)\/toggle$/);
  if (req.method === "POST" && match) {
    const id = decodeURIComponent(match[1]);
    const subscriptions = await listSubscriptions(ctx.uid);
    const subscription = subscriptions.find((item) => item.id === id);
    if (!subscription) throw new ActionError("SUBSCRIPTION_NOT_FOUND", "固定套餐不存在", 404);
    requireWrite(ctx, "order");
    const body = await bodyOr400(req, res);
    if (!body) return true;
    if (body.enabled && subscription.autoOrder) requireWrite(ctx, "auto");
    const updated = await toggleSubscription(id, Boolean(body.enabled), ctx.uid);
    sendJson(res, 200, { ok: true, subscription: updated, capabilities: capabilities(ctx) });
    return true;
  }

  match = pathname.match(/^\/api\/subscriptions\/([^/]+)\/run$/);
  if (req.method === "POST" && match) {
    const id = decodeURIComponent(match[1]);
    requireWrite(ctx, "order");
    const body = await bodyOr400(req, res);
    if (!body) return true;
    const subscriptions = await listSubscriptions(ctx.uid);
    const subscription = subscriptions.find((item) => item.id === id);
    if (!subscription) throw new ActionError("SUBSCRIPTION_NOT_FOUND", "固定套餐不存在", 404);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const runsToday = (subscription.runs || []).filter(
      (run) => Date.parse(run.ts) >= today.getTime(),
    ).length;
    if (runsToday >= subscription.caps.maxRunsPerDay) {
      throw new ActionError("DAILY_LIMIT", "今日复购次数已达上限", 429);
    }
    const result = await runSubscriptionOnce(subscription, {
      autoCreate: Boolean(body.autoCreate),
    });
    sendJson(res, 200, {
      ok: true,
      quote: result.quote,
      tokens: result.tokens,
      plan: result.plan,
      order: result.order,
      subscription: result.subscription,
      capabilities: capabilities(ctx),
    });
    return true;
  }

  match = pathname.match(/^\/api\/subscriptions\/([^/]+)$/);
  if (req.method === "DELETE" && match) {
    requireWrite(ctx, "order");
    const result = await deleteSubscription(decodeURIComponent(match[1]), ctx.uid);
    sendJson(res, 200, { ok: true, ...result });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/audit") {
    sendJson(res, 200, { ok: true, audit: await listAudit() });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/version") {
    sendJson(res, 200, { ok: true, version: APP_VERSION, mode: ctx.mode === "own" || ctx.mode === "host" ? "live" : "demo" });
    return true;
  }

  return false;
}

let schedulerBusy = false;
async function processSubscriptions() {
  if (schedulerBusy) return;
  if (!registry.hostClient && !DEMO_WRITE) return;
  if (!ENABLE_AUTO_REPURCHASE) return;
  schedulerBusy = true;
  try {
    const subscriptions = await dueSubscriptions();
    for (const subscription of subscriptions) {
      try {
        const result = await runSubscriptionOnce(subscription, { autoCreate: true });
        console.log(
          `[maimen-save-one] subscription ${subscription.id} ran -> ${result.order?.id || result.quote.id}`,
        );
      } catch (error) {
        console.error(
          `[maimen-save-one] subscription ${subscription.id} failed:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  } finally {
    schedulerBusy = false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, SECURITY_HEADERS);
    res.end();
    return;
  }

  if (pathname.startsWith("/api/")) {
    try {
      const handled = await handleApi(req, res, pathname);
      if (!handled) sendJson(res, 404, { ok: false, error: "接口不存在" });
    } catch (error) {
      if (error instanceof ActionError) {
        sendActionError(res, error);
      } else {
        console.error("[maimen-save-one] request error:", error);
        sendJson(res, 500, { ok: false, error: "服务器内部错误" });
      }
    }
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method Not Allowed");
    return;
  }

  await serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`[maimen-save-one] listening on http://${HOST}:${PORT} mode=${MCD_MCP_TOKEN ? "host-live" : "demo"}`);
  initLive().then(async () => {
    console.log(`[maimen-save-one] host state: ${registry.hostState}`);
    try {
      const account = await getAccountData();
      await syncCouponReminders(account.coupons || []);
    } catch (error) {
      console.error("[maimen-save-one] reminder init failed:", error);
    }
    setInterval(processSubscriptions, SUBSCRIPTION_TICK_MS).unref();
  });
});

async function shutdown(signal) {
  console.log(`[maimen-save-one] shutting down (${signal})`);
  server.close();
  const clients = [registry.host.client, ...[...registry.users.values()].map((entry) => entry.client)];
  for (const client of clients) {
    if (!client) continue;
    try {
      await client.close();
    } catch {
      // ignore
    }
  }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
