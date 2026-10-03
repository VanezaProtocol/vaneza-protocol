// One-off: samples brand pixels and (re)writes the colour block of src/tokens.css.
import fs from 'node:fs';
import { LOGO_OPAQUE, LOGO_ALPHA, readPng, alphaProfile, samplePalette } from './lib/brand.mjs';

const opaque = readPng(LOGO_OPAQUE);
const alpha = readPng(LOGO_ALPHA);
const prof = alphaProfile(alpha.data);
const lum = (c) => 0.2126 * c.rgb[0] + 0.7152 * c.rgb[1] + 0.0722 * c.rgb[2];
const sat = (c) => Math.max(...c.rgb) - Math.min(...c.rgb);
const sampled = samplePalette(opaque, 3);
const bg = sampled.reduce((m, c) => (lum(c) < lum(m) ? c : m));
const acc = sampled.filter((c) => c !== bg).reduce((m, c) => (sat(c) > sat(m) ? c : m));
const fg = sampled.find((c) => c !== bg && c !== acc);
const line = (name, c) => `  /* prov ${name} ${c.hex} @ ${c.x},${c.y} */`;
console.log(JSON.stringify({ opaque: opaque.ihdr, alpha: alpha.ihdr, alphaProfile: prof, bg, fg, acc }, null, 1));
const file = 'src/tokens.css';
const body = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const block = `/* PALETTE — sampled, not chosen.
   source  ${LOGO_OPAQUE} (${opaque.w}x${opaque.h}, RGBA, fully opaque)
   method  k-means k=3 over the unique-colour histogram (farthest-point init, 24 passes),
           each centroid snapped to the nearest colour that really occurs, located by raster scan.
   check   gates re-read the pixel at each coordinate below and compare.
   other   ${LOGO_ALPHA}: colortype ${alpha.ihdr.colorType}, ${prof.clearBlack} fully clear pure-black pixels
           -> premultiplied resize required for every raster derived from it. */
:root {
${line('bg', bg)}
  --bg: ${bg.hex};
${line('fg', fg)}
  --fg: ${fg.hex};
${line('acc', acc)}
  --acc: ${acc.hex};
}
`;
const marker = /\/\* PALETTE[\s\S]*?\n}\n/;
fs.writeFileSync(file, marker.test(body) ? body.replace(marker, block) : block + body);
