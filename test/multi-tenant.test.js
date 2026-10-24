import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { rm } from "node:fs/promises";

const dir = path.join(os.tmpdir(), `maimen-users-${Date.now()}`);
process.env.USER_DATA_DIR = dir;

const session = await import("../lib/session.js");
const store = await import("../lib/user-store.js");
const { LiveRegistry } = await import("../lib/live-registry.js");

const SECRET = "test-secret";

test.after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("uid cookie survives round-trip and rejects tampering", () => {
  const uid = session.createUserId();
  assert.match(uid, /^u_[a-f0-9]{32}$/);
  const signed = session.signUid(uid, SECRET);
  assert.equal(session.readUid(signed, SECRET), uid);
  assert.equal(session.readUid(signed, "other-secret"), null);
  assert.equal(session.readUid(`u_${"a".repeat(32)}.forged`, SECRET), null);
  assert.equal(session.readUid("garbage", SECRET), null);
  assert.equal(session.readUid(undefined, SECRET), null);
});

test("identity is masked before storage", () => {
  const identity = store.normalizeIdentity({ nickname: "麦粉", memberNo: "13800001234", level: "金卡" });
  assert.equal(identity.nickname, "麦粉");
  assert.match(identity.memberNo, /^13\*+34$/);
  assert.equal(store.maskPhone("13800001234"), "138****1234");
  assert.equal(store.maskMemberNo("abc"), "***");
});

test("binding record never exposes the token", async () => {
  const uid = session.createUserId();
  await store.saveUser(uid, {
    token: "super-secret-token-value",
    tokenTail: "alue",
    identity: store.normalizeIdentity({ nickname: "阿麦" }),
    consent: { granted: true, at: new Date().toISOString(), version: store.CONSENT_VERSION },
  });
  const record = await store.getUser(uid);
  assert.equal(record.token, "super-secret-token-value");
  const view = store.publicBinding(record);
  assert.equal(JSON.stringify(view).includes("super-secret-token-value"), false);
  assert.equal(view.tokenTail, "alue");
  assert.equal(view.identity.nickname, "阿麦");
  assert.equal(view.consent.granted, true);
});

test("rejects path traversal style uids", async () => {
  assert.equal(store.isValidUid("../etc/passwd"), false);
  assert.equal(await store.getUser("../etc/passwd"), null);
  await assert.rejects(() => store.saveUser("../x", { token: "a" }), /非法用户标识/);
});

function fakeModule(tokens = {}) {
  return {
    createLiveClient: async (token) => {
      if (tokens[token] === "auth") {
        const error = new Error("当前鉴权码不存在或已失效!");
        error.code = 401;
        throw error;
      }
      if (tokens[token] === "identity") {
        return {
          identity: async () => {
            throw new Error("账号读取权限不足");
          },
          close: async () => {},
        };
      }
      return {
        identity: async () => ({ nickname: "阿麦", memberNo: "13800001234", level: "金卡" }),
        accountData: async () => ({ coupons: [] }),
        close: async () => {},
      };
    },
  };
}

function registryWith(tokens) {
  return new LiveRegistry({ hostToken: "", loader: async () => fakeModule(tokens) });
}

test("bind requires consent before touching the network", async () => {
  const registry = registryWith({});
  const uid = session.createUserId();
  await assert.rejects(() => registry.bind(uid, { token: "tok-1234567890", consent: false }), /授权/);
  assert.equal(registry.clientFor(uid), null);
});

test("bind rejects short tokens and 401 tokens without persisting", async () => {
  const registry = registryWith({ "tok-expired-000": "auth" });
  const uid = session.createUserId();
  await assert.rejects(() => registry.bind(uid, { token: "short", consent: true }), /太短/);
  await assert.rejects(() => registry.bind(uid, { token: "tok-expired-000", consent: true }), /401/);
  assert.equal(await store.getUser(uid), null);
  assert.equal(registry.clientFor(uid), null);
});

test("bind fails cleanly when identity cannot be read", async () => {
  const registry = registryWith({ "tok-noid-000000": "identity" });
  const uid = session.createUserId();
  await assert.rejects(
    () => registry.bind(uid, { token: "tok-noid-000000", consent: true }),
    (error) => error.code === "IDENTITY_FAILED",
  );
  assert.equal(await store.getUser(uid), null);
});

test("bind stores masked identity and gives each user their own client", async () => {
  const registry = registryWith({});
  const a = session.createUserId();
  const b = session.createUserId();
  const resultA = await registry.bind(a, { token: "tok-user-a-000000", consent: true });
  const resultB = await registry.bind(b, { token: "tok-user-b-000000", consent: true });

  assert.equal(resultA.binding.identity.nickname, "阿麦");
  assert.equal(JSON.stringify(resultA.binding).includes("tok-user-a-000000"), false);
  assert.notEqual(registry.clientFor(a), registry.clientFor(b));
  assert.equal((await store.getUser(a)).token, "tok-user-a-000000");
  assert.equal((await store.getUser(b)).token, "tok-user-b-000000");

  const status = await registry.status(a);
  assert.equal(status.binding.tokenTail, "0000");
  assert.equal(status.session.state, "connected");
});

test("unbind removes the record and closes the client", async () => {
  const registry = registryWith({});
  const uid = session.createUserId();
  await registry.bind(uid, { token: "tok-unbind-000000", consent: true });
  let closed = false;
  registry.users.get(uid).client.close = async () => {
    closed = true;
  };
  await registry.unbind(uid);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(registry.clientFor(uid), null);
  assert.equal(await store.getUser(uid), null);
  assert.equal(closed, true);
});

test("restore marks expired bindings instead of throwing", async () => {
  const uid = session.createUserId();
  await store.saveUser(uid, {
    token: "tok-expired-000",
    identity: store.normalizeIdentity({ nickname: "阿麦" }),
    consent: { granted: true, at: new Date().toISOString(), version: store.CONSENT_VERSION },
    status: "active",
  });
  const registry = registryWith({ "tok-expired-000": "auth" });
  const entry = await registry.restore(uid);
  assert.equal(entry, null);
  assert.equal((await store.getUser(uid)).status, "expired");
  assert.equal(registry.clientFor(uid), null);
});
