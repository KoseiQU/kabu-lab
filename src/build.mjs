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
    // P6a（§5.10）: 業種の動き・値上がり／値下がりの上位・注目候補の追跡（機械が書くファイルは壊れていても止めない）
    sectors: sanitizeSectors(readSoft(join(mdir, 'sectors.json'), warn)),
    movers: sanitizeMovers(readSoft(join(mdir, 'movers.json'), warn)),
    picks: [],
    picksSummary: null,
  };
  {
    const pk = buildPicks(marketAnalyses, { pricesByCode, picksPrices: readSoft(join(mdir, 'picks-prices.json'), warn), nikkei: series?.series?.['^N225']?.rows ?? null });
    market.picks = pk.items;
    market.picksSummary = pk.summary;
  }
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
    .map((x) => ({ name: str(x.name, 40), url: isHttp(x.url) ? x.url.trim() : null, ok: x.ok === true, count: isNum(x.count) ? x.count : 0, message: str(x.message, 200), ...(isDate(x.stale) ? { stale: x.stale } : {}) }));
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

/* ---------- P6a（§5.10）: 業種の動き・値上がり／値下がりの上位・注目候補の答え合わせ ---------- */
const numOrNull = (x) => (isNum(x) ? x : null);
const CODE_RE = /^[0-9][0-9A-Z]{3}$/;
/** sectors.json → 画面に渡す形（17業種の行。数値でないものは null） */
export function sanitizeSectors(x) {
  if (!x || typeof x !== 'object' || !Array.isArray(x.items)) return null;
  const items = x.items.filter((i) => i && typeof i.code === 'string' && /^16\d\d$/.test(i.code))
    .map((i) => ({ key: str(i.key, 24), code: i.code, name: str(i.name, 24), close: numOrNull(i.close), d1: numOrNull(i.d1), w1: numOrNull(i.w1), m1: numOrNull(i.m1), asOf: isDate(i.asOf) ? i.asOf : null }));
  if (!items.length) return null;
  return { asOf: isDate(x.asOf) ? x.asOf : null, generatedAt: typeof x.generatedAt === 'string' ? x.generatedAt : null, note: str(x.note, 200), source: x.source && isHttp(x.source.url) ? { title: str(x.source.title, 120), url: x.source.url.trim() } : null, items, missing: (Array.isArray(x.missing) ? x.missing : []).filter((m) => typeof m === 'string').map((m) => m.slice(0, 60)) };
}
/** movers.json → 画面に渡す形（東証プライムの値上がり・値下がりの上位。社名は外部の文字列なので画面でも必ずエスケープ） */
export function sanitizeMovers(x) {
  if (!x || typeof x !== 'object') return null;
  const rows = (l) => (Array.isArray(l) ? l : []).filter((r) => r && typeof r.code === 'string' && CODE_RE.test(r.code) && isNum(r.pct)).slice(0, 10)
    .map((r) => ({ code: r.code, name: str(r.name, 40), pct: r.pct, close: numOrNull(r.close) }));
  const up = rows(x.up), down = rows(x.down);
  if (!up.length && !down.length) return null;
  return { asOf: isDate(x.asOf) ? x.asOf : null, time: typeof x.time === 'string' && /^\d{2}:\d{2}$/.test(x.time) ? x.time : null, generatedAt: typeof x.generatedAt === 'string' ? x.generatedAt : null, source: x.source && isHttp(x.source.url) ? { title: str(x.source.title, 120), url: x.source.url.trim() } : null, up, down };
}
/** 日付昇順の rows のうち、date 以前で最後の行（無ければ null） */
export function closeOnOrBefore(rows, date) {
  let hit = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.d !== 'string' || !isNum(r.c)) continue;
    if (r.d <= date) hit = r;
    else break;
  }
  return hit;
}
const cleanRows = (rows) => (Array.isArray(rows) ? rows : []).filter((r) => r && isDate(r.d) && isNum(r.c)).map((r) => ({ d: r.d, c: r.c })).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
/**
 * 候補1銘柄の終値列: 登録済み銘柄（prices.json）を優先し、無ければ picks-prices.json。
 * 登録済みでも prices.json が picks-prices より古い（最終日が前）なら新しいほうを使う（再収集されていない登録銘柄への配慮）
 */
