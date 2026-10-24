const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const PREF_KEY = "maimen-save-one-prefs-v1";
const HISTORY_KEY = "maimen-save-one-history-v1";

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
  capabilities: null,
  quote: null,
  quoteTokens: null,
  order: null,
  reminders: [],
  account: null,
  accountSource: "demo",
  accountWarnings: [],
  subscriptions: [],
  quoteExpired: false,
  orderPollStarted: 0,
  orderPollTimer: null,
  reminderTimer: null,
  toastTimer: null,
  loadingTimer: null,
  lastFocus: null,
  live: {
    status: null,
    binding: null,
    consent: false,
    busy: false,
    revealed: false,
  },
  steward: {
    view: null,
    failed: false,
    phase: "hidden",
    confirmOpen: false,
    busy: false,
    refreshLock: false,
    showSubForm: false,
    tickTimer: null,
    lastReconcileAt: 0,
    auto: {
      autoPrepare: true,
      autoClaim: true,
      autoRefresh: true,
      autoPoll: true,
      autoReconcile: true,
    },
    lastRunAt: {},
    gateNote: {},
  },
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
  stewardBtn: $("#stewardBtn"),
  stewardModal: $("#stewardModal"),
  stewardContent: $("#stewardContent"),
  stewardStrip: $("#stewardStrip"),
  stewardStripTitle: $("#stewardStripTitle"),
  stewardStripMeta: $("#stewardStripMeta"),
  stewardPrimaryBtn: $("#stewardPrimaryBtn"),
  stewardOpenBtn: $("#stewardOpenBtn"),
  stewardConfirm: $("#stewardConfirm"),
  remindersBtn: $("#remindersBtn"),
  reminderBadge: $("#reminderBadge"),
  detailModal: $("#detailModal"),
  storeModal: $("#storeModal"),
  infoModal: $("#infoModal"),
  modalContent: $("#modalContent"),
  toast: $("#toast"),
  stickyBar: $("#stickyBar"),
  stickyPrice: $("#stickyPrice"),
  stickyDetail: $("#stickyDetail"),
  stickyOrder: $("#stickyOrder"),
  infoBtn: $("#infoBtn"),
  footerInfoBtn: $("#footerInfoBtn"),
  liveSetup: $("#liveSetup"),
  livePill: $("#livePill"),
  authState: $("#authState"),
  authStateIcon: $("#authStateIcon"),
  authStateTitle: $("#authStateTitle"),
  authStateText: $("#authStateText"),
  liveConsent: $("#liveConsent"),
  identityPanel: $("#identityPanel"),
  identityName: $("#identityName"),
  identityAvatar: $("#identityAvatar"),
  identityMeta: $("#identityMeta"),
  identityBadge: $("#identityBadge"),
  identityToken: $("#identityToken"),
  liveSteps: $("#liveSteps"),
  liveForm: $("#liveForm"),
  liveToken: $("#liveToken"),
  liveReveal: $("#liveReveal"),
  liveSave: $("#liveSave"),
  liveDisconnect: $("#liveDisconnect"),
  liveFeedback: $("#liveFeedback"),
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

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
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
  renderStewardStrip();
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
  stopOrderPolling();
  clearInterval(state.steward.tickTimer);
  state.steward.tickTimer = null;
  state.quote = null;
  state.quoteTokens = null;
  state.order = null;
  state.quoteExpired = false;
  state.steward.confirmOpen = false;
  state.steward.showSubForm = false;
  state.steward.phase = "hidden";
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
  renderStewardStrip();
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
  // 换了方案就必须换报价，否则确认卡会把上一套方案当作这一单。
  if (state.quote && state.quote.planId !== planId) {
    state.quote = null;
    state.quoteTokens = null;
    state.steward.confirmOpen = false;
    if (autoOn("autoPrepare")) enterStewardFlow();
    else setPhase("hidden");
  } else if (state.steward.phase === "hidden") {
    renderStewardStrip();
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
    "麦门省一单 · 今日最省方案",
    `门店：${store?.name || "附近门店"}`,
    `方案：${plan.label} · ${money(plan.price.finalCents)}${plan.people > 1 ? `（${money(plan.price.perPersonCents)}/人）` : ""}`,
    `原价：${money(plan.price.referenceCents)}｜省：${money(plan.price.savingsCents)}`,
    "商品：",
    ...plan.items.map((item) => `- ${item.name} ×${item.qty}  ${money(item.lineTotalCents)}`),
    plan.coupon ? `用券：${plan.coupon.name}（−${money(plan.coupon.discountCents)}）` : "用券：无",
    plan.price.pointsDiscountCents ? `积分抵扣：−${money(plan.price.pointsDiscountCents)}` : "",
    `数据：${plan.dataSource === "live" ? "实时 MCP" : "演示数据"}，最终以官方结算页为准。`,
    "来自：麦门省一单（M-CODE 2026 参赛作品）",
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
      await navigator.share({ title: "麦门省一单 · 今日最省方案", text, url: location.href });
      return;
    }
  } catch {
    // user cancelled or unsupported
  }
  const ok = await copyText(`${text}\n${location.href}`);
  showToast(ok ? "战报已复制，可以发给饭搭子了" : "分享失败，请稍后再试", !ok);
}

function modalByName(name) {
  return {
    detail: els.detailModal,
    store: els.storeModal,
    info: els.infoModal,
    steward: els.stewardModal,
  }[name];
}

function openModal(name) {
  const modal = modalByName(name);
  if (!modal) return;
  state.lastFocus = document.activeElement;
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  const close = $(".modal-close", modal);
  if (close) close.focus({ preventScroll: true });
}

function closeModal(name) {
  const modal = modalByName(name);
  if (!modal) return;
  modal.classList.add("hidden");
  if (name === "steward") {
    stopOrderPolling();
  }
  const anyOpen = [els.detailModal, els.storeModal, els.infoModal, els.stewardModal]
    .some((item) => item && !item.classList.contains("hidden"));
  if (!anyOpen) document.body.classList.remove("modal-open");
  if (state.lastFocus && typeof state.lastFocus.focus === "function") {
    state.lastFocus.focus({ preventScroll: true });
  }
}

function closeAllModals() {
  ["detail", "store", "info", "steward"].forEach(closeModal);
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
    enterStewardFlow();
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

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || "请求失败，请稍后重试");
    error.code = data.code;
    error.status = response.status;
    throw error;
  }
  return data;
}

function buildInput() {
  return {
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
  };
}

// ---------------- 麦当劳 MCP 接入 ----------------

const LIVE_PILL_TEXT = {
  demo: "演示数据",
  live: "实时已连接",
  checking: "校验中…",
  error: "校验失败",
  disabled: "接入已关闭",
};

const LIVE_ERROR_HINT = {
  TOKEN_MISSING: "请先粘贴你自己的 MCP Token。",
  TOKEN_TOO_SHORT: "Token 看起来不完整，确认整段复制后再试。",
  TOKEN_TOO_LONG: "Token 超过 512 个字符，只粘贴 Token 本身。",
  TOKEN_FORMAT: "Token 中间不能有空格、换行或多余字符。",
  INVALID_TOKEN: "授权失败：Token 校验未通过（401），可能已失效或复制不全，请重新生成。",
  IDENTITY_FAILED: "已连上 MCP，但读不到你的账号身份。请在开放平台确认已开通账号读取权限。",
  TIMEOUT: "授权超时：连接 MCP 太慢，检查服务端网络或稍后重试。",
  NETWORK: "服务端访问不了 mcp.mcd.cn，检查网络、防火墙或代理。",
  CONNECT_FAILED: "连接 MCP 失败，稍后重试；反复失败请查看服务端日志。",
  CONSENT_REQUIRED: "请先勾选授权说明，才可以用你的账号下单。",
  SETUP_DISABLED: "当前部署关闭了页面绑定，请联系部署者。",
  CROSS_ORIGIN: "请求来源不被接受，请从本站页面操作。",
  RATE_LIMITED: "操作太频繁，等一分钟再试。",
  OWNER_MISMATCH: "这笔记录属于另一个浏览器身份（Cookie 被清除或被拦截）。已为你重新算一单，请再确认一次。",
  OWN_TOKEN_REQUIRED: "体验模式不能下单。绑定你自己的 Token 后，系统才会用你的账号提交订单。",
};

const MODE_COPY = {
  own: {
    pill: "已绑定我的账号",
    title: "已授权：下单使用你自己的账号",
    text: "报价、领券、订单都走你绑定的身份；每单仍需你点确认，不会自动付款。",
  },
  host: {
    pill: "体验模式",
    title: "体验模式：我方 MCP 只读",
    text: "可以真实算价、看菜单，但下单会被拦截。绑定你自己的 Token 后才能用你的账号提交订单。",
  },
  none: {
    pill: "演示数据",
    title: "演示数据：未连接 MCP",
    text: "当前没有可用的 MCP 连接，算价使用演示数据；绑定你自己的 Token 后切换为真实数据。",
  },
};

