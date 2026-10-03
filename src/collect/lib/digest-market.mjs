// digest-market.md（Claude が読む市場の要約）を組み立てる。4KB（4096バイト）以内。純粋関数のみ。
// 入力: raw（parseMarket の結果）と series（parseSeries の結果）。
import { sma, deviationPct, rsi } from './indicators.mjs';

export const MARKET_DIGEST_LIMIT = 4096;

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const round = (x, n = 2) => (isNum(x) ? Math.round(x * 10 ** n) / 10 ** n : null);
const nfa = (x, d = 2) => (isNum(x) ? x.toLocaleString('ja-JP', { maximumFractionDigits: d }) : '未取得');
const sign = (x, d = 2) => (isNum(x) ? (x > 0 ? '+' : '') + x.toLocaleString('ja-JP', { maximumFractionDigits: d }) : '未取得');
const bytes = (s) => Buffer.byteLength(s, 'utf8');

/** YYYY-MM-DD から月・年をさかのぼった日（月末は丸める: 3/31 の1か月前 → 2/28） */
export function shiftDate(d, { months = 0, years = 0 } = {}) {
  const [y, m, day] = d.split('-').map(Number);
  const total = y * 12 + (m - 1) - months - years * 12;
  const ty = Math.floor(total / 12), tm = total - ty * 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ty, tm, Math.min(day, last))).toISOString().slice(0, 10);
}

/** rows（日付昇順 [{d,c}]）で、最終日から期間をさかのぼった日以前の最後の終値との変化。足りなければ null */
export function changeOver(rows, period) {
  if (!rows?.length) return null;
  const last = rows.at(-1);
  const target = shiftDate(last.d, period);
  let base = null;
  for (const r of rows) {
    if (r.d <= target) base = r;
    else break;
  }
  if (!base || !isNum(base.c) || base.c === 0) return null;
  return { from: base.d, fromValue: base.c, diff: round(last.c - base.c, 4), pct: round(((last.c - base.c) / base.c) * 100) };
}

/** 終値の系列から移動平均・乖離・向き・RSI・52週の高安と位置を計算（終値ベース） */
export function seriesStats(rows, periods = [25, 75, 200]) {
  if (!rows?.length) return null;
  const closes = rows.map((r) => r.c);
  const last = rows.at(-1);
  const ma = periods.map((n) => {
    const s = sma(closes, n);
    const v = s.at(-1), v5 = s.at(-6) ?? null;
    return { n, value: round(v, 2), deviationPct: round(deviationPct(last.c, v)), slope: v == null || v5 == null ? null : v > v5 ? 'up' : v < v5 ? 'down' : 'flat' };
  });
  // 52週: 最終日から364日前以降の終値（high52 と同じ範囲の取り方）
  const from = new Date(new Date(last.d + 'T00:00:00Z').getTime() - 364 * 86400000).toISOString().slice(0, 10);
  const yr = rows.filter((r) => r.d >= from);
  let hi = yr[0], lo = yr[0];
  for (const r of yr) {
    if (r.c >= hi.c) hi = r;
    if (r.c <= lo.c) lo = r;
  }
  const pos = hi.c === lo.c ? null : round((last.c - lo.c) / (hi.c - lo.c), 2);
  return {
    asOf: last.d,
    close: last.c,
    bars: rows.length,
    ma,
    rsi14: round(rsi(closes, 14).at(-1), 1),
    week52: { high: hi.c, highDate: hi.d, low: lo.c, lowDate: lo.d, position: pos },
  };
}

const SLOPE = { up: '上向き', down: '下向き', flat: '横ばい' };

