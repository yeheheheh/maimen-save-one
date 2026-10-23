import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE =
  process.env.RUNTIME_DATA_FILE || path.join(__dirname, "..", "data", "runtime.json");
const MAX_AUDIT = 200;

let state = null;
let queue = Promise.resolve();

function initial() {
  return {
    version: 1,
    secret: randomUUID(),
    quotes: {},
    orders: {},
    subscriptions: {},
    reminders: {},
    audit: [],
    account: {
      claimedCouponIds: [],
      claimedCoupons: [],
    },
  };
}

async function load() {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const base = initial();
    state = {
      ...base,
      ...parsed,
      quotes: parsed.quotes || {},
      orders: parsed.orders || {},
      subscriptions: parsed.subscriptions || {},
      reminders: parsed.reminders || {},
      audit: Array.isArray(parsed.audit) ? parsed.audit.slice(-MAX_AUDIT) : [],
      account: {
        ...base.account,
        ...(parsed.account || {}),
      },
    };
  } catch {
    state = initial();
    await persist();
  }
  return state;
}

async function persist() {
  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  const temp = `${DATA_FILE}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temp, DATA_FILE);
}

export async function getState() {
  if (!state) await load();
  return state;
}

export async function mutate(fn) {
  await getState();
  queue = queue.then(async () => {
    const result = await fn(state);
    state.audit = state.audit.slice(-MAX_AUDIT);
    await persist();
    return result;
  });
  return queue;
}

export function newId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

export function appendAudit(targetState, action, detail = {}) {
  targetState.audit.push({
    id: newId("audit"),
    ts: new Date().toISOString(),
    action,
    ...detail,
  });
  if (targetState.audit.length > MAX_AUDIT) {
    targetState.audit = targetState.audit.slice(-MAX_AUDIT);
  }
}

export function getDataFile() {
  return DATA_FILE;
}
