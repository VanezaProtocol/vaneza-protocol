// Live sources. Fetchers are thin; the parsers are pure so they can be exercised with fixtures.
import { REGISTER } from './register.js';

const CHAIN = REGISTER.chain.meta;
const TIMEOUT_MS = 15000;

export const ENDPOINTS = {
  rpc: CHAIN.rpc,
  chains: 'https://api.llama.fi/v2/chains',
  history: `https://api.llama.fi/v2/historicalChainTvl/${encodeURIComponent(CHAIN.llama)}`,
  pairs: 'https://api.dexscreener.com/latest/dex/search?q=ETH%20robinhood',
};

async function getJson(url, init = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const rpcCall = (id, method) => ({ jsonrpc: '2.0', id, method, params: [] });
const hexNum = (h) => (typeof h === 'string' && /^0x[0-9a-fA-F]+$/.test(h) ? Number(BigInt(h)) : null);

// Accepts a batch (array) or a lone envelope; ids 1 block, 2 gas price, 3 chain id.
export function parseRpc(payload, expectedChainId = CHAIN.id) {
  const list = Array.isArray(payload) ? payload : [payload];
  const by = new Map(list.filter(Boolean).map((p) => [p.id, p]));
  const block = hexNum(by.get(1)?.result);
  const gasWei = hexNum(by.get(2)?.result);
  const chainId = hexNum(by.get(3)?.result);
  if (block == null) throw new Error('no block');
  if (chainId != null && chainId !== expectedChainId) throw new Error('wrong chain');
  return { block, gasWei, chainId };
}

export async function fetchRpc() {
  const body = [rpcCall(1, 'eth_blockNumber'), rpcCall(2, 'eth_gasPrice'), rpcCall(3, 'eth_chainId')];
  const init = { method: 'POST', headers: { 'content-type': 'application/json' } };
  let batch;
  try {
    batch = await getJson(ENDPOINTS.rpc, { ...init, body: JSON.stringify(body) });
  } catch {
    batch = null;
  }
  if (Array.isArray(batch)) return parseRpc(batch);
  // some nodes refuse batches: ask one by one
  const singles = await Promise.all(body.map((b) => getJson(ENDPOINTS.rpc, { ...init, body: JSON.stringify(b) }).catch(() => null)));
  return parseRpc(singles);
}

export function parseTvl(chains) {
  const hit = (Array.isArray(chains) ? chains : []).find((c) => c && (c.chainId === CHAIN.id || c.name === CHAIN.llama));
  if (!hit || typeof hit.tvl !== 'number' || !Number.isFinite(hit.tvl)) throw new Error('no tvl');
  return hit.tvl;
}

export function parseHistory(hist, days = 90) {
  const pts = (Array.isArray(hist) ? hist : []).map((p) => p && p.tvl).filter((v) => typeof v === 'number' && Number.isFinite(v)).slice(-days);
  if (pts.length < 2 || !pts.some((v) => v > 0)) throw new Error('no history');
  return pts;
}

export async function fetchTvl() {
  const [chains, hist] = await Promise.allSettled([getJson(ENDPOINTS.chains), getJson(ENDPOINTS.history)]);
  if (chains.status !== 'fulfilled') throw chains.reason;
  const tvl = parseTvl(chains.value);
  let series = null;
  if (hist.status === 'fulfilled') { try { series = parseHistory(hist.value); } catch { series = null; } }
  return { tvl, series };
}

export function parsePairs(json, limit = 6) {
  const seen = new Set();
  const rows = (json && Array.isArray(json.pairs) ? json.pairs : [])
    .filter((p) => p && p.chainId === CHAIN.dexscreener && p.baseToken && p.quoteToken && Number.isFinite(p.liquidity && p.liquidity.usd))
    .filter((p) => (seen.has(p.pairAddress) ? false : seen.add(p.pairAddress)))
    .sort((a, b) => b.liquidity.usd - a.liquidity.usd)
    .slice(0, limit)
    .map((p) => ({
      name: `${String(p.baseToken.symbol).slice(0, 14)} / ${String(p.quoteToken.symbol).slice(0, 14)}`,
      venue: [p.dexId, ...(Array.isArray(p.labels) ? p.labels : [])].filter((s) => typeof s === 'string').join(' ').slice(0, 24),
      liq: p.liquidity.usd,
      vol: Number.isFinite(p.volume && p.volume.h24) ? p.volume.h24 : 0,
    }));
  if (!rows.length) throw new Error('no pairs');
  return rows;
}

export const fetchPairs = async () => parsePairs(await getJson(ENDPOINTS.pairs));
