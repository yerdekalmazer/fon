// Arayüz: cihaz seçimi, katman düzenleme, kütüphane, önizleme ve dışa aktarma.
(function () {
  'use strict';
  const F = window.Fon;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const clone = o => JSON.parse(JSON.stringify(o));
  const isTouch = matchMedia('(pointer: coarse)').matches;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };

  const NATIVE = !!(window.FonNative && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.fon);
  const CATS = (NATIVE ? ['thismac'] : []).concat(['iphone', 'ipad', 'mac', 'watch', 'tv', 'custom']);
  const CAT_LABEL = { thismac: 'Bu Mac', iphone: 'iPhone', ipad: 'iPad', mac: 'Mac', watch: 'Watch', tv: 'TV', custom: 'Özel' };
  const DEF_MODEL = { iphone: 'ip17pm', ipad: 'ipp13', mac: 'mbp14', watch: 'wu3', tv: 'tv4k' };
  function setThisMac(screens) {
    F.devices.thismac = { label: 'Bu Mac', kind: 'laptop', models: screens.map(sc => ({
      id: 'scr' + sc.index, screen: sc.index, w: sc.w, h: sc.h, notch: sc.notch, desk: !sc.builtin,
      name: `${sc.name}${screens.length > 1 && sc.main ? ' (ana ekran)' : ''}`,
    })) };
    DEF_MODEL.thismac = 'scr' + ((screens.find(sc => sc.main) || screens[0] || { index: 0 }).index);
  }
  if (NATIVE) setThisMac(window.FonNative.screens || []);
  const APPLE = '';

  // ---------- durum
  const saved = store.get('fon:state', {});
  const state = {
    cat: NATIVE ? 'thismac' : 'iphone', modelBy: { ...DEF_MODEL }, custom: { w: 1920, h: 1080 },
    bg: { gen: 'fluid', pal: 13, seed: 4821 }, fx: [{ id: 'grain', amount: 0.3 }], els: [],
    lock: true, square: true, fmt: 'png', tab: 'bg', fGen: 'all', fPal: -1,
  };
  for (const k of Object.keys(state)) if (saved[k] !== undefined) state[k] = saved[k];
  state.modelBy = { ...DEF_MODEL, ...(saved.modelBy || {}) };
  if (!CATS.includes(state.cat)) state.cat = CATS[0];
  if (NATIVE && !F.devices.thismac.models.some(m => m.id === state.modelBy.thismac)) state.modelBy.thismac = DEF_MODEL.thismac;
  state.sel = null;

  // paylaşılan bağlantı
  try {
    const m = location.hash.match(/^#d=(.+)$/);
    if (m) {
      const d = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1])))));
      if (d.b) state.bg = d.b;
      if (d.f) state.fx = d.f;
      if (d.e) state.els = state.els.filter(e => e.type === 'image').concat(d.e);
      if (d.c && CATS.includes(d.c)) { state.cat = d.c; if (d.m) state.modelBy[d.c] = d.m; }
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch (e) { /* bozuk bağlantı: varsayılanla devam */ }
  if (!F.genById[state.bg.gen]) state.bg.gen = 'mesh';
  if (!F.palettes[state.bg.pal]) state.bg.pal = 0;
  state.fx = (state.fx || []).filter(o => F.fxById[o.id]);
  state.els.forEach(el => { el.id = el.id || uid(); });

  function hydrateImage(el) {
    if (el.type !== 'image' || !el.src || el.img) return;
    const im = new Image(); im._fid = uid(); im.onload = () => { renderPreview(); keepInside(el); syncEditXY(el); schedule(); buildElList(); }; im.src = el.src; el.img = im;
  }
  state.els.forEach(hydrateImage);

  const stripEl = el => { const o = { ...el }; delete o.img; return o; };
  let saveT = 0;
  function saveSoon() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      const base = { cat: state.cat, modelBy: state.modelBy, custom: state.custom, bg: state.bg, fx: state.fx, lock: state.lock, square: state.square, fmt: state.fmt, tab: state.tab, fGen: state.fGen, fPal: state.fPal };
      if (!store.set('fon:state', { ...base, els: state.els.map(stripEl) }))
        store.set('fon:state', { ...base, els: state.els.filter(e => e.type !== 'image').map(stripEl) });
    }, 400);
  }

  // ---------- cihaz
  function curDev() {
    if (state.cat === 'custom') return { id: 'custom', name: 'Özel boyut', w: state.custom.w, h: state.custom.h, kind: 'custom' };
    const c = F.devices[state.cat], m = c.models.find(x => x.id === state.modelBy[state.cat]) || c.models[0];
    let kind = c.kind; if (kind === 'laptop' && m.desk) kind = 'desktop';
    return { ...m, kind };
  }
  const devOf = (cat) => { const c = F.devices[cat], m = c.models.find(x => x.id === state.modelBy[cat]) || c.models[0]; return { ...m, kind: m.desk ? 'desktop' : c.kind }; };
  function outSize(dev) {
    if (dev.kind === 'tablet' && state.square) { const s = Math.max(dev.w, dev.h); return { w: s, h: s }; }
    return { w: dev.w, h: dev.h };
  }

  // ---------- kütüphane verisi
  const BG_ITEMS = (() => {
    const out = [];
    F.gens.forEach(g => F.palettes.forEach((p, pi) => out.push({ bg: { gen: g.id, pal: pi, seed: F.hash(g.id + '/' + pi) % 99991 }, fx: [], name: `${g.name} · ${p.name}` })));
    const r = F.mulberry32(42);
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  })();
  const FX_POOL = ['grain', 'grain', 'grain', 'vignette', 'vignette', 'glass', 'dots', 'grid', 'halftone', 'leak', 'stars', 'tint', 'dim', 'frame', 'hatch', 'scan', 'blur', 'pixel'];
  function makeCombo(i) {
    const r = F.mulberry32(9000 + i * 7919), g = F.gens[Math.floor(r() * F.gens.length)], pal = Math.floor(r() * F.palettes.length);
    const seed = Math.floor(r() * 99991), fx = [], used = new Set(), n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n + 2 && fx.length < n; k++) {
      const id = FX_POOL[Math.floor(r() * FX_POOL.length)];
      if (used.has(id) || ((id === 'blur' || id === 'pixel') && (used.has('blur') || used.has('pixel')))) continue;
      used.add(id);
      const def = F.fxById[id], soft = id === 'blur' || id === 'pixel';
      const o = { id, amount: +(soft ? 0.08 + r() * 0.22 : 0.2 + r() * 0.6).toFixed(2) };
      if (def.color) o.color = r() < 0.5 ? def.color : F.palettes[pal].c[Math.floor(r() * 5)];
      fx.push(o);
    }
    return { bg: { gen: g.id, pal, seed }, fx, name: `Kombin ${String(i + 1).padStart(3, '0')} · ${g.name}` };
  }
  const COMBOS = Array.from({ length: 360 }, (_, i) => makeCombo(i));
  const favs = () => store.get('fon:favs', []);

  // ---------- üst bar
  function buildHeader() {
    $('#catSeg').innerHTML = CATS.map(c => `<button data-cat="${c}" class="${c === state.cat ? 'on' : ''}">${CAT_LABEL[c]}</button>`).join('');
    const sel = $('#modelSel');
    if (state.cat === 'custom') { sel.hidden = true; }
    else {
      sel.hidden = false;
      sel.innerHTML = F.devices[state.cat].models.map(m => `<option value="${m.id}" ${m.id === state.modelBy[state.cat] ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
    }
    const dev = curDev(), o = outSize(dev);
    $('#resLbl').textContent = `${o.w} × ${o.h} px`;
    $('#devInfo').textContent = `${dev.name} · ${o.w} × ${o.h} px${o.w !== dev.w || o.h !== dev.h ? ' (döndürmeye uygun kare)' : ''}`;
  }
  $('#catSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]'); if (!b) return;
    state.cat = b.dataset.cat; applyDevice();
  });
  $('#modelSel').addEventListener('change', e => { state.modelBy[state.cat] = e.target.value; applyDevice(); });

  function applyDevice() {
    buildHeader(); buildOutSec(); layout(); clampAll(); refreshThumbAspect(); saveSoon();
  }

  // ---------- sol panel: arkaplan
  function swatch(p) { const c = p.c; return `linear-gradient(90deg, ${c[0]} 0 20%, ${c[1]} 20% 40%, ${c[2]} 40% 60%, ${c[3]} 60% 80%, ${c[4]} 80%)`; }
  function buildBgSec() {
    const g = F.genById[state.bg.gen], p = F.palettes[state.bg.pal];
    $('#bgSec').innerHTML = `
      <div class="sec-h"><h3>Arkaplan <small>${esc(g.name)} · ${esc(p.name)}</small></h3><button class="mini" id="reseed" title="Aynı stil ve paletle yeni varyasyon">Yeniden üret</button></div>
      <div class="ctl"><label>Stil</label><select class="sel" id="genSel">${F.gens.map(x => `<option value="${x.id}" ${x.id === g.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="pal-grid">${F.palettes.map((x, i) => `<button class="pal ${i === state.bg.pal ? 'on' : ''}" data-pal="${i}" title="${esc(x.name)}" style="background:${swatch(x)}"></button>`).join('')}</div>`;
  }
  $('#bgSec').addEventListener('click', e => {
    if (e.target.closest('#reseed')) { state.bg = { ...state.bg, seed: Math.floor(Math.random() * 99991) }; changedBg(); }
    const pb = e.target.closest('[data-pal]'); if (pb) { state.bg = { ...state.bg, pal: +pb.dataset.pal }; changedBg(); }
  });
  $('#bgSec').addEventListener('change', e => { if (e.target.id === 'genSel') { state.bg = { ...state.bg, gen: e.target.value }; changedBg(); } });
  function changedBg() { buildBgSec(); schedule(); markActive(); saveSoon(); }

  // ---------- sol panel: efektler
  function buildFxSec() {
    const on = Object.fromEntries(state.fx.map(o => [o.id, o]));
    $('#fxSec').innerHTML = `
      <div class="sec-h"><h3>Efekt katmanları <small>${state.fx.length} açık</small></h3><button class="mini" id="fxClear">Temizle</button></div>
      ${F.fx.map(d => { const o = on[d.id]; return `
        <div class="fx ${o ? 'on' : ''}" data-fx="${d.id}">
          <div class="fx-top"><label class="sw"><input type="checkbox" data-act="toggle" ${o ? 'checked' : ''} aria-label="${esc(d.name)}"><span></span></label><span class="nm">${esc(d.name)}</span></div>
          <div class="fx-body"><input type="range" min="0.02" max="1" step="0.01" value="${o ? o.amount : d.amount}" data-act="amount" aria-label="${esc(d.name)} yoğunluğu">
            ${d.color ? `<input type="color" class="clr" value="${o && o.color ? o.color : d.color}" data-act="color" aria-label="Renk">` : ''}</div>
        </div>`; }).join('')}`;
  }
  const fxEl = $('#fxSec');
  fxEl.addEventListener('change', e => {
    const row = e.target.closest('[data-fx]'); if (!row || e.target.dataset.act !== 'toggle') return;
    const id = row.dataset.fx, d = F.fxById[id];
    if (e.target.checked) state.fx = state.fx.concat({ id, amount: d.amount, ...(d.color ? { color: d.color } : {}) });
    else state.fx = state.fx.filter(o => o.id !== id);
    buildFxSec(); schedule(); markActive(); saveSoon();
  });
  fxEl.addEventListener('input', e => {
    const row = e.target.closest('[data-fx]'); if (!row) return;
    const o = state.fx.find(x => x.id === row.dataset.fx); if (!o) return;
    if (e.target.dataset.act === 'amount') o.amount = +e.target.value;
    if (e.target.dataset.act === 'color') o.color = e.target.value;
    state.fx = state.fx.slice(); schedule(); saveSoon();
  });
  fxEl.addEventListener('click', e => { if (e.target.closest('#fxClear')) { state.fx = []; buildFxSec(); schedule(); markActive(); saveSoon(); } });

  // ---------- sol panel: logo, yazı, simge
  const glyphSvg = id => `<svg viewBox="0 0 24 24"><path d="${F.glyphById[id].d}" ${F.glyphById[id].evenodd ? 'fill-rule="evenodd"' : ''}/></svg>`;
  function buildElSec() {
    $('#elSec').innerHTML = `
      <div class="sec-h"><h3>Logo ve yazı</h3><small class="hint" style="margin:0">önizlemede sürükle</small></div>
      <div class="add-row">
        <button data-add="image">Logo yükle</button>
        <button data-add="text">Yazı ekle</button>
        <button data-add="glyph">Simge ekle</button>
        <button data-add="apple" title="Apple cihazlarda görünür">Apple logosu</button>
      </div>
      <div class="glyph-pop" id="glyphPop" hidden>${F.glyphs.map(g => `<button data-glyph="${g.id}" title="${esc(g.name)}">${glyphSvg(g.id)}</button>`).join('')}</div>
      <ul class="el-list" id="elList"></ul>
      <div class="el-edit" id="elEdit"></div>`;
    buildElList(); buildElEdit();
  }
  function elLabel(el) {
    if (el.type === 'image') return el.name || 'Logo';
    if (el.type === 'glyph') return (F.glyphById[el.glyph] || {}).name || 'Simge';
    if (el.text === APPLE) return 'Apple logosu';
    return (el.text || 'Yazı').split('\n')[0];
  }
  function elIcon(el) {
    if (el.type === 'image') return el.src ? `<img src="${el.src}" alt="">` : '';
    if (el.type === 'glyph') return glyphSvg(el.glyph);
    return el.text === APPLE ? APPLE : 'Aa';
  }
  function buildElList() {
    const ul = $('#elList'); if (!ul) return;
    ul.innerHTML = state.els.slice().reverse().map(el => `
      <li data-id="${el.id}" class="${el.id === state.sel ? 'on' : ''}">
        <span class="ic">${elIcon(el)}</span><span class="nm">${esc(elLabel(el))}</span>
        <button data-act="up" title="Öne al" aria-label="Öne al">↑</button>
        <button data-act="down" title="Arkaya al" aria-label="Arkaya al">↓</button>
        <button data-act="dup" title="Çoğalt" aria-label="Çoğalt">⧉</button>
        <button data-act="del" title="Sil" aria-label="Sil">✕</button>
      </li>`).join('');
  }
  const selEl = () => state.els.find(e => e.id === state.sel);
  function buildElEdit() {
    const box = $('#elEdit'); if (!box) return;
    const el = selEl(); if (!el) { box.innerHTML = ''; return; }
    const range = (k, label, min, max, step) => `<div class="ctl"><label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}" data-k="${k}" value="${el[k]}"></div>`;
    let top = '';
    if (el.type === 'image') {
      top = `<div class="ctl"><label>Renk</label><div class="row" style="margin:0">
        <div class="seg">${[['orig', 'Orijinal'], ['white', 'Beyaz'], ['black', 'Siyah'], ['custom', 'Renk']].map(([v, l]) => `<button data-tint="${v}" class="${(el.tint || 'orig') === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${el.tint === 'custom' ? `<input type="color" class="clr" data-k="color" value="${el.color}">` : ''}</div></div>`;
    } else if (el.type === 'text') {
      top = `<textarea class="txt" rows="2" data-k="text" aria-label="Yazı">${esc(el.text)}</textarea>
        <div class="ctl"><label>Yazı tipi</label><select class="sel" data-k="font">${[['sf', 'SF Pro'], ['rounded', 'SF Rounded'], ['serif', 'New York'], ['mono', 'SF Mono']].map(([v, l]) => `<option value="${v}" ${el.font === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="ctl"><label>Kalınlık</label><select class="sel" data-k="weight">${[[300, 'İnce'], [400, 'Normal'], [600, 'Yarı kalın'], [700, 'Kalın'], [900, 'Siyah']].map(([v, l]) => `<option value="${v}" ${+el.weight === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="ctl"><label>Renk</label><input type="color" class="clr" data-k="color" value="${el.color}"></div>`;
    } else {
      top = `<div class="ctl"><label>Renk</label><input type="color" class="clr" data-k="color" value="${el.color}"></div>`;
    }
    box.innerHTML = `${top}
      ${range('size', 'Boyut', 0.02, 1.4, 0.005)}
      ${range('rot', 'Döndür', -180, 180, 1)}
      ${range('opacity', 'Opaklık', 0, 1, 0.01)}
      ${range('x', 'Yatay', 0, 1, 0.001)}
      ${range('y', 'Dikey', 0, 1, 0.001)}
      <div class="row"><span class="grow" style="color:var(--mute);font-size:12px">Hızlı konum</span>
        <div class="pos-grid">${[0.2, 0.5, 0.8].map(y => [0.25, 0.5, 0.75].map(x => `<button data-pos="${x},${y}" aria-label="Konum"></button>`).join('')).join('')}</div></div>
      ${el.type === 'image' ? `<div class="row"><label class="sw"><input type="checkbox" data-k="knock" ${el.knock ? 'checked' : ''} aria-label="Zemini sil"><span></span></label><span class="grow">Düz zemini sil</span></div><p class="hint" style="margin-top:-4px">Siyah ya da beyaz kutulu logolarda köşe rengini şeffaf yapar.</p>` : ''}
      <div class="row"><label class="sw"><input type="checkbox" data-k="shadow" ${el.shadow ? 'checked' : ''} aria-label="Gölge"><span></span></label><span>Gölge</span></div>`;
  }
  function syncEditXY(el) { const b = $('#elEdit'); if (!b) return; const x = $('[data-k=x]', b), y = $('[data-k=y]', b); if (x) x.value = el.x; if (y) y.value = el.y; }

  function defaultY() { const k = curDev().kind; return k === 'phone' ? 0.6 : 0.5; }
  function addEl(el) {
    el = { id: uid(), x: 0.5, y: defaultY(), rot: 0, opacity: 1, shadow: false, ...el };
    state.els.push(el); state.sel = el.id; buildElList(); buildElEdit(); schedule(); saveSoon();
  }
  $('#elSec').addEventListener('click', e => {
    const add = e.target.closest('[data-add]');
    if (add) {
      const t = add.dataset.add;
      if (t === 'image') $('#fileIn').click();
      if (t === 'text') addEl({ type: 'text', text: 'Merhaba', font: 'sf', weight: 700, size: 0.22, color: '#ffffff' });
      if (t === 'apple') addEl({ type: 'text', text: APPLE, font: 'sf', weight: 400, size: 0.7, color: '#ffffff' });
      if (t === 'glyph') { const p = $('#glyphPop'); p.hidden = !p.hidden; }
      return;
    }
    const gb = e.target.closest('[data-glyph]');
    if (gb) { $('#glyphPop').hidden = true; addEl({ type: 'glyph', glyph: gb.dataset.glyph, size: 0.3, color: '#ffffff' }); return; }
    const li = e.target.closest('#elList li');
    if (li) {
      const id = li.dataset.id, i = state.els.findIndex(x => x.id === id), act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'del') { state.els.splice(i, 1); if (state.sel === id) state.sel = null; }
      else if (act === 'up' && i < state.els.length - 1) [state.els[i], state.els[i + 1]] = [state.els[i + 1], state.els[i]];
      else if (act === 'down' && i > 0) [state.els[i], state.els[i - 1]] = [state.els[i - 1], state.els[i]];
      else if (act === 'dup') { const c = { ...state.els[i], id: uid(), x: clamp(state.els[i].x + 0.04, 0, 1), y: clamp(state.els[i].y + 0.04, 0, 1) }; state.els.splice(i + 1, 0, c); state.sel = c.id; }
      else state.sel = id;
      buildElList(); buildElEdit(); schedule(); saveSoon(); return;
    }
    const tb = e.target.closest('[data-tint]');
    if (tb) { const el = selEl(); el.tint = tb.dataset.tint; if (!el.color) el.color = '#ffffff'; buildElEdit(); schedule(); saveSoon(); return; }
    const pb = e.target.closest('[data-pos]');
    if (pb) { const el = selEl(); const [x, y] = pb.dataset.pos.split(',').map(Number); el.x = x; el.y = y; keepInside(el); syncEditXY(el); schedule(); saveSoon(); }
  });
  function onElInput(e) {
    const k = e.target.dataset.k, el = selEl(); if (!k || !el) return;
    const t = e.target;
    el[k] = t.type === 'checkbox' ? t.checked : t.type === 'range' ? +t.value : k === 'weight' ? +t.value : t.value;
    if (k === 'text') buildElList();
    renderPreview(); keepInside(el); syncEditXY(el);
    schedule(); saveSoon();
  }
  $('#elSec').addEventListener('input', onElInput);
  $('#elSec').addEventListener('change', onElInput);

  $('#fileIn').addEventListener('change', e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    if (f.size > 8 * 1024 * 1024) { toast('Dosya 8 MB’tan büyük, daha küçük bir logo dene.'); return; }
    const rd = new FileReader();
    rd.onload = () => {
      const el = { type: 'image', src: rd.result, name: f.name.replace(/\.[^.]+$/, ''), size: 0.4, tint: 'orig', color: '#ffffff' };
      addEl(el); hydrateImage(state.els[state.els.length - 1]);
      if (f.size > 1.5 * 1024 * 1024) toast('Büyük logo: bu oturumda çalışır ama tarayıcıya kaydedilmeyebilir.');
    };
    rd.readAsDataURL(f);
  });

  // ---------- sol panel: çıktı
  function buildOutSec() {
    const dev = curDev();
    $('#outSec').innerHTML = `
      <div class="sec-h"><h3>Çıktı</h3></div>
      ${state.cat === 'custom' ? `<div class="row"><input class="num" type="number" min="64" max="8192" id="cw" value="${state.custom.w}" aria-label="Genişlik"><span>×</span><input class="num" type="number" min="64" max="8192" id="ch" value="${state.custom.h}" aria-label="Yükseklik"></div>` : ''}
      ${dev.kind === 'tablet' ? `<div class="row"><label class="sw"><input type="checkbox" id="sq" ${state.square ? 'checked' : ''} aria-label="Kare"><span></span></label><span class="grow">Döndürmeye uygun kare</span></div><p class="hint">iPad yatay çevrildiğinde de kenar boşluğu kalmaz.</p>` : ''}
      <div class="row"><span class="grow">Biçim</span><div class="seg" id="fmtSeg"><button data-fmt="png" class="${state.fmt === 'png' ? 'on' : ''}">PNG</button><button data-fmt="jpg" class="${state.fmt === 'jpg' ? 'on' : ''}">JPEG</button></div></div>
      <button class="btn primary block" id="btnDl2">${esc(dev.name)} için indir</button>
      <button class="btn ghost block" id="btnSet">Ekosistem seti (iPhone, iPad, Mac, Watch)</button>
      ${NATIVE ? `<div class="sec-h" style="margin-top:18px"><h3>iPhone'a gönder <small>${esc(devOf('iphone').name)}</small></h3></div>
      <button class="btn ghost block" data-phone="airdrop">AirDrop ile gönder</button>
      <button class="btn ghost block" data-phone="icloud">iCloud Drive'a kaydet</button>
      <p class="hint">AirDrop: telefonda görseli aç, Paylaş → Duvar Kağıdı Olarak Kullan.<br>iCloud: her seferinde <b>iCloud Drive/Fon/Fon-iPhone.png</b> güncellenir. iPhone'da bir kez Kestirmeler'de “Dosya Al” (bu dosya) + “Duvar Kağıdını Ayarla” kestirmesi kurarsan sonrası tek dokunuş.</p>` : ''}
      <p class="hint">Set, her ailede en son seçtiğin modeli kullanır: ${esc(devOf('iphone').name)}, ${esc(devOf('ipad').name)}, ${esc(devOf('mac').name)}, ${esc(devOf('watch').name)}.</p>`;
  }
  $('#outSec').addEventListener('change', e => {
    if (e.target.id === 'sq') { state.square = e.target.checked; applyDevice(); }
    if (e.target.id === 'cw' || e.target.id === 'ch') {
      const v = clamp(Math.round(+e.target.value || 0), 64, 8192); e.target.value = v;
      state.custom[e.target.id === 'cw' ? 'w' : 'h'] = v; buildHeader(); layout(); refreshThumbAspect(); saveSoon();
    }
  });
  $('#outSec').addEventListener('click', e => {
    const fb = e.target.closest('[data-fmt]'); if (fb) { state.fmt = fb.dataset.fmt; buildOutSec(); saveSoon(); }
    if (e.target.closest('#btnDl2')) exportCurrent();
    if (e.target.closest('#btnSet')) exportSet();
    const ph = e.target.closest('[data-phone]'); if (ph) sendToPhone(ph.dataset.phone);
  });

  // ---------- sahne ve cihaz çerçevesi
  const KIND = {
    phone:   { bz: 0.045, rad: 0.135, extra: 0 },
    tablet:  { bz: 0.04,  rad: 0.035, extra: 0 },
    laptop:  { bz: 0.022, rad: 0.018, extra: 0.035, wide: 1.14 },
    desktop: { bz: 0.025, rad: 0.004, extra: 0.27 },
    watch:   { bz: 0.09,  rad: 0.24,  extra: 0 },
    tv:      { bz: 0.012, rad: 0.004, extra: 0.06 },
    custom:  { bz: 0,     rad: 0.012, extra: 0 },
  };
  let view = null; // önizleme eşlemesi
  function layout() {
    const dev = curDev(), K = KIND[dev.kind], stage = $('#stage'), devEl = $('#dev');
    const availW = stage.clientWidth - 48, availH = stage.clientHeight - $('.stagebar').offsetHeight - 68;
    const ar = dev.h / dev.w;
    const extra = K.extra + (dev.home ? 0.4 : 0);
    let sw = Math.min(availW / ((K.wide || 1) + 2 * K.bz), availH / (ar + 2 * K.bz + extra));
    if (dev.kind === 'watch') sw = Math.min(sw, 300);
    sw = Math.max(80, Math.floor(sw));
    const sh = Math.round(sw * ar), bz = Math.round(sw * K.bz), rad = sw * K.rad;
    devEl.dataset.kind = dev.kind;
    if (dev.home) devEl.dataset.home = ''; else delete devEl.dataset.home;
    const bezel = $('#bezel'), screen = $('#screen');
    const chin = dev.kind === 'desktop' ? Math.round(sw * 0.075) : dev.kind === 'phone' && dev.home ? Math.round(sw * 0.2) : 0;
    bezel.style.padding = `${dev.home ? Math.round(sw * 0.2) : bz}px ${bz}px ${bz + chin}px`;
    bezel.style.borderRadius = `${rad + bz}px ${rad + bz}px ${dev.kind === 'laptop' ? Math.round(bz * 0.6) : rad + bz}px ${dev.kind === 'laptop' ? Math.round(bz * 0.6) : rad + bz}px`;
    if (dev.kind === 'desktop') bezel.style.background = dev.id === 'imac24' ? '#d4d9e2' : '#0a0a0b';
    else bezel.style.background = '';
    screen.style.width = sw + 'px'; screen.style.height = sh + 'px';
    screen.style.borderRadius = dev.kind === 'laptop' ? `${rad}px ${rad}px 0 0` : dev.home ? '2px' : `${rad}px`;
    const base = $('.base', devEl), stand = $('.stand', devEl);
    base.style.width = Math.round(sw * 1.14) + 'px'; base.style.height = Math.round(sw * 0.03) + 'px';
    stand.style.width = Math.round(sw * (dev.kind === 'tv' ? 0.3 : 0.22)) + 'px'; stand.style.height = Math.round(sw * (dev.kind === 'tv' ? 0.03 : 0.17)) + 'px';

    const dpr = Math.min(window.devicePixelRatio || 1, 3), cv = $('#preview');
    const pw = Math.max(1, Math.min(dev.w, Math.round(sw * dpr))), ph = Math.max(1, Math.round(pw * ar));
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    buildChrome(dev);
    renderPreview();
  }
  new ResizeObserver(() => layout()).observe($('#stage'));

  const IC = {
    flash: '<svg viewBox="0 0 24 24"><path d="M8 2h8v4l-2 3v13h-4V9L8 6z"/></svg>',
    cam: '<svg viewBox="0 0 24 24"><path d="M9 4h6l1.5 2H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.5zM12 9a4 4 0 1 0 0 8a4 4 0 1 0 0-8z"/></svg>',
    status: '<svg viewBox="0 0 64 14"><rect x="0" y="9" width="3" height="5" rx="1"/><rect x="5" y="6" width="3" height="8" rx="1"/><rect x="10" y="3" width="3" height="11" rx="1"/><rect x="15" y="0" width="3" height="14" rx="1"/><path d="M31 4a11 11 0 0 1 8 3l-1.6 1.7a8.6 8.6 0 0 0-12.8 0L23 7a11 11 0 0 1 8-3zm0 4.6a6 6 0 0 1 4.3 1.8L31 14.6l-4.3-4.2A6 6 0 0 1 31 8.6z"/><rect x="42" y="1" width="20" height="12" rx="3.5" fill="none" stroke="#fff" stroke-width="1.4"/><rect x="44" y="3" width="14" height="8" rx="2"/></svg>',
  };
  const DOCK = ['#0a84ff', '#30d158', '#ff9f0a', '#ff453a', '#bf5af2', '#64d2ff', '#ffd60a', '#8e8e93', '#ff375f'];
  function buildChrome(dev) {
    const ch = $('#chrome'); $('#btnLock').setAttribute('aria-pressed', String(state.lock));
    const now = new Date(), date = now.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
    const time = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const hw = dev.kind === 'phone' ? (dev.island ? '<div class="c-island"></div>' : dev.notch ? '<div class="c-notch"></div>' : '') : dev.kind === 'laptop' && dev.notch ? '<div class="c-mnotch"></div>' : '';
    if (!state.lock) { ch.innerHTML = hw; return; }
    let h = hw;
    if (dev.kind === 'phone') h += `<div class="c-status">${IC.status}</div><div class="c-date">${esc(date)}</div><div class="c-time">${esc(time)}</div>${dev.home ? '' : `<div class="c-qa l">${IC.flash}</div><div class="c-qa r">${IC.cam}</div><div class="c-home"></div>`}`;
    else if (dev.kind === 'tablet') h += `<div class="c-tdate">${esc(date)}</div><div class="c-ttime">${esc(time)}</div>`;
    else if (dev.kind === 'laptop' || dev.kind === 'desktop') h = `<div class="c-menu"><b>${APPLE}</b><b>Finder</b><span>Dosya</span><span>Düzen</span><span>Görüntü</span><span>Git</span><span class="r">${esc(date)} ${esc(time)}</span></div>${hw}<div class="c-dock">${DOCK.map(c => `<i style="background:${c}"></i>`).join('')}</div>`;
    else if (dev.kind === 'watch') h += `<div class="c-wtime">${esc(time)}</div>`;
    ch.innerHTML = h;
  }

  // ---------- önizleme
  let baseCache = { key: '', cv: null }, raf = 0, boxes = {};
  function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderPreview(); }); }
  function renderPreview() {
    const dev = curDev(), out = outSize(dev), cv = $('#preview'), pw = cv.width, ph = cv.height, k = pw / dev.w;
    const ow = Math.max(1, Math.round(out.w * k)), oh = Math.max(1, Math.round(out.h * k));
    const key = JSON.stringify([state.bg, state.fx, ow, oh]);
    if (baseCache.key !== key) {
      const b = baseCache.cv || document.createElement('canvas'); b.width = ow; b.height = oh;
      F.render(b.getContext('2d'), ow, oh, { bg: state.bg, fx: state.fx }); baseCache = { key, cv: b };
    }
    const ox = (ow - pw) / 2, oy = (oh - ph) / 2, ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, pw, ph); ctx.drawImage(baseCache.cv, -ox, -oy);
    const fr = { x: ox, y: oy, w: pw, h: ph };
    ctx.save(); ctx.translate(-ox, -oy); boxes = {};
    for (const el of state.els) boxes[el.id] = F.drawElement(ctx, ow, oh, el, fr);
    const s = selEl();
    if (s && boxes[s.id]) {
      const b = boxes[s.id], dpr = pw / cv.clientWidth || 1, pad = 6 * dpr;
      ctx.translate(ox + s.x * pw, oy + s.y * ph); ctx.rotate((s.rot || 0) * Math.PI / 180);
      ctx.setLineDash([5 * dpr, 4 * dpr]); ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.strokeRect(-b.w / 2 - pad, -b.h / 2 - pad, b.w + pad * 2, b.h + pad * 2);
      ctx.lineDashOffset = 4.5 * dpr; ctx.strokeStyle = 'rgba(10,132,255,.95)';
      ctx.strokeRect(-b.w / 2 - pad, -b.h / 2 - pad, b.w + pad * 2, b.h + pad * 2);
    }
    ctx.restore();
    view = { ow, oh, ox, oy, pw, ph };
  }

  // Öğe kutusunu (döndürülmüş hâliyle) görünen ekranın içinde tutar
  function keepInside(el) {
    const b = boxes[el.id];
    if (!b || !view) { el.x = clamp(el.x, 0, 1); el.y = clamp(el.y, 0, 1); return; }
    const a = (el.rot || 0) * Math.PI / 180, ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
    const hw = (b.w * ca + b.h * sa) / 2 / view.pw, hh = (b.w * sa + b.h * ca) / 2 / view.ph;
    el.x = hw >= 0.5 ? 0.5 : clamp(el.x, hw, 1 - hw);
    el.y = hh >= 0.5 ? 0.5 : clamp(el.y, hh, 1 - hh);
  }

  function clampAll() { if (!state.els.length) return; state.els.forEach(keepInside); const s = selEl(); if (s) syncEditXY(s); schedule(); }

  // sürükle-bırak
  let drag = null;
  const cvEl = $('#preview');
  function toDesign(e) {
    const r = cvEl.getBoundingClientRect(), sx = view.pw / r.width;
    return { X: (e.clientX - r.left) * sx, Y: (e.clientY - r.top) * sx };
  }
  function hit(X, Y) {
    for (let i = state.els.length - 1; i >= 0; i--) {
      const el = state.els[i], b = boxes[el.id]; if (!b) continue;
      const a = -(el.rot || 0) * Math.PI / 180, dx = X - el.x * view.pw, dy = Y - el.y * view.ph;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a), pad = 10 * (view.pw / cvEl.clientWidth);
      if (Math.abs(lx) <= b.w / 2 + pad && Math.abs(ly) <= b.h / 2 + pad) return el;
    }
    return null;
  }
  cvEl.addEventListener('pointerdown', e => {
    if (!view) return;
    const { X, Y } = toDesign(e), el = hit(X, Y);
    const prev = state.sel; state.sel = el ? el.id : null;
    if (prev !== state.sel) { buildElList(); buildElEdit(); }
    if (el) { drag = { el, dx: X - el.x * view.pw, dy: Y - el.y * view.ph }; cvEl.setPointerCapture(e.pointerId); cvEl.classList.add('dragging'); }
    schedule();
  });
  cvEl.addEventListener('pointermove', e => {
    if (!drag) return;
    const { X, Y } = toDesign(e);
    drag.el.x = (X - drag.dx) / view.pw; drag.el.y = (Y - drag.dy) / view.ph;
    keepInside(drag.el); syncEditXY(drag.el); schedule();
  });
  const endDrag = () => { if (drag) { drag = null; cvEl.classList.remove('dragging'); saveSoon(); } };
  cvEl.addEventListener('pointerup', endDrag); cvEl.addEventListener('pointercancel', endDrag);

  // ---------- kütüphane
  let thumb = { w: 132, h: 286 }; const queue = []; let qRaf = 0;
  const io = new IntersectionObserver(ents => {
    for (const en of ents) if (en.isIntersecting) { io.unobserve(en.target); if (!en.target._done) queue.push(en.target); }
    pump();
  }, { rootMargin: '300px' });
  function pump() {
    if (qRaf) return;
    qRaf = requestAnimationFrame(function step() {
      const t0 = performance.now();
      while (queue.length && performance.now() - t0 < 14) drawThumb(queue.shift());
      qRaf = queue.length ? requestAnimationFrame(step) : 0;
    });
  }
  function drawThumb(tile) {
    if (!tile.isConnected) return;
    const cv = tile.firstElementChild; cv.width = thumb.w; cv.height = thumb.h;
    const it = tile._item; F.render(cv.getContext('2d'), thumb.w, thumb.h, { bg: it.bg, fx: it.fx, els: it.els || [] }, { els: !!it.els });
    tile._done = true;
  }
  function refreshThumbAspect() {
    const dev = curDev(), ar = dev.h / dev.w, key = ar.toFixed(3), grid = $('#grid');
    grid.style.setProperty('--ar', `${dev.w} / ${dev.h}`);
    grid.style.setProperty('--tmin', ar >= 1 ? (ar > 1.6 ? '92px' : '104px') : ar > 0.7 ? '120px' : '150px');
    grid.style.setProperty('--trad', dev.kind === 'phone' ? '14px' : dev.kind === 'watch' ? '22px' : '8px');
    if (thumb.key === key) return;
    const w = ar >= 1 ? 132 : 240; thumb = { w, h: Math.round(w * ar), key };
    queue.length = 0;
    $$('.tile', grid).forEach(t => { t._done = false; io.unobserve(t); io.observe(t); });
  }
  const sameBg = (a, b) => a.gen === b.gen && a.pal === b.pal && a.seed === b.seed;
  function markActive() {
    const fxKey = JSON.stringify(state.fx);
    $$('#grid .tile').forEach(t => {
      const it = t._item, on = sameBg(it.bg, state.bg) && (state.tab === 'bg' || JSON.stringify(it.fx) === fxKey);
      t.classList.toggle('on', on);
    });
  }
  function buildLibHead() {
    $$('#libTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
    const filt = state.tab !== 'fav';
    $('#genChips').hidden = $('#palChips').hidden = !filt;
    $('#genChips').innerHTML = `<button class="chip ${state.fGen === 'all' ? 'on' : ''}" data-gen="all">Tümü</button>` +
      F.gens.map(g => `<button class="chip ${state.fGen === g.id ? 'on' : ''}" data-gen="${g.id}">${esc(g.name)}</button>`).join('');
    $('#palChips').innerHTML = F.palettes.map((p, i) => `<button class="pal ${state.fPal === i ? 'on' : ''}" data-fpal="${i}" title="${esc(p.name)}" style="background:${swatch(p)}"></button>`).join('');
  }
  function buildGrid() {
    const grid = $('#grid'); queue.length = 0; io.disconnect();
    let items = state.tab === 'bg' ? BG_ITEMS : state.tab === 'combo' ? COMBOS : favs();
    if (state.tab !== 'fav') items = items.filter(it => (state.fGen === 'all' || it.bg.gen === state.fGen) && (state.fPal < 0 || it.bg.pal === state.fPal));
    const total = state.tab === 'bg' ? BG_ITEMS.length : state.tab === 'combo' ? COMBOS.length : items.length;
    $('#libCount').textContent = state.tab === 'fav' ? `${items.length} favori` : items.length === total ? `${total} tasarım` : `${items.length} / ${total} tasarım`;
    grid.innerHTML = '';
    if (!items.length) {
      grid.innerHTML = `<div class="empty">${state.tab === 'fav' ? 'Henüz favori yok. Beğendiğin tasarımı önizlemenin altındaki ♡ ile kaydet.' : 'Bu filtreye uyan tasarım yok.'}</div>`; return;
    }
    const frag = document.createDocumentFragment();
    items.forEach((it, i) => {
      const b = document.createElement('button'); b.className = 'tile'; b.type = 'button';
      b.innerHTML = `<canvas></canvas><span class="nm">${esc(it.name)}</span>${state.tab === 'fav' ? `<span class="x" data-del="${i}" aria-label="Favoriden çıkar">✕</span>` : ''}`;
      b._item = it; b.setAttribute('aria-label', it.name); frag.appendChild(b);
    });
    grid.appendChild(frag);
    $$('.tile', grid).forEach(t => io.observe(t));
    markActive();
  }
  $('#libTabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return; state.tab = b.dataset.tab; buildLibHead(); buildGrid(); $('#grid').scrollTop = 0; saveSoon(); });
  $('#genChips').addEventListener('click', e => { const b = e.target.closest('[data-gen]'); if (!b) return; state.fGen = b.dataset.gen; buildLibHead(); buildGrid(); $('#grid').scrollTop = 0; saveSoon(); });
  $('#palChips').addEventListener('click', e => { const b = e.target.closest('[data-fpal]'); if (!b) return; const i = +b.dataset.fpal; state.fPal = state.fPal === i ? -1 : i; buildLibHead(); buildGrid(); $('#grid').scrollTop = 0; saveSoon(); });
  $('#grid').addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); const f = favs(); f.splice(+del.dataset.del, 1); store.set('fon:favs', f); buildGrid(); return; }
    const t = e.target.closest('.tile'); if (!t) return;
    const it = t._item; state.bg = { ...it.bg };
    if (state.tab !== 'bg') state.fx = clone(it.fx);
    if (state.tab === 'fav' && it.els) state.els = state.els.filter(x => x.type === 'image').concat(clone(it.els).map(x => ({ ...x, id: uid() })));
    buildBgSec(); buildFxSec(); buildElList(); buildElEdit(); schedule(); markActive(); saveSoon();
  });

  // ---------- dışa aktarma
  const slug = s => s.toLowerCase().replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  function renderBlob(dev, fmt = state.fmt) {
    return new Promise((res, rej) => {
      const o = outSize(dev), cv = document.createElement('canvas'); cv.width = o.w; cv.height = o.h;
      const ctx = cv.getContext('2d'); if (!ctx) return rej(new Error('canvas'));
      const frame = { x: (o.w - dev.w) / 2, y: (o.h - dev.h) / 2, w: dev.w, h: dev.h };
      F.render(ctx, o.w, o.h, { bg: state.bg, fx: state.fx, els: state.els }, { els: true, frame });
      const type = fmt === 'jpg' ? 'image/jpeg' : 'image/png';
      cv.toBlob(b => b ? res({ blob: b, name: `fon-${slug(dev.name)}-${o.w}x${o.h}.${fmt === 'jpg' ? 'jpg' : 'png'}` }) : rej(new Error('Bu boyutta görüntü oluşturulamadı')), type, 0.95);
    });
  }
  function download({ blob, name }) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  const toDataURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  const native = msg => window.webkit.messageHandlers.fon.postMessage(msg);
  async function deliver(results) {
    if (NATIVE) {
      const files = []; for (const r of results) files.push({ name: r.name, data: await toDataURL(r.blob) });
      native({ type: 'save', files }); return false;
    }
    if (isTouch && navigator.canShare) {
      const files = results.map(r => new File([r.blob], r.name, { type: r.blob.type }));
      if (navigator.canShare({ files })) {
        try { await navigator.share({ files }); return; } catch (e) { if (e.name === 'AbortError') return; }
      }
    }
    for (let i = 0; i < results.length; i++) { download(results[i]); if (i < results.length - 1) await new Promise(r => setTimeout(r, 400)); }
    return true;
  }
  let busy = false;
  async function run(devs) {
    if (busy) return; busy = true;
    $$('#btnDownload, #btnDl2, #btnSet').forEach(b => b.disabled = true);
    toast(devs.length > 1 ? `${devs.length} duvar kağıdı hazırlanıyor…` : 'Hazırlanıyor…', 60000);
    await new Promise(r => setTimeout(r, 40));
    try {
      const results = [];
      for (const d of devs) results.push(await renderBlob(d));
      const o = outSize(devs[0]);
      if (!(await deliver(results))) toast('Kaydetme penceresi açıldı');
      else toast(devs.length > 1 ? `${devs.length} dosya indirildi` : `İndirildi · ${o.w} × ${o.h} px`);
    } catch (e) { toast(`Olmadı: ${e.message}`); }
    busy = false; $$('#btnDownload, #btnDl2, #btnSet').forEach(b => b.disabled = false);
  }

  // Mac'e uygula: tasarım her ekranın kendi çözünürlüğünde çizilip masaüstü arkaplanı yapılır
  async function applyToMac() {
    if (busy || !NATIVE) return; busy = true;
    const btn = $('#btnApply'); btn.disabled = true;
    const screens = F.devices.thismac.models;
    toast(screens.length > 1 ? `${screens.length} ekran için hazırlanıyor…` : 'Hazırlanıyor…', 60000);
    await new Promise(r => setTimeout(r, 40));
    try {
      const images = [];
      for (const m of screens) {
        const r = await renderBlob({ ...m, kind: 'laptop' }, 'png');
        images.push({ screen: m.screen, data: await toDataURL(r.blob) });
      }
      native({ type: 'apply', images });
    } catch (e) { toast(`Olmadı: ${e.message}`); busy = false; btn.disabled = false; }
  }
  // iPhone'a gönder: son seçilen iPhone modelinin çözünürlüğünde üretip AirDrop'a ya da iCloud Drive'a verir
  async function sendToPhone(mode) {
    if (busy || !NATIVE) return; busy = true;
    const dev = devOf('iphone');
    toast(`${dev.name} için hazırlanıyor…`, 60000);
    await new Promise(r => setTimeout(r, 40));
    try {
      const r = await renderBlob(dev, 'png');
      native({ type: 'phone', mode, name: r.name, data: await toDataURL(r.blob) });
    } catch (e) { toast(`Olmadı: ${e.message}`); busy = false; }
  }
  function onNative(r) {
    busy = false; const btn = $('#btnApply'); if (btn) btn.disabled = false;
    toast(r.message, r.ok ? 2600 : 5000);
  }
  if (NATIVE) {
    const b = document.createElement('button'); b.id = 'btnApply'; b.className = 'btn primary'; b.textContent = "Mac'e uygula";
    b.title = 'Tasarımı tüm ekranlarda masaüstü arkaplanı yap';
    $('.top .actions').appendChild(b); b.addEventListener('click', applyToMac);
    $('#btnDownload').className = 'btn ghost'; $('#btnDownload').textContent = 'Kaydet';
    $('#btnLink').hidden = true; $('#btnMacApp').hidden = true;
    document.documentElement.classList.add('native');
  }
  const exportCurrent = () => run([curDev()]);
  const exportSet = () => run(['iphone', 'ipad', 'mac', 'watch'].map(devOf));
  $('#btnDownload').addEventListener('click', exportCurrent);

  // ---------- diğer eylemler
  function randomize() {
    const c = makeCombo(Math.floor(Math.random() * 1e6) + 1000);
    state.bg = c.bg; state.fx = c.fx;
    buildBgSec(); buildFxSec(); schedule(); markActive(); saveSoon();
  }
  $('#btnRandom').addEventListener('click', randomize);
  $('#btnMacApp').addEventListener('click', () => toast('İndiriliyor. macOS ilk açılışta uyarırsa: Sistem Ayarları → Gizlilik ve Güvenlik → Yine de Aç.', 9000));
  $('#btnLock').addEventListener('click', () => { state.lock = !state.lock; buildChrome(curDev()); saveSoon(); });
  $('#btnFav').addEventListener('click', () => {
    const f = favs(), g = F.genById[state.bg.gen];
    f.unshift({ bg: { ...state.bg }, fx: clone(state.fx), els: state.els.filter(e => e.type !== 'image').map(stripEl), name: `${g.name} · ${F.palettes[state.bg.pal].name}` });
    if (!store.set('fon:favs', f.slice(0, 80))) { toast('Favori kaydedilemedi (tarayıcı depolaması kapalı)'); return; }
    toast('Favorilere eklendi'); if (state.tab === 'fav') buildGrid();
  });
  $('#btnLink').addEventListener('click', async () => {
    const dev = curDev();
    const d = { b: state.bg, f: state.fx, e: state.els.filter(e => e.type !== 'image').map(stripEl), c: state.cat, m: dev.id };
    const url = `${location.origin}${location.pathname}#d=${encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(d)))))}`;
    try { await navigator.clipboard.writeText(url); toast(state.els.some(e => e.type === 'image') ? 'Bağlantı kopyalandı (yüklenen logolar bağlantıya girmez)' : 'Bağlantı kopyalandı'); }
    catch (e) { prompt('Bağlantı', url); }
  });

  let toastT = 0;
  function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }

  document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'r' || e.key === 'R') { randomize(); return; }
    const el = selEl(); if (!el) return;
    if (e.key === 'Backspace' || e.key === 'Delete') { state.els = state.els.filter(x => x !== el); state.sel = null; buildElList(); buildElEdit(); schedule(); saveSoon(); e.preventDefault(); return; }
    const step = e.shiftKey ? 0.02 : 0.004, mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv) { el.x += mv[0]; el.y += mv[1]; keepInside(el); syncEditXY(el); schedule(); saveSoon(); e.preventDefault(); }
    if (e.key === 'Escape') { state.sel = null; buildElList(); buildElEdit(); schedule(); }
  });

  // ---------- başlat
  buildHeader(); buildBgSec(); buildElSec(); buildFxSec(); buildOutSec(); buildLibHead();
  refreshThumbAspect(); buildGrid(); layout(); clampAll();
  window.FonApp = {
    state, renderBlob, curDev, outSize, onNative,
    setScreens(list) { setThisMac(list); if (!F.devices.thismac.models.some(m => m.id === state.modelBy.thismac)) state.modelBy.thismac = DEF_MODEL.thismac; applyDevice(); },
  };
})();
