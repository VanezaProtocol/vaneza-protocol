// Build-time markup for everything that depends on the register. Pure strings, no DOM.
import { hrefFor, deriveHandle, isAddress } from './register.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ICONS = {
  x: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  github: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"/></svg>',
};

export function socialMarkup(record) {
  const name = record.key === 'x' ? 'X' : 'GitHub';
  const href = hrefFor(record);
  const handle = href ? deriveHandle(record.key, record.url) : null;
  if (href && handle) {
    return `<a class="soc" data-state="stated" href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="${name}: ${esc(handle)}" title="${esc(handle)}">${ICONS[record.key]}</a>`;
  }
  return `<span class="soc" data-state="${record.state}" role="img" aria-label="${name}: not published yet" title="not published yet">${ICONS[record.key]}</span>`;
}

export function caMarkup(record) {
  const head = '<span class="ca-k">contract</span>';
  if (record.state === 'stated' && isAddress(record.value)) {
    return `<div class="ca" id="ca" data-state="stated" role="group" aria-label="contract address">${head}`
      + `<button class="ca-copy" type="button" data-copy="${esc(record.value)}" aria-label="copy contract address ${esc(record.value)}">`
      + `<span class="ca-addr">${esc(record.value)}</span><span class="ca-hint" data-hint aria-live="polite">copy</span></button></div>`;
  }
  if (record.state === 'unconfirmed' && isAddress(record.value)) {
    return `<div class="ca" id="ca" data-state="unconfirmed" role="group" aria-label="contract address, unconfirmed">${head}`
      + `<span class="ca-slot"><span class="ca-addr">${esc(record.value)}</span><span class="ca-note">unconfirmed</span></span></div>`;
  }
  return `<div class="ca" id="ca" data-state="absent" role="group" aria-label="contract address, not published yet">${head}`
    + '<span class="ca-slot"><span class="ca-ghost" aria-hidden="true">0x</span><span class="ca-rule" aria-hidden="true"></span><span class="ca-note">not published yet</span></span></div>';
}

const STATE_COPY = { stated: 'stated', absent: 'not yet', unconfirmed: 'unconfirmed' };

export function ledgerRows(reg) {
  const rows = [];
  const add = (record, shown, extra = '') => {
    rows.push(`<li class="row" data-state="${record.state}" data-reveal data-i="${rows.length}">`
      + `<span class="row-k">${esc(record.label)}</span>`
      + `<span class="row-v">${shown}${extra}</span>`
      + `<span class="row-s"><i class="tick" aria-hidden="true"></i>${STATE_COPY[record.state]}</span></li>`);
  };
  const ca = reg.ca;
  add(ca, ca.state === 'absent' ? '<span class="mute">none announced</span>' : `<span class="addr">${esc(ca.value)}</span>`);
  for (const key of ['x', 'github']) {
    const r = reg[key];
    const href = hrefFor(r);
    const handle = href ? deriveHandle(key, r.url) : null;
    add(r, handle ? `<a class="lnk" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(handle)}</a>` : '<span class="mute">none announced</span>');
  }
  const app = reg.app;
  const appHref = hrefFor(app);
  add(app, appHref ? `<a class="lnk" href="${esc(appHref)}" target="_blank" rel="noopener noreferrer">${esc(app.value || appHref)}</a>` : '<span class="mute">none announced</span>');
  const d = reg.domain;
  const dHref = hrefFor(d);
  add(d, dHref ? `<a class="lnk" href="${esc(dHref)}">${esc(d.value)}</a>` : esc(d.value || ''));
  const c = reg.chain;
  add(c, `${esc(c.value)} <span class="mute">· id ${c.meta.id}</span>`);
  return rows.join('\n');
}
