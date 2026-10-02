// 株探 決算ページのパーサと digest-kessan（P2a）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFinance, parseTable, fiscalEndOf, computeProgress } from '../collect/kabutan-finance.mjs';
import { buildKessanDigest, oku, DIGEST_LIMIT } from '../collect/lib/digest-kessan.mjs';

const html6501 = readFileSync(new URL('./fixtures/kabutan-finance-6501.html', import.meta.url), 'utf8');
const html8058 = readFileSync(new URL('./fixtures/kabutan-finance-8058.html', import.meta.url), 'utf8');

test('日立: 通期業績（実績4期＋予想）と前期比', () => {
  const f = parseFinance(html6501, '6501');
  assert.equal(f.name, '日立製作所');
  const r = f.annual.rows;
  assert.deepEqual(r.map((x) => [x.period, x.forecast]), [['2023.03', false], ['2024.03', false], ['2025.03', false], ['2026.03', false], ['2027.03', true]]);
  assert.deepEqual(r[3], { period: '2026.03', forecast: false, sales: 10586781, operatingProfit: 1199275, ordinaryProfit: 1273109, netProfit: 802368, eps: 176.8, dividend: 50, announced: '26/04/27' });
  assert.equal(r[4].operatingProfit, 1408000);
  assert.equal(r[4].dividend, null);
  assert.deepEqual(f.annual.yoy, { sales: 10.5, operatingProfit: 17.4, ordinaryProfit: 4.9, netProfit: 12.2, eps: 14.4 });
  assert.equal(f.parseErrors, undefined);
});

test('日立: 1Q累計・3か月業績・進捗率（純利益 21.1%、均等ペース25%）', () => {
  const f = parseFinance(html6501, '6501');
  assert.equal(f.cumulative.quarter, 1);
  assert.deepEqual(f.cumulative.rows.at(-1), { period: '26.04-06', forecast: false, sales: 2709586, operatingProfit: 294287, ordinaryProfit: 295109, netProfit: 189450, eps: 42.2, progressH1: null, announced: '26/07/29' });
  assert.deepEqual(f.cumulative.yoy, { sales: 20, operatingProfit: 39.5, ordinaryProfit: 8.5, netProfit: -1.4, eps: 0.5 });
  assert.equal(f.quarterly.rows.length, 8);
  assert.equal(f.quarterly.rows.at(-1).opMargin, 10.9);
  assert.equal(f.quarterly.rows.at(-5).opMargin, 9.3);
  const p = f.progress;
  assert.equal(p.fiscalYear, '2027.03');
  assert.equal(p.pace, 25);
  assert.deepEqual(p.items.map((i) => [i.key, i.pct]), [['sales', 23.2], ['operatingProfit', 20.9], ['ordinaryProfit', 22.1], ['netProfit', 21.1]]);
});

