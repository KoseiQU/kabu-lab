// 反省型（hansei）の材料: 購入日と購入価格から、買った日の状態と購入後の値動きを計算する（DESIGN.md §5.6）。
// 使い方（src で実行）: node tools/entry-stats.mjs <code> <購入日 YYYY-MM-DD> <購入価格>
//   入力は ../data/stocks/<code>/prices.json。結果は標準出力へ md（2KB以内）。
//   購入日が休場日なら翌営業日に寄せる。データの範囲外（最初の日足より前・最終日より後）なら exit 1。
// 計算は純粋関数（entryStats・formatEntryStats）。外部サイトには出ない。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { computeAll, swings } from '../collect/lib/indicators.mjs';
import { DATA_DIR, isMain, checkCode, fail } from '../collect/lib/util.mjs';

export const ENTRY_STATS_LIMIT = 2048;

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const round = (x, n = 2) => (isNum(x) ? Math.round(x * 10 ** n) / 10 ** n : null);
const pct = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? round(((a - b) / b) * 100) : null);

export class EntryRangeError extends Error {}

/** 購入日を営業日（rows の日付）に寄せる。休場日なら翌営業日。範囲外なら EntryRangeError */
export function alignEntryDate(rows, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || Number.isNaN(new Date(date + 'T00:00:00Z').getTime())) {
    throw new EntryRangeError(`購入日の形式が不正です: "${date ?? ''}"（YYYY-MM-DD）`);
  }
  if (!rows?.length) throw new EntryRangeError('日足がありません');
  const first = rows[0].d, last = rows.at(-1).d;
  if (date < first) throw new EntryRangeError(`購入日 ${date} は日足の範囲（${first}〜${last}）より前です`);
  if (date > last) throw new EntryRangeError(`購入日 ${date} は日足の範囲（${first}〜${last}）より後です`);
  const index = rows.findIndex((r) => r.d >= date);
  return { index, date: rows[index].d, adjusted: rows[index].d !== date };
}

/**
 * rows: prices.json の日足（日付昇順 [{d,o,h,l,c,v}]）。date: 購入日。price: 購入価格。
 * 返り値は画面・分析で使う数字一式（null は計算できない）。
 */
export function entryStats(rows, date, price) {
  if (!isNum(price) || price <= 0) throw new EntryRangeError(`購入価格が不正です: ${price}`);
  const { index: i, date: d, adjusted } = alignEntryDate(rows, date);
  const day = rows[i];
  const at = computeAll(rows.slice(0, i + 1));
  const inRange = price >= day.l && price <= day.h;
  const ma = at.ma
    .filter((m) => m.n !== 5)
    .map((m) => ({ n: m.n, value: m.value, closeDevPct: m.deviationPct, priceDevPct: pct(price, m.value), slope: m.slope }));
  // 直前のスイング: 全期間の日足で確定したスイングのうち、購入日より前の最後のもの（チャートで見える形）
  const sw = swings(rows, { k: 8, lookback: rows.length });
  const lastBefore = (list) => {
    const x = list.filter((s) => s.d < d).at(-1);
    return x ? { d: x.d, price: x.price, fromPricePct: pct(x.price, price) } : null;
  };
  // 購入後（翌営業日〜最終日）の高値・安値から最大含み益・含み損。同じ値なら早い日
  const after = rows.slice(i + 1);
  let up = null, down = null;
  for (const r of after) {
    if (!up || r.h > up.h) up = r;
    if (!down || r.l < down.l) down = r;
  }
  const last = rows.at(-1);
  return {
    requested: date,
    entry: { date: d, price, adjusted, index: i },
    day: { o: day.o, h: day.h, l: day.l, c: day.c, v: day.v },
    inRange,
    rangePos: day.h > day.l ? round((price - day.l) / (day.h - day.l)) : null,
    heat: {
      ma25dev: at.ma.find((m) => m.n === 25)?.deviationPct ?? null,
      ma25devAtPrice: pct(price, at.ma.find((m) => m.n === 25)?.value),
      rsi: at.rsi14,
      change3d: at.change3dPct,
      volume: at.volumeRatio20,
    },
    ma,
    swingHigh: lastBefore(sw.highs),
    swingLow: lastBefore(sw.lows),
    result: {
      asOf: last.d,
      close: last.c,
      pnlPct: pct(last.c, price),
      maxUpPct: up ? pct(up.h, price) : null,
      maxUpDate: up?.d ?? null,
      maxUpPrice: up?.h ?? null,
      maxDownPct: down ? pct(down.l, price) : null,
      maxDownDate: down?.d ?? null,
      maxDownPrice: down?.l ?? null,
      days: rows.length - 1 - i,
    },
  };
}

const nf = (x, d = 1) => (isNum(x) ? x.toLocaleString('ja-JP', { maximumFractionDigits: d }) : '未計算');
const sg = (x) => (isNum(x) ? `${x > 0 ? '+' : ''}${x.toLocaleString('ja-JP', { maximumFractionDigits: 2 })}%` : '未計算');
const SLOPE = { up: '上向き', down: '下向き', flat: '横ばい' };

