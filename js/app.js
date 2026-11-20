import { TECHNIQUES, TECH_ORDER, EFFECT_DEFS, defaultsOf, randomizeSchema } from './techniques.js';
import { sceneContent, effectivePalette, exportSVG, exportPNG } from './render.js';
import { PALETTES } from './palettes.js';
import { pathAbs, pathD, normalizeAbs, insertNode, hitPath, autoHandles, blobFromPoints } from './geometry.js';

/* ---------- small helpers ---------- */

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = (p) => p + Math.random().toString(36).slice(2, 9);
const randSeed = () => Math.floor(Math.random() * 99999);
const isHex = (v) => /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());
const normHex = (v) => {
  let x = v.trim().replace('#', '').toLowerCase();
  if (x.length === 3) x = x.split('').map((c) => c + c).join('');
  return '#' + x;
};

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value' || k === 'checked') el[k] = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : String(kid));
  }
  return el;
}

const ICONS = {
  select: '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M5 2.5l10 7.2-4.6.9 2.7 5.3-2 1-2.7-5.3L5 14.7z"/></svg>',
  rect: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2.5" y="5" width="15" height="10" rx="1"/></svg>',
  square: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="4" width="12" height="12" rx="1"/></svg>',
  circle: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="10" cy="10" r="7"/></svg>',
  triangle: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M10 3l7.5 13h-15z"/></svg>',
  polygon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M10 2.5l6.5 3.75v7.5L10 17.5l-6.5-3.75v-7.5z"/></svg>',
  star: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M10 2.5l2.2 4.8 5.2.6-3.9 3.5 1.1 5.1L10 13.9l-4.6 2.6 1.1-5.1-3.9-3.5 5.2-.6z"/></svg>',
  path: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3.5 15c1-6 4-9.5 7-9.5s5 3 2.5 6-1.5 5 3.5 3.5"/></svg>',
  pen: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M10 2.5l5 9-5 6-5-6z"/><circle cx="10" cy="10.5" r="1.4"/><path d="M10 2.5v6.6"/></svg>',
  pencil: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M13.5 3.5l3 3L7 16H4v-3z"/><path d="M11.5 5.5l3 3"/></svg>',
  dice: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="5" cy="5" r="1.2"/><circle cx="11" cy="5" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="5" cy="11" r="1.2"/><circle cx="11" cy="11" r="1.2"/></svg>',
  eye: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
  eyeOff: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><path d="M2.5 13.5l11-11"/></svg>',
};

const TOOLS = [
  ['select', 'Select & move', 'V'],
  null,
  ['rect', 'Rectangle', 'R'],
  ['square', 'Square', 'Q'],
  ['circle', 'Circle / ellipse', 'O'],
  ['triangle', 'Triangle', 'T'],
  ['polygon', 'Polygon', 'Y'],
  ['star', 'Star', 'S'],
  null,
  ['pen', 'Pen — click for corners, drag for curves', 'P'],
  ['pencil', 'Pencil — draw a freehand blob', 'N'],
];
const TYPE_NAMES = { rect: 'Rectangle', square: 'Square', circle: 'Circle', triangle: 'Triangle', polygon: 'Polygon', star: 'Star', path: 'Path', pen: 'Path', pencil: 'Blob' };

const SIZES = [
  ['Portrait 4:5', 1080, 1350],
  ['Square', 1080, 1080],
  ['Story 9:16', 1080, 1920],
  ['Landscape 16:9', 1920, 1080],
  ['A4 · 150 dpi', 1240, 1754],
  ['A3 · 150 dpi', 1754, 2480],
  ['Poster 50×70', 1500, 2100],
];

/* ---------- state ---------- */

const STORE = 'muster:v1';
let doc = loadAutosave() || newDoc();
let selectedId = null;
let tool = 'select';
let panelTab = 'doc';
let zoom = 1;
let fitMode = true;
let drag = null;
let pen = null; // path being drawn with the pen: { nodes (doc px), hover }
let selNode = null; // selected anchor index on the selected path
const paletteSel = {}; // which swatch is selected in each palette editor
const history = { stack: [], i: -1 };

function newDoc() {
  return { version: 1, width: 1080, height: 1350, background: '#f6f4ef', palette: [...PALETTES[0].colors], shapes: [] };
}

function newLayer(technique, paletteLen) {
  const tech = TECHNIQUES[technique];
  return {
    id: uid('l'),
    technique,
    params: randomizeSchema(tech.params, paletteLen, defaultsOf(tech.params)),
    seed: randSeed(),
    opacity: 1,
    visible: true,
  };
}

function randomTechnique() {
  const pool = TECH_ORDER.filter((k) => k !== 'solid');
  return pool[Math.floor(Math.random() * pool.length)];
}

function newShape(type, x, y, w, hgt) {
  const n = doc.shapes.filter((s) => s.name?.startsWith(TYPE_NAMES[type])).length + 1;
  return {
    id: uid('s'),
    name: `${TYPE_NAMES[type]} ${n}`,
    type, x, y, w, h: hgt,
    rotation: 0,
    sides: 6, points: 5, inner: 0.5, corner: 0,
    stroke: { on: false, color: 0, width: 2 },
    palette: null,
    layers: [newLayer(randomTechnique(), doc.palette.length)],
    effects: {
      glow: { on: false, ...defaultsOf(EFFECT_DEFS.glow) },
      halo: { on: false, ...defaultsOf(EFFECT_DEFS.halo) },
      grain: { on: false, ...defaultsOf(EFFECT_DEFS.grain) },
    },
  };
}

const sel = () => doc.shapes.find((s) => s.id === selectedId) || null;

/* ---------- path shapes (pen & pencil) ---------- */

const newNode = (P) => ({ x: P.x, y: P.y, ix: 0, iy: 0, ox: 0, oy: 0, smooth: false });

// Document point → the shape's own unrotated frame (centre = 0, 0)
function toLocal(s, P) {
  const th = (-(s.rotation || 0) * Math.PI) / 180;
  const dx = P.x - s.x, dy = P.y - s.y;
  return { x: dx * Math.cos(th) - dy * Math.sin(th), y: dx * Math.sin(th) + dy * Math.cos(th) };
}

// Store pixel nodes (in the shape's local frame) and refit the box around them
function setPathAbs(s, abs) {
  const r = normalizeAbs(abs, s.closed !== false);
  const th = ((s.rotation || 0) * Math.PI) / 180;
  s.x += r.cx * Math.cos(th) - r.cy * Math.sin(th);
  s.y += r.cx * Math.sin(th) + r.cy * Math.cos(th);
  s.w = r.w;
  s.h = r.h;
  s.nodes = r.nodes;
}

function createPathShape(docNodes, closed, kind) {
  const s = newShape(kind, 0, 0, 1, 1);
  s.type = 'path';
  s.closed = closed;
  setPathAbs(s, docNodes);
  doc.shapes.push(s);
  selectedId = s.id;
  selNode = null;
  panelTab = 'shape';
  return s;
}

function toggleSmooth(abs, i, closed) {
  const n = abs[i];
  if (n.ix || n.iy || n.ox || n.oy) Object.assign(n, { ix: 0, iy: 0, ox: 0, oy: 0, smooth: false });
  else autoHandles(abs, i, closed);
}

