// Gates: synthetic fixtures only, virtual clock, no live network. Hard cap of 30 gates.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { build, readTokens } from './build.mjs';
import { serve } from './serve.mjs';
import { LOGO_OPAQUE, LOGO_ALPHA, readPng, alphaProfile, samplePalette, extractGeometry, resizeToRgba, hex } from './lib/brand.mjs';
import { bigramsByLine } from './lib/text.mjs';
import { REGISTER, validateRecord, validateRegister, hrefFor, deriveHandle, isAddress } from '../src/register.js';
import { parseRpc, parseTvl, parseHistory, parsePairs } from '../src/live.js';
import { fmtInt, fmtUsd, fmtGwei } from '../src/format.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (...p) => path.join(ROOT, ...p);
const T0 = Date.now();
let browser;
const reap = () => { try { browser?.process()?.kill('SIGKILL'); } catch { /* already gone */ } };
process.on('exit', reap);
const WATCHDOG = setTimeout(() => { console.error('gates exceeded the 5 minute budget'); reap(); process.exit(2); }, 290000);

/* ---------- tiny runner ---------- */
const gates = [];
const gate = (name, fn) => gates.push({ name, fn });
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/* ---------- synthetic fixtures ---------- */
const FX_ADDR = '0x' + 'aB3f9'.repeat(8); // 40 mixed-case hex digits
const BLOCK_BASE = 77000000;
const DEX_FIXTURE = {
  pairs: [
    { chainId: 'robinhood', dexId: 'uniswap', labels: ['v4'], pairAddress: '0x01', baseToken: { symbol: 'AAA' }, quoteToken: { symbol: 'ETH' }, liquidity: { usd: 500000 }, volume: { h24: 12000 } },
    { chainId: 'robinhood', dexId: 'uniswap', labels: ['v3'], pairAddress: '0x02', baseToken: { symbol: 'BBB' }, quoteToken: { symbol: 'WETH' }, liquidity: { usd: 900000 }, volume: { h24: 30000 } },
    { chainId: 'robinhood', dexId: 'uniswap', labels: ['v4'], pairAddress: '0x02', baseToken: { symbol: 'BBB' }, quoteToken: { symbol: 'WETH' }, liquidity: { usd: 900000 }, volume: { h24: 30000 } },
    { chainId: 'ethereum', dexId: 'uniswap', labels: [], pairAddress: '0x03', baseToken: { symbol: 'DECOY' }, quoteToken: { symbol: 'ETH' }, liquidity: { usd: 99000000 }, volume: { h24: 1 } },
    ...[3, 4, 5, 6, 7, 8].map((n) => ({ chainId: 'robinhood', dexId: 'dex' + n, labels: [], pairAddress: '0x1' + n, baseToken: { symbol: 'T' + n }, quoteToken: { symbol: 'USDG' }, liquidity: { usd: 10000 * n }, volume: { h24: 1000 * n } })),
  ],
};
const TVL_FIXTURE = [{ name: 'Elsewhere', chainId: 1, tvl: 5 }, { name: 'Robinhood Chain', chainId: 4663, tvl: 1234567890 }];
const HIST_FIXTURE = Array.from({ length: 120 }, (_, i) => ({ date: 1700000000 + i * 86400, tvl: 1e6 * (i + 1) }));
const EXPECT = { top: ['BBB / WETH', 'AAA / ETH', 'T8 / USDG', 'T7 / USDG', 'T6 / USDG', 'T5 / USDG'] };

/* ---------- build both variants ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vaneza-gates-'));
const regFile = path.join(tmp, 'register.fixture.js');
fs.writeFileSync(regFile, `export const REGISTER = ${JSON.stringify({
  ca: { key: 'ca', label: 'contract address', kind: 'address', state: 'stated', value: FX_ADDR, url: null },
  x: { key: 'x', label: 'x', kind: 'social', state: 'stated', value: null, url: 'https://x.com/Fixture_DEV' },
  github: { key: 'github', label: 'github', kind: 'social', state: 'stated', value: null, url: 'https://github.com/fixture-org/fixture-repo' },
  app: { key: 'app', label: 'app', kind: 'link', state: 'absent', value: null, url: null },
  domain: REGISTER.domain, chain: REGISTER.chain,
})};\n`);

fs.writeFileSync(path.join(tmp, 'register.absent.js'), `export const REGISTER = ${JSON.stringify({ ...REGISTER, ca: { key: 'ca', label: 'contract', kind: 'address', state: 'absent', value: null, url: null } })};
`);
const real = await build({ outDir: path.join(tmp, 'real') });
const stated = await build({ outDir: path.join(tmp, 'stated'), registerPath: regFile, reuse: real });
const absent = await build({ outDir: path.join(tmp, 'absent'), registerPath: path.join(tmp, 'register.absent.js'), reuse: real });
const srvAbsent = await serve(path.join(tmp, 'absent'));
const srvReal = await serve(path.join(tmp, 'real'));
const srvStated = await serve(path.join(tmp, 'stated'));
const URLS = { absent: `http://127.0.0.1:${srvAbsent.port}/`, real: `http://127.0.0.1:${srvReal.port}/`, stated: `http://127.0.0.1:${srvStated.port}/` };
const META = REGISTER.chain.meta;
const HOSTS = new Set([new URL(META.rpc).host, 'api.llama.fi', 'api.dexscreener.com']);

/* ---------- browser plumbing ---------- */
const exe = [process.env.CHROME_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => p && fs.existsSync(p));
const SCALE = 8; // virtual clock: timers fire 8x sooner, rAF timestamps run 8x faster
const FAST_CLOCK = `(() => { const S = ${SCALE}; const st = window.setTimeout.bind(window), si = window.setInterval.bind(window), raf = window.requestAnimationFrame.bind(window);
  const sc = (d) => (d >= 10000 ? d : d / S); window.setTimeout = (f, d = 0, ...a) => st(f, sc(d), ...a); window.setInterval = (f, d = 0, ...a) => si(f, sc(d), ...a);
  window.requestAnimationFrame = (cb) => raf((t) => cb(t * S)); })();`;

