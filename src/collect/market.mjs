// 市場データ: 日経平均・TOPIX連動ETF・ドル円・米10年金利・ブレント・WTI の直近値と前日比（raw）、
// 日経平均・ドル円・米10年金利の日足2年分（series）、Claude が読む要約（digest-market.md、4KB以内）。
// 使い方: node collect/market.mjs [--if-stale]
//   → data/market/<JST日付>-raw.json, data/market/series.json, data/market/digest-market.md
// 1サイト最大4リクエストの制約のため、Yahoo の spark エンドポイント（chart API の複数銘柄版）を range=2y で
// 1回だけ呼び、6銘柄の直近値と3銘柄の2年分を同じ応答から作る（Yahoo へのリクエストは1回）。
// --if-stale: digest-market.md が最新（直近の大引け以降に作成、または作成から3時間以内）で、今日の raw と series があれば省く。
import { join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { defaultFetcher } from './lib/fetch.mjs';
import { DATA_DIR, isMain, writeJson, writeText, jstDate, fail, isDigestFresh } from './lib/util.mjs';
import { buildMarketDigest, MARKET_DIGEST_LIMIT } from './lib/digest-market.mjs';

export const SYMBOLS = [
  { key: 'nikkei225', symbol: '^N225', name: '日経平均', unit: '円', series: true },
  { key: 'topixEtf', symbol: '1306.T', name: 'TOPIX連動ETF(1306)', unit: '円', note: 'TOPIX指数そのものは取得不可のため連動ETFで代用。騰落率の参考用' },
  { key: 'usdjpy', symbol: 'JPY=X', name: 'ドル円', unit: '円', series: true },
  { key: 'us10y', symbol: '^TNX', name: '米10年金利', unit: '%', series: true },
  { key: 'brent', symbol: 'BZ=F', name: 'ブレント原油', unit: 'ドル' },
  { key: 'wti', symbol: 'CL=F', name: 'WTI原油', unit: 'ドル' },
];

export const sparkUrl = (symbols, range = '2y') =>
  `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${symbols.map(encodeURIComponent).join(',')}&range=${range}&interval=1d`;

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const r = (x, n = 4) => Math.round(x * 10 ** n) / 10 ** n;
const jstOf = (t) => new Date((t + 9 * 3600) * 1000).toISOString().slice(0, 10);

/**
 * spark 応答の1銘柄分 → 日付昇順の終値列 [{t, d, c}]（純粋関数）。
 * null の点は除く。最終点が null で fulldayPrice（当日の最新値）があればそれを使う。
 * 同じ日本時間の日付に2点ある（日足の点と最新値の点）ときは後の点を残す。
 */
export function sparkPoints(entry) {
  if (!entry) return [];
  const ts = entry.timestamp ?? [];
  const cl = entry.close ?? [];
  const byDate = new Map();
  for (let i = 0; i < ts.length; i++) {
    let c = cl[i];
    if (!isNum(c) && i === ts.length - 1 && isNum(entry.fulldayPrice)) c = entry.fulldayPrice;
    if (isNum(c) && isNum(ts[i])) byDate.set(jstOf(ts[i]), { t: ts[i], d: jstOf(ts[i]), c });
  }
  return [...byDate.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
}

/** spark 応答の1銘柄分 → {value, prev, change, changePct, asOf}（純粋関数） */
export function parseSpark(entry) {
  const pts = sparkPoints(entry);
  if (pts.length < 2) return null;
  const [p, l] = pts.slice(-2);
  return { value: r(l.c), prev: r(p.c), change: r(l.c - p.c), changePct: r(((l.c - p.c) / p.c) * 100, 2), asOf: l.d };
}

export function parseMarket(json, now = new Date()) {
  const items = {};
  const missing = [];
  for (const s of SYMBOLS) {
    let v = null;
    try {
      v = parseSpark(json?.[s.symbol]);
    } catch {
      v = null;
    }
    items[s.key] = v ? { symbol: s.symbol, name: s.name, unit: s.unit, ...(s.note ? { note: s.note } : {}), ...v } : null;
    if (!v) missing.push(`${s.name}(${s.symbol})`);
  }
  return {
    date: jstDate(now),
    generatedAt: now.toISOString(),
    source: { title: 'Yahoo Finance spark/chart API', url: sparkUrl(SYMBOLS.map((s) => s.symbol)) },
    items,
    missing,
  };
}

/**
 * series.json: 日経平均・ドル円・米10年金利の日足（終値のみ、日本時間の日付）。
 * { generatedAt, source, series: { "^N225": { key, name, unit, rows: [{d, c}] }, ... }, missing }
 */
export function parseSeries(json, now = new Date()) {
  const series = {};
  const missing = [];
  for (const s of SYMBOLS.filter((x) => x.series)) {
    let pts = [];
    try {
      pts = sparkPoints(json?.[s.symbol]);
    } catch {
      pts = [];
    }
    if (pts.length < 2) {
      missing.push(`${s.name}(${s.symbol})`);
      continue;
    }
    series[s.symbol] = { key: s.key, name: s.name, unit: s.unit, rows: pts.map((p) => ({ d: p.d, c: r(p.c) })) };
  }
  return {
    generatedAt: now.toISOString(),
    source: { title: 'Yahoo Finance spark API（日足・2年）', url: sparkUrl(SYMBOLS.map((s) => s.symbol)) },
    series,
    missing,
  };
}

/** series.json の本文（1行=1日足にして差分を読みやすく・軽くする） */
export function seriesJsonText(s) {
  const body = Object.entries(s.series ?? {}).map(([sym, x]) => {
    const { rows, ...meta } = x;
    const m = JSON.stringify(meta).slice(1, -1);
    return `  ${JSON.stringify(sym)}: {${m}, "rows": [\n${rows.map((r) => '   ' + JSON.stringify(r)).join(',\n')}\n  ]}`;
  });
  const { series, ...rest } = s;
  const head = JSON.stringify(rest, null, 1).replace(/\n}$/, '');
  return `${head},\n "series": {\n${body.join(',\n')}\n }\n}\n`;
}

export const marketPaths = (dataDir = DATA_DIR, now = new Date()) => ({
  raw: join(dataDir, 'market', `${jstDate(now)}-raw.json`),
  series: join(dataDir, 'market', 'series.json'),
  digest: join(dataDir, 'market', 'digest-market.md'),
});

/** --if-stale で収集を省けるか（今日の raw・series・digest がそろい、digest が最新） */
export function marketIsFresh(paths, now = new Date()) {
  if (![paths.raw, paths.series, paths.digest].every((f) => existsSync(f))) return false;
  return isDigestFresh(statSync(paths.digest).mtime, now);
}

if (isMain(import.meta.url)) {
  const ifStale = process.argv.includes('--if-stale');
  const paths = marketPaths();
  if (ifStale && marketIsFresh(paths)) {
    console.log(`収集を省略（市場の digest は最新です）:\n  ${paths.digest}`);
    process.exit(0);
  }
  try {
    const json = await defaultFetcher().json(sparkUrl(SYMBOLS.map((s) => s.symbol)));
    const now = new Date();
    const m = parseMarket(json, now);
    if (m.missing.length === SYMBOLS.length) throw new Error('全銘柄の値が取れませんでした（応答形式の変化の可能性）');
    const series = parseSeries(json, now);
    writeJson(paths.raw, m);
    writeText(paths.series, seriesJsonText(series));
    const digest = buildMarketDigest({ raw: m, series, generatedAt: now.toISOString() });
    writeText(paths.digest, digest);
    for (const it of Object.values(m.items)) if (it) console.log(`${it.name} ${it.value}${it.unit}（${it.change >= 0 ? '+' : ''}${it.change} / ${it.changePct}%）${it.asOf}`);
    if (m.missing.length) console.log(`未取得: ${m.missing.join('、')}`);
    if (series.missing.length) console.log(`時系列の未取得: ${series.missing.join('、')}`);
    console.log('書いたファイル:');
    console.log(`  ${paths.raw}`);
    console.log(`  ${paths.series} (${Object.values(series.series).map((s) => `${s.name}${s.rows.length}本`).join('・')})`);
    console.log(`  ${paths.digest} (${Buffer.byteLength(digest)} bytes / 上限 ${MARKET_DIGEST_LIMIT})`);
  } catch (e) {
    fail(`市場データの取得に失敗しました: ${e.message}`);
  }
}
