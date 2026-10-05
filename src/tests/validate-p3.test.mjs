// market・news・hansei・yougo 型の検証（P3a）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateAnalysis, BANNED_WORDS, HANSEI_BANNED_WORDS, SUPPORTED_TYPES, termFileName, placementErrors } from '../tools/validate.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const msgs = (errs) => errs.map((e) => `${e.path}: ${e.message}`).join('\n');
const ng = (a, re) => {
  const e = validateAnalysis(a);
  assert.ok(e.length > 0, '不合格になるはず');
  assert.match(msgs(e), re);
};
const ok = (a) => assert.deepEqual(validateAnalysis(a), [], msgs(validateAnalysis(a)));

test('対応する型は7つ', () => {
  assert.deepEqual(SUPPORTED_TYPES, ['quick', 'chart', 'kessan', 'market', 'news', 'hansei', 'yougo']);
});

for (const t of ['market', 'news', 'hansei', 'yougo']) {
  for (const v of ['sample', 'extreme', 'sparse']) test(`合格: フィクスチャ ${t}-${v}.json`, () => ok(load(`${t}-${v}.json`)));
}

test('上限いっぱいのフィクスチャは +1 文字・+1 件で不合格になる（上限が効いている）', () => {
  const m = load('market-extreme.json');
  m.sections.level.text += 'あ';
  ng(m, /level\.text: 文字数 161 は上限 160 超/);
  const m2 = load('market-extreme.json');
  m2.sections.news.push({ ...m2.sections.news[0] });
  ng(m2, /news: 要素数 6 は上限 5 超/);
  const m3 = load('market-extreme.json');
  m3.sections.calendar.push({ date: '2026-10-20', label: 'x' });
  ng(m3, /calendar: 要素数 6 は上限 5 超/);
  const n = load('news-extreme.json');
  n.sections.event.what += 'あ';
  ng(n, /event\.what: 文字数 161/);
  const n2 = load('news-extreme.json');
  n2.sections.cases.push({ ...n2.sections.cases[0] });
  ng(n2, /cases: 要素数 5 は上限 4 超/);
  const h = load('hansei-extreme.json');
  h.sections.lesson.text += 'あ';
  ng(h, /lesson\.text: 文字数 161/);
  const h2 = load('hansei-extreme.json');
  h2.sections.nextChecks.push({ ...h2.sections.nextChecks[0] });
  ng(h2, /nextChecks: 要素数 6 は上限 5 超/);
  const y = load('yougo-extreme.json');
  y.body += 'あ';
  ng(y, /\$\.body: 文字数 301/);
  const y2 = load('yougo-extreme.json');
  y2.related.push('別の語');
  ng(y2, /related: 要素数 6 は上限 5 超/);
});

test('禁止語は4型すべての文字列に効く', () => {
  const where = {
    market: (a, w) => (a.sections.geo[2].sectors[0].name = w.slice(0, 12)),
    news: (a, w) => (a.sections.takeaway.checks[0] = `${w}か`),
    hansei: (a, w) => (a.sections.nextChecks[1].how = `${w}かを考える`),
    yougo: (a, w) => (a.flow[0].label = w),
  };
  for (const [t, set] of Object.entries(where)) {
    for (const w of BANNED_WORDS) {
      const a = load(`${t}-sample.json`);
      set(a, w);
      ng(a, new RegExp(`禁止語「${w}」`));
    }
  }
});

test('hansei: 反省型だけの断定語', () => {
  for (const w of HANSEI_BANNED_WORDS) {
    const a = load('hansei-sample.json');
    a.sections.improve[0].text = `ここは${w}だった`;
    ng(a, new RegExp(`improve\\[0\\]\\.text: 禁止語「${w}」`));
  }
  // 他の型では反省型の追加語を禁止しない（既存の型の文章を狭めない）
  const n = load('news-sample.json');
  n.sections.takeaway.text = '利確すべきかどうかは人による、という話ではなく出来事の影響を見る';
  ok(n);
});

test('market: code は null・name は「市場」・outlook は bull→base→bear・目安に数値', () => {
  ng({ ...load('market-sample.json'), code: '6501' }, /\$\.code: 型が違います/);
  ng({ ...load('market-sample.json'), name: '日経平均' }, /\$\.name: 値 "日経平均"/);
  const a = load('market-sample.json');
  a.sections.outlook.reverse();
  ng(a, /見通しは bull→base→bear/);
  const b = load('market-sample.json');
  b.sections.outlook[2].target = { label: '大きく下げる' };
  ng(b, /outlook\[2\]\.target: 目安には price か low\/high/);
  b.sections.outlook[2].target = { label: '帯', low: 70000, high: 60000 };
  ng(b, /outlook\[2\]\.target: low\(70000\) が high\(60000\)/);
});

test('market: geo は5件固定・影響の大きい順', () => {
  const a = load('market-sample.json');
  a.sections.geo.pop();
  ng(a, /地政学ランキングは5件固定/);
  const b = load('market-sample.json');
  b.sections.geo[4].level = 5;
  ng(b, /geo\[4\]\.level: 影響の大きい順/);
  const c = load('market-sample.json');
  c.sections.geo[0].sectors = [];
  ng(c, /geo\[0\]\.sectors: 要素数 0/);
  c.sections.geo[0].level = 6;
  ng(c, /geo\[0\]\.level: 6 は最大値 5 超/);
});

