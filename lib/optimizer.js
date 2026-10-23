import { DEMO_DATA, DEMO_DEFAULTS } from "./demo-data.js";

const GOALS = new Set(["save", "full", "protein", "light"]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback, min, max) {
  return clamp(Math.round(number(value, fallback)), min, max);
}

function normalizeInput(input = {}) {
  return {
    budgetCents: integer(input.budgetCents, DEMO_DEFAULTS.budgetCents, 1000, 20000),
    goal: GOALS.has(input.goal) ? input.goal : DEMO_DEFAULTS.goal,
    people: integer(input.people, DEMO_DEFAULTS.people, 1, 6),
    mode: input.mode === "delivery" ? "delivery" : "pickup",
    storeId: typeof input.storeId === "string" ? input.storeId : "",
    caloriesMax: input.caloriesMax ? integer(input.caloriesMax, 0, 200, 3000) : null,
    avoidTags: Array.isArray(input.avoidTags)
      ? [...new Set(input.avoidTags.filter((tag) => typeof tag === "string"))]
      : [],
    usePoints: input.usePoints !== false,
  };
}

function pickStore(stores, opts) {
  const candidates = stores.filter((store) => store.mode === opts.mode);
  return (
    candidates.find((store) => store.id === opts.storeId) ||
    candidates[0] ||
    stores[0]
  );
}

function isAvoided(tags, avoidTags) {
  return avoidTags.some((tag) => tags.includes(tag));
}

function makeCatalog(data) {
  const map = new Map();
  for (const item of data.items) {
    map.set(item.id, { ...item, kind: "item" });
  }
  for (const combo of data.combos) {
    map.set(combo.id, { ...combo, kind: "combo" });
  }
  return map;
}

