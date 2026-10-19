/* Signal desk: indicator and timeframe picker, analysis animation, result report, live tracking, trade history and the risk calculator. */
(() => {
  const TZ = "Etc/GMT-3";
  const SIDE = { BUY: ["buy", "ПОКУПКА"], SELL: ["sell", "ПРОДАЖА"] };
  const TF_LABEL = { "5m": "5м", "15m": "15м", "30m": "30м", "1h": "1ч", "4h": "4ч", "8h": "8ч", "1d": "1д" };
  const TF_FULL = { "5m": "5 мин", "15m": "15 мин", "30m": "30 мин", "1h": "1 час", "4h": "4 часа", "8h": "8 часов", "1d": "1 день" };
  const TF_SPAN = { "5m": "5 минут", "15m": "15 минут", "30m": "30 минут", "1h": "1 час", "4h": "4 часа", "8h": "8 часов", "1d": "1 день" };
  const state = { selected: new Set(), strategies: [], tf: "15m", view: "trade", tab: "request", layers: { levels: true, fvg: false, ob: false, liq: false, struct: false, sess: false }, busy: false, report: null, wait: 0, cooldown: 0, waitTimer: null, filter: "all", history: null, chipsKey: "", market: { open: true, opens: null } };
  const draft = { ids: new Set() };
  const OUTLOOK_KEY = "mt_outlook";
  const picker = { open: false, opener: null, only: false, rows: [], closeTimer: null };

  const $ = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const money = (value, digits = 2) => Number(value).toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const signed = (value, digits = 2) => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}`;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const plural = (count, one, few, many) => {
    const tail = count % 100;
    if (tail >= 11 && tail <= 14) return `${count} ${many}`;
    return `${count} ${{ 1: one, 2: few, 3: few, 4: few }[count % 10] || many}`;
  };
  const clock = (iso) => new Date(iso).toLocaleString("ru-RU", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + " (UTC+3)";
  const openClock = (iso) => {
    const when = new Date(iso);
    const sameDay = when.toLocaleDateString("ru-RU", { timeZone: TZ }) === new Date().toLocaleDateString("ru-RU", { timeZone: TZ });
    const day = sameDay ? "сегодня" : when.toLocaleDateString("ru-RU", { timeZone: TZ, weekday: "long" });
    return `${day} ${when.toLocaleTimeString("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })} (UTC+3)`;
  };

  function toast(message) {
    document.querySelectorAll(".toast").forEach((node) => node.remove());
    const node = el("div", "toast", message);
    node.setAttribute("role", "status");
    document.body.append(node);
    setTimeout(() => node.remove(), 4200);
  }
  async function call(url, body) {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "X-Requested-With": "mt-trade" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "Ошибка запроса");
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  // ------------------------------------------------------------------ indicator and timeframe picker
  const catalog = () => state.strategies.filter((item) => item.id !== "consensus");
  const chosen = () => catalog().filter((item) => state.selected.has(item.id));

  function selectionName() {
    const items = chosen();
    if (!state.strategies.length) return "Загрузка…";
    if (!items.length) return "Индикаторы не выбраны";
    if (items.length === catalog().length) return "Все индикаторы";
    if (items.length <= 2) return items.map((item) => item.name).join(" + ");
    return `Комбо: ${items.length} из ${catalog().length}`;
  }

  // The picker is a plain list: a card per indicator, grouped by kind, with "all" and "reset" above it.
  function renderPicker() {
    const root = $("stratGrid");
    root.replaceChildren();
    picker.rows = [];
    const groups = new Map();
    catalog().forEach((item) => groups.set(item.group, [...(groups.get(item.group) || []), item]));
    groups.forEach((items, name) => {
      const section = el("section", "strat-section");
      section.append(el("h4", "", name));
      const list = el("div", "strat-list");
      items.forEach((item) => {
        const button = el("button", "strat");
        button.type = "button";
        button.dataset.id = item.id;
        button.setAttribute("role", "checkbox");
        const text = el("span", "strat-text");
        text.append(el("b", "", item.name), el("small", "", item.summary));
        button.append(text, el("i", "strat-check"));
        button.addEventListener("click", () => {
          if (!draft.ids.delete(item.id)) draft.ids.add(item.id);
          syncPicker();
        });
        list.append(button);
        picker.rows.push({ item, button });
      });
      section.append(list);
      root.append(section);
    });
  }

  function syncPicker() {
    picker.rows.forEach((row) => {
      const active = draft.ids.has(row.item.id);
      row.button.classList.toggle("active", active);
      row.button.setAttribute("aria-checked", String(active));
    });
    const total = catalog().length;
    $("pickCount").textContent = `${draft.ids.size} из ${total}`;
    $("pickAll").classList.toggle("active", draft.ids.size === total);
    $("pickConfirmLabel").textContent = draft.ids.size ? `Применить · ${draft.ids.size}` : "Выберите индикатор";
    $("pickConfirm").disabled = draft.ids.size === 0;
  }

  function openPicker() {
    if (picker.open || state.busy || !state.strategies.length) return;
    picker.open = true;
    picker.opener = document.activeElement;
    clearTimeout(picker.closeTimer);
    draft.ids = new Set(state.selected);
    syncPicker();
    $("pickModal").hidden = false;
    $("pickBackdrop").hidden = false;
    void $("pickModal").offsetWidth;
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => { $("pickModal").classList.add("open"); $("pickBackdrop").classList.add("open"); });
    $("pickClose").focus();
    $("pickModal").querySelector(".modal-body").scrollTop = 0;
  }

  function closePicker() {
    if (!picker.open) return;
    picker.open = false;
    $("pickModal").classList.remove("open");
    $("pickBackdrop").classList.remove("open");
    document.body.classList.remove("modal-open");
    picker.closeTimer = setTimeout(() => { if (!picker.open) { $("pickModal").hidden = true; $("pickBackdrop").hidden = true; } }, 280);
    if (picker.opener && picker.opener.focus) picker.opener.focus();
  }

  function confirmPicker() {
    if (!draft.ids.size) return;
    state.selected = new Set(draft.ids);
    closePicker();
    updateDesk();
  }

  function trapFocus(event) {
    if (event.key !== "Tab" || !picker.open) return;
    const nodes = [...$("pickModal").querySelectorAll("button:not([disabled]), input")].filter((node) => node.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function updateDesk() {
    const items = chosen();
    $("pickName").textContent = selectionName();
    $("pickMeta").textContent = state.strategies.length ? `${items.length} из ${catalog().length}` : "";
    document.querySelectorAll("#deskTf button").forEach((button) => {
      const active = button.dataset.tf === state.tf;
      button.classList.toggle("active", active);
      button.setAttribute("aria-checked", String(active));
    });
    $("askSummary").textContent = `XAU/USD · ${TF_FULL[state.tf]} · ${selectionName()}`;
    const closed = $("deskClosed");
    closed.hidden = state.market.open;
    if (!state.market.open && state.market.opens) closed.textContent = `Рынок золота закрыт, открытие: ${openClock(state.market.opens)}. Сигнал всё равно доступен: он построен по последним данным и рассчитан на открытие рынка.`;
    const key = `${items.length}:${items.map((item) => item.id).join(",")}`;
    if (key !== state.chipsKey) {
      state.chipsKey = key;
      const chips = $("pickChips");
      chips.replaceChildren();
      chips.hidden = !items.length || items.length === catalog().length;
      if (!chips.hidden) {
        items.slice(0, 6).forEach((item) => chips.append(el("span", "pick-chip", item.name)));
        if (items.length > 6) chips.append(el("span", "pick-chip more", `+${items.length - 6}`));
      }
    }
    const waiting = state.wait > 0;
    const ask = $("askSignal");
    $("askLabel").textContent = waiting ? `Следующий сигнал через ${Math.floor(state.wait / 60)}:${String(state.wait % 60).padStart(2, "0")}` : "Запросить сигнал";
    ask.classList.toggle("cooling", waiting);
    ask.style.setProperty("--cd", `${waiting ? Math.min(100, Math.max(0, (1 - state.wait / state.cooldown) * 100)) : 100}%`);
    ask.disabled = !items.length || state.busy || waiting;
  }

  // The countdown is computed from an end time, so a throttled background tab cannot make it drift.
  function startCooldown(seconds) {
    clearInterval(state.waitTimer);
    state.waitEnd = Date.now() + Math.max(0, Math.ceil(seconds)) * 1000;
    const tick = () => {
      state.wait = Math.max(0, Math.ceil((state.waitEnd - Date.now()) / 1000));
      if (state.wait <= 0) clearInterval(state.waitTimer);
      updateDesk();
    };
    state.wait = Math.max(0, Math.ceil(seconds));
    if (state.wait > 0) state.waitTimer = setInterval(tick, 1000);
    updateDesk();
    state.refreshCooldown = tick;
  }

  // ------------------------------------------------------------------ analysis animation
  // A closed market is explained once, in a popup that waits for "Got it".
  function showOutlookNotice(outlook) {
    document.querySelectorAll(".notice-overlay").forEach((node) => node.remove());
    const overlay = el("div", "notice-overlay");
    const box = el("div", "notice-card");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", "noticeTitle");
    const title = el("h3", "", "Рынок сейчас закрыт");
    title.id = "noticeTitle";
    const ok = el("button", "btn btn-gold full", "Понятно");
    ok.type = "button";
    box.append(
      el("span", "notice-icon", "!"),
      title,
      el("p", "", `Сигнал построен по последним данным и рассчитан на открытие рынка: ${openClock(outlook.opens)}.`),
      el("p", "", `Вход — после открытия, если цена в пределах ±${money(outlook.gap_tolerance)} $ от ${money(outlook.close_price)}.`),
      ok,
    );
    overlay.append(box);
    const close = () => { document.removeEventListener("keydown", onKey); document.body.classList.remove("modal-open"); overlay.classList.remove("open"); setTimeout(() => overlay.remove(), 250); };
    const onKey = (event) => { if (event.key === "Escape" || event.key === "Enter") { event.preventDefault(); close(); } };
    ok.addEventListener("click", close);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
    document.addEventListener("keydown", onKey);
    document.body.append(overlay);
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => overlay.classList.add("open"));
    ok.focus();
  }

  // ------------------------------------------------------------------ analysis animation
  const STEP_DELAY = 650;
  const STEPS = (names, tf) => [
    "Подключаемся к рынку XAU/USD",
    "Загружаем свечи по 5 таймфреймам",
    names.length <= 3 ? `Считаем на ${tf}: ${names.join(", ")}` : `Считаем ${plural(names.length, "индикатор", "индикатора", "индикаторов")} на ${tf}`,
    ...(names.length > 1 ? ["Сводим голоса выбранных индикаторов"] : []),
    "Определяем глобальный тренд и структуру рынка",
    "Ищем имбалансы FVG, ликвидность и уровни",
    "Сверяем с 200+ индикаторами рынка",
    "Проверяем выбранные индикаторы на истории",
    "Строим сделку: вход, стоп-лосс и цели",
  ];

  function showAnalyzing() {
    const list = $("analyzingSteps");
    list.replaceChildren();
    const names = chosen().map((item) => item.name);
    const steps = STEPS(names, TF_FULL[state.tf]).map((text) => {
      const item = el("li", "", text);
      item.style.setProperty("--i", String(list.children.length));
      list.append(item);
      return item;
    });
    $("analyzingTitle").textContent = "Бот анализирует рынок…";
    $("analyzingSub").textContent = `XAU/USD · ${TF_FULL[state.tf]} · ${selectionName()}`;
    $("thinkBar").style.width = "4%";
    $("analyzingBack").hidden = true;
    $("analyzing").classList.remove("failed");
    $("analyzing").hidden = false;
    let index = 0;
    let reachedLast;
    const lastStep = new Promise((resolve) => { reachedLast = resolve; });
    steps[0].classList.add("active");
    const timer = setInterval(() => {
      if (index >= steps.length - 1) return;
      steps[index].classList.replace("active", "done");
      steps[++index].classList.add("active");
      $("thinkBar").style.width = `${Math.round((index / steps.length) * 100)}%`;
      if (index === steps.length - 1) reachedLast();
    }, STEP_DELAY);
    return {
      reachedLast: lastStep,
      finish() {
        clearInterval(timer);
        steps.forEach((step) => { step.classList.remove("active"); step.classList.add("done"); });
        $("thinkBar").style.width = "100%";
        $("analyzingTitle").textContent = "Готово";
      },
      fail(message) {
        clearInterval(timer);
        $("analyzing").classList.add("failed");
        $("analyzingTitle").textContent = message;
        $("analyzingBack").hidden = false;
        $("analyzingBack").focus();
      },
    };
  }

  // Hides everything except the analysis view; the page fades out first so the change is not abrupt.
  async function enterFocus() {
    const page = $("cabPage");
    page.classList.add("leaving");
    await wait(380);
    page.classList.replace("leaving", "focus");
    document.body.classList.add("thinking");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function exitFocus() {
    $("cabPage").classList.remove("focus", "leaving");
    document.body.classList.remove("thinking");
  }

  function leaveAnalysis() {
    $("analyzing").hidden = true;
    exitFocus();
    showTab(state.tab);
  }

  // The four sections of the cabinet. The last signal stays in the Analysis tab until a new one replaces it.
  function syncNav() {
    document.querySelectorAll(".bottom-nav [data-nav]").forEach((button) => button.classList.toggle("active", button.dataset.nav === state.tab));
  }

  function redrawChart() {
    if (state.report && state.canvas && state.view !== "summary" && !$("result").hidden) SignalChart.draw(state.canvas, state.report, state.view, state.layers);
  }

  function showTab(name) {
    state.tab = name;
    const has = Boolean(state.report);
    $("signalDesk").hidden = name !== "request";
    $("result").hidden = name !== "analysis" || !has;
    $("market").hidden = name !== "analysis" || !has;
    $("newSignal").hidden = name !== "analysis" || !has;
    $("analysisEmpty").hidden = name !== "analysis" || has;
    $("historyPage").hidden = name !== "history";
    $("riskPage").hidden = name !== "risk";
    if ($("newsPage")) $("newsPage").hidden = name !== "news";
    syncNav();
    window.scrollTo({ top: 0, behavior: "instant" });
    if (name === "analysis") requestAnimationFrame(redrawChart);
    if (name === "history") loadHistory();
    if (name === "news") loadNews();
  }

  async function requestSignal() {
    const ids = chosen().map((item) => item.id);
    if (!ids.length || state.busy || state.wait > 0) return;
    state.busy = true;
    updateDesk();
    stopLive();
    await enterFocus();
    const progress = showAnalyzing();
    try {
      const assetEl = document.getElementById("assetSelect");
      const symbol = assetEl ? assetEl.value : "XAUUSD";
      const [report] = await Promise.all([call("/api/signal", { strategies: ids, tf: state.tf, symbol }), progress.reachedLast]);
      progress.finish();
      await wait(600);
      state.report = report;
      window.__lastReport = report;
      startCooldown(report.next_signal_in || 0);
      leaveAnalysis();
      renderResult(report);
      if (report.outlook) showOutlookNotice(report.outlook);
      loadHistory();
    } catch (error) {
      if (error.message === "unauthorized") return;
      if (error.payload && error.payload.wait) startCooldown(error.payload.wait);
      progress.fail(error.message);
    } finally {
      state.busy = false;
      updateDesk();
    }
  }

  // ------------------------------------------------------------------ result
  const card = (className) => el("section", `glass res-card ${className || ""}`);

  const SVG_NS = "http://www.w3.org/2000/svg";
  const svgNode = (tag, attrs = {}, className = "") => {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (className) node.setAttribute("class", className);
    return node;
  };
  let ringSeq = 0;

  // Vector ring: the arc is drawn on a normalised path so it stays crisp at any scale and animates to the value.
  function confidenceRing(rawValue, tone, caption) {
    const known = rawValue !== null;
    const value = known ? Math.max(0, Math.min(100, Math.round(rawValue))) : 0;
    const label = caption || (value >= 72 ? "Высокий" : value >= 62 ? "Хороший" : value >= 50 ? "Умеренный" : "Низкий");
    const wrap = el("div", `conf ${tone}${value ? "" : " empty"}`);
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", caption ? `${caption}: ${known ? `${value}%` : "нет данных"}` : `Шанс первой цели: ${value}%, ${label.toLowerCase()}`);
    const gradId = `confGrad${++ringSeq}`;
    const svg = svgNode("svg", { viewBox: "0 0 88 88", "aria-hidden": "true" });
    const defs = svgNode("defs");
    const grad = svgNode("linearGradient", { id: gradId, x1: 0, y1: 0, x2: 1, y2: 1 });
    grad.append(svgNode("stop", { offset: 0 }, "stop-a"), svgNode("stop", { offset: 1 }, "stop-b"));
    defs.append(grad);
    const ring = { cx: 44, cy: 44, transform: "rotate(-90 44 44)", pathLength: 100 };
    const track = svgNode("circle", { ...ring, r: 37 }, "track");
    const front = svgNode("circle", { ...ring, r: 37, stroke: `url(#${gradId})` }, "front");
    front.style.strokeDasharray = `0 100`;
    const knob = svgNode("g", {}, "knob");
    knob.append(svgNode("circle", { cx: 44, cy: 7, r: 2.6 }));
    svg.append(defs, track, front, knob);
    const text = el("div", "conf-text");
    const number = el("b", "");
    const digits = document.createTextNode(known ? String(value) : "—");
    number.append(digits);
    if (known) number.append(el("small", "", "%"));
    text.append(number, el("span", "", label));
    wrap.append(svg, text);
    // Two frames: the browser must paint the empty ring before the dash length transition can run. The number is always the real value.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      front.style.strokeDasharray = `${value} 100`;
      knob.style.transform = `rotate(${value * 3.6}deg)`;
    }));
    return wrap;
  }

  const PARTIALS = [50, 30, 20];

  // Open trade in R: shares already closed at targets plus the floating result of the rest; the stop never moves. Same rule as the server.
  function openR(trade, price) {
    const side = trade.side === "BUY" ? 1 : -1;
    const rest = trade.risk ? ((price - trade.entry) * side) / trade.risk : 0;
    const hit = trade.tp_hit || 0;
    if (!hit) return rest;
    const rr = trade.rr || [1, 2, 3];
    let done = 0, left = 0;
    PARTIALS.forEach((share, k) => { if (k < hit) done += (share / 100) * rr[k]; else left += share / 100; });
    return done + left * rest;
  }

  function tradeState(trade, price) {
    if (!trade) return null;
    if (trade.status === "open") {
      return { cls: trade.tp_hit ? "win" : "open", text: trade.tp_hit ? `Открыт · TP${trade.tp_hit} достигнут` : "Открыт · в процессе", note: `${signed(openR(trade, price))} R` };
    }
    if (trade.result === "win") return { cls: "win", text: trade.tp_hit === 3 ? "Отработал · TP3 ✓" : `Закрыт · TP${trade.tp_hit} достигнут`, note: `${signed(trade.r ?? 0)} R` };
    if (trade.result === "loss") return { cls: "loss", text: "Стоп-лосс ✗", note: "−1 R" };
    return { cls: "expired", text: "Истёк без результата", note: `${signed(trade.r)} R` };
  }

  function renderHead(report) {
    const [cls, text] = SIDE[report.side];
    const head = card(`res-head ${cls}`);
    const top = el("div", "res-top");
    top.append(el("span", `side-pill ${cls}`, text));
    if (report.confidence !== null) top.append(confidenceRing(report.confidence, cls));
    const info = el("div", "res-info");
    info.append(el("h2", "", `XAU/USD · ${TF_FULL[report.timeframe]}${report.outlook ? " · на открытие" : ""}`), el("p", "", `${report.strategy.name} · ${clock(report.generated)}`));
    head.append(top, info);
    if (report.reasons && report.reasons.length) {
      const list = el("ul", "res-reasons");
      report.reasons.forEach((text) => list.append(el("li", "", text)));
      head.append(list);
    }
    return head;
  }

  const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10M7.5 10l4.5 4.5 4.5-4.5M5 19h14"/></svg>';

  const SUMMARY_BANDS = [[0.45, "Сильная покупка", "bull", "strong_bull"], [0.08, "Покупка", "bull", "bull"], [-0.08, "Нейтрально", "neutral", "neutral"], [-0.45, "Продажа", "bear", "bear"], [-Infinity, "Сильная продажа", "bear", "strong_bear"]];

  // The summary is computed from the same indicator votes the signal check uses, so the two can never disagree.
  function renderSummaryPane(report) {
    const pane = el("div", "sum-pane");
    const breadth = report.breadth;
    if (!breadth) {
      pane.append(el("p", "empty-note", "Для этого сигнала сводка недоступна."));
      return pane;
    }
    const [, label, tone, gaugeTone] = SUMMARY_BANDS.find(([limit]) => breadth.score >= limit);
    const gauge = el("div", "gauge");
    gauge.innerHTML = MT.gaugeMarkup();
    requestAnimationFrame(() => requestAnimationFrame(() => MT.setGauge(gauge, breadth.score, gaugeTone)));
    const verdict = el("div", `sum-verdict ${tone}`);
    verdict.append(el("b", "", label), el("small", "", `${breadth.total} индикаторов рынка`));
    const counts = el("div", "sum-counts");
    [["Продажа", breadth.bear, "bear"], ["Нейтрально", breadth.neutral, "neutral"], ["Покупка", breadth.bull, "bull"]].forEach(([name, value, cls]) => {
      const cell = el("span", cls);
      cell.append(el("b", "", String(value)), name);
      counts.append(cell);
    });
    pane.append(gauge, verdict, counts);
    const sideText = { BUY: "покупку", SELL: "продажу" }[report.side];
    const agrees = (report.side === "BUY" && tone === "bull") || (report.side === "SELL" && tone === "bear");
    const match = el("p", `sum-match ${agrees ? "ok" : ""}`);
    match.textContent = agrees
      ? `Сигнал на ${sideText} совпадает с большинством индикаторов.`
      : tone === "neutral" ? `Индикаторы разделились: сигнал на ${sideText} дают остальные факторы рынка.` : `Большинство индикаторов против сигнала на ${sideText}: шанс первой цели ниже, объём лучше уменьшить.`;
    pane.append(match);
    if (breadth.groups && breadth.groups.length) {
      const list = el("div", "group-list");
      breadth.groups.forEach((group) => {
        const row = el("div", "group-row");
        const top = el("div", "top");
        top.append(el("strong", "", group.name), el("span", "", `${group.bull} ▲ · ${group.neutral} ● · ${group.bear} ▼`));
        const stack = el("div", "stack");
        [["b", group.bull], ["n", group.neutral], ["r", group.bear]].forEach(([cls, count]) => {
          const part = el("i", cls);
          stack.append(part);
          requestAnimationFrame(() => { part.style.width = `${group.total ? (count / group.total) * 100 : 0}%`; });
        });
        row.append(top, stack);
        list.append(row);
      });
      pane.append(list);
    }
    return pane;
  }

  function renderChartCard(report) {
    state.layers = { levels: true, fvg: false, ob: false, liq: false, struct: false, sess: false };
    const chartCard = card("res-chart");
    const bar = el("div", "chart-bar");
    const tabs = el("div", "seg chart-seg");
    const views = [...(report.plan ? [["trade", "Сделка"]] : []), ["analysis", "Анализ"], ["summary", "Сводка"]];
    state.view = views[0][0];
    const save = el("button", "icon-btn");
    save.type = "button";
    save.title = "Загрузить график";
    save.setAttribute("aria-label", "Загрузить график");
    save.innerHTML = DOWNLOAD_ICON;
    const holder = el("div", "canvas-holder");
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `График XAU/USD ${TF_FULL[report.timeframe]}`);
    holder.append(canvas);
    const layers = el("div", "layer-chips");
    layers.hidden = state.view !== "analysis";
    const chips = [];
    // One layer at a time keeps the chart readable: choosing another switches the previous one off, tapping the active one clears the chart.
    [["levels", "Уровни", "linear-gradient(135deg, #ff7d92 50%, #4fe8b1 50%)"], ["fvg", "FVG", "#5fe3ff"], ["sess", "Сессии", "#8fa8ff"], ["ob", "Ордер-блоки", "#2de2a0"], ["liq", "Ликвидность", "#ffc457"], ["struct", "BOS / CHoCH", "#f4c25b"]].forEach(([key, label, swatch]) => {
      const chip = el("button", `chip${state.layers[key] ? " active" : ""}`, label);
      chip.style.setProperty("--sw", swatch);
      chip.title = { levels: "Цены, от которых график не раз разворачивался", fvg: "Незаполненный разрыв между свечами: цена часто возвращается к его середине", ob: "Зона, откуда крупные игроки начали сильное движение", liq: "Скопления стоп-ордеров над максимумами и под минимумами", struct: "BOS — продолжение тренда, CHoCH — первый разворот структуры", sess: "Диапазоны Азии, Лондона и Нью-Йорка" }[key];
      chip.type = "button";
      chip.setAttribute("aria-pressed", String(state.layers[key]));
      chip.addEventListener("click", () => {
        const turnOn = !state.layers[key];
        Object.keys(state.layers).forEach((name) => { state.layers[name] = false; });
        state.layers[key] = turnOn;
        chips.forEach(([name, item]) => {
          item.classList.toggle("active", state.layers[name]);
          item.setAttribute("aria-pressed", String(state.layers[name]));
        });
        refreshNotes();
        redrawChart();
      });
      chips.push([key, chip]);
      layers.append(chip);
    });
    const summary = renderSummaryPane(report);
    summary.hidden = true;
    const notes = el("div", "layer-notes");
    const refreshNotes = () => {
      notes.replaceChildren();
      SignalChart.notes(report, state.layers).forEach((note) => {
        const line = el("p", "", note.text);
        line.style.setProperty("--sw", `rgb(${note.rgb})`);
        notes.append(line);
      });
      notes.hidden = state.view !== "analysis" || !notes.children.length;
    };
    const buttons = views.map(([key, label]) => {
      const button = el("button", key === state.view ? "active" : "", label);
      button.type = "button";
      button.addEventListener("click", () => {
        state.view = key;
        buttons.forEach((item) => item.classList.toggle("active", item === button));
        const isSummary = key === "summary";
        holder.hidden = isSummary;
        summary.hidden = !isSummary;
        layers.hidden = key !== "analysis";
        refreshNotes();
        save.disabled = isSummary;
        if (!isSummary) redrawChart();
      });
      tabs.append(button);
      return button;
    });
    bar.append(tabs, save);
    chartCard.append(bar, holder, layers, notes, summary);
    refreshNotes();
    save.addEventListener("click", () => SignalChart.download(canvas, report));
    state.canvas = canvas;
    return chartCard;
  }
  function ladderRows(report) {
    const plan = report.plan;
    const trade = report.trade;
    const hit = trade ? trade.tp_hit : 0;
    const stopped = Boolean(trade && trade.result === "loss");
    const distance = (price) => Math.abs(price - plan.entry);
    const rr = plan.rr || [];
    const rows = [
      { kind: "entry", name: "Вход", price: plan.entry, note: report.outlook ? "уровень закрытия, вход после открытия" : "текущая цена" },
      { kind: "sl", name: stopped ? "Стоп-лосс ✗" : "Стоп-лосс", price: plan.stop, note: `−${money(distance(plan.stop))} $ · −1R`, done: stopped },
      ...plan.targets.map((price, i) => ({ kind: "tp", name: `Тейк-профит ${i + 1}${hit > i ? " ✓" : ""}`, price, note: `+${money(distance(price))} $${rr[i] ? ` · +${money(rr[i], rr[i] % 1 ? 2 : 0)}R` : ""}${plan.target_basis && plan.target_basis[i] && plan.target_basis[i] !== "расчёт" ? ` · у ${plan.target_basis[i]}` : ""}`, done: hit > i })),
    ];
    return rows.sort((a, b) => b.price - a.price);
  }

  // Live state of the trade: status, floating result in R and the current price.
  function refreshStatus(report) {
    const box = state.statusBox;
    if (!box || !report.trade || !report.plan) return;
    const price = report.price ?? report.trade.price ?? report.plan.entry;
    const info = tradeState(report.trade, price);
    box.className = `trade-status ${info.cls}`;
    box.replaceChildren();
    const text = el("div", "ts-text");
    text.append(el("b", "", info.text), el("small", "", report.trade.status === "open" ? `Цена сейчас ${money(price)}` : "Сделка закрыта"));
    box.append(el("i", "ts-dot"), text, el("strong", "", info.note));
  }

  function refreshLadder(report) {
    const box = state.ladderBox;
    if (!box || !report.plan) return;
    box.replaceChildren();
    ladderRows(report).forEach((row) => {
      const node = el("div", `ladder-row ${row.kind}${row.done ? " done" : ""}`);
      node.append(el("i", "dot"));
      const name = el("div", "ladder-name");
      name.append(el("b", "", row.name), el("small", "", row.note));
      node.append(name, el("strong", "", money(row.price)));
      box.append(node);
    });
  }

  function renderPlan(report) {
    const plan = report.plan;
    const wrap = card("res-plan");
    const head = el("div", "card-title");
    head.append(el("h3", "", "Параметры сделки"), el("small", "", `${report.side === "BUY" ? "покупка" : "продажа"} · ${report.outlook ? "после открытия рынка" : `на ${TF_SPAN[report.timeframe]}`}`));
    wrap.append(head);
    state.statusBox = report.trade ? el("div", "trade-status") : null;
    if (state.statusBox) { refreshStatus(report); wrap.append(state.statusBox); }
    state.ladderBox = el("div", "ladder");
    refreshLadder(report);
    wrap.append(state.ladderBox);
    return wrap;
  }

  // Standalone lot calculator: lots = deposit x risk% / (stop in $ x contract size).
  const RISK_MAX = 5;

  const CONTRACT = 100;
  function renderRisk() {
    const wrap = card("res-risk");
    const head = el("div", "card-title");
    head.append(el("h3", "", "Расчёт лота"), el("small", "", `риск не выше ${RISK_MAX}%`));
    wrap.append(head);

    const stored = (key) => { try { return localStorage.getItem(key) || ""; } catch { return ""; } };
    const store = (key, value) => { try { localStorage.setItem(key, String(value)); } catch { /* storage may be blocked */ } };
    const numeric = (value) => Number(String(value).replace(",", "."));
    const makeInput = (label, value, placeholder) => {
      const field = el("label", "risk-field");
      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "decimal";
      input.autocomplete = "off";
      input.placeholder = placeholder;
      input.value = value;
      field.append(el("span", "", label), input);
      return { field, input };
    };
    const deposit = makeInput("Депозит, $", stored("mt_deposit"), "1000");
    const risk = makeInput("Риск на сделку, %", stored("mt_risk") || "1", "1");
    const stop = makeInput("Стоп-лосс, $ (расстояние по цене)", stored("mt_stop") || "5", "5");

    const seg = el("div", "seg wide risk-chips");
    const chipButtons = [0.5, 1, 2, 3, 5].map((value) => {
      const button = el("button", "", `${String(value).replace(".", ",")}%`);
      button.type = "button";
      button.addEventListener("click", () => { risk.input.value = String(value).replace(".", ","); syncChips(); calculate(); });
      seg.append(button);
      return { button, value };
    });
    const syncChips = () => chipButtons.forEach(({ button, value }) => button.classList.toggle("active", value === numeric(risk.input.value)));

    const form = el("div", "risk-form");
    form.append(deposit.field, risk.field, seg, stop.field);
    wrap.append(form);
    const out = el("div", "risk-result");
    out.setAttribute("aria-live", "polite");
    wrap.append(out);

    const notice = (tone, text) => {
      const node = el("div", `risk-alert ${tone}`);
      node.append(el("p", "", text));
      return node;
    };
    const cell = (label, value, hint, tone) => {
      const node = el("div", `risk-cell ${tone}`);
      node.append(el("span", "", label), el("b", "", value), el("small", "", hint));
      return node;
    };

    function calculate() {
      out.replaceChildren();
      const balance = numeric(deposit.input.value);
      let percent = numeric(risk.input.value);
      const stopSize = numeric(stop.input.value);
      if (!(balance > 0) || balance > 1e8 || !(percent > 0) || !(stopSize > 0) || stopSize > 1000) {
        out.append(notice("hint", "Введите депозит, риск и стоп — лот посчитается сам."));
        return;
      }
      if (percent > RISK_MAX) { percent = RISK_MAX; risk.input.value = String(RISK_MAX); }
      syncChips();
      store("mt_deposit", balance);
      store("mt_risk", String(percent).replace(".", ","));
      store("mt_stop", stopSize);
      const budget = (balance * percent) / 100;
      const perLot = stopSize * CONTRACT;
      const lots = Math.floor((budget / perLot) * 100) / 100;
      if (lots < 0.01) {
        out.append(notice("bad", `Депозит мал для такого стопа: минимальный лот 0,01 рискует ${money(perLot / 100)} $, а допустимо ${money(budget)} $. Нужен депозит от ${money(perLot / 100 / (percent / 100), 0)} $ или стоп поменьше.`));
        return;
      }
      const grid = el("div", "risk-out");
      grid.append(
        cell("Лот", money(lots), "объём позиции", "gold"),
        cell("Риск", `${money(lots * perLot)} $`, `${String(percent).replace(".", ",")}% депозита`, "bear"),
      );
      out.append(grid);
    }

    deposit.input.addEventListener("input", calculate);
    risk.input.addEventListener("input", () => { syncChips(); calculate(); });
    stop.input.addEventListener("input", calculate);
    syncChips();
    calculate();
    return wrap;
  }

  // The Risk tab: a lot calculator that does not depend on any signal.
  function renderRiskPage() {
    const page = $("riskPage");
    page.replaceChildren();
    const intro = el("div", "page-head");
    const title = el("div");
    title.append(el("h2", "", "Риск-менеджмент"), el("p", "", "Сколько лотов открывать под ваш депозит"));
    intro.append(title);
    state.riskCard = renderRisk();
    page.append(intro, state.riskCard);
  }

  function renderInsight(report) {
    const wrap = card("res-insight");
    const head = el("div", "card-title");
    head.append(el("h3", "", "Разбор сигнала"), el("small", "", "почему такой вердикт"));
    wrap.append(head);
    const know = report.knowledge;
    if (know) {
      const chips = el("div", "know-chips");
      const chip = (tone, label, value, hint) => {
        const node = el("span", `know-chip ${tone}`);
        node.append(el("small", "", label), el("b", "", value));
        if (hint) node.title = hint;
        chips.append(node);
      };
      const volatility = { extreme: ["аномальная", "bad"], high: ["повышенная", "warn"], low: ["низкая", "warn"], normal: ["обычная", "good"] }[know.volatility.key] || ["—", ""];
      const eventShort = know.event.name.length > 24 ? `${know.event.name.slice(0, 23)}…` : know.event.name;
      chip(report.outlook ? "warn" : know.open ? "good" : "bad", "Рынок", report.outlook || !know.open ? "закрыт" : "открыт");
      chip(know.session.shift > 0 ? "good" : know.session.shift < 0 ? "warn" : "", "Сессия", know.session.name, know.session.tip);
      chip(know.event.level === "blackout" ? "bad" : know.event.level === "caution" ? "warn" : "good", "Новости", know.event.level === "none" ? "нет важных" : eventShort, know.event.text);
      chip(volatility[1], "Волатильность", volatility[0], know.volatility.text);
      wrap.append(chips);
    }
    (report.description || []).forEach((item, index) => {
      const block = el("details", "insight");
      block.open = index === 0;
      block.append(el("summary", "", item.title), el("p", "", item.text));
      wrap.append(block);
    });
    return wrap;
  }

  function renderResult(report, initialCount, activate = true) {
    const box = $("result");
    box.replaceChildren();
    box.className = `sig-result tone-${report.side.toLowerCase()}`;
    box.append(...[renderHead(report), renderChartCard(report), renderPlan(report), renderInsight(report)]);
    state.report = report;
    window.__lastReport = report;
    if (report.outlook) { try { sessionStorage.setItem(OUTLOOK_KEY, JSON.stringify(report)); } catch { /* too large or blocked */ } }
    showTab(activate ? "analysis" : state.tab);
    requestAnimationFrame(redrawChart);
    startLive(report, initialCount);
    document.dispatchEvent(new CustomEvent("signalready", { detail: { tf: report.timeframe } }));
  }

  // ------------------------------------------------------------------ live updates
  function mergeCandles(report, incoming) {
    const chart = report.chart;
    incoming.forEach((candle) => {
      const last = chart.candles[chart.candles.length - 1];
      if (candle[0] === last[0]) {
        chart.candles[chart.candles.length - 1] = candle;
      } else if (candle[0] > last[0]) {
        chart.candles.push(candle);
        chart.overlays.forEach((overlay) => overlay.values.push(null));
        if (chart.pane) {
          chart.pane.lines.forEach((line) => line.values.push(null));
          if (chart.pane.hist) chart.pane.hist.push(null);
        }
      }
    });
    while (chart.candles.length > 130) {
      chart.candles.shift();
      chart.overlays.forEach((overlay) => overlay.values.shift());
      if (chart.pane) {
        chart.pane.lines.forEach((line) => line.values.shift());
        if (chart.pane.hist) chart.pane.hist.shift();
      }
    }
  }

  const live = { timer: null, catchUp: true };

  function stopLive() {
    clearInterval(live.timer);
    live.timer = null;
  }

  // Seconds per candle of the chart frame, to know how many candles were missed while the tab was in the background.
  const FRAME_SECONDS = { "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400 };

  const onSpot = (source) => /gold-api/.test(source || "");
  function sameScale(report, data) {
    if (!data.source || !report.source || data.source === report.source) return true;
    if (onSpot(data.source) && onSpot(report.source)) return true;
    const mine = new Map(report.chart.candles.map((candle) => [candle[0], candle[4]]));
    const newest = data.candles[data.candles.length - 1][0];
    const shared = data.candles.find((candle) => candle[0] !== newest && mine.has(candle[0]));
    return Boolean(shared) && Math.abs(shared[4] - mine.get(shared[0])) <= Math.max(2, 1.2 * (report.atr || 1));
  }

  async function tickLive(report, count = 4) {
    if (document.hidden || state.report !== report) return;
    // Off the Analysis tab nothing is drawn: skip the request and catch up on the missed candles when the tab opens again.
    if (state.tab !== "analysis") { live.catchUp = true; return; }
    if (live.busy) return;
    live.busy = true;
    const tradeParam = report.trade ? `&trade=${report.trade.id}` : "";
    const frameTf = report.chart_tf || report.timeframe;
    const lastTime = report.chart.candles[report.chart.candles.length - 1][0];
    const missed = live.catchUp ? Math.ceil((Date.now() / 1000 - lastTime) / (FRAME_SECONDS[frameTf] || 900)) + 2 : 0;
    try {
      const assetEl = document.getElementById("assetSelect");
      const sym = report.trade?.symbol || report.symbol || (assetEl ? assetEl.value : "XAUUSD");
      const data = await call(`/api/live?symbol=${encodeURIComponent(sym)}&tf=${frameTf}&n=${Math.max(count, Math.min(200, missed))}${tradeParam}`);
      live.catchUp = false;
      if (state.report !== report) return;
      // Candles of another feed are used only when they sit on the same scale as the plan (both shifted to the XAU/USD spot, or the same overlapping candle matches).
      if (sameScale(report, data)) {
        mergeCandles(report, data.candles);
        report.price = data.price;
      }
      if (data.source) report.source = data.source;
      if (data.broker_symbol) report.broker_symbol = data.broker_symbol;
      if (data.is_stale !== undefined) report.is_stale = data.is_stale;
      if (data.trade) report.trade = data.trade;
      refreshLadder(report);
      refreshStatus(report);
      redrawChart();
      if (report.trade && report.trade.status === "closed") { stopLive(); loadHistory(); }
    } catch { /* The next tick retries. */ } finally {
      live.busy = false;
    }
  }

  function startLive(report, initialCount) {
    stopLive();
    if (report.trade && report.trade.status === "closed") return;
    live.catchUp = true;
    if (initialCount) tickLive(report, initialCount);
    live.timer = setInterval(() => tickLive(report), 1000);
  }

  // Back from another tab: fetch every candle missed meanwhile at once.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !live.timer || !state.report) return;
    live.catchUp = true;
    tickLive(state.report);
  });

  // ------------------------------------------------------------------ history
  async function openTrade(id) {
    if (state.busy) return;
    try {
      const report = await call(`/api/trades/${id}`);
      state.report = report;
      renderResult(report, 130);
    } catch (error) {
      if (error.message !== "unauthorized") toast(error.message);
    }
  }

  const dayKey = (seconds) => new Date(seconds * 1000).toLocaleDateString("ru-RU", { timeZone: TZ });
  const timeOnly = (seconds) => new Date(seconds * 1000).toLocaleTimeString("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

  function dayTitle(seconds) {
    const now = Date.now() / 1000;
    if (dayKey(seconds) === dayKey(now)) return "Сегодня";
    if (dayKey(seconds) === dayKey(now - 86400)) return "Вчера";
    return new Date(seconds * 1000).toLocaleDateString("ru-RU", { timeZone: TZ, day: "numeric", month: "long" });
  }

  // Result in risk units: final for closed trades, floating for open ones.
  function tradeR(trade) {
    if (trade.status === "closed") return trade.r ?? 0;
    return openR(trade, trade.price ?? trade.entry);
  }
  const rText = (value) => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}R`;

  function shortState(trade) {
    if (trade.status === "open") return trade.tp_hit ? `В процессе · TP${trade.tp_hit}` : "В процессе";
    if (trade.result === "win") return trade.tp_hit === 3 ? "Тейк · TP3" : `Закрыт · TP${trade.tp_hit}`;
    if (trade.result === "loss") return "Стоп";
    return "Истёк";
  }

  const ARROW = {
    buy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg>',
    sell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7l10 10M17 9v8H9"/></svg>',
  };

  const clockSeconds = (ms) => new Date(ms).toLocaleTimeString("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit" });

  function renderHistorySummary() {
    const summary = state.history.summary;
    $("historySummary").textContent = (summary.total ? plural(summary.total, "сделка", "сделки", "сделок") : "пока пусто") + (state.historyAt ? ` · обновлено ${clockSeconds(state.historyAt)}` : "");
    const dot = $("historyDot");
    dot.hidden = !summary.open;
    dot.textContent = summary.open;
  }

  // Dynamic part of a card: result, status and live price. Used for the first draw and for in-place refreshes.
  function fillRow(row, trade) {
    const info = tradeState(trade, trade.price || trade.entry);
    const result = tradeR(trade);
    row.className = `tcard ${info.cls}${row.classList.contains("loading") ? " loading" : ""}`;
    row._res.className = `tc-result ${result > 0.05 ? "pos" : result < -0.05 ? "neg" : ""}`;
    row._res.textContent = rText(result);
    row._status.className = `tc-status ${info.cls}${trade.status === "open" ? " live" : ""}`;
    row._statusText.textContent = `${shortState(trade)}${trade.status === "open" ? ` · цена ${money(trade.price || trade.entry)}` : trade.closed ? ` · ${timeOnly(trade.closed)}` : ""}`;
  }

  function tradeRow(trade) {
    const buy = trade.side === "BUY";
    const row = el("button", "tcard");
    row.type = "button";
    row.dataset.id = trade.id;
    const icon = el("span", `hr-icon ${buy ? "buy" : "sell"}`);
    icon.innerHTML = ARROW[buy ? "buy" : "sell"];
    const title = el("span", "tc-title");
    title.append(el("b", "", `${buy ? "Покупка" : "Продажа"} · ${TF_LABEL[trade.tf]}`), el("small", "", `XAU/USD · ${timeOnly(trade.created)}`));
    const head = el("span", "tc-head");
    row._res = el("span", "tc-result");
    head.append(icon, title, row._res);
    row._status = el("span", "tc-status");
    row._statusText = el("span");
    row._status.append(el("i"), row._statusText);
    fillRow(row, trade);
    const status = row._status;
    const levels = el("span", "tc-levels");
    const lastTp = trade.targets.length;
    [["Вход", trade.entry, ""], ["Стоп", trade.stop, "bear"], [`TP${lastTp}`, trade.targets[lastTp - 1], "bull"]].forEach(([name, value, cls]) => {
      const cell = el("span", cls);
      cell.append(el("small", "", name), el("b", "", money(value)));
      levels.append(cell);
    });
    row.append(head, status, levels);
    row.addEventListener("click", async () => {
      if (row.classList.contains("loading")) return;
      row.classList.add("loading");
      await openTrade(trade.id);
      row.classList.remove("loading");
    });
    return row;
  }

  function renderHistoryList() {
    const data = state.history;
    const list = $("histList");
    list.replaceChildren();
    if (!data.items.length) {
      const empty = el("div", "hist-empty");
      const go = el("button", "btn btn-gold btn-small", "Запросить сигнал");
      go.type = "button";
      go.addEventListener("click", () => showTab("request"));
      empty.append(el("b", "", "Пока нет сделок"), el("p", "", "Здесь появятся ваши сигналы и их результат: тейк-профит или стоп-лосс."), go);
      list.append(empty);
      return;
    }
    const groups = new Map();
    data.items.forEach((trade) => {
      const key = dayKey(trade.created);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(trade);
    });
    groups.forEach((trades) => {
      const group = el("div", "hist-group");
      const day = el("div", "hist-day");
      const sum = trades.filter((t) => t.status === "closed").reduce((acc, t) => acc + (t.r ?? 0), 0);
      day.append(el("span", "", dayTitle(trades[0].created)));
      if (trades.some((t) => t.status === "closed")) day.append(el("em", sum > 0.05 ? "pos" : sum < -0.05 ? "neg" : "", rText(sum)));
      group.append(day);
      trades.forEach((trade) => group.append(tradeRow(trade)));
      list.append(group);
    });
  }

  function renderHistory() {
    if (!state.history) return;
    renderHistorySummary();
    renderHistoryList();
  }

  async function loadHistory() {
    if (state.historyBusy) return;
    state.historyBusy = true;
    try {
      const data = await call("/api/trades");
      state.historyAt = Date.now();
      // Same trades in the same states: only prices and results move, so the cards are updated in place.
      const shape = data.items.map((t) => `${t.id}:${t.status}:${t.tp_hit}:${t.r}`).join("|");
      const same = state.history && shape === state.historyShape;
      state.history = data;
      state.historyShape = shape;
      if (!same) { renderHistory(); return; }
      renderHistorySummary();
      const byId = new Map(data.items.map((t) => [t.id, t]));
      $("histList").querySelectorAll(".tcard").forEach((row) => { const trade = byId.get(row.dataset.id); if (trade) fillRow(row, trade); });
    } catch { /* The next refresh retries. */ } finally {
      state.historyBusy = false;
    }
  }

  // After a reload the Analysis tab shows the most recent signal again.
  async function restoreLast() {
    await loadHistory();
    const latest = state.history && state.history.items[0];
    if (state.report || state.busy) return;
    let outlook = null;
    try { outlook = JSON.parse(sessionStorage.getItem(OUTLOOK_KEY) || "null"); } catch { /* ignore a broken copy */ }
    // The saved weekend outlook counts only while it is newer than the latest tracked trade and still before its open.
    if (outlook && outlook.outlook && outlook.plan && Date.parse(outlook.outlook.opens) > Date.now() && (!latest || Date.parse(outlook.generated) / 1000 > latest.created)) {
      renderResult(outlook, 130, false);
      return;
    }
    if (!latest) return;
    try {
      const report = await call(`/api/trades/${latest.id}`);
      if (!state.report) renderResult(report, 130, false);
    } catch { /* The tab keeps its empty state. */ }
  }

  // ------------------------------------------------------------------ news & macro mode
  async function loadNews() {
    try {
      const data = await call("/api/news");
      if (!data) return;

      const f = data.forecasts || {};
      const setForecast = (idPrefix, item) => {
        if (!item) return;
        const badge = $(`${idPrefix}BiasBadge`);
        const text = $(`${idPrefix}BiasText`);
        if (badge) {
          badge.textContent = item.bias;
          badge.className = `fc-badge ${item.bias.includes("ВВЕРХ") || item.bias.includes("ПОКУПКА") ? "" : (item.bias.includes("ВНИЗ") || item.bias.includes("ПРОДАЖА") ? "bear" : "neutral")}`;
        }
        if (text) text.textContent = item.text;
      };
      setForecast("gold", f.XAUUSD);
      setForecast("btc", f.BTCUSD);
      setForecast("eur", f.EURUSD);
      setForecast("gbp", f.GBPUSD);

      const calList = $("newsCalendarList");
      if (calList && data.calendar) {
        calList.replaceChildren();
        data.calendar.slice(0, 10).forEach((ev) => {
          const row = el("div", "calendar-event-row");
          const left = el("div", "cal-left");
          const country = el("b", "", `${ev.country}: `);
          const title = el("span", "", ev.title);
          const bias = el("small", "cal-bias", ` · ${ev.reasoning || ""}`);
          bias.style.color = "var(--muted)";
          bias.style.display = "block";
          bias.style.fontSize = "11px";
          bias.style.marginTop = "3px";
          left.append(country, title, bias);

          const right = el("div", "cal-right");
          right.style.textAlign = "right";
          right.style.minWidth = "110px";
          const impactBadge = el("span", `event-impact-badge impact-${ev.impact}`, ev.impact);
          const vals = el("div", "cal-vals", ev.forecast ? `Прогноз: ${ev.forecast}` : "");
          vals.style.fontSize = "11px";
          vals.style.color = "var(--muted)";
          vals.style.marginTop = "4px";
          right.append(impactBadge, vals);

          row.append(left, right);
          calList.append(row);
        });
      }

      const headList = $("newsHeadlinesList");
      if (headList && data.headlines) {
        headList.replaceChildren();
        data.headlines.slice(0, 6).forEach((h) => {
          const row = el("div", "calendar-event-row");
          const left = el("div", "");
          const tag = el("span", `event-impact-badge ${h.sentiment === "BULLISH" ? "impact-Low" : (h.sentiment === "BEARISH" ? "impact-High" : "impact-Medium")}`, h.sentiment);
          tag.style.marginRight = "8px";
          const title = el("b", "", h.title);
          title.style.fontSize = "12px";
          const fc = el("div", "", h.forecast || "");
          fc.style.fontSize = "11px";
          fc.style.color = "#f4c25b";
          fc.style.marginTop = "3px";
          left.append(tag, title, fc);
          row.append(left);
          headList.append(row);
        });
      }

      if ($("newsCalendarUpdated")) {
        $("newsCalendarUpdated").textContent = `Обновлено: ${data.updated_at}`;
      }
    } catch (e) {
      console.error("Failed to load news:", e);
    }
  }

  // ------------------------------------------------------------------ init
  async function init() {
    renderRiskPage();
    $("askSignal").addEventListener("click", requestSignal);
    $("newSignalBtn").addEventListener("click", () => showTab("request"));
    $("emptyAsk").addEventListener("click", () => showTab("request"));
    document.querySelectorAll(".bottom-nav [data-nav]").forEach((button) => button.addEventListener("click", () => showTab(button.dataset.nav)));
    $("analyzingBack").addEventListener("click", leaveAnalysis);
    $("openPicker").addEventListener("click", openPicker);
    $("pickClose").addEventListener("click", closePicker);
    $("pickCancel").addEventListener("click", closePicker);
    $("pickBackdrop").addEventListener("click", closePicker);
    $("pickConfirm").addEventListener("click", confirmPicker);
    $("pickAll").addEventListener("click", () => { draft.ids = new Set(catalog().map((item) => item.id)); syncPicker(); });
    $("pickNone").addEventListener("click", () => { draft.ids = new Set(); syncPicker(); });
    $("deskTf").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
      if (state.busy) return;
      state.tf = button.dataset.tf;
      updateDesk();
    }));
    addEventListener("keydown", (event) => { if (event.key === "Escape") closePicker(); trapFocus(event); });
    $("historyBtn").addEventListener("click", () => showTab("history"));
    // Open trades show the live price and result, so the list refreshes every second while it is on screen.
    setInterval(() => { if (state.tab === "history" && !document.hidden && state.history && state.history.summary.open) loadHistory(); }, 1000);
    let resizeTimer = null;
    addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(redrawChart, 150);
    });
    try {
      const me = await call("/api/me");
      $("historyId").textContent = me.id;
      state.cooldown = me.cooldown || state.cooldown;
      state.market = { open: me.market_open !== false, opens: me.opens || null };
      startCooldown(me.signal_wait);
    } catch { /* Cooldown stays at zero. */ }
    restoreLast();
    setInterval(() => { if (!document.hidden) loadHistory(); }, 30000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && state.refreshCooldown && state.wait > 0) state.refreshCooldown(); });
    try {
      const data = await call("/api/strategies");
      state.strategies = data.items;
      state.selected = new Set(catalog().map((item) => item.id));
      renderPicker();
      updateDesk();
    } catch (error) {
      if (error.message !== "unauthorized") $("pickName").textContent = "Не удалось загрузить список индикаторов";
    }
  }

  init();
})();