function renderLiveFeedback(message, kind = "error") {
  if (!els.liveFeedback) return;
  els.liveFeedback.classList.remove("hidden", "is-ok", "is-error");
  els.liveFeedback.classList.add(kind === "ok" ? "is-ok" : "is-error");
  els.liveFeedback.textContent = message;
}

function clearLiveFeedback() {
  if (!els.liveFeedback) return;
  els.liveFeedback.classList.add("hidden");
  els.liveFeedback.classList.remove("is-ok", "is-error");
  els.liveFeedback.textContent = "";
}

function renderAuthState(binding, mode) {
  const copy = MODE_COPY[mode] || MODE_COPY.none;
  if (els.authState) els.authState.dataset.mode = mode;
  if (els.authStateTitle) els.authStateTitle.textContent = copy.title;
  if (els.authStateText) els.authStateText.textContent = copy.text;
  if (els.authStateIcon) els.authStateIcon.textContent = mode === "own" ? "✓" : mode === "host" ? "i" : "!";
  if (els.livePill) {
    els.livePill.dataset.state = mode === "own" ? "live" : mode === "host" ? "host" : "demo";
    els.livePill.textContent = copy.pill;
  }
  const bound = mode === "own" && Boolean(binding);
  if (els.identityPanel) els.identityPanel.classList.toggle("hidden", !bound);
  if (els.liveSteps) els.liveSteps.classList.toggle("hidden", bound);
  if (bound) {
    const identity = binding.identity || {};
    const nickname = identity.nickname || "已授权的麦当劳账号";
    if (els.identityName) els.identityName.textContent = nickname;
    if (els.identityAvatar) els.identityAvatar.textContent = (nickname[0] || "M").toUpperCase();
    if (els.identityMeta) {
      const parts = [];
      if (identity.memberNo) parts.push(`会员号 ${identity.memberNo}`);
      if (identity.level) parts.push(identity.level);
      if (binding.boundAt) parts.push(`绑定于 ${formatDateTime(binding.boundAt)}`);
      els.identityMeta.textContent = parts.join(" · ") || "身份已读取";
    }
    if (els.identityToken) els.identityToken.textContent = binding.tokenTail ? `••••${binding.tokenTail}` : "••••";
    if (els.identityBadge) {
      const expired = binding.status && binding.status !== "active";
      els.identityBadge.textContent = expired ? "授权已失效" : "已授权";
      els.identityBadge.classList.toggle("is-expired", Boolean(expired));
    }
  }
  if (els.liveDisconnect) els.liveDisconnect.classList.toggle("hidden", !Boolean(binding));
}

function renderLiveStatus(status) {
  if (!els.livePill || !status) return;
  state.live.status = status;
  const checking = state.live.busy;
  const mode = status.mode || (status.connected ? "own" : "host");
  renderAuthState(status.binding || null, checking ? "none" : mode);
  if (checking && els.authStateTitle) {
    els.authStateTitle.textContent = "正在绑定并校验你的账号…";
    els.authStateText.textContent = "正在连接 MCP 并读取账号身份，请稍候。";
    els.livePill.dataset.state = "checking";
    els.livePill.textContent = "校验中…";
  }
  const disabled = !status.setupEnabled || checking;
  if (els.liveSave) {
    els.liveSave.disabled = disabled || !state.live.consent;
    els.liveSave.textContent = mode === "own" ? "重新绑定" : "绑定我的账号";
  }
  if (els.liveToken) els.liveToken.disabled = disabled;
  if (els.liveConsent) els.liveConsent.disabled = disabled;
  if (els.liveSetup) els.liveSetup.classList.toggle("is-busy", checking);
}

async function loadLiveStatus() {
  try {
    const data = await api("api/account/binding");
    state.live.binding = data;
    renderLiveStatus({
      setupEnabled: data.setupEnabled,
      mode: data.mode,
      binding: data.binding,
      connected: data.mode === "own",
    });
    if (!data.setupEnabled) {
      renderLiveFeedback(LIVE_ERROR_HINT.SETUP_DISABLED, "error");
    } else if (data.mode === "own") {
      const at = data.binding?.boundAt ? ` · 绑定于 ${formatDateTime(data.binding.boundAt)}` : "";
      renderLiveFeedback(`已用你的账号授权，下单将以你的身份提交${at}。`, "ok");
    } else if (data.session?.lastError?.code) {
      renderLiveFeedback(
        LIVE_ERROR_HINT[data.session.lastError.code] || data.session.lastError.message,
        "error",
      );
    } else if (data.mode === "host") {
      renderLiveFeedback("当前是体验模式：能真实算价，但下单需要先绑定你自己的 Token。", "ok");
    }
    return data;
  } catch {
    renderLiveStatus({ setupEnabled: true, mode: "none", binding: null });
    renderLiveFeedback("无法读取授权状态，刷新页面重试；算价仍可用。", "error");
    return null;
  }
}

async function saveLiveToken(event) {
  event?.preventDefault();
  if (state.live.busy) return;
  const token = els.liveToken?.value?.trim() || "";
  if (!token) {
    renderLiveFeedback(LIVE_ERROR_HINT.TOKEN_MISSING, "error");
    els.liveToken?.focus();
    return;
  }
  if (!state.live.consent) {
    renderLiveFeedback(LIVE_ERROR_HINT.CONSENT_REQUIRED, "error");
    els.liveConsent?.focus();
    return;
  }
  state.live.busy = true;
  clearLiveFeedback();
  renderLiveStatus(state.live.status || { setupEnabled: true, mode: "host" });
  try {
    const data = await api("api/account/bind", {
      method: "POST",
      body: JSON.stringify({ token, consent: true }),
    });
    state.live.busy = false;
    if (els.liveToken) {
      els.liveToken.value = "";
      els.liveToken.type = "password";
    }
    if (els.liveReveal) els.liveReveal.textContent = "显示";
    state.live.consent = false;
    if (els.liveConsent) els.liveConsent.checked = false;
    renderLiveStatus({ setupEnabled: true, mode: data.mode, binding: data.binding, connected: true });
    const name = data.identity?.nickname || "你的账号";
    renderLiveFeedback(`绑定成功：之后下单会使用「${name}」的身份，且只有你确认才提交。`, "ok");
    showToast("已绑定你的麦当劳账号");
    await loadBootstrap();
    resetAfterModeSwitch();
  } catch (error) {
    state.live.busy = false;
    const hint = LIVE_ERROR_HINT[error.code] || error.message || "绑定失败，请稍后重试";
    renderLiveStatus(state.live.status || { setupEnabled: true, mode: "host", binding: null });
    renderLiveFeedback(hint, "error");
    els.liveToken?.focus();
  }
}

async function disconnectLive() {
  if (state.live.busy) return;
  if (!window.confirm("解绑后本机不再保存你的 Token，下单会回到体验模式。确认解绑？")) return;
  state.live.busy = true;
  renderLiveStatus(state.live.status || { setupEnabled: true, mode: "own" });
  try {
    const data = await api("api/account/unbind", { method: "POST", body: "{}" });
    state.live.busy = false;
    const next = await loadLiveStatus();
    renderLiveFeedback(
      `已解绑。当前为${next?.mode === "host" ? "体验" : "演示"}模式，${data.message || ""}`.trim(),
      "ok",
    );
    showToast("已解绑你的账号");
    await loadBootstrap();
    resetAfterModeSwitch();
  } catch (error) {
    state.live.busy = false;
    renderLiveStatus(state.live.status || { setupEnabled: true, mode: "host", binding: null });
    renderLiveFeedback(error.message, "error");
  }
}

function toggleLiveToken() {
  if (!els.liveToken) return;
  const revealed = els.liveToken.type === "text";
  state.live.revealed = !revealed;
  els.liveToken.type = revealed ? "password" : "text";
  els.liveReveal.textContent = revealed ? "显示" : "隐藏";
}

// 未绑定就去下单时，把用户带到绑定卡片，而不是只丢一句报错。
function promptBindAccount(message) {
  showToast(message || LIVE_ERROR_HINT.OWN_TOKEN_REQUIRED, true);
  const card = els.liveSetup;
  if (card) {
    card.classList.add("is-highlight");
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => card.classList.remove("is-highlight"), 2200);
  }
  setTimeout(() => els.liveToken?.focus(), 320);
  if (els.stewardModal && !els.stewardModal.classList.contains("hidden")) closeModal("steward");
}

// 切换数据模式后旧的方案/报价/订单都不再成立，直接清空主路径结果。
function resetAfterModeSwitch() {
  stopOrderPolling();
  clearInterval(state.steward.tickTimer);
  state.steward.tickTimer = null;
  state.steward.phase = "hidden";
  state.steward.confirmOpen = false;
  state.steward.showSubForm = false;
  state.quote = null;
  state.quoteTokens = null;
  state.order = null;
  state.quoteExpired = false;
  state.result = null;
  if (els.results) els.results.classList.add("hidden");
  if (els.warnings) els.warnings.classList.add("hidden");
  if (els.stickyBar) els.stickyBar.classList.add("hidden");
  renderStewardStrip();
}