function finishPen(closed = false) {
  if (!pen) return;
  const nodes = pen.nodes;
  // a double-click to finish adds stray points on top of the last one
  while (nodes.length > 1) {
    const a = nodes[nodes.length - 1], b = nodes[nodes.length - 2];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 4 / zoom && !a.ox && !a.oy) nodes.pop();
    else break;
  }
  pen = null;
  if (nodes.length >= 2) {
    createPathShape(nodes, closed, 'pen');
    commit();
  }
  renderAll();
}

// Pen tool on an already selected path: click a point to delete it (⌥-click converts it),
// click the line to add a point. Returns true when the click was used.
function penEditExisting(s, P, handle, e) {
  if (!s || s.type !== 'path') return false;
  const abs = pathAbs(s), closed = s.closed !== false;
  if (handle?.startsWith('a:')) {
    const i = +handle.slice(2);
    if (e.altKey) toggleSmooth(abs, i, closed);
    else if (abs.length > 2) abs.splice(i, 1);
    else return true;
    selNode = null;
  } else {
    const L = toLocal(s, P);
    const hit = hitPath(abs, closed, L.x, L.y);
    if (hit.seg < 0 || hit.dist > 7 / zoom) return false;
    insertNode(abs, hit.seg, hit.t, closed);
    selNode = hit.seg + 1;
  }
  setPathAbs(s, abs);
  commit();
  renderAll();
  return true;
}

/* ---------- randomize all ---------- */

function randomizeAll() {
  const W = doc.width, H = doc.height, m = Math.min(W, H), R = Math.random;
  const pick = (a) => a[Math.floor(R() * a.length)];
  const n = doc.palette.length;
  pen = null;
  doc.shapes = [];
  const count = 4 + Math.floor(R() * 6);
  for (let i = 0; i < count; i++) {
    const size = m * (i === 0 ? 0.5 + R() * 0.3 : 0.12 + R() * 0.38);
    const x = W * (0.12 + R() * 0.76), y = H * (0.12 + R() * 0.76);
    const type = pick(['circle', 'circle', 'circle', 'rect', 'square', 'triangle', 'polygon', 'star', 'blob', 'blob']);
    let s;
    if (type === 'blob') {
      const k = 6 + Math.floor(R() * 6), nodes = [];
      for (let j = 0; j < k; j++) {
        const a = (j / k) * Math.PI * 2, r = (size / 2) * (0.6 + R() * 0.55);
        nodes.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, ix: 0, iy: 0, ox: 0, oy: 0, smooth: true });
      }
      nodes.forEach((_, j) => autoHandles(nodes, j, true));
      s = newShape('pencil', 0, 0, 1, 1);
      s.type = 'path';
      s.closed = true;
      setPathAbs(s, nodes);
    } else {
      const hgt = type === 'rect' ? size * (0.45 + R() * 0.9) : size;
      s = newShape(type, Math.round(x), Math.round(y), Math.round(size), Math.round(hgt));
      if (type !== 'circle') s.rotation = Math.round(R() * 360);
      s.sides = 5 + Math.floor(R() * 6);
      s.points = 5 + Math.floor(R() * 8);
      s.inner = +(0.35 + R() * 0.35).toFixed(2);
      if (type === 'rect' || type === 'square') s.corner = R() < 0.4 ? Math.round(R() * size * 0.25) : 0;
    }
    if (R() < 0.35) s.layers.push(newLayer(randomTechnique(), n));
    for (const [key, chance] of [['glow', 0.25], ['halo', 0.2], ['grain', 0.35]]) {
      if (R() < chance) Object.assign(s.effects[key], randomizeSchema(EFFECT_DEFS[key], n), { on: true });
    }
    doc.shapes.push(s);
  }
  doc.shapes.sort((a, b) => b.w * b.h - a.w * a.h); // big shapes behind small ones
  doc.background = pick(['#f6f4ef', ...doc.palette]);
  selectedId = null;
  selNode = null;
  panelTab = 'doc';
  commit();
  renderAll();
  toast('New random composition · ⌘Z to go back');
}

/* ---------- history & persistence ---------- */

function commit() {
  const snap = JSON.stringify(doc);
  if (history.stack[history.i] === snap) return;
  history.stack = history.stack.slice(0, history.i + 1);
  history.stack.push(snap);
  if (history.stack.length > 120) history.stack.shift();
  history.i = history.stack.length - 1;
  autosave(snap);
  updateUndoButtons();
}

function restore(i) {
  history.i = i;
  doc = JSON.parse(history.stack[i]);
  if (!sel()) selectedId = null;
  autosave(history.stack[i]);
  renderAll();
}
const undo = () => history.i > 0 && restore(history.i - 1);
const redo = () => history.i < history.stack.length - 1 && restore(history.i + 1);

function updateUndoButtons() {
  $('#btn-undo').disabled = history.i <= 0;
  $('#btn-redo').disabled = history.i >= history.stack.length - 1;
}

function autosave(snap) {
  try { localStorage.setItem(STORE, snap); } catch { /* storage full or blocked */ }
}

function loadAutosave() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE));
    return d && Array.isArray(d.shapes) ? d : null;
  } catch {
    return null;
  }
}

// Short message at the bottom; optional action button (e.g. Undo)
function toast(msg, action) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: 'toast' }, msg,
    action ? h('button', { class: 'toast-btn', onclick: () => { t.remove(); action.run(); } }, action.label) : null);
  document.body.append(t);
  setTimeout(() => t.remove(), action ? 6000 : 2600);
}

/* ---------- canvas rendering ---------- */

const svg = $('#canvas');
const content = $('#content');
const overlay = $('#overlay');
const stage = $('#stage');
let raf = 0;

function scheduleRender() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    renderCanvas();
  });
}

function renderCanvas() {
  svg.setAttribute('viewBox', `0 0 ${doc.width} ${doc.height}`);
  content.innerHTML = sceneContent(doc, { editor: true, effects: true });
  renderOverlay();
  $('#doc-size').textContent = `${doc.width} × ${doc.height} px`;
}

// Cheap update while moving/rotating: just change the group's transform
function moveInPlace(s) {
  const g = content.querySelector(`[data-id="${s.id}"]`);
  if (g) g.setAttribute('transform', `translate(${s.x} ${s.y}) rotate(${s.rotation || 0})`);
  else scheduleRender();
  renderOverlay();
}

const NS = 'vector-effect="non-scaling-stroke"';

// Anchors and Bézier handles of the selected path (in its local frame)
function nodeOverlay(s, k) {
  const abs = pathAbs(s), n = abs.length;
  let o = `<path d="${pathD(abs, s.closed !== false)}" fill="none" stroke="#e2401f" stroke-width="1" ${NS} pointer-events="none"/>`;
  if (selNode != null && selNode < n) {
    const show = new Set([selNode - 1, selNode, selNode + 1].map((i) => (i + n) % n));
    for (const i of show) {
      const a = abs[i];
      for (const kind of ['in', 'out']) {
        const hx = a.x + (kind === 'in' ? a.ix : a.ox), hy = a.y + (kind === 'in' ? a.iy : a.oy);
        if (Math.hypot(hx - a.x, hy - a.y) < 0.5) continue;
        o += `<line x1="${a.x}" y1="${a.y}" x2="${hx}" y2="${hy}" stroke="#ff7a5c" stroke-width="1" ${NS} pointer-events="none"/>` +
          `<circle data-handle="${kind}:${i}" cx="${hx}" cy="${hy}" r="${4.5 * k}" fill="#fff" stroke="#ff7a5c" stroke-width="1.5" ${NS} style="cursor:move"/>`;
      }
    }
  }
  const as = 4 * k;
  abs.forEach((a, i) => {
    o += `<rect data-handle="a:${i}" x="${a.x - as}" y="${a.y - as}" width="${as * 2}" height="${as * 2}" fill="${i === selNode ? '#e2401f' : '#fff'}" stroke="#e2401f" stroke-width="1.5" ${NS} style="cursor:move"/>`;
  });
  return o;
}

