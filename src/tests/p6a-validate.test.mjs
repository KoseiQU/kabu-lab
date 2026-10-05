// P6a（§5.10）: 市場型の任意欄 sectorNote・themes のスキーマと意味検証、市場型の断定語
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { validateAnalysis, validateFile, MARKET_BANNED_WORDS, SECTOR_KEYS } from '../tools/validate.mjs';

const fx = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const msgs = (a) => validateAnalysis(a).map((e) => `${e.path}: ${e.message}`);

test('フィクスチャ: sample（追い風3・向かい風2）と extreme（6件×3銘柄・上限いっぱい）は合格、sparse は themes なしで合格', () => {
  const s = fx('market-sample.json'), x = fx('market-extreme.json'), p = fx('market-sparse.json');
  assert.deepEqual(msgs(s), []);
  assert.deepEqual(msgs(x), []);
  assert.deepEqual(msgs(p), []);
  assert.deepEqual(s.sections.themes.map((t) => t.dir), ['tailwind', 'tailwind', 'tailwind', 'headwind', 'headwind']);
  assert.ok(s.sections.themes.every((t) => t.stocks.length >= 1 && t.stocks.length <= 3));
  assert.equal(x.sections.themes.length, 6);
  assert.ok(x.sections.themes.every((t) => t.stocks.length === 3 && [...t.name].length === 16 && [...t.reason].length === 120 && [...t.breakIf].length === 80));
  assert.equal([...x.sections.sectorNote].length, 160);
  assert.ok(!('themes' in p.sections) && !('sectorNote' in p.sections));
});

test('実データの市場分析（themes なし）は今の検証でも合格', () => {
  const dir = new URL('../../data/market/', import.meta.url);
  const files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  assert.ok(files.length >= 1);
  for (const f of files) assert.deepEqual(validateFile(new URL(f, dir).pathname), [], f);
});

test('themes: 件数（3〜6）・追い風2件以上・向かい風1件以上', () => {
  const a = fx('market-sample.json');
  const b = clone(a); b.sections.themes = b.sections.themes.slice(0, 2);
  assert.ok(msgs(b).some((m) => /要素数 2 は最小 3 未満/.test(m)));
  const c = clone(a); c.sections.themes.forEach((t) => { t.dir = 'tailwind'; });
  assert.ok(msgs(c).some((m) => /向かい風（headwind）は1件以上/.test(m)));
  const d = clone(a); d.sections.themes.forEach((t, i) => { t.dir = i === 0 ? 'tailwind' : 'headwind'; });
  assert.ok(msgs(d).some((m) => /追い風（tailwind）は2件以上/.test(m)));
  const e = clone(a); e.sections.themes.push(...clone(a.sections.themes).slice(0, 2)); e.sections.themes.forEach((t) => { t.stocks = []; });
  assert.ok(msgs(e).some((m) => /要素数 7 は上限 6 超/.test(m)));
});

test('themes: sectorKey は "1617"〜"1633" の文字列か null', () => {
  const a = fx('market-sample.json');
  assert.equal(SECTOR_KEYS.length, 17);
  for (const [k, ok] of [[null, true], ['1617', true], ['1633', true], ['1616', false], ['1634', false], [1625, false], ['', false]]) {
    const b = clone(a); b.sections.themes[0].sectorKey = k;
    assert.equal(msgs(b).length === 0, ok, `${JSON.stringify(k)}: ${msgs(b).join(' / ')}`);
  }
  const c = clone(a); delete c.sections.themes[0].sectorKey;
  assert.ok(msgs(c).some((m) => /必須キー "sectorKey"/.test(m)));
});

test('themes: 銘柄コードの形・ETFコードの混入・同じ themes 内の重複・各字数と件数', () => {
  const a = fx('market-sample.json');
  const b = clone(a); b.sections.themes[0].stocks[0].code = '86';
  assert.ok(msgs(b).some((m) => /stocks\[0\]\.code.*銘柄コードの形ではありません/.test(m)));
  const c = clone(a); c.sections.themes[3].stocks[0].code = a.sections.themes[0].stocks[1].code;
  assert.ok(msgs(c).some((m) => /6857 が themes の中で重複/.test(m)));
  const d = clone(a); d.sections.themes[1].stocks[0].code = '1625';
  assert.ok(msgs(d).some((m) => /業種別ETFのコード/.test(m)));
  const e = clone(a); e.sections.themes[0].stocks.push({ code: '6920', name: 'レーザーテック', why: '検査装置' });
  assert.ok(msgs(e).some((m) => /stocks: 要素数 4 は上限 3 超/.test(m)));
  const f = clone(a); f.sections.themes[0].name = 'あ'.repeat(17); f.sections.themes[0].stocks[0].why = 'い'.repeat(61); f.sections.sectorNote = 'う'.repeat(161);
  const m = msgs(f);
  assert.ok(m.some((x) => /themes\[0\]\.name: 文字数 17/.test(x)) && m.some((x) => /why: 文字数 61/.test(x)) && m.some((x) => /sectorNote: 文字数 161/.test(x)), m.join('\n'));
  const g = clone(a); g.sections.themes[0].horizon = 'long'; g.sections.themes[1].dir = 'up';
  assert.equal(msgs(g).filter((x) => /許可されていません/.test(x)).length, 2);
  // 130A のような英字入りコードは通る
  const h = clone(a); h.sections.themes[0].stocks[0].code = '130A';
  assert.deepEqual(msgs(h), []);
});

test('市場型の断定語: themes の全文字列（理由・候補の一言・崩れる条件）と sectorNote にも効く。既存の禁止語も', () => {
  const a = fx('market-sample.json');
  for (const w of ['おすすめ銘柄', '推奨銘柄', '必ず上がる', '確実に上がる', '買い推奨']) {
    assert.ok(MARKET_BANNED_WORDS.includes(w) || w === '買い推奨', w);
    for (const put of [(b) => { b.sections.themes[0].reason += w; }, (b) => { b.sections.themes[2].stocks[0].why = w; }, (b) => { b.sections.themes[4].breakIf = w; }, (b) => { b.sections.sectorNote = w; }]) {
      const b = clone(a); put(b);
      const m = msgs(b);
      assert.equal(m.filter((x) => x.includes(`禁止語「${w}」`)).length, 1, `${w}: ${m.join(' / ')}`);
    }
  }
  // 打ち消しが続く注意の文は断定ではない（「必ず上がるとは限らない」）。同じ文に断定が別にあれば数える
  const n = clone(a); n.sections.themes[0].breakIf = '防衛予算が増えても株価が必ず上がるとは限らない'; n.sections.sectorNote = '確実に上がるわけではない';
  assert.deepEqual(msgs(n), []);
  const n2 = clone(a); n2.sections.sectorNote = '必ず上がるとは限らないが、必ず上がる';
  assert.equal(msgs(n2).length, 1);
  // 市場型以外には市場型の語は効かない（クイック診断は従来どおり）
  const q = fx('realistic-quick.json');
  const r = clone(q); r.insight = '必ず上がるとは限らない';
  assert.ok(!validateAnalysis(r).some((e) => /必ず上がる/.test(e.message)));
});
