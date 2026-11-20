// Turns the document into SVG markup: for the editor, for SVG export (pure vector) and PNG export.

import { TECHNIQUES, EFFECT_DEFS, defaultsOf } from './techniques.js';
import { makeRng, makeNoise } from './rng.js';
import { shapePath, fmt } from './geometry.js';

const cache = new Map();

export function effectivePalette(doc, shape) {
  return shape.palette && shape.palette.length ? shape.palette : doc.palette;
}

const colorFn = (palette) => {
  const n = palette.length || 1;
  return (i) => palette[(((Math.round(i) || 0) % n) + n) % n] || '#000000';
};

function layerSVG(shape, layer, palette) {
  const w = Math.max(2, Math.round(shape.w)), h = Math.max(2, Math.round(shape.h));
  const key = JSON.stringify([layer.id, layer.technique, layer.params, layer.seed, w, h, palette]);
  if (cache.has(key)) return cache.get(key);
  const tech = TECHNIQUES[layer.technique];
  if (!tech) return '';
  const p = { ...defaultsOf(tech.params), ...layer.params };
  const ctx = {
    w, h, x0: -w / 2, y0: -h / 2, M: Math.max(w, h), p, palette,
    col: colorFn(palette), rng: makeRng(layer.seed), noise: makeNoise(layer.seed), uid: layer.id,
  };
  let out = '';
  try {
    out = tech.gen(ctx);
  } catch (err) {
    console.error(`Technique "${layer.technique}" failed`, err);
  }
  cache.set(key, out);
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return out;
}

function grainFilter(id, fx, w, h, light, seed) {
  const a = fx.amount * 5;
  const [r, g, b] = light ? [1, 1, 1] : [0, 0, 0];
  const alpha = light ? `${-a} 0 0 0 ${fmt(a * 0.5)}` : `${a} 0 0 0 ${fmt(-a * 0.5)}`;
  return `<filter id="${id}" filterUnits="userSpaceOnUse" x="${fmt(-w / 2)}" y="${fmt(-h / 2)}" width="${fmt(w)}" height="${fmt(h)}">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${fx.scale}" numOctaves="3" seed="${seed}" stitchTiles="stitch"/>` +
    `<feColorMatrix type="matrix" values="0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} ${alpha}"/></filter>`;
}

export function shapeSVG(doc, shape, { editor = false, effects = true } = {}) {
  if (shape.hidden) return '';
  const pal = effectivePalette(doc, shape);
  const col = colorFn(pal);
  const fx = shape.effects || {};
  const d = shapePath(shape);
  const id = shape.id;
  const { w, h } = shape;
  let defs = '', behind = '', s = '';

  if (effects && fx.glow?.on) {
    const g = { ...defaultsOf(EFFECT_DEFS.glow), ...fx.glow };
    const pad = g.size * 3 + g.spread;
    defs += `<filter id="glow-${id}" filterUnits="userSpaceOnUse" x="${fmt(-w / 2 - pad)}" y="${fmt(-h / 2 - pad)}" width="${fmt(w + pad * 2)}" height="${fmt(h + pad * 2)}"><feGaussianBlur stdDeviation="${g.size}"/></filter>`;
    behind += `<path d="${g.spread ? shapePath(shape, g.spread * 2) : d}" fill="${col(g.color)}" opacity="${g.opacity}" filter="url(#glow-${id})" pointer-events="none"/>`;
  }
  if (effects && fx.halo?.on) {
    const g = { ...defaultsOf(EFFECT_DEFS.halo), ...fx.halo };
    const grow = (g.distance + g.width / 2) * 2;
    const pad = g.distance + g.width + g.blur * 3;
    if (g.blur > 0) defs += `<filter id="halo-${id}" filterUnits="userSpaceOnUse" x="${fmt(-w / 2 - pad)}" y="${fmt(-h / 2 - pad)}" width="${fmt(w + pad * 2)}" height="${fmt(h + pad * 2)}"><feGaussianBlur stdDeviation="${g.blur}"/></filter>`;
    behind += `<path d="${shapePath(shape, grow)}" fill="none" stroke="${col(g.color)}" stroke-width="${g.width}" opacity="${g.opacity}"${g.blur > 0 ? ` filter="url(#halo-${id})"` : ''} pointer-events="none"/>`;
  }

  defs += `<clipPath id="clip-${id}"><path d="${d}"/></clipPath>`;
  s += `<g clip-path="url(#clip-${id})">`;
  if (editor) s += `<path d="${d}" fill="transparent"/>`; // keeps empty areas clickable
  for (const layer of shape.layers) {
    if (layer.visible === false) continue;
    const body = layerSVG(shape, layer, pal);
    s += layer.opacity < 1 ? `<g opacity="${layer.opacity}">${body}</g>` : body;
  }
  if (effects && fx.grain?.on) {
    const g = { ...defaultsOf(EFFECT_DEFS.grain), ...fx.grain };
    const tones = g.tone === 'both' ? [false, true] : [g.tone === 'light'];
    tones.forEach((light, i) => {
      const fid = `grain-${id}-${i}`;
      defs += grainFilter(fid, g, w, h, light, 7 + i * 31);
      s += `<rect x="${fmt(-w / 2)}" y="${fmt(-h / 2)}" width="${fmt(w)}" height="${fmt(h)}" filter="url(#${fid})" pointer-events="none"/>`;
    });
  }
  s += '</g>';
  if (shape.stroke?.on && shape.stroke.width > 0) {
    s += `<path d="${d}" fill="none" stroke="${col(shape.stroke.color)}" stroke-width="${shape.stroke.width}" stroke-linejoin="round"/>`;
  }

  const tr = `translate(${fmt(shape.x)} ${fmt(shape.y)}) rotate(${fmt(shape.rotation || 0)})`;
  return `<g${editor ? ` data-id="${id}"` : ''} transform="${tr}"><defs>${defs}</defs>${behind}${s}</g>`;
}

export function sceneContent(doc, opts = {}) {
  return `<rect width="${doc.width}" height="${doc.height}" fill="${doc.background}"/>` +
    doc.shapes.map((s) => shapeSVG(doc, s, opts)).join('');
}

export function sceneSVG(doc, { effects = true, scale = 1 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${doc.width} ${doc.height}" width="${doc.width * scale}" height="${doc.height * scale}">` +
    sceneContent(doc, { editor: false, effects }) + '</svg>';
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function exportSVG(doc, name = 'muster') {
  const svg = '<?xml version="1.0" encoding="UTF-8"?>\n' + sceneSVG(doc, { effects: false });
  download(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`);
}

export async function exportPNG(doc, scale = 2, name = 'muster') {
  const W = Math.round(doc.width * scale), H = Math.round(doc.height * scale);
  const url = URL.createObjectURL(new Blob([sceneSVG(doc, { effects: true, scale })], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    canvas.getContext('2d').drawImage(img, 0, 0, W, H);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('Canvas too large for this browser');
    download(blob, `${name}@${scale}x.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