function executionBadge() {
  const caps = state.capabilities || {};
  if (caps.access === "own" && caps.writeMode === "private") {
    return '<span class="execution-badge is-live">我的账号 · 确认后下单</span>';
  }
  if (caps.access === "host") {
    return '<span class="execution-badge is-locked">体验模式 · 绑定后可下单</span>';
  }
  if (caps.writeMode === "demo") {
    return '<span class="execution-badge is-demo">演示执行 · 不写真实账户</span>';
  }
  return '<span class="execution-badge is-locked">只读模式</span>';
}

function orderStatusLabel(status) {
  return {
    pending_payment: "待支付",
    paid: "已支付",
    cancelled: "已取消",
    expired: "已过期",
    failed: "失败",
  }[status] || status || "未知";
}

function formatDateTime(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function countdownText(ms) {
  if (ms <= 0) return "已过期";
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function modeText(mode) {
  return mode === "delivery" ? "麦乐送" : "到店自取";
}

// ---------------- 省单管家 ----------------

const STEWARD_KEY = "maimen-save-one-steward-v1";
const RECONCILE_THROTTLE_MS = 30_000;

const STEWARD_COPY = {
  hidden: ["管家待命", "算一单，剩下的交给管家"],
  preparing: ["管家正在备单…", "锁定门店、餐品、券和金额"],
  ready: ["管家已接管 · 已自动备单", ""],
  refreshing: ["管家正在续期报价…", "价格不变时不用重新确认"],
  ordered: ["订单待支付 · 状态自动轮询中", ""],
  expired: ["报价已过期", "让管家重新备单"],
  error: ["备单失败，可手动重试", "不影响算价和手动下单"],
};

const STEWARD_ACTION = {
  ready: { label: "确认下单", action: "confirm" },
  ordered: { label: "去支付", action: "pay" },
  expired: { label: "重新备单", action: "prepare" },
  error: { label: "重试备单", action: "prepare" },
  preparing: { label: "备单中…", action: "" },
  refreshing: { label: "续期中…", action: "" },
};

const TODO_ACTION = {
  payment_due: { label: "去支付", action: "todo-pay" },
  quote_expiry: { label: "续报价", action: "todo-refresh" },
  duplicate_orders: { label: "查看对账", action: "todo-reconcile" },
  subscription_limit: { label: "管理套餐", action: "todo-subs" },
  coupon_expiry: { label: "去下单", action: "todo-order" },
};

const PIPELINE_TAG = { done: "已完成", demo: "演示", pending: "等待", failed: "失败" };

function loadStewardPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(STEWARD_KEY) || "{}");
    Object.assign(state.steward.auto, raw.auto || {});
    state.steward.lastRunAt = raw.lastRunAt || {};
  } catch {
    // 本地偏好损坏时保持默认值
  }
}

function saveStewardPrefs() {
  try {
    localStorage.setItem(
      STEWARD_KEY,
      JSON.stringify({ auto: state.steward.auto, lastRunAt: state.steward.lastRunAt }),
    );
  } catch {
    // 隐私模式写入失败时忽略
  }
}

function markAutomationRun(id) {
  state.steward.lastRunAt[id] = new Date().toISOString();
  saveStewardPrefs();
}

function autoOn(id) {
  return state.steward.auto[id] !== false;
}

function stewardMetaLine(phase) {
  const parts = [];
  if (phase === "ready" || phase === "refreshing" || phase === "expired") {
    const left = state.quote ? Date.parse(state.quote.expiresAt) - Date.now() : 0;
    parts.push(left > 0 ? `报价 ${countdownText(left)}` : "报价已过期");
    if (state.quote?.plan?.coupon) {
      parts.push(state.quote.couponClaimed ? "券已领" : state.steward.gateNote.autoClaim || "券待领");
    } else {
      parts.push("无需领券");
    }
  }
  if (phase === "ordered" && state.order) {
    parts.push(money(state.order.amountCents));
    parts.push(orderStatusLabel(state.order.status));
    parts.push(state.order.demo ? "演示单" : "我的账号提交");
  }
  parts.push(state.dataMode === "live" ? "实时数据" : "演示数据");
  return parts.join(" · ");
}

function setPhase(phase) {
  state.steward.phase = phase;
  renderStewardStrip();
}

function renderStewardStrip() {
  if (!els.stewardStrip) return;
  if (state.steward.failed && !state.quote && !state.order) {
    els.stewardStrip.hidden = true;
    return;
  }
  const phase = state.steward.phase;
  els.stewardStrip.hidden = phase === "hidden";
  els.stewardStrip.dataset.phase = phase;
  const [title, fallbackMeta] = STEWARD_COPY[phase] || STEWARD_COPY.hidden;
  els.stewardStripTitle.textContent = title;
  els.stewardStripMeta.textContent = stewardMetaLine(phase) || fallbackMeta;
  const action = STEWARD_ACTION[phase];
  els.stewardPrimaryBtn.textContent = action ? action.label : "确认下单";
  els.stewardPrimaryBtn.disabled = !action || !action.action || state.steward.busy;
  els.stewardPrimaryBtn.dataset.stewardAction = action?.action || "";
  els.stewardConfirm.classList.toggle("hidden", !state.steward.confirmOpen);
  els.stewardConfirm.innerHTML = state.steward.confirmOpen ? stewardConfirmHtml() : "";
}

function writeNeedsUnlock() {
  const caps = state.capabilities || {};
  return caps.writeMode === "private" && !caps.unlocked && Boolean(caps.writePasscodeRequired);
}

function stewardConfirmHtml() {
  const quote = state.quote;
  if (!quote) return "";
  const plan = quote.plan;
  const coupon = plan.coupon;
  const locked = writeNeedsUnlock();
  const action = locked
    ? `
      <div class="steward-confirm-unlock">
        <label for="confirmPasscode">实时下单已锁定，输入私有模式口令后即可生成待支付订单</label>
        <div class="live-input-row">
          <input id="confirmPasscode" type="password" autocomplete="off" placeholder="私有模式口令">
          <button type="button" class="select-button" data-steward-action="unlock-confirm" ${state.steward.busy ? "disabled" : ""}>解锁并下单</button>
        </div>
      </div>`
    : `<button type="button" class="select-button" data-steward-action="confirm-create" ${state.steward.busy ? "disabled" : ""}>确认生成待支付订单</button>`;
  return `
    <b>确认这一单</b>
    <div class="steward-confirm-rows">
      <div><span>方案</span><b>${escapeHtml(plan.label)}</b></div>
      <div><span>门店</span><b>${escapeHtml(quote.store?.name || "")}</b></div>
      <div><span>取餐</span><b>${modeText(plan.mode)}</b></div>
      <div><span>优惠券</span><b>${coupon ? (quote.couponClaimed ? `已领 · ${escapeHtml(coupon.name)}` : `待领 · ${escapeHtml(coupon.name)}`) : "无"}</b></div>
      <div><span>实付</span><b>${money(plan.price.finalCents)}</b></div>
    </div>
    <div class="steward-confirm-actions">
      ${action}
      <button type="button" class="text-button" data-steward-action="confirm-cancel">再想想</button>
    </div>`;
}

async function fetchSteward() {
  try {
    const data = await api("api/steward");
    state.steward.view = data;
    state.steward.failed = false;
    return data;
  } catch {
    state.steward.failed = true;
    return null;
  }
}

async function prepareQuote({ force = false } = {}) {
  const plan = selectedPlan();
  if (!plan || !state.result) throw new Error("先算一单再备单");
  const samePlan = state.quote && state.quote.planId === plan.id;
  const fresh = samePlan && Date.parse(state.quote.expiresAt) - Date.now() > 30_000;
  if (!force && fresh) return state.quote;
  const data = await api("api/quote", {
    method: "POST",
    body: JSON.stringify({ input: buildInput(), planId: plan.id }),
  });
  state.quote = data.quote;
  state.quoteTokens = data.tokens;
  state.capabilities = data.capabilities || state.capabilities;
  state.quoteExpired = false;
  renderStewardStrip();
  return state.quote;
}

async function autoClaimCoupon() {
  const quote = state.quote;
  const caps = state.capabilities || {};
  if (!quote?.plan?.coupon || quote.couponClaimed) return;
  if (!caps.couponClaim) {
    state.steward.gateNote.autoClaim = "待解锁";
    return;
  }
  try {
    const data = await api("api/coupons/claim", {
      method: "POST",
      body: JSON.stringify({ quoteId: quote.id, token: state.quoteTokens.claim }),
    });
    state.quote = data.quote;
    state.capabilities = data.capabilities || state.capabilities;
    markAutomationRun("autoClaim");
  } catch {
    // 领券失败保留手动入口，不阻塞下单
  }
}