test('日立: 修正履歴（直近は上方）・収益性・財務・CF・PDFリンク', () => {
  const f = parseFinance(html6501, '6501');
  assert.equal(f.revisions.period, '2027.03');
  assert.equal(f.revisions.revised, true);
  assert.deepEqual(f.revisions.history.map((h) => [h.date, h.kind, h.sales, h.netProfit]), [['26/04/27', '初', 11100000, 850000], ['26/07/29', '修', 11700000, 900000]]);
  assert.deepEqual(f.revisions.latest, { date: '26/07/29', kind: '修', sales: 'up', operatingProfit: 'up', ordinaryProfit: 'up', netProfit: 'up' });
  assert.deepEqual(f.profitability.at(-1), { period: '2027.03', forecast: true, opMargin: 12.03, roe: 13.69, roa: 5.98, assetTurnover: 0.78 });
  assert.deepEqual(f.balance.at(-1), { period: '26.04-06', forecast: false, bps: 1470.31, equityRatio: 43.7, totalAssets: 15041410, equity: 6573758, retainedEarnings: 4833670, deRatio: 0.16, announced: '26/07/29' });
  assert.deepEqual(f.cashflow.at(-1), { period: '2026.03', forecast: false, fcf: 1326508, operating: 1668061, investing: -341553, financing: -971037, cash: 1323480, cashRatio: 8.8 });
  assert.equal(f.docs[0].date, '2026-07-29');
  assert.match(f.docs[0].url, /^https:\/\/kabutan\.jp\/disclosures\/pdf\/20260729\//);
  assert.deepEqual(f.missing, ['通期 2027.03予 1株配']);
});

test('三菱商事: 営業益なし（IFRS商社）・予想は純利益のみ・修正なし', () => {
  const f = parseFinance(html8058, '8058');
  assert.equal(f.name, '三菱商事');
  assert.ok(f.annual.rows.every((r) => r.operatingProfit === null));
  assert.ok(f.missing.includes('通期 営業益（株探に掲載なし）'));
  assert.ok(f.missing.includes('通期 2027.03予 売上高'));
  assert.equal(f.revisions.revised, false);
  assert.equal(f.revisions.latest, null);
  assert.ok(!f.missing.some((m) => m.includes('修正方向')));
  const net = f.progress.items.find((i) => i.key === 'netProfit');
  assert.equal(net.pct, 27.1);
  assert.equal(f.progress.items.find((i) => i.key === 'sales').pct, null);
});

test('構造が壊れても表単位で null＋missing', () => {
  const broken = html6501.replace('fin_year_result_d', 'xxx').replace('cashflow_title', 'yyy');
  const f = parseFinance(broken, '6501');
  assert.equal(f.annual, null);
  assert.equal(f.cashflow, null);
  assert.ok(f.missing.includes('通期業績') && f.missing.includes('キャッシュフロー'));
  assert.ok(f.missing.some((m) => m.startsWith('通期予想に対する進捗率')));
  assert.ok(f.quarterly.rows.length > 0);
  const empty = parseFinance('<html></html>', '6501');
  assert.equal(empty.name, null);
  assert.ok(empty.missing.length >= 8);
});

test('補助関数: fiscalEndOf・parseTable・computeProgress', () => {
  assert.equal(fiscalEndOf('26.04-06'), '2027.03');
  assert.equal(fiscalEndOf('26.01-03'), '2026.12');
  assert.equal(fiscalEndOf('2026.03'), null);
  const t = parseTable('<table><thead><tr><th>決算期</th><th>売上高</th></tr></thead><tbody><tr><th>I 予 2027.03</th><td>1,000</td></tr></tbody></table>');
  assert.deepEqual(t.headers, ['決算期', '売上高']);
  assert.equal(t.rows[0].label, '2027.03');
  assert.equal(t.rows[0].forecast, true);
  // 累計の期と予想の期が合わなければ計算しない
  assert.equal(computeProgress({ rows: [{ period: '2027.03', forecast: true, netProfit: 100 }] }, { quarter: 1, rows: [{ period: '25.04-06', netProfit: 10 }] }), null);
  const p = computeProgress({ rows: [{ period: '2027.03', forecast: true, netProfit: 100, sales: null }] }, { quarter: 2, rows: [{ period: '26.04-09', netProfit: 55, sales: 3 }] });
  assert.equal(p.pace, 50);
  assert.equal(p.items.find((i) => i.key === 'netProfit').pct, 55);
  assert.equal(p.items.find((i) => i.key === 'sales').pct, null);
});

test('oku: 百万円→億円（100億円以上は整数、未満は小数1桁）', () => {
  assert.equal(oku(2709586), '27,096');
  assert.equal(oku(-341553), '-3,416');
  assert.equal(oku(1234), '12.3');
  assert.equal(oku(null), '-');
});

test('digest-kessan: 実形式で8KB以内・主要見出し・NaNなし', () => {
  for (const [code, html] of [['6501', html6501], ['8058', html8058]]) {
    const d = buildKessanDigest({ code, fin: parseFinance(html, code) });
    assert.ok(Buffer.byteLength(d) <= DIGEST_LIMIT, `${code}: ${Buffer.byteLength(d)}`);
    for (const h of ['通期業績', '業績予想の修正履歴', '四半期累計', '進捗率', '3か月ごとの業績', '収益性', '財務', 'キャッシュフロー', '決算短信PDF', '取得できなかった項目']) assert.ok(d.includes(h), `${code} ${h}`);
    assert.ok(!/NaN|undefined/.test(d));
  }
  const d = buildKessanDigest({ code: '6501', fin: parseFinance(html6501, '6501') });
  assert.match(d, /最終益: 21\.1%（累計 1,895 \/ 予想 9,000）/);
});

test('digest-kessan: 膨大な入力でも8KB以内・欠損でも書ける', () => {
  const f = parseFinance(html6501, '6501');
  f.quarterly.rows = Array.from({ length: 200 }, (_, i) => ({ ...f.quarterly.rows[0], period: `q${i}` }));
  f.missing = Array.from({ length: 200 }, (_, i) => `未取得${i}`);
  const d = buildKessanDigest({ code: '6501', fin: f });
  assert.ok(Buffer.byteLength(d) <= DIGEST_LIMIT);
  assert.ok(d.includes('q199') && !d.includes('| q0 |'));
  const e = buildKessanDigest({ code: '6501', fin: parseFinance('<html></html>', '6501') });
  assert.match(e, /通期業績\n未取得/);
});
