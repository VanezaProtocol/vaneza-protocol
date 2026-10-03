// Brand asset pipeline: PNG inspection, palette sampling, glyph geometry, premultiplied resize.
import fs from 'node:fs';
import { PNG } from 'pngjs';

export const LOGO_OPAQUE = 'brand/LOGO VANEZA PNG.png';
export const LOGO_ALPHA = 'brand/LOGO VANEZA PNG...png';

export function readPng(file) {
  const buf = fs.readFileSync(file);
  const ihdr = { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bitDepth: buf[24], colorType: buf[25], interlace: buf[28] };
  const png = PNG.sync.read(buf);
  return { w: png.width, h: png.height, data: png.data, ihdr };
}

export function alphaProfile(data) {
  const bins = new Array(8).fill(0);
  let clear = 0, clearBlack = 0;
  for (let i = 0; i < data.length; i += 4) {
    bins[data[i + 3] >> 5]++;
    if (data[i + 3] === 0) { clear++; if (!(data[i] | data[i + 1] | data[i + 2])) clearBlack++; }
  }
  return { bins, clear, clearBlack };
}

export const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

// Deterministic k-means over the unique-colour histogram; each centroid is then
// snapped to the closest colour that really occurs, and located by raster scan.
export function samplePalette({ w, data }, k = 3) {
  const hist = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  const keys = Int32Array.from(hist.keys());
  const n = keys.length;
  const R = new Float64Array(n), G = new Float64Array(n), B = new Float64Array(n), N = new Float64Array(n);
  keys.forEach((key, i) => { R[i] = key >> 16; G[i] = (key >> 8) & 255; B[i] = key & 255; N[i] = hist.get(key); });
  const d2 = (c, i) => (c[0] - R[i]) ** 2 + (c[1] - G[i]) ** 2 + (c[2] - B[i]) ** 2;
  let top = 0; for (let i = 1; i < n; i++) if (N[i] > N[top]) top = i;
  let cents = [[R[top], G[top], B[top]]];
  while (cents.length < k) {
    let best = 0, bd = -1;
    for (let i = 0; i < n; i++) { let d = Infinity; for (const c of cents) d = Math.min(d, d2(c, i)); if (d > bd) { bd = d; best = i; } }
    cents.push([R[best], G[best], B[best]]);
  }
  for (let it = 0; it < 24; it++) {
    const acc = cents.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let bi = 0, bd = Infinity;
      for (let j = 0; j < cents.length; j++) { const d = d2(cents[j], i); if (d < bd) { bd = d; bi = j; } }
      const a = acc[bi]; a[0] += R[i] * N[i]; a[1] += G[i] * N[i]; a[2] += B[i] * N[i]; a[3] += N[i];
    }
    cents = acc.map((a, i) => (a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : cents[i]));
  }
  return cents.map((c) => {
    let near = 0;
    for (let i = 1; i < n; i++) if (d2(c, i) < d2(c, near)) near = i;
    const key = keys[near];
    let at = null;
    for (let i = 0; i < data.length && !at; i += 4) {
      if (((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]) === key) at = { x: (i / 4) % w, y: Math.floor(i / 4 / w) };
    }
    const rgb = [R[near], G[near], B[near]];
    return { hex: hex(...rgb), rgb, x: at.x, y: at.y, centroid: c.map((v) => Math.round(v)) };
  });
}

export const isAccent = (d, i) => d[i + 1] - d[i + 2] > 60;

