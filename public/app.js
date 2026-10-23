const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const PREF_KEY = "save-one-prefs-v1";
const HISTORY_KEY = "save-one-history-v1";

const state = {
  dataMode: "demo",
  bootstrap: null,
  stores: [],
  storeId: "",
  defaultStoreId: "",
  budgetCents: 3000,
  goal: "save",
  people: 1,
  orderMode: "pickup",
  caloriesMax: null,
  avoidTags: [],
  usePoints: true,
  result: null,
  selectedPlanId: "",
  loading: false,
  bootstrapped: false,
  recordedFor: "",
  history: [],
  toastTimer: null,
  loadingTimer: null,
  lastFocus: null,
};

const els = {
  modeBadge: $("#modeBadge"),
  storeLabel: $("#storeLabel"),
  storeBtn: $("#storeBtn"),
  storeList: $("#storeList"),
  budgetChips: $("#budgetChips"),
  customBudgetBtn: $("#customBudgetBtn"),
  customBudgetWrap: $("#customBudgetWrap"),
  customBudget: $("#customBudget"),
  customBudgetConfirm: $("#customBudgetConfirm"),
  goalChips: $("#goalChips"),
  peopleChips: $("#peopleChips"),
  modeChips: $("#modeChips"),
  calorieChips: $("#calorieChips"),
  avoidChips: $("#avoidChips"),
  usePoints: $("#usePoints"),
  pointsHint: $(".switch-row small"),
  optimizeBtn: $("#optimizeBtn"),
  loading: $("#loading"),
  loadingSteps: $("#loadingSteps"),
  results: $("#results"),
  saveTotal: $("#saveTotal"),
  resultsSub: $("#resultsSub"),
  warnings: $("#warnings"),
  planCards: $("#planCards"),
  againBtn: $("#againBtn"),
  historyBtn: $("#historyBtn"),
  historyTotal: $("#historyTotal"),
  detailModal: $("#detailModal"),
  storeModal: $("#storeModal"),
  infoModal: $("#infoModal"),
  modalContent: $("#modalContent"),
  toast: $("#toast"),
  stickyBar: $("#stickyBar"),
  stickyPrice: $("#stickyPrice"),
  stickyDetail: $("#stickyDetail"),
  stickyCopy: $("#stickyCopy"),
  infoBtn: $("#infoBtn"),
  footerInfoBtn: $("#footerInfoBtn"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function money(cents) {
  const value = Number(cents);
  if (!Number.isFinite(value)) return "¥0.00";
  return `¥${(value / 100).toFixed(2)}`;
}

function number(value) {
  return Number(value).toLocaleString("zh-CN");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function selectedStore() {
  return state.stores.find((store) => store.id === state.storeId) || null;
}

function findPlan(planId) {
  return state.result?.plans?.find((plan) => plan.id === planId) || null;
}

function selectedPlan() {
  return findPlan(state.selectedPlanId) || state.result?.plans?.[0] || null;
}

function applyMode(mode, liveState = "") {
  state.dataMode = mode === "live" ? "live" : "demo";
  const isLive = state.dataMode === "live";
  els.modeBadge.textContent = isLive ? "实时数据" : "演示数据";
  els.modeBadge.classList.toggle("is-demo", !isLive);
  els.modeBadge.title = isLive
    ? "实时 MCP 已连接"
    : liveState === "error"
      ? "实时接口暂不可用，当前使用演示数据"
      : "当前使用演示数据";
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return;
    const prefs = JSON.parse(raw);
    if (Number.isFinite(prefs.budgetCents)) state.budgetCents = prefs.budgetCents;
    if (["save", "full", "protein", "light"].includes(prefs.goal)) state.goal = prefs.goal;
    if (Number.isFinite(prefs.people)) state.people = Math.max(1, Math.min(4, prefs.people));
    if (prefs.orderMode === "delivery" || prefs.orderMode === "pickup") state.orderMode = prefs.orderMode;
    if (prefs.caloriesMax === null || Number.isFinite(prefs.caloriesMax)) state.caloriesMax = prefs.caloriesMax;
    if (Array.isArray(prefs.avoidTags)) state.avoidTags = prefs.avoidTags.filter((tag) => typeof tag === "string");
    if (typeof prefs.usePoints === "boolean") state.usePoints = prefs.usePoints;
    if (typeof prefs.storeId === "string") state.storeId = prefs.storeId;
  } catch {
    // ignore broken prefs
  }
}

function savePrefs() {
  if (!state.bootstrapped) return;
  try {
    localStorage.setItem(
      PREF_KEY,
      JSON.stringify({
        budgetCents: state.budgetCents,
        goal: state.goal,
        people: state.people,
        orderMode: state.orderMode,
        caloriesMax: state.caloriesMax,
        avoidTags: state.avoidTags,
        usePoints: state.usePoints,
        storeId: state.storeId,
      }),
    );
  } catch {
    // ignore storage errors
  }
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => Number.isFinite(item.savingsCents)).slice(0, 20) : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(0, 20)));
  } catch {
    // ignore storage errors
  }
}