function newFx(over = {}) {
  return { rpc: 'ok', llama: 'ok', dex: 'ok', hold: null, calls: 0, log: [], bad: [], ...over };
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

async function openPage(which, { width = 1440, height = 900, reduced = false, fast = true, fx = newFx(), clip = true } = {}) {
  const page = await browser.newPage();
  const mobile = width <= 430;
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  if (fast) await page.evaluateOnNewDocument(FAST_CLOCK);
  if (clip) await page.evaluateOnNewDocument(`window.__clips = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__clips.push(t); return Promise.resolve(); } }, configurable: true });`);
  page.fx = fx; page.errors = [];
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const u = new URL(req.url());
    if (u.hostname === '127.0.0.1') return req.continue();
    if (!HOSTS.has(u.host)) { fx.bad.push(req.url()); return req.abort(); }
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS });
    fx.log.push({ host: u.host, url: req.url(), method: req.method(), body: req.postData() || '' });
    if (fx.hold) await fx.hold;
    const json = (v, status = 200) => req.respond({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(v) });
    if (u.host === new URL(META.rpc).host) {
      if (fx.rpc === 'fail') return json({ error: 'down' }, 500);
      fx.calls++;
      const one = (c) => ({ jsonrpc: '2.0', id: c.id, result: c.method === 'eth_blockNumber' ? '0x' + (BLOCK_BASE + 1000 * fx.calls).toString(16) : c.method === 'eth_gasPrice' ? '0x1e590b0' : '0x1237' });
      const body = JSON.parse(req.postData());
      return json(Array.isArray(body) ? body.map(one) : one(body));
    }
    if (u.host === 'api.llama.fi') {
      if (fx.llama === 'fail') return json({}, 500);
      return json(u.pathname.includes('historicalChainTvl') ? HIST_FIXTURE : TVL_FIXTURE);
    }
    if (fx.dex === 'fail') return json({}, 500);
    return json(DEX_FIXTURE);
  });
  await page.goto(URLS[which], { waitUntil: 'domcontentloaded' });
  return page;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (page, fn, arg, ms = 8000) => { await page.waitForFunction(fn, { timeout: ms }, arg); };
const jump = (page, y) => page.evaluate((yy) => window.scrollTo({ top: yy, behavior: 'instant' }), y);
const scrollThrough = async (page) => {
  const H = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= H; y += 700) { await jump(page, y); await sleep(40); }
};
const ready = (page) => until(page, () => document.querySelector('[data-live="pairs"]').dataset.state === 'ready' && document.querySelector('[data-live="tvl"]').dataset.state === 'ready' && document.querySelector('[data-live="block"]').dataset.state === 'ready');
async function withPage(which, opts, fn) {
  const page = await openPage(which, opts);
  try { return await fn(page); } finally { await page.close(); }
}

/* ======================================================================== */
/* STATIC GATES                                                              */
/* ======================================================================== */

gate('01 register: real records are valid and inert where absent', () => {
  eq(validateRegister(), [], 'real register errors');
  for (const k of ['x', 'github', 'app']) { eq(REGISTER[k].state, 'absent', k + ' state'); eq(hrefFor(REGISTER[k]), null, k + ' href'); }
  // the contract record may be absent or stated; either branch must be internally consistent
  const ca = REGISTER.ca;
  ok(['absent', 'stated'].includes(ca.state), 'ca state: ' + ca.state);
  if (ca.state === 'absent') eq([ca.value, ca.url], [null, null], 'absent ca carries data');
  else ok(isAddress(ca.value), 'stated ca must be a 20-byte hex address');
  eq(hrefFor(ca), null, 'ca never gets an href');
  eq(hrefFor(REGISTER.domain), 'https://vaneza.dev', 'domain href');
  ok(Object.values(REGISTER).every((r) => !('handle' in r)), 'handle stored on a record');
});

gate('02 register: state machine over synthetic fixtures', () => {
  const s = (o) => ({ key: 'x', kind: 'social', label: 'x', state: 'stated', value: null, url: 'https://x.com/Name', ...o });
  eq(hrefFor(s({})), 'https://x.com/Name', 'stated gets href');
  eq(hrefFor(s({ state: 'unconfirmed' })), null, 'unconfirmed href');
  eq(hrefFor(s({ state: 'absent', url: null })), null, 'absent href');
  eq(hrefFor(s({ url: 'http://x.com/Name' })), null, 'plain http href');
  eq(hrefFor(s({ url: 'javascript:alert(1)' })), null, 'javascript href');
  ok(validateRecord(s({ state: 'absent' })).length > 0, 'absent record carrying data must fail');
  ok(validateRecord(s({ handle: '@Name' })).length > 0, 'stored handle must fail');
  ok(validateRecord(s({ url: 'https://example.com/Name' })).length > 0, 'stated social on a foreign host must fail');
  eq(validateRecord(s({})), [], 'good stated social');
});

