// data/ を走査して app/data.js（window.KABU = {...}）を生成する。
// 使い方: node build.mjs [--data <dataDir>] [--out <file>]
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
export const PRICE_BARS = 250;

class BrokenJsonError extends Error {}

function readJson(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    throw new BrokenJsonError(`読めないファイル: ${path} (${e.message})`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new BrokenJsonError(`壊れたJSON: ${path} (${e.message})`);
  }
}
const readIf = (p) => (existsSync(p) ? readJson(p) : null);
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const jsonFiles = (dir) => (isDir(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : []);

export function buildData({ dataDir = join(ROOT, 'data'), schemasDir = join(ROOT, 'schemas'), now = new Date() } = {}) {
  const stocks = {};
  const allAnalyses = [];
  const stocksDir = join(dataDir, 'stocks');
  for (const code of isDir(stocksDir) ? readdirSync(stocksDir).sort() : []) {
    const dir = join(stocksDir, code);
    if (!isDir(dir)) continue;
    const profile = readIf(join(dir, 'profile.json'));
    const pricesFull = readIf(join(dir, 'prices.json'));
    const prices = pricesFull ? { meta: pricesFull.meta, rows: (pricesFull.rows ?? []).slice(-PRICE_BARS) } : null;
    const analyses = jsonFiles(join(dir, 'analyses')).map((f) => {
      const a = readJson(join(dir, 'analyses', f));
      a._file = `data/stocks/${code}/analyses/${f}`;
      return a;
    });
    analyses.sort((a, b) => (a.date === b.date ? (a._file < b._file ? 1 : -1) : a.date < b.date ? 1 : -1)); // 日付降順
    allAnalyses.push(...analyses);
    stocks[code] = { code, name: profile?.name ?? analyses[0]?.name ?? prices?.meta?.name ?? code, profile, prices, analyses };
  }

  // 用語帳: 全分析の terms を用語で重複排除（初出 = 最も古い日付）。data/glossary.json があれば統合（定義はこちらを優先）
  const glossary = new Map();
  for (const a of [...allAnalyses].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0))) {
    for (const t of a.terms ?? []) {
      if (!t?.term || glossary.has(t.term)) continue;
      glossary.set(t.term, { term: t.term, def: t.def, firstCode: a.code, firstName: a.name, firstDate: a.date, firstType: a.type });
    }
  }
  const extra = readIf(join(dataDir, 'glossary.json'));
  for (const g of Array.isArray(extra) ? extra : extra?.terms ?? []) {
    if (!g?.term) continue;
    glossary.set(g.term, { ...(glossary.get(g.term) ?? { firstCode: null, firstName: null, firstDate: null, firstType: null }), ...g });
  }

  // 気づきノート: 全分析の insight を日付降順。data/notes.json があれば統合
  const notes = allAnalyses
    .filter((a) => a.insight)
    .map((a) => ({ date: a.date, code: a.code, name: a.name, type: a.type, text: a.insight }));
  const extraNotes = readIf(join(dataDir, 'notes.json'));
  notes.push(...(Array.isArray(extraNotes) ? extraNotes : extraNotes?.notes ?? []));
  notes.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // 市場: 最新の <date>-raw.json と <date>.json（分析）
  const mdir = join(dataDir, 'market');
  const mfiles = jsonFiles(mdir);
  const latest = (re) => mfiles.filter((f) => re.test(f)).sort().at(-1);
  const rawF = latest(/^\d{4}-\d{2}-\d{2}-raw\.json$/);
  const anaF = latest(/^\d{4}-\d{2}-\d{2}\.json$/);
  const market = { raw: rawF ? readJson(join(mdir, rawF)) : null, analysis: anaF ? readJson(join(mdir, anaF)) : null };

  const checklistItems = readIf(join(schemasDir, 'checklist-items.json')) ?? [];

  return {
    generatedAt: now.toISOString(),
    stocks,
    market,
    glossary: [...glossary.values()].sort((a, b) => a.term.localeCompare(b.term, 'ja')),
    notes,
    checklistItems,
  };
}

export function writeDataJs(kabu, outFile) {
  mkdirSync(dirname(outFile), { recursive: true });
  const js = `// build.mjs が生成（手で編集しない）\nwindow.KABU = ${JSON.stringify(kabu)};\n`;
  writeFileSync(outFile, js);
  return Buffer.byteLength(js);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const arg = (k, d) => {
    const i = process.argv.indexOf(k);
    return i > 0 ? resolve(process.argv[i + 1]) : d;
  };
  const dataDir = arg('--data', join(ROOT, 'data'));
  const out = arg('--out', join(ROOT, 'app', 'data.js'));
  try {
    const kabu = buildData({ dataDir });
    const size = writeDataJs(kabu, out);
    const n = Object.values(kabu.stocks);
    console.log(`${out} (${(size / 1024).toFixed(1)} KB) 銘柄${n.length}・分析${n.reduce((s, x) => s + x.analyses.length, 0)}・用語${kabu.glossary.length}・ノート${kabu.notes.length}`);
  } catch (e) {
    console.error(`エラー: ${e.message}`);
    process.exit(1);
  }
}
