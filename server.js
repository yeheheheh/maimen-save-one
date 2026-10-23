import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEMO_DATA, DEMO_DEFAULTS, DEMO_POINTS, DEMO_STORES, DEMO_ITEMS, DEMO_COMBOS, DEMO_COUPONS } from "./lib/demo-data.js";
import { optimize } from "./lib/optimizer.js";

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
const APP_VERSION = "1.0.0";
const PORT = Number(process.env.PORT || 8899);
const HOST = process.env.HOST || "127.0.0.1";
const MCD_MCP_TOKEN = (process.env.MCD_MCP_TOKEN || "").trim();
const ENABLE_LIVE = process.env.ENABLE_LIVE === "true";
const ENABLE_ORDER = process.env.ENABLE_ORDER === "true";

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

async function initLive() {
  if (!ENABLE_LIVE) {
    liveState = "disabled";
    return;
  }
  if (!MCD_MCP_TOKEN) {
    liveState = "no-token";
    return;
  }
  try {
    const module = await import("./lib/mcp-live.js");
    liveOptimize = module.optimizeLive;
    liveClient = await module.createLiveClient(MCD_MCP_TOKEN);
    liveState = "connected";
    console.log("[maimen-save-one] live MCP connected");
  } catch (error) {
    liveState = "error";
    liveError = error instanceof Error ? error.message : String(error);
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
      uptimeSeconds: Math.round(process.uptime()),
      time: new Date().toISOString(),
    });
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
      capabilities: {
        live: Boolean(liveClient),
        order: ENABLE_ORDER && Boolean(liveClient),
        nutrition: true,
      },
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
      let result;
      if (liveClient && liveOptimize) {
        try {
          result = await liveOptimize(input, liveClient);
        } catch (error) {
          console.error("[maimen-save-one] live optimize failed:", error instanceof Error ? error.message : error);
          result = optimize(input, DEMO_DATA);
          result.warnings = [
            "实时接口暂不可用，已切换到演示数据；请稍后重试。",
            ...result.warnings,
          ];
          result.liveError = true;
        }
      } else {
        result = optimize(input, DEMO_DATA);
      }
      result.deployment = {
        mode: result.mode,
        liveState,
        orderEnabled: ENABLE_ORDER && Boolean(liveClient),
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

  if (req.method === "GET" && pathname === "/api/version") {
    sendJson(res, 200, { ok: true, version: APP_VERSION, mode: liveClient ? "live" : "demo" });
    return true;
  }

  return false;
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
      console.error("[maimen-save-one] request error:", error);
      sendJson(res, 500, { ok: false, error: "服务器内部错误" });
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
  initLive().then(() => {
    console.log(`[maimen-save-one] live state: ${liveState}`);
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
