// Number formatting shared by the live tiles and by the gates.
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const compactUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });

export const fmtInt = (n) => int.format(Math.round(n));
export const fmtUsd = (n) => compactUsd.format(n);
export function fmtGwei(wei) {
  const g = wei / 1e9;
  if (g >= 100) return g.toFixed(0);
  if (g >= 1) return g.toFixed(2);
  return g.toFixed(4);
}