// The path currently being drawn with the pen, plus the rubber band to the cursor
function penOverlay(k) {
  const nodes = pen.nodes, last = nodes[nodes.length - 1], first = nodes[0];
  let o = `<path d="${pathD(nodes, false)}" fill="none" stroke="#1f1e1c" stroke-width="1.5" ${NS}/>`;
  const hv = pen.hover;
  if (hv && !drag) {
    o += `<path d="M${last.x} ${last.y}C${last.x + last.ox} ${last.y + last.oy} ${hv.x} ${hv.y} ${hv.x} ${hv.y}" fill="none" stroke="#ff7a5c" stroke-width="1.2" stroke-dasharray="4 3" ${NS}/>`;
  }
  if (last.ox || last.oy) {
    o += `<line x1="${last.x + last.ix}" y1="${last.y + last.iy}" x2="${last.x + last.ox}" y2="${last.y + last.oy}" stroke="#ff7a5c" stroke-width="1" ${NS}/>` +
      `<circle cx="${last.x + last.ix}" cy="${last.y + last.iy}" r="${3.5 * k}" fill="#ff7a5c"/><circle cx="${last.x + last.ox}" cy="${last.y + last.oy}" r="${3.5 * k}" fill="#ff7a5c"/>`;
  }
  const nearFirst = hv && nodes.length >= 2 && Math.hypot(hv.x - first.x, hv.y - first.y) < 7 * k;
  o += `<circle cx="${first.x}" cy="${first.y}" r="${(nearFirst ? 8 : 5.5) * k}" fill="${nearFirst ? '#ff7a5c' : '#fff'}" stroke="#e2401f" stroke-width="1.5" ${NS}/>`;
  const as = 3.5 * k;
  nodes.slice(1).forEach((a) => {
    o += `<rect x="${a.x - as}" y="${a.y - as}" width="${as * 2}" height="${as * 2}" fill="#fff" stroke="#e2401f" stroke-width="1.5" ${NS}/>`;
  });
  return `<g pointer-events="none">${o}</g>`;
}

function renderOverlay() {
  const k = 1 / zoom;
  let out = '';
  if (pen) out += penOverlay(k);
  if (drag?.mode === 'pencil') {
    out += `<polyline points="${drag.pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#e2401f" stroke-width="1.5" ${NS} pointer-events="none"/>`;
  }
  const s = sel();
  if (!s || s.hidden || pen) { overlay.innerHTML = out; return; }
  const hw = s.w / 2, hh = s.h / 2, hs = 5 * k;
  const handle = (name, x, y) =>
    `<rect data-handle="${name}" x="${x - hs}" y="${y - hs}" width="${hs * 2}" height="${hs * 2}" fill="#fff" stroke="#e2401f" stroke-width="1.5" vector-effect="non-scaling-stroke" style="cursor:${name === 'nw' || name === 'se' ? 'nwse' : 'nesw'}-resize"/>`;
  overlay.innerHTML = out +
    `<g transform="translate(${s.x} ${s.y}) rotate(${s.rotation || 0})">` +
    `<rect x="${-hw}" y="${-hh}" width="${s.w}" height="${s.h}" fill="none" stroke="#e2401f" stroke-width="1.2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke" pointer-events="none"/>` +
    `<line x1="0" y1="${-hh}" x2="0" y2="${-hh - 26 * k}" stroke="#e2401f" stroke-width="1.2" vector-effect="non-scaling-stroke" pointer-events="none"/>` +
    `<circle data-handle="rot" cx="0" cy="${-hh - 26 * k}" r="${6 * k}" fill="#ff7a5c" stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke" style="cursor:grab"/>` +
    handle('nw', -hw, -hh) + handle('ne', hw, -hh) + handle('se', hw, hh) + handle('sw', -hw, hh) +
    (s.type === 'path' ? nodeOverlay(s, k) : '') +
    `</g>`;
}

/* ---------- zoom ---------- */

function fit() {
  const r = stage.getBoundingClientRect();
  const pad = 48;
  zoom = Math.max(0.05, Math.min((r.width - pad * 2) / doc.width, (r.height - pad * 2) / doc.height));
  fitMode = true;
  applyZoom();
}

function applyZoom() {
  svg.style.width = doc.width * zoom + 'px';
  svg.style.height = doc.height * zoom + 'px';
  $('#zoom-label').textContent = Math.round(zoom * 100) + '%';
  renderOverlay();
}

function setZoom(z) {
  zoom = clamp(z, 0.05, 8);
  fitMode = false;
  applyZoom();
}

/* ---------- pointer interaction ---------- */

function toDoc(e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

const LOCKED_TYPES = new Set(['square']);

stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const P = toDoc(e);
  const handle = e.target.closest?.('[data-handle]')?.dataset.handle;
  const s = sel();

  if (tool === 'pen') {
    if (pen) {
      const f = pen.nodes[0];
      if (pen.nodes.length >= 2 && Math.hypot(P.x - f.x, P.y - f.y) < 7 / zoom) { finishPen(true); return; }
      pen.nodes.push(newNode(P));
    } else {
      if (penEditExisting(s, P, handle, e)) return;
      pen = { nodes: [newNode(P)], hover: P };
      selectedId = null;
      selNode = null;
      renderPanel();
    }
    drag = { mode: 'pen' };
    renderOverlay();
  } else if (tool === 'pencil') {
    drag = { mode: 'pencil', pts: [[P.x, P.y]] };
  } else if (handle && s && /^(a|in|out):/.test(handle)) {
    const [kind, idx] = handle.split(':');
    const i = +idx;
    if (kind === 'a' && e.altKey) {
      const abs = pathAbs(s);
      toggleSmooth(abs, i, s.closed !== false);
      setPathAbs(s, abs);
      selNode = i;
      commit();
      renderCanvas();
      return;
    }
    if (kind === 'a') selNode = i;
    drag = kind === 'a' ? { mode: 'node', i } : { mode: 'handle', kind, i };
    renderOverlay();
  } else if (handle && s) {
    drag = { mode: handle === 'rot' ? 'rotate' : 'resize', handle, orig: { ...s } };
  } else if (tool !== 'select') {
    const shape = newShape(tool, P.x, P.y, 0, 0);
    doc.shapes.push(shape);
    selectedId = shape.id;
    drag = { mode: 'draw', start: P, shape };
  } else {
    const g = e.target.closest?.('#content [data-id]');
    if (g) {
      if (g.dataset.id !== selectedId) selNode = null;
      selectedId = g.dataset.id;
      const t = sel();
      drag = { mode: 'move', start: P, orig: { x: t.x, y: t.y } };
      panelTab = 'shape';
    } else {
      selectedId = null;
      selNode = null;
      panelTab = 'doc';
    }
    renderPanel();
    renderOverlay();
  }
  if (drag) stage.setPointerCapture(e.pointerId);
});

