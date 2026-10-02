import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKabutan, parseNum, parseMarketCap } from '../collect/kabutan.mjs';

const html = readFileSync(new URL('./fixtures/kabutan-6501.html', import.meta.url), 'utf8');

test('parseNum: 全角・カンマ・単位・ダッシュ', () => {
  assert.equal(parseNum('27.3<span class="fs9">倍</span>'), 27.3);
  assert.equal(parseNum('３，５１８．８'), 3518.8);
  assert.equal(parseNum('<span class="up">+0.22</span>%'), 0.22);
  assert.equal(parseNum('−12'), -12);
  assert.equal(parseNum('－<span>％</span>'), null);
  assert.equal(parseNum(''), null);
});

test('parseMarketCap: 兆・億の表記', () => {
  assert.deepEqual(parseMarketCap('24<span>兆</span>9,909<span>億円</span>'), { yen: 24990900000000, text: '24兆9,909億円' });
  assert.deepEqual(parseMarketCap('2,396億円'), { yen: 239600000000, text: '2,396億円' });
  assert.equal(parseMarketCap('－'), null);
});

test('固定HTML（日立 2026-10-02）から基本情報を抽出', () => {
  const p = parseKabutan(html, '6501');
  assert.equal(p.name, '日立製作所');
  assert.equal(p.market, '東証プライム');
  assert.equal(p.industry, '電気機器');
  assert.deepEqual(p.tags, ['貸借', '225']);
  assert.equal(p.price, 5522);
  assert.equal(p.change, 12);
  assert.equal(p.changePct, 0.22);
  assert.equal(p.per, 27.3);
  assert.equal(p.pbr, 3.74);
  assert.equal(p.psr, 2.1);
  assert.equal(p.yield, null);
  assert.equal(p.marginRatio, 7.56);
  assert.deepEqual(p.marketCap, { yen: 25045400000000, text: '25兆454億円' });
  assert.equal(p.unitShares, 100);
  assert.equal(p.minPurchase, 552200);
  assert.equal(p.margin.length, 5);
  assert.deepEqual(p.margin[0], { date: '2026-08-28', sell: 703.6, buy: 3824.2, ratio: 5.44 });
  assert.deepEqual(p.margin.at(-1), { date: '2026-09-25', sell: 465.5, buy: 3518.8, ratio: 7.56 });
  const rows = p.performance.rows;
  assert.deepEqual(rows.map((r) => [r.period, r.forecast, r.sales, r.netProfit, r.eps, r.dividend]), [
    ['2025.03', false, 97833, 6157, 133.9, 43],
    ['2026.03', false, 105867, 8023, 176.8, 50],
    ['2027.03', true, 117000, 9000, 202.2, null],
  ]);
  assert.equal(rows[0].ordinaryProfit, 9627);
  assert.equal(p.themes.length, 10);
  assert.equal(p.themes[0], 'TOPIXコア30');
  assert.ok(p.missing.includes('利回り'));
  assert.ok(p.missing.some((m) => m.includes('2027.03予 1株配')));
  assert.equal(p.parseErrors, undefined);
});

test('構造が壊れても項目単位で null になり全体は落ちない', () => {
  const broken = html.replace(/<div id="stockinfo_i3">[\s\S]*?stockinfo_i3-->/, '').replace('class="gyouseki_block"', 'class="xxx"');
  const p = parseKabutan(broken, '6501');
  assert.equal(p.name, '日立製作所');
  assert.equal(p.per, null);
  assert.equal(p.performance, null);
  assert.ok(p.missing.includes('PER') && p.missing.includes('業績推移'));
  assert.ok(p.margin.length === 5);
  const empty = parseKabutan('<html></html>', '6501');
  assert.equal(empty.name, null);
  assert.ok(empty.missing.length > 10);
});