async function enterStewardFlow() {
  if (!autoOn("autoPrepare")) {
    setPhase("hidden");
    return;
  }
  setPhase("preparing");
  try {
    await prepareQuote({ force: true });
    markAutomationRun("autoPrepare");
    setPhase("ready");
    if (autoOn("autoClaim")) await autoClaimCoupon();
    setPhase("ready");
    startStewardTimer();
    fetchSteward();
  } catch {
    setPhase("error");
  }
}

function startStewardTimer() {
  clearInterval(state.steward.tickTimer);
  state.steward.tickTimer = setInterval(() => {
    const phase = state.steward.phase;
    if (phase !== "ready" && phase !== "refreshing" && phase !== "ordered") return;
    if (phase === "ready") {
      const left = state.quote ? Date.parse(state.quote.expiresAt) - Date.now() : 0;
      els.stewardStripMeta.textContent = stewardMetaLine("ready");
      if (left <= 0) {
        setPhase("expired");
        if (!els.stewardModal.classList.contains("hidden")) renderSteward();
      } else if (left < 30_000 && autoOn("autoRefresh")) refreshQuote();
    }
    const modalCountdown = $("#quoteCountdown");
    if (modalCountdown && state.quote) {
      modalCountdown.textContent = countdownText(Date.parse(state.quote.expiresAt) - Date.now());
    }
  }, 1000);
}

async function refreshQuote() {
  if (state.steward.refreshLock) return;
  if (!state.result) {
    // 刷新过页面后本地没有方案，重新算一单即会自动走完整管家流程。
    await optimizeNow();
    return;
  }
  state.steward.refreshLock = true;
  setPhase("refreshing");
  try {
    await prepareQuote({ force: true });
    markAutomationRun("autoRefresh");
    if (autoOn("autoClaim")) await autoClaimCoupon();
    setPhase(state.order ? "ordered" : "ready");
    if (!els.stewardModal.classList.contains("hidden")) renderSteward();
  } catch {
    setPhase("expired");
  } finally {
    state.steward.refreshLock = false;
    renderStewardStrip();
  }
}

