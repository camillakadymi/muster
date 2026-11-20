// Shape outlines and path helpers. Every shape lives in a local box centred on (0, 0).

export const fmt = (n) => Math.round(n * 100) / 100;

function unitPoints(shape) {
  const pts = [];
  if (shape.type === 'star') {
    const n = Math.max(3, Math.round(shape.points || 5));
    const inner = shape.inner ?? 0.5;
    for (let i = 0; i < n * 2; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / n;
      const r = i % 2 ? inner : 1;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return pts;
  }
  const n = shape.type === 'triangle' ? 3 : Math.max(3, Math.round(shape.sides || 6));
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
    pts.push([Math.cos(a), Math.sin(a)]);
  }
  return pts;
}

// Polygon / star / triangle points stretched to fill the w × h box
export function polygonPoints(shape, w, h) {
  const pts = unitPoints(shape);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return pts.map(([x, y]) => [
    ((x - minX) / (maxX - minX) - 0.5) * w,
    ((y - minY) / (maxY - minY) - 0.5) * h,
  ]);
}

// SVG path for a shape; `grow` enlarges the box (used by halo / glow spread)
export function shapePath(shape, grow = 0) {
  const w = Math.max(1, shape.w + grow), h = Math.max(1, shape.h + grow);
  const hw = w / 2, hh = h / 2;
  switch (shape.type) {
    case 'rect':
    case 'square': {
      const r = Math.min(Math.max(0, (shape.corner || 0) + (shape.corner ? grow / 2 : 0)), hw, hh);
      if (r <= 0) return `M${fmt(-hw)} ${fmt(-hh)}H${fmt(hw)}V${fmt(hh)}H${fmt(-hw)}Z`;
      return (
        `M${fmt(-hw + r)} ${fmt(-hh)}H${fmt(hw - r)}A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(hw)} ${fmt(-hh + r)}` +
        `V${fmt(hh - r)}A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(hw - r)} ${fmt(hh)}` +
        `H${fmt(-hw + r)}A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(-hw)} ${fmt(hh - r)}` +
        `V${fmt(-hh + r)}A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(-hw + r)} ${fmt(-hh)}Z`
      );
    }
    case 'circle':
      return `M${fmt(-hw)} 0A${fmt(hw)} ${fmt(hh)} 0 1 0 ${fmt(hw)} 0A${fmt(hw)} ${fmt(hh)} 0 1 0 ${fmt(-hw)} 0Z`;
    case 'path':
      return pathD(pathAbs(shape, w, h), shape.closed !== false);
    default:
      return 'M' + polygonPoints(shape, w, h).map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join('L') + 'Z';
  }
}

// Closed path through points; k = 0 gives sharp corners, k = 1 fully rounded
export function smoothPath(pts, k = 1) {
  const n = pts.length;
  if (n < 3) return '';
  if (k <= 0.001) return 'M' + pts.map((p) => `${fmt(p[0])} ${fmt(p[1])}`).join('L') + 'Z';
  const t = Math.min(1, k) * 0.5;
  let d = '';
  for (let i = 0; i < n; i++) {
    const p = pts[(i - 1 + n) % n], v = pts[i], q = pts[(i + 1) % n];
    const ax = v[0] + (p[0] - v[0]) * t, ay = v[1] + (p[1] - v[1]) * t;
    const bx = v[0] + (q[0] - v[0]) * t, by = v[1] + (q[1] - v[1]) * t;
    d += `${i ? 'L' : 'M'}${fmt(ax)} ${fmt(ay)}Q${fmt(v[0])} ${fmt(v[1])} ${fmt(bx)} ${fmt(by)}`;
  }
  return d + 'Z';
}

// Open, smoothed polyline
export function smoothOpen(pts) {
  const n = pts.length;
  if (n < 3) return 'M' + pts.map((p) => `${fmt(p[0])} ${fmt(p[1])}`).join('L');
  let d = `M${fmt(pts[0][0])} ${fmt(pts[0][1])}`;
  for (let i = 1; i < n - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += `Q${fmt(pts[i][0])} ${fmt(pts[i][1])} ${fmt(mx)} ${fmt(my)}`;
  }
  return d + `L${fmt(pts[n - 1][0])} ${fmt(pts[n - 1][1])}`;
}

/* ---------- Bézier paths (pen & pencil) ----------
   A path shape stores nodes in units of its box: { x, y, ix, iy, ox, oy, smooth }
   x, y = anchor (−0.5..0.5), ix/iy = incoming handle offset, ox/oy = outgoing handle offset.
   "Abs" nodes are the same thing in pixels. */

export function pathAbs(shape, w = shape.w, h = shape.h) {
  return (shape.nodes || []).map((n) => ({
    x: n.x * w, y: n.y * h,
    ix: (n.ix || 0) * w, iy: (n.iy || 0) * h,
    ox: (n.ox || 0) * w, oy: (n.oy || 0) * h,
    smooth: !!n.smooth,
  }));
}

