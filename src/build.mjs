// data/ を走査して app/data.js（window.KABU = {...}）を生成し、続けてデスクトップの単体ビューアを書き出す。
// 使い方（src で実行）: node build.mjs [--data <dataDir>] [--out <file>] [--viewer <path> | --no-viewer]
//   ビューアの書き出し先: --viewer > 環境変数 KABU_VIEWER_PATH > config.json の viewerPath（~ はホーム）
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

import { buildIndicators } from './collect/lib/indicators.mjs';
import { DATA_DIR } from './collect/lib/util.mjs';

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

export function buildData({ dataDir = DATA_DIR, schemasDir = join(ROOT, 'schemas'), now = new Date() } = {}) {
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
      const rel = `data/stocks/${code}/analyses/${f}`;
      const a = readJson(join(dir, 'analyses', f));
      // ファイル名 <date>-<type>.json と中身の type が一致すること（全型を対象）
      const m = f.match(/^(\d{4}-\d{2}-\d{2})-([a-z]+)\.json$/);
      if (!m) throw new BrokenJsonError(`分析ファイル名が <日付>-<型>.json の形ではありません: ${rel}`);
      if (a?.type !== m[2]) throw new BrokenJsonError(`ファイル名の型「${m[2]}」と中身の type「${a?.type}」が食い違っています: ${rel}`);
      a._file = rel;
      return a;
    });
    analyses.sort((a, b) => (a.date === b.date ? (a._file < b._file ? 1 : -1) : a.date < b.date ? 1 : -1)); // 日付降順
    allAnalyses.push(...analyses);
    const indicators = pricesFull?.rows?.length ? buildIndicators(pricesFull.rows, prices.rows.length) : null;
    const finance = readIf(join(dir, 'finance.json'));
    stocks[code] = { code, name: profile?.name ?? analyses[0]?.name ?? prices?.meta?.name ?? code, profile, prices, indicators, finance, analyses };
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

/** data.js の中身。「<」は \\u003c にして、HTMLに埋め込んでも </script> や <!-- にならないようにする */
export function dataJsText(kabu) {
  return `// build.mjs が生成（手で編集しない）\nwindow.KABU = ${JSON.stringify(kabu).replace(/</g, '\\u003c')};\n`;
}

export function writeDataJs(kabu, outFile) {
  mkdirSync(dirname(outFile), { recursive: true });
  const js = dataJsText(kabu);
  writeFileSync(outFile, js);
  return Buffer.byteLength(js);
}

// ---------- 単体ビューア（styles・charts・app・data を埋め込んだ1ファイル） ----------

export const VIEWER_SCRIPTS = ['data.js', 'charts.js', 'app.js'];