stage.addEventListener('pointermove', (e) => {
  if (!drag) {
    if (pen) { pen.hover = toDoc(e); renderOverlay(); }
    return;
  }
  const P = toDoc(e);

  if (drag.mode === 'pen') {
    // dragging while placing a point pulls out symmetric handles; ⌥ moves only the outgoing one
    const n = pen.nodes[pen.nodes.length - 1];
    const vx = P.x - n.x, vy = P.y - n.y;
    if (Math.hypot(vx, vy) > 3 / zoom) {
      n.ox = vx;
      n.oy = vy;
      if (!e.altKey) { n.ix = -vx; n.iy = -vy; n.smooth = true; } else n.smooth = false;
    }
    pen.hover = P;
    renderOverlay();
    return;
  }
  if (drag.mode === 'pencil') {
    const last = drag.pts[drag.pts.length - 1];
    if (Math.hypot(P.x - last[0], P.y - last[1]) > 1.5 / zoom) drag.pts.push([P.x, P.y]);
    renderOverlay();
    return;
  }

  const s = drag.mode === 'draw' ? drag.shape : sel();
  if (!s) return;
  drag.moved = true;

  if (drag.mode === 'node' || drag.mode === 'handle') {
    const abs = pathAbs(s), a = abs[drag.i];
    if (!a) return;
    const L = toLocal(s, P);
    if (drag.mode === 'node') {
      a.x = L.x;
      a.y = L.y;
    } else {
      const vx = L.x - a.x, vy = L.y - a.y;
      const [mine, other] = drag.kind === 'out' ? ['o', 'i'] : ['i', 'o'];
      a[mine + 'x'] = vx;
      a[mine + 'y'] = vy;
      if (e.altKey) a.smooth = false; // ⌥ breaks the handle pair, like Illustrator
      else if (a.smooth) {
        const len = Math.hypot(a[other + 'x'], a[other + 'y']) || Math.hypot(vx, vy);
        const m = Math.hypot(vx, vy) || 1;
        a[other + 'x'] = (-vx / m) * len;
        a[other + 'y'] = (-vy / m) * len;
      }
    }
    setPathAbs(s, abs);
    scheduleRender();
    syncGeometryInputs();
  } else if (drag.mode === 'move') {
    s.x = Math.round(drag.orig.x + P.x - drag.start.x);
    s.y = Math.round(drag.orig.y + P.y - drag.start.y);
    moveInPlace(s);
    syncGeometryInputs();
  } else if (drag.mode === 'draw') {
    let dx = P.x - drag.start.x, dy = P.y - drag.start.y;
    if (e.shiftKey || LOCKED_TYPES.has(s.type)) {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      dx = (Math.sign(dx) || 1) * m;
      dy = (Math.sign(dy) || 1) * m;
    }
    s.w = Math.round(Math.abs(dx));
    s.h = Math.round(Math.abs(dy));
    s.x = Math.round(drag.start.x + dx / 2);
    s.y = Math.round(drag.start.y + dy / 2);
    scheduleRender();
  } else if (drag.mode === 'rotate') {
    let a = (Math.atan2(P.y - s.y, P.x - s.x) * 180) / Math.PI + 90;
    if (e.shiftKey) a = Math.round(a / 15) * 15;
    s.rotation = Math.round(((a % 360) + 360) % 360);
    moveInPlace(s);
    syncGeometryInputs();
  } else if (drag.mode === 'resize') {
    const o = drag.orig;
    const th = ((o.rotation || 0) * Math.PI) / 180;
    const ux = Math.cos(th), uy = Math.sin(th), vx = -Math.sin(th), vy = Math.cos(th);
    const sx = drag.handle.includes('e') ? 1 : -1, sy = drag.handle.includes('s') ? 1 : -1;
    const ax = o.x - (sx * o.w) / 2 * ux - (sy * o.h) / 2 * vx;
    const ay = o.y - (sx * o.w) / 2 * uy - (sy * o.h) / 2 * vy;
    const dx = P.x - ax, dy = P.y - ay;
    let w = Math.max(4, (dx * ux + dy * uy) * sx);
    let hh = Math.max(4, (dx * vx + dy * vy) * sy);
    if (e.shiftKey || LOCKED_TYPES.has(s.type)) {
      const m = Math.max(w, hh);
      w = hh = m;
    }
    s.w = Math.round(w);
    s.h = Math.round(hh);
    s.x = Math.round(ax + (sx * w) / 2 * ux + (sy * hh) / 2 * vx);
    s.y = Math.round(ay + (sx * w) / 2 * uy + (sy * hh) / 2 * vy);
    scheduleRender();
    syncGeometryInputs();
  }
});

function endDrag() {
  if (!drag) return;
  if (drag.mode === 'pen') {
    drag = null;
    renderOverlay();
    return;
  }
  if (drag.mode === 'pencil') {
    const pts = drag.pts;
    drag = null;
    if (pts.length >= 4) {
      const nodes = blobFromPoints(pts, 2.5 / zoom);
      if (nodes.length >= 3) {
        createPathShape(nodes, true, 'pencil');
        commit();
      }
    }
    renderAll();
    return;
  }
  if (drag.mode === 'draw') {
    const s = drag.shape;
    if (s.w < 6 || s.h < 6) {
      const d = Math.round(Math.min(doc.width, doc.height) * 0.4);
      s.w = d;
      s.h = d;
      s.x = Math.round(drag.start.x);
      s.y = Math.round(drag.start.y);
    }
    setTool('select');
    panelTab = 'shape';
    renderAll();
    commit();
  } else if (drag.moved) {
    renderCanvas();
    renderPanel();
    commit();
  }
  drag = null;
}
// Listen on window too, so releasing the mouse outside the stage still finishes the drag
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
window.addEventListener('mouseup', endDrag);

stage.addEventListener('dblclick', () => { if (pen) finishPen(false); });

stage.addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  setZoom(zoom * Math.exp(-e.deltaY * 0.01));
}, { passive: false });

/* ---------- toolbar ---------- */

const HINTS = {
  select: 'Click a shape to select · drag to move · corner handles resize · round handle rotates (⇧ snaps) · on paths, drag points & handles, ⌥-click a point to switch smooth/corner',
  pen: 'Click = corner point · drag = curve (⌥ breaks handles) · click the first point to close · Enter / Esc / double-click to finish · ⌫ removes last point. On a selected path: click the line to add a point, click a point to remove it',
  pencil: 'Draw freely with the mouse — the stroke becomes a smooth, closed blob you can fill and edit',
};