test('market: gauges 2〜4件・key 重複・position 0〜1・fx・rates・calendar の順', () => {
  const a = load('market-sample.json');
  a.sections.level.gauges = [a.sections.level.gauges[0]];
  ng(a, /gauges: 要素数 1 は最小 2/);
  const b = load('market-sample.json');
  b.sections.level.gauges[1].key = 'per';
  ng(b, /key が重複しています: per/);
  const c = load('market-sample.json');
  c.sections.level.position = 1.2;
  c.sections.fx.direction = 'down';
  c.sections.fx.effects = [c.sections.fx.effects[0]];
  c.sections.rates.items = [];
  const m = msgs(validateAnalysis(c));
  assert.match(m, /position: 1\.2 は最大値 1 超/);
  assert.match(m, /fx\.direction: 値 "down"/);
  assert.match(m, /effects: 要素数 1 は最小 2/);
  assert.match(m, /rates\.items: 要素数 0 は最小 1/);
  const d = load('market-sample.json');
  d.sections.calendar.reverse();
  ng(d, /予定は日付の古い順/);
  const e = load('market-sample.json');
  e.sections.news[0].url = 'nikkei.com';
  ng(e, /news\[0\]\.url: 形式/);
});

test('news: factors 2〜4件・騰落率と日付の整合', () => {
  const a = load('news-sample.json');
  a.sections.impact.factors = [a.sections.impact.factors[0]];
  ng(a, /長引くかどうかを分ける要因は2〜4件/);
  const b = load('news-sample.json');
  b.sections.reaction.changePct = 5;
  ng(b, /騰落率 5% が from\/to の価格から計算した 3\.06%/);
  const c = load('news-sample.json');
  c.sections.reaction.from.date = '2026-10-05';
  ng(c, /from の日付 2026-10-05 が to の日付/);
  ng(c, /出来事の日 2026-09-08 より後/);
  const d = load('news-sample.json');
  d.sections.event.date = '2026-10-03';
  ng(d, /出来事の日 2026-10-03 が分析日 2026-10-02 より後/);
  const e = load('news-sample.json');
  e.sections.impact.duration = 'forever';
  e.sections.impact.level = 0;
  const m = msgs(validateAnalysis(e));
  assert.match(m, /duration: 値 "forever"/);
  assert.match(m, /impact\.level: 0 は最小値 1 未満/);
});

test('news: 出典のない過去事例には数字を入れない・cases 2〜4件・related の code', () => {
  const a = load('news-sample.json');
  a.sections.cases[0].url = null;
  ng(a, /cases\[0\]\.dropPct: 出典（url）のない事例/);
  a.sections.cases[0] = { ...a.sections.cases[0], dropPct: null, days: null, recoveryMonths: null };
  ok(a);
  const b = load('news-sample.json');
  b.sections.cases = [b.sections.cases[0]];
  ng(b, /cases: 要素数 1 は最小 2/);
  const c = load('news-sample.json');
  c.sections.related[0].code = '65';
  ng(c, /related\[0\]\.code: 形式/);
  c.sections.related[0].code = null;
  ok(c);
  const d = load('news-sample.json');
  d.sections.chart.pins = [];
  ng(d, /pins: 要素数 0 は最小 1/);
});

test('hansei: at は ma25dev→rsi→change3d→volume の4件固定', () => {
  const a = load('hansei-sample.json');
  a.sections.at.reverse();
  ng(a, /買った日の過熱の物差しは ma25dev→rsi→change3d→volume/);
  const b = load('hansei-sample.json');
  b.sections.at.pop();
  ng(b, /at: 要素数 3 は最小 4/);
});

test('hansei: 日付と損益の整合', () => {
  const a = load('hansei-sample.json');
  a.sections.result.maxUpPct = -5;
  ng(a, /最大含み益 -5% が現在の損益率 -1\.39%/);
  const b = load('hansei-sample.json');
  b.sections.result.maxDownPct = 0;
  ng(b, /最大含み損 0% が現在の損益率/);
  const c = load('hansei-sample.json');
  c.sections.entry.date = '2026-10-05';
  ng(c, /購入日 2026-10-05 が最終取引日 2026-10-02 より後/);
  const d = load('hansei-sample.json');
  d.sections.result.maxUpDate = null;
  ng(d, /maxUpPct と maxUpDate は両方そろえる/);
  const e = load('hansei-sample.json');
  e.sections.result.maxDownDate = '2026-08-28';
  ng(e, /maxDownDate: 2026-08-28 が購入日より後〜最終取引日の範囲外/);
  const f = load('hansei-sample.json');
  f.sections.entry.price = 0;
  ng(f, /購入価格は0より大きい数/);
  const g = load('hansei-sample.json');
  g.sections.result.days = 1.5;
  ng(g, /result\.days: 型が違います/);
});

