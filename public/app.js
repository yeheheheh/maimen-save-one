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
  actionLoading: false,
  showOrderConfirm: false,
  showSubForm: false,
  quoteExpired: false,
  orderPollStarted: 0,
  orderPollTimer: null,
  quoteTimer: null,
  reminderTimer: null,
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
  actionCenterBtn: $("#actionCenterBtn"),
  actionModal: $("#actionModal"),
  actionContent: $("#actionContent"),
  remindersBtn: $("#remindersBtn"),
  reminderBadge: $("#reminderBadge"),
  remindersModal: $("#remindersModal"),
  remindersContent: $("#remindersContent"),
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
  if (!els.actionModal.classList.contains("hidden")) closeModal("action");
  stopOrderPolling();
  clearInterval(state.quoteTimer);
  state.quoteTimer = null;
  state.quote = null;
  state.quoteTokens = null;
  state.order = null;
  state.quoteExpired = false;
  state.showOrderConfirm = false;
  state.showSubForm = false;
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
    action: els.actionModal,
    reminders: els.remindersModal,
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
  if (name === "action") {
    clearInterval(state.quoteTimer);
    state.quoteTimer = null;
    stopOrderPolling();
  }
  const anyOpen = [els.detailModal, els.storeModal, els.infoModal, els.actionModal, els.remindersModal]
    .some((item) => item && !item.classList.contains("hidden"));
  if (!anyOpen) document.body.classList.remove("modal-open");
  if (state.lastFocus && typeof state.lastFocus.focus === "function") {
    state.lastFocus.focus({ preventScroll: true });
  }
}

