// `node --test tests/` の入口。Node 24 はディレクトリ指定を tests/index.js として解決するため、
// ここで tests/*.test.mjs をすべて読み込む（`node --test` 単体や個別ファイル指定でも動く）。
import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
for (const f of readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort()) {
  await import(pathToFileURL(`${dir}/${f}`).href);
}