function addCandidate(list, seen, entries, meta = {}) {
  const normalized = entries
    .filter((entry) => entry.qty > 0)
    .map((entry) => ({ id: entry.id, qty: entry.qty }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (normalized.length === 0) return;
  const key = `${meta.specialId || ""}|${normalized.map((e) => `${e.id}:${e.qty}`).join(",")}`;
  if (seen.has(key)) return;
  seen.add(key);
  list.push({ entries: normalized, ...meta });
}

function generateCandidates(items, combos, mix, opts) {
  const list = [];
  const seen = new Set();
  const mains = items.filter((item) => item.category === "main");
  const sides = items.filter((item) => item.category === "side" || item.category === "snack");
  const drinks = items.filter((item) => item.category === "drink");
  const desserts = items.filter((item) => item.category === "dessert");

  const add = (entries, meta) => addCandidate(list, seen, entries, meta);

  for (const combo of combos) {
    add([{ id: combo.id, qty: 1 }], { kind: "combo" });
    for (const addon of [...sides, ...desserts, ...drinks].slice(0, 16)) {
      add(
        [
          { id: combo.id, qty: 1 },
          { id: addon.id, qty: 1 },
        ],
        { kind: "combo-plus" },
      );
    }
  }

  for (const main of mains) {
    add([{ id: main.id, qty: 1 }], { kind: "single" });
    for (const side of sides) {
      add(
        [
          { id: main.id, qty: 1 },
          { id: side.id, qty: 1 },
        ],
        { kind: "main-side" },
      );
    }
    for (const drink of drinks) {
      add(
        [
          { id: main.id, qty: 1 },
          { id: drink.id, qty: 1 },
        ],
        { kind: "main-drink" },
      );
    }
    for (const side of sides) {
      for (const drink of drinks) {
        add(
          [
            { id: main.id, qty: 1 },
            { id: side.id, qty: 1 },
            { id: drink.id, qty: 1 },
          ],
          { kind: "main-side-drink" },
        );
      }
    }
    for (const side of sides) {
      for (const dessert of desserts) {
        add(
          [
            { id: main.id, qty: 1 },
            { id: side.id, qty: 1 },
            { id: dessert.id, qty: 1 },
          ],
          { kind: "main-side-dessert" },
        );
      }
    }
    for (let i = 0; i < sides.length; i += 1) {
      for (let j = i + 1; j < sides.length; j += 1) {
        add(
          [
            { id: main.id, qty: 1 },
            { id: sides[i].id, qty: 1 },
            { id: sides[j].id, qty: 1 },
          ],
          { kind: "main-two-sides" },
        );
      }
    }
  }

  const mixItems = mix.eligible
    .map((id) => items.find((item) => item.id === id))
    .filter(Boolean);
  for (let i = 0; i < mixItems.length; i += 1) {
    for (let j = i + 1; j < mixItems.length; j += 1) {
      add(
        [
          { id: mixItems[i].id, qty: 1 },
          { id: mixItems[j].id, qty: 1 },
        ],
        {
          kind: "mix",
          specialId: `mix:${mixItems[i].id}:${mixItems[j].id}`,
          specialMix: { a: mixItems[i].id, b: mixItems[j].id },
        },
      );
    }
  }

  const nuggets = items.find((item) => item.id === "nuggets10");
  const wings = items.find((item) => item.id === "wings4");
  for (const box of [nuggets, wings].filter(Boolean)) {
    for (const drink of drinks.slice(0, 4)) {
      add(
        [
          { id: box.id, qty: 1 },
          { id: "fries-m", qty: 1 },
          { id: drink.id, qty: 1 },
        ],
        { kind: "share-box" },
      );
    }
  }

  return list;
}

function buildLine(entry, catalog, mix, people) {
  const qty = entry.qty * people;
  const node = catalog.get(entry.id);
  if (!node) return null;
  return {
    id: node.id,
    name: node.name,
    qty,
    unitPriceCents: node.priceCents,
    lineTotalCents: node.priceCents * qty,
    calories: node.calories,
    protein: node.protein,
    category: node.category,
    tags: node.tags || [],
    components: node.components || [],
    isCombo: node.kind === "combo",
  };
}

function mixLine(specialMix, catalog, mix, people) {
  const a = catalog.get(specialMix.a);
  const b = catalog.get(specialMix.b);
  if (!a || !b) return null;
  const qty = people;
  return {
    id: "mix11",
    name: `${mix.name}：${a.name} + ${b.name}`,
    qty,
    unitPriceCents: mix.priceCents,
    lineTotalCents: mix.priceCents * qty,
    calories: (a.calories || 0) + (b.calories || 0),
    protein: (a.protein || 0) + (b.protein || 0),
    category: "combo",
    tags: [...new Set([...(a.tags || []), ...(b.tags || []), "combo", "mix"])],
    components: [a.id, b.id],
    isCombo: true,
    isMix: true,
  };
}

function requirementsMet(coupon, tagCounts, categories, itemIds) {
  if (coupon.requiresTag && (tagCounts[coupon.requiresTag] || 0) < (coupon.minQty || 1)) {
    return false;
  }
  if (coupon.requiresCategories) {
    for (const category of coupon.requiresCategories) {
      if (!categories.has(category)) return false;
    }
  }
  if (coupon.requiresItemIds) {
    for (const id of coupon.requiresItemIds) {
      if (!itemIds.has(id)) return false;
    }
  }
  return true;
}

function bestCoupon(coupons, baseCents, opts, store, tagCounts, categories, itemIds) {
  const eligible = coupons
    .filter((coupon) => {
      if (coupon.mode && coupon.mode !== opts.mode) return false;
      const storeIds = coupon.storeIds || (coupon.storeId ? [coupon.storeId] : null);
      if (storeIds && !storeIds.includes(store.id)) return false;
      if ((coupon.thresholdCents || 0) > baseCents) return false;
      return requirementsMet(coupon, tagCounts, categories, itemIds);
    })
    .sort((a, b) => (b.discountCents || 0) - (a.discountCents || 0));
  return eligible[0] || null;
}

function countTraps(coupons, opts, store, baseCents, feesCents, pointsValueCents, finalCents, tagCounts, categories, itemIds, filler) {
  if (!filler) return 0;
  let count = 0;
  const fillerQty = opts.people;
  for (const coupon of coupons) {
    if (coupon.mode && coupon.mode !== opts.mode) continue;
    const storeIds = coupon.storeIds || (coupon.storeId ? [coupon.storeId] : null);
    if (storeIds && !storeIds.includes(store.id)) continue;
    const threshold = coupon.thresholdCents || 0;
    if (threshold <= baseCents) continue;
    if (baseCents + filler.priceCents * fillerQty < threshold) continue;

    const nextTagCounts = { ...tagCounts };
    for (const tag of filler.tags || []) nextTagCounts[tag] = (nextTagCounts[tag] || 0) + fillerQty;
    const nextCategories = new Set(categories);
    nextCategories.add(filler.category);
    const nextItemIds = new Set(itemIds);
    nextItemIds.add(filler.id);
    if (!requirementsMet(coupon, nextTagCounts, nextCategories, nextItemIds)) continue;

    const nextBase = baseCents + filler.priceCents * fillerQty;
    const nextFinal = Math.max(0, nextBase + feesCents - (coupon.discountCents || 0) - pointsValueCents);
    if (nextFinal >= finalCents) count += 1;
  }
  return count;
}

function scoreCandidate(candidate, opts, store, catalog, data) {
  const people = opts.people;
  const lines = [];
  if (candidate.specialMix) {
    const line = mixLine(candidate.specialMix, catalog, data.mix, people);
    if (line) lines.push(line);
  } else {
    for (const entry of candidate.entries) {
      const line = buildLine(entry, catalog, data.mix, people);
      if (line) lines.push(line);
    }
  }
  if (lines.length === 0) return null;

  let baseCents = 0;
  let referenceCents = 0;
  let calories = 0;
  let protein = 0;
  let nutritionKnown = true;
  const tagCounts = {};
  const categories = new Set();
  const itemIds = new Set();

  for (const line of lines) {
    baseCents += line.lineTotalCents;
    calories += (line.calories || 0) * line.qty;
    protein += (line.protein || 0) * line.qty;
    if (line.calories === null || line.calories === undefined) nutritionKnown = false;
    if (line.protein === null || line.protein === undefined) nutritionKnown = false;
    if (line.isCombo) {
      if (!line.isMix) {
        categories.add("main");
        if ((line.components || []).length === 0) {
          categories.add("side");
          categories.add("drink");
        }
      }
      itemIds.add(line.id);
      const components = line.components || [];
      if (components.length > 0) {
        let componentRef = 0;
        let foundAll = true;
        for (const id of components) {
          const component = catalog.get(id);
          if (!component) {
            foundAll = false;
            break;
          }
          componentRef += component.priceCents;
          categories.add(component.category);
          itemIds.add(component.id);
          for (const tag of component.tags || []) {
            tagCounts[tag] = (tagCounts[tag] || 0) + line.qty;
          }
        }
        referenceCents += (foundAll ? componentRef : line.unitPriceCents) * line.qty;
      } else {
        referenceCents += line.unitPriceCents * line.qty;
      }
    } else {
      for (const tag of line.tags) tagCounts[tag] = (tagCounts[tag] || 0) + line.qty;
      categories.add(line.category);
      itemIds.add(line.id);
      referenceCents += line.unitPriceCents * line.qty;
    }
  }

  const coupon = bestCoupon(data.coupons || [], baseCents, opts, store, tagCounts, categories, itemIds);
  const couponDiscount = coupon?.discountCents || 0;
  const feesCents = (store.deliveryFeeCents || 0) + (store.packagingFeeCents || 0);
  const maxPointsValue = Math.floor(Math.max(0, baseCents - couponDiscount) * 0.2);
  const pointsValue = opts.usePoints
    ? Math.min(data.pointsBalance || 0, maxPointsValue)
    : 0;
  const finalCents = Math.max(0, baseCents + feesCents - couponDiscount - pointsValue);
  const savingsCents = Math.max(0, referenceCents + feesCents - finalCents);

  const filler = (data.items || [])
    .filter((item) => item.available !== false && !itemIds.has(item.id))
    .sort((a, b) => a.priceCents - b.priceCents)[0];

  const trapCount = countTraps(
    data.coupons || [],
    opts,
    store,
    baseCents,
    feesCents,
    pointsValue,
    finalCents,
    tagCounts,
    categories,
    itemIds,
    filler,
  );

  const reasons = [];
  if (referenceCents - baseCents >= 100) {
    reasons.push(`组合价比单点省 ¥${((referenceCents - baseCents) / 100).toFixed(2)}`);
  }
  if (coupon) {
    reasons.push(`自动匹配「${coupon.name}」，再省 ¥${(coupon.discountCents / 100).toFixed(2)}`);
  }
  if (pointsValue > 0) {
    reasons.push(`积分抵 ¥${(pointsValue / 100).toFixed(2)}`);
  }
  if (opts.mode === "pickup") {
    reasons.push("自取免配送费");
  } else {
    reasons.push("外送费与包装费已计入");
  }
  if (trapCount > 0) {
    reasons.push(`已避开 ${trapCount} 个凑单陷阱`);
  }

  const withinBudget = finalCents <= opts.budgetCents;
  const calorieFit = opts.caloriesMax ? calories <= opts.caloriesMax : true;
  const hasMain = categories.has("main");
  const hasCompanion = ["side", "drink", "snack", "dessert"].some((category) =>
    categories.has(category),
  );
  const isCompleteMeal = hasMain && hasCompanion;
  let score = 0;
  if (opts.goal === "save") score = -finalCents;
  else if (opts.goal === "full") score = calories * 10 - finalCents * 0.1;
  else if (opts.goal === "protein") score = protein * 300 - finalCents * 0.2;
  else if (opts.goal === "light") score = -calories * 10 - finalCents * 0.1;
  if (withinBudget) score += 100000;
  if (opts.caloriesMax) score += calorieFit ? 30000 : -30000;

  return {
    key: candidate.specialId || candidate.entries.map((e) => `${e.id}:${e.qty}`).join(","),
    lines,
    baseCents,
    referenceCents,
    feesCents,
    coupon: coupon
      ? {
          id: coupon.id,
          name: coupon.name,
          badge: coupon.badge || "优惠券",
          discountCents: coupon.discountCents,
        }
      : null,
    pointsValue,
    finalCents,
    savingsCents,
    calories,
    protein,
    nutritionKnown,
    withinBudget,
    calorieFit,
    isCompleteMeal,
    trapCount,
    reasons,
    score,
    tags: [...new Set(lines.flatMap((line) => line.tags))],
  };
}

function distinctPick(sorted, used, count) {
  const picks = [];
  for (const item of sorted) {
    if (used.has(item.key)) continue;
    used.add(item.key);
    picks.push(item);
    if (picks.length >= count) break;
  }
  return picks;
}

function labelFor(goal, index) {
  if (index === 0) return { label: "最省", tone: "red", tagline: "同样的东西，花更少的钱" };
  if (index === 1) return { label: "最饱", tone: "gold", tagline: "预算内吃到最满足" };
  if (goal === "protein") return { label: "高蛋白", tone: "dark", tagline: "把预算优先花在蛋白质上" };
  if (goal === "light") return { label: "最轻", tone: "dark", tagline: "热量更低，负担更小" };
  return { label: "最均衡", tone: "dark", tagline: "价格、蛋白质、热量都不偏科" };
}

function publicPlan(plan, opts, index, store, dataSource) {
  const meta = labelFor(opts.goal, index);
  return {
    id: `plan-${index + 1}`,
    label: meta.label,
    tone: meta.tone,
    tagline: meta.tagline,
    items: plan.lines.map((line) => ({
      id: line.id,
      name: line.name,
      qty: line.qty,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: line.lineTotalCents,
      calories: line.calories,
      protein: line.protein,
      components: line.components,
    })),
    price: {
      baseCents: plan.baseCents,
      referenceCents: plan.referenceCents,
      couponDiscountCents: plan.coupon?.discountCents || 0,
      pointsDiscountCents: plan.pointsValue,
      feesCents: plan.feesCents,
      deliveryFeeCents: store.deliveryFeeCents || 0,
      packagingFeeCents: store.packagingFeeCents || 0,
      finalCents: plan.finalCents,
      perPersonCents: Math.round(plan.finalCents / opts.people),
      savingsCents: plan.savingsCents,
    },
    coupon: plan.coupon,
    pointsUsed: plan.pointsValue,
    coupons: plan.coupon ? [plan.coupon] : [],
    calories: plan.calories,
    protein: plan.protein,
    nutritionKnown: plan.nutritionKnown,
    withinBudget: plan.withinBudget,
    calorieFit: plan.calorieFit,
    completeMeal: plan.isCompleteMeal,
    trapCount: plan.trapCount,
    trapMessage:
      plan.trapCount > 0
        ? `已避开 ${plan.trapCount} 个「为用券加购反而更贵」的凑单陷阱`
        : "",
    reasons: plan.reasons.slice(0, 4),
    recommended: false,
    store: {
      id: store.id,
      name: store.name,
      address: store.address,
      distanceMeters: store.distanceMeters,
      waitMinutes: store.waitMinutes,
      mode: store.mode,
    },
    mode: opts.mode,
    people: opts.people,
    dataSource,
    priceVerified: false,
  };
}

export function optimize(input = {}, data = DEMO_DATA) {
  const opts = normalizeInput(input);
  const stores = data.stores || [];
  const store = pickStore(stores, opts);
  const catalog = makeCatalog(data);
  const items = (data.items || []).filter(
    (entry) =>
      entry.available !== false &&
      !isAvoided(entry.tags || [], opts.avoidTags),
  );
  const combos = (data.combos || []).filter(
    (entry) =>
      entry.available !== false &&
      !isAvoided(entry.tags || [], opts.avoidTags),
  );
  if (!store) throw new Error("没有可用门店");
  if (!items.some((entry) => entry.category === "main") && combos.length === 0) {
    throw new Error("当前忌口条件下没有可搭配的主食，请减少限制");
  }

  const candidates = generateCandidates(items, combos, data.mix, opts);
  const scored = candidates
    .map((candidate) => scoreCandidate(candidate, opts, store, catalog, data))
    .filter(Boolean);

  if (scored.length === 0) {
    throw new Error("没有算出符合条件的组合，请调整预算或忌口");
  }

  const within = scored.filter((plan) => plan.withinBudget);
  const pool = within.length > 0 ? within : scored;
  const completePool = pool.filter((plan) => plan.isCompleteMeal);
  const selectionPool = completePool.length > 0 ? completePool : pool;
  const byPrice = [...selectionPool].sort((a, b) => a.finalCents - b.finalCents || b.calories - a.calories);
  const byCalories = [...selectionPool].sort((a, b) => b.calories - a.calories || a.finalCents - b.finalCents);
  const byScore = [...selectionPool].sort((a, b) => b.score - a.score || a.finalCents - b.finalCents);

  const used = new Set();
  const chosen = [];
  const cheapest = distinctPick(byPrice, used, 1)[0];
  if (cheapest) chosen.push(cheapest);
  const fullest = distinctPick(byCalories, used, 1)[0];
  if (fullest) chosen.push(fullest);
  const balanced =
    opts.goal === "protein"
      ? [...selectionPool].sort((a, b) => b.protein - a.protein || a.finalCents - b.finalCents)
      : opts.goal === "light"
        ? [...selectionPool].sort((a, b) => a.calories - b.calories || a.finalCents - b.finalCents)
        : byScore;
  const third = distinctPick(balanced, used, 1)[0];
  if (third) chosen.push(third);

  let recommendedId = "plan-1";
  if (opts.goal === "full" && chosen[1]) recommendedId = "plan-2";
  if ((opts.goal === "protein" || opts.goal === "light") && chosen[2]) recommendedId = "plan-3";
  if (opts.goal === "save") recommendedId = "plan-1";

  const plans = chosen.map((plan, index) => {
    const publicPlanData = publicPlan(plan, opts, index, store, data.source || "demo");
    publicPlanData.recommended = publicPlanData.id === recommendedId;
    return publicPlanData;
  });

  const best = plans.reduce((a, b) => (a.price.finalCents <= b.price.finalCents ? a : b), plans[0]);
  const maxSavings = Math.max(...plans.map((plan) => plan.price.savingsCents));
  const warnings = [];
  if ((data.source || "demo") === "demo") {
    warnings.push("演示数据：价格为示例，实际以麦当劳官方 calculate-price 和结算页为准。");
  }
  if (within.length === 0) {
    warnings.push("预算偏低，已优先保证主食；可以适当提高预算解锁更多组合。");
  }
  if (opts.caloriesMax && !plans.some((plan) => plan.calorieFit)) {
    warnings.push("当前预算内没有完全满足热量上限的组合，已按最接近目标推荐。");
  }
  if (plans.some((plan) => !plan.nutritionKnown)) {
    warnings.push("部分餐品缺少营养数据，热量与蛋白质仅按已匹配数据估算。");
  }

  return {
    ok: true,
    mode: data.source || "demo",
    dataSource: data.source || "demo",
    generatedAt: new Date().toISOString(),
    query: {
      budgetCents: opts.budgetCents,
      goal: opts.goal,
      people: opts.people,
      mode: opts.mode,
      caloriesMax: opts.caloriesMax,
      avoidTags: opts.avoidTags,
      usePoints: opts.usePoints,
    },
    store: {
      id: store.id,
      name: store.name,
      area: store.area,
      address: store.address,
      distanceMeters: store.distanceMeters,
      waitMinutes: store.waitMinutes,
      mode: store.mode,
      deliveryFeeCents: store.deliveryFeeCents || 0,
      packagingFeeCents: store.packagingFeeCents || 0,
    },
    plans,
    recommendedId,
    summary: {
      bestFinalCents: best.price.finalCents,
      maxSavingsCents: maxSavings,
      perPersonCents: best.price.perPersonCents,
      budgetCents: opts.budgetCents,
      withinBudget: within.length > 0,
      planCount: plans.length,
      couponCount: (data.coupons || []).length,
      trapCount: Math.max(...plans.map((plan) => plan.trapCount), 0),
      message:
        maxSavings > 0
          ? `这单最多省 ¥${(maxSavings / 100).toFixed(2)}`
          : "已经是最省组合，没有多余加购",
    },
    warnings,
  };
}

export { normalizeInput };
