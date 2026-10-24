import test from "node:test";
import assert from "node:assert/strict";
import { writeDecision, buildCapabilities } from "../lib/access.js";

const OWN = {
  uid: "u_" + "a".repeat(32),
  mode: "own",
  client: { id: "client" },
  binding: { consent: { granted: true } },
  identity: { nickname: "阿麦" },
};
const HOST = { uid: "u_" + "b".repeat(32), mode: "host", client: null, binding: null };
const NONE = { uid: "u_" + "c".repeat(32), mode: "none", client: null, binding: null };

const FLAGS = {
  demoWrite: true,
  enableWrite: true,
  enableCouponClaim: true,
  enableOrderCreate: true,
  enableAutoRepurchase: false,
  enableAutoCancelUnpaid: true,
  singleUser: true,
  maxOrderCents: 5000,
  maxDailyOrders: 5,
};

test("host mode is always blocked with OWN_TOKEN_REQUIRED", () => {
  for (const feature of ["order", "coupon", "auto"]) {
    assert.throws(
      () => writeDecision(HOST, feature, FLAGS),
      (error) => error.code === "OWN_TOKEN_REQUIRED" && error.status === 403,
    );
  }
  // 即使演示写与所有开关都开着，也不能借共享账号写
  assert.throws(() => writeDecision(HOST, "order", { ...FLAGS, demoWrite: true }));
});

test("own mode writes only with the user's own client", () => {
  const ok = writeDecision(OWN, "order", FLAGS);
  assert.equal(ok.mode, "own");
  assert.equal(ok.client, OWN.client);
  assert.equal(ok.owner, OWN.uid);

  const withoutClient = { ...OWN, client: null };
  assert.throws(
    () => writeDecision(withoutClient, "order", FLAGS),
    (error) => error.code === "OWN_TOKEN_REQUIRED",
  );
});

test("own mode still requires recorded consent", () => {
  assert.throws(
    () => writeDecision({ ...OWN, binding: { consent: { granted: false } } }, "order", FLAGS),
    (error) => error.code === "CONSENT_REQUIRED",
  );
});

test("own mode respects feature switches", () => {
  assert.throws(
    () => writeDecision(OWN, "order", { ...FLAGS, enableOrderCreate: false }),
    (error) => error.code === "FEATURE_DISABLED",
  );
  assert.throws(
    () => writeDecision(OWN, "coupon", { ...FLAGS, enableCouponClaim: false }),
    (error) => error.code === "FEATURE_DISABLED",
  );
  assert.throws(
    () => writeDecision(OWN, "auto", FLAGS),
    (error) => error.code === "FEATURE_DISABLED",
  );
  assert.equal(writeDecision(OWN, "auto", { ...FLAGS, enableAutoRepurchase: true }).mode, "own");
});

test("demo mode allows simulated writes but can be switched off", () => {
  const ok = writeDecision(NONE, "order", FLAGS);
  assert.equal(ok.mode, "demo");
  assert.equal(ok.live, false);
  assert.throws(
    () => writeDecision(NONE, "order", { ...FLAGS, demoWrite: false }),
    (error) => error.code === "WRITE_DISABLED",
  );
});

test("capabilities describe the mode honestly", () => {
  const host = buildCapabilities(HOST, FLAGS);
  assert.equal(host.access, "host");
  assert.equal(host.needsOwnToken, true);
  assert.equal(host.orderCreate, false);
  assert.equal(host.writeMode, "disabled");

  const own = buildCapabilities(OWN, FLAGS);
  assert.equal(own.access, "own");
  assert.equal(own.needsOwnToken, false);
  assert.equal(own.orderCreate, true);
  assert.equal(own.writeMode, "private");
  assert.equal(own.identity.nickname, "阿麦");

  const demo = buildCapabilities(NONE, FLAGS);
  assert.equal(demo.access, "none");
  assert.equal(demo.writeMode, "demo");
  assert.equal(demo.orderCreate, true);
});
