import { optimize } from "./optimizer.js";

const MCP_URL = process.env.MCD_MCP_URL || "https://mcp.mcd.cn";
const TOOL_TIMEOUT_MS = Number(process.env.MCP_TOOL_TIMEOUT_MS || 15000);

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseToolPayload(payload) {
  if (!isRecord(payload) || !Array.isArray(payload.content)) return payload;
  for (const item of payload.content) {
    if (!isRecord(item) || item.type !== "text" || typeof item.text !== "string") continue;
    const text = item.text.trim();
    if (!text) continue;
    try {
      return JSON.parse(text);
    } catch {
      const start = text.indexOf("{");
      if (start >= 0) {
        try {
          return JSON.parse(text.slice(start));
        } catch {
          // keep looking
        }
      }
    }
  }
  return payload;
}

function unwrap(payload) {
  const parsed = parseToolPayload(payload);
  if (isRecord(parsed) && "data" in parsed) return parsed.data;
  if (isRecord(parsed) && "result" in parsed) return parsed.result;
  return parsed;
}

function extractList(data, keys) {
  if (Array.isArray(data)) return data;
  if (!isRecord(data)) return [];
  for (const key of keys) {
    if (Array.isArray(data[key])) return data[key];
  }
  return [];
}

function flattenMenu(data) {
  if (Array.isArray(data)) return data;
  if (!isRecord(data)) return [];
  const direct = extractList(data, ["meals", "items", "products", "list"]);
  if (direct.length > 0 && direct.every((entry) => isRecord(entry) && !Array.isArray(entry))) {
    return direct;
  }
  const result = [];
  const groups = ["categories", "meals", "items", "products", "list"];
  for (const key of groups) {
    const value = data[key];
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (!isRecord(entry)) continue;
        const nested = extractList(entry, ["products", "meals", "items", "list"]);
        if (nested.length > 0) result.push(...nested);
        else if (entry.productCode || entry.mealCode || entry.code || entry.name) result.push(entry);
      }
    } else if (isRecord(value)) {
      for (const entry of Object.values(value)) {
        if (Array.isArray(entry)) result.push(...entry);
        else if (isRecord(entry)) {
          const nested = extractList(entry, ["products", "meals", "items", "list"]);
          if (nested.length > 0) result.push(...nested);
          else result.push(entry);
        }
      }
    }
  }
  return result;
}

function firstString(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function moneyToCents(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? value : Math.round(value * 100);
  }
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[¥￥,\s]/g, "").replace(/元$/, "");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.round(parsed * 100);
}

