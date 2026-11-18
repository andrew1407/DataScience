// Data Science Labs showcase: lab panels, SVG charts and copy actions.
// Every lab runs its own Python through window.pyRun (bridge.py → showcase.py, PyScript).
// The labs' matplotlib calls are recorded as figure descriptions and drawn here.

const REPO = 'https://github.com/Andrew1407/DataScience';
const SRC = `${REPO}/blob/main`;
const TREE = `${REPO}/tree/main`;
const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v, d = 4) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return v === null || v === undefined ? '–' : String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e7 || a < 1e-3)) return v.toExponential(2);
  return String(+v.toFixed(d));
};
const range = (n, f = (i) => i) => Array.from({ length: n }, (_, i) => f(i));
const pause = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const stat = (value, label, cls = '') => `<div class="stat ${cls}"><b>${value}</b><span>${label}</span></div>`;

// ----------------------------------------------------------------- runtime --
let pyReady = false;
const pyWaiters = [];
window.addEventListener('py-ready', () => {
  pyReady = true;
  document.querySelectorAll('.py-status').forEach((el) => el.remove());
  pyWaiters.splice(0).forEach((f) => f());
});
const whenPy = () => (pyReady ? Promise.resolve() : new Promise((r) => pyWaiters.push(r)));

async function runPy(name, params, btn) {
  await whenPy();
  const need = await window.pyNeed(name);
  if (need && btn) btn.textContent = `Loading ${need}…`;
  await pause();
  const res = JSON.parse(await window.pyRun(name, JSON.stringify(params)));
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

// ------------------------------------------------------------------ charts --
const charts = new Map();
let chartSeq = 0;
// the colours the labs ask matplotlib for, mapped to the page's palette
const NAMED = { black: '--ink', red: '--c5', orange: '--c2', blue: '--c1', b: '--c1', green: '--c3', purple: '--c4', yellowgreen: '--c7' };
const PALETTE = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7'];

function niceStep(span, count) {
  const raw = span / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const m = raw / p;
  return (m >= 5 ? 10 : m >= 2 ? 5 : m >= 1 ? 2 : 1) * p;
}
function ticks(min, max, count) {
  if (min === max) { min -= 1; max += 1; }
  const step = niceStep(max - min, count);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toPrecision(12));
  return { lo, hi, ticks: out };
}

const DAY = 864e5;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
function dateTicks(lo, hi, count) {
  const span = hi - lo;
  const months = [1, 2, 3, 6, 12, 24, 36, 60].find((m) => span / (m * 30.4 * DAY) <= count);
  const out = [];
  if (!months || span < 45 * DAY) {
    const step = Math.max(DAY, niceStep(span / DAY, count) * DAY);
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(t);
    return { ticks: out, label: iso };
  }
  const d = new Date(lo);
  let y = d.getUTCFullYear(), m = Math.ceil((d.getUTCMonth() + (d.getUTCDate() > 1 ? 1 : 0)) / months) * months;
  for (;;) {
    const t = Date.UTC(y + Math.floor(m / 12), m % 12, 1);
    if (t > hi) break;
    if (t >= lo) out.push(t);
    m += months;
  }
  return { ticks: out, label: (t) => (months >= 12 ? iso(t).slice(0, 4) : iso(t).slice(0, 7)) };
}

/** A figure recorded from the lab: { title, xlabel, ylabel, items: [line | hist | bar | barh] } */
function chart(fig, n) {
  const id = `c${++chartSeq}`;
  const used = new Set();
  fig.items.forEach((it) => { it.color = NAMED[it.color] || null; if (it.color) used.add(it.color); });
  const free = PALETTE.filter((c) => !used.has(c));
  let k = 0;
  fig.items.forEach((it) => { it.color ||= free[k++ % free.length] || PALETTE[k % PALETTE.length]; it.name = it.label || fig.ylabel || (it.kind === 'hist' ? 'count' : 'value'); });
  const title = fig.title || `Figure ${n}`;
  charts.set(id, { ...fig, title });
  const thinned = fig.items.some((it) => it.n && it.y && it.n > it.y.length);
  const keys = fig.items.length > 1
    ? `<span class="keys">${fig.items.map((s) => `<span><i style="background:var(${s.color})"></i>${esc(s.name)}</span>`).join('')}</span>` : '';
  return `<figure class="chart" data-chart="${id}" data-copyable data-title="${esc(title)}"><figcaption><span><span class="fig-n">${n}.</span> ${esc(title)}${thinned ? ' <span class="thin" title="Long series are thinned to the minimum and maximum of each bucket for drawing and CSV">· thinned</span>' : ''}</span>${keys}${actions('png', 'csv')}</figcaption><div class="plot"></div></figure>`;
}

function drawCharts(root = document) {
  root.querySelectorAll('figure.chart').forEach((fig) => {
    const spec = charts.get(fig.dataset.chart);
    const plot = $('.plot', fig);
    if (!spec || !plot.offsetParent) return;
    drawFigure(plot, spec);
  });
}
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => drawCharts(), 120); });

function frame(spec, W, H, M, xr, yr, xt, xlabel) {
  const X = (v) => M.l + ((v - xr[0]) / (xr[1] - xr[0] || 1)) * (W - M.l - M.r);
  const Y = (v) => H - M.b - ((v - yr.lo) / (yr.hi - yr.lo || 1)) * (H - M.t - M.b);
  const grid = yr.ticks.map((v) => `<line x1="${M.l}" x2="${W - M.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${M.l - 8}" y="${Y(v)}" text-anchor="end" dominant-baseline="middle">${fmt(v, 6)}</text>`).join('')
    + xt.ticks.map((v) => `<line x1="${X(v)}" x2="${X(v)}" y1="${H - M.b}" y2="${H - M.b + 4}" stroke="var(--muted)"/><text x="${X(v)}" y="${H - M.b + 16}" text-anchor="middle">${esc(xt.label(v))}</text>`).join('');
  const axes = `<line x1="${M.l}" x2="${W - M.r}" y1="${H - M.b}" y2="${H - M.b}" stroke="var(--line)"/>`
    + (yr.lo < 0 && yr.hi > 0 ? `<line x1="${M.l}" x2="${W - M.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--muted)" stroke-opacity=".45"/>` : '')
    + (xlabel ? `<text x="${(M.l + W - M.r) / 2}" y="${H - 4}" text-anchor="middle">${esc(xlabel)}</text>` : '')
    + (spec.ylabel ? `<text transform="translate(12 ${(M.t + H - M.b) / 2}) rotate(-90)" text-anchor="middle">${esc(spec.ylabel)}</text>` : '');
  return { X, Y, svg: grid + axes };
}

function yTicks(values, zero = false) {
  const v = values.filter(Number.isFinite);
  let lo = Math.min(...v), hi = Math.max(...v);
  if (zero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  return ticks(lo, hi, 5);
}

function mount(plot, W, H, spec, body, onMove) {
  plot.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(spec.title)}">${body}<line class="cross" y1="0" y2="0" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/><g class="marks"></g></svg><div class="tip" hidden></div>`;
  const svg = $('svg', plot), tip = $('.tip', plot), cross = $('.cross', svg), marks = $('.marks', svg);
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); marks.innerHTML = ''; };
  const move = (e) => {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W, py = ((e.clientY - rect.top) / rect.height) * H;
    const hit = onMove(px, py);
    if (!hit) return hide();
    if (hit.cross !== undefined) {
      cross.setAttribute('x1', hit.cross); cross.setAttribute('x2', hit.cross);
      cross.setAttribute('y1', hit.y1); cross.setAttribute('y2', hit.y2); cross.setAttribute('visibility', 'visible');
    } else cross.setAttribute('visibility', 'hidden');
    marks.innerHTML = hit.marks || '';
    tip.innerHTML = hit.html;
    tip.hidden = false;
    const left = (hit.at / W) * rect.width, tw = tip.offsetWidth;
    tip.style.left = `${left + 12 + tw > rect.width ? Math.max(0, left - tw - 12) : left + 12}px`;
    tip.style.top = `${hit.top ?? 8}px`;
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', hide);
}

