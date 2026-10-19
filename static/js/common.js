/* Shared helpers: preloader, reveal motion, header state, counters, tilt and the sentiment gauge. */
const MT = (() => {
  const TONE_LABEL = { strong_bull: "Сильный бычий", bull: "Бычий", neutral: "Нейтральный", bear: "Медвежий", strong_bear: "Сильный медвежий" };

  const gaugeMarkup = () => `
    <svg viewBox="0 0 300 170" role="img" aria-label="Шкала настроя рынка">
      <defs>
        <linearGradient id="gaugeGrad" x1="0" x2="1">
          <stop offset="0" stop-color="#ff5d73"/><stop offset="0.5" stop-color="#9aa7c7"/><stop offset="1" stop-color="#2de2a0"/>
        </linearGradient>
      </defs>
      <path d="M 30 150 A 120 120 0 0 1 270 150" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="18" stroke-linecap="round"/>
      <path class="arc-glow" d="M 30 150 A 120 120 0 0 1 270 150" fill="none" stroke="url(#gaugeGrad)" stroke-width="18" stroke-dasharray="2.6 5.4"/>
      <g class="needle"><path d="M 150 150 L 150 52" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="150" cy="150" r="9" fill="#0d1424" stroke="#f4c25b" stroke-width="3"/><circle cx="150" cy="50" r="5" fill="#f4c25b"/></g>
    </svg>`;

  const setGauge = (element, score, tone) => {
    element.style.setProperty("--angle", `${Math.max(-1, Math.min(1, score)) * 85}deg`);
    const color = { strong_bull: "rgba(45,226,160,.6)", bull: "rgba(45,226,160,.45)", neutral: "rgba(154,167,199,.4)", bear: "rgba(255,93,115,.45)", strong_bear: "rgba(255,93,115,.6)" }[tone];
    if (color) element.style.setProperty("--glow", color);
  };

  const countUp = (element) => {
    const target = Number(element.dataset.count);
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - start) / 1400, 1);
      element.textContent = Math.round(target * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const init = () => {
    addEventListener("load", () => setTimeout(() => document.body.classList.add("is-ready"), 700));
    setTimeout(() => document.body.classList.add("is-ready"), 2500);

    const header = document.querySelector(".header");
    const onScroll = () => {
      if (header) header.classList.toggle("scrolled", scrollY > 12);
    };
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in");
        entry.target.querySelectorAll("[data-count]").forEach(countUp);
        if (entry.target.dataset.count) countUp(entry.target);
        entry.target.querySelectorAll("[data-fill]").forEach((bar) => { bar.style.width = bar.dataset.fill; });
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.15 });
    document.querySelectorAll("[data-reveal]").forEach((element) => observer.observe(element));

    if (matchMedia("(hover: hover)").matches && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.querySelectorAll("[data-tilt]").forEach((card) => {
        card.addEventListener("pointermove", (event) => {
          const box = card.getBoundingClientRect();
          const x = (event.clientX - box.left) / box.width - 0.5;
          const y = (event.clientY - box.top) / box.height - 0.5;
          card.style.transform = `perspective(900px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg)`;
        });
        card.addEventListener("pointerleave", () => { card.style.transform = ""; });
      });
    }

    document.querySelectorAll("[data-split]").forEach((element) => {
      const words = element.textContent.trim().split(/\s+/);
      element.innerHTML = "";
      words.forEach((word, index) => {
        const outer = document.createElement("span");
        outer.className = "w";
        const inner = document.createElement("span");
        inner.style.setProperty("--i", index);
        inner.textContent = word + (index < words.length - 1 ? "\u00a0" : "");
        if (element.dataset.accent && element.dataset.accent.split(",").includes(String(index))) inner.className = "shimmer";
        outer.append(inner);
        element.append(outer);
      });
      element.classList.add("split");
    });
  };

  return { init, gaugeMarkup, setGauge, TONE_LABEL };
})();

MT.init();