function closeAllModals() {
  ["detail", "store", "info", "action", "reminders"].forEach(closeModal);
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

function executionBadge() {
  const caps = state.capabilities || {};
  if (caps.mode === "demo" || caps.writeMode === "demo") {
    return '<span class="execution-badge is-demo">演示执行 · 不写真实账户</span>';
  }
  if (caps.writeMode === "private" && caps.unlocked) {
    return '<span class="execution-badge is-live">私有实时 · 已解锁</span>';
  }
  if (caps.writeMode === "private") {
    return '<span class="execution-badge is-locked">私有实时 · 待解锁</span>';
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

function actionErrorHtml(message) {
  return `
    <div class="empty-state">
      <p class="card-kicker">执行中心</p>
      <h2 id="actionTitle">暂时无法生成报价</h2>
      <p>${escapeHtml(message)}</p>
      <div class="modal-actions">
        <button type="button" class="select-button" data-action="retry-quote">重新生成报价</button>
      </div>
    </div>`;
}

async function openActionCenter() {
  const plan = selectedPlan();
  if (!plan || !state.result) {
    showToast("先算一单，再进入执行中心");
    return;
  }
  state.quote = null;
  state.quoteTokens = null;
  state.order = null;
  state.quoteExpired = false;
  state.showOrderConfirm = false;
  state.showSubForm = false;
  els.actionContent.innerHTML = `
    <div class="empty-state">
      <p class="card-kicker">执行中心</p>
      <h2 id="actionTitle">正在生成报价快照</h2>
      <p>锁定门店、餐品、券和金额，随后可以选择领券或生成待支付订单。</p>
      <div class="loading-dots" aria-hidden="true"><span></span><span></span><span></span></div>
    </div>`;
  openModal("action");
  try {
    const data = await api("api/quote", {
      method: "POST",
      body: JSON.stringify({ input: buildInput(), planId: plan.id }),
    });
    state.quote = data.quote;
    state.quoteTokens = data.tokens;
    state.capabilities = data.capabilities || state.capabilities;
    renderActionCenter();
    startQuoteTimer();
    loadSubscriptions();
    loadReminders(true);
  } catch (error) {
    els.actionContent.innerHTML = actionErrorHtml(error.message);
  }
}

function startQuoteTimer() {
  clearInterval(state.quoteTimer);
  if (!state.quote) return;
  const tick = () => {
    const element = $("#quoteCountdown");
    if (!element) return;
    const left = Date.parse(state.quote.expiresAt) - Date.now();
    element.textContent = countdownText(left);
    if (left <= 0 && !state.quoteExpired) {
      state.quoteExpired = true;
      renderActionCenter();
    }
  };
  tick();
  state.quoteTimer = setInterval(tick, 1000);
}

function renderActionCenter() {
  const quote = state.quote;
  if (!quote) return;
  const caps = state.capabilities || {};
  const plan = quote.plan;
  const coupon = plan.coupon;
  const expired = state.quoteExpired || Date.parse(quote.expiresAt) <= Date.now();
  const claimed = Boolean(quote.couponClaimed);
  const order = state.order;
  const payUrl = order ? safeExternalUrl(order.payUrl) : "";
  const orderKicker =
    order?.status === "paid"
      ? "已完成订单"
      : order?.status === "cancelled"
        ? "已取消订单"
        : "待支付订单";
  const orderHelp =
    order?.status === "paid"
      ? "演示支付已完成；实时模式以麦当劳官方支付状态为准。"
      : order?.status === "cancelled"
        ? "订单已取消，不会继续扣款。"
        : payUrl
          ? "支付链接由麦当劳官方返回；请核对金额后再支付。"
          : "演示订单不会产生真实扣款；可点击模拟支付验证状态轮询。";
  const canClaim = Boolean(coupon) && !claimed && !expired && caps.couponClaim;
  const canOrder = !expired && !order && caps.orderCreate;
  const locked = caps.writeMode === "private" && !caps.unlocked;
  const couponStarted = coupon && !claimed && !expired;
  const steps = [];
  steps.push(`
    <div class="execution-step is-done">
      <span class="step-index">1</span>
      <div class="step-main"><b>报价快照已生成</b><small>已锁定门店、餐品、券和金额</small></div>
      <span class="step-state">已锁定</span>
    </div>`);
  steps.push(`
    <div class="execution-step ${claimed ? "is-done" : ""}">
      <span class="step-index">2</span>
      <div class="step-main"><b>领取最优券</b><small>${coupon ? (claimed ? "已领取，可在本单使用" : `当前最优券：${escapeHtml(coupon.name)}`) : "当前方案无需领券"}</small></div>
      ${couponStarted ? `<button type="button" class="mini-button" data-action="claim-coupon" ${canClaim ? "" : "disabled"}>${caps.couponClaim ? "领取" : "未开启"}</button>` : `<span class="step-state">${coupon ? "已完成" : "无需操作"}</span>`}
    </div>`);
  steps.push(`
    <div class="execution-step ${order ? "is-done" : ""}">
      <span class="step-index">3</span>
      <div class="step-main"><b>创建待支付订单</b><small>${order ? `订单 ${escapeHtml(order.id)}` : "生成订单后，支付仍在麦当劳官方页面完成"}</small></div>
      ${!order && !expired ? `<button type="button" class="mini-button" data-action="show-order-confirm" ${canOrder ? "" : "disabled"}>${caps.orderCreate ? "生成订单" : "未开启"}</button>` : `<span class="step-state">${order ? "已创建" : "已过期"}</span>`}
    </div>`);
  steps.push(`
    <div class="execution-step ${order?.status === "paid" ? "is-done" : ""}">
      <span class="step-index">4</span>
      <div class="step-main"><b>完成支付</b><small>支付在麦当劳官方渠道完成，本页只做状态提醒</small></div>
      <span class="step-state">${order ? orderStatusLabel(order.status) : "待订单"}</span>
    </div>`);

  const orderHtml = order
    ? `
      <div class="order-card">
        <div class="order-head">
          <div>
            <p class="card-kicker">${orderKicker}</p>
            <h3>${escapeHtml(order.id)}</h3>
          </div>
          <span class="order-status status-${escapeAttr(order.status)}">${orderStatusLabel(order.status)}</span>
        </div>
        <div class="order-meta">
          <span>${money(order.amountCents)}</span>
          <span>${escapeHtml(order.store?.name || "")}</span>
          <span>${modeText(order.plan?.mode)}</span>
        </div>
        <div class="order-actions">
          ${payUrl ? `<a class="mini-button mini-button-red" href="${escapeAttr(payUrl)}" target="_blank" rel="noreferrer">打开官方支付</a>` : ""}
          ${order.demo && order.status === "pending_payment" ? '<button type="button" class="mini-button" data-action="mock-pay">模拟支付成功</button>' : ""}
          ${order.status === "pending_payment" ? '<button type="button" class="ghost-button" data-action="cancel-order">取消未支付订单</button>' : ""}
          <button type="button" class="ghost-button" data-action="refresh-order">刷新状态</button>
        </div>
        <p class="order-help">${orderHelp}</p>
      </div>`
    : "";

  const confirmHtml = state.showOrderConfirm && !order
    ? `
      <div class="confirm-box">
        <label class="check-row">
          <input id="orderConfirmCheck" type="checkbox">
          <span>我已确认门店、餐品、金额和取餐方式</span>
        </label>
        <button type="button" class="select-button" data-action="create-order" ${caps.orderCreate ? "" : "disabled"}>确认生成待支付订单</button>
      </div>`
    : "";

  const unlockHtml = locked && caps.writePasscodeRequired
    ? `
      <div class="unlock-box">
        <div>
          <b>实时写操作已锁定</b>
          <p>输入私有模式口令后，领券和下单仍受金额、频次和 kill switch 限制。</p>
        </div>
        <div class="inline-row">
          <input id="privatePasscode" type="password" autocomplete="off" placeholder="私有模式口令">
          <button type="button" class="mini-button mini-button-red" data-action="unlock">解锁</button>
        </div>
      </div>`
    : "";

  const subForm = state.showSubForm
    ? `
      <div class="inline-form">
        <div class="inline-form-head">
          <b>存为固定套餐</b>
          <button type="button" class="text-button" data-action="hide-sub-form">收起</button>
        </div>
        <div class="form-grid">
          <label>单次金额上限（元）<input id="subMaxAmount" type="number" min="1" max="200" step="1" value="${(plan.price.finalCents / 100).toFixed(0)}"></label>
          <label>每日最多复购次数<input id="subRuns" type="number" min="1" max="10" step="1" value="1"></label>
          <label>复购间隔（分钟）<input id="subInterval" type="number" min="1" max="10080" step="1" value="1440"></label>
        </div>
        <label class="check-row">
          <input id="subAutoOrder" type="checkbox">
          <span>允许自动复购（仅单用户私有模式生效，演示模式只模拟）</span>
        </label>
        <p class="form-help">自动复购会在达到每日次数上限后自动关闭，随时可在提醒中心关闭。</p>
        <button type="button" class="select-button" data-action="save-sub">保存固定套餐</button>
      </div>`
    : "";

  els.actionContent.innerHTML = `
    <div class="detail-hero">
      <div>
        <p class="card-kicker">执行中心 · ${escapeHtml(quote.id.slice(0, 12))}</p>
        <h2 id="actionTitle">${escapeHtml(plan.label)} · ${money(plan.price.finalCents)}</h2>
        <p class="detail-sub">${escapeHtml(quote.store?.name || "")} · ${modeText(plan.mode)} · 报价有效期 <span id="quoteCountdown">${countdownText(Date.parse(quote.expiresAt) - Date.now())}</span></p>
      </div>
      ${executionBadge()}
    </div>
    <div class="action-note ${expired ? "is-expired" : ""}">
      ${expired ? "报价已过期，请重新生成报价后再执行。" : "报价已锁定当前门店、餐品、券和金额；如官方价格变化，服务端会中止并在重新确认后继续。"}
    </div>
    <div class="detail-section">
      <h3>执行步骤</h3>
      <div class="execution-steps">${steps.join("")}</div>
      ${unlockHtml}
      ${confirmHtml}
      ${orderHtml}
    </div>
    <div class="detail-section">
      <h3>动作</h3>
      <div class="modal-actions">
        <button type="button" class="ghost-button" data-action="copy-quote">复制清单</button>
        <button type="button" class="ghost-button" data-action="show-sub-form">存为固定套餐</button>
        <button type="button" class="ghost-button" data-action="reconcile">一键对账</button>
        ${expired ? '<button type="button" class="select-button" data-action="retry-quote">重新生成报价</button>' : ""}
      </div>
      <p class="micro-trust">${state.subscriptions.length ? `已保存 ${state.subscriptions.length} 个固定套餐，可在提醒中心管理。` : "固定套餐支持金额上限、每日次数限制和随时关闭。"}</p>
    </div>
    ${subForm}
  `;
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
      body: JSON.stringify({
        quoteId: state.quote.id,
        token: state.quoteTokens.claim,
      }),
    });
    state.quote = data.quote;
    state.capabilities = data.capabilities || state.capabilities;
    renderActionCenter();
    loadReminders(true);
    showToast(data.idempotent ? "这张券已经领取过了" : "最优券已领取");
  } catch (error) {
    showToast(error.message, true);
  }
}

