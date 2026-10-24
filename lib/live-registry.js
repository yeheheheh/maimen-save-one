import { getUser, saveUser, deleteUser, publicBinding, normalizeIdentity, CONSENT_VERSION } from "./user-store.js";
import { classifyConnectError, normalizeToken } from "./live-config.js";

const CONNECT_TIMEOUT_MS = Math.max(3000, Number(process.env.LIVE_CONNECT_TIMEOUT_MS || 12000));
const MAX_USER_CLIENTS = Math.max(4, Number(process.env.MAX_USER_CLIENTS || 64));

function withDeadline(promise, ms, label = "连接") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}超时`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function tailOf(token) {
  return String(token || "").slice(-4);
}

/**
 * 每个用户一份 MCP 连接，互不复用。
 * host 连接只用于「我方 MCP 的只读体验」，永远不会用于任何用户的下单。
 */
export class LiveRegistry {
  constructor({ hostToken = "", loader = null } = {}) {
    this.hostToken = hostToken;
    this.loader = loader;
    this.host = { client: null, state: "disabled", lastError: null, checkedAt: null, trace: () => [] };
    this.users = new Map();
    this.module = null;
  }

  async loadModule() {
    if (!this.module) {
      this.module = this.loader ? await this.loader() : await import("./mcp-live.js");
    }
    return this.module;
  }

  async connect(token) {
    const module = await this.loadModule();
    const client = await withDeadline(module.createLiveClient(token), CONNECT_TIMEOUT_MS);
    return client;
  }

  async initHost() {
    if (!this.hostToken) {
      this.host.state = "disabled";
      return this.host;
    }
    try {
      const client = await this.connect(this.hostToken);
      this.host = {
        client,
        state: "connected",
        lastError: null,
        checkedAt: new Date().toISOString(),
        trace: typeof client.trace === "function" ? client.trace : () => [],
      };
    } catch (error) {
      this.host = {
        client: null,
        state: "error",
        lastError: classifyConnectError(error),
        checkedAt: new Date().toISOString(),
        trace: () => [],
      };
    }
    return this.host;
  }

  get hostClient() {
    return this.host.client;
  }

  get hostState() {
    return this.host.state;
  }

  trace() {
    try {
      const module = this.module;
      return module && typeof module.getToolTrace === "function" ? module.getToolTrace() : [];
    } catch {
      return [];
    }
  }

  /** 返回该用户当前可用的自有连接，绝不回退到 host 连接。 */
  clientFor(uid) {
    const entry = uid ? this.users.get(uid) : null;
    return entry?.client || null;
  }

  /**
   * 绑定：校验 Token → 读取身份 → 要求显式授权 → 落盘 → 激活连接。
   * 任何一步失败都不会留下可用连接，也不会覆盖已有的绑定。
   */
  async bind(uid, { token, consent }) {
    const checked = normalizeToken(token);
    if (!checked.ok) {
      const error = new Error(checked.message);
      error.code = checked.code;
      error.status = 400;
      throw error;
    }
    if (!consent) {
      const error = new Error("需要先确认授权，才可以用你的账号提交订单");
      error.code = "CONSENT_REQUIRED";
      error.status = 400;
      throw error;
    }
    let client;
    try {
      client = await this.connect(checked.token);
    } catch (error) {
      const classified = classifyConnectError(error);
      const wrapped = new Error(classified.message);
      wrapped.code = classified.code;
      wrapped.status = 502;
      throw wrapped;
    }

    let identity;
    try {
      identity = normalizeIdentity(await withDeadline(client.identity(), CONNECT_TIMEOUT_MS, "读取账号"));
    } catch (error) {
      try {
        await client.close();
      } catch {
        // 关闭失败不影响结论
      }
      const classified = classifyConnectError(error);
      const wrapped = new Error(
        classified.code === "INVALID_TOKEN"
          ? classified.message
          : `已连接但读取账号失败：${classified.message}`,
      );
      wrapped.code = classified.code === "INVALID_TOKEN" ? "INVALID_TOKEN" : "IDENTITY_FAILED";
      wrapped.status = classified.code === "INVALID_TOKEN" ? 502 : 502;
      throw wrapped;
    }

    const record = await saveUser(uid, {
      token: checked.token,
      tokenTail: tailOf(checked.token),
      identity,
      consent: { granted: true, at: new Date().toISOString(), version: CONSENT_VERSION },
      boundAt: new Date().toISOString(),
      status: "active",
    });

    const previous = this.users.get(uid);
    if (previous?.client && previous.client !== client) {
      Promise.resolve(previous.client.close()).catch(() => {});
    }
    this.users.set(uid, {
      client,
      state: "connected",
      lastError: null,
      checkedAt: new Date().toISOString(),
    });
    this.evict();
    return { binding: publicBinding(record), identity };
  }

  /** 服务启动后恢复已绑定用户；失败只标记该用户，不影响其他人。 */
  async restore(uid) {
    const record = await getUser(uid);
    if (!record?.token || record.status !== "active" || !record.consent?.granted) return null;
    try {
      const client = await this.connect(record.token);
      this.users.set(uid, {
        client,
        state: "connected",
        lastError: null,
        checkedAt: new Date().toISOString(),
      });
      return this.users.get(uid);
    } catch (error) {
      const classified = classifyConnectError(error);
      await saveUser(uid, { status: "expired", lastError: classified });
      this.users.set(uid, { client: null, state: "expired", lastError: classified, checkedAt: new Date().toISOString() });
      return null;
    }
  }

  markError(uid, error) {
    const classified = classifyConnectError(error);
    const entry = this.users.get(uid);
    if (entry) {
      entry.lastError = classified;
      entry.checkedAt = new Date().toISOString();
      if (classified.code === "INVALID_TOKEN") {
        entry.state = "expired";
        entry.client = null;
      }
    }
    return classified;
  }

  async unbind(uid) {
    const entry = this.users.get(uid);
    this.users.delete(uid);
    if (entry?.client) {
      Promise.resolve(entry.client.close()).catch(() => {});
    }
    await deleteUser(uid);
  }

  /** 只按最近使用淘汰连接，不删除绑定记录。 */
  evict() {
    while (this.users.size > MAX_USER_CLIENTS) {
      const oldest = this.users.keys().next().value;
      const entry = this.users.get(oldest);
      this.users.delete(oldest);
      if (entry?.client) Promise.resolve(entry.client.close()).catch(() => {});
    }
  }

  async status(uid) {
    const record = await getUser(uid);
    const entry = uid ? this.users.get(uid) : null;
    return {
      hostAvailable: Boolean(this.host.client),
      hostState: this.host.state,
      binding: publicBinding(record),
      session: entry
        ? { state: entry.state, checkedAt: entry.checkedAt, lastError: entry.lastError }
        : { state: record ? "inactive" : "none", checkedAt: null, lastError: record?.lastError || null },
    };
  }
}