// Reads the stepped V and the underscore bar straight from the alpha logo.
// Rows group into bands whose run edges agree within 3 px; bands thinner than
// 10 px are anti-alias seams and fold into the band above.
export function extractGeometry({ w, h, data }) {
  const rows = (want) => {
    const out = [];
    for (let y = 0; y < h; y++) {
      const runs = []; let s = -1;
      for (let x = 0; x <= w; x++) {
        const i = (y * w + x) * 4;
        const on = x < w && data[i + 3] >= 128 && (isAccent(data, i) ? 2 : 1) === want;
        if (on && s < 0) s = x;
        if (!on && s >= 0) { runs.push([s, x]); s = -1; }
      }
      out.push(runs);
    }
    return out;
  };
  const near = (a, b) => a.length === b.length && a.every((r, i) => Math.abs(r[0] - b[i][0]) <= 3 && Math.abs(r[1] - b[i][1]) <= 3);
  const bandsFor = (want) => {
    const r = rows(want);
    const bands = [];
    for (let y = 0; y < h; y++) {
      if (!r[y].length) continue;
      const last = bands[bands.length - 1];
      if (last && last.y1 === y && near(last.runs, r[y])) last.y1 = y + 1;
      else bands.push({ y0: y, y1: y + 1, runs: r[y] });
    }
    const solid = [];
    for (const b of bands) {
      if (b.y1 - b.y0 < 10) { if (solid.length) solid[solid.length - 1].y1 = b.y1; continue; }
      solid.push({ ...b });
    }
    const fused = [];
    for (const b of solid) {
      const l = fused[fused.length - 1];
      if (l && l.y1 >= b.y0 - 12 && near(l.runs, b.runs)) l.y1 = b.y1; else fused.push(b);
    }
    // close the gaps left by folded seams so bands tile with no hairlines
    for (let i = 0; i < fused.length - 1; i++) fused[i].y1 = fused[i + 1].y0 = Math.round((fused[i].y1 + fused[i + 1].y0) / 2);
    fused[0].y0 = Math.min(fused[0].y0, bands[0].y0);
    fused[fused.length - 1].y1 = Math.max(fused[fused.length - 1].y1, bands[bands.length - 1].y1);
    return fused;
  };
  const toRects = (bands) => bands.flatMap((b) => b.runs.map(([x0, x1]) => ({ x: x0, y: b.y0, w: x1 - x0, h: b.y1 - b.y0 })));
  const bbox = (rs) => ({ x0: Math.min(...rs.map((r) => r.x)), y0: Math.min(...rs.map((r) => r.y)), x1: Math.max(...rs.map((r) => r.x + r.w)), y1: Math.max(...rs.map((r) => r.y + r.h)) });
  const v = toRects(bandsFor(1)); const bar = toRects(bandsFor(2));
  return { v, bar, vBox: bbox(v), barBox: bbox(bar) };
}

// Area-weighted downscale of a square crop in premultiplied space.
// Straight-alpha averaging would drag the black RGB of clear pixels into every edge.
// Returns un-premultiplied RGBA (alpha preserved).
export function resizeToRgba(src, sw, crop, N, keep = () => true) {
  const out = Buffer.alloc(N * N * 4);
  const scale = crop.side / N;
  const sh = src.length / 4 / sw;
  for (let oy = 0; oy < N; oy++) for (let ox = 0; ox < N; ox++) {
    const sx0 = crop.x + ox * scale, sx1 = sx0 + scale, sy0 = crop.y + oy * scale, sy1 = sy0 + scale;
    let pr = 0, pg = 0, pb = 0, pa = 0, wt = 0;
    for (let y = Math.floor(sy0); y < Math.ceil(sy1); y++) {
      const wy = Math.min(y + 1, sy1) - Math.max(y, sy0);
      for (let x = Math.floor(sx0); x < Math.ceil(sx1); x++) {
        const wx = Math.min(x + 1, sx1) - Math.max(x, sx0);
        const wgt = wx * wy; wt += wgt;
        if (x < 0 || y < 0 || x >= sw || y >= sh) continue;
        const i = (y * sw + x) * 4;
        const a = keep(src, i) ? src[i + 3] / 255 : 0;
        pr += src[i] * a * wgt; pg += src[i + 1] * a * wgt; pb += src[i + 2] * a * wgt; pa += a * wgt;
      }
    }
    const o = (oy * N + ox) * 4; const a = pa / wt;
    out[o] = a ? Math.round(pr / wt / a) : 0; out[o + 1] = a ? Math.round(pg / wt / a) : 0; out[o + 2] = a ? Math.round(pb / wt / a) : 0; out[o + 3] = Math.round(a * 255);
  }
  return out;
}

export function overBackground(rgba, bg) {
  const out = Buffer.alloc(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    for (let c = 0; c < 3; c++) out[i + c] = Math.round(rgba[i + c] * a + bg[c] * (1 - a));
    out[i + 3] = 255;
  }
  return out;
}

export const writePng = (file, w, h, data) => { const p = new PNG({ width: w, height: h }); p.data = data; fs.writeFileSync(file, PNG.sync.write(p)); };
