// REGISTER — every external fact is exactly one record with a state.
//   stated      value (and url, where one exists) is confirmed and may be shown / linked
//   absent      nothing exists yet: renders as an inert slot, no href, no date
//   unconfirmed a value is known but not verified: shown labelled, never linked or copyable
// Handles are never stored. They are derived from `url`, so a link and its label cannot drift.

export const STATES = ['stated', 'absent', 'unconfirmed'];

export const REGISTER = {
  ca: { key: 'ca', label: 'contract', kind: 'address', state: 'absent', value: null, url: null },
  x: { key: 'x', label: 'x', kind: 'social', state: 'absent', value: null, url: null },
  github: { key: 'github', label: 'github', kind: 'social', state: 'absent', value: null, url: null },
  app: { key: 'app', label: 'app', kind: 'link', state: 'absent', value: null, url: null },
  domain: { key: 'domain', label: 'website', kind: 'link', state: 'stated', value: 'vaneza.dev', url: 'https://vaneza.dev' },
  chain: {
    key: 'chain', label: 'network', kind: 'chain', state: 'stated', value: 'Robinhood Chain', url: null,
    meta: {
      id: 4663,
      rpc: 'https://rpc.mainnet.chain.robinhood.com',
      llama: 'Robinhood Chain',
      dexscreener: 'robinhood',
    },
  },
};

// Any 20-byte hex address. Case is not policed here: mixed case is a checksum, not an error.
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const isAddress = (v) => typeof v === 'string' && ADDRESS_RE.test(v);

const SOCIAL_HOSTS = { x: ['x.com', 'twitter.com'], github: ['github.com'] };

export function parseUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

// '@name' for x, 'owner' / 'owner/repo' for github. Null when the URL cannot back a handle.
export function deriveHandle(key, url) {
  const u = parseUrl(url);
  if (!u) return null;
  const host = u.hostname.replace(/^www\./, '');
  if (!(SOCIAL_HOSTS[key] || []).includes(host)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (!parts.length) return null;
  return key === 'x' ? `@${parts[0]}` : parts.slice(0, 2).join('/');
}

// The only door to an href. Anything that is not `stated` with a valid https url gets none.
export function hrefFor(record) {
  if (!record || record.state !== 'stated') return null;
  return parseUrl(record.url) ? record.url : null;
}

export function validateRecord(r) {
  const errs = [];
  if (!STATES.includes(r.state)) errs.push(`${r.key}: bad state ${r.state}`);
  if (r.state === 'absent' && (r.value != null || r.url != null)) errs.push(`${r.key}: absent record carries data`);
  if (r.state !== 'absent' && r.value == null && r.url == null) errs.push(`${r.key}: ${r.state} record has no value`);
  if (r.kind === 'address' && r.state !== 'absent' && !isAddress(r.value)) errs.push(`${r.key}: not a 20-byte hex address`);
  if (r.kind === 'social' && r.state === 'stated' && !deriveHandle(r.key, r.url)) errs.push(`${r.key}: url yields no handle`);
  if ('handle' in r) errs.push(`${r.key}: handles are derived, never stored`);
  if (r.state !== 'stated' && r.url != null && r.kind !== 'link') errs.push(`${r.key}: url on a non-stated record`);
  return errs;
}

export const validateRegister = (reg = REGISTER) => Object.values(reg).flatMap(validateRecord);