test('hansei: 件数（good 0〜3・improve 1〜3・alt 0〜2・nextChecks 3〜5）と low<=high', () => {
  const a = load('hansei-sample.json');
  a.sections.improve = [];
  a.sections.nextChecks = a.sections.nextChecks.slice(0, 2);
  a.sections.alt = [a.sections.alt[0], a.sections.alt[0], a.sections.alt[0]];
  const m = msgs(validateAnalysis(a));
  assert.match(m, /improve: 要素数 0 は最小 1/);
  assert.match(m, /nextChecks: 要素数 2 は最小 3/);
  assert.match(m, /alt: 要素数 3 は上限 2/);
  const b = load('hansei-sample.json');
  b.sections.alt[0].zone = { low: 5400, high: 5300 };
  ng(b, /alt\[0\]\.zone: low\(5400\) が high\(5300\)/);
  const c = load('hansei-sample.json');
  c.sections.chart.levels[0] = { ...c.sections.chart.levels[0], low: 5700, high: 5600 };
  ng(c, /chart\.levels\[0\]: low\(5700\)/);
  const d = load('hansei-sample.json');
  d.sections.position.support.price = 6000;
  ng(d, /support\(6000\) が resistance\(5830\) より上/);
});

test('yougo: 骨格は kabu-term@1・flow 2〜5件・sources 任意・related に自分を入れない', () => {
  ng({ ...load('yougo-sample.json'), schema: 'kabu-analysis@1' }, /\$\.schema: 値 "kabu-analysis@1"/);
  const a = load('yougo-sample.json');
  a.flow = [a.flow[0]];
  ng(a, /因果の流れ図は2〜5件/);
  a.flow = [...Array(6)].map(() => ({ label: '矢印', dir: 'up' }));
  ng(a, /flow: 要素数 6 は上限 5/);
  const b = load('yougo-sample.json');
  delete b.sources;
  delete b.reading;
  delete b.seesaw;
  delete b.related;
  ok(b);
  b.sources = [];
  ok(b);
  const c = load('yougo-sample.json');
  c.related = ['金利と株価', 'PER', 'PER'];
  const m = msgs(validateAnalysis(c));
  assert.match(m, /関連語に用語自身/);
  assert.match(m, /関連語が重複しています: PER/);
  const d = load('yougo-sample.json');
  d.category = '経済';
  d.flow[0].dir = 'sideways';
  delete d.pitfall;
  const m2 = msgs(validateAnalysis(d));
  assert.match(m2, /category: 値 "経済"/);
  assert.match(m2, /flow\[0\]\.dir/);
  assert.match(m2, /必須キー "pitfall"/);
});

test('termFileName: / \\ : * ? " < > | と空白を _ に置換', () => {
  assert.equal(termFileName('金利と株価'), '金利と株価');
  assert.equal(termFileName('PER / PBR'), 'PER___PBR');
  assert.equal(termFileName('a\\b:c*d?e"f<g>h|i\tj　k'), 'a_b_c_d_e_f_g_h_i_j_k');
});

test('置き場所の検査: analyses の型・market のファイル名・glossary のファイル名', () => {
  const n = load('news-sample.json');
  assert.deepEqual(placementErrors('/x/data/stocks/6501/analyses/2026-10-02-news.json', n), []);
  assert.match(msgs(placementErrors('/x/data/stocks/6501/analyses/2026-10-02-quick.json', n)), /ファイル名の型「quick」と中身の type「news」/);
  const m = load('market-sample.json');
  assert.deepEqual(placementErrors('/x/data/market/2026-10-02.json', m), []);
  assert.match(msgs(placementErrors('/x/data/market/2026-10-02-market.json', m)), /<日付>\.json（実行日）/);
  assert.match(msgs(placementErrors('/x/data/stocks/6501/analyses/2026-10-02-market.json', m)), /analyses\/ ではなく data\/market/);
  const y = load('yougo-sample.json');
  assert.deepEqual(placementErrors('/x/data/glossary/金利と株価.json', y), []);
  assert.match(msgs(placementErrors('/x/data/glossary/kinri.json', y)), /金利と株価\.json にしてください/);
  // フィクスチャなど data の外は対象外
  assert.deepEqual(placementErrors('/x/tests/fixtures/yougo-sample.json', y), []);
});

test('CLI: 用語のファイル名違いは exit 1、正しい名前なら OK', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kabu-val-'));
  try {
    mkdirSync(join(dir, 'glossary'));
    const y = load('yougo-sample.json');
    writeFileSync(join(dir, 'glossary', 'wrong.json'), JSON.stringify(y));
    writeFileSync(join(dir, 'glossary', '金利と株価.json'), JSON.stringify(y));
    const bad = spawnSync(process.execPath, [join(ROOT, 'tools/validate.mjs'), join(dir, 'glossary', 'wrong.json')], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /金利と株価\.json にしてください/);
    const good = spawnSync(process.execPath, [join(ROOT, 'tools/validate.mjs'), join(dir, 'glossary', '金利と株価.json')], { encoding: 'utf8' });
    assert.equal(good.status, 0, good.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
