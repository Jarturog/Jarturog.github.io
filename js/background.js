// ---------- Background: live contour map by day, living constellation by night ----------
(() => {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.querySelector('.topo canvas'), ctx = canvas.getContext('2d');
  const wide = matchMedia('(min-width: 901px)');
  const isDark = () => document.documentElement.dataset.theme === 'dark';   // set in index.html and by js/main.js
  const FLOW_DOWN = 7, FLOW_OUT = 4;   // px per second: everything drifts down and away from the centre
  const SCROLL_PULL = -0.3;            // scrolling moves the background with the page, at a third of its speed (parallax)
  const COLUMN = 330;                  // keep the drawing out of the main column (half-width, px)
  const RING_SPEED = .16;              // contour spacings per second: rings grow out of the peaks
  const CURSOR_RADIUS = 120, CURSOR_PUSH = 45;   // how far and how hard the cursor pushes things away
  const GAP = 120, LINK = 190;         // a gap wider than GAP gets a new star; stars link up within LINK

  let W = 0, H = 0, starRGB = '238, 241, 255', lineRGB = '150, 170, 235', topoRGB = '120, 95, 60';
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(document.documentElement);
    starRGB = cs.getPropertyValue('--star').trim() || starRGB;
    lineRGB = cs.getPropertyValue('--star-line').trim() || lineRGB;
    topoRGB = cs.getPropertyValue('--topo').trim() || topoRGB;
  }

  // --- scroll and cursor ---
  let pendingScroll = 0, lastScrollY = scrollY;
  addEventListener('scroll', () => { pendingScroll += (scrollY - lastScrollY) * SCROLL_PULL; lastScrollY = scrollY; }, { passive: true });
  const pointer = { x: 0, y: 0, tx: 0, ty: 0, on: 0, target: 0 };
  addEventListener('pointermove', e => {
    if (!pointer.target) { pointer.x = e.clientX; pointer.y = e.clientY; }
    pointer.tx = e.clientX; pointer.ty = e.clientY; pointer.target = 1;
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { pointer.target = 0; });
  function followPointer(dt) {
    const k = Math.min(1, dt * 10);
    pointer.x += (pointer.tx - pointer.x) * k;
    pointer.y += (pointer.ty - pointer.y) * k;
    pointer.on += (pointer.target - pointer.on) * Math.min(1, dt * 4);
  }

  // --- the terrain: smooth noise that wraps around seamlessly, so it can flow forever ---
  const N = 160, TILE = 1200, ground = new Float32Array(N * N);
  let seed = 3920;   // 3,920 m
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  function periodicNoise(beta, fmax) {
    const z = new Float32Array(N * N), cx = new Float32Array(N), sx = new Float32Array(N), cy = new Float32Array(N), sy = new Float32Array(N);
    for (let fx = -fmax; fx <= fmax; fx++) for (let fy = 0; fy <= fmax; fy++) {
      if (fy === 0 && fx <= 0) continue;
      const r = Math.hypot(fx, fy);
      if (r > fmax) continue;
      const amp = r ** -beta, ph = rand() * Math.PI * 2;
      for (let i = 0; i < N; i++) {
        const a = 2 * Math.PI * i / N;
        cx[i] = Math.cos(fx * a + ph); sx[i] = Math.sin(fx * a + ph);
        cy[i] = Math.cos(fy * a); sy[i] = Math.sin(fy * a);
      }
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) z[j * N + i] += amp * (cx[i] * cy[j] - sx[i] * sy[j]);
    }
    let mean = 0, sq = 0;
    for (const v of z) mean += v;
    mean /= z.length;
    for (const v of z) sq += (v - mean) ** 2;
    const sd = Math.sqrt(sq / z.length);
    for (let i = 0; i < z.length; i++) z[i] = (z[i] - mean) / sd;
    return z;
  }
  const basins = periodicNoise(2.6, 9), ridges = periodicNoise(2.4, 11);   // loss-landscape basins + mountain crests
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < ground.length; i++) {
    ground[i] = .55 * basins[i] + .9 * (1 - Math.abs(ridges[i])) ** 2;
    lo = Math.min(lo, ground[i]); hi = Math.max(hi, ground[i]);
  }
  const SPACING = (hi - lo) / 17;
  function heightAt(u, v) {   // bilinear, wrapping around the tile
    let x = (u / TILE * N) % N, y = (v / TILE * N) % N;
    if (x < 0) x += N;
    if (y < 0) y += N;
    const i = x | 0, j = y | 0, fx = x - i, fy = y - j, i2 = (i + 1) % N, j2 = (j + 1) % N;
    const a = ground[j * N + i], b = ground[j * N + i2], c = ground[j2 * N + i], d = ground[j2 * N + i2];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  // --- day: trace the contour lines every frame (marching squares) ---
  const CELL = 7;
  // which cell edges a contour crosses, for each of the 16 corner patterns (0 top, 1 right, 2 bottom, 3 left)
  const CASES = [[], [3, 2], [2, 1], [3, 1], [0, 1], [3, 0, 2, 1], [0, 2], [3, 0], [3, 0], [0, 2], [0, 1, 3, 2], [0, 1], [3, 1], [2, 1], [3, 2], []];
  let down = 0, out = 0, rings = 0, grid = new Float32Array(0);
  function sampleSide(x0, cols, rows, side) {
    if (grid.length < cols * rows) grid = new Float32Array(cols * rows);
    const r2 = CURSOR_RADIUS * CURSOR_RADIUS, push = CURSOR_PUSH * pointer.on;
    let min = Infinity, max = -Infinity;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      let px = x0 + c * CELL, py = r * CELL;
      if (push > .5) {   // the cursor pushes the terrain away from itself
        const dx = px - pointer.x, dy = py - pointer.y, d2 = dx * dx + dy * dy;
        if (d2 < 9 * r2) {
          const f = push * Math.exp(-d2 / r2) / Math.sqrt(d2 + 1);
          px -= dx * f; py -= dy * f;
        }
      }
      const v = side < 0 ? heightAt(px + out, py - down) : heightAt(px - out + 560, py - down + 430);
      grid[r * cols + c] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return [min, max];
  }
  function traceSide(x0, x1, side, thin, thick) {
    const cols = Math.ceil((x1 - x0) / CELL) + 1, rows = Math.ceil(H / CELL) + 1;
    if (cols < 2) return;
    const [min, max] = sampleSide(x0, cols, rows, side);
    // levels slide downhill over time: rings keep growing out of every peak, and new ones appear at the top
    for (let k = Math.floor(min / SPACING) - 1; k <= Math.ceil(max / SPACING) + 4; k++) {
      const L = (k - rings) * SPACING;
      if (L <= min || L >= max) continue;
      const path = ((k % 4) + 4) % 4 === 0 ? thick : thin;
      for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
        const a = grid[r * cols + c], b = grid[r * cols + c + 1], d = grid[(r + 1) * cols + c], e = grid[(r + 1) * cols + c + 1];
        const idx = (a > L) << 3 | (b > L) << 2 | (e > L) << 1 | (d > L);
        if (idx === 0 || idx === 15) continue;
        const x = x0 + c * CELL, y = r * CELL, edges = CASES[idx];
        for (let s = 0; s < edges.length; s += 2) {
          for (let q = 0; q < 2; q++) {
            const edge = edges[s + q];
            let ex, ey;
            if (edge === 0) { ex = x + CELL * (L - a) / (b - a); ey = y; }
            else if (edge === 1) { ex = x + CELL; ey = y + CELL * (L - b) / (e - b); }
            else if (edge === 2) { ex = x + CELL * (L - d) / (e - d); ey = y + CELL; }
            else { ex = x; ey = y + CELL * (L - a) / (d - a); }
            q ? path.lineTo(ex, ey) : path.moveTo(ex, ey);
          }
        }
      }
    }
  }
  function drawContours(dt, pushed) {
    down += FLOW_DOWN * dt + pushed;
    out += FLOW_OUT * dt;
    rings = (rings + RING_SPEED * dt) % 4;   // every 4th line is thicker, so wrap after 4 spacings
    ctx.clearRect(0, 0, W, H);
    const thin = new Path2D(), thick = new Path2D(), m = W / 2 - COLUMN;
    traceSide(0, m, -1, thin, thick);
    traceSide(W - m, W, 1, thin, thick);
    ctx.strokeStyle = `rgb(${topoRGB})`;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.lineWidth = .9; ctx.stroke(thin);
    ctx.lineWidth = 1.7; ctx.stroke(thick);
  }

  // --- night: stars that wander, twinkle, link up and fill the gaps forever ---
  const stars = [], STAR_COLUMN = 380;
  const marginWidth = () => Math.max(0, W / 2 - STAR_COLUMN);
  function randomSpot() {
    const x = Math.random() * marginWidth();
    return [Math.random() < .5 ? x : W - x, Math.random() * H];
  }
  function addStar(x, y, now) {
    const big = Math.random() < .3;
    stars.push({
      x, y, born: now, vx: 0, vy: 0,
      speed: 3 + Math.random() * 8,            // each star keeps its own speed...
      heading: Math.random() * Math.PI * 2,     // ...but its direction wanders randomly
      size: big ? 3 + Math.random() * 3.5 : .8 + Math.random() * 1.1,
      sparkle: big,
      twinkle: .5 + Math.random() * 1.8, phase: Math.random() * Math.PI * 2,
    });
  }
  function emptiness(x, y) {
    let m = Infinity;
    for (const s of stars) m = Math.min(m, (s.x - x) ** 2 + (s.y - y) ** 2);
    return Math.sqrt(m);
  }
  function fillGaps(max, now) {
    if (marginWidth() < 40) return;
    for (let k = 0; k < max; k++) {
      let best = null, bestGap = 0;
      for (let i = 0; i < 40; i++) {
        const p = randomSpot(), g = emptiness(...p);
        if (g > bestGap) { bestGap = g; best = p; }
      }
      if (bestGap < GAP) return;
      addStar(...best, now);
    }
  }
  function moveStars(dt, pushed) {
    const reach = CURSOR_RADIUS * 1.4, damping = Math.exp(-3 * dt);
    for (let i = stars.length - 1; i >= 0; i--) {
      const s = stars[i];
      s.heading += (Math.random() - .5) * 2.4 * Math.sqrt(dt);
      const dx = s.x - pointer.x, dy = s.y - pointer.y, d = Math.hypot(dx, dy);
      if (pointer.on > .01 && d < reach && d > 0) {   // nudged away by the cursor, then they settle again
        const f = 600 * (1 - d / reach) * pointer.on * dt;
        s.vx += dx / d * f; s.vy += dy / d * f;
      }
      s.vx *= damping; s.vy *= damping;
      const outward = s.x < W / 2 ? -1 : 1;
      s.x += (Math.cos(s.heading) * s.speed + outward * FLOW_OUT + s.vx) * dt;
      s.y += (Math.sin(s.heading) * s.speed + FLOW_DOWN + s.vy) * dt + pushed;
      if (s.x < -40 || s.x > W + 40 || s.y < -40 || s.y > H + 40 || Math.abs(s.x - W / 2) < STAR_COLUMN - 80) stars.splice(i, 1);
    }
  }
  function drawSparkle(x, y, r) {
    const k = r * .22;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x + k, y - k, x + r, y);
    ctx.quadraticCurveTo(x + k, y + k, x, y + r);
    ctx.quadraticCurveTo(x - k, y + k, x - r, y);
    ctx.quadraticCurveTo(x - k, y - k, x, y - r);
    ctx.fill();
  }
  function drawStars(now, still) {
    ctx.clearRect(0, 0, W, H);
    const t = now / 1000, fade = s => still ? 1 : Math.min(1, (now - s.born) / 1500);
    // links: each star to its nearest neighbours
    ctx.lineWidth = .9;
    const drawn = new Set();
    stars.forEach((a, i) => {
      const near = [];
      stars.forEach((b, j) => {
        if (i === j) return;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < LINK) near.push([d, j]);
      });
      near.sort((p, q) => p[0] - q[0]);
      for (const [d, j] of near.slice(0, 3)) {
        const key = i < j ? i * 4096 + j : j * 4096 + i;
        if (drawn.has(key)) continue;
        drawn.add(key);
        const b = stars[j];
        ctx.strokeStyle = `rgba(${lineRGB}, ${(.6 * (1 - d / LINK) * Math.min(fade(a), fade(b))).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    });
    // stars: shine and fade, each on its own rhythm
    for (const s of stars) {
      const shine = still ? .8 : .5 + .5 * Math.sin(t * s.twinkle + s.phase);
      const a = fade(s) * (.3 + .7 * shine);
      if (s.sparkle) {
        const r = s.size * (.85 + .3 * shine);
        const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 3);
        glow.addColorStop(0, `rgba(${starRGB}, ${(a * .35).toFixed(3)})`);
        glow.addColorStop(1, `rgba(${starRGB}, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(s.x, s.y, r * 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(${starRGB}, ${a.toFixed(3)})`;
        drawSparkle(s.x, s.y, r);
      } else {
        ctx.fillStyle = `rgba(${starRGB}, ${a.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // --- run ---
  function still() {   // one still frame, for people who prefer reduced motion
    if (!wide.matches) return;
    if (isDark()) { if (!stars.length) fillGaps(400, -1e9); drawStars(0, true); }
    else drawContours(0, 0);
  }
  resize();
  addEventListener('resize', () => { resize(); if (reduceMotion) still(); });
  addEventListener('themechange', () => { resize(); if (reduceMotion) still(); });
  if (reduceMotion) { still(); return; }

  let last = performance.now(), nextFill = 0;
  function frame(now) {
    const dt = Math.max(0, Math.min((now - last) / 1000, .1)), pushed = pendingScroll;   // the first frame can be timed slightly in the past
    last = now; pendingScroll = 0;
    if (wide.matches) {
      followPointer(dt);
      if (isDark()) {
        if (!stars.length) fillGaps(400, -1e9);   // first night: a full sky at once
        moveStars(dt, pushed);
        if (now > nextFill) { fillGaps(3, now); nextFill = now + 400; }
        drawStars(now, false);
      } else {
        drawContours(dt, pushed);
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