async function requestOrder() {
  if (state.steward.phase === "ordered") {
    openSteward();
    return;
  }
  if (!state.result) {
    showToast("先算一单，再确认下单", true);
    return;
  }
  const caps = state.capabilities || {};
  if (caps.needsOwnToken) {
    promptBindAccount();
    return;
  }
  if (!state.quote) {
    setPhase("preparing");
    try {
      await prepareQuote({ force: true });
      setPhase("ready");
    } catch {
      setPhase("error");
      return;
    }
  }
  state.steward.confirmOpen = true;
  renderStewardStrip();
  els.stewardConfirm.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function confirmOrderAction() {
  if (state.steward.busy) return;
  state.steward.busy = true;
  renderStewardStrip();
  try {
    if (!state.quote || !state.quoteTokens) {
      await prepareQuote({ force: true });
      if (!state.quote || !state.quoteTokens) throw new Error("报价尚未就绪，请重试");
    }
    const data = await api("api/orders", {
      method: "POST",
      body: JSON.stringify({ quoteId: state.quote.id, token: state.quoteTokens.order }),
    });
    state.order = data.order;
    state.steward.confirmOpen = false;
    setPhase("ordered");
    startOrderPolling();
    if (autoOn("autoReconcile")) reconcileSilently();
    fetchSteward();
    loadReminders(true);
    if (!els.stewardModal.classList.contains("hidden")) renderSteward();
    showToast("订单已创建，请核对支付页");
  } catch (error) {
    if (error.code === "PRICE_CHANGED" || error.code === "QUOTE_EXPIRED" || error.code === "QUOTE_NOT_FOUND") {
      state.quote = null;
      state.quoteTokens = null;
      try {
        await prepareQuote({ force: true });
        state.steward.confirmOpen = true;
        setPhase("ready");
      } catch {
        setPhase("error");
      }
      showToast(error.code === "PRICE_CHANGED" ? "价格已变化，请重新确认" : "报价已更新，请重新确认", true);
      return;
    }
    if (error.code === "OWN_TOKEN_REQUIRED") {
      state.steward.confirmOpen = false;
      promptBindAccount(error.message);
      return;
    }
    if (error.code === "OWNER_MISMATCH") {
      // Cookie 丢失导致身份变了：重新走一遍完整算单，而不是让用户反复点确认。
      state.quote = null;
      state.quoteTokens = null;
      state.steward.confirmOpen = false;
      setPhase("hidden");
      showToast(LIVE_ERROR_HINT.OWNER_MISMATCH, true);
      await optimizeNow();
      return;
    }
    if (error.code === "WRITE_LOCKED" || error.status === 401) {
      await loadCapabilities();
      state.steward.confirmOpen = true;
      showToast("实时下单需要先解锁私有模式，请在确认卡里输入口令", true);
      setTimeout(() => $("#confirmPasscode")?.focus(), 60);
      return;
    }
    showToast(error.message, true);
  } finally {
    state.steward.busy = false;
    renderStewardStrip();
  }
}

// 在确认卡里直接解锁，解锁成功后自动继续生成待支付订单（仍需用户点了才下单）。
async function unlockAndConfirm() {
  const input = $("#confirmPasscode");
  const passcode = input?.value?.trim();
  if (!passcode) {
    showToast("请输入私有模式口令", true);
    input?.focus();
    return;
  }
  if (state.steward.busy) return;
  state.steward.busy = true;
  renderStewardStrip();
  try {
    await api("api/private/unlock", {
      method: "POST",
      body: JSON.stringify({ passcode }),
    });
    await loadCapabilities();
    // 解锁前领券会被拒；解锁后先把最优券领到账号，避免 create-order 因券未绑定而重新核价。
    if (autoOn("autoClaim")) await autoClaimCoupon();
    state.steward.busy = false;
    renderStewardStrip();
    if (!els.stewardModal.classList.contains("hidden")) renderSteward();
    showToast("私有模式已解锁，正在生成待支付订单");
    await confirmOrderAction();
  } catch (error) {
    state.steward.busy = false;
    renderStewardStrip();
    showToast(error.message || "解锁失败，请检查口令", true);
    $("#confirmPasscode")?.focus();
  }
}

async function reconcileSilently() {
  if (Date.now() - state.steward.lastReconcileAt < RECONCILE_THROTTLE_MS) return;
  state.steward.lastReconcileAt = Date.now();
  try {
    const data = await api("api/orders/reconcile", { method: "POST", body: "{}" });
    if (data.cancelled > 0) {
      markAutomationRun("autoReconcile");
      showToast(`已自动取消 ${data.cancelled} 个重复未支付订单`);
      if (state.order && state.order.status === "pending_payment") {
        try {
          const fresh = await api(`api/orders/${encodeURIComponent(state.order.id)}`);
          state.order = fresh.order;
        } catch {
          // 订单已不在时保持原状态，管家中心可手动刷新
        }
      }
      loadReminders(true);
      renderStewardStrip();
      if (!els.stewardModal.classList.contains("hidden")) renderSteward();
    }
  } catch {
    // 对账失败静默，管家中心仍可手动触发
  }
}

function openOrderPay() {
  const payUrl = safeExternalUrl(state.order?.payUrl);
  if (!payUrl) {
    if (!els.stewardModal.classList.contains("hidden")) {
      showToast("这笔订单没有官方支付链接，请在麦当劳官方渠道核对", true);
    } else {
      openSteward();
      showToast("这笔订单没有官方支付链接，请在订单卡里核对", true);
    }
    return;
  }
  window.open(payUrl, "_blank", "noopener,noreferrer");
}

function stewardUnlockHtml() {
  const caps = state.capabilities || {};
  if (!(caps.writeMode === "private" && !caps.unlocked && caps.writePasscodeRequired)) return "";
  return `
    <div class="unlock-box">
      <div>
        <b>实时写操作已锁定</b>
        <p>输入私有模式口令后，领券和下单仍受金额、频次和 kill switch 限制。</p>
      </div>
      <div class="inline-row">
        <input id="privatePasscode" type="password" autocomplete="off" placeholder="私有模式口令">
        <button type="button" class="mini-button mini-button-red" data-steward-action="unlock">解锁</button>
      </div>
    </div>`;
}

function quoteStepsHtml(quote) {
  const plan = quote.plan;
  const coupon = plan.coupon;
  const claimed = Boolean(quote.couponClaimed);
  const caps = state.capabilities || {};
  const expired = Date.parse(quote.expiresAt) <= Date.now() || state.steward.phase === "expired";
  const canClaim = Boolean(coupon) && !claimed && !expired && caps.couponClaim;
  return `
    <div class="execution-steps">
      <div class="execution-step is-done">
        <span class="step-index">1</span>
        <div class="step-main"><b>报价快照已生成</b><small>管家自动完成 · 锁定门店、餐品、券和金额</small></div>
        <span class="step-state">已锁定</span>
      </div>
      <div class="execution-step ${claimed || !coupon ? "is-done" : ""}">
        <span class="step-index">2</span>
        <div class="step-main"><b>领取最优券</b><small>${coupon ? (claimed ? "已领取，可在本单使用" : `当前最优券：${escapeHtml(coupon.name)}`) : "当前方案无需领券"}</small></div>
        ${coupon && !claimed && !expired
          ? `<button type="button" class="mini-button" data-steward-action="claim-coupon" ${canClaim ? "" : "disabled"}>${caps.couponClaim ? "领取" : "未开启"}</button>`
          : `<span class="step-state">${coupon ? "已完成" : "无需操作"}</span>`}
      </div>
      <div class="execution-step">
        <span class="step-index">3</span>
        <div class="step-main"><b>创建待支付订单</b><small>${expired ? "报价已过期，先重新备单" : "确认卡核对金额与门店后生成"}</small></div>
        ${expired
          ? '<span class="step-state">待备单</span>'
          : `<button type="button" class="mini-button" data-steward-action="confirm">确认下单</button>`}
      </div>
      <div class="execution-step">
        <span class="step-index">4</span>
        <div class="step-main"><b>完成支付</b><small>支付在麦当劳官方渠道完成，本页只做状态轮询</small></div>
        <span class="step-state">待订单</span>
      </div>
    </div>`;
}

function orderCardHtml(order) {
  const payUrl = safeExternalUrl(order.payUrl);
  const kicker =
    order.status === "paid"
      ? "已完成订单"
      : order.status === "cancelled"
        ? "已取消订单"
        : "待支付订单";
  const help =
    order.status === "paid"
      ? "演示支付已完成；实时模式以麦当劳官方支付状态为准。"
      : order.status === "cancelled"
        ? "订单已取消，不会继续扣款。"
        : payUrl
          ? "支付链接由麦当劳官方返回；请核对金额后再支付。"
          : "演示订单不会产生真实扣款；可点击模拟支付验证状态轮询。";
  return `
    <div class="order-card">
      <div class="order-head">
        <div>
          <p class="card-kicker">${kicker}</p>
          <h3>${escapeHtml(order.id)}</h3>
        </div>
        <span class="order-status status-${escapeAttr(order.status)}">${orderStatusLabel(order.status)}</span>
      </div>
      <div class="order-meta">
        <span>${money(order.amountCents)}</span>
        <span>${escapeHtml(order.store?.name || "")}</span>
        <span>${modeText(order.plan?.mode)}</span>
        <span class="order-owner">${order.demo ? "演示单 · 未提交真实账户" : "已用你的账号提交 · 待你支付"}</span>
      </div>
      <div class="order-actions">
        ${payUrl ? `<button type="button" class="mini-button mini-button-red" data-steward-action="pay-link">打开官方支付</button>` : ""}
        ${order.demo && order.status === "pending_payment" ? '<button type="button" class="mini-button" data-steward-action="mock-pay">模拟支付成功</button>' : ""}
        ${order.status === "pending_payment" ? '<button type="button" class="ghost-button" data-steward-action="cancel-order">取消未支付订单</button>' : ""}
        <button type="button" class="ghost-button" data-steward-action="refresh-order">刷新状态</button>
      </div>
      <p class="order-help">${help}</p>
    </div>`;
}

function quoteCardHtml(quote) {
  const plan = quote.plan;
  const left = Date.parse(quote.expiresAt) - Date.now();
  const badge = left > 0
    ? `剩 <span id="quoteCountdown">${countdownText(left)}</span>`
    : "已过期";
  return `
    <div class="steward-quote-card">
      <div class="steward-quote-head">
        <div>
          <b>${money(plan.price.finalCents)}</b>
          <div class="steward-quote-meta">
            <span>${escapeHtml(plan.label)}</span>
            <span>${escapeHtml(quote.store?.name || "")}</span>
            <span>${modeText(plan.mode)}</span>
          </div>
        </div>
        <span class="order-status ${left > 0 ? "status-pending_payment" : "status-cancelled"}">${badge}</span>
      </div>
    </div>`;
}

function lastQuoteHtml(lastQuote) {
  const expired = lastQuote.status !== "quoted";
  return `
    <div class="steward-quote-card">
      <div class="steward-quote-head">
        <div>
          <b>${money(lastQuote.finalCents)}</b>
          <div class="steward-quote-meta">
            <span>${escapeHtml(lastQuote.planLabel || "上次报价")}</span>
            <span>创建于 ${formatDateTime(lastQuote.createdAt)}</span>
          </div>
        </div>
        <span class="order-status status-cancelled">${expired ? "已失效" : "上次报价"}</span>
      </div>
      <p class="form-help">页面刷新后本地确认令牌会失效，下单前需要重新备单；管家会自动核价，价格变化会让你重新确认。</p>
      <div class="modal-actions">
        <button type="button" class="select-button" data-steward-action="prepare">重新备单</button>
      </div>
    </div>`;
}

function lastOrderHtml(lastOrder) {
  return `
    <div class="steward-quote-card">
      <div class="steward-quote-head">
        <div>
          <b>${money(lastOrder.amountCents)}</b>
          <div class="steward-quote-meta">
            <span>订单 ${escapeHtml(lastOrder.id.slice(0, 12))}</span>
            <span>创建于 ${formatDateTime(lastOrder.createdAt)}</span>
          </div>
        </div>
        <span class="order-status status-${escapeAttr(lastOrder.status)}">${orderStatusLabel(lastOrder.status)}</span>
      </div>
      <p class="form-help">刷新页面后本地订单上下文会丢失；这里读的是服务端记录，可以重新接管继续轮询。</p>
      <div class="modal-actions">
        <button type="button" class="select-button" data-steward-action="restore-order">重新接管这笔订单</button>
      </div>
    </div>`;
}

async function restoreLastOrder() {
  const id = state.steward.view?.lastOrder?.id;
  if (!id) return;
  try {
    const data = await api(`api/orders/${encodeURIComponent(id)}`);
    state.order = data.order;
    setPhase("ordered");
    if (state.order.status === "pending_payment") startOrderPolling();
    renderSteward();
    showToast(`订单状态：${orderStatusLabel(state.order.status)}`);
  } catch (error) {
    showToast(error.message, true);
  }
}

function subscriptionFormHtml() {
  const quote = state.quote;
  if (!state.steward.showSubForm || !quote) return "";
  return `
    <div class="inline-form">
      <div class="inline-form-head">
        <b>存为固定套餐</b>
        <button type="button" class="text-button" data-steward-action="hide-sub-form">收起</button>
      </div>
      <div class="form-grid">
        <label>单次金额上限（元）<input id="subMaxAmount" type="number" min="1" max="200" step="1" value="${(quote.plan.price.finalCents / 100).toFixed(0)}"></label>
        <label>每日最多复购次数<input id="subRuns" type="number" min="1" max="10" step="1" value="1"></label>
        <label>复购间隔（分钟）<input id="subInterval" type="number" min="1" max="10080" step="1" value="1440"></label>
      </div>
      <label class="check-row">
        <input id="subAutoOrder" type="checkbox">
        <span>允许自动复购（仅单用户私有模式生效，演示模式只模拟）</span>
      </label>
      <p class="form-help">自动复购会在达到每日次数上限后自动关闭，随时可在管家中心关闭。</p>
      <button type="button" class="select-button" data-steward-action="save-sub">保存固定套餐</button>
    </div>`;
}

function stewardOrderSection() {
  const order = state.order;
  const quote = state.quote;
  if (order) {
    return `
      ${orderCardHtml(order)}
      ${stewardUnlockHtml()}
      <div class="modal-actions">
        <button type="button" class="ghost-button" data-steward-action="refresh-order">刷新状态</button>
        <button type="button" class="ghost-button" data-steward-action="reconcile">一键对账</button>
      </div>`;
  }
  if (quote) {
    return `
      ${quoteCardHtml(quote)}
      ${quoteStepsHtml(quote)}
      ${state.steward.confirmOpen ? `<div class="steward-confirm">${stewardConfirmHtml()}</div>` : ""}
      ${stewardUnlockHtml()}
      <div class="modal-actions">
        <button type="button" class="ghost-button" data-steward-action="copy-quote">复制清单</button>
        <button type="button" class="ghost-button" data-steward-action="show-sub-form">存为固定套餐</button>
        <button type="button" class="ghost-button" data-steward-action="prepare">重新备单</button>
      </div>
      ${subscriptionFormHtml()}`;
  }
  const view = state.steward.view;
  const lastOrder = view?.lastOrder;
  const lastQuote = view?.lastQuote;
  if (lastOrder && (!lastQuote || Date.parse(lastOrder.createdAt || 0) >= Date.parse(lastQuote.createdAt || 0))) {
    return lastOrderHtml(lastOrder);
  }
  if (lastQuote) return lastQuoteHtml(lastQuote);
  return `
    <div class="empty-state">
      <p class="card-kicker">这一单</p>
      <h3>还没有在管的单</h3>
      <p>先在上面点一次「一键算最省」，管家会自动备单、领券并盯住报价有效期。</p>
    </div>`;
}

function todoListHtml() {
  const unread = state.reminders.filter((reminder) => !reminder.read).slice(0, 12);
  if (!unread.length) {
    return '<p class="empty-copy">暂无待办。报价、支付和券到期时会在这里出现。</p>';
  }
  return `<div class="reminder-list">${unread
    .map((reminder) => {
      const action = TODO_ACTION[reminder.type];
      return `
        <div class="reminder-item ${reminder.due ? "is-due" : ""}">
          <span class="reminder-type">${reminderTypeLabel(reminder.type)}</span>
          <div class="reminder-main">
            <b>${escapeHtml(reminder.title)}</b>
            <p>${escapeHtml(reminder.body)}</p>
            <small>${formatDateTime(reminder.dueAt)}${reminder.due ? " · 已到提醒时间" : ""}</small>
          </div>
          <div class="reminder-actions">
            ${action ? `<button type="button" class="mini-button mini-button-red" data-steward-action="${action.action}">${action.label}</button>` : ""}
            <button type="button" class="ghost-button" data-steward-action="mark-reminder" data-reminder-id="${escapeAttr(reminder.id)}">知道了</button>
          </div>
        </div>`;
    })
    .join("")}</div>`;
}

function automationCardHtml(item) {
  const on = state.steward.auto[item.id] !== undefined ? state.steward.auto[item.id] : item.defaultOn;
  const lastRun = state.steward.lastRunAt[item.id] || item.lastRunAt;
  const scopeTag = item.scope === "client" ? "端上" : "服务端";
  let control;
  if (item.scope !== "client") {
    control = '<span class="automation-scope">服务端常开</span>';
  } else if (item.gated) {
    control = `<span class="automation-gate">${escapeHtml(item.gateReason)}</span>`;
  } else {
    control = `<label class="switch-row switch-row-compact">
        <input type="checkbox" data-steward-action="toggle-auto" data-auto-id="${escapeAttr(item.id)}" ${on ? "checked" : ""} aria-label="${escapeAttr(item.label)}开关">
        <span class="switch" aria-hidden="true"></span>
      </label>`;
  }
  return `
    <div class="automation-card" data-gated="${item.gated}">
      <div class="automation-head"><b>${escapeHtml(item.label)}</b><span class="automation-scope">${scopeTag}</span></div>
      <p class="automation-trigger">${escapeHtml(item.trigger)}</p>
      <div class="automation-foot">
        <small>${lastRun ? `最近运行 ${formatDateTime(lastRun)}` : "尚未运行"}</small>
        ${control}
      </div>
    </div>`;
}

function pipelineHtml() {
  const view = state.steward.view;
  const pipeline = view?.pipeline || [];
  if (!pipeline.length) {
    return '<p class="empty-copy">管道状态暂不可用；算价与下单不受影响。</p>';
  }
  const rows = pipeline
    .map((step) => {
      const meta = step.lastAt
        ? `${step.tool} · ${step.lastMs}ms · ${formatDateTime(step.lastAt)}`
        : step.tool;
      return `
        <li class="pipeline-step" data-state="${escapeAttr(step.state)}">
          <span class="pipeline-dot" aria-hidden="true"></span>
          <div class="pipeline-main"><b>${escapeHtml(step.label)}</b><small>${escapeHtml(meta)}</small></div>
          <span class="pipeline-tag">${PIPELINE_TAG[step.state] || step.state}</span>
        </li>`;
    })
    .join("");
  const note = view?.mode === "demo"
    ? '<div class="action-note">演示模式没有真实 MCP 轨迹，管道按「演示」展示；接入 Token 后这里显示真实调用耗时。</div>'
    : "";
  return `${note}<ol class="pipeline">${rows}</ol>`;
}

function renderSteward() {
  if (!els.stewardContent) return;
  const view = state.steward.view;
  const unread = state.reminders.filter((reminder) => !reminder.read).length;
  const automations = view?.automations || [];
  const liveState = view?.liveState || "";
  els.stewardContent.innerHTML = `
    <div class="detail-hero">
      <div>
        <p class="card-kicker">省单管家 · ${unread} 条待办</p>
        <h2 id="stewardTitle">这一单，管家盯着</h2>
        <p class="detail-sub">${state.dataMode === "live" ? `实时模式（${escapeHtml(liveState || "connected")}）` : "演示模式"} · 备单、领券、续报价、轮询与对账自动衔接</p>
      </div>
      ${executionBadge()}
    </div>
    <div class="steward-nav" role="tablist" aria-label="管家分区">
      <button type="button" data-steward-action="scroll" data-target="steward-sec-order" class="is-active">这一单</button>
      <button type="button" data-steward-action="scroll" data-target="steward-sec-todo">待办</button>
      <button type="button" data-steward-action="scroll" data-target="steward-sec-auto">自动化</button>
      <button type="button" data-steward-action="scroll" data-target="steward-sec-pipe">MCP 管道</button>
      <button type="button" data-steward-action="scroll" data-target="steward-sec-benefit">权益</button>
    </div>
    <div class="detail-section" id="steward-sec-order">
      <div class="steward-section-head"><h3>这一单</h3><small>${STEWARD_COPY[state.steward.phase]?.[0] || ""}</small></div>
      ${stewardOrderSection()}
    </div>
    <div class="detail-section" id="steward-sec-todo">
      <div class="steward-section-head"><h3>待办</h3><small>${unread} 条未读</small></div>
      ${todoListHtml()}
      ${unread ? '<div class="modal-actions"><button type="button" class="ghost-button" data-steward-action="mark-all-read">全部标记已读</button></div>' : ""}
    </div>
    <div class="detail-section" id="steward-sec-auto">
      <div class="steward-section-head"><h3>自动化</h3><small>端上 5 项可关，服务端 3 项常开</small></div>
      <div class="automation-grid">${automations.map(automationCardHtml).join("") || '<p class="empty-copy">自动化目录暂不可用。</p>'}</div>
    </div>
    <div class="detail-section" id="steward-sec-pipe">
      <div class="steward-section-head"><h3>MCP 管道</h3><small>${view?.mode === "live" ? "实时调用轨迹" : "演示数据"}</small></div>
      ${pipelineHtml()}
    </div>
    <div class="detail-section" id="steward-sec-benefit">
      <div class="steward-section-head"><h3>权益与固定套餐</h3><small>${state.accountSource === "live" ? "实时账户" : "演示账户"}</small></div>
      ${renderAccountSection()}
      <div class="account-section">
        <div class="account-section-head"><h4>固定套餐复购</h4><span>${state.subscriptions.length} 个</span></div>
        <div class="subscription-list">${renderSubscriptionCards()}</div>
      </div>
      <p class="form-help">自动复购默认关闭；开启后受单次金额、每日次数和间隔限制，达到上限会自动暂停。实时自动复购只在单用户私有模式生效。</p>
    </div>
  `;
}

function stewardScrollTo(targetId) {
  const target = targetId ? document.getElementById(targetId) : null;
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
}

function handleStewardAction(name, data = {}) {
  if (name === "confirm") return requestOrder();
  if (name === "confirm-create") return confirmOrderAction();
  if (name === "unlock-confirm") return unlockAndConfirm();
  if (name === "confirm-cancel") {
    state.steward.confirmOpen = false;
    renderStewardStrip();
    if (!els.stewardModal.classList.contains("hidden")) renderSteward();
    return undefined;
  }
  if (name === "prepare") return refreshQuote();
  if (name === "restore-order") return restoreLastOrder();
  if (name === "claim-coupon") return claimCouponAction();
  if (name === "unlock") return unlockPrivateAction();
  if (name === "pay" || name === "pay-link") {
    if (state.order) return openOrderPay();
    return openSteward();
  }
  if (name === "refresh-order") return refreshOrderAction();
  if (name === "cancel-order") return cancelOrderAction();
  if (name === "mock-pay") return mockPayAction();
  if (name === "copy-quote") return copyQuoteAction();
  if (name === "show-sub-form") return showSubscriptionForm();
  if (name === "hide-sub-form") {
    state.steward.showSubForm = false;
    renderSteward();
    return undefined;
  }
  if (name === "save-sub") return saveSubscriptionAction();
  if (name === "reconcile") return reconcileAction();
  if (name === "toggle-sub") {
    const enabled = data.enabled === "true";
    return toggleSubscriptionAction(data.subId, enabled);
  }
  if (name === "run-sub") return runSubscriptionAction(data.subId);
  if (name === "delete-sub") return deleteSubscriptionAction(data.subId);
  if (name === "mark-reminder") return markReminderAction(data.reminderId);
  if (name === "mark-all-read") return markAllRemindersRead();
  if (name === "todo-pay") {
    if (state.order) return openOrderPay();
    return openSteward();
  }
  if (name === "todo-refresh") return refreshQuote();
  if (name === "todo-order") return requestOrder();
  if (name === "todo-reconcile") {
    reconcileAction();
    return stewardScrollTo("steward-sec-todo");
  }
  if (name === "todo-subs") return stewardScrollTo("steward-sec-benefit");
  if (name === "scroll") return stewardScrollTo(data.target);
  return undefined;
}

async function openSteward() {
  openModal("steward");
  els.stewardContent.innerHTML = `
    <div class="empty-state">
      <p class="card-kicker">省单管家</p>
      <h2 id="stewardTitle">正在汇总这一单</h2>
      <p>报价、待办、自动化与 MCP 管道会在这里汇总。</p>
      <div class="loading-dots" aria-hidden="true"><span></span><span></span><span></span></div>
    </div>`;
  await Promise.allSettled([
    fetchSteward(),
    loadReminders(false),
    loadAccount(),
    loadSubscriptions(),
    loadCapabilities(),
  ]);
  renderSteward();
  if (autoOn("autoReconcile")) reconcileSilently();
}

async function claimCouponAction() {
  if (!state.quote || !state.quoteTokens) return;
  const caps = state.capabilities || {};
  if (!caps.couponClaim) {
    showToast("领券未开启；实时模式请先解锁私有模式", true);
    return;
  }
  try {
    const data = await api("api/coupons/claim", {
      method: "POST",
      body: JSON.stringify({ quoteId: state.quote.id, token: state.quoteTokens.claim }),
    });
    state.quote = data.quote;
    state.capabilities = data.capabilities || state.capabilities;
    renderSteward();
    renderStewardStrip();
    showToast(data.idempotent ? "这张券已经领取过了" : "最优券已领取");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function unlockPrivateAction() {
  const input = $("#privatePasscode");
  const passcode = input?.value?.trim();
  if (!passcode) {
    showToast("请输入私有模式口令", true);
    return;
  }
  try {
    await api("api/private/unlock", {
      method: "POST",
      body: JSON.stringify({ passcode }),
    });
    await loadCapabilities();
    renderSteward();
    showToast("私有模式已解锁");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function refreshOrderAction() {
  if (!state.order) return;
  try {
    const data = await api(`api/orders/${encodeURIComponent(state.order.id)}`);
    state.order = data.order;
    renderSteward();
    renderStewardStrip();
    if (state.order.status !== "pending_payment") stopOrderPolling();
    loadReminders(true);
    showToast(`订单状态：${orderStatusLabel(state.order.status)}`);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function cancelOrderAction() {
  if (!state.order) return;
  if (!window.confirm("确认取消这笔未支付订单？已支付订单不能在这里取消。")) return;
  try {
    const data = await api(`api/orders/${encodeURIComponent(state.order.id)}/cancel`, {
      method: "POST",
      body: "{}",
    });
    state.order = data.order;
    stopOrderPolling();
    renderSteward();
    renderStewardStrip();
    loadReminders(true);
    showToast("未支付订单已取消");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function mockPayAction() {
  if (!state.order) return;
  try {
    const data = await api(`api/orders/${encodeURIComponent(state.order.id)}/mock-pay`, {
      method: "POST",
      body: "{}",
    });
    state.order = data.order;
    stopOrderPolling();
    renderSteward();
    renderStewardStrip();
    loadReminders(true);
    showToast("演示支付完成");
  } catch (error) {
    showToast(error.message, true);
  }
}

function startOrderPolling() {
  stopOrderPolling();
  if (!state.order) return;
  state.orderPollStarted = Date.now();
  state.orderPollTimer = setInterval(async () => {
    if (!state.order || state.order.status !== "pending_payment") {
      stopOrderPolling();
      return;
    }
    if (Date.now() - state.orderPollStarted > 5 * 60_000) {
      stopOrderPolling();
      return;
    }
    try {
      const data = await api(`api/orders/${encodeURIComponent(state.order.id)}`);
      state.order = data.order;
      if (state.order.status !== "pending_payment") {
        stopOrderPolling();
        fetchSteward();
      }
      if (!els.stewardModal.classList.contains("hidden")) renderSteward();
      renderStewardStrip();
      loadReminders(true);
    } catch {
      // 轮询失败不打断页面
    }
  }, 5000);
}

function stopOrderPolling() {
  clearInterval(state.orderPollTimer);
  state.orderPollTimer = null;
}

async function loadCapabilities() {
  try {
    state.capabilities = await api("api/capabilities");
  } catch {
    // keep previous capabilities
  }
}

async function copyQuoteAction() {
  if (!state.quote) return;
  await copyPlan(state.quote.plan);
}

function reminderTypeLabel(type) {
  return {
    quote_expiry: "报价过期",
    payment_due: "支付提醒",
    coupon_expiry: "券到期",
    coupon_claimed: "已领券",
    duplicate_orders: "重复订单",
    subscription_limit: "复购上限",
  }[type] || "提醒";
}

function updateReminderBadge() {
  const unread = state.reminders.filter((reminder) => !reminder.read).length;
  if (!els.reminderBadge) return;
  els.reminderBadge.textContent = unread > 9 ? "9+" : String(unread);
  els.reminderBadge.classList.toggle("hidden", unread === 0);
}

async function loadReminders(quiet = true) {
  try {
    const data = await api("api/reminders");
    state.reminders = data.reminders || [];
    updateReminderBadge();
    if (!els.stewardModal.classList.contains("hidden")) renderSteward();
  } catch {
    if (!quiet) showToast("提醒加载失败", true);
  }
}

async function loadAccount() {
  try {
    const data = await api("api/account");
    state.account = data.account;
    state.accountSource = data.source || "demo";
    state.accountWarnings = data.warnings || [];
    if (!els.stewardModal.classList.contains("hidden")) renderSteward();
  } catch (error) {
    if (!els.stewardModal.classList.contains("hidden")) {
      showToast(error.message || "权益加载失败", true);
    }
  }
}

async function loadSubscriptions() {
  try {
    const data = await api("api/subscriptions");
    state.subscriptions = data.subscriptions || [];
    if (!els.stewardModal.classList.contains("hidden")) renderSteward();
  } catch {
    // non-fatal
  }
}

function renderAccountSection() {
  const account = state.account;
  if (!account) {
    return '<div class="empty-copy">正在加载权益数据…</div>';
  }
  const coupons = account.coupons || [];
  const activities = account.activities || [];
  const points = Number(account.pointsBalance || 0);
  const expiring = account.pointsExpiringAt
    ? `最近过期 ${formatDateTime(account.pointsExpiringAt)}`
    : "暂无积分过期信息";
  return `
    <div class="account-grid">
      <div class="account-card">
        <small>可用积分</small>
        <strong>${number(points)}</strong>
        <span>${escapeHtml(expiring)}</span>
      </div>
      <div class="account-card">
        <small>可用券</small>
        <strong>${coupons.filter((coupon) => !coupon.claimed).length}</strong>
        <span>${state.accountSource === "live" ? "实时券包" : "演示券包"}</span>
      </div>
      <div class="account-card">
        <small>进行中活动</small>
        <strong>${activities.length}</strong>
        <span>来自活动日历</span>
      </div>
    </div>
    <div class="account-section">
      <div class="account-section-head"><h4>我的券</h4><span>${state.accountSource === "live" ? "实时" : "演示"}</span></div>
      <div class="coupon-list">
        ${coupons.length ? coupons.slice(0, 6).map((coupon) => `
          <div class="account-coupon ${coupon.claimed ? "is-claimed" : ""}">
            <div><b>${escapeHtml(coupon.name)}</b><small>${coupon.expiresAt ? `到期 ${formatDateTime(coupon.expiresAt)}` : "到期时间以官方为准"}</small></div>
            <span>${coupon.claimed ? "已领取" : coupon.discountCents ? `省 ${money(coupon.discountCents)}` : "可用"}</span>
          </div>`).join("") : '<p class="empty-copy">暂无可用券</p>'}
      </div>
    </div>
    <div class="account-section">
      <div class="account-section-head"><h4>近期活动</h4><span>${state.accountSource === "live" ? "实时" : "演示"}</span></div>
      <div class="activity-list">
        ${activities.length ? activities.slice(0, 4).map((activity) => `
          <div class="account-activity">
            <div><b>${escapeHtml(activity.title)}</b><small>${escapeHtml(activity.description || "")}</small></div>
            <span>${activity.endsAt ? `至 ${formatDateTime(activity.endsAt)}` : escapeHtml(activity.tag || "")}</span>
          </div>`).join("") : '<p class="empty-copy">暂无活动</p>'}
      </div>
    </div>
    ${state.accountWarnings.length ? `<div class="action-note">${state.accountWarnings.map(escapeHtml).join(" · ")}</div>` : ""}
  `;
}

function renderSubscriptionCards() {
  if (!state.subscriptions.length) {
    return '<p class="empty-copy">还没有固定套餐。先在「这一单」里把一套方案存为固定套餐。</p>';
  }
  return state.subscriptions.map((subscription) => {
    const caps = subscription.caps || {};
    const lastRun = subscription.runs?.length ? subscription.runs[subscription.runs.length - 1] : null;
    return `
      <div class="subscription-card">
        <div class="subscription-head">
          <div>
            <b>${escapeHtml(subscription.plan?.label || "固定套餐")} · ${money(subscription.plan?.price?.finalCents || 0)}</b>
            <small>${subscription.autoOrder ? "自动复购" : "手动复购"} · ${subscription.enabled ? "已开启" : "已关闭"}</small>
          </div>
          <span class="order-status ${subscription.enabled ? "status-paid" : "status-cancelled"}">${subscription.enabled ? "运行中" : "已暂停"}</span>
        </div>
        <div class="subscription-caps">
          <span>单次上限 ${money(caps.maxAmountCents || 0)}</span>
          <span>每日 ${caps.maxRunsPerDay || 1} 次</span>
          <span>间隔 ${caps.intervalMinutes || 1440} 分钟</span>
        </div>
        <div class="subscription-times">
          <span>上次：${lastRun ? formatDateTime(lastRun.ts) + (lastRun.success ? " 成功" : " 失败") : "尚未运行"}</span>
          <span>下次：${subscription.nextRunAt ? formatDateTime(subscription.nextRunAt) : "未排期"}</span>
        </div>
        <div class="subscription-actions">
          <button type="button" class="mini-button" data-steward-action="toggle-sub" data-sub-id="${escapeAttr(subscription.id)}" data-enabled="${subscription.enabled ? "false" : "true"}">${subscription.enabled ? "关闭" : "开启"}</button>
          <button type="button" class="mini-button mini-button-red" data-steward-action="run-sub" data-sub-id="${escapeAttr(subscription.id)}">立即复购</button>
          <button type="button" class="ghost-button" data-steward-action="delete-sub" data-sub-id="${escapeAttr(subscription.id)}">删除</button>
        </div>
      </div>`;
  }).join("");
}

// 提醒中心已并入管家中心，旧的独立入口不再保留。
async function markReminderAction(reminderId) {
  try {
    await api(`api/reminders/${encodeURIComponent(reminderId)}/read`, {
      method: "POST",
      body: "{}",
    });
    const reminder = state.reminders.find((item) => item.id === reminderId);
    if (reminder) reminder.read = true;
    updateReminderBadge();
    renderSteward();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function markAllRemindersRead() {
  const unread = state.reminders.filter((reminder) => !reminder.read);
  for (const reminder of unread) {
    try {
      await api(`api/reminders/${encodeURIComponent(reminder.id)}/read`, {
        method: "POST",
        body: "{}",
      });
      reminder.read = true;
    } catch {
      // continue
    }
  }
  updateReminderBadge();
  renderSteward();
}

async function reconcileAction() {
  try {
    const data = await api("api/orders/reconcile", { method: "POST", body: "{}" });
    showToast(
      data.duplicates
        ? `发现 ${data.duplicates} 个重复未支付订单，已取消 ${data.cancelled} 个`
        : "没有发现重复未支付订单",
    );
    await loadReminders(true);
    if (!els.stewardModal.classList.contains("hidden")) renderSteward();
  } catch (error) {
    showToast(error.message, true);
  }
}

function showSubscriptionForm() {
  state.steward.showSubForm = true;
  renderSteward();
}

async function saveSubscriptionAction() {
  if (!state.quote) return;
  const maxAmount = Number($("#subMaxAmount")?.value);
  const runs = Number($("#subRuns")?.value);
  const interval = Number($("#subInterval")?.value);
  const autoOrder = Boolean($("#subAutoOrder")?.checked);
  if (!Number.isFinite(maxAmount) || maxAmount < 1) {
    showToast("请输入有效的金额上限", true);
    return;
  }
  try {
    await api("api/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        quoteId: state.quote.id,
        maxAmountCents: Math.round(maxAmount * 100),
        maxRunsPerDay: runs,
        intervalMinutes: interval,
        autoOrder,
      }),
    });
    state.steward.showSubForm = false;
    await loadSubscriptions();
    renderSteward();
    showToast("固定套餐已保存");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function toggleSubscriptionAction(subscriptionId, enabled) {
  try {
    await api(`api/subscriptions/${encodeURIComponent(subscriptionId)}/toggle`, {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
    await loadSubscriptions();
    renderSteward();
    showToast(enabled ? "固定套餐已开启" : "固定套餐已暂停");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function runSubscriptionAction(subscriptionId) {
  try {
    const data = await api(`api/subscriptions/${encodeURIComponent(subscriptionId)}/run`, {
      method: "POST",
      body: JSON.stringify({ autoCreate: true }),
    });
    state.quote = data.quote;
    state.quoteTokens = data.tokens;
    state.order = data.order || null;
    state.quoteExpired = false;
    state.steward.confirmOpen = false;
    state.steward.showSubForm = false;
    setPhase(state.order ? "ordered" : "ready");
    openModal("steward");
    renderSteward();
    startStewardTimer();
    if (state.order) startOrderPolling();
    await loadSubscriptions();
    await loadReminders(true);
    showToast(data.order ? "复购订单已创建" : "复购报价已生成，请确认订单");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function deleteSubscriptionAction(subscriptionId) {
  if (!window.confirm("确认删除这个固定套餐？")) return;
  try {
    await api(`api/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "DELETE" });
    await loadSubscriptions();
    renderSteward();
    showToast("固定套餐已删除");
  } catch (error) {
    showToast(error.message, true);
  }
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
  if (els.stewardBtn) els.stewardBtn.addEventListener("click", openSteward);
  if (els.remindersBtn) els.remindersBtn.addEventListener("click", openSteward);
  if (els.stewardOpenBtn) els.stewardOpenBtn.addEventListener("click", openSteward);
  if (els.stewardPrimaryBtn) {
    els.stewardPrimaryBtn.addEventListener("click", () => {
      handleStewardAction(els.stewardPrimaryBtn.dataset.stewardAction);
    });
  }
  if (els.stewardConfirm) {
    els.stewardConfirm.addEventListener("click", (event) => {
      const target = event.target.closest("[data-steward-action]");
      if (target) handleStewardAction(target.dataset.stewardAction, target.dataset);
    });
    els.stewardConfirm.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.target.id !== "confirmPasscode") return;
      event.preventDefault();
      unlockAndConfirm();
    });
  }
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
  if (els.liveForm) els.liveForm.addEventListener("submit", saveLiveToken);
  if (els.liveReveal) els.liveReveal.addEventListener("click", toggleLiveToken);
  if (els.liveConsent) {
    els.liveConsent.addEventListener("change", () => {
      state.live.consent = els.liveConsent.checked;
      if (els.liveSave) {
        els.liveSave.disabled = state.live.busy || !state.live.consent;
      }
    });
  }
  if (els.liveDisconnect) els.liveDisconnect.addEventListener("click", disconnectLive);
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
  if (els.stewardContent) {
    els.stewardContent.addEventListener("click", (event) => {
      const target = event.target.closest("[data-steward-action]");
      if (!target) return;
      if (target.dataset.stewardAction === "scroll") {
        event.preventDefault();
        $$(".steward-nav button", els.stewardContent).forEach((button) => {
          button.classList.toggle("is-active", button === target);
        });
      }
      handleStewardAction(target.dataset.stewardAction, target.dataset);
    });
    els.stewardContent.addEventListener("change", (event) => {
      const input = event.target.closest("[data-steward-action='toggle-auto']");
      if (!input) return;
      state.steward.auto[input.dataset.autoId] = input.checked;
      saveStewardPrefs();
      showToast(input.checked ? "自动化已开启" : "自动化已关闭");
    });
    els.stewardContent.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target.closest(".switch-row-compact");
      if (!target) return;
      event.preventDefault();
      const input = $("input", target);
      if (input) input.click();
    });
  }
  els.stickyDetail.addEventListener("click", () => {
    const plan = selectedPlan();
    if (plan) openDetail(plan.id);
  });
  els.stickyOrder.addEventListener("click", () => {
    if (state.result) requestOrder();
    else openSteward();
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
    state.capabilities = data.capabilities || null;
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
    loadReminders(true);
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
  loadStewardPrefs();
  bindEvents();
  syncChips();
  renderStoreList();
  registerServiceWorker();
  loadBootstrap();
  loadLiveStatus();
  state.reminderTimer = setInterval(() => loadReminders(true), 30_000);
}

init();