function updateHistoryTotal() {
  const total = state.history.reduce((sum, item) => sum + (item.savingsCents || 0), 0);
  els.historyTotal.textContent = money(total);
}

function activateChips(container, active) {
  if (!container) return;
  $$("button", container).forEach((button) => {
    const on = active(button);
    button.classList.toggle("is-active", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function syncChips() {
  activateChips(els.budgetChips, (button) => {
    if (button.dataset.budget === "custom") return false;
    return Number(button.dataset.budget) === state.budgetCents;
  });
  const hasBudgetChip = $$("button", els.budgetChips).some(
    (button) => button.dataset.budget !== "custom" && Number(button.dataset.budget) === state.budgetCents,
  );
  if (!hasBudgetChip && state.budgetCents) {
    els.customBudgetWrap.classList.remove("hidden");
    els.customBudget.value = (state.budgetCents / 100).toFixed(0);
  } else if (hasBudgetChip) {
    els.customBudgetWrap.classList.add("hidden");
  }
  activateChips(els.goalChips, (button) => button.dataset.goal === state.goal);
  activateChips(els.peopleChips, (button) => Number(button.dataset.people) === state.people);
  activateChips(els.modeChips, (button) => button.dataset.mode === state.orderMode);
  activateChips(els.calorieChips, (button) => {
    const calories = button.dataset.calories;
    return calories === "" ? state.caloriesMax === null : Number(calories) === state.caloriesMax;
  });
  activateChips(els.avoidChips, (button) => state.avoidTags.includes(button.dataset.avoid));
  els.usePoints.checked = state.usePoints;
  updateStoreLabel();
  savePrefs();
}

function updateStoreLabel() {
  const store = selectedStore();
  if (store) {
    els.storeLabel.textContent = store.name.replace("麦当劳·", "");
  } else {
    els.storeLabel.textContent = "上海 · 人民广场";
  }
}

function syncStoreForMode() {
  const store = selectedStore();
  if (store && store.mode === state.orderMode) return;
  const next = state.stores.find((item) => item.mode === state.orderMode);
  if (next) state.storeId = next.id;
}

function renderStoreList() {
  if (!els.storeList) return;
  if (!state.stores.length) {
    els.storeList.innerHTML = '<p class="warning">门店列表加载中，请稍后再试。</p>';
    return;
  }
  els.storeList.innerHTML = state.stores
    .map((store) => {
      const distance = store.distanceMeters ? `${number(store.distanceMeters)}m` : "";
      const wait = store.waitMinutes ? `约 ${store.waitMinutes} 分钟` : "";
      return `
        <button type="button" class="store-item ${store.id === state.storeId ? "is-active" : ""}" data-store-id="${escapeAttr(store.id)}">
          <span class="store-item-main">
            <strong>${escapeHtml(store.name)}</strong>
            <small>${escapeHtml(store.address || store.area || "")} ${store.tag ? `· ${escapeHtml(store.tag)}` : ""}</small>
          </span>
          <span class="store-item-side">
            ${distance ? `<b>${distance}</b>` : ""}
            ${escapeHtml(wait)}
          </span>
        </button>`;
    })
    .join("");
}

function setStore(storeId) {
  const store = state.stores.find((item) => item.id === storeId);
  if (!store) return;
  state.storeId = store.id;
  state.orderMode = store.mode;
  syncChips();
  renderStoreList();
  closeModal("store");
  showToast(`已切换到${store.name.replace("麦当劳·", "")}`);
}

function setBudget(cents) {
  state.budgetCents = Math.max(1000, Math.min(20000, Math.round(cents)));
  syncChips();
}

function setGoal(goal) {
  if (!["save", "full", "protein", "light"].includes(goal)) return;
  state.goal = goal;
  syncChips();
}

function setOrderMode(mode) {
  state.orderMode = mode === "delivery" ? "delivery" : "pickup";
  syncStoreForMode();
  syncChips();
}

function toggleAvoid(tag) {
  if (state.avoidTags.includes(tag)) {
    state.avoidTags = state.avoidTags.filter((item) => item !== tag);
  } else {
    state.avoidTags = [...state.avoidTags, tag];
  }
  syncChips();
}

function showToast(message, isError = false) {
  if (!els.toast) return;
  clearTimeout(state.toastTimer);
  els.toast.textContent = message;
  els.toast.classList.toggle("is-error", isError);
  els.toast.classList.add("is-show");
  state.toastTimer = setTimeout(() => {
    els.toast.classList.remove("is-show");
  }, 2600);
}

function startLoading() {
  els.loading.classList.remove("hidden");
  els.loading.setAttribute("aria-busy", "true");
  els.results.classList.add("hidden");
  els.stickyBar.classList.add("hidden");
  const steps = $$("#loadingSteps li");
  steps.forEach((step, index) => {
    step.classList.toggle("is-active", index === 0);
    step.classList.toggle("is-done", false);
  });
  let index = 0;
  clearInterval(state.loadingTimer);
  state.loadingTimer = setInterval(() => {
    const current = $$("#loadingSteps li");
    if (index < current.length) {
      current[index].classList.remove("is-active");
      current[index].classList.add("is-done");
      index += 1;
      if (index < current.length) current[index].classList.add("is-active");
    }
  }, 420);
}

function stopLoading() {
  clearInterval(state.loadingTimer);
  state.loadingTimer = null;
  els.loading.classList.add("hidden");
  els.loading.setAttribute("aria-busy", "false");
}

function renderWarnings(warnings = []) {
  if (!warnings.length) {
    els.warnings.classList.add("hidden");
    els.warnings.innerHTML = "";
    return;
  }
  els.warnings.classList.remove("hidden");
  els.warnings.innerHTML = warnings
    .slice(0, 3)
    .map((warning) => `<div class="warning">${escapeHtml(warning)}</div>`)
    .join("");
}

function planCardHtml(plan) {
  const selected = plan.id === state.selectedPlanId;
  const discount = plan.price.savingsCents || 0;
  const original = plan.price.referenceCents > plan.price.finalCents ? plan.price.referenceCents : 0;
  const perPerson =
    plan.people > 1
      ? `<span class="meta-pill">约 ${money(plan.price.perPersonCents)}/人</span>`
      : "";
  const couponText = plan.coupon
    ? `已自动选券：${escapeHtml(plan.coupon.name)} −${money(plan.coupon.discountCents)}`
    : "当前没有可用券，已按最低价组合";
  const items = plan.items
    .map(
      (item) => `
        <div class="plan-item">
          <span class="item-name">${escapeHtml(item.name)} <span class="item-qty">×${item.qty}</span></span>
          <span class="item-price">${money(item.lineTotalCents)}</span>
        </div>`,
    )
    .join("");
  const meta = [
    plan.calories !== null && plan.calories !== undefined
      ? `<span class="meta-pill">${number(Math.round(plan.calories))} kcal</span>`
      : '<span class="meta-pill">营养待匹配</span>',
    plan.protein !== null && plan.protein !== undefined
      ? `<span class="meta-pill is-green">${number(Math.round(plan.protein))}g 蛋白</span>`
      : "",
    perPerson,
    plan.priceVerified
      ? '<span class="meta-pill is-green">官方核价</span>'
      : plan.dataSource === "live"
        ? '<span class="meta-pill">本地试算</span>'
        : '<span class="meta-pill is-gold">演示价</span>',
  ]
    .filter(Boolean)
    .join("");

  return `
    <article class="plan-card tone-${escapeAttr(plan.tone || "red")} ${selected ? "is-selected" : ""} ${plan.recommended ? "is-recommended" : ""}" data-plan-id="${escapeAttr(plan.id)}">
      <div class="plan-top">
        <span class="plan-label">${escapeHtml(plan.label)}</span>
        ${plan.recommended ? '<span class="plan-badge">推荐</span>' : ""}
      </div>
      <div class="plan-price">
        <span class="price-main">${money(plan.price.finalCents)}</span>
        ${original ? `<span class="price-original">原价 ${money(original)}</span>` : ""}
        ${discount > 0 ? `<span class="price-save">省 ${money(discount)}</span>` : ""}
      </div>
      <p class="plan-tagline">${escapeHtml(plan.tagline)}</p>
      <div class="plan-items">${items}</div>
      <div class="plan-meta">${meta}</div>
      <div class="plan-coupon">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V7Z"></path><path d="M13 5v14"></path></svg>
        <span>${couponText}</span>
      </div>
      ${plan.trapMessage ? `<div class="plan-warning">${escapeHtml(plan.trapMessage)}</div>` : ""}
      ${!plan.withinBudget ? `<div class="plan-warning">超出预算 ${money(Math.max(0, plan.price.finalCents - (state.result?.query?.budgetCents || 0)))}，建议提高预算或换一套</div>` : ""}
      <div class="plan-actions">
        <button type="button" class="select-button" data-action="select" data-plan-id="${escapeAttr(plan.id)}">${selected ? "已选这套" : "选这套"}</button>
        <button type="button" class="detail-button" data-action="detail" data-plan-id="${escapeAttr(plan.id)}">明细</button>
      </div>
    </article>`;
}

function renderResult(data) {
  state.result = data;
  state.selectedPlanId = data.recommendedId || data.plans?.[0]?.id || "";
  state.recordedFor = "";
  applyMode(data.mode || data.dataSource || "demo", data.deployment?.liveState);
  els.saveTotal.textContent = money(data.summary?.maxSavingsCents || 0);
  const storeName = data.store?.name || "附近门店";
  const wait = data.store?.waitMinutes ? ` · 约 ${data.store.waitMinutes} 分钟` : "";
  els.resultsSub.textContent = `${data.plans?.length || 0} 套方案 · ${storeName}${wait}`;
  renderWarnings(data.warnings || []);
  els.planCards.innerHTML = (data.plans || []).map(planCardHtml).join("");
  els.results.classList.remove("hidden");
  els.loading.classList.add("hidden");
  const plan = selectedPlan();
  if (plan) {
    els.stickyBar.classList.remove("hidden");
    els.stickyPrice.textContent = money(plan.price.finalCents);
  }
  setTimeout(() => {
    els.results.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 80);
}

function updateSelection() {
  const plan = selectedPlan();
  $$(".plan-card", els.planCards).forEach((card) => {
    const isSelected = card.dataset.planId === plan?.id;
    card.classList.toggle("is-selected", isSelected);
    const button = $(".select-button", card);
    if (button) button.textContent = isSelected ? "已选这套" : "选这套";
  });
  if (plan) {
    els.stickyBar.classList.remove("hidden");
    els.stickyPrice.textContent = money(plan.price.finalCents);
  }
}

function recordPlan(plan) {
  if (!plan || state.recordedFor === state.result?.generatedAt) return;
  state.recordedFor = state.result?.generatedAt || String(Date.now());
  state.history.unshift({
    ts: Date.now(),
    savingsCents: plan.price.savingsCents || 0,
    finalCents: plan.price.finalCents || 0,
    label: plan.label,
    items: plan.items.map((item) => item.name),
  });
  state.history = state.history.slice(0, 20);
  saveHistory();
  updateHistoryTotal();
}

function selectPlan(planId, record = true) {
  if (!findPlan(planId)) return;
  state.selectedPlanId = planId;
  updateSelection();
  if (record) {
    const plan = findPlan(planId);
    recordPlan(plan);
    showToast(`已选「${plan.label}」${plan.price.savingsCents > 0 ? `，这单省 ${money(plan.price.savingsCents)}` : ""}`);
  }
}

function detailRows(plan) {
  const rows = [
    ["商品小计", money(plan.price.baseCents)],
    ["配送费", money(plan.price.deliveryFeeCents || 0)],
    ["包装费", money(plan.price.packagingFeeCents || 0)],
    ["优惠券", `−${money(plan.price.couponDiscountCents || 0)}`],
    ["积分抵扣", `−${money(plan.price.pointsDiscountCents || 0)}`],
    ["实付", money(plan.price.finalCents)],
  ];
  return rows
    .map(
      ([label, value], index) => `
        <div class="breakdown-row ${index === 3 || index === 4 ? "is-discount" : ""} ${index === 5 ? "is-total" : ""}">
          <span>${label}</span><b>${value}</b>
        </div>`,
    )
    .join("");
}

function openDetail(planId) {
  const plan = findPlan(planId);
  if (!plan) return;
  const items = plan.items
    .map(
      (item) => `
        <div class="detail-item">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <small>${item.components?.length ? "套餐/组合内含多件" : "单点"} · 单价 ${money(item.unitPriceCents)}</small>
          </div>
          <b>×${item.qty} · ${money(item.lineTotalCents)}</b>
        </div>`,
    )
    .join("");
  const reasons = (plan.reasons || [])
    .map((reason) => `<li>${escapeHtml(reason)}</li>`)
    .join("");
  els.modalContent.innerHTML = `
    <div class="detail-hero">
      <div>
        <p class="card-kicker">方案明细 · ${escapeHtml(plan.label)}</p>
        <h2 id="detailTitle">${escapeHtml(plan.tagline)}</h2>
      </div>
      <div class="detail-price">${money(plan.price.finalCents)}<small>${plan.people > 1 ? ` · ${money(plan.price.perPersonCents)}/人` : ""}</small></div>
    </div>
    <div class="detail-section">
      <h3>钱花在哪</h3>
      <div class="breakdown">${detailRows(plan)}</div>
    </div>
    <div class="detail-section">
      <h3>这一套有什么</h3>
      <div class="detail-items">${items}</div>
    </div>
    <div class="detail-section">
      <h3>为什么推荐它</h3>
      <ul class="detail-reasons">${reasons || "<li>按当前预算和条件算出的最优组合之一。</li>"}</ul>
    </div>
    ${plan.trapMessage ? `<div class="warning" style="margin-top:18px">${escapeHtml(plan.trapMessage)}</div>` : ""}
    <div class="modal-actions">
      <button type="button" class="select-button" data-action="modal-select" data-plan-id="${escapeAttr(plan.id)}">选这套</button>
      <button type="button" class="ghost-button" data-action="copy" data-plan-id="${escapeAttr(plan.id)}">复制清单</button>
      <button type="button" class="ghost-button" data-action="share" data-plan-id="${escapeAttr(plan.id)}">分享战报</button>
    </div>
    <p class="micro-trust" style="margin-top:14px">当前版本不代替用户提交真实订单；支付请在麦当劳官方渠道完成。</p>
  `;
  openModal("detail");
}

function planText(plan) {
  const store = state.result?.store;
  const lines = [
    "省一单 · 今日最省方案",
    `门店：${store?.name || "附近门店"}`,
    `方案：${plan.label} · ${money(plan.price.finalCents)}${plan.people > 1 ? `（${money(plan.price.perPersonCents)}/人）` : ""}`,
    `原价：${money(plan.price.referenceCents)}｜省：${money(plan.price.savingsCents)}`,
    "商品：",
    ...plan.items.map((item) => `- ${item.name} ×${item.qty}  ${money(item.lineTotalCents)}`),
    plan.coupon ? `用券：${plan.coupon.name}（−${money(plan.coupon.discountCents)}）` : "用券：无",
    plan.price.pointsDiscountCents ? `积分抵扣：−${money(plan.price.pointsDiscountCents)}` : "",
    `数据：${plan.dataSource === "live" ? "实时 MCP" : "演示数据"}，最终以官方结算页为准。`,
    "来自：省一单（M-CODE 2026 参赛作品）",
  ].filter(Boolean);
  return lines.join("\n");
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall back below
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

async function copyPlan(plan) {
  if (!plan) return;
  const ok = await copyText(planText(plan));
  if (ok) {
    recordPlan(plan);
    showToast("清单已复制，可前往麦当劳官方渠道下单");
  } else {
    showToast("复制失败，请手动选择清单", true);
  }
}

async function sharePlan(plan) {
  if (!plan) return;
  const text = planText(plan);
  try {
    if (navigator.share) {
      await navigator.share({ title: "省一单 · 今日最省方案", text, url: location.href });
      return;
    }
  } catch {
    // user cancelled or unsupported
  }
  const ok = await copyText(`${text}\n${location.href}`);
  showToast(ok ? "战报已复制，可以发给饭搭子了" : "分享失败，请稍后再试", !ok);
}

function openModal(name) {
  const modal = name === "detail" ? els.detailModal : name === "store" ? els.storeModal : els.infoModal;
  if (!modal) return;
  state.lastFocus = document.activeElement;
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  const close = $(".modal-close", modal);
  if (close) close.focus({ preventScroll: true });
}

function closeModal(name) {
  const modal = name === "detail" ? els.detailModal : name === "store" ? els.storeModal : els.infoModal;
  if (!modal) return;
  modal.classList.add("hidden");
  if (![els.detailModal, els.storeModal, els.infoModal].some((item) => item && !item.classList.contains("hidden"))) {
    document.body.classList.remove("modal-open");
  }
  if (state.lastFocus && typeof state.lastFocus.focus === "function") {
    state.lastFocus.focus({ preventScroll: true });
  }
}

function closeAllModals() {
  ["detail", "store", "info"].forEach(closeModal);
}

function showHistory() {
  if (!state.history.length) {
    showToast("还没有省钱记录，先算一单吧");
    return;
  }
  const total = state.history.reduce((sum, item) => sum + (item.savingsCents || 0), 0);
  const rows = state.history
    .slice(0, 10)
    .map((item) => {
      const date = new Date(item.ts);
      const when = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
      return `<div class="detail-item"><div><strong>${escapeHtml(item.label || "省钱方案")}</strong><small>${when} · ${escapeHtml((item.items || []).slice(0, 3).join("、"))}</small></div><b>省 ${money(item.savingsCents)}</b></div>`;
    })
    .join("");
  els.modalContent.innerHTML = `
    <div class="detail-hero">
      <div>
        <p class="card-kicker">本机演示记录</p>
        <h2 id="detailTitle">我的省钱记录</h2>
      </div>
      <div class="detail-price">${money(total)}<small>累计模拟节省</small></div>
    </div>
    <div class="detail-section">
      <h3>最近记录</h3>
      <div class="detail-items">${rows}</div>
    </div>
    <p class="micro-trust" style="margin-top:14px">记录只保存在本机浏览器，不代表真实消费或返现。</p>
    <div class="modal-actions">
      <button type="button" class="ghost-button" data-action="clear-history">清空记录</button>
    </div>
  `;
  openModal("detail");
}

function clearHistory() {
  state.history = [];
  saveHistory();
  updateHistoryTotal();
  closeModal("detail");
  showToast("省钱记录已清空");
}

async function optimizeNow() {
  if (state.loading) return;
  state.loading = true;
  els.optimizeBtn.disabled = true;
  els.optimizeBtn.classList.add("is-loading");
  startLoading();
  const started = Date.now();
  try {
    const response = await fetch("api/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        budgetCents: state.budgetCents,
        goal: state.goal,
        people: state.people,
        mode: state.orderMode,
        storeId: state.storeId,
        caloriesMax: state.caloriesMax,
        avoidTags: state.avoidTags,
        usePoints: state.usePoints,
        city: "上海",
        keyword: "人民广场",
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "没有算出方案，请调整条件再试");
    }
    await wait(Math.max(0, 900 - (Date.now() - started)));
    stopLoading();
    renderResult(data);
    els.optimizeBtn.disabled = false;
    els.optimizeBtn.classList.remove("is-loading");
  } catch (error) {
    stopLoading();
    els.optimizeBtn.disabled = false;
    els.optimizeBtn.classList.remove("is-loading");
    showToast(error instanceof Error ? error.message : "网络异常，请稍后重试", true);
  } finally {
    state.loading = false;
  }
}

function bindChipContainer(container, handler) {
  if (!container) return;
  container.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    handler(button);
  });
}

function bindEvents() {
  bindChipContainer(els.budgetChips, (button) => {
    if (button.dataset.budget === "custom") {
      els.customBudgetWrap.classList.remove("hidden");
      els.customBudget.focus();
      return;
    }
    setBudget(Number(button.dataset.budget));
  });
  els.customBudgetConfirm.addEventListener("click", () => {
    const value = Number(els.customBudget.value);
    if (!Number.isFinite(value) || value < 10) {
      showToast("请输入 10 元以上的预算", true);
      return;
    }
    setBudget(value * 100);
    els.customBudgetWrap.classList.add("hidden");
    showToast(`预算已设为 ${money(value * 100)}`);
  });
  els.customBudget.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      els.customBudgetConfirm.click();
    }
  });
  bindChipContainer(els.goalChips, (button) => setGoal(button.dataset.goal));
  bindChipContainer(els.peopleChips, (button) => {
    state.people = Number(button.dataset.people);
    syncChips();
  });
  bindChipContainer(els.modeChips, (button) => setOrderMode(button.dataset.mode));
  bindChipContainer(els.calorieChips, (button) => {
    state.caloriesMax = button.dataset.calories ? Number(button.dataset.calories) : null;
    syncChips();
  });
  bindChipContainer(els.avoidChips, (button) => toggleAvoid(button.dataset.avoid));
  els.usePoints.addEventListener("change", () => {
    state.usePoints = els.usePoints.checked;
    savePrefs();
  });
  els.optimizeBtn.addEventListener("click", optimizeNow);
  els.againBtn.addEventListener("click", optimizeNow);
  els.historyBtn.addEventListener("click", showHistory);
  els.storeBtn.addEventListener("click", () => {
    renderStoreList();
    openModal("store");
  });
  els.storeList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-store-id]");
    if (button) setStore(button.dataset.storeId);
  });
  els.infoBtn.addEventListener("click", () => openModal("info"));
  els.footerInfoBtn.addEventListener("click", () => openModal("info"));
  els.planCards.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) return;
    const planId = action.dataset.planId;
    if (action.dataset.action === "select") selectPlan(planId);
    if (action.dataset.action === "detail") openDetail(planId);
  });
  els.modalContent.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) return;
    const planId = action.dataset.planId;
    if (action.dataset.action === "modal-select") {
      selectPlan(planId);
      closeModal("detail");
    }
    if (action.dataset.action === "copy") copyPlan(findPlan(planId));
    if (action.dataset.action === "share") sharePlan(findPlan(planId));
    if (action.dataset.action === "clear-history") clearHistory();
  });
  els.stickyDetail.addEventListener("click", () => {
    const plan = selectedPlan();
    if (plan) openDetail(plan.id);
  });
  els.stickyCopy.addEventListener("click", () => {
    const plan = selectedPlan();
    if (plan) copyPlan(plan);
  });
  $$("[data-close]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.dataset.close));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAllModals();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === HISTORY_KEY) {
      state.history = loadHistory();
      updateHistoryTotal();
    }
  });
}

