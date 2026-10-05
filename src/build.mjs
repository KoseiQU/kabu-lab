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
/** 機械が書く補助ファイル（refresh.json・headlines.json）は壊れていても build を止めない（警告して null） */
function readSoft(path, warn) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    warn(`読めないので省きます: ${path} (${e.message})`);
    return null;
  }
}
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const jsonFiles = (dir) => (isDir(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : []);

export function buildData({ dataDir = DATA_DIR, schemasDir = join(ROOT, 'schemas'), now = new Date(), warn = (m) => console.warn(`警告: ${m}`) } = {}) {
  const stocks = {};
  const allAnalyses = [];
  const pricesByCode = new Map(); // 答え合わせ用の全日足（prices.rows は直近250本に切り詰めるため）
  const stocksDir = join(dataDir, 'stocks');
  for (const code of isDir(stocksDir) ? readdirSync(stocksDir).sort() : []) {
    const dir = join(stocksDir, code);
    if (!isDir(dir)) continue;
    const profile = readIf(join(dir, 'profile.json'));
    const pricesFull = readIf(join(dir, 'prices.json'));
    const prices = pricesFull ? { meta: pricesFull.meta, rows: (pricesFull.rows ?? []).slice(-PRICE_BARS) } : null;
    if (pricesFull?.rows?.length) pricesByCode.set(code, pricesFull.rows);
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
    for (const a of analyses) a._age = analysisAge(a, pricesFull?.rows); // 鮮度（基準日より後の取引日数）
    allAnalyses.push(...analyses);
    const indicators = pricesFull?.rows?.length ? buildIndicators(pricesFull.rows, prices.rows.length) : null;
    const finance = readIf(join(dir, 'finance.json'));
    stocks[code] = { code, name: profile?.name ?? analyses[0]?.name ?? prices?.meta?.name ?? code, profile, prices, indicators, finance, analyses };
  }

  // 市場: 最新の <date>-raw.json、分析 <date>.json の全件（日付降順）と最新、series.json（日経平均・ドル円・米10年金利の日足）
  const mdir = join(dataDir, 'market');
  const mfiles = jsonFiles(mdir);
  const rawF = mfiles.filter((f) => /^\d{4}-\d{2}-\d{2}-raw\.json$/.test(f)).sort().at(-1);
  const marketAnalyses = mfiles
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => {
      const rel = `data/market/${f}`;
      const a = readJson(join(mdir, f));
      if (a?.type !== 'market') throw new BrokenJsonError(`市場の分析ファイルの type が「market」ではありません（${a?.type}）: ${rel}`);
      a._file = rel;
      return a;
    })
    .sort((a, b) => (a.date === b.date ? (a._file < b._file ? 1 : -1) : a.date < b.date ? 1 : -1));
  const series = readIf(join(mdir, 'series.json'));
  for (const a of marketAnalyses) a._age = analysisAge(a, series?.series?.['^N225']?.rows); // 市場は日経平均の日足で数える
  const market = {
    raw: rawF ? readJson(join(mdir, rawF)) : null,
    analysis: marketAnalyses[0] ?? null,
    analyses: marketAnalyses,
    series,
    headlines: sanitizeHeadlines(readSoft(join(mdir, 'headlines.json'), warn)),
  };
  // 用語・気づき・答え合わせは銘柄と市場の分析の全件から
  const everyAnalysis = [...allAnalyses, ...marketAnalyses];

  // 用語帳: 全分析の terms を用語で重複排除（初出 = 最も古い日付）。data/glossary.json（旧形式）があれば統合（定義はこちらを優先）。
  // data/glossary/*.json（用語型）があれば最後に統合: 定義は用語型を優先し、本体を detail に持たせる
  const glossary = new Map();
  for (const a of [...everyAnalysis].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0))) {
    for (const t of a.terms ?? []) {
      if (!t?.term || glossary.has(t.term)) continue;
      glossary.set(t.term, { term: t.term, def: t.def, firstCode: a.code, firstName: a.name, firstDate: a.date, firstType: a.type, category: null, detail: null });
    }
  }
  const extra = readIf(join(dataDir, 'glossary.json'));
  for (const g of Array.isArray(extra) ? extra : extra?.terms ?? []) {
    if (!g?.term) continue;
    glossary.set(g.term, { ...(glossary.get(g.term) ?? { firstCode: null, firstName: null, firstDate: null, firstType: null, category: null, detail: null }), ...g });
  }
  const gdir = join(dataDir, 'glossary');
  for (const f of jsonFiles(gdir)) {
    const rel = `data/glossary/${f}`;
    const y = readJson(join(gdir, f));
    if (y?.type !== 'yougo' || !y.term) throw new BrokenJsonError(`用語ファイルの type が「yougo」ではないか term がありません: ${rel}`);
    const { schema, type, ...body } = y;
    const prev = glossary.get(y.term) ?? { firstCode: null, firstName: null, firstDate: y.addedAt ?? null, firstType: 'yougo' };
    glossary.set(y.term, { ...prev, term: y.term, def: y.def, category: y.category ?? null, detail: { ...body, _file: rel } });
  }

  // 気づきノート: 全分析の insight（kind: insight）、chart・hansei の lesson（kind: lesson, title つき）、
  // hansei の nextChecks（kind: nextCheck, title=label・text=how）を日付降順。data/notes.json があれば統合
  const notes = [];
  for (const a of everyAnalysis) {
    const base = { date: a.date, code: a.code ?? null, name: a.name, type: a.type };
    if (a.insight) notes.push({ ...base, kind: 'insight', text: a.insight });
    const lesson = a.sections?.lesson;
    if ((a.type === 'chart' || a.type === 'hansei') && lesson?.text) notes.push({ ...base, kind: 'lesson', title: lesson.title ?? '', text: lesson.text });
    if (a.type === 'hansei') for (const c of a.sections?.nextChecks ?? []) if (c?.how || c?.label) notes.push({ ...base, kind: 'nextCheck', title: c.label ?? '', text: c.how ?? '' });
  }
  const extraNotes = readIf(join(dataDir, 'notes.json'));
  notes.push(...(Array.isArray(extraNotes) ? extraNotes : extraNotes?.notes ?? []));
  notes.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // シナリオの答え合わせ: quick の scenarios と market の outlook（DESIGN.md §5.8）
  const review = [];
  for (const a of allAnalyses.filter((x) => x.type === 'quick')) {
    review.push(buildReview(a, 'stock', a.sections?.scenarios, pricesByCode.get(a.code)));
  }
  const nikkei = series?.series?.['^N225']?.rows ?? null;
  for (const a of marketAnalyses) review.push(buildReview(a, 'market', a.sections?.outlook, nikkei));
  review.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const checklistItems = readIf(join(schemasDir, 'checklist-items.json')) ?? [];

  return {
    generatedAt: now.toISOString(),
    refresh: sanitizeRefresh(readSoft(join(dataDir, 'refresh.json'), warn)),
    stocks,
    market,
    glossary: [...glossary.values()].sort((a, b) => a.term.localeCompare(b.term, 'ja')),
    notes,
    review,
    checklistItems,
  };
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const round2 = (x) => Math.round(x * 100) / 100;
const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

