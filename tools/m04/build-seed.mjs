// Regenerates the synthetic CAP seed CSVs in test/data from test/fixtures/m04.
// Usage (repo root):  node tools/m04/build-seed.mjs          writes test/data/*.csv
//                     node tools/m04/build-seed.mjs --check  exits 1 if test/data is out of date
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildSeed, toCsv, csvFileName, ENTITIES } from '../../test/m04-seed.js';

const dir = join(import.meta.dirname, '..', '..', 'test', 'data');
const check = process.argv.includes('--check');
const seed = buildSeed();
let stale = 0;
if (!check) mkdirSync(dir, { recursive: true });
for (const entity of ENTITIES) {
  const file = join(dir, csvFileName(entity));
  const text = toCsv(entity, seed[entity]);
  if (check) {
    const same = existsSync(file) && readFileSync(file, 'utf8') === text;
    if (!same) { stale++; console.log(`OUT OF DATE ${file}`); }
  } else {
    writeFileSync(file, text);
    console.log(`${csvFileName(entity)}: ${seed[entity].length} rows`);
  }
}
if (check) { console.log(stale ? `${stale} file(s) out of date` : 'test/data is up to date'); process.exit(stale ? 1 : 0); }
