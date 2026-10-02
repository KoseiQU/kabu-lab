// digest-kessan.md（決算型で Claude が読む要約）。8KB以内。金額は株探の百万円を億円に換算して載せる。
import { fitToLimit, DIGEST_LIMIT } from './digest.mjs';

export { DIGEST_LIMIT };

const NA = '-';
/** 百万円 → 億円の表示（100億円以上は整数、未満は小数1桁） */
export function oku(x) {
  if (x == null || !Number.isFinite(x)) return NA;
  const v = x / 100;
  return v.toLocaleString('ja-JP', { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 1 });
}
const n = (x, d = 2) => (x == null || !Number.isFinite(x) ? NA : x.toLocaleString('ja-JP', { maximumFractionDigits: d }));
const sg = (x) => (x == null || !Number.isFinite(x) ? NA : (x > 0 ? '+' : '') + n(x, 1) + '%');
const DIR = { up: '上方', down: '下方', flat: '据え置き' };

export function buildKessanDigest({ code, fin, generatedAt = new Date().toISOString() }) {
  const f = fin ?? {};
  const header =
    `# ${code} ${f.name ?? ''} 決算digest（kessan）\n` +
    `生成 ${generatedAt} / 出典: 株探 決算 ${f.source?.url ?? '未取得'}\n` +
    `金額は億円（株探の百万円÷100を四捨五入）。1株益・配当は円。「-」は株探に掲載なし。数字は推測で埋めない。\n\n`;
  const S = [];
  const plHead = (extra = []) => [`| 期 | 売上高 | 営業益 | 経常益 | 最終益 | 1株益 | ${extra.join(' | ')}${extra.length ? ' |' : ''}`.replace(/\| $/, '|'), `|${'---|'.repeat(6 + extra.length)}`];
  const yoyLine = (y, label) => (y ? `${label}: 売上 ${sg(y.sales)} / 営業益 ${sg(y.operatingProfit)} / 経常益 ${sg(y.ordinaryProfit)} / 最終益 ${sg(y.netProfit)} / 1株益 ${sg(y.eps)}` : `${label}: ${NA}`);

  if (f.annual) {
    S.push({
      title: '通期業績（古い順、「予」は会社予想）',
      head: plHead(['1株配', '発表日']),
      items: f.annual.rows.map((r) => `| ${r.period}${r.forecast ? '予' : ''} | ${oku(r.sales)} | ${oku(r.operatingProfit)} | ${oku(r.ordinaryProfit)} | ${oku(r.netProfit)} | ${n(r.eps)} | ${n(r.dividend)} | ${r.announced ?? NA} |`),
      order: 'old-first',
      minKeep: 3,
    });
    S.push({ title: '通期の前期比（予想期 vs 前期）', head: [yoyLine(f.annual.yoy, '前期比')], items: [] });
  } else S.push({ title: '通期業績', head: ['未取得'], items: [] });

  const rv = f.revisions;
  S.push({
    title: `業績予想の修正履歴（${rv?.period ?? '今期'}）`,
    head: rv
      ? [
          rv.latest ? `直近 ${rv.latest.date}（${rv.latest.kind}）: 売上 ${DIR[rv.latest.sales] ?? NA} / 営業益 ${DIR[rv.latest.operatingProfit] ?? NA} / 経常益 ${DIR[rv.latest.ordinaryProfit] ?? NA} / 最終益 ${DIR[rv.latest.netProfit] ?? NA}` : rv.revised ? '修正あり（数値は非公開）' : '期初予想から修正なし',
        ]
      : ['未取得'],
    items: (rv?.history ?? []).map((h) => `- ${h.date} ${h.kind}: 売上 ${oku(h.sales)} / 営業益 ${oku(h.operatingProfit)} / 経常益 ${oku(h.ordinaryProfit)} / 最終益 ${oku(h.netProfit)} / 配当 ${n(h.dividend)}`),
    order: 'old-first',
    minKeep: 2,
  });

  const cu = f.cumulative;
  S.push({
    title: `${cu?.label ?? '四半期累計'}（各年の同じ期間、古い順）`,
    head: cu ? [...plHead(['発表日']), ...[]] : ['未取得'],
    items: (cu?.rows ?? []).map((r) => `| ${r.period} | ${oku(r.sales)} | ${oku(r.operatingProfit)} | ${oku(r.ordinaryProfit)} | ${oku(r.netProfit)} | ${n(r.eps)} | ${r.announced ?? NA} |`),
    order: 'old-first',
    minKeep: 2,
  });
  if (cu) S.push({ title: '累計の前年同期比', head: [yoyLine(cu.yoy, '前年同期比')], items: [] });

  const pg = f.progress;
  S.push({
    title: `通期予想に対する進捗率${pg ? `（${pg.cumulativePeriod} 累計 ÷ ${pg.fiscalYear}予、均等ペース ${pg.pace ?? NA}%）` : ''}`,
    head: pg ? pg.items.map((i) => `- ${i.label}: ${i.pct == null ? NA : i.pct + '%'}（累計 ${oku(i.actual)} / 予想 ${oku(i.forecast)}）`) : ['計算できない（予想または累計が未取得）'],
    items: [],
  });

  const q = f.quarterly;
  S.push({
    title: '3か月ごとの業績（古い順）',
    head: q ? plHead(['営業利益率%', '発表日']) : ['未取得'],
    items: (q?.rows ?? []).map((r) => `| ${r.period} | ${oku(r.sales)} | ${oku(r.operatingProfit)} | ${oku(r.ordinaryProfit)} | ${oku(r.netProfit)} | ${n(r.eps)} | ${n(r.opMargin)} | ${r.announced ?? NA} |`),
    order: 'old-first',
    minKeep: 3,
  });
  if (q?.yoy) S.push({ title: '直近3か月の前年同期比', head: [yoyLine(q.yoy, '前年同期比')], items: [] });

  S.push({
    title: '収益性（%・回）',
    head: f.profitability ? ['| 期 | 営業利益率 | ROE | ROA | 総資産回転率 |', '|---|---|---|---|---|'] : ['未取得'],
    items: (f.profitability ?? []).map((r) => `| ${r.period}${r.forecast ? '予' : ''} | ${n(r.opMargin)} | ${n(r.roe)} | ${n(r.roa)} | ${n(r.assetTurnover)} |`),
    order: 'old-first',
    minKeep: 2,
  });
  S.push({
    title: '財務（億円・%・倍）',
    head: f.balance ? ['| 期 | 自己資本比率 | 総資産 | 自己資本 | 剰余金 | 有利子負債倍率 | 1株純資産(円) |', '|---|---|---|---|---|---|---|'] : ['未取得'],
    items: (f.balance ?? []).map((r) => `| ${r.period} | ${n(r.equityRatio)} | ${oku(r.totalAssets)} | ${oku(r.equity)} | ${oku(r.retainedEarnings)} | ${n(r.deRatio)} | ${n(r.bps)} |`),
    order: 'old-first',
    minKeep: 2,
  });
  S.push({
    title: 'キャッシュフロー（通期・億円）',
    head: f.cashflow ? ['| 期 | 営業CF | 投資CF | 財務CF | フリーCF | 現金等残高 | 現金比率% |', '|---|---|---|---|---|---|---|'] : ['未取得'],
    items: (f.cashflow ?? []).map((r) => `| ${r.period} | ${oku(r.operating)} | ${oku(r.investing)} | ${oku(r.financing)} | ${oku(r.fcf)} | ${oku(r.cash)} | ${n(r.cashRatio)} |`),
    order: 'old-first',
    minKeep: 2,
  });
  S.push({
    title: '決算短信PDF（新しい順。node tools/fetch-doc.mjs <code> <PDFのURL> --name <名前> で取得）',
    head: f.docs ? [] : ['未取得'],
    items: (f.docs ?? []).map((d) => `- ${d.date} ${d.pdf ?? d.url}`),
    order: 'new-first',
    minKeep: 1,
  });
  const missing = f.missing ?? ['決算ページ一式'];
  S.push({ title: '取得できなかった項目', head: missing.length ? [] : ['なし'], items: missing.map((m) => `- ${m}`), order: 'new-first', minKeep: 5 });
  return fitToLimit(header, S);
}