gate('03 link rule: handle is derived from the url, never stored', () => {
  eq(deriveHandle('x', 'https://x.com/Vaneza_DEV'), '@Vaneza_DEV', 'x');
  eq(deriveHandle('x', 'https://twitter.com/Vaneza_DEV/?s=1'), '@Vaneza_DEV', 'x with query');
  eq(deriveHandle('github', 'https://github.com/org'), 'org', 'gh org');
  eq(deriveHandle('github', 'https://github.com/org/repo/'), 'org/repo', 'gh repo');
  eq(deriveHandle('x', 'https://github.com/org'), null, 'wrong host');
  eq(deriveHandle('x', 'https://x.com/'), null, 'empty path');
  ok(deriveHandle('x', 'https://x.com/One') !== deriveHandle('x', 'https://x.com/Two'), 'handle must follow url');
});

gate('04 address check: 0x hex is never rejected wholesale', () => {
  for (const a of ['0x' + 'a'.repeat(40), '0x' + 'A'.repeat(40), FX_ADDR, '0x' + '0'.repeat(40), '0x' + '0123456789abcdefABCDEF0123456789abcdefAB'.slice(0, 40)]) ok(isAddress(a), 'rejected valid ' + a);
  for (const a of ['0x' + 'a'.repeat(39), '0x' + 'a'.repeat(41), 'a'.repeat(40), '0x' + 'g'.repeat(40), '', null]) ok(!isAddress(a), 'accepted invalid ' + a);
  eq(validateRecord({ key: 'ca', kind: 'address', state: 'stated', value: FX_ADDR, url: null }), [], 'stated mixed-case ca');
  ok(validateRecord({ key: 'ca', kind: 'address', state: 'stated', value: '0x12', url: null }).length > 0, 'short ca must fail');
});

const LITERAL_RES = [/#[0-9a-fA-F]{3,8}\b/, /\brgba?\(/i, /\bhsla?\(/i, /\b(?:oklch|oklab|lab|lch|hwb)\(/i,
  /(?:color|background(?:-color)?|border(?:-[a-z]+)*|fill|stroke|outline(?:-color)?)\s*:\s*[^;{}]*\b(?:black|white|red|green|blue|yellow|orange|purple|gray|grey|silver|cyan|magenta|pink)\b/i];
const literalHits = (text) => LITERAL_RES.flatMap((re) => (text.match(new RegExp(re.source, 'gi')) || []));
const walk = (dir, out = []) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) { if (!['node_modules', 'dist'].includes(f.name)) walk(p, out); } else out.push(p); } return out; };
const srcFiles = () => walk(rel('src')).filter((f) => /\.(css|js|html)$/.test(f));

gate('05 palette rule: colour literals live only in tokens.css', () => {
  // scanner controls, including 0x hex that must NOT count as a colour
  for (const bad of ['color:#fff', 'a{fill:#a1b2c3d4}', 'rgb(1,2,3)', 'hsla(0 0% 0%)', 'border: 1px solid white']) ok(literalHits(bad).length, 'scanner missed ' + bad);
  for (const fine of ['0x1237', '0xAbC123', FX_ADDR, 'href="#ledger"', 'var(--acc)', 'color-mix(in srgb, var(--fg) 4%, var(--bg))', 'currentColor']) eq(literalHits(fine), [], 'scanner flagged ' + fine);
  const offenders = [];
  for (const f of srcFiles()) {
    if (path.basename(f) === 'tokens.css') continue;
    const text = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const hits = literalHits(text);
    if (hits.length) offenders.push(`${path.relative(ROOT, f)}: ${hits.slice(0, 3).join(' ')}`);
  }
  eq(offenders, [], 'literals outside tokens.css');
});