function drawFigure(plot, spec) {
  const W = Math.max(260, plot.clientWidth), H = spec.height || 250;
  const kinds = new Set(spec.items.map((i) => i.kind));
  if (kinds.has('barh')) return drawBarh(plot, spec, W);
  if (kinds.has('bar') || spec.items.some((i) => i.xtype === 'cat')) return drawBars(plot, spec, W, H);
  if (kinds.has('hist')) return drawHist(plot, spec, W, H);
  return drawLines(plot, spec, W, H);
}

function drawLines(plot, spec, W, H) {
  const M = { l: 62, r: 14, t: 8, b: 38 };
  const lines = spec.items.filter((i) => i.kind === 'line');
  const date = lines.some((s) => s.xtype === 'date');
  const xs = lines.flatMap((s) => s.x).filter(Number.isFinite), ys = lines.flatMap((s) => s.y);
  if (!xs.length) { plot.innerHTML = '<p class="hint">No data.</p>'; return; }
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const count = Math.max(3, Math.floor((W - M.l) / (date ? 80 : 90)));
  const xt = date ? dateTicks(x0, x1, count) : { ticks: ticks(x0, x1, count).ticks.filter((v) => v >= x0 - 1e-9 && v <= x1 + 1e-9), label: (v) => fmt(v, 6) };
  const yr = yTicks(ys);
  const { X, Y, svg } = frame(spec, W, H, M, [x0, x1], yr, xt, spec.xlabel || (date ? '' : ''));
  const paths = lines.map((s) => {
    let d = '', pen = false;
    s.x.forEach((x, i) => {
      const y = s.y[i];
      if (y === null || !Number.isFinite(y)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(y).toFixed(1)}`;
      pen = true;
    });
    const dots = s.x.length <= 40 ? s.x.map((x, i) => (Number.isFinite(s.y[i]) ? `<circle cx="${X(x)}" cy="${Y(s.y[i])}" r="2.6" fill="var(${s.color})"/>` : '')).join('') : '';
    return `<path d="${d}" fill="none" stroke="var(${s.color})" stroke-width="${s.x.length > 600 ? 1.2 : 1.8}" stroke-linejoin="round"/>${dots}`;
  }).join('');
  const sorted = lines.map((s) => s.x.every((v, i) => !i || v >= s.x[i - 1]));
  const nearest = (s, si, v) => {
    const a = s.x;
    if (!sorted[si]) { let b = 0; a.forEach((x, i) => { if (Math.abs(x - v) < Math.abs(a[b] - v)) b = i; }); return b; }
    let lo = 0, hi = a.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m; else hi = m; }
    return Math.abs(a[lo] - v) <= Math.abs(a[hi] - v) ? lo : hi;
  };
  const xLabel = (v) => (date ? iso(v) : fmt(v, 6));
  mount(plot, W, H, spec, svg + paths, (px) => {
    if (px < M.l - 6 || px > W - M.r + 6) return null;
    const v = x0 + ((px - M.l) / (W - M.l - M.r)) * (x1 - x0);
    const hits = lines.map((s, si) => { const i = nearest(s, si, v); return { s, x: s.x[i], y: s.y[i] }; })
      .filter((h) => Math.abs(X(h.x) - px) < 40 && Number.isFinite(h.y));
    if (!hits.length) return null;
    const hx = X(hits[0].x);
    return {
      cross: hx, y1: M.t, y2: H - M.b, at: hx,
      marks: hits.map((h) => `<circle cx="${X(h.x)}" cy="${Y(h.y)}" r="4" fill="var(--panel)" stroke="var(${h.s.color})" stroke-width="2"/>`).join(''),
      html: `<div class="tx">${esc(spec.xlabel || (date ? 'date' : 'x'))} = ${xLabel(hits[0].x)}</div>` + hits.map((h) => `<div><i style="background:var(${h.s.color})"></i>${esc(h.s.name)}: ${fmt(h.y, 6)}</div>`).join(''),
    };
  });
}

function drawHist(plot, spec, W, H) {
  const M = { l: 58, r: 14, t: 8, b: 38 };
  const hs = spec.items.filter((i) => i.kind === 'hist' && i.counts.length);
  if (!hs.length) { plot.innerHTML = '<p class="hint">No data.</p>'; return; }
  const all = hs.flatMap((h) => h.edges);
  const x0 = Math.min(...all), x1 = Math.max(...all);
  const xt = { ticks: ticks(x0, x1, Math.max(3, Math.floor((W - M.l) / 90))).ticks.filter((v) => v >= x0 - 1e-9 && v <= x1 + 1e-9), label: (v) => fmt(v, 6) };
  const yr = ticks(0, Math.max(...hs.flatMap((h) => h.counts)), 5);
  const { X, Y, svg } = frame(spec, W, H, M, [x0, x1], yr, xt, spec.xlabel);
  const op = hs.length > 1 ? 0.45 : 0.6;
  const bars = hs.map((h) => h.counts.map((c, i) => {
    const a = X(h.edges[i]), b = X(h.edges[i + 1]);
    return `<rect x="${a}" y="${Y(c)}" width="${Math.max(0.5, b - a)}" height="${Y(0) - Y(c)}" fill="var(${h.color})" fill-opacity="${op}" stroke="var(${h.color})" stroke-width="1"/>`;
  }).join('')).join('');
  mount(plot, W, H, spec, svg + bars, (px) => {
    if (px < M.l || px > W - M.r) return null;
    const v = x0 + ((px - M.l) / (W - M.l - M.r)) * (x1 - x0);
    const hits = hs.map((h) => {
      const i = h.edges.findIndex((e, k) => k < h.counts.length && v >= e && v <= h.edges[k + 1]);
      return i < 0 ? null : { h, i };
    }).filter(Boolean);
    if (!hits.length) return null;
    return {
      at: px,
      marks: hits.map(({ h, i }) => `<rect x="${X(h.edges[i])}" y="${Y(h.counts[i])}" width="${X(h.edges[i + 1]) - X(h.edges[i])}" height="${Y(0) - Y(h.counts[i])}" fill="none" stroke="var(--ink)" stroke-width="1.5"/>`).join(''),
      html: hits.map(({ h, i }) => `<div><i style="background:var(${h.color})"></i>${esc(h.name)}: [${fmt(h.edges[i], 4)}, ${fmt(h.edges[i + 1], 4)}) · ${h.counts[i]}</div>`).join(''),
    };
  });
}

function drawBars(plot, spec, W, H) {
  const M = { l: 62, r: 14, t: 8, b: 46 };
  const items = spec.items;
  const cats = items[0].cats || items[0].x;
  const vals = (it) => it.values || it.y;
  const n = cats.length, band = (W - M.l - M.r) / n;
  const yr = yTicks(items.flatMap(vals), true);
  const Y = (v) => H - M.b - ((v - yr.lo) / (yr.hi - yr.lo || 1)) * (H - M.t - M.b);
  const cx = (i) => M.l + band * (i + 0.5);
  const grid = yr.ticks.map((v) => `<line x1="${M.l}" x2="${W - M.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${M.l - 8}" y="${Y(v)}" text-anchor="end" dominant-baseline="middle">${fmt(v, 6)}</text>`).join('');
  const every = Math.ceil(n / Math.max(1, Math.floor((W - M.l) / 60)));
  const labels = cats.map((c, i) => (i % every ? '' : `<text x="${cx(i)}" y="${H - M.b + 16}" text-anchor="middle">${esc(c)}</text>`)).join('');
  const axes = `<line x1="${M.l}" x2="${W - M.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--muted)" stroke-opacity=".6"/>${spec.ylabel ? `<text transform="translate(12 ${(M.t + H - M.b) / 2}) rotate(-90)" text-anchor="middle">${esc(spec.ylabel)}</text>` : ''}${spec.xlabel ? `<text x="${(M.l + W - M.r) / 2}" y="${H - 4}" text-anchor="middle">${esc(spec.xlabel)}</text>` : ''}`;
  const body = items.map((it) => {
    const v = vals(it);
    if (it.kind === 'bar') return v.map((y, i) => `<rect x="${cx(i) - band * 0.35}" y="${Math.min(Y(y), Y(0))}" width="${band * 0.7}" height="${Math.abs(Y(0) - Y(y))}" rx="2" fill="var(${it.color})" fill-opacity=".8"/>`).join('');
    return `<polyline points="${v.map((y, i) => `${cx(i)},${Y(y)}`).join(' ')}" fill="none" stroke="var(${it.color})" stroke-width="1.8"/>` + v.map((y, i) => `<circle cx="${cx(i)}" cy="${Y(y)}" r="2.8" fill="var(${it.color})"/>`).join('');
  }).join('');
  mount(plot, W, H, spec, grid + labels + axes + body, (px) => {
    const i = Math.floor((px - M.l) / band);
    if (i < 0 || i >= n) return null;
    return { at: cx(i), cross: cx(i), y1: M.t, y2: H - M.b, html: `<div class="tx">${esc(cats[i])}</div>` + items.map((it) => `<div><i style="background:var(${it.color})"></i>${esc(it.name)}: ${fmt(vals(it)[i], 6)}</div>`).join('') };
  });
}

function drawBarh(plot, spec, W) {
  const it = spec.items.find((i) => i.kind === 'barh');
  const n = it.cats.length, RH = 26, M = { l: Math.min(160, 14 + Math.max(...it.cats.map((c) => c.length)) * 7), r: 60, t: 6, b: 26 };
  const H = M.t + n * RH + M.b;
  const xr = ticks(Math.min(0, ...it.values), Math.max(0, ...it.values), Math.max(3, Math.floor((W - M.l) / 90)));
  const X = (v) => M.l + ((v - xr.lo) / (xr.hi - xr.lo || 1)) * (W - M.l - M.r);
  const grid = xr.ticks.map((v) => `<line x1="${X(v)}" x2="${X(v)}" y1="${M.t}" y2="${H - M.b}" stroke="var(--grid)"/><text x="${X(v)}" y="${H - M.b + 16}" text-anchor="middle">${fmt(v, 6)}</text>`).join('');
  const bars = it.cats.map((c, i) => {
    const y = M.t + i * RH, v = it.values[i];
    return `<text x="${M.l - 8}" y="${y + RH / 2}" text-anchor="end" dominant-baseline="middle">${esc(c)}</text><rect x="${Math.min(X(0), X(v))}" y="${y + 5}" width="${Math.abs(X(v) - X(0))}" height="${RH - 10}" rx="3" fill="var(${it.color})" fill-opacity=".85"/><text x="${Math.max(X(0), X(v)) + 6}" y="${y + RH / 2}" dominant-baseline="middle">${fmt(v, 4)}</text>`;
  }).join('');
  mount(plot, W, H, { ...spec }, grid + `<line x1="${X(0)}" x2="${X(0)}" y1="${M.t}" y2="${H - M.b}" stroke="var(--muted)"/>` + bars, (px, py) => {
    const i = Math.floor((py - M.t) / RH);
    if (i < 0 || i >= n) return null;
    return { at: px, top: M.t + i * RH + RH, html: `<div>${esc(it.cats[i])}: ${fmt(it.values[i], 6)}</div>` };
  });
}

// ------------------------------------------------------------------ copying --
const ACTION_LABEL = { png: 'Copy image', csv: 'Copy CSV', table: 'Copy table', results: 'Copy results', text: 'Copy text' };
const ACTION_TIP = { png: 'Copy as a PNG image (downloads it if the clipboard is unavailable)', csv: 'Copy the plotted data as CSV', table: 'Copy the table as tab-separated text, pastes into spreadsheets', results: 'Copy the inputs, results and printed output as text', text: 'Copy the printed output' };
const actions = (...kinds) => `<span class="copy-actions">${kinds.map((k) => `<button type="button" class="mini" data-act="${k}" title="${ACTION_TIP[k]}">${ACTION_LABEL[k]}</button>`).join('')}</span>`;

// Render an on-screen SVG to PNG: computed colours and fonts are inlined so the image
// matches the current theme, with the caption drawn above it.
function svgPng(svg, title, legend = [], scale = 2) {
  const box = svg.viewBox.baseVal;
  const w = (box && box.width) || +svg.getAttribute('width') || svg.clientWidth;
  const h = (box && box.height) || +svg.getAttribute('height') || svg.clientHeight;
  const clone = svg.cloneNode(true);
  const src = [svg, ...svg.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el), c = dst[i];
    for (const a of ['fill', 'stroke', 'stroke-opacity', 'fill-opacity', 'stroke-width', 'opacity', 'visibility']) c.setAttribute(a, cs.getPropertyValue(a));
    if (el.tagName === 'text') for (const a of ['font-family', 'font-size', 'font-weight']) c.setAttribute(a, cs.getPropertyValue(a));
    c.removeAttribute('style'); c.removeAttribute('class');
  });
  clone.querySelectorAll('title, .marks').forEach((t) => t.remove());
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', w); clone.setAttribute('height', h);
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const css = getComputedStyle(document.documentElement);
  const pad = 14;
  const family = getComputedStyle(document.body).fontFamily;
  // legend keys go on their own lines under the title when they don't fit beside it
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `12px ${family}`;
  const rows = [[]];
  let used = 0;
  for (const k of legend) {
    const kw = measure.measureText(k.name).width + 33;
    if (used + kw > w && rows[rows.length - 1].length) { rows.push([]); used = 0; }
    rows[rows.length - 1].push(k); used += kw;
  }
  const keyRows = legend.length ? rows.length : 0;
  const head = (title ? 26 : 0) + keyRows * 18;
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = (w + pad * 2) * scale; c.height = (h + head + pad * 2) * scale;
      const ctx = c.getContext('2d');
      ctx.scale(scale, scale);
      ctx.fillStyle = css.getPropertyValue('--panel').trim();
      ctx.fillRect(0, 0, w + pad * 2, h + head + pad * 2);
      if (title) {
        ctx.fillStyle = css.getPropertyValue('--ink').trim();
        ctx.font = `600 14px ${family}`;
        ctx.fillText(title, pad, pad + 14);
      }
      ctx.font = `12px ${family}`;
      rows.forEach((row, r) => {
        let x = pad;
        const y = pad + (title ? 26 : 0) + r * 18 + 10;
        for (const { name, color } of row) {
          ctx.fillStyle = css.getPropertyValue(color).trim();
          ctx.fillRect(x, y - 5, 14, 3);
          x += 19;
          ctx.fillStyle = css.getPropertyValue('--muted').trim();
          ctx.fillText(name, x, y);
          x += ctx.measureText(name).width + 14;
        }
      });
      ctx.drawImage(img, pad, pad + head, w, h);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG render failed')); };
    img.src = url;
  });
}

const csvCell = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const csv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n');
function chartCsv(spec) {
  const items = spec.items;
  if (items.some((i) => i.kind === 'hist')) return csv([['series', 'bin_start', 'bin_end', 'count'], ...items.flatMap((h) => h.counts.map((c, i) => [h.name, h.edges[i], h.edges[i + 1], c]))]);
  if (items.some((i) => i.kind === 'bar' || i.kind === 'barh' || i.xtype === 'cat')) {
    const cats = items[0].cats || items[0].x;
    return csv([['category', ...items.map((i) => i.name)], ...cats.map((c, k) => [c, ...items.map((i) => (i.values || i.y)[k])])]);
  }
  const date = items.some((s) => s.xtype === 'date');
  const xv = (v) => (date ? iso(v) : v);
  const xName = spec.xlabel || (date ? 'date' : 'x');
  const s0 = items[0];
  const shared = items.every((s) => s.x.length === s0.x.length && s.x.every((x, i) => x === s0.x[i]));
  if (shared) return csv([[xName, ...items.map((s) => s.name)], ...s0.x.map((x, i) => [xv(x), ...items.map((s) => s.y[i])])]);
  return csv([['series', xName, spec.ylabel || 'y'], ...items.flatMap((s) => s.x.map((x, i) => [s.name, xv(x), s.y[i]]))]);
}
const tableTsv = (table) => [...table.rows].map((r) => [...r.cells].map((c) => (c.querySelector('input, select')?.value ?? c.innerText).trim().replace(/\s+/g, ' ')).join('\t')).join('\n');

function resultsText(sec) {
  const lab = LABS.find((l) => `panel-${l.id}` === sec.id);
  const p = params(lab);
  const shown = lab.fields.filter((f) => !f.when || String(p[f.when[0]]) === f.when[1]);
  const lines = [`${tabName(lab)}: ${lab.name}`, `Parameters: ${shown.map((f) => `${f.label} = ${f.check ? (p[f.key] ? 'yes' : 'no') : p[f.key] === '' ? '(random)' : p[f.key]}`).join(', ')}`];
  const out = $('.out', sec);
  out.querySelectorAll('.note, .err').forEach((el) => lines.push(el.innerText.trim()));
  out.querySelectorAll('.stats .stat').forEach((x) => lines.push(`${$('span', x).innerText.trim()}: ${$('b', x).innerText.trim()}`));
  out.querySelectorAll('[data-copyable] table').forEach((t) => {
    const name = t.closest('[data-copyable]').dataset.title;
    lines.push('', `${name}:`, tableTsv(t));
  });
  const log = $('.console', out);
  if (log) lines.push('', 'Printed output:', log.textContent.trimEnd());
  return lines.join('\n');
}

async function copyAction(btn) {
  const kind = btn.dataset.act, box = btn.closest('[data-copyable]');
  const done = (text) => { btn.textContent = text; setTimeout(() => (btn.textContent = ACTION_LABEL[kind]), 1400); };
  const name = (box?.dataset.title || 'chart').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chart';
  try {
    if (kind === 'png') {
      const svg = box.querySelector('.plot svg');
      const spec = charts.get(box.dataset.chart);
      const legend = spec && spec.items.length > 1 ? spec.items.map((x) => ({ name: x.name, color: x.color })) : [];
      try {
        // pass the promise straight to ClipboardItem so Safari keeps the user gesture
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': svgPng(svg, box.dataset.title, legend) })]);
        return done('Copied');
      } catch {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(await svgPng(svg, box.dataset.title, legend));
        a.download = `${name}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        return done('Downloaded');
      }
    }
    const text = kind === 'csv' ? chartCsv(charts.get(box.dataset.chart))
      : kind === 'table' ? tableTsv(box.querySelector('table'))
      : kind === 'text' ? box.querySelector('.console').textContent
      : resultsText(btn.closest('section.panel'));
    await navigator.clipboard.writeText(text);
    done('Copied');
  } catch (e) { console.error(e); done('Failed'); }
}
document.addEventListener('click', (e) => { const b = e.target.closest('button[data-act]'); if (b) copyAction(b); });

// ------------------------------------------------------------ shared views --
const note = (html, kind = '') => `<p class="note ${kind}">${html}</p>`;
const notes = (...items) => (items.filter(Boolean).length ? `<div class="notes">${items.filter(Boolean).join('')}</div>` : '');
const synthetic = (what) => note(`<b>Synthetic data.</b> ${what}`, 'port');

function tableBox(title, head, rows, opts = {}) {
  return `<div data-copyable data-title="${esc(title)}" style="margin-top:18px"><div class="copy-head"><h2>${esc(title)}${opts.sub ? ` <small>· ${opts.sub}</small>` : ''}</h2>${actions('table')}</div>
    <div class="table-wrap"><table><thead><tr>${head.map((h) => `<th${h.num ? ' class="num"' : ''}>${esc(h.label ?? h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div></div>`;
}
const td = (v, num = false, d = 6) => `<td${num ? ' class="num"' : ''}>${num ? fmt(v, d) : esc(v)}</td>`;

function metricsTable(d) {
  if (!d.metrics?.length) return '';
  const rows = d.metrics.map((m) => `<tr>${td(m.label || '–')}${td(m.median, true)}${td(m.variance, true)}${td(m.std, true)}</tr>`);
  return tableBox('Statistics', ['Sample', { label: 'Median', num: true }, { label: 'Variance', num: true }, { label: 'Dispersion (std)', num: true }], rows, { sub: 'every calc_metrics() call, in order' });
}

function gallery(d) {
  const figs = d.events.filter((e) => e.type === 'figure');
  if (!figs.length) return '';
  return `<div class="gallery-head"><h2>Figures <small>· ${figs.length}, in the order the lab plots them</small></h2></div><div class="charts two">${figs.map((f, i) => chart(f, i + 1)).join('')}</div>`;
}

function consoleLog(d) {
  const text = d.events.map((e) => (e.type === 'text' ? e.text : `\n[figure: ${e.title || 'untitled'}]\n`)).join('');
  if (!text.trim()) return '';
  return `<details class="out-log" data-copyable data-title="Printed output"><summary><b>Printed output</b> · what the lab prints, with markers where it shows a figure</summary><div class="out-actions" style="margin:0 0 8px">${actions('text')}</div><pre class="console">${esc(text.replace(/^\n+/, ''))}</pre></details>`;
}

function standard(d, top = '', after = '') {
  return `${d.error ? `<div class="err" style="margin:0 0 14px;white-space:pre-wrap">The lab stopped with an error:\n${esc(d.error)}</div>` : ''}${top}${metricsTable(d)}${gallery(d)}${after}${consoleLog(d)}`;
}

// ------------------------------------------------------------- lab 4 data --
// Made-up defaults with the layout of 4-lab/tables/*.xls (those files aren't in the repo).
const ROUTES = {
  columns: ['Автомобіль', 'Потяг', 'Автобус', 'Літак'],
  rows: [
    { name: 'Час у дорозі, год', criterion: 'min', coef: 0.25, values: [6.5, 5, 8.5, 1.3] },
    { name: 'Вартість, грн', criterion: 'min', coef: 0.25, values: [2400, 850, 650, 3600] },
    { name: 'Пересадки', criterion: 'min', coef: 0.1, values: [0, 1, 1, 1] },
    { name: 'Затримки, %', criterion: 'min', coef: 0.15, values: [12, 8, 15, 20] },
    { name: 'Комфорт, бали', criterion: 'max', coef: 0.15, values: [7, 8, 5, 9] },
    { name: 'Безпека, бали', criterion: 'max', coef: 0.1, values: [6, 9, 7, 9] },
  ],
};
const PR1 = {
  rows: [
    ['Ціна, тис. грн', 'мін', [12.5, 14.2, 9.8, 11.3, 15.7, 10.4, 13.9, 8.6, 12.1]],
    ['Вага, кг', 'мін', [3.4, 2.9, 4.1, 3.2, 2.5, 3.8, 3.0, 4.4, 3.6]],
    ['Енергоспоживання, Вт', 'мін', [65.5, 45.2, 90.1, 60.3, 40.8, 75.6, 55.4, 95.2, 70.7]],
    ['Термін доставки, днів', 'мін', [3.5, 5.0, 2.5, 4.0, 7.5, 3.0, 6.0, 2.0, 4.5]],
    ['Шум, дБ', 'мін', [38.5, 34.2, 44.1, 36.8, 31.5, 41.2, 35.6, 46.3, 39.4]],
    ['Гарантія, років', 'макс', [2.5, 3.0, 1.5, 2.0, 5.0, 1.5, 3.5, 1.0, 2.5]],
    ['Рейтинг продавця', 'макс', [4.5, 4.7, 3.9, 4.2, 4.9, 4.0, 4.6, 3.6, 4.3]],
    ['Вартість ремонту, тис. грн', 'мін', [2.4, 2.9, 1.8, 2.2, 3.5, 2.0, 2.7, 1.6, 2.3]],
    ['Ресурс, тис. год', 'макс', [20.5, 25.0, 15.5, 18.0, 30.5, 16.0, 22.5, 12.0, 19.5]],
  ].map(([name, criterion, values]) => ({ name, criterion, values })),
};
const copy = (o) => JSON.parse(JSON.stringify(o));
const tables = { routes: copy(ROUTES), example: copy(PR1) };

function editorHtml(module) {
  const t = tables[module];
  const crit = (v, opts) => `<select data-k="criterion">${opts.map((o) => `<option${o === v ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
  const cell = (v) => `<td><input data-k="v" inputmode="decimal" value="${esc(v)}"></td>`;
  if (module === 'routes') {
    const head = `<tr><th>Criterion <small>(column 0)</small></th><th>Критерій</th><th>Коефіцієнт</th>${t.columns.map((c, i) => `<th><input data-col="${i}" value="${esc(c)}" aria-label="Route ${i + 1} name"></th>`).join('')}</tr>`;
    const rows = t.rows.map((r, i) => `<tr data-row="${i}"><td><input class="name" data-k="name" value="${esc(r.name)}"></td><td>${crit(r.criterion, ['min', 'max'])}</td><td><input data-k="coef" inputmode="decimal" value="${r.coef}"></td>${r.values.map(cell).join('')}</tr>`).join('');
    return `<div data-copyable data-title="routes.xls"><div class="copy-head"><h2>tables/routes.xls <small>· edit any cell; one column per route</small></h2>${actions('table')}</div><div class="table-wrap"><table>${head}${rows}</table></div>
      <div class="row-actions"><button type="button" class="mini" data-edit="add-row">+ criterion</button><button type="button" class="mini" data-edit="del-row">− criterion</button><button type="button" class="mini" data-edit="add-col">+ route</button><button type="button" class="mini" data-edit="del-col">− route</button><button type="button" class="mini" data-edit="reset">Reset</button></div></div>`;
  }
  const head = `<tr><th>Показник</th><th>Критерій</th>${range(9, (i) => `<th>Товар ${i + 1}</th>`).join('')}</tr>`;
  const rows = t.rows.map((r, i) => `<tr data-row="${i}"><td><input class="name" data-k="name" value="${esc(r.name)}"></td><td>${crit(r.criterion, ['мін', 'макс'])}</td>${r.values.map(cell).join('')}</tr>`).join('');
  return `<div data-copyable data-title="Pr1.xls"><div class="copy-head"><h2>tables/Pr1.xls <small>· 9 criteria × 9 products (fixed by example.py)</small></h2>${actions('table')}</div><div class="table-wrap"><table>${head}${rows}</table></div>
    <div class="row-actions"><button type="button" class="mini" data-edit="reset">Reset</button></div></div>`;
}

function readEditor(sec, module) {
  const t = tables[module];
  const box = $('.editor', sec);
  box.querySelectorAll('tr[data-row]').forEach((tr) => {
    const r = t.rows[+tr.dataset.row];
    r.name = $('[data-k="name"]', tr).value;
    r.criterion = $('[data-k="criterion"]', tr).value;
    if (module === 'routes') r.coef = $('[data-k="coef"]', tr).value;
    r.values = [...tr.querySelectorAll('[data-k="v"]')].map((i) => i.value);
  });
  if (module === 'routes') box.querySelectorAll('[data-col]').forEach((i) => (t.columns[+i.dataset.col] = i.value));
  return t;
}

function bindEditor(sec) {
  const box = $('.editor', sec);
  const module = () => new FormData($('form', sec)).get('module');
  const draw = () => { box.innerHTML = editorHtml(module()); };
  draw();
  $('form', sec).addEventListener('change', (e) => { if (e.target.name === 'module') draw(); });
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-edit]');
    if (!b) return;
    const m = module(), t = readEditor(sec, m);
    const act = b.dataset.edit;
    if (act === 'reset') tables[m] = copy(m === 'routes' ? ROUTES : PR1);
    if (act === 'add-row') t.rows.push({ name: `Критерій ${t.rows.length + 1}`, criterion: 'min', coef: 0.1, values: t.columns.map(() => 1) });
    if (act === 'del-row' && t.rows.length > 2) t.rows.pop();
    if (act === 'add-col' && t.columns.length < 12) { t.columns.push(`Маршрут ${t.columns.length + 1}`); t.rows.forEach((r) => r.values.push(1)); }
    if (act === 'del-col' && t.columns.length > 2) { t.columns.pop(); t.rows.forEach((r) => r.values.pop()); }
    draw();
  });
}

function checkTable(module, t) {
  const bad = (v) => !Number.isFinite(Number(String(v).replace(',', '.'))) || String(v).trim() === '';
  for (const r of t.rows) {
    if (r.values.some(bad) || (module === 'routes' && bad(r.coef))) return `Row “${r.name}”: every value must be a number.`;
  }
  if (module === 'routes' && new Set(t.columns).size !== t.columns.length) return 'Route names must be unique.';
  return null;
}

// -------------------------------------------------------------- lab panels --
const seedField = { key: 'seed', label: 'Seed (blank = random)', value: '', type: 'text', optional: true };
const COUNTRIES = ['United Kingdom', 'Ukraine', 'United States', 'Afghanistan', 'Poland', 'Germany', 'France', 'Japan'];
const tabName = (lab) => (lab.tab === 'CW' ? 'Control work' : `Lab ${lab.tab}`);

const LABS = [
  {
    id: 'lab1', tab: '1', name: 'Distributions and trends', src: `${TREE}/1-lab`, file: '1-lab/main.py',
    intro: 'Generates a normal and an exponential distribution, a square and a constant trend, adds each distribution to a trend, and reports the median, variance and dispersion. The figures are the lab\'s histograms and "sales dynamics" plots.',
    fields: [
      { key: 'array_size', label: 'ARRAY_SIZE', value: 10000, min: 10, max: 200000 },
      { key: 'loc', label: 'Normal: loc', value: 0, min: -1000, max: 1000, step: 'any' },
      { key: 'scale', label: 'Normal: scale', value: 1, min: 0, max: 1000, step: 'any' },
      { key: 'exp_scale', label: 'Exponential: scale', value: 3, min: 0.001, max: 1000, step: 'any' },
      { key: 'exp_offset', label: 'Exponential: offset', value: -4.5, min: -1000, max: 1000, step: 'any' },
      { key: 'trend_scale', label: 'Square trend scale', value: 0.0000005, min: 0, max: 100, step: 'any' },
      { key: 'constant', label: 'Constant trend', value: 0.5, min: -1000, max: 1000, step: 'any' },
      seedField,
    ],
    run: (p, btn) => runPy('lab1', p, btn),
    render: (d) => standard(d),
  },
  {
    id: 'lab2', tab: '2', name: 'Least-squares anomaly cleaning', src: `${TREE}/2-lab`, file: '2-lab/main.py',
    intro: 'Adds normal noise to a square trend, replaces a share of the samples with abnormal values, and cleans them with a least-squares (MNK) sliding-window detector. <code>learn_detection_params</code> picks the detector\'s Q and window size from a 10 × 10 grid by the true-positive rate of a confusion matrix.',
    fields: [
      { key: 'array_size', label: 'ARRAY_SIZE', value: 10000, min: 50, max: 50000 },
      { key: 'abnormal_percentage', label: 'Abnormal share', value: 0.1, min: 0, max: 0.9, step: 'any' },
      { key: 'quality_coef', label: 'Anomaly scale (quality_coef)', value: 3, min: 0, max: 100, step: 'any' },
      { key: 'learn', label: 'Detector parameters', value: 'fixed', radio: [['fixed', 'Fixed'], ['learn', 'Learn (grid)']] },
      { key: 'q_mnk', label: 'Q_MNK', value: 5, min: 1, max: 100, when: ['learn', 'fixed'] },
      { key: 'n_wind', label: 'n_Wind', value: 10, min: 2, max: 500, when: ['learn', 'fixed'] },
      seedField,
    ],
    hint: 'The lab learns Q_MNK and n_Wind (100 detector runs), which takes over a minute in the browser at 10 000 samples. By default the detector uses the values from the lab\'s commented-out line, <code>Q_MNK, n_Wind = 5, 10</code>. Choose <i>Learn</i> with about 1 000 samples for a run of a few seconds.',
    run: (p, btn) => runPy('lab2', { ...p, learn: p.learn === 'learn' }, btn),
    render: (d, p) => standard(d, `${notes(
      p.learn === 'learn' ? note('Pyodide can\'t start threads, so the lab\'s <code>ThreadPoolExecutor</code> runs the 100 grid jobs one after another.', 'port') : '',
      note('The histogram after “…with abnormal error” is computed from the clean composition: <code>main.py</code> passes <code>composition</code>, not <code>ab</code>, to <code>show_stats_mnk</code>.', 'bug'),
    )}<div class="stats">${stat(d.q_mnk ?? '–', `Q_MNK${p.learn === 'learn' ? ' (learned)' : ''}`)}${stat(d.n_wind ?? '–', `n_Wind${p.learn === 'learn' ? ' (learned)' : ''}`)}${stat(d.abnormal, 'abnormal samples')}${stat(`${d.seconds} s`, 'run time')}</div>`),
  },
  {
    id: 'lab3', tab: '3', name: 'Kalman anomaly cleaning', src: `${TREE}/3-lab`, file: '3-lab/main.py',
    intro: 'The same noisy square trend with abnormal values, cleaned this time by outlier rejection (|x − mean| ≥ m·σ replaced from a 2nd-order Kalman filter) followed by an aging-based anomaly detector.',
    fields: [
      { key: 'array_size', label: 'ARRAY_SIZE', value: 100, min: 10, max: 20000 },
      { key: 'abnormal_percentage', label: 'Abnormal share', value: 0.1, min: 0, max: 0.9, step: 'any' },
      { key: 'quality_coef', label: 'Anomaly scale (quality_coef)', value: 5, min: 0, max: 100, step: 'any' },
      { key: 'm', label: 'Outlier threshold m (σ)', value: 3, min: 1, max: 10 },
      { key: 'trend_scale', label: 'Square trend scale', value: 0.005, min: 0, max: 100, step: 'any' },
      seedField,
    ],
    run: (p, btn) => runPy('lab3', p, btn),
    render: (d) => standard(d, notes(note('As in lab 2, the histogram after “…with abnormal error” is computed from the clean composition: <code>analyze_purified_vales</code> passes <code>composition</code>, not <code>ab</code>.', 'bug'))),
  },
  {
    id: 'lab4', tab: '4', name: 'Voronin multi-criteria ranking', src: `${TREE}/4-lab`, file: '4-lab/main.py',
    intro: 'Ranks options by the Voronin integral convolution: each criterion is normalised across the options (minimised criteria as x / Σx, maximised ones as (x · Σx)⁻¹), weighted by its preference coefficient, and summed as w / (1 − x). The option with the smallest convolution wins. <code>main.py</code> runs <code>routes</code>; <code>example</code> is the 9 × 9 product table.',
    fields: [{ key: 'module', label: 'MODULE', value: 'routes', radio: [['routes', 'routes'], ['example', 'example']] }],
    editor: true,
    run: (p, btn) => runPy('lab4', p, btn),
    render: (d, p) => {
      const t = tables[p.module];
      const names = p.module === 'routes' ? t.columns : range(9, (i) => `Товар ${9 - i}`); // example.py stores the products from 9 down to 1
      const order = d.integral ? d.integral.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).map((x) => x[1]) : [];
      const rank = new Map(order.map((i, r) => [i, r + 1]));
      const rows = (d.integral || []).map((v, i) => `<tr class="${i === d.optimal ? 'best' : ''}">${td(i)}${td(names[i])}${td(v, true)}${td(rank.get(i), true)}</tr>`);
      return standard(d, `${notes(synthetic(`<code>4-lab/tables/${p.module === 'routes' ? 'routes' : 'Pr1'}.xls</code> isn't in the repository, so the table above is made-up data with the same layout. It's saved as a workbook and read by the lab's own <code>pd.read_excel</code>.`),
        note('For maximised criteria the lab uses (x · Σx)⁻¹; Voronin\'s method normalises them as (1/x) / Σ(1/x). The ranking follows the lab\'s formula.', 'bug'))}
        ${d.integral ? `<div class="stats">${stat(esc(names[d.optimal]), `optimal (index ${d.optimal})`, 'good')}${stat(fmt(d.integral[d.optimal], 6), 'its integral convolution')}${stat(d.integral.length, 'options')}</div>` : ''}
        ${d.integral ? tableBox('Integral convolution', [{ label: 'Index', num: true }, 'Option', { label: 'Convolution', num: true }, { label: 'Rank', num: true }], rows, { sub: 'smaller is better' }) : ''}`);
    },
  },
  {
    id: 'lab5', tab: '5', name: 'XGBoost COVID-19 forecast', src: `${TREE}/5-lab`, file: '5-lab/main.py',
    intro: 'Takes one country\'s daily new COVID-19 cases from Our World in Data, adds date features (month, year, day of year, day of week, quarter), splits at a date, and fits an <code>XGBRegressor</code> with early stopping on the test set. The figures show the data with rolling statistics, the split, the predictions and the feature importances.',
    fields: [
      { key: 'country', label: 'COUNTRY', value: 'United Kingdom', options: COUNTRIES, wide: true },
      { key: 'date_split', label: 'DATE_SPLIT', value: '2021-10-01', type: 'date' },
      { key: 'n_estimators', label: 'n_estimators', value: 10000, min: 1, max: 20000 },
      { key: 'early_stopping_rounds', label: 'early_stopping_rounds', value: 500, min: 1, max: 5000 },
      { key: 'learning_rate', label: 'learning_rate', value: 0.001, min: 0.0001, max: 1, step: 'any' },
    ],
    run: (p, btn) => runPy('lab5', p, btn),
    render: (d) => standard(d, `${notes(note('XGBoost runs natively: it\'s one of Pyodide\'s packages. The OWID file the lab downloads (<code>covid.ourworldindata.org/…/owid-covid-data.csv</code>) has been retired, so the build takes the same columns from OWID\'s current <code>compact.csv</code>, keeps eight countries (<code>country</code> renamed back to <code>location</code>), and the page writes the chosen one to <code>5-lab/stats.csv</code>, where the lab caches its download. Data: Our World in Data, CC BY 4.0.', 'port'))}
      ${d.rmse !== undefined ? `<div class="stats">${stat(d.best_iteration, 'best iteration')}${stat(fmt(d.rmse, 1), 'test RMSE')}${stat(fmt(d.mae, 1), 'test MAE')}${stat(d.train_rows, 'train rows')}${stat(d.test_rows, 'test rows')}${stat(`${d.seconds} s`, 'run time')}</div>` : ''}`),
  },
  {
    id: 'lab6', tab: '6', name: 'Pressure: MNK + neural net', src: `${TREE}/6-lab`, file: '6-lab/main.py',
    intro: 'Reads atmospheric pressure from the Jena climate dataset, extrapolates it with a quadratic least-squares model, then trains a dense network (128 → 64 → 32 → 1, ReLU, Adam, 10 epochs) on date features to predict pressure over the original and extrapolated dates.',
    fields: [
      { key: 'start', label: 'From', value: '2009-01-01', type: 'date' },
      { key: 'end', label: 'To', value: '2016-12-31', type: 'date' },
      { key: 'every', label: 'Every n-th hour', value: 24, min: 1, max: 720 },
      { key: 'predict', label: 'Extrapolate (share)', value: 0.5, min: 0.05, max: 3, step: 'any' },
      { key: 'epochs', label: 'Epochs', value: 10, min: 1, max: 100 },
    ],
    hint: 'The dataset has 420 551 rows, one every 10 minutes. The build keeps one per hour (70 091 rows) and, by default, the page passes one row per day (2 922) so training takes about a second. Lower <i>Every n-th hour</i> for more data and a slower run.',
    run: (p, btn) => runPy('lab6', p, btn),
    render: (d) => standard(d, `${notes(note('<b>Ported.</b> TensorFlow doesn\'t run in Pyodide, so <code>import tensorflow</code> gets a small stand-in: <code>keras.Sequential</code> of <code>Dense</code> layers trains scikit-learn\'s <code>MLPRegressor</code> with the same layer sizes, activation, Adam learning rate, batch size, epochs and validation split. <code>nn.py</code> itself runs unchanged.', 'port'),
        note('The Jena archive the lab downloads is ~13 MB zipped. The build fetches it once, keeps the hourly <code>Date Time</code>, <code>p (mbar)</code> and <code>VPdef (mbar)</code> columns, and the page writes your date range to <code>6-lab/jena_climate_2009_2016.csv</code>, where the lab caches it. Data: Max Planck Institute for Biogeochemistry.', 'port'))}
      <div class="stats">${stat(d.rows, 'rows passed to the lab')}${d.coefs ? stat(`${fmt(d.coefs[0], 5)} ${d.coefs[1] < 0 ? '−' : '+'} ${fmt(Math.abs(d.coefs[1]), 4)}·t ${d.coefs[2] < 0 ? '−' : '+'} ${fmt(Math.abs(d.coefs[2]), 4)}·t²`, 'MNK model y(t)') : ''}${d.mse !== undefined ? stat(fmt(d.mse, 2), 'NN test MSE') : ''}${stat(`${d.seconds} s`, 'run time')}</div>`),
  },
  {
    id: 'lab7', tab: '7', name: 'Sales analysis and segmentation', src: `${TREE}/7-lab`, file: '7-lab/main.py',
    intro: 'Reads a sales table, then flattens (4th-degree MNK) and extrapolates (quadratic MNK) the order totals, generalises them by item with a chosen factor, and segments them by region, each with rolling statistics and histograms.',
    fields: [
      { key: 'factor', label: 'GENERALIZATION_FACTOR', value: 'sum', options: ['sum', 'mean', 'min', 'max'] },
      { key: 'predict', label: 'PREDICTION_PRECENTAGE', value: 0.3, min: 0.01, max: 3, step: 'any' },
      { key: 'rows', label: 'Orders', value: 43, min: 30, max: 2000 },
      { key: 'seed', label: 'Data seed', value: 7, min: 0, max: 1e9 },
    ],
    run: (p, btn) => runPy('lab7', p, btn),
    render: (d) => standard(d, notes(synthetic('<code>7-lab/Data_Set_3.xls</code> isn\'t in the repository. The page generates made-up orders with its columns (OrderDate, Region, Rep, Item, Units, Unit Cost, Total) and the lab reads them with its own <code>pd.read_excel</code>. Change <i>Data seed</i> for another table.')),
      d.sales ? tableBox('Data_Set_3.xls (synthetic)', d.sales.columns.map((c) => (['Units', 'Unit Cost', 'Total'].includes(c) ? { label: c, num: true } : c)), d.sales.rows.map((r) => `<tr>${r.map((v, i) => td(v, i >= 4, 2)).join('')}</tr>`), { sub: `${d.sales.rows.length} orders` }) : ''),
  },
  {
    id: 'lab8', tab: '8', name: 'Credit scoring pipeline', src: `${TREE}/8-lab`, file: '8-lab/main.py',
    intro: 'Selects the applicant fields the borrower or the product defines, drops incomplete ones, normalises the min/max criteria and sums them into a Voronin integro score. It then smooths anomalies (outlier rejection + aging), zeroes the score of applicants with more than FRAUD_BARRIER contradictions, and trains a dense network (128 → 64 → 32 → 1) to predict the score.',
    fields: [
      { key: 'rows', label: 'Applicants', value: 150, min: 20, max: 2000 },
      { key: 'seed', label: 'Data seed', value: 8, min: 0, max: 1e9 },
      { key: 'fraud_barrier', label: 'FRAUD_BARRIER', value: 2, min: 0, max: 14 },
      { key: 'data_increase', label: 'DATA_INCREASE', value: 20, min: 1, max: 400 },
      { key: 'epochs', label: 'EPOCHS', value: 10, min: 1, max: 100 },
    ],
    hint: 'The lab repeats the data <code>DATA_INCREASE = 200</code> times before training. The default here is 20, which keeps the run near two seconds.',
    run: (p, btn) => runPy('lab8', p, btn),
    render: (d) => {
      const n = d.integro?.length || 0;
      const frauds = d.valid ? d.valid.filter((v) => !v).length : 0;
      const rows = range(n, (i) => `<tr class="${d.valid && !d.valid[i] ? 'flag' : ''}">${td(i)}${td(d.integro[i], true, 3)}${td(d.flattened?.[i], true, 3)}${td(d.contradictions?.[i] ?? '–', true)}${td(d.valid ? (d.valid[i] ? 'valid' : 'fraud') : '–')}${td(d.predicted?.[i], true, 3)}${td(d.predicted_valid ? (d.predicted_valid[i] ? '> 1000' : '≤ 1000') : '–')}</tr>`);
      const last = d.history?.val_loss?.length ? d.history.val_loss[d.history.val_loss.length - 1] : undefined;
      return standard(d, `${notes(
        synthetic('The three <code>8-lab/input/*.xlsx</code> files aren\'t in the repository. The page generates made-up applicants with the fields the lab reads (birth_date, loan_amount, monthly_income, the *_id codes, the seven columns it drops…), a field description with <code>Place_of_definition</code>, and a min/max description. About one applicant in eight gets several contradictions.'),
        note('<b>Ported.</b> As in lab 6, <code>tensorflow</code> is a stand-in that trains scikit-learn\'s <code>MLPRegressor</code> with the same layers, Adam learning rate, batch size and epochs. The lab also relies on <code>np.bool8</code> and positional <code>series[j]</code>, which numpy 2 and pandas 3 removed. Both are restored for this run.', 'port'),
        note('In <code>normalize_criteria</code> the bound for maximised criteria is named <code>min_min</code> but is computed from the column maximum (<code>sample_max[j]</code>), like the one for minimised criteria.', 'bug'),
      )}<div class="stats">${stat(n, 'applicants scored')}${stat(frauds, 'flagged as fraud', frauds ? 'bad' : '')}${stat(d.predicted_valid ? d.predicted_valid.filter(Boolean).length : '–', 'predicted score > 1000')}${last !== undefined ? stat(fmt(last, 2), 'last val_loss (MSE)') : ''}${stat(`${d.seconds} s`, 'run time')}</div>`,
      n ? tableBox('Applicants', [{ label: '#', num: true }, { label: 'Integro', num: true }, { label: 'Flattened', num: true }, { label: 'Contradictions', num: true }, 'Validation', { label: 'Predicted', num: true }, 'Prediction'], rows, { sub: 'rows flagged as fraud are highlighted' }) : '');
    },
  },
  {
    id: 'lab9', tab: '9', name: 'YOLOv3 weapon detection', src: `${TREE}/9-lab`, file: '9-lab/main.py', info: true,
    intro: 'Runs a YOLOv3 network trained to detect weapons over the images in <code>input/</code> with OpenCV\'s DNN module, keeps detections above 0.5 confidence, applies non-maximum suppression and draws the bounding boxes.',
    infoHtml: `<p class="note">This lab isn't part of the showcase.</p><ul class="info-list"><li>It needs the trained model, <code>model/yolov3_training_2000.weights</code> (about 235 MB) and <code>yolov3_testing.cfg</code>, which aren't in the repository.</li><li>It uses <code>opencv-python</code>'s <code>cv2.dnn</code> module, which isn't available in Pyodide.</li></ul><p class="hint">See <a href="${SRC}/9-lab/main.py" target="_blank" rel="noopener">9-lab/main.py</a> for the code.</p>`,
    fields: [],
  },
  {
    id: 'control', tab: 'CW', name: 'Normal distribution + periodic trend', src: `${TREE}/control-work`, file: 'control-work/main.py',
    intro: 'The control work: a normal distribution added to a periodic cos trend, with the median, variance and dispersion of each, and the same histogram and dynamics figures as lab 1.',
    fields: [
      { key: 'array_size', label: 'ARRAY_SIZE', value: 10000, min: 10, max: 200000 },
      { key: 'loc', label: 'Normal: loc', value: 0, min: -1000, max: 1000, step: 'any' },
      { key: 'scale', label: 'Normal: scale', value: 1, min: 0, max: 1000, step: 'any' },
      { key: 'step', label: 'Trend step', value: 0.1, min: 0.0001, max: 100, step: 'any' },
      { key: 'x_stretch', label: 'x_stretch', value: 0.02, min: 0, max: 100, step: 'any' },
      { key: 'y_stretch', label: 'y_stretch', value: 1.5, min: -1000, max: 1000, step: 'any' },
      seedField,
    ],
    run: (p, btn) => runPy('control', p, btn),
    render: (d) => standard(d),
  },
];

// --------------------------------------------------------------- framework --
const nav = $('#nav'), main = $('#labs');
const state = new Map(); // lab id -> { ran, running }

function fieldHtml(lab, f) {
  const id = `${lab.id}-${f.key}`;
  const when = f.when ? ` data-when="${f.when[0]}=${f.when[1]}"` : '';
  if (f.radio) return `<div class="field"${when}><span>${esc(f.label)}</span><div class="seg" role="radiogroup" aria-label="${esc(f.label)}">${f.radio.map(([v, t]) => `<label><input type="radio" name="${f.key}" value="${v}"${v === f.value ? ' checked' : ''}>${t}</label>`).join('')}</div></div>`;
  if (f.options) return `<label class="field${f.wide ? ' wide' : ''}" for="${id}"${when}>${esc(f.label)}<select id="${id}" name="${f.key}">${f.options.map((o) => `<option${o === f.value ? ' selected' : ''}>${o}</option>`).join('')}</select></label>`;
  const type = f.type || 'number';
  const attrs = type === 'number' ? ` min="${f.min}" max="${f.max}" step="${f.step || 1}" required` : type === 'date' ? ' min="2000-01-01" max="2030-12-31" required' : ' inputmode="numeric" spellcheck="false" placeholder="random"';
  return `<label class="field${f.wide ? ' wide' : ''}" for="${id}"${when}>${esc(f.label)}<input id="${id}" name="${f.key}" type="${type}" value="${esc(f.value)}"${attrs}></label>`;
}

function build() {
  for (const lab of LABS) {
    const b = document.createElement('button');
    b.type = 'button'; b.role = 'tab'; b.dataset.lab = lab.id;
    b.setAttribute('aria-controls', `panel-${lab.id}`);
    b.innerHTML = `<span class="lang ${lab.info ? 'off' : 'py'}">Py</span>${tabName(lab).replace('Control work', 'CW')}<span class="long muted" style="font-weight:400">· ${esc(lab.name)}</span>`;
    b.onclick = () => select(lab.id, true);
    nav.appendChild(b);

    const ported = ['lab6', 'lab8'].includes(lab.id);
    const sec = document.createElement('section');
    sec.className = 'panel'; sec.id = `panel-${lab.id}`; sec.role = 'tabpanel'; sec.hidden = true;
    sec.innerHTML = `<div class="lab-head"><span class="lang ${lab.info ? 'off' : 'py'}">${lab.info ? 'Not included' : 'Python'}</span>${ported ? '<span class="lang port" title="TensorFlow is replaced by a scikit-learn stand-in">TF → sklearn</span>' : ''}<h3>${tabName(lab)}: ${esc(lab.name)}</h3><a href="${SRC}/${lab.file}" target="_blank" rel="noopener">View source</a></div>
      <p class="intro">${lab.intro}</p>
      ${lab.info ? lab.infoHtml : `<form class="params" novalidate>${lab.fields.map((f) => fieldHtml(lab, f)).join('')}<button class="run" type="submit">Run</button></form>
      ${lab.editor ? '<div class="editor"></div>' : ''}
      ${lab.hint ? `<p class="hint">${lab.hint}</p>` : ''}
      <div class="out" style="margin-top:18px"></div>`}`;
    main.appendChild(sec);
    state.set(lab.id, { ran: !!lab.info, running: false });
    if (lab.info) continue;

    const form = $('form', sec);
    const sync = () => sec.querySelectorAll('[data-when]').forEach((el) => {
      const [k, v] = el.dataset.when.split('=');
      el.hidden = new FormData(form).get(k) !== v;
    });
    form.addEventListener('change', sync); sync();
    form.addEventListener('submit', (e) => { e.preventDefault(); run(lab); });
    if (lab.editor) bindEditor(sec);
    if (!pyReady) sec.querySelector('.out').before(document.getElementById('py-loading').content.cloneNode(true));
  }
}

function params(lab) {
  const form = $(`#panel-${lab.id} form`);
  const fd = new FormData(form), p = {};
  for (const f of lab.fields) {
    const v = fd.get(f.key);
    p[f.key] = f.type === 'text' || f.type === 'date' || f.options || f.radio ? v : Number(v);
  }
  if (lab.editor) p.table = readEditor($(`#panel-${lab.id}`), p.module);
  return p;
}

function invalid(lab, p) {
  for (const f of lab.fields) {
    if (f.when && String(p[f.when[0]]) !== f.when[1]) continue;
    if (f.optional) { if (p[f.key] !== '' && !/^\d+$/.test(p[f.key].trim())) return `${f.label}: use a whole number or leave it blank.`; continue; }
    if (f.type === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(p[f.key])) return `${f.label} must be a date.`; continue; }
    if (f.type === 'text' || f.options || f.radio) continue;
    const v = p[f.key];
    if (!Number.isFinite(v) || v < f.min || v > f.max || (f.step !== 'any' && !Number.isInteger(v))) return `${f.label} must be ${f.step === 'any' ? 'a number' : 'an integer'} from ${f.min} to ${f.max}.`;
  }
  if (lab.editor) return checkTable(p.module, p.table);
  if (lab.id === 'lab6' && p.start >= p.end) return '“From” must be before “To”.';
  return null;
}

async function run(lab) {
  const st = state.get(lab.id);
  if (st.running) return;
  const sec = $(`#panel-${lab.id}`), btn = $('.run', sec), out = $('.out', sec);
  const p = params(lab);
  const bad = invalid(lab, p);
  if (bad) { out.innerHTML = `<div class="err">${esc(bad)}</div>`; return; }
  st.running = true; st.ran = true;
  btn.disabled = true; btn.textContent = !pyReady ? 'Waiting for Python…' : 'Running…';
  out.style.opacity = '.45';
  try {
    const data = await lab.run(p, btn);
    out.innerHTML = `<div class="out-actions">${actions('results')}</div>` + lab.render(data, p);
    drawCharts(out);
  } catch (e) {
    console.error(e);
    out.innerHTML = `<div class="err">${esc(e.message || e)}</div>`;
  } finally {
    st.running = false; btn.disabled = false; btn.textContent = 'Run'; out.style.opacity = '';
  }
}

function select(id, push) {
  const lab = LABS.find((l) => l.id === id) || LABS[0];
  nav.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', b.dataset.lab === lab.id));
  main.querySelectorAll('section.panel[role="tabpanel"]').forEach((s) => s.hidden = s.id !== `panel-${lab.id}`);
  if (push) try { history.replaceState(null, '', `#${lab.id}`); } catch {}
  document.title = `${tabName(lab)} · Data Science Labs`;
  if (!state.get(lab.id).ran) run(lab);
  else drawCharts($(`#panel-${lab.id}`));
}

build();
// elapsed counter for the Python loading notices
const started = Date.now();
const tick = setInterval(() => {
  if (pyReady) return clearInterval(tick);
  const sec = Math.round((Date.now() - started) / 1000);
  document.querySelectorAll('.py-status').forEach((el) => {
    $('.elapsed', el).textContent = sec ? `${sec} s` : '';
    if (sec >= 60) { el.classList.add('slow'); $('.note-text', el).textContent = 'This is taking longer than usual. Check your connection, or reload the page.'; }
  });
}, 1000);
select(location.hash.slice(1), false);
window.addEventListener('hashchange', () => select(location.hash.slice(1), false));
