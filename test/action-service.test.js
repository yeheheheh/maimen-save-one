import test, { after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { rm } from "node:fs/promises";
import { optimize } from "../lib/optimizer.js";

const dataFile = path.join(os.tmpdir(), `maimen-action-${Date.now()}.json`);
process.env.RUNTIME_DATA_FILE = dataFile;

const action = await import("../lib/action-service.js");

after(async () => {
  await rm(dataFile, { force: true });
});

const input = { budgetCents: 3000, goal: "save", people: 1, mode: "pickup" };
const result = optimize(input);

async function freshQuote() {
  return action.createQuote({
    result: optimize(input),
    planId: result.plans[0].id,
    source: "demo",
  });
}

test("quote -> claim -> order -> pay flow", async () => {
  const { quote, tokens } = await freshQuote();
  assert.equal(quote.status, "quoted");
  assert.ok(quote.plan.coupon);

  const claimed = await action.claimCoupon({
    quoteId: quote.id,
    token: tokens.claim,
    live: false,
  });
  assert.equal(claimed.quote.couponClaimed, true);

  const created = await action.createOrder({
    quoteId: quote.id,
    token: tokens.order,
    live: false,
    caps: { maxAmountCents: 5000, maxDailyOrders: 20 },
  });
  assert.equal(created.order.status, "pending_payment");
  assert.equal(created.order.demo, true);

  const paid = await action.mockPay(created.order.id);
  assert.equal(paid.order.status, "paid");
});

test("invalid confirmation token is rejected", async () => {
  const { quote } = await freshQuote();
  await assert.rejects(
    () => action.claimCoupon({ quoteId: quote.id, token: "bad.token", live: false }),
    /确认令牌/,
  );
});

test("amount cap blocks order creation", async () => {
  const { quote, tokens } = await freshQuote();
  await assert.rejects(
    () =>
      action.createOrder({
        quoteId: quote.id,
        token: tokens.order,
        live: false,
        caps: { maxAmountCents: 1, maxDailyOrders: 20 },
      }),
    /超过上限/,
  );
});

test("duplicate unpaid orders are reconciled", async () => {
  const a = await freshQuote();
  const b = await freshQuote();
  const first = await action.createOrder({
    quoteId: a.quote.id,
    token: a.tokens.order,
    live: false,
    caps: { maxAmountCents: 5000, maxDailyOrders: 20 },
  });
  const second = await action.createOrder({
    quoteId: b.quote.id,
    token: b.tokens.order,
    live: false,
    caps: { maxAmountCents: 5000, maxDailyOrders: 20 },
  });
  const reconciled = await action.reconcileOrders({ live: false, autoCancel: true });
  assert.ok(reconciled.duplicates >= 1);
  assert.ok(reconciled.cancelled >= 1);
  const orders = await action.listOrders();
  const firstOrder = orders.find((order) => order.id === first.order.id);
  const secondOrder = orders.find((order) => order.id === second.order.id);
  assert.ok(firstOrder);
  assert.ok(secondOrder);
  assert.ok([firstOrder.status, secondOrder.status].includes("cancelled"));
});

test("fixed plan caps and kill switch", async () => {
  const { quote } = await freshQuote();
  const subscription = await action.createSubscription({
    quoteId: quote.id,
    maxAmountCents: 3000,
    maxRunsPerDay: 1,
    intervalMinutes: 60,
    autoOrder: true,
  });
  assert.equal(subscription.enabled, false);
  const enabled = await action.toggleSubscription(subscription.id, true);
  assert.equal(enabled.enabled, true);
  assert.ok(enabled.nextRunAt);
  const due = await action.dueSubscriptions(Date.parse(enabled.nextRunAt) + 1);
  assert.ok(due.some((item) => item.id === subscription.id));
  await action.markSubscriptionRun(subscription.id, {
    quoteId: quote.id,
    orderId: null,
    success: true,
  });
  const subscriptions = await action.listSubscriptions();
  const updated = subscriptions.find((item) => item.id === subscription.id);
  assert.equal(updated.enabled, false);
  assert.equal(updated.runs.length, 1);
});
