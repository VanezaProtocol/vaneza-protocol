// Motion layer. Every effect checks reduced motion first and lands instantly when asked to.
export const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const SLOW_MS = 720;
const STAGGER_MS = 70;

export function initReveal() {
  const els = [...document.querySelectorAll('[data-reveal]')];
  const settle = (el) => {
    const i = Number(el.dataset.i || 0);
    setTimeout(() => el.classList.add('done'), SLOW_MS + i * STAGGER_MS + 80);
  };
  const show = (el) => { el.classList.add('in'); settle(el); };
  if (reduced() || !('IntersectionObserver' in window)) { els.forEach((el) => { el.classList.add('in', 'done'); }); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { show(e.target); io.unobserve(e.target); }
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  els.forEach((el) => io.observe(el));
  // route hops reveal their connector the same way (class on the li itself)
}

export function initProgress() {
  const bar = document.getElementById('progress');
  const top = document.getElementById('top');
  if (!bar) return;
  let queued = false;
  const paint = () => {
    queued = false;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    bar.style.transform = `scaleX(${p})`;
    if (top) top.toggleAttribute('data-scrolled', window.scrollY > 8);
  };
  const ask = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };
  window.addEventListener('scroll', ask, { passive: true });
  window.addEventListener('resize', ask, { passive: true });
  paint();
}

export function initParallax() {
  if (reduced()) return;
  const hero = document.querySelector('.hero');
  const layers = [...document.querySelectorAll('[data-depth]')];
  if (!hero || !layers.length) return;
  let queued = false;
  const paint = () => {
    queued = false;
    const y = window.scrollY;
    if (y > hero.offsetHeight + 200) return;
    for (const el of layers) el.style.transform = `translate3d(0, ${(y * Number(el.dataset.depth)).toFixed(1)}px, 0)`;
  };
  window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(paint); } }, { passive: true });
}

export function initSpy() {
  const links = [...document.querySelectorAll('.nav a')];
  const map = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
  if (!('IntersectionObserver' in window) || !map.size) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => a.removeAttribute('aria-current'));
      const a = map.get(e.target.id);
      if (a) a.setAttribute('aria-current', 'true');
    }
  }, { rootMargin: '-40% 0px -55% 0px' });
  map.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
}

// The hidden sender shimmers through block glyphs and never resolves to anything.
export function initVeil() {
  const el = document.querySelector('[data-veil]');
  if (!el || reduced()) return;
  const glyphs = '█▓▒░▌▐▀▄';
  const n = el.textContent.length;
  let timer = 0;
  const tick = () => { let s = ''; for (let i = 0; i < n; i++) s += glyphs[Math.floor(Math.random() * glyphs.length)]; el.textContent = s; };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && !timer) timer = setInterval(tick, 140);
      if (!e.isIntersecting && timer) { clearInterval(timer); timer = 0; }
    }
  });
  io.observe(el);
}

// Animated number: first paint counts up from zero, later changes tween and flash.
export function counter(el, fmt) {
  let shown = null;
  let raf = 0;
  const flash = () => { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); };
  el.addEventListener('animationend', () => el.classList.remove('flash'));
  return {
    get value() { return shown; },
    set(next) {
      if (next === shown) return;
      const first = shown === null;
      const from = first ? 0 : shown;
      cancelAnimationFrame(raf);
      if (reduced()) { shown = next; el.textContent = fmt(next); return; }
      const dur = first ? 1100 : 650;
      let t0 = null;
      if (!first) flash();
      const step = (ts) => {
        if (t0 === null) t0 = ts;
        const k = Math.min(1, (ts - t0) / dur);
        const eased = 1 - Math.pow(1 - k, 3);
        const v = from + (next - from) * eased;
        el.textContent = fmt(k === 1 ? next : v);
        if (k < 1) raf = requestAnimationFrame(step);
      };
      shown = next;
      raf = requestAnimationFrame(step);
    },
  };
}
