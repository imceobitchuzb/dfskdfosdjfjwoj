/* Animated market background: flowing price waves, drifting candles and a pointer glow. */
(() => {
  const canvas = document.getElementById("bg");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pointer = { x: 0.5, y: 0.25, tx: 0.5, ty: 0.25 };
  let width = 0, height = 0, ratio = 1, time = 0, candles = [], frame = 0;

  const spawn = (anywhere) => ({
    x: Math.random() * width,
    y: anywhere ? Math.random() * height : height + 60 * ratio,
    body: (5 + Math.random() * 9) * ratio,
    wick: (12 + Math.random() * 26) * ratio,
    speed: (0.12 + Math.random() * 0.34) * ratio,
    up: Math.random() > 0.42,
    alpha: 0.1 + Math.random() * 0.26,
  });

  function resize() {
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.width = Math.floor(innerWidth * ratio);
    height = canvas.height = Math.floor(innerHeight * ratio);
    candles = Array.from({ length: innerWidth < 720 ? 14 : 30 }, () => spawn(true));
    if (reduceMotion) draw();
  }

  function wave(offset, amplitude, speed, frequency, base, colorA, colorB, fillAlpha) {
    const step = 10 * ratio;
    ctx.beginPath();
    for (let x = -step; x <= width + step; x += step) {
      const y = base
        + Math.sin(x * frequency + time * speed + offset) * amplitude
        + Math.sin(x * frequency * 2.4 - time * speed * 0.7 + offset) * amplitude * 0.38
        + (pointer.y - 0.5) * 40 * ratio;
      x === -step ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    const stroke = ctx.createLinearGradient(0, 0, width, 0);
    stroke.addColorStop(0, "rgba(244,194,91,0)");
    stroke.addColorStop(0.3, colorA);
    stroke.addColorStop(0.7, colorB);
    stroke.addColorStop(1, "rgba(95,227,255,0)");
    ctx.lineWidth = 1.6 * ratio;
    ctx.strokeStyle = stroke;
    ctx.stroke();
    ctx.lineTo(width + step, height);
    ctx.lineTo(-step, height);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, base - amplitude, 0, height);
    fill.addColorStop(0, `rgba(244,194,91,${fillAlpha})`);
    fill.addColorStop(1, "rgba(244,194,91,0)");
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    const glow = ctx.createRadialGradient(width * 0.5, height * 0.08, 0, width * 0.5, height * 0.08, height * 0.9);
    glow.addColorStop(0, "rgba(34,52,110,0.55)");
    glow.addColorStop(0.5, "rgba(10,16,38,0.35)");
    glow.addColorStop(1, "rgba(4,6,12,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(160,185,255,0.045)";
    ctx.lineWidth = ratio;
    const cell = 64 * ratio;
    ctx.beginPath();
    for (let x = (-time * 6 * ratio) % cell; x < width; x += cell) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
    for (let y = 0; y < height; y += cell) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
    ctx.stroke();

    wave(0, 60 * ratio, 0.5, 0.0032 / ratio, height * 0.62, "rgba(244,194,91,0.85)", "rgba(255,227,163,0.7)", 0.1);
    wave(2, 46 * ratio, 0.38, 0.0045 / ratio, height * 0.74, "rgba(95,227,255,0.55)", "rgba(244,194,91,0.5)", 0.05);
    wave(4, 34 * ratio, 0.28, 0.006 / ratio, height * 0.86, "rgba(244,194,91,0.4)", "rgba(95,227,255,0.35)", 0.03);

    for (const c of candles) {
      const color = c.up ? "244,194,91" : "120,150,230";
      ctx.globalAlpha = c.alpha * Math.min(1, (height - c.y) / (height * 0.5) + 0.3);
      ctx.strokeStyle = `rgb(${color})`;
      ctx.fillStyle = `rgba(${color},0.55)`;
      ctx.lineWidth = ratio;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - c.wick);
      ctx.lineTo(c.x, c.y + c.wick);
      ctx.stroke();
      ctx.fillRect(c.x - c.body / 2, c.y - c.body, c.body, c.body * 2);
      c.y -= c.speed;
      if (c.y < -c.wick * 2) Object.assign(c, spawn(false));
    }
    ctx.globalAlpha = 1;

    const px = pointer.x * width, py = pointer.y * height;
    const spot = ctx.createRadialGradient(px, py, 0, px, py, 280 * ratio);
    spot.addColorStop(0, "rgba(95,140,255,0.06)");
    spot.addColorStop(1, "rgba(95,140,255,0)");
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, width, height);
  }

  function loop() {
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    time += 0.016;
    draw();
    frame = requestAnimationFrame(loop);
  }

  let resizeTimer = null;
  let lastWidth = innerWidth;
  let lastHeight = innerHeight;
  // Mobile browsers fire resize while the address bar slides; only a real size change rebuilds the scene.
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (innerWidth === lastWidth && Math.abs(innerHeight - lastHeight) < 120) return;
      lastWidth = innerWidth;
      lastHeight = innerHeight;
      resize();
    }, 150);
  });
  addEventListener("pointermove", (event) => { pointer.tx = event.clientX / innerWidth; pointer.ty = event.clientY / innerHeight; }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    cancelAnimationFrame(frame);
    if (!document.hidden && !reduceMotion) loop();
  });
  resize();
  if (!reduceMotion) loop();
})();
