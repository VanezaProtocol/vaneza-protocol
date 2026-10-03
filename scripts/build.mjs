// Static build: bundles src/, bakes register-dependent markup, derives icons from the brand pixels.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { LOGO_ALPHA, readPng, extractGeometry, resizeToRgba, overBackground, writePng } from './lib/brand.mjs';
import { caMarkup, socialMarkup, ledgerRows } from '../src/chrome.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (...p) => path.join(ROOT, ...p);

export function readTokens() {
  const css = fs.readFileSync(rel('src/tokens.css'), 'utf8');
  const pick = (n) => css.match(new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`))[1];
  return { bg: pick('bg'), fg: pick('fg'), acc: pick('acc') };
}
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

const rect = (r, extra = '') => `<rect ${extra}x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`;

export function markups(geo) {
  const x0 = Math.min(geo.vBox.x0, geo.barBox.x0), y0 = Math.min(geo.vBox.y0, geo.barBox.y0);
  const x1 = Math.max(geo.vBox.x1, geo.barBox.x1), y1 = Math.max(geo.vBox.y1, geo.barBox.y1);
  const full = [
    ...geo.v.map((r, i) => rect(r, `class="px" data-i="${i}" fill="currentColor" `)),
    ...geo.bar.map((r, i) => rect(r, `class="px cursor" data-i="${geo.v.length + i}" `)),
  ].join('');
  const mark = `<svg class="mark" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" role="img" aria-label="Vaneza mark: a stepped V beside an underscore" shape-rendering="crispEdges">${full}</svg>`;
  const small = `<svg class="logo-mark" viewBox="${geo.vBox.x0} ${geo.vBox.y0} ${geo.vBox.x1 - geo.vBox.x0} ${geo.vBox.y1 - geo.vBox.y0}" aria-hidden="true" focusable="false" shape-rendering="crispEdges" fill="currentColor">${geo.v.map((r) => rect(r)).join('')}</svg>`;
  return { mark, small };
}

function icons(out, geo, png, tokens) {
  const bg = rgb(tokens.bg);
  const sq = (box, scale) => {
    const w = box.x1 - box.x0, h = box.y1 - box.y0;
    const side = Math.round(Math.max(w, h) * scale);
    return { x: Math.round(box.x0 + w / 2 - side / 2), y: Math.round(box.y0 + h / 2 - side / 2), side };
  };
  // favicon svg: the V rectangles, translated into a padded square
  const vc = sq(geo.vBox, 1.42);
  const g = geo.v.map((r) => `<rect x="${r.x - vc.x}" y="${r.y - vc.y}" width="${r.w}" height="${r.h}"/>`).join('');
  fs.writeFileSync(path.join(out, 'favicon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vc.side} ${vc.side}" shape-rendering="crispEdges"><rect width="${vc.side}" height="${vc.side}" rx="${Math.round(vc.side * 0.16)}" fill="${tokens.bg}"/><g fill="${tokens.fg}">${g}</g></svg>\n`);
  const notAccent = (d, i) => !(d[i + 1] - d[i + 2] > 60);
  const emit = (name, N, crop, keep) => {
    const rgba = resizeToRgba(png.data, png.w, crop, N, keep);
    writePng(path.join(out, name), N, N, overBackground(rgba, bg));
  };
  for (const n of [16, 32, 48]) emit(`favicon-${n}.png`, n, vc, notAccent);
  const all = { x0: Math.min(geo.vBox.x0, geo.barBox.x0), y0: Math.min(geo.vBox.y0, geo.barBox.y0), x1: Math.max(geo.vBox.x1, geo.barBox.x1), y1: Math.max(geo.vBox.y1, geo.barBox.y1) };
  const lc = sq(all, 1.36);
  emit('apple-touch-icon.png', 180, lc);
  emit('icon-192.png', 192, lc);
  emit('icon-512.png', 512, lc);
  fs.writeFileSync(path.join(out, 'site.webmanifest'), JSON.stringify({
    name: 'vaneza', short_name: 'vaneza', start_url: '/', display: 'standalone',
    background_color: tokens.bg, theme_color: tokens.bg,
    icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
  }, null, 2));
}

// `reuse` is a finished build whose bundle and icons are identical for any register content;
// only the register-dependent markup is re-rendered. Gates use it to avoid bundling twice.
export async function build({ outDir = rel('dist'), registerPath = null, reuse = null } = {}) {
  const tokens = readTokens();
  const png = readPng(rel(LOGO_ALPHA));
  const geo = extractGeometry(png);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });

  const regModule = registerPath ? await import(pathToFileURL(registerPath).href) : await import('../src/register.js');
  const REGISTER = regModule.REGISTER;

  let js, css;
  if (reuse) {
    fs.cpSync(reuse.outDir, outDir, { recursive: true });
    ({ js, css } = reuse);
  } else {
    const res = await esbuild.build({
      entryPoints: { app: rel('src/main.js'), noscript: rel('src/noscript.css') },
      bundle: true, minify: true, format: 'iife', outdir: path.join(outDir, 'assets'),
      entryNames: '[name]-[hash]', target: ['es2020', 'chrome111', 'safari16.4', 'firefox113'],
      metafile: true, legalComments: 'none', logLevel: 'silent',
    });
    const outs = Object.keys(res.metafile.outputs).map((f) => path.basename(f));
    const find = (re) => outs.find((f) => re.test(f));
    js = find(/^app-.*\.js$/); css = find(/^app-.*\.css$/);
    const nos = find(/^noscript-.*\.css$/);
    fs.copyFileSync(path.join(outDir, 'assets', nos), path.join(outDir, 'noscript.css'));
    fs.rmSync(path.join(outDir, 'assets', nos));
    fs.writeFileSync(path.join(outDir, 'robots.txt'), 'User-agent: *\nAllow: /\n');
    icons(outDir, geo, png, tokens);
  }

  const { mark, small } = markups(geo);
  const meta = REGISTER.chain.meta;
  const connect = ["'self'", new URL(meta.rpc).origin, 'https://api.llama.fi', 'https://api.dexscreener.com'].join(' ');
  const social = (k) => socialMarkup(REGISTER[k]);
  let html = fs.readFileSync(rel('src/index.html'), 'utf8')
    .replaceAll('{{THEME}}', tokens.bg).replaceAll('{{CONNECT}}', connect)
    .replaceAll('{{CSS}}', `/assets/${css}`).replaceAll('{{JS}}', `/assets/${js}`)
    .replaceAll('{{CA}}', caMarkup(REGISTER.ca))
    .replaceAll('{{X}}', social('x')).replaceAll('{{GITHUB}}', social('github'))
    .replaceAll('{{MARK}}', mark).replaceAll('{{MARK_SMALL}}', small)
    .replaceAll('{{CHAIN_ID}}', String(meta.id))
    .replaceAll('{{LEDGER}}', ledgerRows(REGISTER));
  if (/\{\{[A-Z_]+\}\}/.test(html)) throw new Error('unresolved template slot: ' + html.match(/\{\{[A-Z_]+\}\}/)[0]);
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  return { outDir, js, css, geo, tokens };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const r = await build();
  const size = (f) => (fs.statSync(path.join(r.outDir, 'assets', f)).size / 1024).toFixed(1) + ' kB';
  console.log(`built ${r.outDir}\n  ${r.js} ${size(r.js)}\n  ${r.css} ${size(r.css)}\n  v rects ${r.geo.v.length}, bar rects ${r.geo.bar.length}`);
}