function firstMoney(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (isRecord(value)) {
      const nested = firstMoney(value, ["amount", "value", "price", "total"]);
      if (nested !== undefined) return nested;
    }
    const parsed = moneyToCents(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function inferCategory(name, isCombo) {
  if (isCombo) return "combo";
  if (/套餐|三件套|组合/.test(name)) return "combo";
  if (/堡|卷|饭/.test(name)) return "main";
  if (/薯条|薯饼/.test(name)) return "side";
  if (/可乐|雪碧|汁|奶|咖啡|拿铁|茶|饮/.test(name)) return "drink";
  if (/麦旋风|圆筒|冰淇淋|派|甜/.test(name)) return "dessert";
  if (/鸡块|鸡翅|小食/.test(name)) return "snack";
  return "main";
}

function inferTags(name, category, isCombo) {
  const tags = [];
  if (isCombo) tags.push("combo");
  if (/牛|巨无霸|吉士|安格斯/.test(name)) tags.push("beef");
  if (/辣/.test(name)) tags.push("spicy");
  if (/鸡/.test(name)) tags.push("chicken");
  if (/鱼|鳕/.test(name)) tags.push("fish");
  if (/薯/.test(name)) tags.push("fries");
  if (/奶|拿铁|冰淇淋|吉士/.test(name)) tags.push("dairy");
  if (category === "drink") tags.push("drink");
  if (/无糖|零度/.test(name)) tags.push("zero");
  return [...new Set(tags)];
}

function normalizeStore(raw) {
  const storeCode = firstString(raw, ["storeCode", "storeId", "code", "id"]) || "";
  return {
    id: storeCode,
    name: firstString(raw, ["storeName", "name", "title"]) || storeCode,
    address: firstString(raw, ["address", "addressName", "storeAddress", "detail"]) || "",
    area: firstString(raw, ["city", "area", "cityName"]) || "",
    distanceMeters: toNumber(raw.distance) || toNumber(raw.distanceMeters) || 0,
    waitMinutes: 10,
    mode: "pickup",
    tag: "实时门店",
  };
}

function normalizeMenu(payload) {
  const entries = flattenMenu(unwrap(payload));
  const items = [];
  const combos = [];
  for (const raw of entries) {
    if (!isRecord(raw)) continue;
    const productCode = firstString(raw, ["productCode", "mealCode", "code", "id"]);
    const name = firstString(raw, ["name", "mealName", "productName", "title"]);
    const priceCents = firstMoney(raw, ["priceCents", "price", "salePrice", "currentPrice", "priceAmount", "amount"]);
    if (!productCode || !name || !priceCents || priceCents <= 0) continue;
    const unavailable =
      raw.soldOut === true ||
      raw.isAvailable === false ||
      raw.available === false ||
      raw.status === "soldout" ||
      raw.status === "sold_out";
    if (unavailable) continue;
    const isCombo =
      raw.isCombo === true ||
      raw.type === "combo" ||
      raw.mealType === "combo" ||
      /套餐|三件套/.test(name);
    const category = inferCategory(name, isCombo);
    const entry = {
      id: productCode,
      name,
      priceCents,
      calories: null,
      protein: null,
      category: isCombo ? "combo" : category,
      tags: inferTags(name, category, isCombo),
      available: true,
      components: [],
    };
    if (isCombo) combos.push(entry);
    else items.push(entry);
  }
  return { items, combos };
}

function normalizeCoupons(payload) {
  const entries = extractList(unwrap(payload), ["coupons", "list", "items"]);
  const coupons = [];
  for (const raw of entries) {
    if (!isRecord(raw)) continue;
    const couponId = firstString(raw, ["couponId", "coupon_id", "id"]);
    const couponCode = firstString(raw, ["couponCode", "coupon_code", "code"]);
    if (!couponId && !couponCode) continue;
    const name =
      firstString(raw, ["couponName", "name", "title", "couponTitle"]) ||
      couponId ||
      couponCode ||
      "优惠券";
    const thresholdCents = firstMoney(raw, [
      "thresholdCents",
      "minSpend",
      "threshold",
      "conditionAmount",
      "minAmount",
    ]) || 0;
    const discountCents = firstMoney(raw, [
      "discountCents",
      "discountAmount",
      "discount",
      "faceValue",
      "couponAmount",
      "amount",
    ]) || 0;
    if (discountCents <= 0) continue;
    const orderType = toNumber(raw.orderType);
    coupons.push({
      id: couponId || couponCode,
      couponId,
      couponCode,
      name,
      thresholdCents,
      discountCents,
      mode: orderType === 2 ? "delivery" : "pickup",
      badge: "实时券",
    });
  }
  return coupons;
}

function normalizeNutrition(payload) {
  const entries = extractList(unwrap(payload), ["foods", "list", "items"]);
  const map = new Map();
  for (const raw of entries) {
    if (!isRecord(raw)) continue;
    const name = firstString(raw, ["foodName", "name", "productName", "mealName"]);
    if (!name) continue;
    const calories = toNumber(raw.energy) ?? toNumber(raw.calorie) ?? toNumber(raw.calories) ?? toNumber(raw.kcal);
    const protein = toNumber(raw.protein) ?? toNumber(raw.proteinG) ?? toNumber(raw.proteinGram);
    if (calories === undefined && protein === undefined) continue;
    map.set(name.replace(/\s+/g, "").toLowerCase(), {
      calories: calories === undefined ? null : calories,
      protein: protein === undefined ? null : protein,
    });
  }
  return map;
}

function applyNutrition(items, nutritionMap) {
  for (const item of items) {
    const key = item.name.replace(/\s+/g, "").toLowerCase();
    let match = nutritionMap.get(key);
    if (!match) {
      for (const [name, value] of nutritionMap) {
        if (name.includes(key) || key.includes(name)) {
          match = value;
          break;
        }
      }
    }
    if (match) {
      item.calories = match.calories;
      item.protein = match.protein;
    }
  }
}

export class LiveMcp {
  constructor(client) {
    this.client = client;
  }

  async call(name, args) {
    const result = await withTimeout(
      this.client.callTool({ name, arguments: args }),
      TOOL_TIMEOUT_MS,
      name,
    );
    return parseToolPayload(result);
  }

  async nearbyStores(city, keyword) {
    const payload = await this.call("query-nearby-stores", {
      searchType: 2,
      beType: 1,
      city,
      keyword,
    });
    return extractList(unwrap(payload), ["stores", "list", "items"]).map(normalizeStore).filter((s) => s.id);
  }

  async menu(storeCode) {
    return this.call("query-meals", { storeCode, orderType: 1, beType: 1 });
  }

  async coupons(storeCode) {
    return this.call("query-store-coupons", { storeCode, orderType: 1, beType: 1 });
  }

  async nutrition() {
    return this.call("list-nutrition-foods", {});
  }

  async price(storeCode, plan) {
    const items = plan.items.map((item) => ({ productCode: item.id, quantity: item.qty }));
    if (plan.coupon?.id && items.length > 0) {
      items[0].couponId = plan.coupon.id;
    }
    const payload = await this.call("calculate-price", {
      storeCode,
      orderType: 1,
      beType: 1,
      items,
      needTableware: false,
    });
    const data = unwrap(payload);
    const totalCents =
      firstMoney(data, ["totalCents", "payableCents", "payAmount", "totalAmount", "totalPrice", "total", "actualAmount", "amount", "price"]) ??
      undefined;
    return { totalCents, raw: payload };
  }

  async close() {
    await this.client.close();
  }
}

export async function createLiveClient(token) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/streamableHttp.js"
  );
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: {
      headers: { Authorization: `Bearer ${token}` },
    },
  });
  const client = new Client(
    { name: "save-one", version: "1.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  return new LiveMcp(client);
}

export async function optimizeLive(input, client) {
  if (input.mode === "delivery") {
    throw new Error("实时外送模式需要账号配送地址，当前部署先使用演示外送数据");
  }
  const city = input.city || "上海";
  const keyword = input.keyword || "人民广场";
  const stores = await client.nearbyStores(city, keyword);
  if (stores.length === 0) throw new Error("附近没有查询到可用门店");
  const store = stores[0];
  const [menuPayload, couponPayload] = await Promise.all([
    client.menu(store.id),
    client.coupons(store.id),
  ]);
  const { items, combos } = normalizeMenu(menuPayload);
  if (items.length === 0 && combos.length === 0) {
    throw new Error("实时菜单为空");
  }
  let nutritionMap = new Map();
  try {
    nutritionMap = normalizeNutrition(await client.nutrition());
    applyNutrition([...items, ...combos], nutritionMap);
  } catch {
    // nutrition is optional; price optimization still works
  }
  const data = {
    stores: [store],
    items,
    combos,
    coupons: normalizeCoupons(couponPayload),
    mix: { id: "mix11", name: "1+1 随心配", priceCents: 1390, eligible: [] },
    pointsBalance: 0,
    source: "live",
  };
  const result = optimize({ ...input, storeId: store.id }, data);
  result.mode = "live";
  result.dataSource = "live";
  result.store = {
    id: store.id,
    name: store.name,
    area: store.area,
    address: store.address,
    distanceMeters: store.distanceMeters,
    waitMinutes: store.waitMinutes,
    mode: "pickup",
    deliveryFeeCents: 0,
    packagingFeeCents: 0,
  };
  result.warnings = [
    "实时模式：菜单与券来自麦当劳 MCP，最终价格以官方 calculate-price 与结算页为准。",
  ];
  if (items.some((item) => item.calories === null)) {
    result.warnings.push("部分餐品未匹配到营养数据，热量与蛋白质仅按已匹配项统计。");
  }
  for (const plan of result.plans) {
    try {
      const verified = await client.price(store.id, plan);
      if (verified.totalCents !== undefined) {
        plan.price.finalCents = verified.totalCents;
        plan.price.perPersonCents = Math.round(verified.totalCents / plan.people);
        plan.price.savingsCents = Math.max(
          0,
          plan.price.referenceCents + plan.price.feesCents - verified.totalCents,
        );
        plan.priceVerified = true;
      }
    } catch {
      plan.priceVerified = false;
      result.warnings.push(`「${plan.label}」官方核价暂未成功，已保留本地试算价。`);
    }
  }
  const best = result.plans.reduce((a, b) => (a.price.finalCents <= b.price.finalCents ? a : b));
  result.summary.bestFinalCents = best.price.finalCents;
  result.summary.perPersonCents = best.price.perPersonCents;
  result.summary.maxSavingsCents = Math.max(...result.plans.map((plan) => plan.price.savingsCents));
  result.summary.message =
    result.summary.maxSavingsCents > 0
      ? `这单最多省 ¥${(result.summary.maxSavingsCents / 100).toFixed(2)}`
      : "已经是最省组合，没有多余加购";
  return result;
}