/**
 * 鮮度（DESIGN.md §5.9）: 分析の基準日（price.asOf。無ければ date）より後の取引日数。
 * rows は日付昇順の日足 [{d, ...}]（銘柄は prices.json の全期間、市場は series の日経平均）。数えられなければ null
 */
export function analysisAge(a, rows) {
  const base = isDate(a?.price?.asOf) ? a.price.asOf : isDate(a?.date) ? a.date : null;
  if (!base || !Array.isArray(rows) || !rows.length) return null;
  return rows.filter((r) => r && typeof r.d === 'string' && r.d > base).length;
}

const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u.trim());
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
/** headlines.json → 画面に渡す形（題名は文字列だけ・URL は http(s) だけ。画面でも必ずエスケープする） */
export function sanitizeHeadlines(h) {
  if (!h || typeof h !== 'object') return null;
  const items = (Array.isArray(h.items) ? h.items : [])
    .filter((x) => x && typeof x.title === 'string' && x.title.trim() && isHttp(x.url))
    .map((x) => ({ title: str(x.title, 200), url: x.url.trim(), source: str(x.source, 40), publishedAt: typeof x.publishedAt === 'string' ? x.publishedAt : null }));
  const sources = (Array.isArray(h.sources) ? h.sources : []).filter((x) => x && typeof x === 'object')
    .map((x) => ({ name: str(x.name, 40), url: isHttp(x.url) ? x.url.trim() : null, ok: x.ok === true, count: isNum(x.count) ? x.count : 0, message: str(x.message, 200) }));
  return { fetchedAt: typeof h.fetchedAt === 'string' ? h.fetchedAt : null, sources, items };
}
/** refresh.json → 画面に渡す形（キーと型だけ揃える） */
export function sanitizeRefresh(r) {
  if (!r || typeof r !== 'object' || typeof r.at !== 'string') return null;
  const steps = (Array.isArray(r.steps) ? r.steps : []).filter((s) => s && typeof s.key === 'string')
    .map((s) => ({ key: s.key, ok: s.ok === true, message: str(s.message, 200), ...(isNum(s.sec) ? { sec: s.sec } : {}) }));
  const stocks = (Array.isArray(r.stocks) ? r.stocks : []).filter((s) => s && typeof s.code === 'string')
    .map((s) => ({ code: s.code, ok: s.ok === true, lastDate: isDate(s.lastDate) ? s.lastDate : null, message: str(s.message, 200) }));
  return { at: r.at, finishedAt: typeof r.finishedAt === 'string' ? r.finishedAt : null, steps, stocks };
}
export const REVIEW_YOUNG_DAYS = 5;

