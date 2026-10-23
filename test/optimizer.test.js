import test from "node:test";
import assert from "node:assert/strict";
import { optimize } from "../lib/optimizer.js";

const base = { budgetCents: 3000, goal: "save", people: 1, mode: "pickup" };

test("returns three complete meal plans within budget", () => {
  const result = optimize(base);
  assert.equal(result.ok, true);
  assert.equal(result.plans.length, 3);
  for (const plan of result.plans) {
    assert.equal(plan.completeMeal, true);
    assert.ok(plan.price.finalCents <= base.budgetCents);
    assert.ok(plan.items.length >= 1);
    assert.equal(
      plan.price.finalCents,
      Math.max(
        0,
        plan.price.baseCents +
          plan.price.feesCents -
          plan.price.couponDiscountCents -
          plan.price.pointsDiscountCents,
      ),
    );
  }
});

test("delivery includes delivery and packaging fees", () => {
  const result = optimize({ ...base, mode: "delivery", budgetCents: 4000 });
  assert.equal(result.store.mode, "delivery");
  assert.ok(result.store.deliveryFeeCents > 0);
  assert.ok(result.plans.every((plan) => plan.price.feesCents > 0));
});

test("group plans expose per-person price", () => {
  const result = optimize({ ...base, people: 2, budgetCents: 8000 });
  for (const plan of result.plans) {
    assert.equal(plan.people, 2);
    assert.equal(plan.price.perPersonCents, Math.round(plan.price.finalCents / 2));
  }
});

test("avoid tags remove beef and spicy items", () => {
  const result = optimize({ ...base, avoidTags: ["beef", "spicy"] });
  const text = JSON.stringify(result.plans.map((plan) => plan.items.map((item) => item.name)));
  assert.ok(!text.includes("巨无霸"));
  assert.ok(!text.includes("麦辣"));
  assert.ok(!text.includes("双层吉士"));
});

test("low budget still returns a within-budget plan", () => {
  const result = optimize({ ...base, budgetCents: 1500 });
  assert.equal(result.summary.withinBudget, true);
  assert.ok(result.plans.every((plan) => plan.price.finalCents <= 1500));
});

test("impossible restrictions fail clearly", () => {
  assert.throws(
    () => optimize({ ...base, avoidTags: ["beef", "chicken", "fish"] }),
    /没有可搭配的主食/,
  );
});

test("trap detection is surfaced", () => {
  const result = optimize(base);
  assert.ok(result.summary.trapCount >= 1);
  assert.ok(result.plans.some((plan) => plan.trapCount >= 1));
});

test("one-plus-one mix is used for cheap plans", () => {
  const result = optimize({ ...base, budgetCents: 1800 });
  assert.ok(result.plans.some((plan) => plan.items.some((item) => item.id === "mix11")));
});

test("points can be disabled", () => {
  const withPoints = optimize(base);
  const withoutPoints = optimize({ ...base, usePoints: false });
  assert.ok(
    withoutPoints.plans[0].price.finalCents >= withPoints.plans[0].price.finalCents,
  );
  assert.ok(withoutPoints.plans.every((plan) => plan.price.pointsDiscountCents === 0));
});
