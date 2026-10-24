import { mkdir, readFile, writeFile, rename, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_DIR = process.env.USER_DATA_DIR || path.join(__dirname, "..", "data", "users");

export const CONSENT_VERSION = "2026-10-24";

const UID_SHAPE = /^u_[a-f0-9]{32}$/;

export function isValidUid(uid) {
  return typeof uid === "string" && UID_SHAPE.test(uid);
}

function fileFor(uid) {
  if (!isValidUid(uid)) throw new Error("非法用户标识");
  return path.join(USER_DIR, `${uid}.json`);
}

// 只保留可展示的身份字段，任何敏感标识都必须先脱敏再落盘。
export function maskMemberNo(value) {
  const text = String(value || "").replace(/\s+/g, "");
  if (!text) return "";
  if (text.length <= 4) return "*".repeat(text.length);
  return `${text.slice(0, 2)}${"*".repeat(Math.max(2, text.length - 4))}${text.slice(-2)}`;
}

export function maskPhone(value) {
  const text = String(value || "").replace(/\D+/g, "");
  if (text.length < 7) return "";
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

export function normalizeIdentity(raw = {}) {
  const nickname =
    raw.nickname || raw.nickName || raw.userName || raw.name || raw.displayName || "";
  const memberRaw =
    raw.memberNo || raw.memberCode || raw.memberId || raw.cardNo || raw.phone || "";
  return {
    nickname: String(nickname).slice(0, 32),
    memberNo: maskMemberNo(memberRaw),
    level: String(raw.level || raw.memberLevel || raw.grade || "").slice(0, 24),
    masked: true,
    capturedAt: new Date().toISOString(),
  };
}

// 对外脱敏视图：永远不包含 token。
export function publicBinding(record) {
  if (!record) return null;
  return {
    bound: true,
    uid: record.uid,
    tokenTail: record.tokenTail || "",
    identity: record.identity || null,
    consent: {
      granted: Boolean(record.consent?.granted),
      at: record.consent?.at || null,
      version: record.consent?.version || null,
    },
    boundAt: record.boundAt || null,
    updatedAt: record.updatedAt || null,
    status: record.status || "active",
  };
}

export async function getUser(uid) {
  if (!isValidUid(uid)) return null;
  try {
    const raw = await readFile(fileFor(uid), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.uid !== uid) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveUser(uid, patch) {
  const existing = (await getUser(uid)) || { uid, createdAt: new Date().toISOString() };
  const next = {
    ...existing,
    ...patch,
    uid,
    updatedAt: new Date().toISOString(),
  };
  await mkdir(USER_DIR, { recursive: true });
  const target = fileFor(uid);
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temp, target);
  return next;
}

export async function deleteUser(uid) {
  if (!isValidUid(uid)) return false;
  await rm(fileFor(uid), { force: true });
  return true;
}

export async function listUsers() {
  try {
    const names = await readdir(USER_DIR);
    return names.filter((name) => name.endsWith(".json")).map((name) => name.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

export function getUserDir() {
  return USER_DIR;
}