function setTool(t) {
  if (pen && t !== 'pen') finishPen(false);
  tool = t;
  document.querySelectorAll('.tool[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  stage.classList.toggle('drawing', t !== 'select');
  $('#hint').textContent = HINTS[t] || `Drag on the canvas to draw a ${TYPE_NAMES[t].toLowerCase()} · ⇧ keeps proportions · click for default size`;
}

function buildToolbar() {
  const nav = $('#tools');
  for (const t of TOOLS) {
    if (!t) { nav.append(h('div', { class: 'sep' })); continue; }
    const [key, label, short] = t;
    nav.append(h('button', { class: 'tool', 'data-tool': key, title: `${label} (${short})`, onclick: () => setTool(key) },
      h('span', { html: ICONS[key] }), h('span', { class: 'key-hint' }, short)));
  }
  nav.append(
    h('div', { style: 'flex:1' }),
    h('button', { class: 'tool rand-all', title: 'Randomize all — fill the canvas with random shapes', onclick: randomizeAll },
      h('span', { html: ICONS.dice })),
    h('span', { class: 'tool-label' }, 'Random', h('br'), 'all'));
  setTool('select');
}

/* ---------- generic controls ---------- */

function paintRange(r) {
  const p = ((r.value - r.min) / (r.max - r.min)) * 100;
  r.style.setProperty('--p', clamp(p, 0, 100) + '%');
}

function rangeRow(label, value, { min, max, step }, set) {
  const num = h('input', { type: 'number', class: 'num', min, step, value });
  const rng = h('input', { type: 'range', min, max, step, value });
  paintRange(rng);
  rng.addEventListener('input', () => {
    num.value = rng.value;
    paintRange(rng);
    set(+rng.value);
    scheduleRender();
  });
  rng.addEventListener('change', commit);
  // The number box accepts values beyond the slider, so you can push settings further
  num.addEventListener('input', () => {
    if (num.value === '' || isNaN(+num.value)) return;
    const v = clamp(+num.value, min, Math.max(max * 4, max + 100));
    rng.value = v;
    paintRange(rng);
    set(v);
    scheduleRender();
  });
  num.addEventListener('change', commit);
  return h('div', { class: 'row' }, h('label', { title: label }, label), rng, num);
}

function colorRow(label, idx, palette, set) {
  const n = palette.length;
  const cur = ((Math.round(idx) % n) + n) % n;
  const wrap = h('div', { class: 'swatches' });
  palette.forEach((c, i) => {
    const b = h('button', {
      class: 'sw' + (i === cur ? ' on' : ''), style: `background:${c}`, title: c,
      onclick: () => {
        set(i);
        wrap.querySelectorAll('.sw').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        scheduleRender();
        commit();
      },
    });
    wrap.append(b);
  });
  return h('div', { class: 'row wide' }, h('label', {}, label), wrap);
}

function selectRow(label, value, options, set) {
  return h('div', { class: 'row wide' }, h('label', {}, label),
    h('select', {
      class: 'sel',
      onchange: (e) => { set(e.target.value); scheduleRender(); commit(); },
    }, options.map((o) => h('option', { value: o, selected: o === value }, o[0].toUpperCase() + o.slice(1)))));
}

function toggle(on, set) {
  const b = h('button', { class: 'toggle' + (on ? ' on' : '') });
  b.addEventListener('click', () => {
    const v = !b.classList.contains('on');
    b.classList.toggle('on', v);
    set(v);
  });
  return b;
}

function toggleRow(label, value, set) {
  return h('div', { class: 'row wide' }, h('label', {}, label),
    h('div', {}, toggle(value, (v) => { set(v); scheduleRender(); commit(); })));
}

function paramControls(schema, obj, palette) {
  return schema.map((pr) => {
    const v = obj[pr.key] ?? pr.default;
    const set = (x) => { obj[pr.key] = x; };
    switch (pr.type) {
      case 'range': return rangeRow(pr.label, v, pr, set);
      case 'color': return colorRow(pr.label, v, palette, set);
      case 'select': return selectRow(pr.label, v, pr.options, set);
      case 'bool': return toggleRow(pr.label, v, set);
    }
    return null;
  });
}

function diceBtn(onClick, label, cls = '') {
  return h('button', { class: 'dice ' + cls, title: 'Randomize me', onclick: onClick },
    h('span', { html: ICONS.dice, style: 'display:grid' }), label);
}

function section(num, title, body, actions) {
  return h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('span', { class: 'sec-num' }, num), h('h3', {}, title), h('div', { class: 'spacer' }), actions),
    body);
}

/* ---------- saved palettes (kept in the browser, shared by all projects) ---------- */

