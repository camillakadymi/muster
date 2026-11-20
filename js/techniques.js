// Pattern techniques. Each one has a settings schema (drives the UI + randomizer)
// and gen(ctx) which returns SVG markup drawn in the shape's local box:
// x from -w/2 to w/2, y from -h/2 to h/2. The renderer clips it to the shape.

import { smoothPath, smoothOpen, fmt } from './geometry.js';

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

const R = (key, label, min, max, step, def, extra = {}) => ({ key, label, type: 'range', min, max, step, default: def, ...extra });
const C = (key, label, def) => ({ key, label, type: 'color', default: def });
const S = (key, label, options, def) => ({ key, label, type: 'select', options, default: def });
const B = (key, label, def, extra = {}) => ({ key, label, type: 'bool', default: def, ...extra });

// Shared "background" settings used by most techniques
const BG = (def = 0) => [B('bgOn', 'Background', true, { fixed: true }), C('bg', 'Background color', def)];

/* ---------- colour helpers ---------- */

export function hexToRgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function lerpColor(a, b, t) {
  const A = hexToRgb(a), Bc = hexToRgb(b);
  return '#' + A.map((v, i) => Math.round(v + (Bc[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

function sampleStops(stops, t) {
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i], [b, cb] = stops[i + 1];
    if (t <= b) return lerpColor(ca, cb, b === a ? 0 : clamp((t - a) / (b - a)));
  }
  return stops[stops.length - 1][1];
}

const rect = (x, y, w, h, fill) => `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" fill="${fill}"/>`;
const bgRect = (c) => (c.p.bgOn === false ? '' : rect(c.x0, c.y0, c.w, c.h, c.col(c.p.bg)));

/* ---------- noise field + marching squares (used by contours & spots) ---------- */

function field(c, { scale, octaves, warp, res }) {
  const { w, h, x0, y0, noise, M } = c;
  const cell = M / Math.max(10, res);
  const nx = Math.ceil(w / cell) + 2, ny = Math.ceil(h / cell) + 2;
  const ox = x0 - cell, oy = y0 - cell;
  const W = nx + 3, H = ny + 3; // one cell of padding all round keeps every contour closed
  const G = new Float32Array(W * H).fill(-1);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      let X = ((ox + i * cell) / M) * scale, Y = ((oy + j * cell) / M) * scale;
      if (warp) {
        const wx = noise.fbm(X + 5.2, Y + 1.3, 2), wy = noise.fbm(X + 8.3, Y + 2.8, 2);
        X += warp * wx * 2;
        Y += warp * wy * 2;
      }
      const v = noise.fbm(X, Y, octaves);
      G[(j + 1) * W + i + 1] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  const span = hi - lo || 1;
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const k = (j + 1) * W + i + 1;
    G[k] = (G[k] - lo) / span;
  }
  const toWorld = (gi, gj) => [ox + (gi - 1) * cell, oy + (gj - 1) * cell];
  return { G, W, H, toWorld };
}

// Closed outlines of the region where field >= level
function marching({ G, W, H, toWorld }, level) {
  const adj = new Map(), pos = new Map();
  const at = (i, j) => G[j * W + i];
  const point = (key, ax, ay, bx, by) => {
    if (!pos.has(key)) {
      const va = at(ax, ay), vb = at(bx, by);
      const t = (level - va) / (vb - va);
      pos.set(key, toWorld(ax + (bx - ax) * t, ay + (by - ay) * t));
    }
    return key;
  };
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  };
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const c = (at(i, j) >= level) * 8 + (at(i + 1, j) >= level) * 4 + (at(i + 1, j + 1) >= level) * 2 + (at(i, j + 1) >= level);
      if (c === 0 || c === 15) continue;
      const base = (j * W + i) * 2;
      const T = () => point(base, i, j, i + 1, j);
      const Rr = () => point(((j * W) + i + 1) * 2 + 1, i + 1, j, i + 1, j + 1);
      const Bb = () => point(((j + 1) * W + i) * 2, i, j + 1, i + 1, j + 1);
      const L = () => point(base + 1, i, j, i, j + 1);
      switch (c) {
        case 1: case 14: link(L(), Bb()); break;
        case 2: case 13: link(Bb(), Rr()); break;
        case 3: case 12: link(L(), Rr()); break;
        case 4: case 11: link(T(), Rr()); break;
        case 6: case 9: link(T(), Bb()); break;
        case 7: case 8: link(L(), T()); break;
        case 5: link(L(), Bb()); link(T(), Rr()); break;
        case 10: link(L(), T()); link(Bb(), Rr()); break;
      }
    }
  }
  const loops = [], seen = new Set();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let prev = -1, cur = start;
    for (;;) {
      seen.add(cur);
      loop.push(pos.get(cur));
      const nb = adj.get(cur);
      const next = nb[0] !== prev ? nb[0] : nb[1];
      if (next === undefined || seen.has(next)) break;
      prev = cur;
      cur = next;
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

/* ---------- Voronoi ---------- */

function clipHalf(poly, s, nx, ny, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = (a[0] - s[0]) * nx + (a[1] - s[1]) * ny - c;
    const db = (b[0] - s[0]) * nx + (b[1] - s[1]) * ny - c;
    if (da <= 0) out.push(a);
    if ((da <= 0) !== (db <= 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function voronoiCells(pts, x0, y0, x1, y1, gap) {
  return pts.map((s, i) => {
    let poly = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const others = [];
    for (let j = 0; j < pts.length; j++) {
      if (j !== i) others.push([j, (pts[j][0] - s[0]) ** 2 + (pts[j][1] - s[1]) ** 2]);
    }
    others.sort((a, b) => a[1] - b[1]);
    for (const [j, d2] of others) {
      let maxR2 = 0;
      for (const v of poly) maxR2 = Math.max(maxR2, (v[0] - s[0]) ** 2 + (v[1] - s[1]) ** 2);
      if (d2 / 4 > maxR2) break; // no further neighbour can cut this cell
      const d = Math.sqrt(d2) || 1e-6;
      poly = clipHalf(poly, s, (pts[j][0] - s[0]) / d, (pts[j][1] - s[1]) / d, d / 2 - gap / 2);
      if (poly.length < 3) break;
    }
    return poly;
  });
}

function centroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-9) return poly[0];
  return [cx / (3 * a), cy / (3 * a)];
}

/* ---------- techniques ---------- */

export const TECHNIQUES = {
  solid: {
    name: 'Solid',
    params: [C('color', 'Color', 1)],
    gen: (c) => rect(c.x0, c.y0, c.w, c.h, c.col(c.p.color)),
  },

  linear: {
    name: 'Linear gradient',
    params: [
      R('angle', 'Angle', 0, 360, 1, 90),
      C('c1', 'Color A', 1), C('c2', 'Color B', 4), C('c3', 'Color C', 3),
      B('three', 'Use color C', true),
      R('mid', 'Midpoint', 0.05, 0.95, 0.01, 0.5),
      R('bands', 'Bands (0 = smooth)', 0, 40, 1, 0, { rmax: 14 }),
    ],
    gen(c) {
      const { p, w, h, col } = c;
      const a = (p.angle * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
      const L = (Math.abs(w * dx) + Math.abs(h * dy)) / 2 || 1;
      const stops = p.three ? [[0, col(p.c1)], [p.mid, col(p.c2)], [1, col(p.c3)]] : [[0, col(p.c1)], [1, col(p.c2)]];
      if (p.bands < 2) {
        const id = `lg-${c.uid}`;
        return `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmt(-dx * L)}" y1="${fmt(-dy * L)}" x2="${fmt(dx * L)}" y2="${fmt(dy * L)}">` +
          stops.map((s) => `<stop offset="${s[0]}" stop-color="${s[1]}"/>`).join('') +
          `</linearGradient></defs>` + rect(c.x0, c.y0, w, h, `url(#${id})`);
      }
      const n = Math.round(p.bands), D = Math.hypot(w, h), bw = (2 * L) / n;
      let s = `<g transform="rotate(${fmt(p.angle)})">`;
      for (let i = 0; i < n; i++) s += rect(-L + i * bw, -D / 2, bw + 0.5, D, sampleStops(stops, (i + 0.5) / n));
      return s + '</g>';
    },
  },

  radial: {
    name: 'Radial gradient',
    params: [
      R('cx', 'Center X', -0.5, 0.5, 0.01, 0), R('cy', 'Center Y', -0.5, 0.5, 0.01, 0),
      R('radius', 'Radius', 0.1, 1.5, 0.01, 0.75, { rmin: 0.4, rmax: 1.1 }),
      C('c1', 'Inner', 1), C('c2', 'Middle', 3), C('c3', 'Outer', 5),
      B('three', 'Use middle', true),
      R('mid', 'Middle position', 0.05, 0.95, 0.01, 0.5),
      R('bands', 'Rings (0 = smooth)', 0, 40, 1, 0, { rmax: 14 }),
    ],
    gen(c) {
      const { p, w, h, col } = c;
      const cx = p.cx * w, cy = p.cy * h, r = (p.radius * Math.hypot(w, h)) / 2;
      const stops = p.three ? [[0, col(p.c1)], [p.mid, col(p.c2)], [1, col(p.c3)]] : [[0, col(p.c1)], [1, col(p.c3)]];
      if (p.bands < 2) {
        const id = `rg-${c.uid}`;
        return `<defs><radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}">` +
          stops.map((s) => `<stop offset="${s[0]}" stop-color="${s[1]}"/>`).join('') +
          `</radialGradient></defs>` + rect(c.x0, c.y0, w, h, `url(#${id})`);
      }
      const n = Math.round(p.bands);
      let s = rect(c.x0, c.y0, w, h, stops[stops.length - 1][1]);
      for (let i = n - 1; i >= 0; i--) s += `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(((i + 1) / n) * r)}" fill="${sampleStops(stops, (i + 0.5) / n)}"/>`;
      return s;
    },
  },

  halftone: {
    name: 'Halftone',
    params: [
      R('spacing', 'Grid spacing', 6, 80, 1, 18, { rmin: 9, rmax: 36 }),
      R('dotMax', 'Max dot size', 0.1, 1.5, 0.01, 0.95, { rmin: 0.6 }),
      R('dotMin', 'Min dot size', 0, 0.6, 0.01, 0),
      R('gridAngle', 'Grid angle', 0, 90, 1, 45),
      S('mode', 'Size follows', ['linear', 'radial', 'noise', 'uniform'], 'linear'),
      R('gradAngle', 'Gradient angle', 0, 360, 1, 135),
      R('noiseScale', 'Noise scale', 0.5, 10, 0.1, 2.5),
      R('gamma', 'Contrast', 0.3, 3, 0.05, 1),
      B('invert', 'Invert', false),
      S('dot', 'Dot shape', ['circle', 'square', 'diamond'], 'circle'),
      ...BG(4), C('color', 'Dot color', 0),
    ],
    gen(c) {
      const { p, w, h, x0, y0, col, noise, M } = c;
      const s = Math.max(3, p.spacing), D = Math.hypot(w, h) / 2 + s;
      const ga = (p.gridAngle * Math.PI) / 180, ca = Math.cos(ga), sa = Math.sin(ga);
      const g = (p.gradAngle * Math.PI) / 180, gx = Math.cos(g), gy = Math.sin(g);
      const ext = (Math.abs(w * gx) + Math.abs(h * gy)) / 2 || 1, rad = Math.hypot(w, h) / 2;
      let out = '';
      for (let v = -D; v <= D; v += s) {
        for (let u = -D; u <= D; u += s) {
          const x = u * ca - v * sa, y = u * sa + v * ca;
          if (x < x0 - s || x > -x0 + s || y < y0 - s || y > -y0 + s) continue;
          let t;
          if (p.mode === 'linear') t = ((x * gx + y * gy) / ext + 1) / 2;
          else if (p.mode === 'radial') t = 1 - Math.hypot(x, y) / rad;
          else if (p.mode === 'noise') t = noise.fbm((x / M) * p.noiseScale, (y / M) * p.noiseScale, 3) * 1.6 + 0.5;
          else t = 1;
          t = clamp(t);
          if (p.invert) t = 1 - t;
          t = Math.pow(t, p.gamma);
          const r = (s / 2) * (p.dotMin + (p.dotMax - p.dotMin) * t);
          if (r < 0.3) continue;
          if (p.dot === 'circle') out += `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(r)}"/>`;
          else {
            const a0 = ga + (p.dot === 'diamond' ? Math.PI / 4 : 0);
            const pts = [0, 1, 2, 3].map((k) => {
              const a = a0 + Math.PI / 4 + (k * Math.PI) / 2, rr = r * Math.SQRT2;
              return `${fmt(x + Math.cos(a) * rr)},${fmt(y + Math.sin(a) * rr)}`;
            });
            out += `<polygon points="${pts.join(' ')}"/>`;
          }
        }
      }
      return bgRect(c) + `<g fill="${col(p.color)}">${out}</g>`;
    },
  },

  voronoi: {
    name: 'Voronoi cells',
    params: [
      R('count', 'Cells', 3, 400, 1, 60, { rmin: 12, rmax: 140 }),
      R('relax', 'Relax (evenness)', 0, 5, 1, 2),
      R('gap', 'Gap', 0, 40, 0.5, 8, { rmax: 18 }),
      R('roundness', 'Roundness', 0, 1, 0.01, 0.8),
      S('style', 'Style', ['fill', 'outline'], 'fill'),
      R('lineWidth', 'Outline width', 0.5, 12, 0.5, 2),
      S('colorMode', 'Cell colors', ['two colors', 'palette'], 'two colors'),
      C('cell', 'Cell color', 2), C('cell2', 'Second color', 3),
      R('mix', 'Second color amount', 0, 1, 0.01, 0.15),
      ...BG(1),
    ],
    gen(c) {
      const { p, x0, y0, rng, col } = c;
      const n = Math.max(2, Math.round(p.count));
      let pts = Array.from({ length: n }, () => [rng.range(x0, -x0), rng.range(y0, -y0)]);
      for (let k = 0; k < p.relax; k++) pts = voronoiCells(pts, x0, y0, -x0, -y0, 0).map((poly, i) => (poly.length > 2 ? centroid(poly) : pts[i]));
      const cells = voronoiCells(pts, x0, y0, -x0, -y0, p.gap);
      let s = bgRect(c);
      for (const poly of cells) {
        if (poly.length < 3) continue;
        const color = p.colorMode === 'palette' ? col(rng.int(0, 99)) : rng.next() < p.mix ? col(p.cell2) : col(p.cell);
        const d = smoothPath(poly, p.roundness);
        s += p.style === 'outline'
          ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="${p.lineWidth}" stroke-linejoin="round"/>`
          : `<path d="${d}" fill="${color}"/>`;
      }
      return s;
    },
  },

  network: {
    name: 'Network',
    params: [
      R('nodes', 'Nodes', 3, 300, 1, 45, { rmin: 10, rmax: 90 }),
      S('mode', 'Connections', ['tree', 'nearest', 'tree + nearest'], 'tree + nearest'),
      R('links', 'Nearest links', 1, 6, 1, 1, { rmax: 3 }),
      R('nodeSize', 'Node size', 1, 60, 0.5, 14, { rmin: 5, rmax: 26 }),
      R('rings', 'Rings per node', 1, 6, 1, 3),
      R('sizeJitter', 'Size variation', 0, 1, 0.01, 0.3),
      R('lineWidth', 'Line width', 0.2, 10, 0.1, 1.5, { rmax: 4 }),
      R('margin', 'Edge margin', 0, 0.4, 0.01, 0.08),
      ...BG(0), C('lineColor', 'Line color', 5), C('ringColor', 'Ring color', 6), C('nodeColor', 'Node color', 5),
    ],
    gen(c) {
      const { p, w, h, rng, col } = c;
      const n = Math.max(2, Math.round(p.nodes));
      const ix = w / 2 - p.nodeSize - (p.margin * w) / 2, iy = h / 2 - p.nodeSize - (p.margin * h) / 2;
      const md = Math.sqrt((w * h) / n) * 0.55;
      const pts = [];
      for (let tries = 0; pts.length < n && tries < n * 60; tries++) {
        const q = [rng.range(-ix, ix), rng.range(-iy, iy)];
        if (pts.every((o) => Math.hypot(o[0] - q[0], o[1] - q[1]) > md) || tries > n * 40) pts.push(q);
      }
      const dist = (a, b) => Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]);
      const edges = new Set();
      const add = (a, b) => edges.add(a < b ? `${a}-${b}` : `${b}-${a}`);
      if (p.mode !== 'nearest') {
        const inTree = new Array(pts.length).fill(false), best = new Array(pts.length).fill(Infinity), from = new Array(pts.length).fill(-1);
        best[0] = 0;
        for (let k = 0; k < pts.length; k++) {
          let u = -1;
          for (let i = 0; i < pts.length; i++) if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i;
          inTree[u] = true;
          if (from[u] >= 0) add(u, from[u]);
          for (let i = 0; i < pts.length; i++) {
            if (!inTree[i]) { const d = dist(u, i); if (d < best[i]) { best[i] = d; from[i] = u; } }
          }
        }
      }
      if (p.mode !== 'tree') {
        for (let i = 0; i < pts.length; i++) {
          const order = pts.map((_, j) => j).filter((j) => j !== i).sort((a, b) => dist(i, a) - dist(i, b));
          order.slice(0, p.links).forEach((j) => add(i, j));
        }
      }
      let s = bgRect(c) + `<g stroke="${col(p.lineColor)}" stroke-width="${p.lineWidth}" stroke-linecap="round">`;
      for (const e of edges) {
        const [a, b] = e.split('-').map(Number);
        s += `<line x1="${fmt(pts[a][0])}" y1="${fmt(pts[a][1])}" x2="${fmt(pts[b][0])}" y2="${fmt(pts[b][1])}"/>`;
      }
      s += '</g>';
      for (const q of pts) {
        const r0 = p.nodeSize * (1 + p.sizeJitter * (rng.next() - 0.5));
        for (let k = 0; k < p.rings; k++) {
          const r = r0 * (1 - k / p.rings);
          s += `<circle cx="${fmt(q[0])}" cy="${fmt(q[1])}" r="${fmt(r)}" fill="${k % 2 ? col(p.nodeColor) : col(p.ringColor)}"/>`;
        }
      }
      return s;
    },
  },

  contours: {
    name: 'Noise contours',
    params: [
      R('scale', 'Noise scale', 0.3, 12, 0.1, 2.2, { rmin: 0.8, rmax: 5 }),
      R('levels', 'Levels', 2, 14, 1, 5, { rmax: 9 }),
      R('octaves', 'Detail (octaves)', 1, 5, 1, 2, { rmax: 3 }),
      R('warp', 'Warp', 0, 2, 0.01, 0.4, { rmax: 1.2 }),
      R('smooth', 'Smoothness', 0, 1, 0.01, 1),
      R('res', 'Resolution', 30, 220, 1, 100, { rmin: 70, rmax: 120 }),
      S('style', 'Style', ['filled', 'lines'], 'filled'),
      R('lineWidth', 'Line width', 0.3, 12, 0.1, 2),
      R('offset', 'Palette offset', 0, 9, 1, 0),
      R('step', 'Palette step', 1, 4, 1, 1),
      ...BG(0),
    ],
    gen(c) {
      const { p, col } = c;
      const f = field(c, p);
      const lines = p.style === 'lines';
      let s = lines ? bgRect(c) : rect(c.x0, c.y0, c.w, c.h, col(p.offset));
      for (let k = 1; k < p.levels; k++) {
        const loops = marching(f, k / p.levels);
        if (!loops.length) continue;
        const d = loops.map((l) => smoothPath(l, p.smooth)).join('');
        const color = col(p.offset + k * p.step);
        s += lines
          ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="${p.lineWidth}" stroke-linejoin="round"/>`
          : `<path d="${d}" fill="${color}" fill-rule="evenodd"/>`;
      }
      return s;
    },
  },

  spots: {
    name: 'Spots',
    params: [
      R('scale', 'Spot scale', 0.5, 16, 0.1, 5, { rmin: 2, rmax: 9 }),
      R('threshold', 'Threshold', 0.2, 0.9, 0.01, 0.6, { rmin: 0.45, rmax: 0.75 }),
      R('octaves', 'Detail (octaves)', 1, 5, 1, 2, { rmax: 3 }),
      R('warp', 'Warp', 0, 2, 0.01, 0.2, { rmax: 0.8 }),
      R('smooth', 'Smoothness', 0, 1, 0.01, 1, { fixed: true }),
      R('res', 'Resolution', 30, 220, 1, 110, { fixed: true }),
      C('spot', 'Spot color', 1),
      B('core', 'Inner core', false),
      R('coreGap', 'Core size', 0.02, 0.3, 0.01, 0.1),
      C('coreColor', 'Core color', 2),
      B('outline', 'Outline', false),
      R('outlineWidth', 'Outline width', 0.5, 12, 0.5, 2),
      C('outlineColor', 'Outline color', 0),
      ...BG(4),
    ],
    gen(c) {
      const { p, col } = c;
      const f = field(c, p);
      let s = bgRect(c);
      const d = marching(f, p.threshold).map((l) => smoothPath(l, p.smooth)).join('');
      if (d) s += `<path d="${d}" fill="${col(p.spot)}" fill-rule="evenodd"${p.outline ? ` stroke="${col(p.outlineColor)}" stroke-width="${p.outlineWidth}" stroke-linejoin="round"` : ''}/>`;
      if (p.core) {
        const d2 = marching(f, Math.min(0.98, p.threshold + p.coreGap)).map((l) => smoothPath(l, p.smooth)).join('');
        if (d2) s += `<path d="${d2}" fill="${col(p.coreColor)}" fill-rule="evenodd"/>`;
      }
      return s;
    },
  },

  blobs: {
    name: 'Blobs',
    params: [
      R('count', 'Blobs', 1, 40, 1, 1, { rmax: 10 }),
      R('size', 'Size', 0.05, 1.2, 0.01, 0.75, { rmin: 0.25, rmax: 0.9 }),
      R('sizeJitter', 'Size variation', 0, 1, 0.01, 0.4),
      R('wobble', 'Wobble', 0, 1, 0.01, 0.4, { rmin: 0.15, rmax: 0.7 }),
      R('detail', 'Wobble detail', 0.3, 6, 0.1, 1.5, { rmax: 3 }),
      R('rings', 'Rings', 1, 8, 1, 2, { rmax: 5 }),
      R('ringGap', 'Ring gap', 0.04, 0.45, 0.01, 0.14),
      S('colorMode', 'Colors', ['alternate', 'palette'], 'alternate'),
      C('c1', 'Color A', 1), C('c2', 'Color B', 2),
      B('outline', 'Outline', false),
      R('outlineWidth', 'Outline width', 0.5, 20, 0.5, 3),
      C('outlineColor', 'Outline color', 0),
      ...BG(2),
    ],
    gen(c) {
      const { p, w, h, x0, y0, rng, noise, col } = c;
      const minD = Math.min(w, h);
      let s = bgRect(c);
      for (let b = 0; b < p.count; b++) {
        const single = p.count <= 1;
        const cx = single ? 0 : rng.range(x0 * 0.8, -x0 * 0.8), cy = single ? 0 : rng.range(y0 * 0.8, -y0 * 0.8);
        const R0 = ((p.size * minD) / 2) * (single ? 1 : 1 - p.sizeJitter * rng.next());
        const ox = rng.range(0, 100), oy = rng.range(0, 100);
        for (let k = 0; k < p.rings; k++) {
          const Rk = R0 * (1 - k * p.ringGap);
          if (Rk <= 1) break;
          const pts = [];
          for (let i = 0; i < 120; i++) {
            const a = (i / 120) * TAU;
            const nv = noise.fbm(Math.cos(a) * p.detail + ox, Math.sin(a) * p.detail + oy, 2);
            const r = Math.max(Rk * 0.05, Rk * (1 + p.wobble * nv * 1.8));
            pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
          }
          const fill = p.colorMode === 'palette' ? col(rng.int(0, 99)) : k % 2 ? col(p.c2) : col(p.c1);
          s += `<path d="${smoothPath(pts, 1)}" fill="${fill}"${p.outline ? ` stroke="${col(p.outlineColor)}" stroke-width="${p.outlineWidth}"` : ''}/>`;
        }
      }
      return s;
    },
  },

  flow: {
    name: 'Flow dashes',
    params: [
      R('count', 'Dashes', 20, 4000, 1, 500, { rmin: 120, rmax: 1200 }),
      R('length', 'Length', 2, 150, 0.5, 22, { rmin: 6, rmax: 50 }),
      R('lengthJitter', 'Length variation', 0, 1, 0.01, 0.3),
      R('width', 'Width', 0.5, 24, 0.5, 3, { rmax: 7 }),
      S('mode', 'Direction', ['noise', 'random', 'aligned', 'radial', 'orbit'], 'noise'),
      R('angle', 'Aligned angle', 0, 360, 1, 45),
      R('scale', 'Noise scale', 0.2, 10, 0.1, 2.5),
      S('cap', 'Line cap', ['round', 'butt', 'square'], 'round'),
      C('c1', 'Dash color', 5), C('c2', 'Second color', 1),
      R('mix', 'Second color amount', 0, 1, 0.01, 0),
      ...BG(0),
    ],
    gen(c) {
      const { p, w, h, x0, y0, rng, noise, col, M } = c;
      const cell = Math.sqrt((w * h) / Math.max(1, p.count));
      const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
      let a1 = '', a2 = '';
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = x0 + (i + rng.next()) * cell, y = y0 + (j + rng.next()) * cell;
          let ang;
          if (p.mode === 'noise') ang = noise.fbm((x / M) * p.scale, (y / M) * p.scale, 2) * TAU * 1.5;
          else if (p.mode === 'random') ang = rng.next() * TAU;
          else if (p.mode === 'aligned') ang = (p.angle * Math.PI) / 180 + (rng.next() - 0.5) * 0.15;
          else if (p.mode === 'radial') ang = Math.atan2(y, x);
          else ang = Math.atan2(y, x) + Math.PI / 2;
          const len = p.length * (1 - p.lengthJitter * rng.next());
          const dx = (Math.cos(ang) * len) / 2, dy = (Math.sin(ang) * len) / 2;
          const line = `<line x1="${fmt(x - dx)}" y1="${fmt(y - dy)}" x2="${fmt(x + dx)}" y2="${fmt(y + dy)}"/>`;
          if (rng.next() < p.mix) a2 += line; else a1 += line;
        }
      }
      const g = (color, body) => `<g stroke="${color}" stroke-width="${p.width}" stroke-linecap="${p.cap}">${body}</g>`;
      return bgRect(c) + g(col(p.c1), a1) + (a2 ? g(col(p.c2), a2) : '');
    },
  },

  scribble: {
    name: 'Scribble',
    params: [
      R('lines', 'Lines', 1, 12, 1, 1, { rmax: 4 }),
      R('steps', 'Length (steps)', 50, 4000, 10, 900, { rmin: 300, rmax: 1800 }),
      R('stepLen', 'Step size', 1, 30, 0.5, 6, { rmin: 3, rmax: 12 }),
      R('turn', 'Turn (noise)', 0, 1, 0.01, 0.5),
      R('scale', 'Noise scale', 0.5, 12, 0.1, 3),
      R('jitter', 'Jitter', 0, 1, 0.01, 0.25),
      R('bounds', 'Keep inside', 0.2, 1, 0.01, 0.85),
      R('width', 'Line width', 0.3, 12, 0.1, 2, { rmax: 5 }),
      B('smooth', 'Smooth', true),
      S('colorMode', 'Colors', ['single', 'alternate', 'palette'], 'single'),
      C('c1', 'Line color', 0), C('c2', 'Second color', 1),
      ...BG(5),
    ],
    gen(c) {
      const { p, w, h, rng, noise, col, M } = c;
      let s = bgRect(c);
      for (let L = 0; L < p.lines; L++) {
        let x = rng.range(-w * 0.2, w * 0.2), y = rng.range(-h * 0.2, h * 0.2), a = rng.next() * TAU;
        const pts = [[x, y]];
        for (let i = 0; i < p.steps; i++) {
          const nv = noise.fbm((x / M) * p.scale + L * 13.7, (y / M) * p.scale, 2);
          a += nv * p.turn * 1.2 + (rng.next() - 0.5) * p.jitter;
          if (Math.hypot(x / (w / 2), y / (h / 2)) > p.bounds) {
            let diff = Math.atan2(-y, -x) - a;
            diff = Math.atan2(Math.sin(diff), Math.cos(diff));
            a += diff * 0.3;
          }
          x += Math.cos(a) * p.stepLen;
          y += Math.sin(a) * p.stepLen;
          pts.push([x, y]);
        }
        const color = p.colorMode === 'palette' ? col(rng.int(0, 99)) : p.colorMode === 'alternate' && L % 2 ? col(p.c2) : col(p.c1);
        const d = p.smooth ? smoothOpen(pts) : 'M' + pts.map((q) => `${fmt(q[0])} ${fmt(q[1])}`).join('L');
        s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${p.width}" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      return s;
    },
  },

  bubbles: {
    name: 'Bubbles',
    params: [
      R('count', 'Bubbles', 5, 1500, 1, 120, { rmin: 30, rmax: 300 }),
      R('minR', 'Min radius', 1, 80, 0.5, 4, { rmax: 12 }),
      R('maxR', 'Max radius', 4, 500, 1, 110, { rmin: 30, rmax: 200 }),
      R('padding', 'Padding', 0, 30, 0.5, 4, { rmax: 10 }),
      S('contain', 'Contain in', ['ellipse', 'box'], 'ellipse'),
      S('style', 'Style', ['fill', 'outline', 'rings', 'mixed'], 'outline'),
      R('rings', 'Rings', 2, 6, 1, 3),
      R('strokeWidth', 'Stroke width', 0.3, 12, 0.1, 2, { rmax: 5 }),
      C('c1', 'Color A', 5), C('c2', 'Color B', 1),
      R('mix', 'Color B amount', 0, 1, 0.01, 0.2),
      ...BG(0),
    ],
    gen(c) {
      const { p, w, h, x0, y0, rng, col } = c;
      const hw = w / 2, hh = h / 2, placed = [];
      const attempts = Math.min(p.count * 60, 40000);
      for (let k = 0; k < attempts && placed.length < p.count; k++) {
        const x = rng.range(x0, -x0), y = rng.range(y0, -y0);
        let avail;
        if (p.contain === 'ellipse') {
          const e = Math.hypot(x / hw, y / hh);
          if (e >= 1) continue;
          avail = (1 - e) * Math.min(hw, hh);
        } else avail = Math.min(hw - Math.abs(x), hh - Math.abs(y));
        avail = Math.min(avail - p.padding, p.maxR);
        for (const o of placed) {
          const d = Math.hypot(o.x - x, o.y - y) - o.r - p.padding;
          if (d < avail) avail = d;
          if (avail < p.minR) break;
        }
        if (avail >= p.minR) placed.push({ x, y, r: avail });
      }
      let s = bgRect(c);
      for (const b of placed) {
        const color = rng.next() < p.mix ? col(p.c2) : col(p.c1);
        const style = p.style === 'mixed' ? rng.pick(['fill', 'outline', 'rings']) : p.style;
        const cxy = `cx="${fmt(b.x)}" cy="${fmt(b.y)}"`;
        if (style === 'fill') s += `<circle ${cxy} r="${fmt(b.r)}" fill="${color}"/>`;
        else if (style === 'outline') s += `<circle ${cxy} r="${fmt(Math.max(0.1, b.r - p.strokeWidth / 2))}" fill="none" stroke="${color}" stroke-width="${p.strokeWidth}"/>`;
        else for (let k = 0; k < p.rings; k++) {
          const r = b.r * (1 - k / p.rings) - p.strokeWidth / 2;
          if (r > 0.3) s += `<circle ${cxy} r="${fmt(r)}" fill="none" stroke="${color}" stroke-width="${p.strokeWidth}"/>`;
        }
      }
      return s;
    },
  },

  checker: {
    name: 'Warped checker',
    params: [
      R('cols', 'Columns', 2, 60, 1, 10, { rmin: 4, rmax: 22 }),
      R('rows', 'Rows', 2, 60, 1, 10, { rmin: 4, rmax: 22 }),
      B('square', 'Square cells', true),
      R('rotation', 'Rotation', 0, 90, 1, 0),
      S('mode', 'Distortion', ['sine', 'noise', 'twist', 'bulge'], 'sine'),
      R('warp', 'Distortion amount', 0, 1, 0.01, 0.4),
      R('freq', 'Frequency', 0.3, 6, 0.1, 1.5, { rmax: 3 }),
      C('c1', 'Color A', 2), C('c2', 'Color B', 1),
    ],
    gen(c) {
      const { p, w, h, col, noise, M } = c;
      const cw = w / p.cols, ch = p.square ? cw : h / p.rows;
      const D = Math.hypot(w, h) / 2 + Math.max(cw, ch) * 2;
      const rot = (p.rotation * Math.PI) / 180, cr = Math.cos(rot), sr = Math.sin(rot);
      const A = p.warp * M * 0.08, Rm = Math.hypot(w, h) / 2;
      const warp = (x, y) => {
        if (p.mode === 'sine') return [x + A * Math.sin((y / M) * p.freq * TAU), y + A * Math.sin((x / M) * p.freq * TAU + 1.3)];
        if (p.mode === 'noise') return [x + A * 2.5 * noise.fbm((x / M) * p.freq, (y / M) * p.freq, 2), y + A * 2.5 * noise.fbm((x / M) * p.freq + 7.7, (y / M) * p.freq + 3.1, 2)];
        const r = Math.hypot(x, y);
        if (p.mode === 'twist') {
          const th = p.warp * 4 * Math.max(0, 1 - r / Rm) ** 2, ct = Math.cos(th), st = Math.sin(th);
          return [x * ct - y * st, x * st + y * ct];
        }
        if (r < 1e-6) return [x, y];
        const r2 = Rm * Math.pow(r / Rm, 1 / (1 + p.warp * 1.5));
        return [(x / r) * r2, (y / r) * r2];
      };
      const tf = (u, v) => warp(u * cr - v * sr, u * sr + v * cr);
      const ni = Math.ceil(D / cw), nj = Math.ceil(D / ch), sub = 4;
      let d = '';
      for (let j = -nj; j < nj; j++) {
        for (let i = -ni; i < ni; i++) {
          if (((i + j) % 2 + 2) % 2) continue;
          const u0 = i * cw, v0 = j * ch, u1 = u0 + cw, v1 = v0 + ch;
          const mx = (u0 + u1) / 2, my = (v0 + v1) / 2;
          const cx = mx * cr - my * sr, cy = mx * sr + my * cr;
          if (Math.abs(cx) > w / 2 + M * 0.25 || Math.abs(cy) > h / 2 + M * 0.25) continue;
          const pts = [];
          for (let k = 0; k < sub; k++) pts.push(tf(u0 + (cw * k) / sub, v0));
          for (let k = 0; k < sub; k++) pts.push(tf(u1, v0 + (ch * k) / sub));
          for (let k = 0; k < sub; k++) pts.push(tf(u1 - (cw * k) / sub, v1));
          for (let k = 0; k < sub; k++) pts.push(tf(u0, v1 - (ch * k) / sub));
          d += 'M' + pts.map((q) => `${fmt(q[0])} ${fmt(q[1])}`).join('L') + 'Z';
        }
      }
      return rect(c.x0, c.y0, w, h, col(p.c1)) + `<path d="${d}" fill="${col(p.c2)}"/>`;
    },
  },
};

export const TECH_ORDER = ['solid', 'linear', 'radial', 'halftone', 'voronoi', 'network', 'contours', 'spots', 'blobs', 'flow', 'scribble', 'bubbles', 'checker'];

/* ---------- effects (preview + PNG only; SVG export stays pure vector) ---------- */

export const EFFECT_DEFS = {
  glow: [
    R('size', 'Blur', 1, 200, 1, 40, { rmin: 10, rmax: 90 }),
    R('spread', 'Spread', 0, 150, 1, 0, { rmax: 50 }),
    C('color', 'Color', 1),
    R('opacity', 'Opacity', 0, 1, 0.01, 0.8, { rmin: 0.4 }),
  ],
  halo: [
    R('distance', 'Distance', 0, 200, 1, 24, { rmax: 70 }),
    R('width', 'Width', 1, 80, 1, 10, { rmin: 3, rmax: 40 }),
    R('blur', 'Softness', 0, 80, 1, 10, { rmax: 40 }),
    C('color', 'Color', 6),
    R('opacity', 'Opacity', 0, 1, 0.01, 0.9, { rmin: 0.4 }),
  ],
  grain: [
    R('amount', 'Amount', 0, 1, 0.01, 0.35, { rmin: 0.15, rmax: 0.6 }),
    R('scale', 'Fineness', 0.2, 3, 0.05, 0.9, { rmin: 0.5, rmax: 1.6 }),
    S('tone', 'Tone', ['dark', 'light', 'both'], 'dark'),
  ],
};

/* ---------- defaults & randomizer ---------- */

export function defaultsOf(schema) {
  const o = {};
  for (const pr of schema) o[pr.key] = pr.default;
  return o;
}

export function randomizeSchema(schema, paletteLen, current = {}) {
  const out = { ...current };
  const idx = [...Array(Math.max(1, paletteLen)).keys()];
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  let ci = 0;
  for (const pr of schema) {
    if (pr.fixed) {
      if (out[pr.key] === undefined) out[pr.key] = pr.default;
      continue;
    }
    if (pr.type === 'range') {
      const lo = pr.rmin ?? pr.min, hi = pr.rmax ?? pr.max;
      const v = Math.round((lo + Math.random() * (hi - lo)) / pr.step) * pr.step;
      out[pr.key] = +v.toFixed(4);
    } else if (pr.type === 'color') out[pr.key] = idx[ci++ % idx.length];
    else if (pr.type === 'select') out[pr.key] = pr.options[Math.floor(Math.random() * pr.options.length)];
    else if (pr.type === 'bool') out[pr.key] = Math.random() < 0.5;
  }
  return out;
}