/** digest-market.md の本文（4KB以内）。series の各要素は {key, name, unit, rows} */
export function buildMarketDigest({ raw, series, generatedAt = new Date().toISOString() }) {
  const S = series?.series ?? {};
  const byKey = Object.fromEntries(Object.values(S).map((s) => [s.key, s]));
  const head =
    `# 市場 digest\n` +
    `生成 ${generatedAt} / 出典: ${raw?.source?.title ?? 'Yahoo Finance spark API'}（終値ベース。日付は日本時間）\n` +
    `数値は下記の取得値のみ。日経平均の予想PER・日本の金利・ニュースは Web 検索で補う。ない数字は推測で埋めない。`;
  const out = [head];

  // 1. 各指標の直近値
  const items = Object.values(raw?.items ?? {});
  const lines = ['## 各指標の直近値と前日比', '| 指標 | 値 | 前日比 | 騰落率 | 日付 |', '|---|---|---|---|---|'];
  for (const it of items) if (it) lines.push(`| ${it.name} | ${nfa(it.value, 3)}${it.unit} | ${sign(it.change, 3)} | ${sign(it.changePct)}% | ${it.asOf} |`);
  if (raw?.missing?.length) lines.push(`未取得: ${raw.missing.join('、')}`);
  out.push(lines.join('\n'));

  // 2. 変化率（1か月・3か月・1年）
  const per = [['1か月', { months: 1 }], ['3か月', { months: 3 }], ['1年', { years: 1 }]];
  const cl = ['## 変化（最終日の終値と、その期間前の終値の比較）', '| 指標 | 最終日 | 終値 | 1か月 | 3か月 | 1年 |', '|---|---|---|---|---|---|'];
  for (const s of Object.values(S)) {
    const last = s.rows.at(-1);
    const cells = per.map(([, p]) => {
      const c = changeOver(s.rows, p);
      if (!c) return '未取得';
      return s.unit === '%' ? `${sign(c.diff, 3)}pt（${sign(c.pct, 1)}%）` : `${sign(c.pct)}%`;
    });
    cl.push(`| ${s.name} | ${last?.d ?? '未取得'} | ${nfa(last?.c, 3)}${s.unit} | ${cells.join(' | ')} |`);
  }
  if (!Object.keys(S).length) cl.push('時系列を取得できなかった');
  out.push(cl.join('\n'));

  // 3. 日経平均のテクニカル
  const nk = byKey.nikkei225 ? seriesStats(byKey.nikkei225.rows) : null;
  if (nk) {
    const w = nk.week52;
    out.push([
      `## 日経平均のテクニカル（終値 ${nfa(nk.close)}円 ${nk.asOf}・日足${nk.bars}本・終値ベース）`,
      '| 線 | 値 | 乖離率 | 向き(5日前比) |', '|---|---|---|---|',
      ...nk.ma.map((m) => `| ${m.n}日 | ${nfa(m.value, 0)} | ${sign(m.deviationPct)}% | ${SLOPE[m.slope] ?? '未取得'} |`),
      `RSI(14) ${nfa(nk.rsi14, 1)}`,
      `52週高値 ${nfa(w.high)}（${w.highDate}）/ 52週安値 ${nfa(w.low)}（${w.lowDate}）/ レンジ内の位置 ${nfa(w.position)}（0=安値・1=高値）`,
    ].join('\n'));
  } else out.push('## 日経平均のテクニカル\n未取得');

  // 4. ドル円の移動平均と向き
  const fx = byKey.usdjpy ? seriesStats(byKey.usdjpy.rows, [25, 75]) : null;
  if (fx) {
    out.push([
      `## ドル円の移動平均（終値 ${nfa(fx.close, 3)}円 ${fx.asOf}）`,
      ...fx.ma.map((m) => `- ${m.n}日線 ${nfa(m.value, 3)}円（乖離 ${sign(m.deviationPct)}%・${SLOPE[m.slope] ?? '未取得'}）`),
      `- 値が上がる＝円安方向、下がる＝円高方向`,
    ].join('\n'));
  } else out.push('## ドル円の移動平均\n未取得');

  // 5. 直近の終値（収まる範囲で。上限を超えたら日数を減らす）
  const recent = (n) => [
    `## 直近${n}営業日の終値（古い順）`,
    ...Object.values(S).map((s) => `- ${s.name}: ${s.rows.slice(-n).map((r) => `${r.d.slice(5)} ${nfa(r.c, 3)}`).join(' / ')}`),
  ].join('\n');
  const base = out.join('\n\n') + '\n';
  for (const n of [10, 7, 5, 3]) {
    const text = base + '\n' + recent(n) + '\n';
    if (bytes(text) <= MARKET_DIGEST_LIMIT) return text;
  }
  if (bytes(base) <= MARKET_DIGEST_LIMIT) return base;
  const note = '\n…（4KB上限のため以降を省略）\n';
  return Buffer.from(base, 'utf8').subarray(0, MARKET_DIGEST_LIMIT - bytes(note)).toString('utf8').replace(/�+$/, '') + note;
}
