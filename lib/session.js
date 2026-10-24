import crypto from "node:crypto";

export const UID_COOKIE = "ms_uid";
export const UID_TTL_MS = 365 * 24 * 3600_000;

// 匿名设备身份：不收集手机号/邮箱，只给每个浏览器一个不可猜测的 uid。
export function createUserId() {
  return `u_${crypto.randomBytes(16).toString("hex")}`;
}

export function signUid(uid, secret) {
  const mac = crypto.createHmac("sha256", secret).update(`uid:${uid}`).digest("base64url");
  return `${uid}.${mac}`;
}

export function readUid(value, secret) {
  if (typeof value !== "string" || !value.includes(".")) return null;
  const index = value.lastIndexOf(".");
  const uid = value.slice(0, index);
  const mac = value.slice(index + 1);
  if (!/^u_[a-f0-9]{32}$/.test(uid)) return null;
  const expected = crypto.createHmac("sha256", secret).update(`uid:${uid}`).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return uid;
}

export function uidCookie(uid, secret, secure = false) {
  const value = signUid(uid, secret);
  const maxAge = Math.floor(UID_TTL_MS / 1000);
  return `${UID_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function clearUidCookie() {
  return `${UID_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function parseCookies(header = "") {
  const out = {};
  for (const part of String(header).split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}
