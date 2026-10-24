import { readFile, writeFile, rename, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE =
  process.env.LIVE_TOKEN_FILE || path.join(__dirname, "..", "data", "live-token.json");

// Token 是 opaque 字符串（可能是 JWT 或 base64），只做形状校验，不解析内容。
const TOKEN_MIN = 8;
const TOKEN_MAX = 512;
const TOKEN_SHAPE = /^[A-Za-z0-9._~+/=-]+$/;

export function normalizeToken(raw) {
  if (typeof raw !== "string") {
    return { ok: false, code: "TOKEN_MISSING", message: "请粘贴 MCP Token" };
  }
  const token = raw.trim();
  if (!token) {
    return { ok: false, code: "TOKEN_MISSING", message: "请粘贴 MCP Token" };
  }
  if (token.length < TOKEN_MIN) {
    return { ok: false, code: "TOKEN_TOO_SHORT", message: "Token 太短，请确认已复制完整" };
  }
  if (token.length > TOKEN_MAX) {
    return { ok: false, code: "TOKEN_TOO_LONG", message: "Token 超过 512 个字符，请只粘贴 Token 本身" };
  }
  if (/\s/.test(token)) {
    return { ok: false, code: "TOKEN_FORMAT", message: "Token 中间不能有空格或换行" };
  }
  if (!TOKEN_SHAPE.test(token)) {
    return { ok: false, code: "TOKEN_FORMAT", message: "Token 含有不支持的字符，请只粘贴字符串本身" };
  }
  return { ok: true, token };
}

export function classifyConnectError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  const lower = message.toLowerCase();
  const status = error && typeof error === "object" ? String(error.code || error.status || "") : "";
  // MCP 对失效 Token 返回 401，正文是「当前鉴权码不存在或已失效」，两种信号都要认。
  if (
    status === "401" ||
    status === "403" ||
    /鉴权码|鉴权失败|unauthorized|forbidden|invalid[_\s-]?token|invalid api key|401|403/.test(lower)
  ) {
    return { code: "INVALID_TOKEN", message: "Token 校验未通过（401），请确认已复制完整且未过期" };
  }
  if (/超时|timeout|timed out|etimedout/.test(lower)) {
    return { code: "TIMEOUT", message: "连接 MCP 超时，请检查服务端网络后重试" };
  }
  if (/enotfound|econnrefused|econnreset|fetch failed|network|socket/.test(lower)) {
    return { code: "NETWORK", message: "服务端无法访问 mcp.mcd.cn，请检查网络或代理" };
  }
  return { code: "CONNECT_FAILED", message: "连接 MCP 失败，请稍后重试" };
}

export async function loadStoredToken() {
  try {
    const raw = await readFile(TOKEN_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const checked = normalizeToken(parsed?.token);
    if (!checked.ok) return null;
    return { token: checked.token, savedAt: parsed.savedAt || null };
  } catch {
    return null;
  }
}

export async function saveStoredToken(token) {
  const checked = normalizeToken(token);
  if (!checked.ok) throw new Error(checked.message);
  await mkdir(path.dirname(TOKEN_FILE), { recursive: true });
  const temp = `${TOKEN_FILE}.${process.pid}.tmp`;
  const payload = JSON.stringify({ token: checked.token, savedAt: new Date().toISOString() }, null, 2);
  await writeFile(temp, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temp, TOKEN_FILE);
}

export async function clearStoredToken() {
  await rm(TOKEN_FILE, { force: true });
}

export function getTokenFile() {
  return TOKEN_FILE;
}