export function pathD(nodes, closed) {
  const n = nodes.length;
  if (!n) return '';
  const seg = (a, b) => `C${fmt(a.x + a.ox)} ${fmt(a.y + a.oy)} ${fmt(b.x + b.ix)} ${fmt(b.y + b.iy)} ${fmt(b.x)} ${fmt(b.y)}`;
  let d = `M${fmt(nodes[0].x)} ${fmt(nodes[0].y)}`;
  for (let i = 0; i < n - 1; i++) d += seg(nodes[i], nodes[i + 1]);
  if (closed && n > 1) d += seg(nodes[n - 1], nodes[0]) + 'Z';
  return d;
}

// Control points of each segment: [p0, p1, p2, p3, indexOfStartNode]
export function segments(nodes, closed) {
  const out = [];
  const n = nodes.length;
  const count = closed && n > 1 ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = nodes[i], b = nodes[(i + 1) % n];
    out.push([[a.x, a.y], [a.x + a.ox, a.y + a.oy], [b.x + b.ix, b.y + b.iy], [b.x, b.y], i]);
  }
  return out;
}

export function cubicAt(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// Split a node pair's segment at t, inserting a new smooth node (like Illustrator's "add anchor")
export function insertNode(nodes, segIndex, t, closed) {
  const seg = segments(nodes, closed)[segIndex];
  if (!seg) return nodes;
  const [p0, p1, p2, p3, i] = seg;
  const a = mix(p0, p1, t), b = mix(p1, p2, t), c = mix(p2, p3, t);
  const d = mix(a, b, t), e = mix(b, c, t), m = mix(d, e, t);
  const A = nodes[i], B = nodes[(i + 1) % nodes.length];
  A.ox = a[0] - A.x; A.oy = a[1] - A.y;
  B.ix = c[0] - B.x; B.iy = c[1] - B.y;
  nodes.splice(i + 1, 0, { x: m[0], y: m[1], ix: d[0] - m[0], iy: d[1] - m[1], ox: e[0] - m[0], oy: e[1] - m[1], smooth: true });
  return nodes;
}

// Nearest point on the path: { seg, t, dist }
export function hitPath(nodes, closed, px, py) {
  let best = { seg: -1, t: 0, dist: Infinity };
  segments(nodes, closed).forEach((s, k) => {
    for (let j = 1; j < 40; j++) {
      const t = j / 40, q = cubicAt(s[0], s[1], s[2], s[3], t);
      const d = Math.hypot(q[0] - px, q[1] - py);
      if (d < best.dist) best = { seg: k, t, dist: d };
    }
  });
  return best;
}

// Catmull-Rom style handles for node i, based on its neighbours
export function autoHandles(nodes, i, closed, tension = 1) {
  const n = nodes.length, p = nodes[i];
  const prev = nodes[i - 1] || (closed ? nodes[n - 1] : p);
  const next = nodes[i + 1] || (closed ? nodes[0] : p);
  const dx = ((next.x - prev.x) / 6) * tension, dy = ((next.y - prev.y) / 6) * tension;
  p.ox = dx; p.oy = dy; p.ix = -dx; p.iy = -dy; p.smooth = true;
}

// Re-fit the bounding box around abs nodes; returns box-unit nodes plus the new box centre/size
export function normalizeAbs(nodes, closed) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const grow = (q) => {
    minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]);
    minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]);
  };
  nodes.forEach((n) => grow([n.x, n.y]));
  for (const s of segments(nodes, closed)) for (let j = 1; j < 24; j++) grow(cubicAt(s[0], s[1], s[2], s[3], j / 24));
  const w = Math.max(2, maxX - minX), h = Math.max(2, maxY - minY);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return {
    cx, cy, w, h,
    nodes: nodes.map((n) => ({
      x: (n.x - cx) / w, y: (n.y - cy) / h,
      ix: n.ix / w, iy: n.iy / h, ox: n.ox / w, oy: n.oy / h,
      smooth: !!n.smooth,
    })),
  };
}

// Ramer–Douglas–Peucker: drop points that add less than eps of detail
export function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let idx = -1, max = 0;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (max > eps && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// Freehand points → smooth closed blob nodes (abs)
export function blobFromPoints(pts, eps) {
  // Split the loop at the point farthest from the start, so RDP never sees a zero-length baseline
  let far = 0, fd = 0;
  pts.forEach((p, i) => {
    const d = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]);
    if (d > fd) { fd = d; far = i; }
  });
  let simple = far > 0 && far < pts.length - 1
    ? [...simplify(pts.slice(0, far + 1), eps).slice(0, -1), ...simplify(pts.slice(far), eps)]
    : simplify(pts, eps);
  const first = simple[0], last = simple[simple.length - 1];
  if (simple.length > 3 && Math.hypot(first[0] - last[0], first[1] - last[1]) < eps * 3) simple = simple.slice(0, -1);
  const nodes = simple.map(([x, y]) => ({ x, y, ix: 0, iy: 0, ox: 0, oy: 0, smooth: true }));
  nodes.forEach((_, i) => autoHandles(nodes, i, true));
  return nodes;
}
