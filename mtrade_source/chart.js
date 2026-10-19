/* Canvas chart for a signal. "trade" view: candles with entry, stop and three targets. "analysis" view: candles with liquidity pools, order blocks, FVG imbalances, key levels and premium/discount zones. */
const SignalChart = (() => {
  const TZ = "Etc/GMT-3";
  const COLORS = { bull: "#2de2a0", bear: "#ff5d73", gold: "#f4c25b", ink: "#eaf0ff", muted: "#8d9bbd", grid: "rgba(160,185,255,0.07)" };
  const money = (value, digits = 2) => Number(value).toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const font = (size, weight = 600) => `${weight} ${size}px Manrope, "Segoe UI", sans-serif`;
  // Visible candles per timeframe on a phone; wide screens show 1.5 times more.
  const VIEW_BARS = { "5m": 64, "15m": 52, "30m": 48, "1h": 46, "4h": 40, "1d": 34 };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Crosshair layer: a second canvas above the chart, so moving the pointer never redraws the whole chart.
  function paintCrosshair(canvas) {
    const overlay = canvas._overlay;
    const geo = canvas._geo;
    if (!overlay || !geo) return;
    const ctx = overlay.getContext("2d");
    ctx.setTransform(geo.ratio, 0, 0, geo.ratio, 0, 0);
    ctx.clearRect(0, 0, geo.width, geo.height);
    const hover = canvas._hover;
    if (!hover || hover.x < geo.padL || hover.x > geo.plotRight || hover.y < geo.mainTop || hover.y > geo.mainBottom) return;
    const index = Math.max(0, Math.min(geo.candles.length - 1, Math.round((hover.x - geo.padL) / geo.step - 0.5)));
    const candle = geo.candles[index];
    const cx = Math.round(geo.x(index)) + 0.5;
    const cy = Math.round(hover.y) + 0.5;
    ctx.strokeStyle = "rgba(234,240,255,0.38)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(cx, geo.mainTop); ctx.lineTo(cx, geo.mainBottom); ctx.moveTo(geo.padL, cy); ctx.lineTo(geo.plotRight, cy); ctx.stroke();
    ctx.setLineDash([]);
    const tag = (text, left, top, w, h) => {
      ctx.fillStyle = "#26304f";
      roundRect(ctx, left, top, w, h, 4);
      ctx.fill();
      ctx.fillStyle = COLORS.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, left + w / 2, top + h / 2 + 0.5);
    };
    ctx.font = font(10.5, 800);
    const price = geo.high - ((hover.y - geo.mainTop) / (geo.mainBottom - geo.mainTop)) * (geo.high - geo.low);
    const priceText = money(price);
    tag(priceText, geo.plotRight, cy - 9, Math.min(geo.padR, ctx.measureText(priceText).width + 10), 18);
    const timeText = geo.timeText(candle[0]);
    const timeWidth = ctx.measureText(timeText).width + 12;
    tag(timeText, Math.min(Math.max(cx - timeWidth / 2, 0), geo.width - timeWidth), geo.mainBottom + 3, timeWidth, 17);
    const up = candle[4] >= candle[1];
    const parts = [["O", candle[1]], ["H", candle[2]], ["L", candle[3]], ["C", candle[4]]].map(([name, value]) => [name, money(value)]);
    ctx.font = font(10.5, 700);
    const gap = 7;
    const widths = parts.map(([name, value]) => ctx.measureText(name).width + 3 + ctx.measureText(value).width);
    const total = widths.reduce((sum, w) => sum + w, 0) + gap * (parts.length - 1);
    ctx.fillStyle = "#0a101f";
    ctx.fillRect(geo.padL - 2, 31, Math.min(total + 8, geo.width - 130), 14);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    let left = geo.padL;
    parts.forEach(([name, value], i) => {
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(name, left, 40);
      ctx.fillStyle = up ? COLORS.bull : COLORS.bear;
      ctx.fillText(value, left + ctx.measureText(name).width + 3, 40);
      left += widths[i] + gap;
    });
  }

  function ensureOverlay(canvas, width, height, ratio) {
    let overlay = canvas._overlay;
    if (!overlay) {
      overlay = document.createElement("canvas");
      overlay.className = "chart-overlay";
      overlay.setAttribute("aria-hidden", "true");
      canvas.after(overlay);
      canvas._overlay = overlay;
      const show = (event) => {
        clearTimeout(canvas._hoverTimer);
        const box = overlay.getBoundingClientRect();
        canvas._hover = { x: event.clientX - box.left, y: event.clientY - box.top };
        paintCrosshair(canvas);
      };
      const hide = () => { canvas._hover = null; paintCrosshair(canvas); };
      overlay.addEventListener("pointermove", show);
      overlay.addEventListener("pointerdown", show);
      overlay.addEventListener("pointercancel", hide);
      // A finger leaves the screen after every touch; the readout stays a little so it can be read.
      overlay.addEventListener("pointerleave", (event) => {
        if (event.pointerType === "touch") canvas._hoverTimer = setTimeout(hide, 3000);
        else hide();
      });
    }
    overlay.width = Math.floor(width * ratio);
    overlay.height = Math.floor(height * ratio);
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;
  }

  // Trading sessions (UTC) come measured on hourly candles, so they can be drawn on any chart up to 4 hours; a daily candle holds all of them.
  const SESSIONS = {
    asia: { name: "Азия", hours: "00–07", rgb: "176,140,255" },
    london: { name: "Лондон", hours: "07–13", rgb: "255,196,87" },
    ny: { name: "Нью-Йорк", hours: "13–21", rgb: "95,227,255" },
  };

  function sessionBoxes(report) {
    const candles = report.chart?.candles || [];
    if (candles.length < 3 || candles[1][0] - candles[0][0] > 4 * 3600) return [];
    const last = candles[candles.length - 1][0];
    const keepDays = candles[1][0] - candles[0][0] > 3600 ? 4 : 10;
    return (report.chart?.sessions || [])
      .filter((item) => SESSIONS[item.name] && item.end > candles[0][0] && item.start >= last - keepDays * 86400)
      .map((item) => ({ ...item, ...SESSIONS[item.name] }));
  }

  // The zones worth drawing, no further than 3 ATR from the price. Shared by the chart and its notes.
  // A gap the price is inside right now is shown whole (it is being tested); otherwise only its untouched part.
  function pickZones(report) {
    const chart = report.chart || {};
    const candles = chart.candles || [];
    const price = candles.length ? candles[candles.length - 1][4] : 0;
    const atr = report.atr || 1;
    const dealing = report.premium?.position ?? 0.5;
    const gaps = (chart.fvg || []).map((zone) => {
      const inside = price > zone.bottom && price < zone.top;
      const whole = inside || zone.open_top <= zone.open_bottom;
      return { ...zone, inside, shownTop: whole ? zone.top : zone.open_top, shownBottom: whole ? zone.bottom : zone.open_bottom };
    }).filter((zone) => (zone.size ?? 1) >= (zone.htf ? 0.3 : 0.25) && zone.filled <= 0.85);
    const blocks = (chart.ob || []).map((zone) => ({ ...zone, shownTop: zone.top, shownBottom: zone.bottom }));
    const away = (zone) => Math.max(0, zone.type === "bull" ? price - zone.shownTop : zone.shownBottom - price);
    const overlaps = (m, n) => Math.min(m.shownTop, n.shownTop) - Math.max(m.shownBottom, n.shownBottom) > 0.4 * Math.min(m.shownTop - m.shownBottom, n.shownTop - n.shownBottom);
    // A gap that sits inside one of the other chart scale is nested: two charts agree on the same zone.
    gaps.forEach((zone) => { zone.nested = gaps.some((other) => other !== zone && Boolean(other.htf) !== Boolean(zone.htf) && overlaps(zone, other)); });
    // Gap quality: close, large, untouched, left by a break of structure, from a larger chart or nested, and on the side professionals trade (bullish in the discount half, bearish in the premium half).
    const gapScore = (zone) => away(zone) - 0.5 * atr * (zone.grade || 1) + 1.2 * atr * zone.filled - 0.35 * atr * Number(Boolean(zone.htf)) - 0.3 * atr * Number(zone.nested) - 0.2 * atr * Number(Boolean(zone.bos)) - 0.2 * atr * Number(zone.type === "bull" ? dealing < 0.5 : dealing > 0.5);
    const near = (list) => list.filter((zone) => away(zone) <= 3 * atr);
    const ranked = near(gaps).sort((m, n) => gapScore(m) - gapScore(n));
    // The best gap overall, plus the best one of the other chart scale (global or local) when it does not cover the same price.
    const first = ranked[0];
    const second = first ? ranked.find((zone) => Boolean(zone.htf) !== Boolean(first.htf) && !overlaps(zone, first)) : null;
    const best = (list, score) => near(list).sort((m, n) => score(m) - score(n)).slice(0, 1);
    return {
      fvg: [first, second].filter(Boolean),
      ob: best(blocks, (zone) => away(zone) - 0.6 * atr * (zone.grade || 1) + 0.3 * atr * (zone.touches || 0)),
    };
  }

  // Liquidity zones worth showing: real clusters (equal highs/lows, day, week or session extremes), not a lone swing, within 2.5 ATR of the price.
  function pickPools(report) {
    return [...(report.liquidity?.pools || [])].filter((pool) => pool.rating >= 2 && pool.dist_atr <= 2.5).sort((m, n) => n.rating - m.rating).slice(0, 4);
  }

  function drawChart(canvas, report, view = "trade", layers = { levels: true, fvg: false, ob: false, liq: false, struct: false, sess: false }) {
    const { chart, plan, levels } = report;
    const trade = view === "trade" && Boolean(plan);
    const frameTf = report.chart_tf || report.timeframe;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(280, canvas.parentElement.clientWidth);
    const compact = width < 560;
    const cut = Math.max(0, chart.candles.length - Math.round((VIEW_BARS[frameTf] || 48) * (compact ? 1 : 1.5)));
    const candles = chart.candles.slice(cut);
    const height = compact ? 400 : 500;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    ctx.fillStyle = "#0a101f";
    ctx.fillRect(0, 0, width, height);
    const glow = ctx.createRadialGradient(width * 0.5, 0, 0, width * 0.5, 0, width * 0.9);
    glow.addColorStop(0, "rgba(40,60,130,0.32)");
    glow.addColorStop(1, "rgba(10,16,31,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    const padL = 8, padR = compact ? (trade ? 78 : 60) : (trade ? 94 : 76), mainTop = 44, mainBottom = height - 24;
    const plotRight = width - padR;
    const candleArea = (plotRight - padL) * (trade ? (compact ? 0.58 : 0.66) : (compact ? 0.86 : 0.92));
    const step = candleArea / candles.length;
    const x = (index) => padL + step * (index + 0.5);

    // Rare spike wicks are clipped so one bad tick does not squash the chart.
    // In the trade view only the recent candles set the scale, so a long old move does not squeeze entry, stop and targets.
    const scaled = trade ? candles.slice(-Math.max(14, Math.ceil(candles.length * 0.4))) : candles.slice(-Math.max(24, Math.ceil(candles.length * 0.62)));
    const bodyLow = Math.min(...scaled.map((c) => Math.min(c[1], c[4])));
    const bodyHigh = Math.max(...scaled.map((c) => Math.max(c[1], c[4])));
    let low = Math.max(Math.min(...scaled.map((c) => c[3])), bodyLow - 3 * report.atr);
    let high = Math.min(Math.max(...scaled.map((c) => c[2])), bodyHigh + 3 * report.atr);
    if (trade) [plan.stop, plan.entry, ...plan.targets].forEach((value) => { low = Math.min(low, value); high = Math.max(high, value); });
    const pools = !trade && layers.liq ? pickPools(report) : [];
    // A pool just outside the view widens it, so the stops that attract price stay on the chart.
    pools.forEach((pool) => {
      if (pool.price > high && pool.price - high <= 2.5 * report.atr) high = pool.price + 0.4 * report.atr;
      if (pool.price < low && low - pool.price <= 2.5 * report.atr) low = pool.price - 0.4 * report.atr;
    });
    const picks = trade ? { fvg: [], ob: [] } : pickZones(report);
    const boxes = !trade && layers.sess ? sessionBoxes(report).filter((box) => box.end > candles[0][0]) : [];
    const wanted = [...(layers.fvg ? picks.fvg : []), ...(layers.ob ? picks.ob : [])];
    wanted.forEach((zone) => {
      const zoneTop = zone.shownTop, zoneBottom = zone.shownBottom;
      if (zoneTop > high && zoneBottom - high <= 2.5 * report.atr) high = zoneTop + 0.2 * report.atr;
      if (zoneBottom < low && low - zoneTop <= 2.5 * report.atr) low = zoneBottom - 0.2 * report.atr;
    });
    const margin = (high - low) * (trade ? 0.07 : 0.1);
    low -= margin; high += margin;
    const y = (price) => mainTop + ((high - price) / (high - low)) * (mainBottom - mainTop);
    const inRange = (price) => price > low && price < high;

    // A small filled pill with dark or light text.
    const pill = (text, anchor, centerY, background, color, size = 10, align = "right") => {
      ctx.font = font(size, 800);
      const w = ctx.measureText(text).width + 12;
      const h = size + 8;
      const left = align === "left" ? anchor : anchor - w;
      ctx.fillStyle = background;
      roundRect(ctx, left, centerY - h / 2, w, h, h / 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, left + w / 2, centerY + 0.5);
    };

    // Grid and price axis.
    ctx.font = font(10.5, 600);
    ctx.textBaseline = "middle";
    // Only levels the price has really reacted to: touched at least twice, or a key level such as yesterday's extreme. The two nearest per side.
    // The nearest of them, and a second one only when it is well apart (at least 1.5 ATR), so the lines never pile up.
    const solid = (items) => {
      const picked = [];
      (items || []).filter((item) => (item.visits ?? 0) >= 2 || (item.kinds || []).some((kind) => /вчера/.test(kind))).forEach((item) => {
        if (picked.length < 2 && picked.every((other) => Math.abs(other.price - item.price) >= 1.5 * report.atr)) picked.push(item);
      });
      return picked;
    };
    const shownLevels = trade || !layers.levels ? [] : [
      ...solid(levels.resistance).map((item, i) => ({ ...item, rgb: "255,125,146", tag: `R${i + 1}` })),
      ...solid(levels.support).map((item, i) => ({ ...item, rgb: "79,232,177", tag: `S${i + 1}` })),
    ].filter((item) => item.price > low && item.price < high);
    const lastClose = candles[candles.length - 1][4];
    // Every horizontal level of the active layer carries only its price on the right-hand scale.
    const poolRgb = (pool) => (pool.side === "up" ? "255,196,87" : "176,140,255");
    const poolAlpha = (pool) => (pool.rating >= 4 ? 1 : pool.rating >= 3 ? 0.85 : 0.68);
    // Only breaks that happen inside the visible candles are drawn; the strong and weak points belong to them.
    const shownEvents = !trade && layers.struct ? (chart.events || []).filter((event) => event.scale !== "internal" && candles.findIndex((candle) => candle[0] >= event.time) >= 6 && inRange(event.level)).slice(compact ? -2 : -3) : [];
    const strongWeak = shownEvents.length ? chart.strong_weak : null;
    const edgeTags = trade ? [] : [
      ...shownLevels.map((item, i) => ({ k: `lv${i}`, p: item.price, color: `rgb(${item.rgb})` })),
      ...pools.map((pool, i) => ({ k: `lq${i}`, p: pool.price, color: `rgba(${poolRgb(pool)},${poolAlpha(pool)})` })),
      ...(strongWeak ? [strongWeak.strong, strongWeak.weak].map((point, i) => ({ k: `sw${i}`, p: point.price, color: "rgb(234,240,255)" })) : []),
    ];
    // Labels that would overlap are pushed apart (top to bottom, then back up from the bottom edge) so every price stays readable.
    const tagItems = (trade
      ? [{ k: "entry", p: plan.entry }, { k: "stop", p: plan.stop }, ...plan.targets.map((p, i) => ({ k: `tp${i}`, p }))]
      : edgeTags.map((item) => ({ k: item.k, p: item.p }))
    ).concat(trade && Math.abs(y(lastClose) - y(plan.entry)) < 19 ? [] : [{ k: "last", p: lastClose }]).filter((item) => inRange(item.p)).map((item) => ({ ...item, y: y(item.p), cy: y(item.p) }));
    {
      const sorted = [...tagItems].sort((m, n) => m.y - n.y);
      sorted.forEach((item, i) => { item.cy = i ? Math.max(item.y, sorted[i - 1].cy + 19) : item.y; });
      for (let i = sorted.length - 1; i >= 0; i -= 1) {
        const limit = i === sorted.length - 1 ? mainBottom - 9 : sorted[i + 1].cy - 19;
        if (sorted[i].cy > limit) sorted[i].cy = limit;
      }
    }
    const labelY = (key) => (tagItems.find((item) => item.k === key) || {}).cy;
    const marked = tagItems.map((item) => item.cy);
    for (let i = 0; i <= 4; i += 1) {
      const price = low + ((high - low) * i) / 4;
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, y(price)); ctx.lineTo(plotRight, y(price)); ctx.stroke();
      if (marked.some((mark) => Math.abs(mark - y(price)) < 14)) continue;
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = "left";
      ctx.fillText(money(price, 1), plotRight + 6, y(price));
    }
    const timeText = (seconds) => new Date(seconds * 1000).toLocaleString("ru-RU", frameTf === "1d"
      ? { timeZone: TZ, day: "2-digit", month: "2-digit" }
      : frameTf === "4h"
        ? { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }
        : { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
    const labelCount = frameTf === "4h" ? (compact ? 2 : 5) : (compact ? 3 : 6);
    const every = Math.max(4, Math.round(candles.length / labelCount));
    ctx.textAlign = "center";
    ctx.font = font(10.5, 600);
    for (let i = candles.length - 1; i >= every * 0.6; i -= every) {
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x(i)) + 0.5, mainTop); ctx.lineTo(Math.round(x(i)) + 0.5, mainBottom); ctx.stroke();
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(timeText(candles[i][0]), Math.min(Math.max(x(i), padL + 24), plotRight - 24), height - 10);
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(padL, mainTop, plotRight - padL, mainBottom - mainTop); ctx.clip();

    // New-day markers on intraday charts help to read where the move started.
    if (frameTf !== "1d") {
      const dayKey = (seconds) => new Date(seconds * 1000).toLocaleDateString("ru-RU", { timeZone: TZ });
      let lastLabelX = -100;
      candles.forEach((candle, i) => {
        if (i === 0 || dayKey(candle[0]) === dayKey(candles[i - 1][0])) return;
        const left = x(i) - step / 2;
        ctx.strokeStyle = "rgba(160,185,255,0.16)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(left, mainTop); ctx.lineTo(left, mainBottom); ctx.stroke();
        ctx.setLineDash([]);
        if (left - lastLabelX < 42) return;
        lastLabelX = left;
        ctx.font = font(9.5, 700);
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(141,155,189,0.8)";
        ctx.fillText(new Date(candle[0] * 1000).toLocaleDateString("ru-RU", { timeZone: TZ, day: "2-digit", month: "2-digit" }), left + 4, mainTop + 9);
      });
    }

    const issued = report.trade ? report.trade.created : Date.parse(report.generated) / 1000;
    let entryIdx = 0;
    candles.forEach((candle, i) => { if (candle[0] <= issued) entryIdx = i; });
    const entryX = x(entryIdx);
    const hit = report.trade ? report.trade.tp_hit : 0;
    const stopped = Boolean(report.trade && report.trade.result === "loss");
    const side = report.side === "BUY" ? 1 : -1;
    // Short captions of zones are drawn after the candles so they stay readable on top.
    const captions = [];
    if (trade) {
      const gradient = (from, to, rgb, strong) => {
        const fill = ctx.createLinearGradient(0, y(from), 0, y(to));
        fill.addColorStop(0, `rgba(${rgb},0.03)`);
        fill.addColorStop(1, `rgba(${rgb},${strong})`);
        return fill;
      };
      ctx.fillStyle = gradient(plan.entry, plan.targets[2], "45,226,160", 0.2);
      ctx.fillRect(entryX, Math.min(y(plan.entry), y(plan.targets[2])), plotRight - entryX, Math.abs(y(plan.targets[2]) - y(plan.entry)));
      ctx.fillStyle = gradient(plan.entry, plan.stop, "255,93,115", 0.24);
      ctx.fillRect(entryX, Math.min(y(plan.entry), y(plan.stop)), plotRight - entryX, Math.abs(y(plan.stop) - y(plan.entry)));
    } else {
      // Support and resistance: every level looks the same, a thin line with a narrow band; the price sits on the scale.
      const zoneHalf = 0.08 * report.atr;
      shownLevels.forEach((item) => {
        const lineY = Math.round(y(item.price)) + 0.5;
        const bandTop = Math.round(y(item.price + zoneHalf)), bandBottom = Math.round(y(item.price - zoneHalf));
        ctx.fillStyle = `rgba(${item.rgb},0.08)`;
        ctx.fillRect(padL, bandTop, plotRight - padL, Math.max(3, bandBottom - bandTop));
        ctx.strokeStyle = `rgba(${item.rgb},${(item.visits ?? 2) >= 3 ? 0.95 : 0.75})`;
        ctx.lineWidth = (item.visits ?? 2) >= 4 ? 1.8 : 1.2;
        ctx.beginPath(); ctx.moveTo(padL, lineY); ctx.lineTo(plotRight, lineY); ctx.stroke();
      });
      const startX = (time) => {
        const index = candles.findIndex((candle) => candle[0] >= time);
        return index <= 0 ? padL : x(index) - step / 2;
      };
      // A zone sits on whole pixels: a faint fill, a hairline on its top and bottom edge and a short bar on the left where it formed. No dashes.
      // A zone of a larger chart (`strong`) gets brighter edges and a wider bar; `centre` adds the 50% line (consequent encroachment) when the zone is tall enough.
      const crispZone = (left, topPrice, bottomPrice, rgb, fillAlpha, edgeAlpha, strong = false, centre = false) => {
        const top = Math.round(y(topPrice));
        const bottom = Math.max(top + 7, Math.round(y(bottomPrice)));
        const from = Math.round(left), to = Math.round(plotRight);
        ctx.fillStyle = `rgba(${rgb},${fillAlpha})`;
        ctx.fillRect(from, top, to - from, bottom - top);
        ctx.strokeStyle = `rgba(${rgb},${strong ? Math.min(1, edgeAlpha + 0.3) : edgeAlpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(from, top + 0.5); ctx.lineTo(to, top + 0.5);
        ctx.moveTo(from, bottom - 0.5); ctx.lineTo(to, bottom - 0.5);
        ctx.stroke();
        if (centre && bottom - top >= 18) {
          const mid = Math.round((top + bottom) / 2) + 0.5;
          ctx.strokeStyle = `rgba(${rgb},0.3)`;
          ctx.beginPath(); ctx.moveTo(from, mid); ctx.lineTo(to, mid); ctx.stroke();
        }
        ctx.fillStyle = `rgba(${rgb},0.95)`;
        ctx.fillRect(from, top, strong ? 5 : 3, bottom - top);
        return { top, bottom, from };
      };
      const zoneCaption = (text, box, rgb) => {
        const room = box.bottom - box.top >= 15;
        captions.push([text, Math.max(box.from, padL) + 10, room ? (box.top + box.bottom) / 2 : box.top - 7, rgb]);
      };
      // Imbalance (FVG): the best gap overall and, when it is a different place, the best one of the other chart scale (larger chart or the local one).
      // The untouched part is the zone; the part price already ate stays as a faint ghost.
      if (layers.fvg) {
        picks.fvg.forEach((gap) => {
          const rgb = gap.type === "bull" ? "95,227,255" : "255,138,214";
          const left = startX(gap.time);
          const ghostTop = Math.round(y(gap.top)), ghostBottom = Math.round(y(gap.bottom));
          ctx.fillStyle = `rgba(${rgb},0.04)`;
          ctx.fillRect(Math.round(left), ghostTop, Math.round(plotRight) - Math.round(left), Math.max(1, ghostBottom - ghostTop));
          const box = crispZone(left, gap.shownTop, gap.shownBottom, rgb, 0.1 + 0.04 * (gap.grade || 1), 0.55, Boolean(gap.htf), true);
          zoneCaption(`${gap.inverse ? "IFVG" : "FVG"}${gap.htf && gap.tf ? ` ${gap.tf}` : ""}`, box, rgb);
        });
      }
      if (layers.ob) {
        // Order block: the single best fresh block.
        picks.ob.forEach((block) => {
          const rgb = block.type === "bull" ? "45,226,160" : "255,93,115";
          const box = crispZone(startX(block.time), block.top, block.bottom, rgb, 0.1 + 0.03 * (block.grade || 1), 0.6);
          zoneCaption(`OB${block.bos ? " BOS" : ""}`, box, rgb);
        });
      }
      if (layers.liq) {
        // Liquidity: a solid line at the high or low where the stops rest, from the point it formed to the right edge, with a faint band beyond it.
        pools.filter((pool) => inRange(pool.price)).forEach((pool) => {
          const left = Math.round(startX(pool.time));
          const up = pool.side === "up";
          const rgb = poolRgb(pool);
          const band = (0.08 + 0.03 * pool.rating) * report.atr;
          const lineY = Math.round(y(pool.price)) + 0.5, farY = Math.round(y(pool.price + (up ? band : -band)));
          ctx.fillStyle = `rgba(${rgb},${0.05 + 0.02 * pool.rating})`;
          ctx.fillRect(left, Math.round(Math.min(lineY, farY)), Math.round(plotRight) - left, Math.max(3, Math.abs(farY - lineY)));
          ctx.strokeStyle = `rgba(${rgb},${poolAlpha(pool)})`;
          ctx.lineWidth = pool.rating >= 4 ? 1.6 : 1.1;
          ctx.beginPath(); ctx.moveTo(left, lineY); ctx.lineTo(plotRight, lineY); ctx.stroke();
          captions.push([pool.label, Math.max(left, padL) + 6, lineY + (up ? -7 : 8), rgb]);
        });
        // Liquidity that price has just taken: a faint solid line from the pool to the candle that took it, closed with a cross.
        (report.liquidity?.swept || []).filter((item) => inRange(item.price) && item.swept_time >= candles[0][0]).sort((m, n) => n.swept_time - m.swept_time).slice(0, 3).forEach((item) => {
          const hitIndex = candles.findIndex((candle) => candle[0] >= item.swept_time);
          if (hitIndex < 0) return;
          const rgb = item.side === "up" ? "255,196,87" : "176,140,255";
          const yy = Math.round(y(item.price)) + 0.5, left = Math.round(Math.max(padL, startX(item.time))), hitX = Math.round(x(hitIndex)) + 0.5;
          ctx.strokeStyle = `rgba(${rgb},0.4)`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(hitX, yy); ctx.stroke();
          ctx.strokeStyle = `rgba(${rgb},0.95)`;
          ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(hitX - 3.5, yy - 3.5); ctx.lineTo(hitX + 3.5, yy + 3.5); ctx.moveTo(hitX + 3.5, yy - 3.5); ctx.lineTo(hitX - 3.5, yy + 3.5); ctx.stroke();
        });
      }
      if (layers.sess) {
        // Trading sessions (UTC): the range of each session as a quiet box; its high and low are where stops rest.
        const span = candles.length > 1 ? candles[1][0] - candles[0][0] : 3600;
        const xAtTime = (time) => {
          let i = -1;
          for (let k = 0; k < candles.length && candles[k][0] <= time; k += 1) i = k;
          if (i < 0) return x(0) - step / 2 - ((candles[0][0] - time) / span) * step;
          const next = candles[i + 1] ? candles[i + 1][0] : candles[i][0] + span;
          return x(i) - step / 2 + Math.min(1, (time - candles[i][0]) / (next - candles[i][0])) * step;
        };
        boxes.forEach((box) => {
          const left = Math.max(padL, xAtTime(box.start)), right = Math.min(plotRight, xAtTime(box.end));
          if (right - left < 2) return;
          const topY = y(box.high), bottomY = y(box.low);
          ctx.fillStyle = `rgba(${box.rgb},0.07)`;
          ctx.fillRect(left, topY, right - left, Math.max(2, bottomY - topY));
          ctx.strokeStyle = `rgba(${box.rgb},0.55)`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(left, Math.round(topY) + 0.5); ctx.lineTo(right, Math.round(topY) + 0.5);
          ctx.moveTo(left, Math.round(bottomY) - 0.5); ctx.lineTo(right, Math.round(bottomY) - 0.5);
          ctx.stroke();
          ctx.font = font(9.5, 800);
          ctx.textAlign = "left";
          ctx.textBaseline = "alphabetic";
          ctx.fillStyle = `rgba(${box.rgb},0.95)`;
          if (right - left > 34) ctx.fillText(box.name, left + 4, Math.max(mainTop + 10, topY - 4));
        });
      }
    }

    // Candles; wicks and bodies sit on whole pixels so they stay sharp.
    let bodyWidth = Math.round(Math.min(14, Math.max(3, step * 0.64)));
    if (bodyWidth % 2 === 0) bodyWidth += 1;
    candles.forEach(([, open, highPrice, lowPrice, close], i) => {
      const color = close >= open ? COLORS.bull : COLORS.bear;
      const cx = Math.round(x(i)) + 0.5;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, Math.round(y(highPrice))); ctx.lineTo(cx, Math.round(y(lowPrice))); ctx.stroke();
      const topBody = Math.round(y(Math.max(open, close)));
      ctx.fillRect(cx - bodyWidth / 2, topBody, bodyWidth, Math.max(1, Math.round(y(Math.min(open, close))) - topBody));
    });

    // Zone captions sit at the left edge of their zone, so they never run into the price tags on the right.
    ctx.font = font(9.5, 800);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    // Labels never sit on top of each other: a label that would overlap an earlier one moves up or down by one text line.
    const taken = [];
    const place = (text, left, wanted) => {
      const right = left + ctx.measureText(text).width;
      let cy = wanted;
      for (let n = 0; n < 8; n += 1) {
        const clash = taken.find((box) => left < box.right && right > box.left && Math.abs(cy - box.cy) < 11);
        if (!clash) break;
        cy = clash.cy + (cy >= clash.cy ? 11 : -11);
      }
      taken.push({ left, right, cy });
      return Math.min(mainBottom - 8, Math.max(mainTop + 8, cy));
    };
    captions.forEach(([text, left, cy, rgb]) => {
      const yy = place(text, left, cy);
      ctx.strokeStyle = "rgba(10,16,31,0.88)";
      ctx.strokeText(text, left, yy);
      ctx.fillStyle = `rgb(${rgb})`;
      ctx.fillText(text, left, yy);
    });

    // Breaks of structure: a line from the swing that was broken to the candle that closed beyond it, with its name centred on the line.
    // BOS continues the trend (green up, red down), CHoCH is the first break against it (gold). Only swing-scale breaks are drawn.
    if (!trade && layers.struct) {
      shownEvents.forEach((event) => {
        const from = Math.max(0, candles.findIndex((candle) => candle[0] >= event.from_time));
        const to = candles.findIndex((candle) => candle[0] >= event.time);
        if (to < 0 || to <= from) return;
        const color = event.kind === "CHoCH" ? COLORS.gold : event.dir > 0 ? COLORS.bull : COLORS.bear;
        const yy = Math.round(y(event.level)) + 0.5;
        const startPx = x(from), endPx = x(to);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.3;
        ctx.setLineDash(event.kind === "CHoCH" ? [5, 3] : []);
        ctx.beginPath(); ctx.moveTo(startPx, yy); ctx.lineTo(endPx, yy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = font(9.5, 800);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const labelX = Math.min(plotRight - 22, Math.max(padL + 22, (startPx + endPx) / 2));
        const textY = yy + (event.dir > 0 ? -8 : 8);
        ctx.lineJoin = "round";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(10,16,31,0.9)";
        ctx.strokeText(event.kind, labelX, textY);
        ctx.fillStyle = color;
        ctx.fillText(event.kind, labelX, textY);
      });
      // The strong point protects the move and the weak one is its likely target; their prices are on the scale.
      const sw = chart.strong_weak;
      if (sw) {
        [[sw.strong, 0.8], [sw.weak, 0.45]].forEach(([point, alpha]) => {
          if (!point || !inRange(point.price)) return;
          const left = x(Math.max(0, candles.findIndex((candle) => candle[0] >= point.time)));
          const yy = Math.round(y(point.price)) + 0.5;
          ctx.strokeStyle = `rgba(234,240,255,${alpha})`;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 4]);
          ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(plotRight, yy); ctx.stroke();
          ctx.setLineDash([]);
        });
      }
    }

    // Entry, stop and targets start at the signal candle and carry a coloured label.
    if (trade) {
      const level = (price, color, dash, label, textColor, done, key) => {
        if (!inRange(price)) return;
        const yy = y(price);
        ctx.strokeStyle = color;
        ctx.lineWidth = done ? 2 : 1.4;
        ctx.setLineDash(dash);
        ctx.beginPath(); ctx.moveTo(entryX, yy); ctx.lineTo(plotRight, yy); ctx.stroke();
        ctx.setLineDash([]);
        if (label) pill(label, plotRight - 6, labelY(key) ?? yy, color, textColor, compact ? 10 : 11);
      };
      level(plan.entry, "#e6ecff", [6, 4], "ВХОД", "#0a101f", false, "entry");
      level(plan.stop, COLORS.bear, [], stopped ? "SL ✗" : "SL", "#ffffff", stopped, "stop");
      plan.targets.forEach((target, i) => level(target, COLORS.bull, hit > i ? [] : [6, 4], "", "#04251a", hit > i, `tp${i}`));
      // The swing the stop hides behind: a ring on the extreme and a short link to the stop line.
      const anchor = plan.stop_swing;
      const anchorIdx = anchor ? candles.findIndex((candle) => candle[0] === anchor.time) : -1;
      if (anchorIdx >= 0 && inRange(anchor.price)) {
        const ax = x(anchorIdx), ay = y(anchor.price);
        ctx.strokeStyle = "rgba(255,125,146,0.7)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax, y(plan.stop)); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#0a101f";
        ctx.strokeStyle = COLORS.bear;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(ax, ay, 3.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.font = font(9.5, 700);
        ctx.fillStyle = "rgba(255,170,184,0.95)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("свинг", Math.min(Math.max(ax, padL + 18), plotRight - 18), ay + (side === 1 ? 12 : -12));
      }
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#0a101f";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(entryX, y(plan.entry), 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();

    // Price tags on the axis.
    const tag = (price, color, dark = false, key = "", done = false) => {
      if (!inRange(price)) return;
      ctx.font = font(10.5, 800);
      const text = money(price);
      const mark = done ? 17 : 0;
      const tagWidth = Math.min(padR, ctx.measureText(text).width + 10 + mark);
      const cy = labelY(key) ?? y(price);
      ctx.fillStyle = color;
      roundRect(ctx, plotRight, cy - 9, tagWidth, 18, 4);
      ctx.fill();
      ctx.fillStyle = dark ? "#0a101f" : "#fff";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(text, plotRight + 4 + mark, cy);
      if (done) {
        // A small dark disc with a check inside it, in the colour of the tag.
        const cx = plotRight + 11.5;
        ctx.fillStyle = "#0a101f";
        ctx.beginPath(); ctx.arc(cx, cy, 6.2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.7;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath(); ctx.moveTo(cx - 3, cy + 0.2); ctx.lineTo(cx - 0.8, cy + 2.5); ctx.lineTo(cx + 3.1, cy - 2.1); ctx.stroke();
        ctx.lineCap = "butt";
        ctx.lineJoin = "miter";
      }
    };
    if (trade) {
      tag(plan.entry, "#e6ecff", true, "entry");
      tag(plan.stop, COLORS.bear, false, "stop");
      plan.targets.forEach((target, i) => tag(target, COLORS.bull, true, `tp${i}`, hit > i));
    }
    const last = candles[candles.length - 1];
    ctx.save();
    ctx.beginPath(); ctx.rect(padL, mainTop, plotRight - padL, mainBottom - mainTop); ctx.clip();
    if (inRange(last[4])) {
      ctx.strokeStyle = "rgba(244,194,91,0.7)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(x(candles.length - 1), y(last[4])); ctx.lineTo(plotRight, y(last[4])); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COLORS.gold;
      ctx.beginPath(); ctx.arc(x(candles.length - 1), y(last[4]), 3.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    if (labelY("last") !== undefined) tag(last[4], COLORS.gold, true, "last");
    edgeTags.forEach((item) => tag(item.p, item.color, true, item.k));

    // Header.
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.ink;
    ctx.font = font(compact ? 13 : 15, 800);
    ctx.fillText(`XAU/USD · ${report.timeframe_label}${report.chart_label ? ` · свечи ${report.chart_label}` : ""}`, padL, 26);
    ctx.font = font(10.5, 600);
    ctx.fillStyle = COLORS.muted;
    // The caption names the shown layer and says plainly when it has nothing to show.
    let caption = "вход, стоп и цели";
    if (!trade) {
      const names = { levels: "Уровни", fvg: "FVG", ob: "Ордер-блоки", liq: "Ликвидность", struct: "BOS / CHoCH", sess: "Сессии" };
      const found = { levels: shownLevels.length, fvg: picks.fvg.length, ob: picks.ob.length, liq: pools.length, struct: shownEvents.length, sess: boxes.length };
      const key = Object.keys(names).find((name) => layers[name]);
      caption = !key ? "слои выключены" : found[key] ? names[key] : key === "sess" && candles[1][0] - candles[0][0] > 4 * 3600 ? "Сессии: на дневном графике недоступны" : `${names[key]}: сейчас нет`;
    }
    ctx.fillText(caption, padL, 40);

    canvas._geo = { width, height, ratio, padL, padR, plotRight, mainTop, mainBottom, step, candles, low, high, x, timeText };
    ensureOverlay(canvas, width, height, ratio);
    paintCrosshair(canvas);
  }

  function downloadScreenshot(canvas, report) {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const stamp = new Date(report.generated).toLocaleString("sv-SE", { timeZone: TZ }).replace(/[: ]/g, "-").slice(0, 16);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `MT-TRADE_XAUUSD_${report.timeframe}_${report.strategy.id}_${stamp}.png`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 4000);
    }, "image/png");
  }

  // One short line per layer under the chart: only what the drawing shows right now.
  function layerNotes(report, layers) {
    const notes = [];
    const price = (value) => money(value);
    const picks = pickZones(report);
    const range = (item) => `${price(item.shownBottom ?? item.bottom)}–${price(item.shownTop ?? item.top)}`;
    if (layers.levels) {
      const first = (items) => {
        const item = (items || []).find((entry) => (entry.visits ?? 0) >= 2 || (entry.kinds || []).some((kind) => /вчера/.test(kind)));
        return item ? `${price(item.price)}${item.visits >= 2 ? ` (касаний: ${item.visits})` : ""}` : "";
      };
      const parts = [first(report.levels?.resistance) && `сопротивление ${first(report.levels?.resistance)}`, first(report.levels?.support) && `поддержка ${first(report.levels?.support)}`].filter(Boolean);
      notes.push({ rgb: "255,125,146", text: parts.length ? parts.join(" · ") : "Значимых уровней рядом нет." });
    }
    if (layers.fvg) {
      const parts = picks.fvg.map((gap) => `${gap.htf && gap.tf ? `${gap.tf} ` : ""}${gap.inverse ? "IFVG " : ""}${gap.type === "bull" ? "поддержка" : "сопротивление"} ${range(gap)}${gap.inside ? " (цена внутри)" : ""}`);
      notes.push({ rgb: "95,227,255", text: parts.length ? parts.join(" · ") : "Незакрытых FVG рядом нет." });
    }
    if (layers.ob) {
      const parts = picks.ob.map((block) => `${block.type === "bull" ? "спрос" : "предложение"} ${range(block)}`);
      notes.push({ rgb: "45,226,160", text: parts.length ? parts.join(" · ") : "Подтверждённых блоков рядом нет." });
    }
    if (layers.struct) {
      const visibleBars = VIEW_BARS[report.chart_tf || report.timeframe] || 48;
      const candlesAll = report.chart?.candles || [];
      const recent = (report.chart?.events || []).filter((event) => event.scale !== "internal" && candlesAll.length - 1 - candlesAll.findIndex((candle) => candle[0] >= event.time) <= visibleBars - 6);
      const last = recent[recent.length - 1];
      notes.push({ rgb: "244,194,91", text: last ? `Последний пробой: ${last.kind} ${last.dir > 0 ? "вверх" : "вниз"} через ${price(last.level)}` : "В видимой части пробоев нет." });
    }
    if (layers.sess) {
      const all = sessionBoxes(report);
      const lastOf = (key) => [...all].reverse().find((box) => box.name === SESSIONS[key].name);
      const parts = Object.keys(SESSIONS).map(lastOf).filter(Boolean).map((box) => `${box.name} ${price(box.low)}–${price(box.high)}`);
      const daily = (report.chart?.candles || []).length > 2 && report.chart.candles[1][0] - report.chart.candles[0][0] > 4 * 3600;
      notes.push({ rgb: "143,168,255", text: daily ? "На дневном графике сессии не показываются." : parts.length ? parts.join(" · ") : "Завершённых сессий пока нет." });
    }
    if (layers.liq) {
      const shown = pickPools(report);
      const near = (side) => shown.filter((pool) => pool.side === side).sort((m, n) => m.dist_atr - n.dist_atr)[0];
      const above = near("up"), below = near("down");
      const parts = [above && `выше ${price(above.price)} (${above.label})`, below && `ниже ${price(below.price)} (${below.label})`].filter(Boolean);
      const taken = (report.liquidity?.swept || []).slice(0, 2).map((item) => `${item.kind} ${price(item.price)}`).join(", ");
      notes.push({ rgb: "255,196,87", text: (parts.length ? parts.join(" · ") : "Заметных скоплений стопов рядом нет") + (taken ? ` · снято: ${taken}` : "") });
    }
    return notes;
  }

  return { draw: drawChart, download: downloadScreenshot, notes: layerNotes };
})();
