import './styles.css';
import { fetchRpc, fetchTvl, fetchPairs } from './live.js';
import { fmtInt, fmtUsd, fmtGwei } from './format.js';
import { counter, initReveal, initProgress, initParallax, initSpy, initVeil } from './motion.js';

const RPC_EVERY_MS = 6000;
const MARKET_EVERY_MS = 60000;

const $ = (sel, root = document) => root.querySelector(sel);
const live = (name) => $(`[data-live="${name}"]`);
const setState = (el, state) => { if (el) el.dataset.state = state; };

/* ---------- contract slot ---------- */
function initCopy() {
  const btn = $('.ca-copy');
  if (!btn) return;
  const hint = $('[data-hint]', btn);
  let timer = 0;
  const done = (ok) => {
    hint.textContent = ok ? 'copied' : 'select + copy';
    btn.toggleAttribute('data-copied', ok);
    clearTimeout(timer);
    timer = setTimeout(() => { hint.textContent = 'copy'; btn.removeAttribute('data-copied'); }, 1600);
  };
  btn.addEventListener('click', async () => {
    const text = btn.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
      return done(true);
    } catch { /* fall through to the legacy path */ }
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.className = 'sr';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    done(ok);
  });
}

/* ---------- live data ---------- */
const nums = {};
function tile(name, fmt) {
  const host = live(name);
  const num = $('[data-num]', host);
  nums[name] = { host, ctr: counter(num, fmt), has: false };
}
function show(name, value) {
  const t = nums[name];
  t.has = true;
  setState(t.host, 'ready');
  t.ctr.set(value);
}
function fail(name) {
  const t = nums[name];
  if (!t.has) setState(t.host, 'error');
}

const health = { rpc: null, tvl: null, dex: null };
function pillState() {
  const vals = Object.values(health);
  const seen = vals.filter((v) => v !== null);
  const ok = seen.filter(Boolean).length;
  if (seen.length === vals.length) return ok === vals.length ? 'live' : ok ? 'partial' : 'offline';
  return ok && ok < seen.length ? 'partial' : 'connecting';
}
function paintPill() {
  const state = pillState();
  document.querySelectorAll('[data-pill]').forEach((p) => {
    p.dataset.state = state;
    const t = $('[data-pill-t]', p);
    if (t) t.textContent = state;
  });
}

async function pollRpc() {
  try {
    const r = await fetchRpc();
    show('block', r.block);
    if (r.gasWei != null) show('gas', r.gasWei); else fail('gas');
    health.rpc = true;
  } catch {
    fail('block'); fail('gas');
    health.rpc = false;
  }
  paintPill();
}

function drawSpark(series) {
  const host = live('spark');
  const min = Math.min(...series), max = Math.max(...series);
  const span = max - min || 1;
  const pts = series.map((v, i) => [(i / (series.length - 1)) * 320, 112 - ((v - min) / span) * 100]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  $('.spark-line', host).setAttribute('d', line);
  $('.spark-fill', host).setAttribute('d', `${line} L320 120 L0 120 Z`);
  setState(host, 'ready');
  requestAnimationFrame(() => requestAnimationFrame(() => host.classList.add('drawn')));
  const first = series[0], last = series[series.length - 1];
  const note = $('[data-spark-note]');
  if (note && first > 0) note.textContent = `${last >= first ? '+' : ''}${(((last - first) / first) * 100).toFixed(1)}% · 90d`;
}

let lastTvl = false;
async function pollTvl() {
  try {
    const { tvl, series } = await fetchTvl();
    show('tvl', tvl);
    lastTvl = true;
    if (series) drawSpark(series); else if (!live('spark').classList.contains('drawn')) setState(live('spark'), 'error');
    health.tvl = true;
  } catch {
    fail('tvl');
    if (!lastTvl) setState(live('spark'), 'error');
    health.tvl = false;
  }
  paintPill();
}

function renderPairs(rows) {
  const body = live('pairs');
  body.querySelectorAll('tr:not(.sk)').forEach((r) => r.remove());
  rows.forEach((p, i) => {
    const tr = document.createElement('tr');
    tr.className = 'row-in';
    tr.dataset.i = String(i);
    const a = document.createElement('td');
    const n = document.createElement('span'); n.className = 'pair-n'; n.textContent = p.name;
    const d = document.createElement('span'); d.className = 'pair-d'; d.textContent = p.venue;
    a.append(n, d);
    const l = document.createElement('td'); l.className = 'r'; l.textContent = fmtUsd(p.liq);
    const v = document.createElement('td'); v.className = 'r'; v.textContent = fmtUsd(p.vol);
    tr.append(a, l, v);
    body.appendChild(tr);
  });
  setState(body, 'ready');
  $('[data-pairs-na]').hidden = true;
}

let hadPairs = false;
async function pollPairs() {
  try {
    const rows = await fetchPairs();
    renderPairs(rows);
    hadPairs = true;
    show('volume', rows.reduce((s, r) => s + r.vol, 0));
    health.dex = true;
  } catch {
    fail('volume');
    if (!hadPairs) { setState(live('pairs'), 'error'); $('[data-pairs-na]').hidden = false; }
    health.dex = false;
  }
  paintPill();
}

const pollMarket = () => Promise.all([pollTvl(), pollPairs()]);

function startPolling() {
  let rpcTimer = 0, marketTimer = 0;
  const run = () => {
    pollRpc(); pollMarket();
    rpcTimer = setInterval(pollRpc, RPC_EVERY_MS);
    marketTimer = setInterval(pollMarket, MARKET_EVERY_MS);
  };
  const stop = () => { clearInterval(rpcTimer); clearInterval(marketTimer); };
  document.addEventListener('visibilitychange', () => { stop(); if (!document.hidden) run(); });
  if (!document.hidden) run();
}

tile('block', fmtInt);
tile('gas', fmtGwei);
tile('tvl', fmtUsd);
tile('volume', fmtUsd);

initCopy();
initReveal();
initProgress();
initParallax();
initSpy();
initVeil();
startPolling();