gate('06 palette provenance: every token is a real pixel at its stated coordinate', () => {
  const css = fs.readFileSync(rel('src/tokens.css'), 'utf8');
  const prov = [...css.matchAll(/prov (\w+) (#[0-9a-f]{6}) @ (\d+),(\d+)/g)];
  eq(prov.map((m) => m[1]), ['bg', 'fg', 'acc'], 'provenance names');
  const png = readPng(rel(LOGO_OPAQUE));
  for (const [, name, h, x, y] of prov) {
    const i = (Number(y) * png.w + Number(x)) * 4;
    eq(hex(png.data[i], png.data[i + 1], png.data[i + 2]), h, `pixel for ${name}`);
    ok(css.includes(`--${name}: ${h};`), `--${name} differs from provenance`);
  }
  const again = samplePalette(png, 3).map((c) => c.hex).sort();
  eq(again, prov.map((m) => m[2]).sort(), 'k-means is reproducible');
});

gate('07 brand rasters: premultiplied resize keeps edge colour clean', () => {
  const alpha = readPng(rel(LOGO_ALPHA));
  eq(alpha.ihdr.colorType, 6, 'alpha logo colour type');
  ok(alphaProfile(alpha.data).clearBlack > 1e6, 'alpha logo must contain pure-black transparent regions');
  // 8x8: left half opaque white, right half clear black. A straddling output pixel must stay white.
  const src = Buffer.alloc(8 * 8 * 4);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const i = (y * 8 + x) * 4; if (x < 4) { src[i] = src[i + 1] = src[i + 2] = 255; src[i + 3] = 255; } }
  const out = resizeToRgba(src, 8, { x: 0, y: 0, side: 8 }, 3);
  const mid = out.slice((1 * 3 + 1) * 4, (1 * 3 + 1) * 4 + 4);
  ok(mid[3] > 60 && mid[3] < 200, 'edge pixel should be partly transparent, alpha=' + mid[3]);
  ok(mid[0] >= 250 && mid[1] >= 250 && mid[2] >= 250, 'edge colour darkened by clear black: ' + [...mid]);
});

gate('08 favicon is traced from the logo pixel grid', () => {
  const alpha = readPng(rel(LOGO_ALPHA));
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < alpha.h; y++) for (let x = 0; x < alpha.w; x++) {
    const i = (y * alpha.w + x) * 4;
    if (alpha.data[i + 3] >= 128 && !(alpha.data[i + 1] - alpha.data[i + 2] > 60)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
  }
  const g = extractGeometry(alpha);
  ok(g.v.length >= 6, 'too few V rects: ' + g.v.length);
  for (const [k, want] of [['x0', x0], ['y0', y0], ['x1', x1], ['y1', y1]]) ok(Math.abs(g.vBox[k] - want) <= 2, `V bbox ${k} ${g.vBox[k]} vs ${want}`);
  const svg = fs.readFileSync(path.join(tmp, 'real/favicon.svg'), 'utf8');
  eq((svg.match(/<rect/g) || []).length, g.v.length + 1, 'favicon rect count');
  const t = readTokens();
  ok(svg.includes(t.bg) && svg.includes(t.fg), 'favicon colours must be the sampled tokens');
  for (const [f, n] of [['favicon-16.png', 16], ['favicon-32.png', 32], ['favicon-48.png', 48], ['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
    const b = fs.readFileSync(path.join(tmp, 'real', f));
    eq([b.readUInt32BE(16), b.readUInt32BE(20)], [n, n], f + ' size');
  }
  const p32 = readPng(path.join(tmp, 'real/favicon-32.png'));
  let lit = 0; for (let i = 0; i < p32.data.length; i += 4) if (p32.data[i] > 120) lit++;
  ok(lit > 60 && lit < 600, 'favicon-32 should show a V, lit pixels=' + lit);
});

gate('09 artifacts: policy-clean html, csp, no ch units', () => {
  const dist = path.join(tmp, 'real');
  for (const f of ['index.html', 'noscript.css', 'site.webmanifest', 'robots.txt', 'favicon.svg']) ok(fs.existsSync(path.join(dist, f)), 'missing ' + f);
  eq(fs.readdirSync(path.join(dist, 'assets')).length, 2, 'asset count');
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  ok(!/\sstyle=/.test(html), 'inline style attribute present');
  ok(!/<script(?![^>]*\ssrc=)[^>]*>/.test(html), 'inline script present');
  ok(!/\{\{|\}\}/.test(html), 'template slot left behind');
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] || '';
  ok(/connect-src 'self' https:\/\/rpc\.mainnet\.chain\.robinhood\.com https:\/\/api\.llama\.fi https:\/\/api\.dexscreener\.com;/.test(csp), 'csp connect-src: ' + csp);
  ok(/script-src 'self';/.test(csp) && !/unsafe/.test(csp), 'csp scripts');
  const offenders = [];
  for (const f of srcFiles().filter((p) => /\.(css|html)$/.test(p))) {
    const text = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/(?<![\w.-])\d*\.?\d+ch\b/.test(text)) offenders.push(path.relative(ROOT, f));
  }
  eq(offenders, [], 'ch units');
});

gate('10 repo hygiene: no agent files, no machine attribution', () => {
  const bad = [];
  const all = [];
  const scan = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { if (f.name === 'node_modules') continue; const p = path.join(dir, f.name); all.push(p); if (f.isDirectory()) scan(p); } };
  scan(ROOT);
  const agent = ['cla', 'ude'].join('');
  for (const p of all) if (path.basename(p).toLowerCase() === `${agent}.md` || path.basename(p) === `.${agent}`) bad.push('forbidden path ' + path.relative(ROOT, p));
  const needles = [['Co-Authored', 'By'].join('-'), ['Generated', 'with'].join(' '), ['Anthro', 'pic'].join(''), ['Cla', 'ude'].join(''), ['AI', 'generated'].join('-'), ['noreply@', 'anthro', 'pic'].join('')];
  for (const p of all) {
    if (!/\.(m?js|css|html|json|md|txt|svg|webmanifest)$/.test(p) || fs.statSync(p).isDirectory() || /package-lock\.json$/.test(p)) continue;
    const rp = path.relative(ROOT, p);
    if (rp.startsWith('reference') || rp.startsWith('brand') || rp.startsWith(path.join('scripts', 'fixtures'))) continue;
    const text = fs.readFileSync(p, 'utf8');
    for (const n of needles) if (text.toLowerCase().includes(n.toLowerCase())) bad.push(`${rp}: ${n}`);
  }
  eq(bad, [], 'hygiene');
});

gate('11 copy: no word pair is shared with the reference', () => {
  const ref = new Set(JSON.parse(fs.readFileSync(rel('scripts/fixtures/ref-bigrams.json'), 'utf8')));
  ok(ref.size > 1000, 'reference fingerprint is missing');
  const html = fs.readFileSync(path.join(tmp, 'real/index.html'), 'utf8');
  const text = html.replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, ' ').replace(/<head>[\s\S]*?<\/head>/, ' ')
    .replace(/<\/?(?:p|h\d|li|ul|ol|dl|div|section|article|dt|dd|td|th|tr|thead|tbody|table|header|footer|main|nav|button|a)\b[^>]*>/g, '\n').replace(/<[^>]+>/g, ' ');
  const meta = [...html.matchAll(/(?:name="description"|property="og:description"|<title>)[^>]*content="([^"]+)"/g)].map((m) => m[1]).join('\n');
  const strings = 'unavailable connecting live partial offline copy copied select';
  const shared = [...new Set(bigramsByLine(text + '\n' + meta + '\n' + strings))].filter((g) => ref.has(createHash('sha1').update(g).digest('hex').slice(0, 10)));
  eq(shared, [], 'shared word pairs');
});

