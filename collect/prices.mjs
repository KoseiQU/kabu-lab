// Yahoo chart API から日足2年分を取得し data/stocks/<code>/prices.json に保存する。
// 使い方: node collect/prices.mjs <code>
import { join } from 'node:path';
import { defaultFetcher } from './lib/fetch.mjs';
import { ROOT, isMain, writeJson, checkCode, fail } from './lib/util.mjs';

export const chartUrl = (symbol, range = '2y') =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;

const r1 = (x) => Math.round(x * 10) / 10;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** chart API の JSON を {meta, rows} に変換する（純粋関数） */
export function parseChart(json, code) {
  const err = json?.chart?.error;
  if (err) throw new Error(`Yahoo chart API エラー: ${err.code ?? ''} ${err.description ?? JSON.stringify(err)}`);
  const res = json?.chart?.result?.[0];
  if (!res) throw new Error('Yahoo chart API の応答に result がありません');
  const m = res.meta ?? {};
  const ts = res.timestamp ?? [];
  const q = res.indicators?.quote?.[0] ?? {};
  const off = isNum(m.gmtoffset) ? m.gmtoffset : 9 * 3600; // 秒。JST=32400
  const toDate = (t) => new Date((t + off) * 1000).toISOString().slice(0, 10);

  const byDate = new Map();
  let filledFromMeta = false;
  for (let i = 0; i < ts.length; i++) {
    let [o, h, l, c, v] = [q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i], q.volume?.[i]];
    const d = toDate(ts[i]);
    // 最終行だけ終値が null で、meta の最新値が同じ日付なら（引け後の未反映）それで補う
    if (i === ts.length - 1 && !isNum(c) && isNum(o) && isNum(m.regularMarketPrice) &&
        isNum(m.regularMarketTime) && toDate(m.regularMarketTime) === d) {
      c = m.regularMarketPrice;
      if (isNum(m.regularMarketDayHigh)) h = m.regularMarketDayHigh;
      if (isNum(m.regularMarketDayLow)) l = m.regularMarketDayLow;
      if (isNum(m.regularMarketVolume)) v = m.regularMarketVolume;
      filledFromMeta = true;
    }
    if (![o, h, l, c].every(isNum)) continue; // null 行は除外
    byDate.set(d, { d, o: r1(o), h: r1(h), l: r1(l), c: r1(c), v: isNum(v) ? Math.round(v) : 0 });
  }
  const rows = [...byDate.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
  if (rows.length === 0) throw new Error(`${code}: 有効な日足が0本でした`);
  return {
    meta: {
      code,
      name: m.longName ?? m.shortName ?? null,
      currency: m.currency ?? null,
      asOf: rows.at(-1).d,
      source: chartUrl(m.symbol ?? `${code}.T`),
      lastCloseFromMeta: filledFromMeta, // true: 最終日の終値は meta.regularMarketPrice（引け後の確定値）
      fetchedAt: new Date().toISOString(),
    },
    rows,
  };
}

export async function fetchPrices(code, { fetcher = defaultFetcher() } = {}) {
  checkCode(code);
  const json = await fetcher.json(chartUrl(`${code}.T`));
  return parseChart(json, code);
}

export function pricesPath(code) {
  return join(ROOT, 'data', 'stocks', code, 'prices.json');
}

if (isMain(import.meta.url)) {
  const code = process.argv[2];
  try {
    const p = await fetchPrices(checkCode(code));
    writeJson(pricesPath(code), p);
    console.log(`${pricesPath(code)} (${p.rows.length}本, 最終 ${p.meta.asOf})`);
  } catch (e) {
    fail(`株価の取得に失敗しました: ${e.message}`);
  }
}