/**
 * 答え合わせ1件: 基準（price.close・price.asOf）、3つの目安、基準日より後の終値列、経過営業日数、
 * 最新の終値にいちばん近い目安（機械的な距離。帯の中なら距離0）。rows は日付昇順 [{d, c}]（無ければ after は空）。
 */
export function buildReview(a, kind, scenarios, rows) {
  const baseDate = a.price?.asOf ?? a.date;
  const after = (rows ?? []).filter((r) => r.d > baseDate && isNum(r.c)).map((r) => ({ d: r.d, c: r.c }));
  const targets = (Array.isArray(scenarios) ? scenarios : []).map((x) => {
    const t = x?.target ?? {};
    return {
      kind: x?.kind ?? null,
      label: t.label ?? '',
      ...(isNum(t.price) ? { price: t.price } : {}),
      ...(isNum(t.low) && isNum(t.high) ? { low: t.low, high: t.high } : {}),
      breakIf: x?.breakIf ?? '',
    };
  });
  const latest = after.at(-1) ?? null;
  let nearest = null;
  if (latest) {
    for (const t of targets) {
      let dist = null;
      if (isNum(t.low) && isNum(t.high)) dist = latest.c >= t.low && latest.c <= t.high ? 0 : Math.min(Math.abs(latest.c - t.low) / t.low, Math.abs(latest.c - t.high) / t.high) * 100;
      else if (isNum(t.price) && t.price > 0) dist = (Math.abs(latest.c - t.price) / t.price) * 100;
      if (dist != null && (!nearest || dist < nearest.distPct)) nearest = { kind: t.kind, distPct: round2(dist) };
    }
  }
  return {
    kind,
    code: a.code ?? null,
    name: a.name,
    type: a.type,
    date: a.date,
    file: a._file ?? null,
    base: { price: a.price?.close ?? null, date: baseDate },
    targets,
    after,
    days: after.length,
    young: after.length < REVIEW_YOUNG_DAYS,
    latest,
    nearest,
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
  // 知らない引数（--help など）で本番の build が走ってビューアを上書きしないよう、先に弾く
  const KNOWN = ['--data', '--out', '--viewer', '--no-viewer'];
  const unknown = argv.slice(2).filter((a) => a.startsWith('--') && !KNOWN.includes(a));
  if (unknown.length) {
    console.error(`エラー: 知らない引数 ${unknown.join(' ')}\n使い方: node build.mjs [--data <dataDir>] [--out <file>] [--viewer <path> | --no-viewer]`);
    process.exit(1);
  }
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