gate('12 parsers + formatters over synthetic payloads', () => {
  const b = (id, result) => ({ jsonrpc: '2.0', id, result });
  eq(parseRpc([b(1, '0x10'), b(2, '0x20'), b(3, '0x1237')]), { block: 16, gasWei: 32, chainId: 4663 }, 'batch');
  eq(parseRpc([b(1, '0x10')]).gasWei, null, 'gas optional');
  for (const bad of [[b(1, '0x10'), b(3, '0x1')], [b(2, '0x1')], { error: 'x' }, [b(1, 'nothex')]]) { let threw = false; try { parseRpc(bad); } catch { threw = true; } ok(threw, 'rpc should reject ' + JSON.stringify(bad)); }
  eq(parseTvl(TVL_FIXTURE), 1234567890, 'tvl');
  let t = false; try { parseTvl([{ name: 'x', chainId: 1, tvl: 1 }]); } catch { t = true; } ok(t, 'tvl without chain must throw');
  eq(parseHistory(HIST_FIXTURE).length, 90, 'history window');
  t = false; try { parseHistory(HIST_FIXTURE.map((p) => ({ ...p, tvl: 0 }))); } catch { t = true; } ok(t, 'all-zero history must throw');
  eq(parsePairs(DEX_FIXTURE).map((p) => p.name), EXPECT.top, 'pairs order, dedupe, chain filter');
  eq([fmtGwei(31625392), fmtGwei(2.5e9), fmtGwei(4e11), fmtUsd(1044662287), fmtUsd(118879), fmtInt(78452578)], ['0.0316', '2.50', '400', '$1.04B', '$118.88K', '78,452,578'], 'formatters');
});

/* ======================================================================== */
/* BROWSER GATES                                                             */
/* ======================================================================== */

gate('13 live data: skeletons first, then fixtures, in every tile', async () => {
  let release; const hold = new Promise((r) => { release = r; });
  await withPage('real', { fx: newFx({ hold }) }, async (page) => {
    await until(page, () => document.querySelector('[data-live="block"]'));
    await sleep(150);
    const during = await page.evaluate(() => [...document.querySelectorAll('[data-live]')].map((el) => {
      const sk = el.querySelector('.skel') || el.parentElement.querySelector('.skel');
      return { name: el.dataset.live, state: el.dataset.state, skeleton: !!sk && getComputedStyle(sk).display !== 'none', anim: sk ? getComputedStyle(sk).animationName : '' };
    }));
    eq(during.map((d) => d.name), ['block', 'gas', 'tvl', 'volume', 'spark', 'pairs'], 'live regions');
    for (const d of during) { eq(d.state, 'loading', d.name + ' state'); ok(d.skeleton, d.name + ' has no visible skeleton'); }
    release();
    await ready(page);
    await sleep(400);
    const got = await page.evaluate(() => ({
      gas: document.querySelector('[data-live="gas"] .num').textContent,
      tvl: document.querySelector('[data-live="tvl"] .num').textContent,
      vol: document.querySelector('[data-live="volume"] .num').textContent,
      pairs: [...document.querySelectorAll('[data-live="pairs"] tr:not(.sk) .pair-n')].map((e) => e.textContent),
      skelLeft: [...document.querySelectorAll('[data-live] .skel')].filter((e) => getComputedStyle(e).display !== 'none').length,
      sparkD: document.querySelector('.spark-line').getAttribute('d').length,
    }));
    eq(got.pairs, EXPECT.top, 'pair rows');
    eq(got.gas, '0.0318', 'gas'); eq(got.tvl, '$1.23B', 'tvl');
    eq(got.vol, fmtUsd(30000 + 12000 + 8000 + 7000 + 6000 + 5000), 'volume');
    eq(got.skelLeft, 0, 'skeletons still showing'); ok(got.sparkD > 100, 'sparkline path empty');
    eq(page.errors, [], 'console errors');
  });
});

gate('14 numbers count up and flash on change', async () => {
  await withPage('real', {}, async (page) => {
    await page.evaluate(() => { const el = document.querySelector('[data-live="block"] .num'); window.__rec = []; new MutationObserver(() => window.__rec.push({ t: el.textContent, f: el.classList.contains('flash') })).observe(el, { characterData: true, childList: true, subtree: true, attributes: true }); });
    await until(page, (n) => window.__rec.some((r) => r.t === n), fmtInt(BLOCK_BASE + 1000));
    await until(page, (n) => window.__rec.some((r) => r.t === n), fmtInt(BLOCK_BASE + 2000));
    const rec = await page.evaluate(() => window.__rec);
    const texts = [...new Set(rec.map((r) => r.t))];
    ok(texts.length >= 4, 'count-up produced no intermediate frames: ' + texts.join(' | '));
    ok(rec.some((r) => r.f), 'no flash class on a later change');
    const vals = texts.map((t) => Number(t.replace(/,/g, ''))).filter((n) => Number.isFinite(n));
    ok(vals.some((v) => v > 0 && v < BLOCK_BASE), 'first paint must climb from zero');
  });
});