/** インライン <script> の中で HTML パーサに誤解される並びを無害化する */
export function escapeInlineScript(code) {
  return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

export function expandHome(p) {
  return p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;
}

/** 書き出し先: 引数 > KABU_VIEWER_PATH > config.json の viewerPath */
export function resolveViewerPath({ cli, env = process.env, configFile = join(ROOT, 'config.json') } = {}) {
  if (cli) return resolve(expandHome(cli));
  if (env.KABU_VIEWER_PATH) return resolve(expandHome(env.KABU_VIEWER_PATH));
  const cfg = existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : {};
  return resolve(expandHome(cfg.viewerPath ?? '~/Desktop/KABU LAB.html'));
}

/**
 * app/index.html を土台に、styles.css・data.js・charts.js・app.js をインライン化した HTML を返す。
 * test-hooks.js は含めない。Google Fonts と data: の icon 以外の外部参照が残れば例外（取りこぼし検知）。
 */
export function buildViewerHtml({ appDir = join(ROOT, 'app'), dataJs, now = new Date() } = {}) {
  let html = readFileSync(join(appDir, 'index.html'), 'utf8');
  const parts = [];
  const hold = (content) => `@@KABU_INLINE_${parts.push(content) - 1}@@`;
  const rep = (re, fn, what) => {
    if (!re.test(html)) throw new Error(`index.html に ${what} が見つかりません（ビューアを作れない）`);
    html = html.replace(re, fn);
  };
  // test-hooks は除く
  html = html.replace(/[ \t]*<script\b[^>]*\bsrc="test-hooks\.js"[^>]*><\/script>[ \t]*\r?\n?/g, '');
  rep(/<link\b[^>]*rel="stylesheet"[^>]*href="styles\.css"[^>]*>/, () => hold(`<style>\n${readFileSync(join(appDir, 'styles.css'), 'utf8').replace(/<\/(style)/gi, '<\\/$1')}\n</style>`), 'styles.css の link');
  for (const name of VIEWER_SCRIPTS) {
    const code = name === 'data.js' ? dataJs ?? readFileSync(join(appDir, name), 'utf8') : readFileSync(join(appDir, name), 'utf8');
    const safe = escapeInlineScript(code);
    try {
      new vm.Script(safe, { filename: name }); // エスケープ後も JS として正しいか
    } catch (e) {
      throw new Error(`${name} をインライン化すると構文エラーになります: ${e.message}`);
    }
    const re = new RegExp(`<script\\b[^>]*\\bsrc="${name.replace('.', '\\.')}"[^>]*><\\/script>`);
    rep(re, () => hold(`<script>\n${safe}\n</script>`), `${name} の script`);
  }
  // 取りこぼし検知: 残った src / href が外部参照（Google Fonts・data:・# 以外）なら失敗
  const leftovers = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)]
    .map((m) => m[1])
    .filter((u) => !/^https:\/\/fonts\.(googleapis|gstatic)\.com(\/|$)/.test(u) && !/^data:/.test(u) && !u.startsWith('#'));
  if (leftovers.length) throw new Error(`ビューアに埋め込めない外部参照が残っています: ${leftovers.join(', ')}`);
  html = html.replace(/<title>[\s\S]*?<\/title>/, '<title>KABU LAB</title>');
  const stamp = new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  const note = `<!-- このファイルは build が自動生成します（src/build.mjs）。編集しても次の分析で上書きされます。生成日時 ${stamp} JST -->`;
  html = /^<!DOCTYPE html>/i.test(html) ? html.replace(/^<!DOCTYPE html>\s*/i, (m) => `${m.trimEnd()}\n${note}\n`) : `${note}\n${html}`;
  return html.replace(/@@KABU_INLINE_(\d+)@@/g, (_, i) => parts[Number(i)]);
}

/** 一時ファイル→rename で原子的に書く。返り値 bytes */
export function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${process.pid}-${Date.now()}.kabu-tmp`);
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return Buffer.byteLength(text);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv;
  const arg = (k, d) => {
    const i = argv.indexOf(k);
    return i > 0 ? resolve(argv[i + 1]) : d;
  };
  const dataDir = arg('--data', DATA_DIR);
  const out = arg('--out', join(ROOT, 'app', 'data.js'));
  let kabu;
  try {
    kabu = buildData({ dataDir });
    const size = writeDataJs(kabu, out);
    const n = Object.values(kabu.stocks);
    console.log(`${out} (${(size / 1024).toFixed(1)} KB) 銘柄${n.length}・分析${n.reduce((s, x) => s + x.analyses.length, 0)}・用語${kabu.glossary.length}・ノート${kabu.notes.length}`);
  } catch (e) {
    console.error(`エラー: ${e.message}`);
    process.exit(1);
  }
  // 本番以外の実行（--data や --out を指定したテスト・試験運転）では、--viewer を明示しない限りデスクトップのビューアを書き換えない
  const custom = argv.includes('--data') || argv.includes('--out');
  const explicitViewer = argv.includes('--viewer') || !!process.env.KABU_VIEWER_PATH;
  if (!argv.includes('--no-viewer') && (!custom || explicitViewer)) {
    // ビューアの失敗は警告だけ（data.js の生成は成功扱い）
    let path = '(未決定)';
    try {
      const vi = argv.indexOf('--viewer');
      path = resolveViewerPath({ cli: vi > 0 ? argv[vi + 1] : undefined });
      const html = buildViewerHtml({ dataJs: dataJsText(kabu), now: new Date(kabu.generatedAt) });
      const bytes = writeAtomic(path, html);
      console.log(`ビューア: ${path} (${(bytes / 1024).toFixed(0)} KB)`);
    } catch (e) {
      console.warn(`警告: ビューアを書き出せませんでした（${path}）: ${e.message}`);
    }
  }
}