const PAL_STORE = 'muster:palettes';
let userPalettes = (() => {
  try {
    const p = JSON.parse(localStorage.getItem(PAL_STORE));
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
})();

function saveUserPalettes() {
  try { localStorage.setItem(PAL_STORE, JSON.stringify(userPalettes)); } catch { /* storage blocked */ }
}

function hslHex(hue, s, l) {
  hue = ((hue % 360) + 360) % 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// A fresh harmonious palette: one dark, one light, four accents around a colour scheme
function generatePalette() {
  const R = Math.random, base = R() * 360;
  const scheme = [[0, 30, 60, 330], [0, 180, 30, 210], [0, 120, 240, 60], [0, 150, 210, 30], [0, 20, 340, 180]][Math.floor(R() * 5)];
  return [
    hslHex(base + 200, 0.3 + R() * 0.2, 0.1 + R() * 0.06),
    hslHex(base + 30, 0.35, 0.94),
    ...scheme.map((o) => hslHex(base + o, 0.6 + R() * 0.35, 0.5 + R() * 0.17)),
    hslHex(base + scheme[1] + 15, 0.45, 0.8),
  ];
}

function nextPaletteName() {
  let n = 1;
  while (userPalettes.some((p) => p.name === `My palette ${n}`)) n++;
  return `My palette ${n}`;
}

/* ---------- palette editor ---------- */

function paletteEditor(arr, key) {
  if (paletteSel[key] == null || paletteSel[key] >= arr.length) paletteSel[key] = 0;
  const i = paletteSel[key];
  const presetBtn = (p, own) => h('div', { class: 'preset-wrap' },
    h('button', {
      class: 'preset' + (own ? ' own' : ''), title: `Load "${p.name}"`,
      onclick: () => { arr.splice(0, arr.length, ...p.colors); paletteSel[key] = 0; commit(); renderAll(); },
    }, h('div', { class: 'strip' }, p.colors.map((c) => h('i', { style: `background:${c}` }))), h('span', {}, p.name)),
    own ? h('button', {
      class: 'preset-del', title: `Delete "${p.name}"`,
      onclick: () => {
        userPalettes = userPalettes.filter((x) => x !== p);
        saveUserPalettes();
        renderPanel();
        toast(`Deleted "${p.name}"`, { label: 'Undo', run: () => { userPalettes.push(p); saveUserPalettes(); renderPanel(); } });
      },
    }, '✕') : null);
  const presets = h('div', { class: 'presets' }, PALETTES.map((p) => presetBtn(p, false)), userPalettes.map((p) => presetBtn(p, true)));

  const paletteActions = key === 'global' ? h('div', { class: 'btn-row', style: 'margin-bottom:12px' },
    h('button', {
      class: 'btn small', title: 'Create a new random palette, use it for the whole artwork and save it to your presets',
      onclick: () => {
        const p = { name: nextPaletteName(), colors: generatePalette() };
        userPalettes.push(p);
        saveUserPalettes();
        arr.splice(0, arr.length, ...p.colors);
        paletteSel[key] = 0;
        commit();
        renderAll();
        toast(`Created "${p.name}" — edit its colors below, then “Save as preset” to keep the changes`);
      },
    }, '+ New palette'),
    h('button', {
      class: 'btn small', title: 'Save the current global colors as a new preset',
      onclick: () => {
        const p = { name: nextPaletteName(), colors: [...arr] };
        userPalettes.push(p);
        saveUserPalettes();
        renderPanel();
        toast(`Saved as "${p.name}"`);
      },
    }, 'Save as preset')) : null;

  const swatches = h('div', { class: 'swatches' },
    arr.map((c, j) => h('button', {
      class: 'sw big' + (j === i ? ' on' : ''), style: `background:${c}`, title: `${c} · color ${j + 1}`,
      onclick: () => { paletteSel[key] = j; renderPanel(); },
    })),
    h('button', {
      class: 'sw big add', title: 'Add a color',
      onclick: () => { arr.push(arr[i] || '#ff7a5c'); paletteSel[key] = arr.length - 1; commit(); renderAll(); },
    }, '+'));

  const picker = h('input', { type: 'color', value: normHex(arr[i] || '#000000') });
  const hex = h('input', { class: 'text', value: arr[i] || '', placeholder: '#ff7a5c', spellcheck: 'false' });
  picker.addEventListener('input', () => {
    arr[i] = picker.value;
    hex.value = picker.value;
    swatches.children[i].style.background = picker.value;
    scheduleRender();
  });
  picker.addEventListener('change', () => { commit(); renderPanel(); });
  hex.addEventListener('change', () => {
    if (!isHex(hex.value)) { hex.value = arr[i]; toast('Use a hex color like #ff7a5c'); return; }
    arr[i] = normHex(hex.value);
    commit();
    renderAll();
  });
  const remove = h('button', {
    class: 'icon-btn danger', title: 'Remove this color', disabled: arr.length <= 1,
    onclick: () => { arr.splice(i, 1); paletteSel[key] = Math.max(0, i - 1); commit(); renderAll(); },
  }, '✕');

  return h('div', {}, presets, paletteActions, swatches, h('div', { class: 'pal-edit' }, picker, hex, remove));
}

/* ---------- document panel ---------- */

function numField(label, value, set, geoKey) {
  const inp = h('input', { type: 'number', class: 'num', value: Math.round(value * 100) / 100, 'data-geo': geoKey });
  inp.addEventListener('input', () => {
    if (inp.value === '' || isNaN(+inp.value)) return;
    set(+inp.value);
    scheduleRender();
  });
  inp.addEventListener('change', () => { commit(); renderOverlay(); });
  return h('label', { class: 'field' }, h('span', {}, label), inp);
}

function docPanel() {
  const sizeSel = h('select', {
    class: 'sel',
    onchange: (e) => {
      const s = SIZES[e.target.value];
      if (!s) return;
      doc.width = s[1];
      doc.height = s[2];
      commit();
      renderCanvas();
      fit();
    },
  }, h('option', { value: '' }, 'Choose a preset…'), SIZES.map((s, i) => h('option', { value: i }, `${s[0]} — ${s[1]}×${s[2]}`)));

  const dim = (label, key) => {
    const inp = h('input', { type: 'number', class: 'num', value: doc[key], min: 16, max: 8000 });
    inp.addEventListener('change', () => {
      doc[key] = clamp(Math.round(+inp.value || doc[key]), 16, 8000);
      inp.value = doc[key];
      commit();
      renderCanvas();
      fit();
    });
    return h('label', { class: 'field' }, h('span', {}, label), inp);
  };

  const bgPicker = h('input', { type: 'color', value: normHex(doc.background) });
  const bgHex = h('input', { class: 'text', value: doc.background, spellcheck: 'false' });
  bgPicker.addEventListener('input', () => { doc.background = bgPicker.value; bgHex.value = bgPicker.value; scheduleRender(); });
  bgPicker.addEventListener('change', commit);
  bgHex.addEventListener('change', () => {
    if (!isHex(bgHex.value)) { bgHex.value = doc.background; return; }
    doc.background = normHex(bgHex.value);
    bgPicker.value = doc.background;
    scheduleRender();
    commit();
  });
  const bgChips = h('div', { class: 'swatches' }, ['#ffffff', '#f6f4ef', ...doc.palette].map((c) =>
    h('button', { class: 'sw', style: `background:${c}`, title: c, onclick: () => { doc.background = c; commit(); renderAll(); } })));

  const objects = doc.shapes.length
    ? h('div', { class: 'objects' }, [...doc.shapes].reverse().map((s) =>
      h('div', {
        class: 'obj' + (s.id === selectedId ? ' on' : ''),
        onclick: () => { selectedId = s.id; panelTab = 'shape'; renderPanel(); renderOverlay(); },
      },
      h('span', { class: 'shape-icon', html: ICONS[s.type] }),
      h('span', { class: 'nm' }, s.name),
      h('span', { class: 'meta' }, s.layers.map((l) => TECHNIQUES[l.technique]?.name).join(' + ')),
      h('button', {
        class: 'icon-btn', title: s.hidden ? 'Show' : 'Hide', html: s.hidden ? ICONS.eyeOff : ICONS.eye,
        onclick: (e) => { e.stopPropagation(); s.hidden = !s.hidden; commit(); renderAll(); },
      }))))
    : h('div', { class: 'empty' }, 'The canvas is empty. Pick a shape on the left and drag on the canvas to draw it.');

  return [
    section('01', 'Canvas', [
      h('div', { class: 'row wide' }, h('label', {}, 'Size preset'), sizeSel),
      h('div', { class: 'geo-grid', style: 'grid-template-columns:1fr 1fr;margin-top:8px' }, dim('W', 'width'), dim('H', 'height')),
      h('div', { class: 'row wide' }, h('label', {}, 'Background'), h('div', { class: 'bg-row' }, bgPicker, bgHex)),
      h('div', { class: 'row wide' }, h('label', {}, ''), bgChips),
    ]),
    section('02', 'Global palette', paletteEditor(doc.palette, 'global')),
    section('03', 'Objects', objects),
  ];
}

/* ---------- shape panel ---------- */

function randomizeShape(s) {
  const n = effectivePalette(doc, s).length;
  for (const l of s.layers) {
    l.params = randomizeSchema(TECHNIQUES[l.technique].params, n, l.params);
    l.seed = randSeed();
  }
  for (const k of Object.keys(EFFECT_DEFS)) {
    if (s.effects[k].on) Object.assign(s.effects[k], randomizeSchema(EFFECT_DEFS[k], n));
  }
}

function layerCard(s, layer, idx, pal) {
  const tech = TECHNIQUES[layer.technique];
  const p = { ...defaultsOf(tech.params), ...layer.params };
  layer.params = p;
  const update = () => { commit(); renderPanel(); scheduleRender(); };

  const techSel = h('select', {
    class: 'sel',
    onchange: (e) => {
      const t = TECHNIQUES[e.target.value];
      layer.technique = e.target.value;
      layer.params = randomizeSchema(t.params, pal.length, defaultsOf(t.params));
      update();
    },
  }, TECH_ORDER.map((k) => h('option', { value: k, selected: k === layer.technique }, TECHNIQUES[k].name)));

  const head = h('div', { class: 'card-head' },
    h('button', {
      class: 'icon-btn', title: layer.collapsed ? 'Expand' : 'Collapse',
      onclick: () => { layer.collapsed = !layer.collapsed; renderPanel(); },
    }, layer.collapsed ? '▸' : '▾'),
    techSel,
    diceBtn(() => {
      layer.params = randomizeSchema(tech.params, pal.length, p);
      layer.seed = randSeed();
      update();
    }, null, 'mini'),
    h('button', {
      class: 'icon-btn', title: layer.visible === false ? 'Show layer' : 'Hide layer',
      html: layer.visible === false ? ICONS.eyeOff : ICONS.eye,
      onclick: () => { layer.visible = layer.visible === false; update(); },
    }),
    h('button', {
      class: 'icon-btn', title: 'Move up', disabled: idx === s.layers.length - 1,
      onclick: () => { s.layers.splice(idx, 1); s.layers.splice(idx + 1, 0, layer); update(); },
    }, '↑'),
    h('button', {
      class: 'icon-btn', title: 'Move down', disabled: idx === 0,
      onclick: () => { s.layers.splice(idx, 1); s.layers.splice(idx - 1, 0, layer); update(); },
    }, '↓'),
    h('button', {
      class: 'icon-btn danger', title: 'Remove layer',
      onclick: () => { s.layers.splice(idx, 1); update(); },
    }, '✕'));

  if (layer.collapsed) return h('div', { class: 'card' }, head);

  const seedInp = h('input', { type: 'number', class: 'num', value: layer.seed });
  seedInp.addEventListener('change', () => { layer.seed = Math.round(+seedInp.value) || 0; scheduleRender(); commit(); });

  const body = h('div', { class: 'card-body' },
    rangeRow('Opacity', layer.opacity ?? 1, { min: 0, max: 1, step: 0.01 }, (v) => { layer.opacity = v; }),
    h('div', { class: 'row wide' }, h('label', {}, 'Seed'),
      h('div', { class: 'seed-row' }, seedInp,
        h('button', { class: 'btn small', title: 'New seed, same settings', onclick: () => { layer.seed = randSeed(); update(); } }, 'New seed'))),
    h('div', { class: 'divider' }),
    paramControls(tech.params, p, pal),
    h('div', { style: 'margin-top:12px' },
      diceBtn(() => {
        layer.params = randomizeSchema(tech.params, pal.length, p);
        layer.seed = randSeed();
        update();
      }, `Randomize ${tech.name.toLowerCase()}`)));

  return h('div', { class: 'card' }, head, body);
}

function effectCard(s, key, label, pal) {
  const fx = s.effects[key];
  const update = () => { commit(); renderPanel(); scheduleRender(); };
  return h('div', { class: 'card' + (fx.on ? '' : ' off') },
    h('div', { class: 'card-head' },
      toggle(fx.on, (v) => { fx.on = v; update(); }),
      h('span', { class: 'card-title' }, label),
      diceBtn(() => { Object.assign(fx, randomizeSchema(EFFECT_DEFS[key], pal.length)); fx.on = true; update(); }, null, 'mini')),
    fx.on ? h('div', { class: 'card-body' }, paramControls(EFFECT_DEFS[key], fx, pal)) : null);
}

function shapePanel(s) {
  const pal = effectivePalette(doc, s);
  const g = (label, key, opts = {}) => numField(label, s[key], (v) => {
    s[key] = opts.min != null ? Math.max(opts.min, v) : v;
    if (LOCKED_TYPES.has(s.type) && (key === 'w' || key === 'h')) { s.w = s[key]; s.h = s[key]; }
    if (key === 'rotation' || key === 'x' || key === 'y') moveInPlace(s);
  }, key);

  const typeRows = [];
  if (s.type === 'polygon') typeRows.push(rangeRow('Sides', s.sides, { min: 3, max: 24, step: 1 }, (v) => { s.sides = v; }));
  if (s.type === 'star') {
    typeRows.push(rangeRow('Points', s.points, { min: 3, max: 24, step: 1 }, (v) => { s.points = v; }));
    typeRows.push(rangeRow('Inner radius', s.inner, { min: 0.05, max: 0.95, step: 0.01 }, (v) => { s.inner = v; }));
  }
  if (s.type === 'path') {
    const reshape = (fn) => () => {
      const abs = pathAbs(s);
      abs.forEach((_, i) => fn(abs, i));
      setPathAbs(s, abs);
      commit();
      renderAll();
    };
    typeRows.push(toggleRow('Closed path', s.closed !== false, (v) => { s.closed = v; setPathAbs(s, pathAbs(s)); }));
    typeRows.push(h('div', { class: 'btn-row', style: 'margin:8px 0' },
      h('button', { class: 'btn small', onclick: reshape((abs, i) => autoHandles(abs, i, s.closed !== false)) }, 'Smooth all points'),
      h('button', { class: 'btn small', onclick: reshape((abs, i) => Object.assign(abs[i], { ix: 0, iy: 0, ox: 0, oy: 0, smooth: false })) }, 'Make all corners')));
    typeRows.push(h('div', { class: 'empty' },
      `${s.nodes.length} points. Select tool: drag points and handles, ⌥-click a point to switch smooth / corner, ⌫ deletes the selected point. Pen tool: click the line to add a point, click a point to remove it.`));
  }
  if (s.type === 'rect' || s.type === 'square') {
    typeRows.push(rangeRow('Corner radius', s.corner || 0, { min: 0, max: Math.round(Math.min(s.w, s.h) / 2), step: 1 }, (v) => { s.corner = v; }));
  }

  const strokeRows = [toggleRow('Outline', s.stroke.on, (v) => { s.stroke.on = v; renderPanel(); })];
  if (s.stroke.on) {
    strokeRows.push(rangeRow('Outline width', s.stroke.width, { min: 0.5, max: 40, step: 0.5 }, (v) => { s.stroke.width = v; }));
    strokeRows.push(colorRow('Outline color', s.stroke.color, pal, (v) => { s.stroke.color = v; }));
  }

  const custom = !!(s.palette && s.palette.length);
  const paletteBody = h('div', {},
    h('div', { class: 'seg', style: 'margin-bottom:12px' },
      h('button', { class: custom ? '' : 'on', onclick: () => { s.palette = null; commit(); renderAll(); } }, 'Use global'),
      h('button', { class: custom ? 'on' : '', onclick: () => { if (!custom) { s.palette = [...doc.palette]; commit(); renderAll(); } } }, 'Custom for this shape')),
    custom ? paletteEditor(s.palette, s.id) : h('div', { class: 'swatches' }, doc.palette.map((c) => h('span', { class: 'sw', style: `background:${c};cursor:default` }))));

  const addLayer = h('select', {
    class: 'sel',
    onchange: (e) => {
      const v = e.target.value;
      if (!v) return;
      s.layers.push(newLayer(v === 'random' ? randomTechnique() : v, pal.length));
      commit();
      renderPanel();
      scheduleRender();
    },
  }, h('option', { value: '' }, '+ Add fill layer…'), h('option', { value: 'random' }, '🎲 Random technique'),
  TECH_ORDER.map((k) => h('option', { value: k }, TECHNIQUES[k].name)));

  const layers = h('div', { class: 'cards' }, [...s.layers].map((l, i) => [l, i]).reverse().map(([l, i]) => layerCard(s, l, i, pal)));

  return [
    h('div', { class: 'shape-head' },
      h('div', { class: 'shape-title' },
        h('span', { class: 'shape-icon', html: ICONS[s.type] }),
        h('input', { class: 'name-input', value: s.name, onchange: (e) => { s.name = e.target.value; commit(); } })),
      h('div', {}, diceBtn(() => { randomizeShape(s); commit(); renderAll(); }, 'Randomize me', 'big')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn small', onclick: duplicateSel, title: '⌘D' }, 'Duplicate'),
        h('button', { class: 'btn small', onclick: () => arrange(1) }, 'Bring forward'),
        h('button', { class: 'btn small', onclick: () => arrange(-1) }, 'Send back'),
        h('button', { class: 'btn small danger', onclick: deleteSel, title: 'Delete' }, 'Delete'))),
    section('01', 'Geometry', [
      h('div', { class: 'geo-grid' }, g('X', 'x'), g('Y', 'y'), g('↻', 'rotation'), g('W', 'w', { min: 4 }), g('H', 'h', { min: 4 })),
      typeRows,
      strokeRows,
    ]),
    section('02', 'Palette', paletteBody),
    section('03', 'Fill layers', [
      s.layers.length ? layers : h('div', { class: 'empty' }, 'No fill yet — add a layer below.'),
      h('div', { class: 'add-layer' }, addLayer),
    ]),
    section('04', 'Effects', [
      h('div', { class: 'cards' }, effectCard(s, 'glow', 'Glow', pal), effectCard(s, 'halo', 'Halo', pal), effectCard(s, 'grain', 'Grain', pal)),
      h('div', { class: 'empty', style: 'margin-top:10px' }, 'Effects show in the editor and PNG export. SVG export is pure vector, so they are left out.'),
    ]),
  ];
}

function syncGeometryInputs() {
  const s = sel();
  if (!s) return;
  document.querySelectorAll('[data-geo]').forEach((inp) => {
    if (document.activeElement !== inp) inp.value = Math.round(s[inp.dataset.geo] * 100) / 100;
  });
}

/* ---------- panel ---------- */

const panel = $('#panel');
let lastPanelKey = '';

function renderPanel() {
  const s = sel();
  if (!s && panelTab === 'shape') panelTab = 'doc';
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.classList.toggle('on', b.dataset.tab === panelTab);
    if (b.dataset.tab === 'shape') b.disabled = !s;
  });
  const key = panelTab + (s ? s.id : '');
  const scroll = key === lastPanelKey ? panel.scrollTop : 0;
  lastPanelKey = key;
  panel.innerHTML = '';
  panel.append(...(panelTab === 'shape' && s ? shapePanel(s) : docPanel()).flat());
  panel.scrollTop = scroll;
}

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  panelTab = b.dataset.tab;
  renderPanel();
}));