gate('15 status pill follows source health; only live pulses', async () => {
  const run = async (fx, want, pulse) => withPage('real', { fx: newFx(fx) }, async (page) => {
    await until(page, (w) => document.querySelector('[data-pill]').dataset.state === w, want);
    const r = await page.evaluate(() => { const p = [...document.querySelectorAll('[data-pill]')].find((e) => e.offsetParent); return { anim: getComputedStyle(p.querySelector('.dot'), '::after').animationName, vis: !!p, text: p.textContent.trim() }; });
    ok(r.vis, 'no visible pill'); eq(r.text, want, 'pill text');
    eq(r.anim === 'ping', pulse, `pulse animation (${r.anim})`);
    if (want === 'offline') {
      const st = await page.evaluate(() => [...document.querySelectorAll('[data-live]')].map((e) => e.dataset.state));
      eq(st, Array(6).fill('error'), 'regions after total failure');
    }
    eq(page.errors.filter((e) => e.startsWith('pageerror')), [], 'uncaught errors');
  });
  await run({}, 'live', true);
  await run({ dex: 'fail' }, 'partial', false);
  await run({ rpc: 'fail', llama: 'fail', dex: 'fail' }, 'offline', false);
});

gate('16 contract slot absent: top, visible, inert, undated', async () => {
  await withPage('absent', {}, async (page) => {
    await ready(page);
    const r = await page.evaluate(() => {
      const ca = document.getElementById('ca'); const b = ca.getBoundingClientRect();
      return { tag: ca.tagName, state: ca.dataset.state, inert: !ca.querySelector('a, button, [tabindex]'), top: Math.round(b.top), h: Math.round(b.height), text: ca.textContent.replace(/\s+/g, ' ').trim(), first: document.body.querySelector(':scope > .skip + .progress + .top > .ca') !== null, page: document.body.innerText };
    });
    eq([r.tag, r.state, r.inert, r.top], ['DIV', 'absent', true, 0], 'slot shape');
    ok(/not published yet/.test(r.text) && !/0x[0-9a-f]{4}/i.test(r.text), 'slot text: ' + r.text);
    ok(r.first, 'slot is not the first block of the page');
    const dated = r.page.match(/\b(?:19|20)\d{2}\b|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b/gi);
    eq(dated, null, 'dates on an undated page');
    await page.click('#ca');
    eq(await page.evaluate(() => window.__clips.length), 0, 'clicking an absent slot copied something');
  });
});

gate('17 contract slot stated: full address, click-to-copy', async () => {
  await withPage('stated', { fast: false }, async (page) => {
    await ready(page);
    const r = await page.evaluate(() => { const b = document.querySelector('#ca button.ca-copy'); return { has: !!b, addr: b && b.querySelector('.ca-addr').textContent, data: b && b.dataset.copy, state: document.getElementById('ca').dataset.state }; });
    eq([r.has, r.addr, r.data, r.state], [true, FX_ADDR, FX_ADDR, 'stated'], 'stated slot');
    await page.click('#ca button.ca-copy');
    await until(page, () => document.querySelector('[data-hint]').textContent === 'copied');
    eq(await page.evaluate(() => window.__clips), [FX_ADDR], 'clipboard payload');
    await until(page, () => document.querySelector('[data-hint]').textContent === 'copy');
    ok(await page.evaluate(() => !document.querySelector('.ca-copy').hasAttribute('data-copied')), 'copied state did not reset');
  });
});

gate('18 socials absent: icons only, inert, nothing links out', async () => {
  await withPage('real', {}, async (page) => {
    const r = await page.evaluate(() => ({
      soc: [...document.querySelectorAll('.soc')].map((e) => ({ tag: e.tagName, href: e.getAttribute('href'), tab: e.getAttribute('tabindex'), label: e.getAttribute('aria-label'), text: e.textContent.trim() })),
      out: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => /x\.com|twitter|github/i.test(h)),
    }));
    eq(r.soc.length, 4, 'icon count (header + footer)');
    for (const s of r.soc) { eq([s.tag, s.href, s.tab, s.text], ['SPAN', null, null, ''], 'inert icon'); ok(/not published yet/.test(s.label), 'label ' + s.label); }
    eq(r.out, [], 'outbound social links');
  });
});

gate('19 socials stated: top-right, links derived from the url', async () => {
  await withPage('stated', {}, async (page) => {
    const r = await page.evaluate(() => {
      const bar = document.querySelector('.bar-in'); const last = bar.lastElementChild; const b = last.getBoundingClientRect();
      return { lastIsSocials: last.classList.contains('socials'), cx: b.x + b.width / 2, vw: innerWidth, top: b.top, links: [...document.querySelectorAll('.socials a')].map((a) => [a.href, a.rel, a.target, a.getAttribute('aria-label')]) };
    });
    ok(r.lastIsSocials && r.cx > r.vw / 2 && r.top < 120, 'socials are not top-right');
    eq(r.links.slice(0, 2), [['https://x.com/Fixture_DEV', 'noopener noreferrer', '_blank', 'X: @Fixture_DEV'], ['https://github.com/fixture-org/fixture-repo', 'noopener noreferrer', '_blank', 'GitHub: fixture-org/fixture-repo']], 'derived links');
  });
});

