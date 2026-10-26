// Üretim motoru: tohumlu arkaplan üreticileri, üst üste binen efektler, logo/yazı katmanı.
// Her şey normalize koordinatla çizilir; aynı tasarım her çözünürlükte aynı görünür.
(function () {
  const F = window.Fon = window.Fon || {};
  const TAU = Math.PI * 2;

  // ---------- rastgelelik ve gürültü
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hash(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function makeNoise(rng) {
    const p = []; for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    const perm = new Uint8Array(512); for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    const gx = new Float32Array(256), gy = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const a = rng() * TAU; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    return function (x, y) {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
      const d = (ix, iy, dx, dy) => { const g = perm[perm[ix] + iy]; return gx[g] * dx + gy[g] * dy; };
      const n00 = d(X, Y, xf, yf), n10 = d(X + 1, Y, xf - 1, yf), n01 = d(X, Y + 1, xf, yf - 1), n11 = d(X + 1, Y + 1, xf - 1, yf - 1);
      const u = fade(xf), v = fade(yf);
      return (n00 + (n10 - n00) * u + (n01 - n00) * v + (n00 - n10 - n01 + n11) * u * v) * 1.41;
    };
  }

  // ---------- renk
  function rgb(h) {
    h = h.replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&');
    const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  const hex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  function rgba(h, a) { const [r, g, b] = rgb(h); return `rgba(${r},${g},${b},${a})`; }
  function mix(a, b, t) { const A = rgb(a), B = rgb(b); return hex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]); }
  const light = (h, t) => mix(h, '#ffffff', t);
  const dark = (h, t) => mix(h, '#000000', t);
  function lum(h) { const [r, g, b] = rgb(h); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }
  function colorAt(p, t) {
    t = Math.max(0, Math.min(0.9999, t)); const s = t * (p.length - 1), i = Math.floor(s);
    return mix(p[i], p[i + 1], s - i);
  }
  const byLum = p => p.slice().sort((a, b) => lum(a) - lum(b));

  // ---------- çizim yardımcıları
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
  function rr(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  // Kademeli küçültme: bulanıklık ve pikselleştirme için temiz örnekleme
  function down(src, w, h, long) {
    const k = Math.min(1, long / Math.max(w, h)), tw = Math.max(1, Math.round(w * k)), th = Math.max(1, Math.round(h * k));
    let cur = src, cw = w, ch = h;
    while (cw / 2 > tw && ch / 2 > th) {
      cw = Math.round(cw / 2); ch = Math.round(ch / 2);
      const t = mk(cw, ch), x = t.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, cw, ch); cur = t;
    }
    const t = mk(tw, th), x = t.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, tw, th);
    return t;
  }
  function upSmooth(c, small, w, h) {
    // iki adımlı büyütme, tek adımın elmas izlerini yumuşatır
    const mid = mk(Math.min(w, small.width * 4), Math.min(h, small.height * 4)), x = mid.getContext('2d');
    x.imageSmoothingQuality = 'high'; x.drawImage(small, 0, 0, mid.width, mid.height);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(mid, 0, 0, w, h);
  }

  // ---------- arkaplan üreticileri: draw(ctx, w, h, rng, palet, gürültü)
  const gens = [
    { id: 'mesh', name: 'Aurora', draw(c, w, h, r, p) {
      const S = Math.max(w, h); c.fillStyle = p[0]; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 7; i++) {
        const x = r() * w, y = r() * h, rad = (0.35 + r() * 0.5) * S, col = p[1 + i % 4];
        const g = c.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, rgba(col, 0.9)); g.addColorStop(0.45, rgba(col, 0.4)); g.addColorStop(1, rgba(col, 0));
        c.fillStyle = g; c.fillRect(0, 0, w, h);
      }
    }},
    { id: 'fluid', name: 'Akışkan', draw(c, w, h, r, p, nz) {
      const L = 160, tw = w >= h ? L : Math.max(2, Math.round(L * w / h)), th = w >= h ? Math.max(2, Math.round(L * h / w)) : L;
      const t = mk(tw, th), x = t.getContext('2d'), id = x.createImageData(tw, th), d = id.data;
      const sc = 1.1 + r() * 1.8, ox = r() * 60, oy = r() * 60, warp = 1 + r() * 1.5, cols = p.map(rgb);
      for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
        const u = i / L * sc + ox, v = j / L * sc + oy;
        const q = nz(u + nz(u, v) * warp, v + nz(u + 5.2, v + 1.3) * warp);
        const tt = Math.max(0, Math.min(0.9999, q * 0.6 + 0.5)) * (cols.length - 1), k = Math.floor(tt), f = tt - k;
        const A = cols[k], B = cols[k + 1], o = (j * tw + i) * 4;
        d[o] = A[0] + (B[0] - A[0]) * f; d[o + 1] = A[1] + (B[1] - A[1]) * f; d[o + 2] = A[2] + (B[2] - A[2]) * f; d[o + 3] = 255;
      }
      x.putImageData(id, 0, 0); upSmooth(c, t, w, h);
    }},
    { id: 'linear', name: 'Geçiş', draw(c, w, h, r, p) {
      const a = r() * TAU, L = Math.hypot(w, h) / 2, dx = Math.cos(a) * L, dy = Math.sin(a) * L;
      const g = c.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy), n = 3 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) g.addColorStop(i / (n - 1), p[i]);
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      const x = r() * w, y = r() * h, R = Math.max(w, h) * 0.7, g2 = c.createRadialGradient(x, y, 0, x, y, R);
      g2.addColorStop(0, rgba(p[4], 0.45)); g2.addColorStop(1, rgba(p[4], 0)); c.fillStyle = g2; c.fillRect(0, 0, w, h);
    }},
    { id: 'waves', name: 'Dalga', draw(c, w, h, r, p) {
      c.fillStyle = p[0]; c.fillRect(0, 0, w, h);
      const n = 6 + Math.floor(r() * 3), pp = p.slice(1);
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), base = h * (0.16 + 0.8 * t), a1 = h * (0.015 + r() * 0.04), a2 = h * (0.006 + r() * 0.02);
        const f1 = 0.6 + r() * 1.6, f2 = 2 + r() * 3, ph1 = r() * TAU, ph2 = r() * TAU, col = colorAt(pp, t);
        c.beginPath(); c.moveTo(0, h);
        for (let k = 0; k <= 120; k++) { const u = k / 120; c.lineTo(u * w, base + a1 * Math.sin(u * f1 * TAU + ph1) + a2 * Math.sin(u * f2 * TAU + ph2)); }
        c.lineTo(w, h); c.closePath();
        const g = c.createLinearGradient(0, base - a1 * 2, 0, base + h * 0.35);
        g.addColorStop(0, light(col, 0.18)); g.addColorStop(1, dark(col, 0.12)); c.fillStyle = g; c.fill();
      }
    }},
    { id: 'dunes', name: 'Tepe', draw(c, w, h, r, p) {
      const m = Math.min(w, h), sky = c.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, p[0]); sky.addColorStop(0.6, mix(p[0], p[1], 0.6)); sky.addColorStop(1, p[1]);
      c.fillStyle = sky; c.fillRect(0, 0, w, h);
      const sx = w * (0.25 + r() * 0.5), sy = h * (0.22 + r() * 0.2), sr = m * (0.1 + r() * 0.1);
      const sg = c.createRadialGradient(sx, sy, 0, sx, sy, sr * 2.4);
      sg.addColorStop(0, rgba(p[2], 1)); sg.addColorStop(0.4, rgba(p[2], 1)); sg.addColorStop(0.42, rgba(p[2], 0.22)); sg.addColorStop(1, rgba(p[2], 0));
      c.fillStyle = sg; c.fillRect(0, 0, w, h);
      const n = 4 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), base = h * (0.5 + 0.38 * t), col = mix(p[3], p[4], t);
        c.beginPath(); c.moveTo(0, h); c.lineTo(0, base + (r() - 0.5) * h * 0.12);
        for (let s = 1; s <= 3; s++) c.quadraticCurveTo(w * (s - 0.5) / 3, base + (r() - 0.5) * h * 0.22, w * s / 3, base + (r() - 0.5) * h * 0.1);
        c.lineTo(w, h); c.closePath();
        const g = c.createLinearGradient(0, base - h * 0.1, 0, h);
        g.addColorStop(0, light(col, 0.1)); g.addColorStop(1, dark(col, 0.25)); c.fillStyle = g; c.fill();
      }
    }},
    { id: 'bauhaus', name: 'Bauhaus', draw(c, w, h, r, p) {
      const m = Math.min(w, h), k = 2 + Math.floor(r() * 3), cell = m / k;
      const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell), ox = (w - cols * cell) / 2, oy = (h - rows * cell) / 2;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const x = ox + i * cell, y = oy + j * cell, bi = Math.floor(r() * 5);
        let fi = Math.floor(r() * 4); if (fi >= bi) fi++;
        c.fillStyle = p[bi]; c.fillRect(x, y, cell + 1, cell + 1); c.fillStyle = p[fi];
        const t = Math.floor(r() * 6), rot = Math.floor(r() * 4), s = cell / 2;
        c.save(); c.translate(x + s, y + s); c.rotate(rot * Math.PI / 2); c.beginPath();
        if (t === 0) { c.moveTo(-s, -s); c.arc(-s, -s, cell, 0, Math.PI / 2); c.closePath(); }
        else if (t === 1) { c.arc(0, s, s, Math.PI, 0); c.closePath(); }
        else if (t === 2) c.arc(0, 0, s * 0.72, 0, TAU);
        else if (t === 3) { c.moveTo(-s, -s); c.lineTo(s, -s); c.lineTo(-s, s); c.closePath(); }
        else if (t === 4) { c.arc(0, 0, s * 0.78, 0, TAU); c.arc(0, 0, s * 0.38, 0, TAU, true); }
        else c.rect(-s, -s * 0.25, cell, s * 0.5);
        c.fill(); c.restore();
      }
    }},
    { id: 'stripes', name: 'Şerit', draw(c, w, h, r, p) {
      const S = Math.max(w, h), D = Math.hypot(w, h), angs = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, Math.PI / 6, -Math.PI / 3];
      const a = angs[Math.floor(r() * angs.length)], wide = r() < 0.5;
      c.save(); c.translate(w / 2, h / 2); c.rotate(a);
      let x = -D / 2, last = -1;
      while (x < D / 2) {
        const bw = S * (wide ? 0.04 + r() * 0.14 : 0.01 + r() * 0.05);
        let ci = Math.floor(r() * 5); if (ci === last) ci = (ci + 1) % 5; last = ci;
        c.fillStyle = p[ci]; c.fillRect(x, -D / 2, bw + 1, D); x += bw;
      }
      c.restore();
    }},
    { id: 'rings', name: 'Halka', draw(c, w, h, r, p) {
      const cx = w * (-0.1 + r() * 1.2), cy = h * (-0.1 + r() * 1.2), n = 10 + Math.floor(r() * 18);
      const R = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)), dx = (r() - 0.5) * 0.3 * w, dy = (r() - 0.5) * 0.3 * h, smooth = r() < 0.5;
      for (let i = 0; i < n; i++) {
        const t = i / n; c.beginPath(); c.arc(cx + dx * t, cy + dy * t, R * (1 - t), 0, TAU);
        c.fillStyle = smooth ? colorAt(p, t) : p[i % 5]; c.fill();
      }
    }},
    { id: 'topo', name: 'Topografya', draw(c, w, h, r, p, nz) {
      const S = Math.max(w, h), s = byLum(p), darkBg = r() < 0.6;
      c.fillStyle = darkBg ? s[0] : s[4]; c.fillRect(0, 0, w, h);
      const lc = darkBg ? s.slice(2) : s.slice(0, 3), cx = w * (0.2 + r() * 0.6), cy = h * (0.2 + r() * 0.6), R = Math.hypot(w, h), L = 60;
      c.lineJoin = 'round';
      for (let k = 1; k <= L; k++) {
        const base = k / L * R * 1.05; c.beginPath();
        for (let i = 0; i <= 220; i++) {
          const th = i / 220 * TAU, q = nz(Math.cos(th) * 1.3 + 5, Math.sin(th) * 1.3 + 5 + k * 0.035), rad = base * (1 + 0.38 * q);
          const X = cx + Math.cos(th) * rad, Y = cy + Math.sin(th) * rad; i ? c.lineTo(X, Y) : c.moveTo(X, Y);
        }
        c.lineWidth = S * (k % 5 ? 0.0014 : 0.003); c.strokeStyle = rgba(colorAt(lc, k / L), 0.75); c.stroke();
      }
    }},
    { id: 'orbs', name: 'Küre', draw(c, w, h, r, p) {
      const m = Math.min(w, h), g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, p[0]); g.addColorStop(1, dark(p[0], 0.35)); c.fillStyle = g; c.fillRect(0, 0, w, h);
      const orbs = [], n = 3 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) orbs.push({ x: w * (0.1 + r() * 0.8), y: h * (0.1 + r() * 0.8), rad: m * (0.08 + r() * 0.25), col: p[1 + Math.floor(r() * 4)] });
      orbs.sort((a, b) => b.rad - a.rad);
      for (const o of orbs) {
        const sx = o.x + o.rad * 0.25, sy = o.y + o.rad * 0.4, sh = c.createRadialGradient(sx, sy, 0, sx, sy, o.rad * 1.5);
        sh.addColorStop(0, 'rgba(0,0,0,.3)'); sh.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = sh; c.fillRect(0, 0, w, h);
        const rg = c.createRadialGradient(o.x - o.rad * 0.35, o.y - o.rad * 0.4, o.rad * 0.05, o.x, o.y, o.rad);
        rg.addColorStop(0, light(o.col, 0.65)); rg.addColorStop(0.35, light(o.col, 0.1)); rg.addColorStop(0.8, o.col); rg.addColorStop(1, dark(o.col, 0.45));
        c.beginPath(); c.arc(o.x, o.y, o.rad, 0, TAU); c.fillStyle = rg; c.fill();
      }
    }},
    { id: 'prism', name: 'Cam', draw(c, w, h, r, p) {
      const m = Math.min(w, h), S = Math.max(w, h), g = c.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, p[0]); g.addColorStop(1, p[1]); c.fillStyle = g; c.fillRect(0, 0, w, h);
      const n = 5 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const cx = r() * w, cy = r() * h, ww = m * (0.25 + r() * 0.5), hh = m * (0.4 + r() * 0.8), a = r() * Math.PI;
        const col = p[2 + Math.floor(r() * 3)], col2 = p[Math.floor(r() * 5)];
        c.save(); c.translate(cx, cy); c.rotate(a);
        const lg = c.createLinearGradient(-ww / 2, -hh / 2, ww / 2, hh / 2);
        lg.addColorStop(0, rgba(col, 0.7)); lg.addColorStop(1, rgba(col2, 0.12));
        rr(c, -ww / 2, -hh / 2, ww, hh, m * 0.04); c.fillStyle = lg; c.fill();
        c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = S * 0.0015; c.stroke(); c.restore();
      }
    }},
    { id: 'conic', name: 'Konik', draw(c, w, h, r, p) {
      const cx = w * (0.2 + r() * 0.6), cy = h * (0.2 + r() * 0.6), a = r() * TAU;
      if (c.createConicGradient) {
        const g = c.createConicGradient(a, cx, cy); for (let i = 0; i <= 5; i++) g.addColorStop(i / 5, p[i % 5]); c.fillStyle = g;
      } else {
        const g = c.createLinearGradient(0, 0, w, h); p.forEach((col, i) => g.addColorStop(i / 4, col)); c.fillStyle = g;
      }
      c.fillRect(0, 0, w, h);
      const R = Math.hypot(w, h) * 0.6, rg = c.createRadialGradient(cx, cy, 0, cx, cy, R);
      rg.addColorStop(0, 'rgba(255,255,255,.18)'); rg.addColorStop(0.5, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,0,0,.28)');
      c.fillStyle = rg; c.fillRect(0, 0, w, h);
    }},
    { id: 'mosaic', name: 'Mozaik', draw(c, w, h, r, p, nz) {
      const m = Math.min(w, h), k = 5 + Math.floor(r() * 8), cell = m / k, cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const x = i * cell, y = j * cell, base = nz(i * 0.18, j * 0.18) * 0.6 + 0.5;
        const t1 = base + (r() - 0.5) * 0.2, t2 = base + (r() - 0.5) * 0.25, diag = r() < 0.5;
        c.fillStyle = colorAt(p, t1); c.fillRect(x, y, cell + 1, cell + 1);
        c.fillStyle = colorAt(p, t2); c.beginPath();
        if (diag) { c.moveTo(x, y); c.lineTo(x + cell, y); c.lineTo(x + cell, y + cell); }
        else { c.moveTo(x + cell, y); c.lineTo(x + cell, y + cell); c.lineTo(x, y + cell); }
        c.closePath(); c.fill();
      }
    }},
    { id: 'minimal', name: 'Minimal', draw(c, w, h, r, p) {
      const m = Math.min(w, h), b = p[0], g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, light(b, 0.06)); g.addColorStop(1, dark(b, 0.08)); c.fillStyle = g; c.fillRect(0, 0, w, h);
      const t = Math.floor(r() * 4), fc = p[1 + Math.floor(r() * 4)], cx = w / 2; c.fillStyle = fc; c.beginPath();
      if (t === 0) { c.arc(cx, h * (0.38 + r() * 0.2), m * (0.22 + r() * 0.15), 0, TAU); c.fill(); }
      else if (t === 1) { c.arc(cx, h, m * (0.45 + r() * 0.2), Math.PI, 0); c.fill(); }
      else if (t === 2) {
        const aw = m * (0.42 + r() * 0.2), top = h * (0.32 + r() * 0.15);
        c.moveTo(cx - aw / 2, h); c.lineTo(cx - aw / 2, top + aw / 2); c.arc(cx, top + aw / 2, aw / 2, Math.PI, 0); c.lineTo(cx + aw / 2, h); c.closePath(); c.fill();
      } else {
        const hy = h * (0.55 + r() * 0.2); c.arc(cx + (r() - 0.5) * w * 0.3, hy, m * (0.16 + r() * 0.1), 0, TAU); c.fill();
        c.fillStyle = p[1 + Math.floor(r() * 4)]; c.fillRect(0, hy, w, h - hy);
      }
    }},
    { id: 'flow', name: 'Akım', draw(c, w, h, r, p, nz) {
      const S = Math.max(w, h), sc = 1.5 + r() * 2.5, step = S * 0.005;
      c.fillStyle = p[0]; c.fillRect(0, 0, w, h); c.lineCap = 'round'; c.lineJoin = 'round';
      for (let i = 0; i < 420; i++) {
        let x = r() * w, y = r() * h; const col = p[1 + Math.floor(r() * 4)], lw = S * (0.0012 + r() * 0.003), al = 0.35 + r() * 0.5;
        c.beginPath(); c.moveTo(x, y);
        for (let s = 0; s < 70; s++) { const a = nz(x / S * sc, y / S * sc) * TAU; x += Math.cos(a) * step; y += Math.sin(a) * step; c.lineTo(x, y); }
        c.strokeStyle = rgba(col, al); c.lineWidth = lw; c.stroke();
      }
    }},
    { id: 'bokeh', name: 'Bokeh', draw(c, w, h, r, p) {
      const m = Math.min(w, h), s = byLum(p), g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, dark(s[0], 0.25)); g.addColorStop(1, mix(s[0], s[1], 0.5)); c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 70; i++) {
        const x = r() * w, y = r() * h, rad = m * (0.01 + Math.pow(r(), 2) * 0.14), col = p[Math.floor(r() * 5)], al = 0.06 + r() * 0.25;
        const rg = c.createRadialGradient(x, y, 0, x, y, rad);
        rg.addColorStop(0, rgba(col, al)); rg.addColorStop(0.7, rgba(col, al * 0.9)); rg.addColorStop(1, rgba(col, 0));
        c.fillStyle = rg; c.beginPath(); c.arc(x, y, rad, 0, TAU); c.fill();
      }
      c.globalCompositeOperation = 'source-over';
    }},
    { id: 'ribbon', name: 'Kurdele', draw(c, w, h, r, p) {
      const S = Math.max(w, h); c.fillStyle = p[0]; c.fillRect(0, 0, w, h); c.lineCap = 'round';
      const n = 3 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const P = [[-0.2 * w, r() * h], [r() * w, r() * h], [r() * w, r() * h], [1.2 * w, r() * h]];
        const lw = S * (0.06 + r() * 0.14), c1 = p[1 + Math.floor(r() * 4)], c2 = p[1 + Math.floor(r() * 4)];
        const path = () => { c.beginPath(); c.moveTo(P[0][0], P[0][1]); c.bezierCurveTo(P[1][0], P[1][1], P[2][0], P[2][1], P[3][0], P[3][1]); };
        c.save(); c.translate(0, S * 0.012); path(); c.strokeStyle = 'rgba(0,0,0,.18)'; c.lineWidth = lw; c.stroke(); c.restore();
        const g = c.createLinearGradient(P[0][0], P[0][1], P[3][0], P[3][1]); g.addColorStop(0, c1); g.addColorStop(1, c2);
        path(); c.strokeStyle = g; c.lineWidth = lw; c.stroke();
        c.save(); c.translate(0, -lw * 0.22); path(); c.strokeStyle = 'rgba(255,255,255,.16)'; c.lineWidth = lw * 0.22; c.stroke(); c.restore();
      }
    }},
    { id: 'twist', name: 'Girdap', draw(c, w, h, r, p) {
      c.fillStyle = p[0]; c.fillRect(0, 0, w, h);
      const cx = w / 2 + (r() - 0.5) * w * 0.3, cy = h / 2 + (r() - 0.5) * h * 0.3, n = 26 + Math.floor(r() * 14);
      const da = (r() < 0.5 ? -1 : 1) * (0.04 + r() * 0.1), f = Math.abs(Math.cos(da)) + Math.abs(Math.sin(da)), smooth = r() < 0.5;
      let s = Math.hypot(w, h) * 1.1;
      for (let i = 0; i < n; i++) {
        c.save(); c.translate(cx, cy); c.rotate(da * i); c.fillStyle = smooth ? colorAt(p, i / n) : p[i % 5];
        c.fillRect(-s / 2, -s / 2, s, s); c.restore(); s /= f;
      }
    }},
  ];
  const genById = Object.fromEntries(gens.map(g => [g.id, g]));

  // ---------- efektler (katmanlar), uygulanma sırası bu dizinin sırasıdır
  let grainTile = null;
  function grain() {
    if (grainTile) return grainTile;
    const t = mk(256, 256), x = t.getContext('2d'), id = x.createImageData(256, 256), rr2 = mulberry32(7);
    for (let i = 0; i < id.data.length; i += 4) { const v = 128 + (rr2() - 0.5) * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
    x.putImageData(id, 0, 0); return (grainTile = t);
  }
  function dotsPath(c, w, h, sp, radFn) {
    c.beginPath();
    for (let y = sp / 2; y < h; y += sp) for (let x = sp / 2; x < w; x += sp) {
      const rad = radFn(x, y); if (rad > 0.3) { c.moveTo(x + rad, y); c.arc(x, y, rad, 0, TAU); }
    }
  }
  const fx = [
    { id: 'blur', name: 'Yumuşak odak', amount: 0.3, draw(c, w, h, o) { upSmooth(c, down(c.canvas, w, h, Math.max(4, 300 / (1 + o.amount * 25))), w, h); } },
    { id: 'pixel', name: 'Piksel', amount: 0.3, draw(c, w, h, o) {
      const t = down(c.canvas, w, h, Math.round(200 - o.amount * 185)); c.imageSmoothingEnabled = false; c.drawImage(t, 0, 0, w, h);
    }},
    { id: 'tint', name: 'Renk tonu', amount: 0.45, color: '#0A84FF', draw(c, w, h, o) {
      c.globalCompositeOperation = 'color'; c.globalAlpha = o.amount; c.fillStyle = o.color; c.fillRect(0, 0, w, h);
    }},
    { id: 'dim', name: 'Karartma', amount: 0.25, color: '#000000', draw(c, w, h, o) { c.fillStyle = rgba(o.color, o.amount * 0.75); c.fillRect(0, 0, w, h); } },
    { id: 'leak', name: 'Işık sızması', amount: 0.5, color: '#FF9F0A', draw(c, w, h, o) {
      const S = Math.max(w, h); c.globalCompositeOperation = 'screen';
      const a = c.createRadialGradient(0, 0, 0, 0, 0, S * 0.75); a.addColorStop(0, rgba(o.color, o.amount * 0.8)); a.addColorStop(1, rgba(o.color, 0));
      c.fillStyle = a; c.fillRect(0, 0, w, h);
      const b2 = mix(o.color, '#FF2D55', 0.5), b = c.createRadialGradient(w, h * 0.8, 0, w, h * 0.8, S * 0.6);
      b.addColorStop(0, rgba(b2, o.amount * 0.55)); b.addColorStop(1, rgba(b2, 0)); c.fillStyle = b; c.fillRect(0, 0, w, h);
    }},
    { id: 'glass', name: 'Cam panel', amount: 0.5, color: '#FFFFFF', draw(c, w, h, o) {
      const m = Math.min(w, h), port = h > w, pw = port ? w * 0.8 : w * 0.5, ph = port ? h * 0.34 : h * 0.56;
      const x = (w - pw) / 2, y = port ? h * 0.52 : (h - ph) / 2, rad = m * 0.07, t = down(c.canvas, w, h, 48);
      c.save(); rr(c, x, y, pw, ph, rad); c.clip(); upSmooth(c, t, w, h);
      c.fillStyle = rgba(o.color, 0.06 + o.amount * 0.22); c.fillRect(x, y, pw, ph); c.restore();
      rr(c, x, y, pw, ph, rad); c.strokeStyle = `rgba(255,255,255,${0.2 + o.amount * 0.35})`; c.lineWidth = m * 0.003; c.stroke();
    }},
    { id: 'dots', name: 'Nokta ızgara', amount: 0.35, color: '#FFFFFF', draw(c, w, h, o) {
      const sp = Math.min(w, h) * 0.035; dotsPath(c, w, h, sp, () => Math.max(0.6, sp * 0.075)); c.fillStyle = rgba(o.color, o.amount); c.fill();
    }},
    { id: 'grid', name: 'Çizgi ızgara', amount: 0.25, color: '#FFFFFF', draw(c, w, h, o) {
      const m = Math.min(w, h), sp = m * 0.08; c.beginPath();
      for (let x = (w % sp) / 2; x < w; x += sp) { c.moveTo(x, 0); c.lineTo(x, h); }
      for (let y = (h % sp) / 2; y < h; y += sp) { c.moveTo(0, y); c.lineTo(w, y); }
      c.strokeStyle = rgba(o.color, o.amount); c.lineWidth = Math.max(1, m * 0.0012); c.stroke();
    }},
    { id: 'hatch', name: 'Tarama', amount: 0.2, color: '#FFFFFF', draw(c, w, h, o) {
      const D = Math.hypot(w, h), sp = Math.min(w, h) * 0.014; c.translate(w / 2, h / 2); c.rotate(Math.PI / 4); c.fillStyle = rgba(o.color, o.amount);
      for (let x = -D / 2; x < D / 2; x += sp) c.fillRect(x, -D / 2, Math.max(1, sp * 0.18), D);
    }},
    { id: 'halftone', name: 'Yarım ton', amount: 0.45, color: '#000000', draw(c, w, h, o) {
      const sp = Math.min(w, h) * 0.022; dotsPath(c, w, h, sp, (x, y) => sp * 0.55 * Math.min(1, Math.pow(y / h, 1.5) * o.amount * 2));
      c.fillStyle = rgba(o.color, 0.55); c.fill();
    }},
    { id: 'scan', name: 'Ekran çizgisi', amount: 0.3, color: '#000000', draw(c, w, h, o) {
      const sp = Math.max(2, Math.min(w, h) * 0.005); c.fillStyle = rgba(o.color, o.amount * 0.5);
      for (let y = 0; y < h; y += sp) c.fillRect(0, y, w, sp * 0.4);
    }},
    { id: 'stars', name: 'Yıldızlar', amount: 0.6, color: '#FFFFFF', draw(c, w, h, o) {
      const S = Math.max(w, h), r = mulberry32((o.seed || 7) + 99);
      for (let i = 0; i < 320; i++) {
        const x = r() * w, y = r() * h, rad = S * (0.0005 + Math.pow(r(), 3) * 0.0022);
        c.fillStyle = rgba(o.color, (0.25 + r() * 0.75) * o.amount); c.beginPath(); c.arc(x, y, rad, 0, TAU); c.fill();
      }
    }},
    { id: 'frame', name: 'Çerçeve', amount: 0.6, color: '#FFFFFF', draw(c, w, h, o) {
      const m = Math.min(w, h), ins = m * 0.045; rr(c, ins, ins, w - ins * 2, h - ins * 2, m * 0.05);
      c.strokeStyle = rgba(o.color, o.amount); c.lineWidth = m * 0.006; c.stroke();
    }},
    { id: 'vignette', name: 'Vinyet', amount: 0.5, color: '#000000', draw(c, w, h, o) {
      const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) / 2 * 1.05);
      g.addColorStop(0, rgba(o.color, 0)); g.addColorStop(1, rgba(o.color, o.amount * 0.85)); c.fillStyle = g; c.fillRect(0, 0, w, h);
    }},
    { id: 'grain', name: 'Film greni', amount: 0.35, draw(c, w, h, o) {
      const sc = Math.max(1, Math.max(w, h) / 2400); c.globalCompositeOperation = 'overlay'; c.globalAlpha = Math.min(1, o.amount * 0.55 * Math.min(1, Math.sqrt(Math.max(w, h) / 2000)));
      c.scale(sc, sc); c.fillStyle = c.createPattern(grain(), 'repeat'); c.fillRect(0, 0, w / sc + 1, h / sc + 1);
    }},
  ];
  const fxById = Object.fromEntries(fx.map(f => [f.id, f]));
  const fxIndex = Object.fromEntries(fx.map((f, i) => [f.id, i]));

  // ---------- logo / yazı / simge katmanı
  const glyphs = [
    { id: 'star', name: 'Yıldız', d: 'M12 2l2.9 6.9 7.1.6-5.4 4.7 1.6 7-6.2-3.8-6.2 3.8 1.6-7L2 9.5l7.1-.6z' },
    { id: 'sparkle', name: 'Parıltı', d: 'M12 1c.7 5.6 3.4 8.3 11 11-7.6 2.7-10.3 5.4-11 11-.7-5.6-3.4-8.3-11-11 7.6-2.7 10.3-5.4 11-11z' },
    { id: 'heart', name: 'Kalp', d: 'M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.2 5.2 3 1.6-1.8 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z' },
    { id: 'moon', name: 'Ay', d: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z' },
    { id: 'bolt', name: 'Şimşek', d: 'M13 2L4 14h7l-1 8 9-12h-7z' },
    { id: 'circle', name: 'Daire', d: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z' },
    { id: 'ring', name: 'Halka', d: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM12 6.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11z', evenodd: true },
    { id: 'tri', name: 'Üçgen', d: 'M12 3l10 18H2z' },
    { id: 'hex', name: 'Altıgen', d: 'M12 2l8.7 5v10L12 22l-8.7-5V7z' },
    { id: 'plus', name: 'Artı', d: 'M10 2h4v8h8v4h-8v8h-4v-8H2v-4h8z' },
    { id: 'drop', name: 'Damla', d: 'M12 2s7 7.6 7 12.5A7 7 0 0 1 5 14.5C5 9.6 12 2 12 2z' },
    { id: 'leaf', name: 'Yaprak', d: 'M20 3C9 3 4 8.5 4 15c0 2 .6 3.7 1.4 5L4 21.5 5.5 23l1.6-1.5c1.4.9 3 1.5 4.9 1.5C18 23 21 15 20 3z' },
  ];
  const glyphById = Object.fromEntries(glyphs.map(g => [g.id, g]));
  const pathCache = {};
  const glyphPath = id => pathCache[id] || (pathCache[id] = new Path2D((glyphById[id] || glyphs[0]).d));

  const FONTS = {
    sf: '-apple-system, "SF Pro Display", BlinkMacSystemFont, system-ui, sans-serif',
    rounded: 'ui-rounded, "SF Pro Rounded", -apple-system, system-ui, sans-serif',
    serif: 'ui-serif, "New York", Georgia, serif',
    mono: 'ui-monospace, "SF Mono", Menlo, monospace',
  };

  const tintCache = new Map();
  function tinted(img, dw, dh, mode, color) {
    if (!mode || mode === 'orig') return img;
    const key = `${img._fid}|${dw}|${dh}|${mode}|${color}`;
    if (tintCache.has(key)) return tintCache.get(key);
    const t = mk(dw, dh), x = t.getContext('2d'); x.drawImage(img, 0, 0, dw, dh);
    x.globalCompositeOperation = 'source-in'; x.fillStyle = mode === 'white' ? '#fff' : mode === 'black' ? '#000' : color; x.fillRect(0, 0, dw, dh);
    if (tintCache.size > 40) tintCache.delete(tintCache.keys().next().value);
    tintCache.set(key, t); return t;
  }

  // Düz zemini (köşe rengini) şeffaflaştırır; siyah/beyaz kutulu JPG logolar için
  const keyCache = new Map();
  function keyed(img) {
    if (keyCache.has(img._fid)) return keyCache.get(img._fid);
    const iw = img.naturalWidth || img.width || 512, ih = img.naturalHeight || img.height || 512, k = Math.min(1, 2048 / Math.max(iw, ih));
    const t = mk(iw * k, ih * k), x = t.getContext('2d'); x.drawImage(img, 0, 0, t.width, t.height);
    const id = x.getImageData(0, 0, t.width, t.height), d = id.data, W = t.width, H = t.height;
    const at = (i, j) => (j * W + i) * 4, cs = [at(0, 0), at(W - 1, 0), at(0, H - 1), at(W - 1, H - 1)];
    const key = [0, 1, 2].map(ch => cs.reduce((a, o) => a + d[o + ch], 0) / 4);
    for (let o = 0; o < d.length; o += 4) {
      const dist = Math.hypot(d[o] - key[0], d[o + 1] - key[1], d[o + 2] - key[2]);
      const a = Math.max(0, Math.min(1, (dist - 28) / 60));
      d[o + 3] = d[o + 3] * a;
    }
    x.putImageData(id, 0, 0); t._fid = img._fid + 'k';
    if (keyCache.size > 20) keyCache.delete(keyCache.keys().next().value);
    keyCache.set(img._fid, t); return t;
  }

  // frame: öğelerin konumlandığı görünen ekran alanı (kare iPad çıktısında ortadaki ekran)
  function drawElement(c, w, h, el, frame) {
    const fr = frame || { x: 0, y: 0, w, h };
    const m = Math.min(fr.w, fr.h), S = el.size * m; let bw = S, bh = S;
    c.save(); c.translate(fr.x + el.x * fr.w, fr.y + el.y * fr.h); c.rotate((el.rot || 0) * Math.PI / 180); c.globalAlpha = el.opacity ?? 1;
    if (el.shadow) { c.shadowColor = 'rgba(0,0,0,.38)'; c.shadowBlur = S * 0.14; c.shadowOffsetY = S * 0.035; }
    if (el.type === 'image') {
      let img = el.img;
      if (img && (img.complete && (img.naturalWidth || img.width))) {
        if (el.knock) img = keyed(img);
        const iw = img.naturalWidth || img.width || 512, ih = img.naturalHeight || img.height || 512, k = S / Math.max(iw, ih);
        bw = iw * k; bh = ih * k;
        c.drawImage(tinted(img, Math.max(1, Math.round(bw)), Math.max(1, Math.round(bh)), el.tint, el.color), -bw / 2, -bh / 2, bw, bh);
      }
    } else if (el.type === 'text') {
      const fs = S * 0.5, lines = String(el.text || '').split('\n'), lh = fs * 1.12;
      c.font = `${el.weight || 600} ${fs}px ${FONTS[el.font] || FONTS.sf}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = el.color || '#fff';
      lines.forEach((ln, i) => c.fillText(ln, 0, (i - (lines.length - 1) / 2) * lh));
      bw = Math.max(fs * 0.3, ...lines.map(l => c.measureText(l).width)); bh = lh * lines.length;
    } else if (el.type === 'glyph') {
      const k = S / 24; c.scale(k, k); c.translate(-12, -12); c.fillStyle = el.color || '#fff';
      c.fill(glyphPath(el.glyph), (glyphById[el.glyph] || {}).evenodd ? 'evenodd' : 'nonzero');
    }
    c.restore(); return { w: bw, h: bh };
  }

  // ---------- tam tasarımı çiz
  function palFor(pi, seed) {
    const p = (F.palettes[pi] || F.palettes[0]).c.slice(), r = mulberry32(seed ^ 0x9e3779b9);
    for (let i = p.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    return p;
  }
  function render(c, w, h, d, opts = {}) {
    const g = genById[d.bg.gen] || gens[0], seed = d.bg.seed >>> 0;
    const r = mulberry32((Math.imul(seed, 2654435761) ^ hash(g.id)) >>> 0), nz = makeNoise(mulberry32(seed + 17));
    c.save(); g.draw(c, w, h, r, palFor(d.bg.pal, seed), nz); c.restore();
    const list = (d.fx || []).filter(o => fxById[o.id]).sort((a, b) => fxIndex[a.id] - fxIndex[b.id]);
    for (const o of list) {
      const def = fxById[o.id]; c.save();
      def.draw(c, w, h, { amount: o.amount ?? def.amount, color: o.color || def.color, seed }); c.restore();
    }
    if (opts.els && d.els) for (const el of d.els) drawElement(c, w, h, el, opts.frame);
  }

  Object.assign(F, { mulberry32, hash, rgba, mix, lum, gens, genById, fx, fxById, glyphs, glyphById, glyphPath, FONTS, drawElement, render });
})();