async function loadBootstrap() {
  try {
    const response = await fetch("api/bootstrap", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("服务暂时不可用");
    const data = await response.json();
    state.bootstrap = data;
    state.stores = Array.isArray(data.stores) ? data.stores : [];
    state.defaultStoreId = state.stores.find((store) => store.id === "p2")?.id || state.stores[0]?.id || "";
    if (!state.storeId) state.storeId = state.defaultStoreId;
    if (!state.stores.some((store) => store.id === state.storeId)) {
      state.storeId = state.defaultStoreId;
    }
    const defaults = data.defaults || {};
    if (!localStorage.getItem(PREF_KEY)) {
      if (Number.isFinite(defaults.budgetCents)) state.budgetCents = defaults.budgetCents;
      if (defaults.goal) state.goal = defaults.goal;
      if (Number.isFinite(defaults.people)) state.people = defaults.people;
      if (defaults.mode) state.orderMode = defaults.mode;
      if (defaults.avoidTags) state.avoidTags = defaults.avoidTags;
      state.usePoints = defaults.usePoints !== false;
    }
    applyMode(data.mode, data.liveState);
    if (els.pointsHint) {
      const points = Number(data.pointsBalance || 0);
      els.pointsHint.textContent = points > 0
        ? `可用积分 ${number(points)}，最多抵订单的 20%`
        : "当前账号无可用积分或未接入积分账户";
    }
    state.bootstrapped = true;
    syncStoreForMode();
    syncChips();
    renderStoreList();
  } catch (error) {
    state.bootstrapped = true;
    applyMode("demo", "error");
    showToast("服务连接失败，请刷新页面重试", true);
    els.storeList.innerHTML = '<p class="warning">门店列表加载失败，请刷新重试。</p>';
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // service worker is optional; HTTP IP deployments skip it
    });
  }
}

function init() {
  state.history = loadHistory();
  updateHistoryTotal();
  loadPrefs();
  bindEvents();
  syncChips();
  renderStoreList();
  registerServiceWorker();
  loadBootstrap();
}

init();