function renderAll() {
  renderCanvas();
  renderPanel();
  updateUndoButtons();
}

/* ---------- actions ---------- */

function deleteSel() {
  if (!sel()) return;
  doc.shapes = doc.shapes.filter((s) => s.id !== selectedId);
  selectedId = null;
  commit();
  renderAll();
}

function duplicateSel() {
  const s = sel();
  if (!s) return;
  const copy = JSON.parse(JSON.stringify(s));
  copy.id = uid('s');
  copy.name = s.name + ' copy';
  copy.x += 30;
  copy.y += 30;
  copy.layers.forEach((l) => { l.id = uid('l'); });
  doc.shapes.splice(doc.shapes.indexOf(s) + 1, 0, copy);
  selectedId = copy.id;
  commit();
  renderAll();
}

function arrange(dir) {
  const s = sel();
  if (!s) return;
  const i = doc.shapes.indexOf(s), j = clamp(i + dir, 0, doc.shapes.length - 1);
  if (i === j) return;
  doc.shapes.splice(i, 1);
  doc.shapes.splice(j, 0, s);
  commit();
  renderAll();
}

function saveProject() {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'muster-project.json' });
  document.body.append(a);
  a.click();
  a.remove();
}

// No confirm() dialogs (some browsers block them); every change can be undone instead
function resetSelection() {
  selectedId = null;
  selNode = null;
  pen = null;
  panelTab = 'doc';
}

