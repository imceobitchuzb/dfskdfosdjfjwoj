/* Market panel shown after a signal: indicator breakdown for the signal's timeframe. */
(() => {
  const REFRESH_MS = 30000;
  const SIGNAL = { 1: ["bull", "Бычий"], "-1": ["bear", "Медвежий"], 0: ["neutral", "Нейтрально"] };
  const state = { tf: null, filter: "all", query: "", data: null, busy: false, open: new Set(), timer: null };

  const $ = (id) => document.getElementById(id);
  const money = (value) => Number(value).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  async function request(url) {
    const response = await fetch(url, { headers: { "X-Requested-With": "mt-trade" } });
    if (response.status === 401) { location.href = response.headers.get("X-Session") ? "/access?replaced=1" : "/access"; throw new Error("unauthorized"); }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "Ошибка запроса");
    }
    return response.json();
  }

  function renderSummary(data) {
    const strip = $("verdictStrip");
    strip.className = `verdict-strip tone-${data.tone}`;
    $("verdict").textContent = data.verdict;
    $("cBull").textContent = data.counts.bull;
    $("cBear").textContent = data.counts.bear;
    $("cNeutral").textContent = data.counts.neutral;
  }

  function renderGroups(data) {
    const container = $("groups");
    container.replaceChildren();
    data.groups.forEach((group) => {
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
      container.append(row);
    });

    const levels = $("levels");
    levels.replaceChildren();
    if (!data.levels) { levels.append(el("p", "empty-note", "Уровни недоступны.")); return; }
    const nowRow = () => {
      const row = el("div", "level now");
      row.append(el("span", "", "Цена сейчас"), el("b", "", money(data.price)));
      return row;
    };
    let placed = false;
    ["R3", "R2", "R1", "P", "S1", "S2", "S3"].forEach((key) => {
      const value = data.levels[key];
      if (!placed && data.price >= value) { levels.append(nowRow()); placed = true; }
      const row = el("div", `level ${key === "P" ? "p" : key[0].toLowerCase()}`);
      row.append(el("span", "", key === "P" ? "Пивот" : key), el("b", "", money(value)));
      levels.append(row);
    });
    if (!placed) levels.append(nowRow());
  }

  // Groups are collapsed accordions so the phone does not need a nested scroll; filtering or search opens them.
  function renderIndicators() {
    if (!state.data) return;
    const list = $("indList");
    list.replaceChildren();
    const query = state.query.trim().toLowerCase();
    const filtering = Boolean(query) || state.filter !== "all";
    const items = state.data.indicators.filter((item) => (state.filter === "all" || String(item.signal) === state.filter) && (!query || item.name.toLowerCase().includes(query)));
    $("indShown").textContent = `Показано ${items.length} из ${state.data.total}`;
    if (!items.length) { list.append(el("p", "empty-note", "Ничего не найдено.")); return; }
    const grouped = new Map();
    items.forEach((item) => { if (!grouped.has(item.group)) grouped.set(item.group, []); grouped.get(item.group).push(item); });
    grouped.forEach((members, group) => {
      const open = filtering || state.open.has(group);
      const section = el("div", `ind-group${open ? " open" : ""}`);
      const head = el("button", "ind-head");
      head.type = "button";
      head.setAttribute("aria-expanded", String(open));
      const bull = members.filter((item) => item.signal === 1).length;
      const bear = members.filter((item) => item.signal === -1).length;
      head.append(el("b", "", group), el("span", "ind-sum", `${bull} ▲ · ${members.length - bull - bear} ● · ${bear} ▼`), el("i", "chev"));
      head.addEventListener("click", () => {
        if (filtering) return;
        if (!state.open.delete(group)) state.open.add(group);
        renderIndicators();
      });
      section.append(head);
      if (open) {
        const body = el("div", "ind-body");
        members.forEach((item) => {
          const [cls, label] = SIGNAL[item.signal];
          const row = el("div", "ind");
          row.append(el("span", "name", item.name), el("span", "val", item.value), el("span", `badge ${cls}`, label));
          body.append(row);
        });
        section.append(body);
      }
      list.append(section);
    });
  }

  function formatUpdated(iso) {
    const time = new Date(iso).toLocaleTimeString("ru-RU", { timeZone: "Etc/GMT-3", hour: "2-digit", minute: "2-digit" });
    return `обновлено ${time}`;
  }

  async function loadAnalysis() {
    if (state.busy || !state.tf) return;
    state.busy = true;
    const tf = state.tf;
    try {
      const data = await request(`/api/analysis?tf=${tf}`);
      if (data.timeframe !== state.tf) return;
      state.data = data;
      renderSummary(data);
      renderGroups(data);
      renderIndicators();
      $("updated").textContent = formatUpdated(data.updated);
      $("source").textContent = `Индикаторов: ${data.total}. Источник свечей: ${data.source}.`;
    } catch (error) {
      if (error.message !== "unauthorized") $("updated").textContent = "данные недоступны";
    } finally {
      state.busy = false;
      // The signal timeframe may have changed while this request was in flight.
      if (state.tf && state.tf !== tf) loadAnalysis();
    }
  }

  function showMarket(tf) {
    const changed = state.tf !== tf;
    state.tf = tf;
    if (changed) { state.data = null; $("verdict").textContent = "Анализ…"; }
    loadAnalysis();
    clearInterval(state.timer);
    state.timer = setInterval(() => { if (!document.hidden && !$("market").hidden) loadAnalysis(); }, REFRESH_MS);
  }

  function bindSegments(id) {
    const root = $(id);
    root.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
      root.querySelectorAll("button").forEach((b) => {
        b.classList.toggle("active", b === button);
        $(b.dataset.pane).hidden = b !== button;
      });
    }));
  }

  function bindControls() {
    bindSegments("analysisTabs");
    document.querySelectorAll("#filters .chip").forEach((chip) => chip.addEventListener("click", () => {
      document.querySelectorAll("#filters .chip").forEach((c) => c.classList.toggle("active", c === chip));
      state.filter = chip.dataset.filter;
      renderIndicators();
    }));
    $("search").addEventListener("input", (event) => { state.query = event.target.value; renderIndicators(); });
    $("logout").addEventListener("click", async () => {
      await fetch("/api/logout", { method: "POST", headers: { "X-Requested-With": "mt-trade" } });
      location.href = "/access";
    });
    document.addEventListener("signalready", (event) => showMarket(event.detail.tf));
  }

  async function init() {
    bindControls();
    try {
      const me = await request("/api/me");
      $("clientId").textContent = me.id;
    } catch { /* The sign-in redirect handles auth errors. */ }
  }

  init();
})();
