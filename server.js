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
import {
  loadStoredToken,
  saveStoredToken,
  clearStoredToken,
  normalizeToken,
  classifyConnectError,
} from "./lib/live-config.js";

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
const APP_VERSION = "1.3.0";
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

let liveClient = null;
let liveState = ENABLE_LIVE ? "starting" : "disabled";
let liveError = "";
let liveOptimize = null;
// mcp-live.js 是动态导入，demo 模式不会加载；轨迹读取器默认空实现。
let readToolTrace = () => [];
let liveCheckedAt = null;
let liveLastError = null;
let storedTokenPresent = false;
let liveSource = "none";

const LIVE_SETUP_DISABLED = process.env.DISABLE_LIVE_SETUP === "true";
const CONNECT_TIMEOUT_MS = Math.max(3000, Number(process.env.LIVE_CONNECT_TIMEOUT_MS || 12000));

function withDeadline(promise, ms, label = "连接") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}超时`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function loadMcpModule() {
  const module = await import("./lib/mcp-live.js");
  liveOptimize = module.optimizeLive;
  if (typeof module.getToolTrace === "function") readToolTrace = module.getToolTrace;
  return module;
}

// 用一次只读工具调用验证 Token：连接成功但不通工具，等价于无效凭据。
async function verifyToken(token) {
  const module = await loadMcpModule();
  const client = await withDeadline(module.createLiveClient(token), CONNECT_TIMEOUT_MS);
  try {
    await withDeadline(client.nutrition(), CONNECT_TIMEOUT_MS, "工具调用");
  } catch (error) {
    try {
      await client.close();
    } catch {
      // 关闭失败不影响校验结论
    }
    throw error;
  }
  return client;
}

function activateLiveClient(client, source) {
  const previous = liveClient;
  liveClient = client;
  liveState = "connected";
  liveError = "";
  liveLastError = null;
  liveCheckedAt = new Date().toISOString();
  liveSource = source;
  if (previous && previous !== client) {
    Promise.resolve(previous.close()).catch(() => {});
  }
}



function liveStatus() {
  return {
    setupEnabled: !LIVE_SETUP_DISABLED,
    connected: Boolean(liveClient),
    state: liveState,
    source: liveClient ? liveSource : "none",
    envManaged: Boolean(MCD_MCP_TOKEN),
    storedToken: storedTokenPresent,
    checkedAt: liveCheckedAt,
    lastError: liveLastError,
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
  let stored = null;
  try {
    stored = await loadStoredToken();
  } catch {
    stored = null;
  }
  storedTokenPresent = Boolean(stored?.token);
  const token = MCD_MCP_TOKEN || stored?.token || "";
  // 页面里保存的 Token 属于用户显式意愿，即使没开 ENABLE_LIVE 也允许恢复连接。
  const runtimeOptIn = !MCD_MCP_TOKEN && Boolean(stored?.token);
  if (!token) {
    liveState = ENABLE_LIVE ? "no-token" : "disabled";
    liveSource = "none";
    return;
  }
  if (!ENABLE_LIVE && !runtimeOptIn) {
    liveState = "disabled";
    liveSource = "none";
    return;
  }
  try {
    liveClient = await verifyToken(token);
    liveState = "connected";
    liveSource = MCD_MCP_TOKEN ? "env" : "stored";
    liveCheckedAt = new Date().toISOString();
    console.log("[maimen-save-one] live MCP connected");
  } catch (error) {
    liveState = "error";
    liveLastError = classifyConnectError(error);
    liveError = error instanceof Error ? error.message : String(error);
    liveCheckedAt = new Date().toISOString();
    console.error("[maimen-save-one] live MCP unavailable:", liveError);
  }
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

function parseCookies(req) {
  const header = req.headers.cookie;
  if (typeof header !== "string" || !header) return {};
  const result = {};
  for (const pair of header.split(";")) {
    const index = pair.indexOf("=");
    if (index < 0) continue;
    result[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  }
  return result;
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
  return verifySessionToken(parseCookies(req)[WRITE_COOKIE]);
}

function writeCookie(req) {
  const secure = req.headers["x-forwarded-proto"] === "https";
  return `${WRITE_COOKIE}=${createSessionToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? "; Secure" : ""}`;
}

function clearWriteCookie() {
  return `${WRITE_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

function capabilities(req) {
  const mode = liveClient ? "live" : "demo";
  const unlocked = isUnlocked(req);
  const liveReady =
    Boolean(liveClient) && ENABLE_WRITE && SINGLE_USER_MODE && Boolean(WRITE_PASSCODE);
  const demoWrite = mode === "demo" && DEMO_WRITE;
  const couponClaim = demoWrite || (liveReady && ENABLE_COUPON_CLAIM && unlocked);
  const orderCreate = demoWrite || (liveReady && ENABLE_ORDER_CREATE && unlocked);
  const autoRepurchase = demoWrite || (liveReady && ENABLE_AUTO_REPURCHASE && unlocked);
  return {
    mode,
    live: Boolean(liveClient),
    writeMode: demoWrite ? "demo" : liveReady ? "private" : "disabled",
    demoWrite,
    liveWrite: liveReady,
    unlocked,
    singleUser: SINGLE_USER_MODE,
    couponClaim,
    orderCreate,
    autoRepurchase,
    order: orderCreate,
    autoCancelUnpaid: demoWrite || (liveReady && ENABLE_AUTO_CANCEL_UNPAID),
    maxOrderCents: MAX_ORDER_CENTS,
    maxDailyOrders: MAX_DAILY_ORDERS,
    writePasscodeRequired: liveReady && !unlocked,
    nutrition: true,
  };
}

function requireWrite(req, feature) {
  if (!liveClient) {
    if (!DEMO_WRITE) {
      throw new ActionError("WRITE_DISABLED", "演示执行已关闭，请配置服务端 Token 并使用私有模式", 403);
    }
    return { mode: "demo", live: false };
  }
  if (!ENABLE_WRITE || !SINGLE_USER_MODE) {
    throw new ActionError("WRITE_DISABLED", "实时写操作未开启，请使用单用户私有模式", 403);
  }
  if (!WRITE_PASSCODE) {
    throw new ActionError("WRITE_LOCKED", "未配置私有模式口令，写操作已锁定", 403);
  }
  if (!isUnlocked(req)) {
    throw new ActionError("WRITE_LOCKED", "请先解锁单用户私有模式", 401);
  }
  if (feature === "coupon" && !ENABLE_COUPON_CLAIM) {
    throw new ActionError("FEATURE_DISABLED", "自动领券未开启", 403);
  }
  if ((feature === "order" || feature === "auto") && !ENABLE_ORDER_CREATE) {
    throw new ActionError("FEATURE_DISABLED", "创建订单未开启", 403);
  }
  if (feature === "auto" && !ENABLE_AUTO_REPURCHASE) {
    throw new ActionError("FEATURE_DISABLED", "自动复购未开启", 403);
  }
  return { mode: "live", live: true };
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
function allowRequest(ip, limit = 60, windowMs = 60_000) {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + windowMs });
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

async function runOptimize(input) {
  if (liveClient && liveOptimize) {
    try {
      return await liveOptimize(input, liveClient);
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
  const quote = await createQuote({ result, planId: plan.id, source: result.mode });
  return { ...quote, plan, result };
}

async function runSubscriptionOnce(subscription, { autoCreate }) {
  try {
    const result = await runSubscriptionQuote(subscription);
    let order = null;
    if (autoCreate) {
      const created = await createOrder({
        quoteId: result.quote.id,
        system: true,
        live: Boolean(liveClient),
        mcp: liveClient,
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

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      app: "maimen-save-one",
      name: "麦门省一单",
      version: APP_VERSION,
      mode: liveClient ? "live" : "demo",
      liveState,
      liveError: liveState === "error" ? "实时接口暂不可用" : "",
      writeMode: capabilities(req).writeMode,
      singleUser: SINGLE_USER_MODE,
      liveSource,
      liveStored: storedTokenPresent,
      liveSetup: !LIVE_SETUP_DISABLED,
      uptimeSeconds: Math.round(process.uptime()),
      time: new Date().toISOString(),
    });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/capabilities") {
    sendJson(res, 200, { ok: true, ...capabilities(req) });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/live/status") {
    sendJson(res, 200, { ok: true, ...liveStatus() });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/live/token") {
    if (LIVE_SETUP_DISABLED) {
      throw new ActionError(
        "SETUP_DISABLED",
        "当前部署已关闭页面接入，请用环境变量 MCD_MCP_TOKEN 配置",
        403,
      );
    }
    if (!sameOrigin(req)) throw new ActionError("CROSS_ORIGIN", "只接受站内请求", 403);
    if (!allowRequest(clientIp(req), 5, 60_000)) {
      sendJson(res, 429, {
        ok: false,
        code: "RATE_LIMITED",
        error: "校验太频繁，请 1 分钟后再试",
        ...liveStatus(),
      });
      return true;
    }
    const body = await bodyOr400(req, res);
    if (!body) return true;
    const checked = normalizeToken(body.token);
    if (!checked.ok) {
      sendJson(res, 400, { ok: false, code: checked.code, error: checked.message, ...liveStatus() });
      return true;
    }
    try {
      const client = await verifyToken(checked.token);
      activateLiveClient(client, "stored");
      await saveStoredToken(checked.token);
      storedTokenPresent = true;
      sendJson(res, 200, { ok: true, ...liveStatus(), capabilities: capabilities(req) });
    } catch (error) {
      const classified = classifyConnectError(error);
      liveLastError = classified;
      liveCheckedAt = new Date().toISOString();
      if (!liveClient) liveState = "error";
      console.error("[maimen-save-one] live token rejected:", classified.code);
      sendJson(res, 502, {
        ok: false,
        code: classified.code,
        error: classified.message,
        ...liveStatus(),
      });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/live/disconnect") {
    if (LIVE_SETUP_DISABLED) {
      throw new ActionError("SETUP_DISABLED", "当前部署已关闭页面接入", 403);
    }
    if (!sameOrigin(req)) throw new ActionError("CROSS_ORIGIN", "只接受站内请求", 403);
    const envManaged = Boolean(MCD_MCP_TOKEN);
    await clearStoredToken().catch(() => {});
    storedTokenPresent = false;
    const previous = liveClient;
    liveClient = null;
    liveOptimize = null;
    readToolTrace = () => [];
    liveState = envManaged && ENABLE_LIVE ? "no-token" : "disabled";
    liveSource = "none";
    liveLastError = null;
    liveCheckedAt = null;
    if (previous) Promise.resolve(previous.close()).catch(() => {});
    sendJson(res, 200, {
      ok: true,
      note: envManaged ? "环境变量中的 Token 会在服务重启后重新连接" : "",
      ...liveStatus(),
    });
    return true;
  }

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

  if (req.method === "GET" && pathname === "/api/bootstrap") {
    sendJson(res, 200, {
      ok: true,
      app: "maimen-save-one",
      version: APP_VERSION,
      mode: liveClient ? "live" : "demo",
      liveState,
      defaults: DEMO_DEFAULTS,
      stores: DEMO_STORES,
      pointsBalance: DEMO_POINTS,
      counts: {
        items: DEMO_ITEMS.length,
        combos: DEMO_COMBOS.length,
        coupons: DEMO_COUPONS.length,
      },
      capabilities: capabilities(req),
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
      const result = await runOptimize(input);
      const caps = capabilities(req);
      result.deployment = {
        mode: result.mode,
        liveState,
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
    const result = await runOptimize(input);
    const quote = await createQuote({
      result,
      planId: body.planId,
      source: result.mode,
    });
    sendJson(res, 200, {
      ok: true,
      ...quote,
      source: result.mode,
      capabilities: capabilities(req),
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/coupons/claim") {
    const access = requireWrite(req, "coupon");
    const body = await bodyOr400(req, res);
    if (!body) return true;
    const result = await claimCoupon({
      quoteId: body.quoteId,
      token: body.token,
      live: access.live,
      mcp: liveClient,
    });
    sendJson(res, 200, { ok: true, ...result, capabilities: capabilities(req) });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/orders") {
    sendJson(res, 200, { ok: true, orders: await listOrders() });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/orders") {
    const access = requireWrite(req, "order");
    const body = await bodyOr400(req, res);
    if (!body) return true;
    const result = await createOrder({
      quoteId: body.quoteId,
      token: body.token,
      live: access.live,
      mcp: liveClient,
      caps: {
        maxAmountCents: MAX_ORDER_CENTS,
        maxDailyOrders: MAX_DAILY_ORDERS,
      },
    });
    sendJson(res, 200, { ok: true, ...result, capabilities: capabilities(req) });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/orders/reconcile") {
    const access = requireWrite(req, "order");
    const autoCancel =
      access.mode === "demo" ? true : ENABLE_AUTO_CANCEL_UNPAID;
    const result = await reconcileOrders({
      live: access.live,
      mcp: liveClient,
      autoCancel,
    });
    sendJson(res, 200, { ok: true, ...result, capabilities: capabilities(req) });
    return true;
  }

  let match = pathname.match(/^\/api\/orders\/([^/]+)\/mock-pay$/);
  if (req.method === "POST" && match) {
    if (liveClient) {
      throw new ActionError("MOCK_PAY_FORBIDDEN", "实时模式不允许模拟支付", 403);
    }
    requireWrite(req, "order");
    const result = await mockPay(decodeURIComponent(match[1]));
    sendJson(res, 200, { ok: true, ...result });
    return true;
  }

  match = pathname.match(/^\/api\/orders\/([^/]+)\/cancel$/);
  if (req.method === "POST" && match) {
    const access = requireWrite(req, "order");
    const result = await cancelOrder(decodeURIComponent(match[1]), {
      live: access.live,
      mcp: liveClient,
    });
    sendJson(res, 200, { ok: true, ...result, capabilities: capabilities(req) });
    return true;
  }

  match = pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (req.method === "GET" && match) {
    const result = await refreshOrder(decodeURIComponent(match[1]), {
      live: Boolean(liveClient),
      mcp: liveClient,
    });
    sendJson(res, 200, { ok: true, ...result });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/reminders") {
    sendJson(res, 200, { ok: true, reminders: await listReminders() });
    return true;
  }

  match = pathname.match(/^\/api\/reminders\/([^/]+)\/read$/);
  if (req.method === "POST" && match) {
    const reminder = await markReminderRead(decodeURIComponent(match[1]));
    sendJson(res, 200, { ok: true, reminder });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/account") {
    let account = null;
    let source = "demo";
    const warnings = [];
    if (liveClient) {
      try {
        account = await liveClient.accountData();
        source = "live";
        warnings.push(...(account.warnings || []));
      } catch (error) {
        warnings.push("实时账户暂不可用，已展示演示权益");
      }
    }
    if (!account) {
      account = await getAccountData();
      source = "demo";
    }
    await syncCouponReminders(account.coupons || []);
    sendJson(res, 200, { ok: true, source, account, warnings });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/subscriptions") {
    sendJson(res, 200, { ok: true, subscriptions: await listSubscriptions() });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/subscriptions") {
    requireWrite(req, "order");
    const body = await bodyOr400(req, res);
    if (!body) return true;
    if (body.autoOrder && !capabilities(req).autoRepurchase) {
      throw new ActionError("FEATURE_DISABLED", "自动复购未开启，请先配置单用户私有模式", 403);
    }
    const subscription = await createSubscription({
      quoteId: body.quoteId,
      maxAmountCents: body.maxAmountCents,
      maxRunsPerDay: body.maxRunsPerDay,
      intervalMinutes: body.intervalMinutes,
      autoOrder: Boolean(body.autoOrder),
    });
    sendJson(res, 200, { ok: true, subscription, capabilities: capabilities(req) });
    return true;
  }

  match = pathname.match(/^\/api\/subscriptions\/([^/]+)\/toggle$/);
  if (req.method === "POST" && match) {
    const id = decodeURIComponent(match[1]);
    const subscriptions = await listSubscriptions();
    const subscription = subscriptions.find((item) => item.id === id);
    if (!subscription) throw new ActionError("SUBSCRIPTION_NOT_FOUND", "固定套餐不存在", 404);
    requireWrite(req, "order");
    const body = await bodyOr400(req, res);
    if (!body) return true;
    if (body.enabled && subscription.autoOrder) requireWrite(req, "auto");
    const updated = await toggleSubscription(id, Boolean(body.enabled));
    sendJson(res, 200, { ok: true, subscription: updated, capabilities: capabilities(req) });
    return true;
  }

  match = pathname.match(/^\/api\/subscriptions\/([^/]+)\/run$/);
  if (req.method === "POST" && match) {
    const id = decodeURIComponent(match[1]);
    requireWrite(req, "order");
    const body = await bodyOr400(req, res);
    if (!body) return true;
    const subscriptions = await listSubscriptions();
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
      capabilities: capabilities(req),
    });
    return true;
  }

  match = pathname.match(/^\/api\/subscriptions\/([^/]+)$/);
  if (req.method === "DELETE" && match) {
    requireWrite(req, "order");
    const result = await deleteSubscription(decodeURIComponent(match[1]));
    sendJson(res, 200, { ok: true, ...result });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/audit") {
    sendJson(res, 200, { ok: true, audit: await listAudit() });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/version") {
    sendJson(res, 200, { ok: true, version: APP_VERSION, mode: liveClient ? "live" : "demo" });
    return true;
  }

  return false;
}

let schedulerBusy = false;
async function processSubscriptions() {
  if (schedulerBusy) return;
  if (!liveClient && !DEMO_WRITE) return;
  if (liveClient && !(ENABLE_WRITE && SINGLE_USER_MODE && ENABLE_AUTO_REPURCHASE)) {
    return;
  }
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
  console.log(`[maimen-save-one] listening on http://${HOST}:${PORT} mode=${liveClient ? "live" : "demo"}`);
  initLive().then(async () => {
    console.log(`[maimen-save-one] live state: ${liveState}`);
    try {
      if (liveClient) {
        const account = await liveClient.accountData();
        await syncCouponReminders(account.coupons || []);
      } else {
        const account = await getAccountData();
        await syncCouponReminders(account.coupons || []);
      }
    } catch (error) {
      console.error("[maimen-save-one] reminder init failed:", error);
    }
    setInterval(processSubscriptions, SUBSCRIPTION_TICK_MS).unref();
  });
});

async function shutdown(signal) {
  console.log(`[maimen-save-one] shutting down (${signal})`);
  server.close();
  if (liveClient) {
    try {
      await liveClient.close();
    } catch {
      // ignore
    }
  }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
