// 市場データ: 日経平均・TOPIX連動ETF・ドル円・米10年金利・ブレント・WTI の直近値と前日比。
// 使い方: node collect/market.mjs  → data/market/<JST日付>-raw.json
// 1サイト最大4リクエストの制約のため、Yahoo の spark エンドポイント（chart API の複数銘柄版）で1回にまとめて取得する。
import { join } from 'node:path';
import { defaultFetcher } from './lib/fetch.mjs';
import { ROOT, isMain, writeJson, jstDate, fail } from './lib/util.mjs';

export const SYMBOLS = [
  { key: 'nikkei225', symbol: '^N225', name: '日経平均', unit: '円' },
  { key: 'topixEtf', symbol: '1306.T', name: 'TOPIX連動ETF(1306)', unit: '円', note: 'TOPIX指数そのものは取得不可のため連動ETFで代用。騰落率の参考用' },
  { key: 'usdjpy', symbol: 'JPY=X', name: 'ドル円', unit: '円' },
  { key: 'us10y', symbol: '^TNX', name: '米10年金利', unit: '%' },
  { key: 'brent', symbol: 'BZ=F', name: 'ブレント原油', unit: 'ドル' },
  { key: 'wti', symbol: 'CL=F', name: 'WTI原油', unit: 'ドル' },
];

export const sparkUrl = (symbols) =>
  `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${symbols.map(encodeURIComponent).join(',')}&range=5d&interval=1d`;

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const r = (x, n = 4) => Math.round(x * 10 ** n) / 10 ** n;
const jstOf = (t) => new Date((t + 9 * 3600) * 1000).toISOString().slice(0, 10);

/** spark 応答の1銘柄分 → {value, prev, change, changePct, asOf}（純粋関数） */
export function parseSpark(entry) {
  if (!entry) return null;
  const ts = entry.timestamp ?? [];
  const cl = entry.close ?? [];
  const pts = [];
  for (let i = 0; i < ts.length; i++) {
    let c = cl[i];
    // 最終点が null で fulldayPrice（当日の最新値）がある場合はそれを使う
    if (!isNum(c) && i === ts.length - 1 && isNum(entry.fulldayPrice)) c = entry.fulldayPrice;
    if (isNum(c)) pts.push({ t: ts[i], c });
  }
  if (pts.length < 2) return null;
  const [p, l] = pts.slice(-2);
  return { value: r(l.c), prev: r(p.c), change: r(l.c - p.c), changePct: r(((l.c - p.c) / p.c) * 100, 2), asOf: jstOf(l.t) };
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

if (isMain(import.meta.url)) {
  try {
    const json = await defaultFetcher().json(sparkUrl(SYMBOLS.map((s) => s.symbol)));
    const m = parseMarket(json);
    if (m.missing.length === SYMBOLS.length) throw new Error('全銘柄の値が取れませんでした（応答形式の変化の可能性）');
    const path = join(ROOT, 'data', 'market', `${m.date}-raw.json`);
    writeJson(path, m);
    for (const it of Object.values(m.items)) if (it) console.log(`${it.name} ${it.value}${it.unit}（${it.change >= 0 ? '+' : ''}${it.change} / ${it.changePct}%）${it.asOf}`);
    if (m.missing.length) console.log(`未取得: ${m.missing.join('、')}`);
    console.log(`書いたファイル: ${path}`);
  } catch (e) {
    fail(`市場データの取得に失敗しました: ${e.message}`);
  }
}