/** entryStats の結果を md に（2KB以内） */
export function formatEntryStats(s, { code, name = '', asOf } = {}) {
  const e = s.entry, r = s.result, h = s.heat;
  const L = [
    `# ${code} ${name} entry-stats（購入 ${e.date} ${nf(e.price)}円）`,
    `出典: data/stocks/${code}/prices.json（日足の最終日 ${asOf ?? r.asOf}）。数値は計算値のみ。`,
    '',
    '## 購入日',
    e.adjusted ? `- 指定の ${s.requested} は休場日のため、翌営業日 ${e.date} に寄せた` : `- ${e.date}（営業日）`,
    `- 四本値 始 ${nf(s.day.o)} / 高 ${nf(s.day.h)} / 安 ${nf(s.day.l)} / 終 ${nf(s.day.c)} / 出来高 ${nf(s.day.v, 0)}`,
    s.inRange
      ? `- 購入価格 ${nf(e.price)}円 はその日の値幅に収まる（値幅の中の位置 ${nf(s.rangePos, 2)}、0=安値・1=高値）`
      : `- 警告: 購入価格 ${nf(e.price)}円 はその日の値幅 ${nf(s.day.l)}〜${nf(s.day.h)}円 の外（日付か価格の誤りの可能性）`,
    '',
    '## 買った日の過熱の物差し（その日の終値で計算。chart 型の heat と同じ定義）',
    `- ma25dev 25日線乖離 ${sg(h.ma25dev)}（購入価格では ${sg(h.ma25devAtPrice)}）`,
    `- rsi RSI(14) ${nf(h.rsi)}`,
    `- change3d 直近3日の騰落率 ${sg(h.change3d)}`,
    `- volume 出来高 前20日平均比 ${isNum(h.volume) ? nf(h.volume, 2) + '倍' : '未計算'}`,
    '',
    '## 移動平均線（購入日）',
    '| 線 | 値 | 終値の乖離 | 購入価格の乖離 | 向き(5日前比) |',
    '|---|---|---|---|---|',
    ...s.ma.map((m) => `| ${m.n}日 | ${nf(m.value)} | ${sg(m.closeDevPct)} | ${sg(m.priceDevPct)} | ${SLOPE[m.slope] ?? '未計算'} |`),
    '',
    '## 直前のスイング（前後8日。購入日より前で最後のもの）',
    `- 高値 ${s.swingHigh ? `${s.swingHigh.d} ${nf(s.swingHigh.price)}円（購入価格比 ${sg(s.swingHigh.fromPricePct)}）` : 'なし'}`,
    `- 安値 ${s.swingLow ? `${s.swingLow.d} ${nf(s.swingLow.price)}円（購入価格比 ${sg(s.swingLow.fromPricePct)}）` : 'なし'}`,
    '',
    '## 購入後（翌営業日〜最終取引日の高値・安値）',
    `- 経過営業日数 ${r.days}（最終取引日 ${r.asOf}）`,
    `- 最終取引日の終値 ${nf(r.close)}円 → 損益率 ${sg(r.pnlPct)}`,
    r.days > 0
      ? `- 最大含み益 ${sg(r.maxUpPct)}（${r.maxUpDate} 高値 ${nf(r.maxUpPrice)}円）`
      : '- 最大含み益・含み損: 購入日が最終取引日のため、まだ無い',
    ...(r.days > 0 ? [`- 最大含み損 ${sg(r.maxDownPct)}（${r.maxDownDate} 安値 ${nf(r.maxDownPrice)}円）`] : []),
  ];
  let text = L.join('\n') + '\n';
  if (Buffer.byteLength(text) > ENTRY_STATS_LIMIT) {
    text = Buffer.from(text).subarray(0, ENTRY_STATS_LIMIT - 40).toString('utf8').replace(/�+$/, '') + '\n…（2KB上限のため省略）\n';
  }
  return text;
}

if (isMain(import.meta.url)) {
  const [code, date, priceArg] = process.argv.slice(2);
  const usage = '使い方: node tools/entry-stats.mjs <code> <購入日 YYYY-MM-DD> <購入価格>';
  try {
    checkCode(code);
  } catch (e) {
    fail(`${e.message}\n${usage}`);
  }
  const price = Number(String(priceArg ?? '').replace(/[,円]/g, ''));
  if (!date || !priceArg || !isNum(price) || price <= 0) fail(`購入日と購入価格を指定してください\n${usage}`);
  const p = join(DATA_DIR, 'stocks', code, 'prices.json');
  if (!existsSync(p)) fail(`${p} がありません。先に node collect/run.mjs ${code} を実行してください`);
  let prices;
  try {
    prices = JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    fail(`prices.json を読めません: ${e.message}`);
  }
  try {
    const s = entryStats(prices.rows ?? [], date, price);
    process.stdout.write(formatEntryStats(s, { code, name: prices.meta?.name ?? '', asOf: prices.meta?.asOf }));
  } catch (e) {
    if (e instanceof EntryRangeError) fail(e.message);
    throw e;
  }
}
