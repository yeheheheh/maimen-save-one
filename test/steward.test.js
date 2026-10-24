import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStewardView,
  derivePipelineState,
  summarizeOrder,
  summarizeQuote,
} from "../lib/steward.js";

const NOW = Date.parse("2026-10-24T03:00:00.000Z");
const LATER = new Date(NOW + 5 * 60_000).toISOString();
const EARLIER = new Date(NOW - 60_000).toISOString();

function view(overrides = {}) {
  return buildStewardView({ mode: "demo", now: NOW, ...overrides });
}

test("demo without trace shows every pipeline step as demo", () => {
  const result = view();
  assert.equal(result.pipeline.length, 5);
  for (const step of result.pipeline) {
    assert.equal(step.state, "demo");
    assert.equal(step.lastAt, null);
    assert.equal(step.lastMs, 0);
  }
  assert.equal(result.mode, "demo");
});

test("live without trace shows every pipeline step as pending", () => {
  const result = view({ mode: "live" });
  for (const step of result.pipeline) {
    assert.equal(step.state, "pending");
  }
});

test("successful trace marks step done and keeps timing", () => {
  const trace = [{ tool: "calculate-price", ok: true, ms: 812, at: LATER }];
  const result = view({ mode: "live", trace });
  const price = result.pipeline.find((step) => step.id === "price");
  assert.equal(price.state, "done");
  assert.equal(price.lastMs, 812);
  assert.equal(price.lastAt, LATER);
  const stores = result.pipeline.find((step) => step.id === "stores");
  assert.equal(stores.state, "pending");
});

test("failed trace marks step failed", () => {
  const trace = [{ tool: "query-meals", ok: false, ms: 30, at: LATER }];
  const result = derivePipelineState(trace, "query-meals", "live");
  assert.equal(result.state, "failed");
  assert.equal(result.lastMs, 30);
});

test("newest trace entry wins for the same tool", () => {
  const trace = [
    { tool: "query-meals", ok: false, ms: 10, at: EARLIER },
    { tool: "query-meals", ok: true, ms: 40, at: LATER },
  ];
  const result = derivePipelineState(trace, "query-meals", "live");
  assert.equal(result.state, "done");
  assert.equal(result.lastMs, 40);
  assert.equal(result.lastAt, LATER);
});

test("quote summary marks expired and ordered quotes", () => {
  const base = { id: "q_1", plan: { label: "最省", price: { finalCents: 2500 } }, couponClaimed: true };

  const quoted = summarizeQuote({ ...base, expiresAt: LATER, createdAt: EARLIER }, NOW);
  assert.equal(quoted.status, "quoted");
  assert.equal(quoted.finalCents, 2500);
  assert.equal(quoted.couponClaimed, true);
  assert.equal(quoted.expiresAt, LATER);

  const expired = summarizeQuote({ ...base, expiresAt: EARLIER, createdAt: EARLIER }, NOW);
  assert.equal(expired.status, "expired");

  const ordered = summarizeQuote(
    { ...base, status: "ordered", expiresAt: EARLIER, createdAt: EARLIER },
    NOW,
  );
  assert.equal(ordered.status, "ordered");

  const superseded = summarizeQuote(
    { ...base, status: "superseded", expiresAt: LATER, createdAt: EARLIER },
    NOW,
  );
  assert.equal(superseded.status, "expired");

  assert.equal(summarizeQuote(null, NOW), null);
});

test("order summary keeps only display fields", () => {
  const order = summarizeOrder({
    id: "o_1",
    status: "pending_payment",
    amountCents: 2500,
    createdAt: EARLIER,
    payUrl: "https://example.com/pay",
    storeId: "s_1",
  });
  assert.deepEqual(order, {
    id: "o_1",
    status: "pending_payment",
    amountCents: 2500,
    createdAt: EARLIER,
  });
  assert.equal(summarizeOrder(null), null);
});

test("automation gates follow capabilities matrix", () => {
  const demo = view({ mode: "demo", capabilities: { couponClaim: true, autoCancelUnpaid: true } });
  assert.equal(demo.automations.length, 8);
  assert.equal(demo.automations.every((item) => item.gated === false), true);

  const liveLocked = view({
    mode: "live",
    capabilities: { couponClaim: false, autoCancelUnpaid: false, autoRepurchase: false },
  });
  const gatedIds = liveLocked.automations.filter((item) => item.gated).map((item) => item.id);
  assert.deepEqual(gatedIds, ["autoClaim", "autoReconcile", "autoRepurchase"]);
  for (const item of liveLocked.automations.filter((entry) => entry.gated)) {
    assert.ok(item.gateReason.length > 0);
  }

  const liveReady = view({
    mode: "live",
    capabilities: { couponClaim: true, autoCancelUnpaid: true, autoRepurchase: true },
  });
  assert.equal(liveReady.automations.every((item) => item.gated === false), true);
});

test("only autoRepurchase exposes a server run timestamp", () => {
  const result = view({ subscriptionRunAt: LATER });
  const repurchase = result.automations.find((item) => item.id === "autoRepurchase");
  assert.equal(repurchase.lastRunAt, LATER);
  const others = result.automations.filter((item) => item.id !== "autoRepurchase");
  assert.equal(others.every((item) => item.lastRunAt === null), true);
});
