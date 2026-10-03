// Shared tokeniser for the copy gate: lowercase word tokens, adjacent pairs.
export const words = (text) => (text.toLowerCase().replace(/[’`]/g, "'").match(/[a-z0-9]+(?:'[a-z]+)?/g) || []);
export const bigrams = (text) => {
  const w = words(text);
  const out = [];
  for (let i = 0; i + 1 < w.length; i++) out.push(`${w[i]} ${w[i + 1]}`);
  return out;
};
// pairs never cross a line break; callers put breaks between block-level elements
export const bigramsByLine = (text) => text.split(/\n+/).flatMap(bigrams);