$('#btn-new').addEventListener('click', () => {
  doc = newDoc();
  resetSelection();
  commit();
  renderAll();
  fit();
  toast('New empty canvas', { label: 'Undo', run: undo });
});
$('#btn-clear').addEventListener('click', () => {
  if (!doc.shapes.length) { toast('The canvas is already empty'); return; }
  doc.shapes = [];
  resetSelection();
  commit();
  renderAll();
  toast('Canvas cleared', { label: 'Undo', run: undo });
});
$('#btn-save').addEventListener('click', saveProject);
$('#btn-open').addEventListener('click', () => $('#file-open').click());
$('#file-open').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d || !Array.isArray(d.shapes) || !d.width || !d.height) throw new Error('bad file');
    doc = d;
    selectedId = null;
    commit();
    renderAll();
    fit();
    toast(`Opened ${f.name}`);
  } catch {
    toast('That file is not a Muster project.');
  }
});
$('#btn-undo').addEventListener('click', undo);
$('#btn-redo').addEventListener('click', redo);
$('#btn-svg').addEventListener('click', () => { exportSVG(doc); toast('SVG exported (vector only, no glow / halo / grain)'); });
$('#btn-png').addEventListener('click', async () => {
  const scale = +$('#png-scale').value;
  const btn = $('#btn-png');
  btn.disabled = true;
  btn.textContent = 'Rendering…';
  try {
    await exportPNG(doc, scale);
  } catch (err) {
    console.error(err);
    toast('PNG export failed — try a smaller scale.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Export PNG';
  }
});
$('#zoom-in').addEventListener('click', () => setZoom(zoom * 1.25));
$('#zoom-out').addEventListener('click', () => setZoom(zoom / 1.25));
$('#zoom-label').addEventListener('click', fit);
window.addEventListener('resize', () => { if (fitMode) fit(); });

window.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === 's') { e.preventDefault(); saveProject(); return; }
  if (typing) return;
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'd') { e.preventDefault(); duplicateSel(); return; }
  if (mod) return;
  const s = sel();
  if (pen) {
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); finishPen(false); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      pen.nodes.pop();
      if (!pen.nodes.length) pen = null;
      renderOverlay();
      return;
    }
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    if (s?.type === 'path' && selNode != null && s.nodes.length > 2) {
      const abs = pathAbs(s);
      abs.splice(selNode, 1);
      selNode = null;
      setPathAbs(s, abs);
      commit();
      renderAll();
    } else deleteSel();
    return;
  }
  if (e.key === 'Escape') {
    if (selNode != null) { selNode = null; renderOverlay(); return; }
    selectedId = null;
    setTool('select');
    renderPanel();
    renderOverlay();
    return;
  }
  if (s && e.key.startsWith('Arrow')) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') s.x -= d;
    if (e.key === 'ArrowRight') s.x += d;
    if (e.key === 'ArrowUp') s.y -= d;
    if (e.key === 'ArrowDown') s.y += d;
    moveInPlace(s);
    syncGeometryInputs();
    commit();
    return;
  }
  const t = TOOLS.find((x) => x && x[2].toLowerCase() === k);
  if (t) setTool(t[0]);
});

/* ---------- boot ---------- */

buildToolbar();
commit();
renderAll();
requestAnimationFrame(fit);
