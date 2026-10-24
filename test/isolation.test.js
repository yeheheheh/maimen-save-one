import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { rm } from "node:fs/promises";

const dir = path.join(os.tmpdir(), `maimen-iso-${Date.now()}`);
process.env.RUNTIME_DATA_FILE = path.join(dir, "runtime.json");
process.env.USER_DATA_DIR = path.join(dir, "users");

const svc = await import("../lib/action-service.js");
const { optimize } = await import("../lib/optimizer.js");
const { DEMO_DATA } = await import("../lib/demo-data.js");

const input = { budgetCents: 3000, goal: "save", people: 1, mode: "pickup", storeId: "p2", avoidTags: [], usePoints: true };
const result = optimize(input, DEMO_DATA);
const planId = result.recommendedId || result.plans[0].id;

test.after(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function quoteFor(owner) {
  return svc.createQuote({ result, planId, source: "demo", owner });
}

test("a quote cannot be read or ordered by another user", async () => {
  const alice = "u_" + "a".repeat(32);
  const bob = "u_" + "b".repeat(32);
  const { quote, tokens } = await quoteFor(alice);

  await assert.rejects(() => svc.getQuote(quote.id, bob), /另一个浏览器身份/);
  await assert.rejects(
    () => svc.createOrder({ quoteId: quote.id, token: tokens.order, owner: bob }),
    /另一个浏览器身份/,
  );
  await assert.rejects(
    () => svc.claimCoupon({ quoteId: quote.id, token: tokens.claim, owner: bob }),
    /另一个浏览器身份/,
  );

  const owned = await svc.getQuote(quote.id, alice);
  assert.equal(owned.id, quote.id);
});

test("order lists and daily limits are per user", async () => {
  const alice = "u_" + "c".repeat(32);
  const bob = "u_" + "d".repeat(32);
  const { quote, tokens } = await quoteFor(alice);
  const created = await svc.createOrder({
    quoteId: quote.id,
    token: tokens.order,
    owner: alice,
    caps: { maxAmountCents: 50000, maxDailyOrders: 1 },
  });
  assert.equal(created.order.owner, alice);

  assert.equal((await svc.listOrders(alice)).length, 1);
  assert.equal((await svc.listOrders(bob)).length, 0);

  // 甲的 1 单上限不应影响乙
  const bobQuote = await quoteFor(bob);
  const bobOrder = await svc.createOrder({
    quoteId: bobQuote.quote.id,
    token: bobQuote.tokens.order,
    owner: bob,
    caps: { maxAmountCents: 50000, maxDailyOrders: 1 },
  });
  assert.equal(bobOrder.order.owner, bob);

  // 甲再下单会撞到自己的上限
  const again = await quoteFor(alice);
  await assert.rejects(
    () =>
      svc.createOrder({
        quoteId: again.quote.id,
        token: again.tokens.order,
        owner: alice,
        caps: { maxAmountCents: 50000, maxDailyOrders: 1 },
      }),
    /上限/,
  );
});

test("refresh, cancel and mock pay are owner-scoped", async () => {
  const alice = "u_" + "e".repeat(32);
  const bob = "u_" + "f".repeat(32);
  const { quote, tokens } = await quoteFor(alice);
  const { order } = await svc.createOrder({
    quoteId: quote.id,
    token: tokens.order,
    owner: alice,
    caps: { maxAmountCents: 50000, maxDailyOrders: 5 },
  });

  await assert.rejects(() => svc.refreshOrder(order.id, { owner: bob }), /另一个浏览器身份/);
  await assert.rejects(() => svc.cancelOrder(order.id, { owner: bob }), /另一个浏览器身份/);
  await assert.rejects(() => svc.mockPay(order.id, { owner: bob }), /另一个浏览器身份/);

  const paid = await svc.mockPay(order.id, { owner: alice });
  assert.equal(paid.order.status, "paid");
});

test("reconcile never touches another user's pending orders", async () => {
  const alice = "u_" + "1".repeat(32);
  const bob = "u_" + "2".repeat(32);

  const a1 = await quoteFor(alice);
  const a2 = await quoteFor(alice);
  const created1 = await svc.createOrder({
    quoteId: a1.quote.id,
    token: a1.tokens.order,
    owner: alice,
    caps: { maxAmountCents: 50000, maxDailyOrders: 9 },
  });
  const created2 = await svc.createOrder({
    quoteId: a2.quote.id,
    token: a2.tokens.order,
    owner: alice,
    caps: { maxAmountCents: 50000, maxDailyOrders: 9 },
  });

  const b1 = await quoteFor(bob);
  const bobOrder = await svc.createOrder({
    quoteId: b1.quote.id,
    token: b1.tokens.order,
    owner: bob,
    caps: { maxAmountCents: 50000, maxDailyOrders: 9 },
  });

  const report = await svc.reconcileOrders({ owner: alice, autoCancel: true });
  assert.ok(report.cancelled >= 1);

  const bobOrders = await svc.listOrders(bob);
  const kept = bobOrders.find((order) => order.id === bobOrder.order.id);
  assert.equal(kept.status, "pending_payment");

  const aliceOrders = await svc.listOrders(alice);
  const statuses = aliceOrders
    .filter((order) => order.id === created1.order.id || order.id === created2.order.id)
    .map((order) => order.status);
  assert.deepEqual(statuses.sort(), ["cancelled", "pending_payment"]);
});

test("reminders and coupon wallets are per user", async () => {
  const alice = "u_" + "3".repeat(32);
  const bob = "u_" + "4".repeat(32);
  const { quote, tokens } = await quoteFor(alice);

  const aliceReminders = await svc.listReminders(alice);
  const bobReminders = await svc.listReminders(bob);
  assert.ok(aliceReminders.length >= 1);
  assert.equal(bobReminders.length, 0);

  const reminder = aliceReminders[0];
  await assert.rejects(() => svc.markReminderRead(reminder.id, bob), /另一个浏览器身份/);
  const read = await svc.markReminderRead(reminder.id, alice);
  assert.equal(read.read, true);

  if (quote.plan.coupon) {
    await svc.claimCoupon({ quoteId: quote.id, token: tokens.claim, owner: alice });
    const aliceAccount = await svc.getAccountData(null, alice);
    const bobAccount = await svc.getAccountData(null, bob);
    assert.ok(aliceAccount.claimedCoupons.length >= 1);
    assert.equal(bobAccount.claimedCoupons.length, 0);
  }
});

test("subscriptions are owner-scoped", async () => {
  const alice = "u_" + "5".repeat(32);
  const bob = "u_" + "6".repeat(32);
  const { quote } = await quoteFor(alice);
  const sub = await svc.createSubscription({
    quoteId: quote.id,
    maxAmountCents: 3000,
    maxRunsPerDay: 1,
    intervalMinutes: 1440,
    owner: alice,
  });
  assert.equal(sub.owner, alice);
  assert.equal((await svc.listSubscriptions(alice)).length, 1);
  assert.equal((await svc.listSubscriptions(bob)).length, 1 - 1);

  await assert.rejects(() => svc.toggleSubscription(sub.id, false, bob), /另一个浏览器身份/);
  await assert.rejects(() => svc.deleteSubscription(sub.id, bob), /另一个浏览器身份/);
  const toggled = await svc.toggleSubscription(sub.id, true, alice);
  assert.equal(toggled.enabled, true);
});

test("legacy records without an owner stay invisible to real users", async () => {
  const legacy = await svc.createQuote({ result, planId, source: "demo" });
  const alice = "u_" + "7".repeat(32);
  await assert.rejects(() => svc.getQuote(legacy.quote.id, alice), /报价不存在/);
  const admin = await svc.getQuote(legacy.quote.id);
  assert.equal(admin.id, legacy.quote.id);
});