function showOrderConfirm() {
  state.showOrderConfirm = true;
  renderActionCenter();
}

async function createOrderAction() {
  if (!state.quote || !state.quoteTokens) return;
  const checkbox = $("#orderConfirmCheck");
  if (!checkbox || !checkbox.checked) {
    showToast("请先确认门店、餐品和金额", true);
    return;
  }
  try {
    const data = await api("api/orders", {
      method: "POST",
      body: JSON.stringify({
        quoteId: state.quote.id,
        token: state.quoteTokens.order,
      }),
    });
    state.order = data.order;
    state.showOrderConfirm = false;
    renderActionCenter();
    startOrderPolling();
    loadReminders(true);
    showToast("订单已创建，请核对支付页");
  } catch (error) {
    if (error.code === "PRICE_CHANGED") {
      showToast(error.message, true);
      openActionCenter();
      return;
    }
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
    renderActionCenter();
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
    renderActionCenter();
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
    renderActionCenter();
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
    renderActionCenter();
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
    if (Date.now() - state.orderPollStarted > 2 * 60_000) {
      stopOrderPolling();
      return;
    }
    try {
      const data = await api(`api/orders/${encodeURIComponent(state.order.id)}`);
      state.order = data.order;
      if (state.order.status !== "pending_payment") stopOrderPolling();
      if (!els.actionModal.classList.contains("hidden")) renderActionCenter();
      loadReminders(true);
    } catch {
      // polling failures are non-fatal
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
    if (!els.remindersModal.classList.contains("hidden")) renderReminders();
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
    if (!els.remindersModal.classList.contains("hidden")) renderReminders();
  } catch (error) {
    if (!els.remindersModal.classList.contains("hidden")) {
      showToast(error.message || "权益加载失败", true);
    }
  }
}

async function loadSubscriptions() {
  try {
    const data = await api("api/subscriptions");
    state.subscriptions = data.subscriptions || [];
    if (!els.remindersModal.classList.contains("hidden")) renderReminders();
    if (!els.actionModal.classList.contains("hidden") && state.quote) renderActionCenter();
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
    return '<p class="empty-copy">还没有固定套餐。先在执行中心把一套方案存为固定套餐。</p>';
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
          <button type="button" class="mini-button" data-action="toggle-sub" data-sub-id="${escapeAttr(subscription.id)}" data-enabled="${subscription.enabled ? "false" : "true"}">${subscription.enabled ? "关闭" : "开启"}</button>
          <button type="button" class="mini-button mini-button-red" data-action="run-sub" data-sub-id="${escapeAttr(subscription.id)}">立即复购</button>
          <button type="button" class="ghost-button" data-action="delete-sub" data-sub-id="${escapeAttr(subscription.id)}">删除</button>
        </div>
      </div>`;
  }).join("");
}

function renderReminders() {
  const accountHtml = renderAccountSection();
  const unread = state.reminders.filter((reminder) => !reminder.read).length;
  const visibleReminders = state.reminders.filter((reminder) => !reminder.read).slice(0, 12);
  const reminderHtml = visibleReminders.length
    ? visibleReminders.map((reminder) => `
        <div class="reminder-item ${reminder.due ? "is-due" : ""} ${reminder.read ? "is-read" : ""}">
          <span class="reminder-type">${reminderTypeLabel(reminder.type)}</span>
          <div class="reminder-main">
            <b>${escapeHtml(reminder.title)}</b>
            <p>${escapeHtml(reminder.body)}</p>
            <small>${formatDateTime(reminder.dueAt)}${reminder.due ? " · 已到提醒时间" : ""}</small>
          </div>
          ${reminder.read ? '<span class="reminder-read">已读</span>' : `<button type="button" class="mini-button" data-action="mark-reminder" data-reminder-id="${escapeAttr(reminder.id)}">知道了</button>`}
        </div>`).join("")
    : '<p class="empty-copy">暂无提醒。报价、支付和券到期时会在这里出现。</p>';

  els.remindersContent.innerHTML = `
    <div class="detail-hero">
      <div>
        <p class="card-kicker">提醒中心 · ${unread} 条未读</p>
        <h2 id="remindersTitle">权益、订单与固定套餐</h2>
        <p class="detail-sub">${state.accountSource === "live" ? "实时账户数据" : "演示账户数据"} · 提醒只保存在本机服务端</p>
      </div>
      <div class="topbar-right">
        <button type="button" class="ghost-button" data-action="reconcile">一键对账</button>
        <button type="button" class="ghost-button" data-action="reload-reminders">刷新</button>
      </div>
    </div>
    <div class="detail-section">
      <h3>我的权益</h3>
      ${accountHtml}
    </div>
    <div class="detail-section">
      <h3>提醒</h3>
      <div class="reminder-list">${reminderHtml}</div>
    </div>
    <div class="detail-section">
      <h3>固定套餐复购</h3>
      <div class="subscription-list">${renderSubscriptionCards()}</div>
      <p class="form-help">自动复购默认关闭；开启后受单次金额、每日次数和间隔限制，达到上限会自动暂停。实时自动复购只在单用户私有模式生效。</p>
    </div>
    <div class="modal-actions">
      <button type="button" class="ghost-button" data-action="mark-all-read">全部标记已读</button>
    </div>
  `;
}

async function openReminders() {
  openModal("reminders");
  els.remindersContent.innerHTML = `
    <div class="empty-state">
      <p class="card-kicker">提醒中心</p>
      <h2 id="remindersTitle">正在加载权益与提醒</h2>
      <p>积分、券、活动、订单状态和复购计划会汇总到这里。</p>
      <div class="loading-dots" aria-hidden="true"><span></span><span></span><span></span></div>
    </div>`;
  await Promise.allSettled([loadReminders(false), loadAccount(), loadSubscriptions()]);
  renderReminders();
}

async function markReminderAction(reminderId) {
  try {
    await api(`api/reminders/${encodeURIComponent(reminderId)}/read`, {
      method: "POST",
      body: "{}",
    });
    const reminder = state.reminders.find((item) => item.id === reminderId);
    if (reminder) reminder.read = true;
    updateReminderBadge();
    renderReminders();
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
  renderReminders();
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
    if (!els.actionModal.classList.contains("hidden")) renderActionCenter();
  } catch (error) {
    showToast(error.message, true);
  }
}

function showSubscriptionForm() {
  state.showSubForm = true;
  renderActionCenter();
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
    state.showSubForm = false;
    await loadSubscriptions();
    renderActionCenter();
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
    renderReminders();
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
    state.showOrderConfirm = false;
    state.showSubForm = false;
    openModal("action");
    renderActionCenter();
    startQuoteTimer();
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
    renderReminders();
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
  if (els.actionCenterBtn) els.actionCenterBtn.addEventListener("click", openActionCenter);
  if (els.remindersBtn) els.remindersBtn.addEventListener("click", openReminders);
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
  if (els.actionContent) {
    els.actionContent.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]");
      if (!action) return;
      const actionName = action.dataset.action;
      if (actionName === "retry-quote") openActionCenter();
      if (actionName === "claim-coupon") claimCouponAction();
      if (actionName === "show-order-confirm") showOrderConfirm();
      if (actionName === "create-order") createOrderAction();
      if (actionName === "unlock") unlockPrivateAction();
      if (actionName === "refresh-order") refreshOrderAction();
      if (actionName === "cancel-order") cancelOrderAction();
      if (actionName === "mock-pay") mockPayAction();
      if (actionName === "copy-quote") copyQuoteAction();
      if (actionName === "show-sub-form") showSubscriptionForm();
      if (actionName === "hide-sub-form") {
        state.showSubForm = false;
        renderActionCenter();
      }
      if (actionName === "save-sub") saveSubscriptionAction();
      if (actionName === "reconcile") reconcileAction();
      if (actionName === "toggle-sub") {
        toggleSubscriptionAction(action.dataset.subId, action.dataset.enabled === "true");
      }
      if (actionName === "run-sub") runSubscriptionAction(action.dataset.subId);
      if (actionName === "delete-sub") deleteSubscriptionAction(action.dataset.subId);
    });
  }
  if (els.remindersContent) {
    els.remindersContent.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]");
      if (!action) return;
      const actionName = action.dataset.action;
      if (actionName === "mark-reminder") markReminderAction(action.dataset.reminderId);
      if (actionName === "mark-all-read") markAllRemindersRead();
      if (actionName === "reconcile") reconcileAction();
      if (actionName === "reload-reminders") openReminders();
      if (actionName === "toggle-sub") {
        toggleSubscriptionAction(action.dataset.subId, action.dataset.enabled === "true");
      }
      if (actionName === "run-sub") runSubscriptionAction(action.dataset.subId);
      if (actionName === "delete-sub") deleteSubscriptionAction(action.dataset.subId);
    });
  }
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
  bindEvents();
  syncChips();
  renderStoreList();
  registerServiceWorker();
  loadBootstrap();
  state.reminderTimer = setInterval(() => loadReminders(true), 30_000);
}

init();