const BPS = [[360, 800], [390, 844], [430, 932], [1366, 768], [1440, 900]];
const OVERFLOW = () => {
  const vw = document.documentElement.clientWidth; const bad = [];
  if (document.documentElement.scrollWidth > vw) bad.push('doc scrollWidth ' + document.documentElement.scrollWidth);
  if (document.body.scrollWidth > vw) bad.push('body scrollWidth ' + document.body.scrollWidth);
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue;
    if (r.right > vw + 0.5 || r.left < -0.5) {
      let p = el.parentElement, clipped = false;
      while (p && p !== document.body) { const o = getComputedStyle(p); if (['hidden', 'clip', 'auto', 'scroll'].includes(o.overflowX)) { clipped = true; break; } p = p.parentElement; }
      if (!clipped && getComputedStyle(el).position !== 'fixed') bad.push(`${el.tagName}.${el.className} ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
  }
  return bad;
};

// One sweep per (build, breakpoint); gates 20-22 each judge their own slice of the same measurements.
const TAP_SEL = 'a[href], button, [role="button"], summary, input, select, textarea, [tabindex]:not([tabindex="-1"])';
const SLOT = () => {
  const ca = document.getElementById('ca'); const b = ca.getBoundingClientRect(); const a = ca.querySelector('.ca-addr, .ca-note'); const ab = a.getBoundingClientRect();
  return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, vw: innerWidth, vh: innerHeight, inside: ab.left >= 0 && ab.right <= innerWidth + 0.5, clipped: a.scrollWidth > a.clientWidth + 1, text: a.textContent };
};
const TAPS = (sel) => [...document.querySelectorAll(sel)]
  .filter((e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && (r.width || r.height); })
  .map((e) => { const r = e.getBoundingClientRect(); return { n: e.tagName + '.' + e.className, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; })
  .filter((x) => x.w < 47.5 || x.h < 47.5);
let sweepCache;
async function sweep() {
  if (sweepCache) return sweepCache;
  const out = [];
  for (const which of ['real', 'stated']) for (const [w, h] of BPS) {
    out.push(await withPage(which, { width: w, height: h }, async (page) => {
      await ready(page);
      const slotTop = await page.evaluate(SLOT);
      await sleep(100);
      const overflow = await page.evaluate(OVERFLOW);
      const small = await page.evaluate(TAPS, TAP_SEL);
      await jump(page, 99999); await sleep(120);
      const slotBottom = await page.evaluate(SLOT);
      return { which, w, overflow, small, slots: { top: slotTop, bottom: slotBottom } };
    }));
  }
  return (sweepCache = out);
}

gate('20 five breakpoints: no horizontal overflow (absent + stated)', async () => {
  for (const s of await sweep()) eq(s.overflow, [], s.which + ' @' + s.w);
});

gate('21 five breakpoints: every tap target is 48px or larger', async () => {
  for (const s of await sweep()) eq(s.small, [], s.which + ' @' + s.w);
});

gate('22 five breakpoints: contract slot stays on screen and never clips', async () => {
  for (const s of await sweep()) for (const where of ['top', 'bottom']) {
    const r = s.slots[where]; const tag = s.which + ' @' + s.w + ' ' + where;
    ok(r.top >= 0 && r.bottom <= r.vh && r.left >= 0 && r.right <= r.vw + 0.5, tag + ': slot off screen ' + JSON.stringify(r));
    ok(r.inside && !r.clipped, tag + ': address clipped');
    if (s.which === 'stated') eq(r.text, FX_ADDR, tag + ' full address');
  }
});

gate('23 reduced motion: everything lands instantly', async () => {
  await withPage('real', { reduced: true, fast: false }, async (page) => {
    await page.evaluate(() => { const el = document.querySelector('[data-live="block"] .num'); window.__rec = []; new MutationObserver(() => window.__rec.push(el.textContent)).observe(el, { characterData: true, childList: true, subtree: true }); });
    await ready(page);
    const r = await page.evaluate(() => ({
      hidden: [...document.querySelectorAll('[data-reveal]')].filter((e) => getComputedStyle(e).opacity !== '1' || getComputedStyle(e).transform !== 'none').length,
      px: [...document.querySelectorAll('.mark .px')].filter((e) => getComputedStyle(e).opacity !== '1').length,
      dur: [...document.querySelectorAll('[data-reveal]')].map((e) => getComputedStyle(e).transitionDuration).filter((d) => d !== '0s').length,
      anims: ['.bar-u', '.mark-wrap.in .cursor', '.skel'].map((s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).animationName : 'none'; }),
      rec: window.__rec,
    }));
    eq([r.hidden, r.px, r.dur], [0, 0, 0], 'hidden / px / durations');
    ok(r.anims.every((a) => a === 'none'), 'animations still running: ' + r.anims);
    ok(new Set(r.rec).size <= 2, 'count-up ran under reduced motion: ' + r.rec.join('|'));
    await jump(page, 400); await sleep(150);
    eq(await page.evaluate(() => document.querySelector('.stage-mark').style.transform), '', 'parallax moved under reduced motion');
  });
});

gate('24 reveal stagger, parallax depth, scroll progress', async () => {
  await withPage('real', { fast: false }, async (page) => {
    await ready(page);
    const before = await page.evaluate(() => [...document.querySelectorAll('.tile')].map((e) => [e.classList.contains('in'), getComputedStyle(e).opacity]));
    ok(before.every(([i, o]) => !i && o === '0'), 'below-fold tiles must start hidden: ' + JSON.stringify(before));
    const delays = await page.evaluate(() => [...document.querySelectorAll('.tile')].map((e) => parseFloat(getComputedStyle(e).transitionDelay.split(',')[0])));
    ok(delays.every((d, i) => i === 0 || d > delays[i - 1]), 'stagger delays must rise: ' + delays);
    await jump(page, await page.evaluate(() => document.getElementById('pulse').offsetTop - 80));
    await until(page, () => [...document.querySelectorAll('.tile')].every((e) => e.classList.contains('in')), null, 4000);
    await jump(page, 300); await sleep(200);
    const ty = await page.evaluate(() => ['.stage-mark', '.stage-grid', '.stage-glow'].map((s) => new DOMMatrix(getComputedStyle(document.querySelector(s)).transform).m42));
    ok(ty[0] < 0 && ty[1] > 0 && ty[2] > ty[1], 'parallax depths: ' + ty);
    const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    const prog = async (y) => { await jump(page, y); await sleep(150); return page.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('progress')).transform).a); };
    ok((await prog(0)) < 0.01, 'progress at top');
    ok(Math.abs((await prog(Math.round(max / 2))) - 0.5) < 0.02, 'progress at half');
    ok((await prog(max)) > 0.99, 'progress at bottom');
  });
});

gate('25 hover states: every link and button has a transition', async () => {
  await withPage('stated', {}, async (page) => {
    await ready(page);
    const none = await page.evaluate(() => [...document.querySelectorAll('a[href], button')].filter((e) => getComputedStyle(e).transitionDuration.split(',').every((d) => parseFloat(d) === 0)).map((e) => e.tagName + '.' + e.className));
    eq(none, [], 'interactive elements without transition');
    const before = await page.evaluate(() => getComputedStyle(document.querySelector('.btn-p')).backgroundColor);
    await page.hover('.btn-p'); await sleep(350);
    ok(before !== await page.evaluate(() => getComputedStyle(document.querySelector('.btn-p')).backgroundColor), 'primary button has no hover change');
  });
});

gate('26 network discipline: only the three feeds, polled repeatedly, no console noise', async () => {
  const fx = newFx();
  await withPage('real', { fx }, async (page) => {
    await ready(page);
    await until(page, () => document.querySelector('[data-live="block"] .num').textContent.length > 0 && true);
    await sleep(1800);
    eq(fx.bad, [], 'requests to hosts outside the allow-list');
    const rpc = fx.log.filter((l) => l.host === new URL(META.rpc).host && l.method === 'POST');
    ok(rpc.length >= 2, 'rpc was not polled repeatedly: ' + rpc.length);
    for (const m of ['eth_blockNumber', 'eth_gasPrice', 'eth_chainId']) ok(rpc[0].body.includes(m), 'rpc body lacks ' + m);
    ok(fx.log.some((l) => l.url === 'https://api.llama.fi/v2/chains'), 'no chains request');
    ok(fx.log.some((l) => l.url.includes('/historicalChainTvl/Robinhood%20Chain')), 'no history request');
    ok(fx.log.some((l) => l.host === 'api.dexscreener.com' && l.url.includes('/latest/dex/search')), 'no dexscreener request');
    eq(page.errors, [], 'console / page errors (includes CSP violations)');
  });
});

gate('27 structure: one h1, labelled landmarks, working anchors, no marquee', async () => {
  await withPage('real', {}, async (page) => {
    const r = await page.evaluate(() => ({
      lang: document.documentElement.lang, h1: document.querySelectorAll('h1').length,
      anchors: [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href').slice(1)).filter((id) => id && !document.getElementById(id)),
      labelled: [...document.querySelectorAll('[aria-labelledby]')].filter((e) => !document.getElementById(e.getAttribute('aria-labelledby'))).length,
      navs: [...document.querySelectorAll('nav')].filter((n) => !n.getAttribute('aria-label')).length,
      pill: !!document.querySelector('[data-pill][role="status"]'),
      marquee: !!document.querySelector('marquee, [class*="marquee"]'),
      title: document.title,
    }));
    eq([r.lang, r.h1, r.anchors, r.labelled, r.navs, r.pill, r.marquee], ['en', 1, [], 0, 0, true, false], 'structure');
    ok(r.title.length > 8, 'title');
  });
});

/* ---------- run ---------- */
ok(gates.length <= 30, 'gate cap exceeded: ' + gates.length);
let failed = 0;
try {
  ok(exe, 'no Chromium-based browser found (set CHROME_PATH)');
  const launch = async () => { reap(); browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] }); };
  await launch();
  const lost = (e) => /Connection closed|Session closed|Target closed|Protocol error/.test(String(e.message));
  const attempt = (g) => Promise.race([g.fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('gate timed out after 100 s')), 100000))]);
  for (const g of gates) {
    const t = Date.now();
    try {
      // browser died under load: one fresh start, one retry
      try { await attempt(g); } catch (e) { if (!lost(e)) throw e; await launch(); sweepCache = undefined; await attempt(g); }
      console.log(`PASS  ${g.name}  (${Date.now() - t} ms)`);
    }
    catch (e) { failed++; console.log(`FAIL  ${g.name}\n      ${String(e.message).split('\n').join('\n      ')}`); }
  }
} finally {
  if (browser) { await Promise.race([browser.close().catch(() => {}), sleep(4000)]); try { browser.process()?.kill('SIGKILL'); } catch { /* already gone */ } }
  srvAbsent.server.close(); srvReal.server.close(); srvStated.server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  clearTimeout(WATCHDOG);
}
console.log(`\n${gates.length - failed}/${gates.length} gates passed in ${((Date.now() - T0) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
