// Dev-time only: hashes every word pair visible on the reference pages so the
// copy gate can compare against them without the reference text living in this repo.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { bigrams } from './lib/text.mjs';

const pages = ['', 'docs', 'manifesto'].map((p) => `https://www.veilprotocol.dev/${p}`);
const strip = (html) => html
  .replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ');
const set = new Set();
for (const url of pages) {
  const res = await fetch(url);
  const text = strip(await res.text());
  const b = bigrams(text);
  b.forEach((g) => set.add(createHash('sha1').update(g).digest('hex').slice(0, 10)));
  console.log(url, res.status, b.length);
}
fs.writeFileSync('scripts/fixtures/ref-bigrams.json', JSON.stringify([...set].sort()));
console.log('hashes', set.size);