export function pickRows(code, { pricesByCode, picksPrices }) {
  const reg = cleanRows(pricesByCode?.get?.(code));
  const pp = cleanRows(picksPrices?.prices?.[code]?.rows);
  if (reg.length && (!pp.length || reg.at(-1).d >= pp.at(-1).d)) return { rows: reg, from: 'stock' };
  if (pp.length) return { rows: pp, from: 'picks' };
  return { rows: [], from: null };
}
/**
 * 注目候補の答え合わせ（§5.10）。市場型の分析の themes[].stocks[] を1件ずつ追う。
 * base＝分析の price.asOf の日の終値（無ければその直前の取引日）、latest＝手元の最新の終値、pct＝騰落率、
 * nikkeiPct＝同じ期間（base の日〜latest の日）の日経平均の騰落率、diff＝pct−nikkeiPct、days＝base より後の営業日数、
 * young＝5営業日未満。株価が無い候補は数値を null にして残す。
 * summary: 追い風の候補のうち日経平均を上回った数／対象数、向かい風の候補のうち下回った数／対象数（young と null は除く）
 */
export function buildPicks(analyses, { pricesByCode = new Map(), picksPrices = null, nikkei = null } = {}) {
  const items = [];
  const nk = cleanRows(nikkei);
  const list = [...(Array.isArray(analyses) ? analyses : [])].filter((a) => a && a.type === 'market' && isDate(a.date))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  for (const a of list) {
    const asOf = isDate(a.price?.asOf) ? a.price.asOf : a.date;
    for (const th of Array.isArray(a.sections?.themes) ? a.sections.themes : []) {
      if (!th || typeof th !== 'object') continue;
      for (const st of Array.isArray(th.stocks) ? th.stocks : []) {
        if (!st || typeof st.code !== 'string' || !CODE_RE.test(st.code)) continue;
        const { rows, from } = pickRows(st.code, { pricesByCode, picksPrices });
        const b = closeOnOrBefore(rows, asOf);
        const l = rows.at(-1) ?? null;
        const ok = b && l && l.d >= b.d && b.c > 0;
        const pct = ok ? round2(((l.c - b.c) / b.c) * 100) : null;
        const days = ok ? rows.filter((r) => r.d > b.d && r.d <= l.d).length : null;
        const nb = ok ? closeOnOrBefore(nk, b.d) : null, nl = ok ? closeOnOrBefore(nk, l.d) : null;
        const nikkeiPct = nb && nl && nb.c > 0 ? round2(((nl.c - nb.c) / nb.c) * 100) : null;
        items.push({
          date: a.date, asOf, file: a._file ?? null,
          theme: typeof th.name === 'string' ? th.name : '', dir: th.dir === 'headwind' ? 'headwind' : 'tailwind', horizon: th.horizon === 'mid' ? 'mid' : 'short', sectorKey: typeof th.sectorKey === 'string' ? th.sectorKey : null,
          code: st.code, name: typeof st.name === 'string' ? st.name : st.code, why: typeof st.why === 'string' ? st.why : '',
          base: ok ? b.c : null, baseDate: ok ? b.d : null, latest: ok ? l.c : null, latestDate: ok ? l.d : null,
          pct, nikkeiPct, diff: isNum(pct) && isNum(nikkeiPct) ? round2(pct - nikkeiPct) : null,
          days, young: isNum(days) ? days < REVIEW_YOUNG_DAYS : false, priceFrom: ok ? from : null,
        });
      }
    }
  }
  return { items, summary: picksSummary(items) };
}
/** 集計（young と数値の欠けた候補は除く。同じ値は「上回った／下回った」に数えない） */
export function picksSummary(items) {
  const L = Array.isArray(items) ? items : [];
  const usable = L.filter((x) => !x.young && isNum(x.pct) && isNum(x.nikkeiPct));
  const tw = usable.filter((x) => x.dir === 'tailwind'), hw = usable.filter((x) => x.dir === 'headwind');
  return {
    all: L.length,
    tailwind: { above: tw.filter((x) => x.pct > x.nikkeiPct).length, total: tw.length },
    headwind: { below: hw.filter((x) => x.pct < x.nikkeiPct).length, total: hw.length },
    young: L.filter((x) => x.young).length,
    noPrice: L.filter((x) => !isNum(x.pct) || !isNum(x.nikkeiPct)).length,
  };
}

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
