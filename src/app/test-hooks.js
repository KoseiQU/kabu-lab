/* KABU LAB — test-hooks.js
   画面の機械テスト。window.__KABU_TEST.runAll() で全銘柄×全分析（＋未実行タブ・ホーム）を順に描画して検査し、
   {pass, fail, failures:[...], pages} を返す。実行後は元のハッシュ・データ・状態へ戻す。
   フィクスチャ（tests/fixtures/sparse-quick.json・realistic-quick.json）は runAll({fixture}) か inject(fixture) で注入する（配列で複数可）。 */
(function () {
  'use strict';
  const BAD = /NaN|undefined|Infinity/;
  const BANNED = ['買い推奨', '売り推奨', '買うべき', '売るべき', '今が買い', '今が売り'];
  const SVG_ATTRS = ['d', 'points', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'transform', 'viewBox', 'style'];
  const QUICK_SECS = ['price', 'diagnosis', 'valuation', 'performance', 'segments', 'scenarios', 'margin', 'checklist', 'review', 'notes'];
  const ABSENT_SECS = ['diagnosis', 'performance', 'valuation', 'segments', 'scenarios', 'margin', 'checklist'];
  const CHART_SECS = ['timeframes', 'lvchart', 'levels', 'heat', 'checklist', 'plans', 'lesson', 'notes'];
  const MARKET_SECS = ['mkchart', 'level', 'mkind', 'outlook', 'fx', 'rates', 'geo', 'calendar', 'news', 'headlines', 'notes'];
  const MARKET_RAW_SECS = ['mkchart', 'mkind', 'standby', 'headlines'];
  const NEWS_SECS = ['event', 'impact', 'nchart', 'reaction', 'factors', 'cases', 'related', 'takeaway', 'notes'];
  const HANSEI_SECS = ['hchart', 'result', 'position', 'at', 'goodimprove', 'alt', 'nextChecks', 'lesson', 'notes'];
  /** 市場ページで表示している分析（日付指定が無ければ最新） */
  function marketAnalysis(D, route) {
    const list = ((D.market && D.market.analyses) || []).filter((x) => x && x.type === 'market');
    return (route.date && list.find((x) => x.date === route.date)) || list[0] || null;
  }
  function kessanSecs(a) {
    const s = a.sections || {}, A = app();
    const out = ['verdict', 'points', 'results', 'progress', 'margin', 'outlook', 'plusminus', 'invest', 'finance', 'returns', 'next', 'notes'];
    if (!A.secAbsent(a, 'segments') || A.missFor(a, 'segments')) out.push('segments');
    out.push(s.deep && typeof s.deep === 'object' ? 'deep' : 'deep-guide');
    return out;
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const app = () => window.__KABU_APP;
  let backup = null;

  const prevDay = (d) => { const t = new Date(String(d) + 'T00:00:00Z'); if (isNaN(t)) return String(d) + 'x'; t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
  /** 分析JSONを1本そのまま注入（chart・kessan のフィクスチャ）。同じ型・同じ日付があれば日付を1日ずつ前へずらす（履歴の切替も検査できる） */
  function addAnalysis(target, an, opt = {}) {
    const a = clone(an);
    if (a.type === 'market') { // 市場の分析は market.analyses へ（同じ日付があれば1日ずつ前へずらす）
      target.market = target.market && typeof target.market === 'object' ? target.market : { raw: null, analysis: null, analyses: [], series: null };
      const list = Array.isArray(target.market.analyses) ? target.market.analyses : [];
      let d = a.date;
      while (list.some((x) => x && x.date === d)) d = prevDay(d);
      a.date = d; a._file = opt.file || 'tests/fixtures';
      target.market.analyses = [...list, a].sort((x, y) => String(y.date).localeCompare(String(x.date)));
      target.market.analysis = target.market.analyses[0];
      return { view: 'market', date: d };
    }
    const code = opt.code || a.code;
    let st = target.stocks[code];
    if (!st) {
      st = { code, name: opt.name || a.name || code, profile: null, prices: null, indicators: null, finance: null, analyses: [] };
      target.stocks[code] = st;
    }
    st.analyses = Array.isArray(st.analyses) ? st.analyses : [];
    let d = a.date;
    while (st.analyses.some((x) => x && x.type === a.type && x.date === d)) d = prevDay(d);
    a.date = d; a.code = code; a._file = opt.file || 'tests/fixtures';
    st.analyses = [...st.analyses, a].sort((x, y) => String(y.date).localeCompare(String(x.date)));
    return { view: 'stock', code, type: a.type, date: d };
  }
  const isAnalysis = (fx) => fx && typeof fx === 'object' && fx.schema === 'kabu-analysis@1' && typeof fx.type === 'string';
  /** P2 のフィクスチャは、本来の銘柄に加えて「株価・指標・決算データなし」の検査用銘柄 9998 にも注入する（画面側の欠損処理の確認） */
  /** 3点読み（deep）の無い決算フィクスチャから、数値の目標・実績・予想を持つ検査用の deep を作る（ブレットチャートの検査用。画面の確認専用） */
  function withDeep(fx) {
    const a = clone(fx);
    a.sections.deep = {
      yuho: { earner: '検査用：稼ぎ頭の説明', dragger: '検査用：足を引っ張る事業の説明', oneOff: '検査用：一時的な要因の説明', risks: ['検査用のリスク1', '検査用のリスク2'] },
      plan: { name: '検査用の中期経営計画', goal: '検査用：目指す姿', targets: [
        { label: '売上（兆円）', target: 12, actual: 10.6, forecast: 11.7 },
        { label: '利益率（%）', target: 15, actual: 11.3, forecast: 12 },
        { label: '純利益（億円・赤字あり）', target: 500, actual: -120, forecast: 80 },
        { label: '全同値', target: 5, actual: 5, forecast: 5 },
        { label: '文字の目標', target: '業界トップ', actual: null, forecast: null },
        { label: '範囲の目標（%）', target: '7〜9%', actual: '+8%', forecast: '+11%', unit: '%', nums: { targetLow: 7, targetHigh: 9, actual: 8, forecast: 11 } },
      ], consistent: '検査用：一致の説明', realistic: '検査用：現実的かの説明' },
    };
    return a;
  }
  /* ---------- P3c：用語・ノート・答え合わせの注入（build.mjs と同じ規則。画面の確認専用） ---------- */
  const isTerm = (fx) => fx && typeof fx === 'object' && fx.schema === 'kabu-term@1' && fx.type === 'yougo' && typeof fx.term === 'string';
  /** 用語型1語を用語帳へ（同じ語があれば定義を上書きし、詳しい解説つきにする） */
  function addTerm(target, y) {
    target.glossary = Array.isArray(target.glossary) ? target.glossary : [];
    const { schema, type, ...body } = clone(y);
    void schema; void type;
    const i = target.glossary.findIndex((g) => g && g.term === y.term);
    const prev = i >= 0 ? target.glossary[i] : { firstCode: null, firstName: null, firstDate: y.addedAt || null, firstType: 'yougo' };
    const e = { ...prev, term: y.term, def: y.def, category: y.category || null, detail: { ...body, _file: 'tests/fixtures' } };
    if (i >= 0) target.glossary[i] = e; else target.glossary.push(e);
    target.glossary.sort((a, b) => a.term.localeCompare(b.term, 'ja'));
    return { view: 'glossary', term: y.term };
  }
  const isN = (x) => typeof x === 'number' && Number.isFinite(x);
  /** build.mjs の buildReview と同じ計算（フィクスチャ用。node のテストで一致を確かめている） */
  function buildReview(a, kind, scenarios, rows) {
    const baseDate = (a.price && a.price.asOf) || a.date;
    const after = (rows || []).filter((r) => r && r.d > baseDate && isN(r.c)).map((r) => ({ d: r.d, c: r.c }));
    const targets = (Array.isArray(scenarios) ? scenarios : []).map((x) => {
      const t = (x && x.target) || {};
      return { kind: (x && x.kind) || null, label: t.label || '', ...(isN(t.price) ? { price: t.price } : {}), ...(isN(t.low) && isN(t.high) ? { low: t.low, high: t.high } : {}), breakIf: (x && x.breakIf) || '' };
    });
    const latest = after.length ? after[after.length - 1] : null;
    let nearest = null;
    if (latest) {
      targets.forEach((t) => {
        let dist = null;
        if (isN(t.low) && isN(t.high)) dist = latest.c >= t.low && latest.c <= t.high ? 0 : Math.min(Math.abs(latest.c - t.low) / t.low, Math.abs(latest.c - t.high) / t.high) * 100;
        else if (isN(t.price) && t.price > 0) dist = (Math.abs(latest.c - t.price) / t.price) * 100;
        if (dist != null && (!nearest || dist < nearest.distPct)) nearest = { kind: t.kind, distPct: Math.round(dist * 100) / 100 };
      });
    }
    return { kind, code: a.code || null, name: a.name, type: a.type, date: a.date, file: a._file || null, base: { price: a.price && isN(a.price.close) ? a.price.close : null, date: baseDate }, targets, after, days: after.length, young: after.length < 5, latest, nearest };
  }
  /** 注入した分析1本ぶんの用語・ノート・答え合わせを足す */
  function deriveFrom(target, a) {
    target.glossary = Array.isArray(target.glossary) ? target.glossary : [];
    (a.terms || []).forEach((t) => { if (t && t.term && !target.glossary.some((g) => g && g.term === t.term)) target.glossary.push({ term: t.term, def: t.def, firstCode: a.code || null, firstName: a.name, firstDate: a.date, firstType: a.type, category: null, detail: null }); });
    target.glossary.sort((x, y) => x.term.localeCompare(y.term, 'ja'));
    target.notes = Array.isArray(target.notes) ? target.notes : [];
    const base = { date: a.date, code: a.type === 'market' ? null : a.code || null, name: a.name, type: a.type };
    if (a.insight) target.notes.push({ ...base, kind: 'insight', text: a.insight });
    const ls = a.sections && a.sections.lesson;
    if ((a.type === 'chart' || a.type === 'hansei') && ls && ls.text) target.notes.push({ ...base, kind: 'lesson', title: ls.title || '', text: ls.text });
    if (a.type === 'hansei') ((a.sections && a.sections.nextChecks) || []).forEach((c) => { if (c && (c.how || c.label)) target.notes.push({ ...base, kind: 'nextCheck', title: c.label || '', text: c.how || '' }); });
    target.notes.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
    target.review = Array.isArray(target.review) ? target.review.filter((r) => !(r && r.date === a.date && (a.type === 'market' ? r.kind === 'market' : r.kind === 'stock' && r.code === a.code))) : [];
    if (a.type === 'quick') { const st = target.stocks[a.code]; target.review.push(buildReview(a, 'stock', a.sections && a.sections.scenarios, ((st && st.prices && st.prices.rows) || []).filter((r) => r && isN(r.c)))); }
    if (a.type === 'market') { const nk = (((target.market || {}).series || {}).series || {})['^N225']; target.review.push(buildReview(a, 'market', a.sections && a.sections.outlook, (nk && nk.rows) || [])); }
    target.review.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
  }
  /** 合成の日足（営業日だけ。o/h/l/c/v つき） */
  function synthRows(n, end, start, drift) {
    const out = [];
    const t = new Date(end + 'T00:00:00Z');
    while (out.length < n) { if (t.getUTCDay() !== 0 && t.getUTCDay() !== 6) out.push(t.toISOString().slice(0, 10)); t.setUTCDate(t.getUTCDate() - 1); }
    out.reverse();
    return out.map((d, i) => { const c = Math.round((start + i * drift + Math.sin(i / 6) * start * 0.03) * 10) / 10; return { d, o: c - 5, h: c + start * 0.01, l: c - start * 0.012, c, v: 1000000 + (i % 7) * 120000 }; });
  }
  /**
   * 答え合わせの検査用の銘柄 9990（合成の日足）とクイック診断5本：
   * after が0本・1本（日が浅い）・7本（線と帯の目安）・帯の中（距離0）・60本で目安が極端に遠い（端に寄せる）。
   * 市場の分析があれば、同じく after 7本・極端に遠い目安の2本を足す。中身は既存のクイック診断を写して作る（画面の確認専用）
   */
  function addReviewCases(target) {
    const routes = [];
    let tpl = null;
    Object.values(target.stocks || {}).some((st) => (st.analyses || []).some((x) => { if (x && x.type === 'quick' && x.sections && Array.isArray(x.sections.scenarios)) { tpl = x; return true; } return false; }));
    if (!tpl) return routes;
    const rows = synthRows(300, '2026-10-02', 2000, 1.2);
    const st = { code: '9990', name: '検査用（答え合わせ）', profile: null, prices: { rows: rows.slice(-250) }, indicators: null, finance: null, analyses: [] };
    target.stocks['9990'] = st;
    const L = rows.length;
    const mk = (back, sc) => {
      const r = rows[L - 1 - back];
      const a = clone(tpl);
      a.code = '9990'; a.name = st.name; a.date = r.d; a._file = 'tests/fixtures/review';
      a.price = { close: r.c, change: 3, changePct: 0.1, asOf: r.d };
      a.sections.scenarios = sc(r.c);
      a.insight = `答え合わせの検査（${back}営業日前の分析）`;
      st.analyses.push(a);
      routes.push({ view: 'stock', code: '9990', type: 'quick', date: r.d });
      return a;
    };
    const S3 = (p) => [
      { kind: 'bull', title: '強気', text: '検査用', target: p.bull, breakIf: '検査用：強気が崩れる条件' },
      { kind: 'base', title: '中立', text: '検査用', target: p.base, breakIf: '検査用：中立が崩れる条件' },
      { kind: 'bear', title: '弱気', text: '検査用', target: p.bear, breakIf: '検査用：弱気が崩れる条件' },
    ];
    mk(0, (c) => S3({ bull: { label: `${c + 200}円`, price: c + 200 }, base: { label: 'レンジ', low: c - 50, high: c + 50 }, bear: { label: `${c - 200}円`, price: c - 200 } }));
    mk(1, (c) => S3({ bull: { label: `${c + 120}円`, price: c + 120 }, base: { label: 'レンジ', low: c - 40, high: c + 40 }, bear: { label: `${c - 150}円`, price: c - 150 } }));
    mk(7, (c) => S3({ bull: { label: `${Math.round(c * 1.05)}円`, price: Math.round(c * 1.05) }, base: { label: 'レンジ', low: Math.round(c * 0.98), high: Math.round(c * 1.02) }, bear: { label: `${Math.round(c * 0.95)}円`, price: Math.round(c * 0.95) } }));
    mk(20, (c) => S3({ bull: { label: '帯の目安', low: Math.round(c * 0.9), high: Math.round(c * 1.3) }, base: { label: '帯', low: Math.round(c * 0.97), high: Math.round(c * 1.01) }, bear: { label: '下の帯', low: Math.round(c * 0.7), high: Math.round(c * 0.8) } }));
    mk(60, (c) => S3({ bull: { label: '極端に遠い目安', price: Math.round(c * 4.2) }, base: { label: '片側だけ遠い帯', low: Math.round(c * 1.01), high: Math.round(c * 3.5) }, bear: { label: '極端に遠い目安', price: Math.round(c * 0.08 * 10) / 10 } }));
    st.analyses.sort((x, y) => String(y.date).localeCompare(String(x.date)));
    st.analyses.forEach((a) => deriveFrom(target, a));
    const M = target.market, nk = M && M.series && M.series.series && M.series.series['^N225'];
    const mtpl = M && (M.analyses || []).find((x) => x && x.type === 'market' && x.sections && Array.isArray(x.sections.outlook));
    if (nk && (nk.rows || []).length > 40 && mtpl) {
      const nr = nk.rows.filter((r) => r && isN(r.c));
      [[7, 1.05, 0.97, 1.02, 0.95], [30, 3, 1.01, 2.5, 0.1]].forEach(([back, bu, lo, hi, be]) => {
        const r = nr[nr.length - 1 - back], a = clone(mtpl);
        a.date = r.d; a._file = 'tests/fixtures/review';
        a.price = { close: r.c, change: 10, changePct: 0.1, asOf: r.d };
        a.sections.outlook = [
          { kind: 'bull', title: '強気', text: '検査用', target: { label: '検査用', price: Math.round(r.c * bu) }, breakIf: '検査用' },
          { kind: 'base', title: '中立', text: '検査用', target: { label: '検査用', low: Math.round(r.c * lo), high: Math.round(r.c * hi) }, breakIf: '検査用' },
          { kind: 'bear', title: '弱気', text: '検査用', target: { label: '検査用', price: Math.round(r.c * be) }, breakIf: '検査用' },
        ];
        if (!M.analyses.some((x) => x && x.date === a.date)) { M.analyses.push(a); deriveFrom(target, a); routes.push({ view: 'market', date: a.date }); }
      });
      M.analyses.sort((x, y) => String(y.date).localeCompare(String(x.date)));
      M.analysis = M.analyses[0];
    }
    return routes;
  }
  /** 用語・ノートの水増し（100件規模の極端値：20字の用語・80字の定義・5箱×16字の流れ図） */
  function addBulk(target) {
    target.glossary = Array.isArray(target.glossary) ? target.glossary : [];
    const cats = ['指標', 'チャート', '決算', '需給', 'マクロ', '制度', 'その他', null];
    const T20 = '長い用語の検査長い用語の検査長い用語の', D80 = '定義の長さの検査。'.repeat(9).slice(0, 80), L16 = '流れの箱の長さの検査流れの箱の長さ';
    for (let i = 0; i < 100; i++) {
      const term = (i % 10 === 0 ? T20.slice(0, 17) : '検査用語') + String(i).padStart(3, '0');
      const det = i % 4 === 0;
      target.glossary.push({ term, def: i % 3 === 0 ? D80 : `検査用の定義 ${i}`, firstCode: i % 5 === 0 ? null : '9990', firstName: '検査用（答え合わせ）', firstDate: '2026-09-01', firstType: i % 5 === 0 ? 'yougo' : 'quick', category: cats[i % cats.length],
        detail: det ? { reading: 'けんさ', body: '本文の検査。'.repeat(40).slice(0, 300), analogy: 'たとえの検査。'.repeat(17).slice(0, 120), flow: [0, 1, 2, 3, 4].map((k) => ({ label: L16.slice(0, 16), dir: ['up', 'down', 'none'][k % 3] })), example: '例の検査 1,234円。'.repeat(12).slice(0, 160), stockLink: '関係の検査。'.repeat(27).slice(0, 160), pitfall: '誤解の検査。'.repeat(20).slice(0, 120), related: ['PER', '存在しない語の検査', term], addedAt: '2026-09-01', sources: [] } : null });
    }
    target.glossary.sort((a, b) => a.term.localeCompare(b.term, 'ja'));
    target.notes = Array.isArray(target.notes) ? target.notes : [];
    const kinds = ['insight', 'lesson', 'nextCheck'], types = ['quick', 'chart', 'hansei', 'kessan', 'news', 'market'];
    for (let i = 0; i < 100; i++) {
      const ty = types[i % types.length], d = `2026-0${1 + (i % 9)}-${String(1 + (i % 27)).padStart(2, '0')}`;
      target.notes.push({ date: d, code: ty === 'market' ? null : ['9990', '6501', '8001', '7013'][i % 4], name: ty === 'market' ? '市場' : '検査用の銘柄名', type: ty, kind: kinds[i % 3], title: i % 3 ? `検査の見出し${i}` : '', text: '気づきの長文の検査。'.repeat(1 + (i % 12)) });
    }
    target.notes.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
    return [{ view: 'glossary', term: null }, { view: 'notes' }];
  }

  function addAll(target, list, bare) {
    const routes = [];
    const kd = list.find((fx) => isAnalysis(fx) && fx.type === 'kessan' && !(fx.sections && fx.sections.deep));
    if (bare && kd) routes.push(addAnalysis(target, withDeep(kd), { code: '9998', name: '検査用（株価・指標なし）' }));
    const derive = (r) => { const a = r.view === 'market' ? target.market.analyses.find((x) => x.date === r.date) : (target.stocks[r.code].analyses || []).find((x) => x.type === r.type && x.date === r.date); if (a) deriveFrom(target, a); return r; };
    list.forEach((fx) => {
      if (fx === 'review' || fx === 'bulk') return;
      if (isTerm(fx)) routes.push(addTerm(target, fx));
      else if (isAnalysis(fx)) {
        routes.push(derive(addAnalysis(target, fx)));
        if (bare && fx.type !== 'market') routes.push(derive(addAnalysis(target, fx, { code: '9998', name: '検査用（株価・指標なし）' })));
      } else addCases(target, fx).forEach((c) => { (target.stocks[c].analyses || []).forEach((a) => deriveFrom(target, a)); routes.push({ view: 'stock', code: c, type: null, date: null }); });
    });
    if (list.includes('review')) routes.push(...addReviewCases(target));
    if (list.includes('bulk')) routes.push(...addBulk(target));
    return routes;
  }
  function addCases(target, fx) {
    if (!fx || !Array.isArray(fx.cases)) throw new Error('fixture.cases がありません');
    fx.cases.forEach((c) => {
      const a = clone(c.analysis);
      a._file = 'tests/fixtures/sparse-quick.json';
      target.stocks[c.code] = { code: c.code, name: (c.profile && c.profile.name) || a.name || c.code, profile: clone(c.profile || null), prices: clone(c.prices || null), analyses: [a] };
    });
    return fx.cases.map((c) => c.code);
  }
  /** フィクスチャを window.KABU に注入（restore() で元に戻す） */
  function inject(fx, variant) {
    if (!backup) backup = clone(window.KABU);
    if (isP5a(fx)) { // 画面確認用：見出し・refresh だけを差し込む（variant: {hl, rf}。鮮度は ages を渡したときだけ）
      const v = { hl: 'fresh', rf: 'fail', ...(variant || {}) };
      const d = p5aData(fx, v);
      window.KABU.refresh = d.refresh;
      window.KABU.market = window.KABU.market || { raw: null, analysis: null, analyses: [], series: null };
      window.KABU.market.headlines = d.headlines;
      if (v.ages) setAges(window.KABU, v.ages);
      app().render(app().parseHash(location.hash));
      return ['#/', '#/market'];
    }
    const routes = addAll(window.KABU, Array.isArray(fx) ? fx : [fx], false);
    app().render(app().parseHash(location.hash));
    return routes.map(routeLabel);
  }
  const routeLabel = (r) => (r.view === 'home' ? '#/' : r.view === 'market' ? `#/market${r.date ? '/' + r.date : ''}` : r.view === 'stock' ? `#/stock/${r.code}${r.type ? '/' + r.type : ''}${r.date ? '/' + r.date : ''}` : r.view === 'glossary' && r.term ? `#/glossary/${encodeURIComponent(r.term)}` : `#/${r.view}`);
  function restore() {
    if (backup) { window.KABU = backup; backup = null; }
    app().render(app().parseHash(location.hash));
  }

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.right <= window.innerWidth + 1 && r.left >= -1;
  }

  /** 今の画面を検査して失敗を add(check, detail) で積む */
  function checkPage(route, add) {
    const main = document.getElementById('main');
    const A = app();
    const D = window.KABU;
    let a = null;
    let secs = ['library', 'market', 'geo', 'menu', 'term'];
    if (route.view === 'stock') {
      const st = D.stocks[route.code];
      const type = route.type || 'quick';
      a = st ? (st.analyses || []).find((x) => x.type === type && (!route.date || x.date === route.date)) || null : null;
      secs = a && type === 'quick' ? QUICK_SECS : a && type === 'chart' ? CHART_SECS : a && type === 'kessan' ? kessanSecs(a) : a && type === 'news' ? NEWS_SECS : a && type === 'hansei' ? HANSEI_SECS : ['empty'];
    } else if (route.view === 'market') {
      a = marketAnalysis(D, route);
      secs = a ? MARKET_SECS : MARKET_RAW_SECS;
      if (!main.querySelector('[data-view="market"]')) add('① 市場ページが描かれていない', '');
    } else if (route.view === 'glossary') {
      const g = glossOf(D);
      secs = !g.length ? ['empty'] : route.term ? [g.some((x) => x.term === route.term) ? 'gdetail' : 'gmissing', 'glist'] : ['glist'];
      if (!main.querySelector('[data-view="glossary"]')) add('① 用語帳が描かれていない', '');
    } else if (route.view === 'notes') {
      const n = notesOf(D), rv = (D.review || []).filter((r) => r && typeof r === 'object');
      secs = !n.length && !rv.length ? ['empty'] : [...(n.length ? ['nsum'] : []), 'nchecks', 'nreview', 'nlist'];
      if (!main.querySelector('[data-view="notes"]')) add('① 気づきノートが描かれていない', '');
    }
    // ヘッダの画面切替：現在地が1つだけ強調される（銘柄ページは「銘柄」の項目。ホームは光らせない）
    const nk = route.view === 'stock' ? (D.stocks[route.code] ? 'stock' : '') : route.view;
    const on = [...document.querySelectorAll('#top .gn.on')];
    if (!nk ? on.length : on.length !== 1 || on[0].dataset.gnav !== nk) add('① ヘッダの現在地の表示が違う', on.map((x) => x.dataset.gnav).join(','));
    if (route.view === 'stock' && document.querySelector('#top .gn[data-gnav="home"].on')) add('① 銘柄ページでホームが現在地になっている', '');
    // ① 枠が存在し可視
    secs.forEach((s) => { if (!visible(main.querySelector(`[data-sec="${s}"]`))) add('① 枠が無い／見えない', s); });
    // 図の枠が空でない
    main.querySelectorAll('[data-chart]').forEach((h) => {
      const svg = h.querySelector('svg');
      if (!svg || !(svg.getBoundingClientRect().width > 0)) { add('① 図が描かれていない', h.dataset.chart); return; }
      const r = svg.getBoundingClientRect();
      if (Math.abs(r.width - h.clientWidth) > 1.5 || Math.abs(r.height - h.clientHeight) > 1.5) add('① 図の大きさが枠と合わない（描き直し漏れ）', `${h.dataset.chart} ${Math.round(r.width)}x${Math.round(r.height)} / ${h.clientWidth}x${h.clientHeight}`);
    });
    // パネル見出しのはみ出し
    main.querySelectorAll('.ph').forEach((ph) => {
      const box = ph.getBoundingClientRect();
      const over = [...ph.querySelectorAll('*')].some((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.right > box.right - 1; });
      if (over) add('① 見出しがはみ出している', (ph.querySelector('h2') || {}).textContent || '');
    });
    // 文字の切れ（はみ出しを隠す枠の中で内容が収まっていない）
    main.querySelectorAll('.ck, .sc, .vg, .term, .dg, .insight, .srow, .mi, .h-mr .cg, .h-mr .vl, .tf, .lvr, .hc, .cr, .plh, .plc, .lsn, .lsx, .kpt, .krc, .kdr, .kpmc, .kfr, .kir, .kicc, .kyc, .kvc, .kbr, .knx li, .kpd, .kvl, .kft td, .krt td, .nwc, .gk, .rtc, .mg, .fxe, .csr, .rli, .ncc, .alc, .hrc, .pll, .du, .mki, .cal li, .gi, .gtx, .fb, .ni, .nks, .nbr, .rvk, .rvr, .rvbr, .gcat').forEach((el) => {
      const tol = getComputedStyle(el).overflowY === 'visible' ? 4 : 1; /* 見える枠は字形のはみ出し（行高1）を許す */
      if (el.scrollHeight > el.clientHeight + tol || el.scrollWidth > el.clientWidth + 1) add('① 文字が切れている', el.textContent.trim().slice(0, 24));
    });
    // パネルの中身が枠（overflow:hidden）で切れていない
    main.querySelectorAll('.panel > .pi').forEach((pi) => {
      const outer = pi.parentElement.getBoundingClientRect().height - 2;
      if (pi.scrollHeight > pi.clientHeight + 1 || pi.scrollHeight > outer + 1) add('① パネルの中身が切れている', `${pi.parentElement.dataset.sec || ''} ${pi.scrollHeight}>${Math.min(pi.clientHeight, outer)}`);
    });
    main.querySelectorAll('table').forEach((t) => {
      const box = t.parentElement.getBoundingClientRect(), r = t.getBoundingClientRect();
      if (r.right > box.right + 1) add('① 表が枠からはみ出している', (t.querySelector('td') || {}).textContent || '');
    });
    // 図の中の重なり（ピンの札・右端のタグ・ローソク足・需給の倍率ラベル・メーターの両端ラベル）
    const bb = (el) => { try { const b = el.getBBox(); return [b.x, b.y, b.x + b.width, b.y + b.height]; } catch (e) { return null; } };
    const inter = (a, b, m = 0.5) => a && b && a[0] < b[2] - m && a[2] > b[0] + m && a[1] < b[3] - m && a[3] > b[1] + m;
    main.querySelectorAll('[data-chart="price"] svg, [data-chart="nchart"] svg, [data-chart="hchart"] svg').forEach((svg) => {
      const pins = [...svg.querySelectorAll('.pinbox')].map(bb), tags = [...svg.querySelectorAll('.tagbox')].map(bb);
      const cdl = [...svg.querySelectorAll('.candles > *')].map(bb);
      [...svg.querySelectorAll('.pin')].forEach((g, i) => { const b = bb(g.querySelector('.pinbox')), t = bb(g.querySelector('text')); if (b && t && (t[0] < b[0] + 3 || t[2] > b[2] + 1)) add('① ピンの文字が札からはみ出す', String(i + 1)); });
      pins.forEach((p, i) => {
        if (cdl.some((c) => inter(p, c))) add('① ピンの札がローソク足に重なる', String(i + 1));
        if (pins.some((q, j) => j !== i && inter(p, q))) add('① ピンの札どうしが重なる', String(i + 1));
        if (tags.some((t) => inter(p, t))) add('① ピンの札が右端のタグに重なる', String(i + 1));
      });
      const tagTx = [...svg.querySelectorAll('.tagtxt')].map(bb);
      tagTx.forEach((t, i) => { if (tagTx.some((u, j) => j > i && inter(t, u))) add('① 右端のタグどうしが重なる', String(i + 1)); });
    });
    main.querySelectorAll('[data-chart="supply"] svg').forEach((svg) => {
      const labs = [...svg.querySelectorAll('.rlab')].map(bb), bars = [...svg.querySelectorAll('.bars > *')].map(bb);
      const line = svg.querySelector('.rline path');
      const pts = [];
      if (line) { const L = line.getTotalLength(); for (let t = 0; t <= L; t += 2) { const q = line.getPointAtLength(t); pts.push([q.x, q.y]); } }
      labs.forEach((l, i) => {
        if (bars.some((b) => inter(l, b))) add('① 倍率ラベルが棒に重なる', String(i + 1));
        if (labs.some((m, j) => j !== i && inter(l, m))) add('① 倍率ラベルどうしが重なる', String(i + 1));
        if (pts.some(([x, y]) => x > l[0] + 1 && x < l[2] - 1 && y > l[1] + 2 && y < l[3] - 1)) add('① 倍率ラベルが線に重なる', String(i + 1));
      });
      [...svg.querySelectorAll('.bars')].forEach((g, i) => { [...g.children].filter((c) => c.tagName === 'rect').forEach((r) => { if (r.getBBox().height < 2.5 && r.getAttribute('height') !== '1.6') add('① 棒が低すぎて見えない', String(i + 1)); }); });
    });
    // 図の文字が SVG の枠からはみ出していない
    main.querySelectorAll('[data-chart] svg').forEach((svg) => {
      const W = svg.viewBox.baseVal.width;
      svg.querySelectorAll('text').forEach((t) => { const b = bb(t); if (b && (b[0] < -1 || b[2] > W + 1)) add('① 図の文字が枠からはみ出す', `${svg.parentElement.dataset.chart}: ${t.textContent}`); });
    });
    main.querySelectorAll('.mt').forEach((m) => {
      const ls = [...m.querySelectorAll('.ml')].map((e) => e.getBoundingClientRect());
      if (ls.length === 2 && ls[0].right + 2 > ls[1].left) add('① メーターの両端ラベルが重なる', m.parentElement.textContent.slice(0, 8));
    });
    // 情報優先：省略記号・行数制限で文字が欠けていない
    main.querySelectorAll('*').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && el.textContent.trim()) add('情報優先：省略記号で切れている', el.textContent.trim().slice(0, 24));
      if (cs.webkitLineClamp && cs.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1) add('情報優先：行数制限で切れている', el.textContent.trim().slice(0, 24));
    });
    // ② NaN / undefined / Infinity（SVG属性・style属性・画面テキスト）
    document.querySelectorAll('#main svg *, #main svg, #top *, #bot *').forEach((el) => {
      SVG_ATTRS.forEach((k) => { const v = el.getAttribute && el.getAttribute(k); if (v && BAD.test(v)) add('② 属性に不正値', `${el.tagName}[${k}]=${v.slice(0, 60)}`); });
    });
    main.querySelectorAll('[style]').forEach((el) => { const v = el.getAttribute('style'); if (BAD.test(v)) add('② style に不正値', v.slice(0, 80)); });
    ['main', 'top', 'bot', 'rail'].forEach((id) => { const t = document.getElementById(id).innerText || ''; const m = t.match(BAD); if (m) add('② 画面テキストに不正値', `#${id}: …${t.slice(Math.max(0, m.index - 20), m.index + 20)}…`); });
    // ③ 横スクロールなし
    if (document.documentElement.scrollWidth > window.innerWidth) add('③ 横スクロールがある', `${document.documentElement.scrollWidth} > ${window.innerWidth}`);
    // 禁止語（売買の断定）
    const all = document.body.innerText || '';
    BANNED.forEach((w) => { if (all.includes(w)) add('禁止語', w); });
    if (a && (a.type === 'chart' || a.type === 'kessan')) checkP2(a, route, add);
    if (route.view === 'market' || route.view === 'glossary' || route.view === 'notes' || (a && (a.type === 'news' || a.type === 'hansei'))) { checkType(add); checkSvgText(add); }
    if (route.view === 'glossary') checkGlossary(route, add);
    if (route.view === 'notes') checkNotes(add);
    if (a && (a.type === 'quick' || a.type === 'market')) checkReview(route, a, add);
    // 他のページと同じフッター（出典・注意書き）
    if (!main.querySelector('.foot-b [data-sources]') || !/学習用の分析であり、売買の推奨ではありません/.test((main.querySelector('.foot-b') || {}).textContent || '')) add('① フッター（出典・注意書き）が無い', route.view);
    if (a && ['market', 'news', 'hansei'].includes(a.type)) checkP3(a, route, add);
    // missing の文はどの型でも画面（フッターの未取得一覧）に出す
    if (a && a.type !== 'quick') {
      const list = main.querySelector('[data-missing-list]');
      (a.missing || []).forEach((m) => { if (!list || !list.textContent.includes(m)) add('④ missing の文が画面に無い', m); });
      if (!(a.missing || []).length && list) add('④ missing が空なのに未取得一覧がある', '');
    }
    // ④ 「未取得」表示と missing の対応
    if (a && (a.type || 'quick') === 'quick') {
      const sections = a.sections || {};
      ABSENT_SECS.forEach((sec) => {
        const absent = A.secAbsent(a, sec);
        const nd = main.querySelector(`[data-nodata="${sec}"]`);
        if (absent && !nd) add('④ 欠損なのに未取得表示が無い', sec);
        if (!absent && nd) add('④ データがあるのに未取得表示', sec);
        const why = absent ? A.missFor(a, sec) : '';
        if (nd && why && !nd.textContent.includes(why)) add('④ 未取得の理由が missing と違う', `${sec}: ${why}`);
      });
      const chartAbsent = !sections.chart || typeof sections.chart !== 'object';
      if (chartAbsent !== !!main.querySelector('[data-nodata="chart"]')) add('④ サポレジ・注釈の未取得表示が不一致', String(chartAbsent));
      if (!A.secAbsent(a, 'valuation')) {
        A.VAL_KEYS.forEach((k) => {
          const it = sections.valuation.find((x) => x && x.key === k);
          const miss = !it || typeof it.value !== 'number';
          const nd = main.querySelector(`[data-nodata="valuation:${k}"]`);
          if (miss !== !!nd) add('④ 指標の未取得表示が不一致', k);
          const why = miss ? A.missFor(a, 'valuation', k) : '';
          if (nd && why && !nd.textContent.includes(why)) add('④ 指標の未取得理由が missing と違う', `${k}: ${why}`);
        });
      }
      if (!A.secAbsent(a, 'diagnosis')) {
        A.DIAG_KEYS.forEach((k) => {
          const miss = !sections.diagnosis.some((x) => x && x.key === k);
          if (miss !== !!main.querySelector(`[data-nodata="diagnosis:${k}"]`)) add('④ 診断の未取得表示が不一致', k);
        });
      }
      // 稼ぎ頭：5事業以上は上位3＋「その他」で、その他の額は残りの合計。利益率が全部 null なら利益率の凡例・数値を出さない
      if (!A.secAbsent(a, 'segments')) {
        const segs = sections.segments.filter((x) => x && x.name).sort((x, y) => (y.profit ?? -Infinity) - (x.profit ?? -Infinity));
        const panelEl = main.querySelector('[data-sec="segments"]');
        const rowsEl = [...panelEl.querySelectorAll('.srow')];
        if (rowsEl.length !== Math.min(segs.length, 4)) add('稼ぎ頭の行数が違う', `${rowsEl.length}`);
        if (segs.length > 4) {
          const sum = segs.slice(3).reduce((t, x) => t + (typeof x.profit === 'number' ? x.profit : 0), 0);
          const last = rowsEl[rowsEl.length - 1];
          const shown = Number((last.querySelector('.pf').textContent.match(/[−-]?[\d,]+/) || ['NaN'])[0].replace(/,/g, '').replace('−', '-'));
          if (!last.textContent.includes(`その他 ${segs.length - 3}事業`) || shown !== sum) add('稼ぎ頭の「その他」の合計が違う', `${shown} ≠ ${sum}`);
        }
        if (segs.every((x) => typeof x.margin !== 'number') && (/利益率/.test(panelEl.querySelector('.sg-top').textContent) || panelEl.querySelector('.mbar b:not(.xp)'))) add('利益率が無いのに利益率の表示がある', '');
      }
      const list = main.querySelector('[data-missing-list]');
      (a.missing || []).forEach((m) => { if (!list || !list.textContent.includes(m)) add('④ missing の文が画面に無い', m); });
      if (!(a.missing || []).length && list) add('④ missing が空なのに未取得一覧がある', '');
      // 「未取得」の文字は、決まった場所（未取得枠・未取得一覧・ヘッダー・図の中）にしか出さない
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.nodeValue.includes('未取得')) continue;
        const el = n.parentElement;
        if (!el.closest('[data-nodata], [data-missing-list], .sh-kv, [data-chart], .h-bd')) add('④ 根拠の無い「未取得」表示', el.outerHTML.slice(0, 80));
      }
    }
  }

  /* ---------- P3c：用語帳・気づきノート・答え合わせの検査 ---------- */
  const glossOf = (D) => (D.glossary || []).filter((x) => x && typeof x.term === 'string' && x.term);
  const notesOf = (D) => (D.notes || []).filter((x) => x && typeof x === 'object' && (x.text || x.title));
  const norm = (x) => String(x == null ? '' : x).normalize('NFKC').toLowerCase();
  const GCATS = ['指標', 'チャート', '決算', '需給', 'マクロ', '制度', 'その他'];
  const catOf = (t) => (GCATS.includes(t.category) ? t.category : '未分類');
  const firstOk = (t) => !!(t.firstDate && t.firstType && (t.firstType === 'market' || (t.firstCode && app().TYPES.some((x) => x.key === t.firstType))));
  const rectsOverlap = (a, b, m = 1) => a.left < b.right - m && a.right > b.left + m && a.top < b.bottom - m && a.bottom > b.top + m;
  function checkGlossary(route, add) {
    const main = document.getElementById('main'), list = glossOf(window.KABU);
    if (!list.length) { if (!/\/kabu 用語/.test(main.textContent)) add('用語帳：0件なのにコマンドの案内が無い', ''); return; }
    const items = [...main.querySelectorAll('.gi')];
    if (items.length !== list.length) add('用語帳：語数が違う', `${items.length} ≠ ${list.length}`);
    if (items.some((el) => el.hidden)) add('用語帳：初期状態で隠れた語がある', '');
    const cnt = main.querySelector('[data-gl-count]');
    if (!cnt || !cnt.textContent.includes(String(list.length))) add('用語帳：件数の表示が違う', cnt ? cnt.textContent : '');
    list.forEach((t, i) => {
      const el = items[i];
      if (!el || el.dataset.term !== t.term) { if (i < 3) add('用語帳：並びが違う', t.term); return; }
      const det = !!(t.detail && typeof t.detail === 'object');
      if (det !== el.classList.contains('det') || det !== !!el.querySelector('.gdm')) add('用語帳：詳しい解説の印が違う', t.term);
      const fl = el.querySelector('[data-first]');
      if (firstOk(t) !== !!fl) add('用語帳：初出のリンクの有無が違う', t.term);
      if (fl && !fl.getAttribute('href').includes(t.firstDate)) add('用語帳：初出のリンク先が違う', t.term);
      if ((el.querySelector('.gc') || {}).textContent !== catOf(t)) add('用語帳：分類の表示が違う', t.term);
      if (!el.querySelector('[data-def]') || !el.querySelector('[data-def]').textContent.includes(t.def || '')) add('用語帳：定義が無い', t.term);
    });
    if (!route.term) { if (main.querySelector('[data-open-term]')) add('用語帳：語を選んでいないのに解説が開いている', ''); return; }
    const t = list.find((x) => x.term === route.term);
    if (!t) {
      if (!main.querySelector('[data-nodata="gmissing"]') || !main.textContent.includes('/kabu 用語 ' + route.term)) add('用語帳：無い語の案内が無い', route.term);
      return;
    }
    const p = main.querySelector('[data-open-term]');
    if (!p || p.dataset.openTerm !== t.term) add('用語帳：URL の語が開いていない', t.term);
    const on = main.querySelectorAll('.gi.on');
    if (on.length !== 1 || on[0].dataset.term !== t.term) add('用語帳：一覧の現在の語の強調が違う', String(on.length));
    const d = t.detail && typeof t.detail === 'object' ? t.detail : null;
    if (!d) { if (!main.querySelector('[data-nodata="gdetail"]')) add('用語帳：解説の無い語に案内が無い', t.term); return; }
    const flow = (d.flow || []).filter((x) => x && x.label).slice(0, 5);
    const boxes = [...main.querySelectorAll('[data-gd="flow"] .fb')];
    if (boxes.length !== flow.length) add('流れ図：箱の数が違う', `${boxes.length} ≠ ${flow.length}`);
    boxes.forEach((b, i) => {
      const want = ['up', 'down', 'none'].includes(flow[i] && flow[i].dir) ? flow[i].dir : 'none';
      if (b.dataset.dir !== want) add('流れ図：向きの表示が違う', String(i + 1));
      const r = b.getBoundingClientRect(), pr = p.getBoundingClientRect();
      if (r.left < pr.left - 1 || r.right > pr.right + 1) add('流れ図：箱が枠からはみ出す', String(i + 1));
      if (i && Math.abs(r.top - boxes[0].getBoundingClientRect().top) > 1) add('流れ図：箱が1列に並んでいない', String(i + 1));
      if (i && r.left < boxes[i - 1].getBoundingClientRect().right + 16) add('流れ図：箱の間に矢印の幅が無い', String(i + 1));
      if (i && !(b.previousElementSibling && b.previousElementSibling.classList.contains('fa') && b.previousElementSibling.getBoundingClientRect().width >= 16)) add('流れ図：箱の間に矢印が無い', String(i + 1));
      if (b.scrollWidth > b.clientWidth + 1) add('流れ図：箱の文字が切れている', String(i + 1));
    });
    const sw = d.seesaw && d.seesaw.left && d.seesaw.right;
    const ss = main.querySelector('[data-gd="seesaw"]');
    if (!!sw !== !!ss) add('シーソー図：有無が違う', t.term);
    if (ss) {
      const [l, r] = [...ss.querySelectorAll('.ssl')], v = ss.querySelector('.ssv');
      if (!l || !r || !v || !l.textContent.includes(d.seesaw.left) || !r.textContent.includes(d.seesaw.right)) add('シーソー図：左右の語が無い', '');
      else { const L = l.getBoundingClientRect(), R = r.getBoundingClientRect(), V = v.getBoundingClientRect(); if (rectsOverlap(L, V) || rectsOverlap(R, V) || !(L.top < R.top)) add('シーソー図：語と図が重なる／左右の上下が逆', ''); if (V.width < 100) add('シーソー図：図が小さすぎる', String(Math.round(V.width))); }
    }
    ['body', 'analogy', 'example', 'stockLink', 'pitfall'].forEach((k) => { if (!!d[k] !== !!main.querySelector(`[data-gd="${k}"]`)) add('解説：節の有無が違う', k); });
    const has = new Set(list.map((x) => x.term));
    const rel = (d.related || []).filter((x) => typeof x === 'string' && x);
    const links = [...main.querySelectorAll('[data-rel-link]')].map((e) => e.textContent.replace(/ ›$/, '')), texts = [...main.querySelectorAll('[data-rel-text]')].map((e) => e.textContent);
    if (links.join('|') !== rel.filter((x) => has.has(x)).join('|') || texts.join('|') !== rel.filter((x) => !has.has(x)).join('|')) add('関連語：リンクと文字の振り分けが違う', rel.join(','));
    if ((d.sources || []).length && main.querySelectorAll('.gsrc li').length !== d.sources.filter((x) => x && x.title).length) add('解説：出典の数が違う', '');
  }
  /** 用語帳の操作：検索（input イベント）・分類・定義をかくす・語を押す・↑↓。最後は初期状態に戻す */
  function checkGlossaryUI(add) {
    const A = app(), main = document.getElementById('main'), list = glossOf(window.KABU);
    if (!list.length) return;
    const inp = main.querySelector('[data-gl-q]');
    const vis = () => [...main.querySelectorAll('.gi')].filter((el) => !el.hidden);
    const type = (v) => { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); };
    const text = (t) => norm([t.term, t.detail && t.detail.reading, t.def].filter(Boolean).join(' '));
    const hash0 = location.hash;
    [list[0].term.slice(0, 2), (list[list.length - 1].def || 'x').slice(2, 5), 'ＰＥＲ'].forEach((q) => {
      type(q);
      const want = list.filter((t) => text(t).includes(norm(q))).length;
      if (vis().length !== want) add('用語帳：検索の絞り込みが違う', `${q}: ${vis().length} ≠ ${want}`);
      if (want && want !== list.length && !(main.querySelector('[data-gl-count]').textContent.includes(`${want}語`))) add('用語帳：検索後の件数表示が違う', q);
    });
    type('存在しない語の検索ｘｙｚ');
    if (vis().length || !visible(main.querySelector('[data-gl-none]'))) add('用語帳：該当なしの表示が無い', '');
    type('');
    if (vis().length !== list.length) add('用語帳：検索を消しても全件に戻らない', '');
    main.querySelectorAll('[data-gl-cat]').forEach((c) => {
      if (c.getAttribute('aria-disabled') === 'true') return;
      c.click();
      const k = c.dataset.glCat, want = k === 'all' ? list.length : list.filter((t) => catOf(t) === k).length;
      if (vis().length !== want) add('用語帳：分類の絞り込みが違う', `${k}: ${vis().length} ≠ ${want}`);
      if (main.querySelectorAll('[data-gl-cat][aria-pressed="true"]').length !== 1 || c.getAttribute('aria-pressed') !== 'true') add('用語帳：選んだ分類の表示が違う', k);
    });
    main.querySelector('[data-gl-cat="all"]').click();
    const hb = main.querySelector('[data-gl-hide]');
    hb.click();
    const transparent = (el) => { const c = getComputedStyle(el).color; return c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c); };
    const defs = () => vis().map((el) => el.querySelector('[data-def]'));
    if (hb.getAttribute('aria-pressed') !== 'true' || !defs().every(transparent)) add('定義をかくす：オンでも定義が見える', '');
    const g0 = vis()[0], b0 = g0.querySelector('[data-gw]');
    b0.click();
    if (!g0.classList.contains('rev') || transparent(g0.querySelector('[data-def]'))) add('定義をかくす：語を押しても定義が見えない', g0.dataset.term);
    if (vis().filter((el) => el.classList.contains('rev')).length !== 1) add('定義をかくす：その語だけでなく他の定義も見える', '');
    if (location.hash !== hash0) add('定義をかくす：語を押すと別の画面へ移ってしまう', location.hash);
    b0.click();
    if (g0.classList.contains('rev')) add('定義をかくす：もう一度押しても伏せられない', '');
    if (vis().length > 1) {
      b0.focus();
      b0.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      const g1 = vis()[1];
      if (document.activeElement !== g1.querySelector('[data-gw]') || !g1.classList.contains('rev')) add('定義をかくす：↓キーで次の語を選べない', '');
    }
    hb.click();
    if (defs().some(transparent)) add('定義をかくす：オフにしても伏せたまま', '');
    const st = A.glState();
    if (st.q !== '' || st.cat !== 'all' || st.hide || st.reveal != null) add('用語帳：操作後に初期状態へ戻らない', JSON.stringify(st));
  }
  function checkNotes(add) {
    const main = document.getElementById('main'), D = window.KABU, list = notesOf(D), rvs = (D.review || []).filter((r) => r && typeof r === 'object');
    if (!list.length && !rvs.length) { if (!/\/kabu/.test(main.textContent)) add('気づきノート：0件なのに案内が無い', ''); return; }
    const items = [...main.querySelectorAll('[data-note]')];
    if (items.length !== list.length) add('気づきノート：件数が違う', `${items.length} ≠ ${list.length}`);
    for (let i = 1; i < list.length; i++) if (String(list[i - 1].date) < String(list[i].date)) { add('気づきノート：新しい順でない（データ）', String(i)); break; }
    items.forEach((el, i) => {
      const n = list[i]; if (!n) return;
      const kind = ['insight', 'lesson', 'nextCheck'].includes(n.kind) ? n.kind : 'insight';
      if (el.dataset.kind !== kind) add('気づきノート：種別が違う', String(i));
      const ln = el.querySelector('[data-note-link]');
      const want = n.code ? `#/stock/${encodeURIComponent(n.code)}` : n.type === 'market' ? `#/market/${n.date}` : null;
      if (want && (!ln || !ln.getAttribute('href').startsWith(want))) add('気づきノート：元の分析へのリンクが無い', `${i} ${want}`);
    });
    ['insight', 'lesson', 'nextCheck'].forEach((k) => { const el = main.querySelector(`[data-sum-kind="${k}"] .nkn .mono`); const want = list.filter((n) => (['insight', 'lesson', 'nextCheck'].includes(n.kind) ? n.kind : 'insight') === k).length; if (list.length && (!el || +el.textContent !== want)) add('集計：種別の件数が違う', k); });
    if (main.querySelectorAll('[data-ncheck]').length !== list.filter((n) => n.kind === 'nextCheck').length) add('次回の確認：カードの数が違う', '');
    const rows = [...main.querySelectorAll('[data-rvrow]')];
    if (rows.length !== rvs.length) add('答え合わせ一覧：行数が違う', `${rows.length} ≠ ${rvs.length}`);
    rows.forEach((r, i) => {
      const rv = rvs[i]; if (!rv) return;
      if (!!rv.young !== !!r.querySelector('[data-young]')) add('答え合わせ一覧：「まだ日が浅い」の表示が違う', String(i));
      const hasAfter = (rv.after || []).length > 0;
      if (hasAfter !== !!r.querySelector('svg')) add('答え合わせ一覧：スパークラインの有無が違う', String(i));
      const href = r.getAttribute('href') || '';
      if (rv.kind === 'market' ? href !== `#/market/${rv.date}` : href !== `#/stock/${encodeURIComponent(rv.code)}/quick/${rv.date}`) add('答え合わせ一覧：行のリンク先が違う', href);
      if (!r.textContent.includes(String(rv.days)) ) add('答え合わせ一覧：経過営業日数が無い', String(i));
    });
  }
  function checkNotesUI(add) {
    const A = app(), main = document.getElementById('main'), list = notesOf(window.KABU);
    if (!list.length) return;
    const vis = () => [...main.querySelectorAll('[data-note]')].filter((el) => !el.hidden);
    const keyOf = { kind: (n) => (['insight', 'lesson', 'nextCheck'].includes(n.kind) ? n.kind : 'insight'), type: (n) => n.type || '', code: (n) => (n.code ? String(n.code) : n.type === 'market' ? 'market' : 'other') };
    ['kind', 'type', 'code'].forEach((g) => {
      main.querySelectorAll(`[data-nt-${g}]`).forEach((c) => {
        c.click();
        const v = c.getAttribute(`data-nt-${g}`), want = v === 'all' ? list.length : list.filter((n) => keyOf[g](n) === v).length;
        if (vis().length !== want) add('気づきノート：絞り込みの件数が違う', `${g}=${v}: ${vis().length} ≠ ${want}`);
        if (vis().some((el) => v !== 'all' && el.dataset[g] !== v)) add('気づきノート：絞り込みに合わない項目が見える', `${g}=${v}`);
      });
      const all = main.querySelector(`[data-nt-${g}="all"]`); if (all) all.click();
    });
    const st = A.ntState();
    if (st.kind !== 'all' || st.type !== 'all' || st.code !== 'all' || vis().length !== list.length) add('気づきノート：操作後に初期状態へ戻らない', JSON.stringify(st));
  }
  /** シナリオの答え合わせ（クイック診断・市場ページ）：表示中の分析日の review か、図の座標が reviewModel と一致するか */
  function checkReview(route, a, add) {
    const main = document.getElementById('main'), A = app(), K = window.KABU_CHARTS;
    const kind = route.view === 'market' ? 'market' : 'stock';
    const rv = A.reviewOf(kind, kind === 'market' ? null : route.code, a.date);
    const box = main.querySelector('[data-review]');
    if (!box) { add('答え合わせ：枠が無い', ''); return; }
    if (box.dataset.review !== a.date) add('答え合わせ：表示中の分析日と違う日の答え合わせ', `${box.dataset.review} ≠ ${a.date}`);
    const after = rv ? (rv.after || []).filter((r) => r && typeof r.c === 'number') : [];
    if (!rv || !after.length || typeof (rv.base || {}).price !== 'number') {
      if (!main.querySelector('[data-review-none]')) add('答え合わせ：値が無いときの案内が無い', '');
      if (main.querySelector('[data-chart="review"]')) add('答え合わせ：値が無いのに図がある', '');
      return;
    }
    const host = main.querySelector('[data-chart="review"]'), svg = host && host.querySelector('svg');
    if (!svg) { add('答え合わせ：図が無い', ''); return; }
    const m = K.reviewModel(rv, host.clientWidth, host.clientHeight);
    if (!m) { add('答え合わせ：図の座標が作れない', `${host.clientWidth}x${host.clientHeight}`); return; }
    const near = (x, y, t = 0.6) => Math.abs(x - y) <= t;
    const ln = svg.querySelector('.rv-line');
    const pts = ln ? ln.getAttribute('d').replace(/^M/, '').split(' L').map((p) => p.trim().split(/\s+/).map(Number)) : [];
    if (pts.length !== after.length + 1) add('答え合わせ：折れ線の点の数が違う', `${pts.length} ≠ ${after.length + 1}`);
    else {
      if (!near(pts[0][0], m.X(0)) || !near(pts[0][1], m.Y(rv.base.price))) add('答え合わせ：折れ線の始点が基準価格・分析日にない', pts[0].join(','));
      const L = pts[pts.length - 1];
      if (!near(L[0], m.last.x) || !near(L[1], m.Y(rv.latest.c))) add('答え合わせ：折れ線の終点が直近値にない', L.join(','));
      if (pts.some((p) => p[0] < m.x0 - 0.5 || p[0] > m.x1 + 0.5 || p[1] < m.top - 0.5 || p[1] > m.bot + 0.5)) add('答え合わせ：折れ線が図の枠の外に出る', '');
    }
    const bl = svg.querySelector('.rv-bline');
    if (!bl || !near(+bl.getAttribute('y1'), m.Y(rv.base.price))) add('答え合わせ：基準線の位置が違う', '');
    m.targets.forEach((t) => {
      if (t.out) { const o = svg.querySelector(`.rv-out.rv-${t.kind}`); if (!o || o.dataset.out !== t.out) add('答え合わせ：範囲外の目安が端に寄っていない', t.kind); return; }
      if (t.type === 'band') { const g = svg.querySelector(`.rv-band.rv-${t.kind} rect`); if (!g || !near(+g.getAttribute('y'), t.y0) || !near(+g.getAttribute('y') + +g.getAttribute('height'), t.y1, 1.2)) add('答え合わせ：帯の位置が違う', t.kind); return; }
      const l = svg.querySelector(`.rv-tline.rv-${t.kind}`); if (!l || !near(+l.getAttribute('y1'), t.y)) add('答え合わせ：目安の線の位置が違う', t.kind);
    });
    const labs = [...svg.querySelectorAll('.rv-lab')].map((e) => e.getBBox());
    labs.forEach((b, i) => { if (labs.some((c, j) => j > i && b.y < c.y + c.height - 2 && b.y + b.height - 2 > c.y)) add('答え合わせ：右の札どうしが重なる', String(i)); if (b.y < -1 || b.y + b.height > m.H + 1) add('答え合わせ：右の札が枠外', String(i)); });
    const days = main.querySelector('[data-num="days"]');
    if (!days || !days.textContent.includes(String(rv.days))) add('答え合わせ：経過営業日数の表示が違う', String(rv.days));
    if (!!rv.young !== !!main.querySelector('[data-review] [data-young]')) add('答え合わせ：「まだ日が浅い」の表示が違う', String(rv.young));
    if (!(main.querySelector('[data-review-note]') || {}).textContent || !main.querySelector('[data-review-note]').textContent.includes('機械的な距離の比較であり、評価ではありません')) add('答え合わせ：評価ではない旨の注記が無い', '');
    const nk = main.querySelector('[data-num="nearest"] [data-rvk]');
    if ((rv.nearest ? rv.nearest.kind : null) !== (nk ? nk.dataset.rvk : null)) add('答え合わせ：いちばん近い目安の表示が違う', '');
    if (kind === 'stock' && main.querySelectorAll('[data-review] [data-brk]').length !== (rv.targets || []).filter((t) => t && ['bull', 'base', 'bear'].includes(t.kind)).length) add('答え合わせ：崩れる条件の数が違う', '');
    if (/当たり|外れ(?!は判定)/.test(box.textContent.replace('当たり外れは判定しません', ''))) add('答え合わせ：当たり外れの判定語がある', '');
  }

  /** 最小文字 12px（SVG は表示倍率を掛けて判定） */
  function checkType(add) {
    const main = document.getElementById('main');
    main.querySelectorAll('*').forEach((el) => {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) return;
      const svg = el.closest('svg'), vb = svg && svg.viewBox && svg.viewBox.baseVal;
      const k = vb && vb.width ? svg.getBoundingClientRect().width / vb.width : 1;
      const px = parseFloat(getComputedStyle(el).fontSize) * k;
      if (px < 11.95) add('最小文字12px未満', `${px.toFixed(1)}px ${el.textContent.trim().slice(0, 12)}`);
    });
  }
  /** 図の中の文字どうしが重ならない */
  function checkSvgText(add) {
    document.getElementById('main').querySelectorAll('[data-chart] svg').forEach((svg) => {
      const ts = [...svg.querySelectorAll('text')].map((t) => { const b = t.getBBox(); return [b.x, b.y + 2, b.x + b.width, b.y + b.height - 2, t.textContent]; }).filter((b) => b[2] > b[0]);
      ts.forEach((t, i) => { const o = ts.find((u, j) => j > i && t[0] < u[2] - 1 && t[2] > u[0] + 1 && t[1] < u[3] && t[3] > u[1]); if (o) add('図の文字どうしが重なる', `${svg.parentElement.dataset.chart}: ${t[4]} / ${o[4]}`); });
    });
  }

  /** P3b：市場・ニュース・反省の画面がデータと一致すること（件数・星・期間・不明・印・未取得） */
  function checkP3(a, route, add) {
    const main = document.getElementById('main'), s = a.sections || {}, K = window.KABU_CHARTS;
    const nd = (k) => main.querySelector(`[data-nodata="${k}"]`);
    const count = (sel) => main.querySelectorAll(sel).length;
    const starsOf = (el) => ((el && el.querySelector('.lvl b') && el.querySelector('.lvl b').textContent) || '').length;
    const lv = (v) => Math.max(0, Math.min(5, Math.round(typeof v === 'number' ? v : 0)));
    const pinsIn = (svgSel, list, cls) => {
      const svg = main.querySelector(svgSel);
      list.forEach(([d, what]) => { if (!svg) return; const inWin = !!svg.closest('[data-chart]') && rowsHas(route, d); const g = svg.querySelector(cls ? `.pin.${cls}` : `.pin[data-date="${d}"]`); if (inWin && !g) add('図：印が無い', `${what} ${d}`); if (!inWin && g) add('図：表示範囲外なのに印がある', `${what} ${d}`); if (!inWin && !main.querySelector('[data-outside]')) add('図：範囲外の印の注記が無い', `${what} ${d}`); });
    };
    if (a.type === 'market') {
      const geo = (s.geo || []).filter((g) => g && (g.name || g.title));
      if (count('[data-geo]') !== geo.length) add('地政学：行数が違う', `${count('[data-geo]')} ≠ ${geo.length}`);
      geo.forEach((g, i) => { const el = main.querySelector(`[data-geo="${i}"]`); if (starsOf(el) !== lv(g.level)) add('地政学：星の数が違う', `${i + 1}: ${starsOf(el)} ≠ ${lv(g.level)}`); const n = el ? el.querySelectorAll('.chp').length : 0; if (n !== (g.sectors || []).filter((x) => x && x.name).length) add('地政学：業種チップの数が違う', String(i + 1)); if (el && [...el.querySelectorAll('.chp')].some((c, k) => c.classList.contains('p') !== (g.sectors.filter((x) => x && x.name)[k].dir === 'plus'))) add('地政学：プラス／マイナスの色が違う', String(i + 1)); });
      const news = (s.news || []).filter((x) => x && x.title);
      if (count('[data-news]') !== news.length) add('ニュース：カードの数が違う', `${count('[data-news]')} ≠ ${news.length}`);
      const cal = (s.calendar || []).filter((x) => x && typeof x.date === 'string');
      if (cal.length ? count('[data-cal]') !== cal.length : !nd('calendar')) add('予定：件数と表示が違う', String(cal.length));
      const eff = ((s.fx || {}).effects || []).filter((x) => x && x.who);
      ['plus', 'minus'].forEach((k) => { const col = main.querySelector(`[data-sec="fx"] .fxc.${k}`); if (!col || col.querySelectorAll('.fxe').length !== eff.filter((x) => x.dir === k).length) add('為替：プラス／マイナスの振り分けが違う', k); });
      const items = ((s.rates || {}).items || []).filter((x) => x && typeof x === 'object');
      if (count('[data-rate]') !== items.length) add('金利：カードの数が違う', String(items.length));
      items.forEach((x, i) => { if ((typeof x.value !== 'number') !== !!nd(`rates:${x.key || i}`)) add('金利：未取得表示が不一致', x.key || String(i)); });
      const gs = ((s.level || {}).gauges || []).filter((x) => x && typeof x === 'object');
      if (count('[data-gauge]') !== gs.length) add('高い安い：物差しの数が違う', String(gs.length));
      gs.forEach((x, i) => {
        const el = main.querySelector(`[data-gauge="${x.key || i}"]`), mk = el && el.querySelector('.gmk');
        if ((typeof x.value !== 'number') !== !!nd(`level:${x.key || i}`)) add('高い安い：未取得表示が不一致', x.key || String(i));
        if (typeof x.value === 'number') { const m = K.refGaugeModel(x); if (!mk || Math.abs(+mk.dataset.pos - m.pos(x.value)) > 0.2) add('高い安い：物差しの印の位置が違う', x.key || String(i)); }
        if (typeof x.ref === 'number' && !(el && el.querySelector('.rf'))) add('高い安い：基準線が無い', x.key || String(i));
      });
      const nk = (((window.KABU.market || {}).series || {}).series || {})['^N225'];
      if (nk && (nk.rows || []).length && !main.querySelector('[data-chart="mkchart"] svg .mk-line')) add('市場：日経平均の折れ線が無い', '');
      if (!main.querySelector('[data-slot="review"]')) add('市場：答え合わせの置き場が無い', '');
      if (count('[data-scn]') !== ['bull', 'base', 'bear'].filter((k) => (s.outlook || []).some((x) => x && x.kind === k)).length) add('市場：シナリオの枚数が違う', '');
    }
    if (a.type === 'news') {
      const im = s.impact || {};
      if (starsOf(main.querySelector('[data-sec="impact"]')) !== lv(im.level)) add('ニュース：影響度の星が違う', String(im.level));
      const du = main.querySelector('.du.on');
      if ((du && du.dataset.du) !== im.duration) add('ニュース：期間の3段階の表示が違う', `${du && du.dataset.du} ≠ ${im.duration}`);
      if (count('.du') !== 3) add('ニュース：期間の段が3つでない', '');
      const cases = (s.cases || []).filter((x) => x && typeof x === 'object');
      if (count('[data-case]') !== cases.length) add('過去事例：行数が違う', String(cases.length));
      cases.forEach((x, i) => {
        const el = main.querySelector(`[data-case="${i}"]`); if (!el) return;
        const d = el.querySelector('[data-bar="drop"]'), r = el.querySelector('[data-bar="rec"]');
        if ((typeof x.dropPct !== 'number') !== !!d.querySelector('[data-unknown="drop"]')) add('過去事例：初動の「不明」表示が違う', String(i));
        if (typeof x.dropPct !== 'number' && d.querySelector('.yb u')) add('過去事例：null なのに初動の棒がある', String(i));
        if (typeof x.dropPct === 'number' && !d.querySelector('.yb u')) add('過去事例：初動の棒が無い', String(i));
        if ((typeof x.recoveryMonths !== 'number') !== !!r.querySelector('[data-unknown="rec"]')) add('過去事例：回復の「不明」表示が違う', String(i));
        if (typeof x.recoveryMonths !== 'number' && r.querySelector('.mb u')) add('過去事例：null なのに回復の棒がある', String(i));
        if (typeof x.recoveryMonths === 'number' && !r.querySelector('.mb u')) add('過去事例：回復の棒が無い', String(i));
        if (!el.querySelector('.css') || !el.querySelector('.csd')) add('過去事例：似ている点・違う点の対が無い', String(i));
      });
      pinsIn('[data-chart="nchart"] svg', ((s.chart || {}).pins || []).filter((p) => p && typeof p.date === 'string' && p.label).map((p) => [p.date, '出来事の印']));
      const fs = ((s.impact || {}).factors || []).filter((x) => x && (x.label || x.text));
      ['better', 'worse'].forEach((k) => { const col = main.querySelector(`[data-factor="${k}"]`); if (fs.length && (!col || col.querySelectorAll('.fxe').length !== fs.filter((x) => x.dir === k).length)) add('要因：左右の振り分けが違う', k); });
      if (count('[data-rel]') !== (s.related || []).filter((x) => x && x.name).length) add('波及先：件数が違う', '');
    }
    if (a.type === 'hansei') {
      const e = s.entry || {}, r = s.result || {};
      if (e.date && typeof e.price === 'number') pinsIn('[data-chart="hchart"] svg', [[e.date, '購入日']], 'pin-entry');
      if (r.maxUpDate && typeof r.maxUpPct === 'number') pinsIn('[data-chart="hchart"] svg', [[r.maxUpDate, '最大含み益']], 'pin-up');
      if (r.maxDownDate && typeof r.maxDownPct === 'number') pinsIn('[data-chart="hchart"] svg', [[r.maxDownDate, '最大含み損']], 'pin-dn');
      const svg = main.querySelector('[data-chart="hchart"] svg');
      if (svg && typeof e.price === 'number' && !svg.querySelector('.entry .tagbox')) add('反省：購入価格の札が無い', '');
      if (svg) { const want = ((s.chart || {}).levels || []).filter((L) => L && typeof L.low === 'number' && typeof L.high === 'number' && Math.max(L.low, L.high) > 0).length; if (svg.querySelectorAll('.lvg').length !== want) add('反省：サポート・レジスタンスの数が違う', `${svg.querySelectorAll('.lvg').length} ≠ ${want}`); }
      const pnl = main.querySelector('[data-num="pnl"] b');
      if (typeof r.pnlPct === 'number' && (!pnl || !pnl.textContent.includes(K.fmtS(r.pnlPct, 2)))) add('反省：損益率の表示が違う', String(r.pnlPct));
      ['maxUp', 'maxDown'].forEach((k) => { const v = r[k + 'Pct'], el = main.querySelector(`[data-num="${k}"] b`); if (typeof v === 'number' && (!el || !el.textContent.includes(K.fmtS(v, 2)))) add('反省：最大含み益・含み損の表示が違う', k); });
      if (/買い|売り|良い|悪い/.test((main.querySelector('[data-sec="result"]') || {}).textContent || '')) add('反省：結果の数値に評価語がある', '');
      (s.at || []).forEach((h) => { if (h && h.key && (typeof h.value !== 'number') !== !!nd(`at:${h.key}`)) add('反省：過熱の物差しの未取得表示が不一致', h.key); });
      if (!main.querySelector('[data-hindsight]')) add('反省：「後から見た話」の注記が無い', '');
      if (count('[data-alt]') !== (s.alt || []).filter((x) => x && typeof x === 'object').length) add('反省：別の入り方の数が違う', '');
      if (count('[data-check]') !== (s.nextChecks || []).filter((x) => x && (x.label || x.how)).length) add('反省：確認カードの数が違う', '');
      if ((e.adjusted === true) !== !!main.querySelector('[data-adjusted]')) add('反省：休場日の注記が不一致', String(e.adjusted));
    }
  }
  /** その銘柄の表示中の日足の窓にその日付があるか（図の SVG の印の有無で判定せず、データで判定する） */
  function rowsHas(route, d) {
    const st = window.KABU.stocks[route.code];
    const rows = (st && st.prices && st.prices.rows) || [];
    const svgHost = document.querySelector('#main [data-chart="nchart"], #main [data-chart="hchart"]');
    const head = svgHost && svgHost.closest('.panel').querySelector('.ph .pm span');
    const m = head && /(\d{4}\.\d{2}\.\d{2}) – (\d{4}\.\d{2}\.\d{2})/.exec(head.textContent);
    if (!m) return false;
    const a = m[1].replace(/\./g, '-'), b = m[2].replace(/\./g, '-');
    return d >= a && d <= b && rows.some((r) => r && r.d === d);
  }

  /** チャート型・決算型の「未取得」と欠損の対応、図の要素が枠内にあること */
  function checkP2(a, route, add) {
    const main = document.getElementById('main'), A = app(), s = a.sections || {};
    const st = window.KABU.stocks[route.code] || {};
    const nd = (k) => main.querySelector(`[data-nodata="${k}"]`);
    const pair = (cond, key, label) => { if (cond !== !!nd(key)) add(`④ ${label}の未取得表示が不一致`, `${key}: ${cond ? '欠損なのに表示なし' : 'データがあるのに未取得'}`); };
    const whyIn = (key, sec) => { const el = nd(key), why = A.missFor(a, sec); if (el && why && !el.textContent.includes(why)) add('④ 未取得の理由が missing と違う', `${key}: ${why}`); };
    checkType(add);
    checkSvgText(add);
    if (a.type === 'chart') {
      (s.heat || []).forEach((h) => { if (h && h.key) pair(typeof h.value !== 'number', `heat:${h.key}`, '過熱の物差し'); });
      if ((st.prices && st.prices.rows || []).length) pair(!(st.indicators && typeof st.indicators === 'object'), 'indicators', '移動平均・価格帯別出来高');
      else if (!nd('price')) add('④ 株価が無いのにメインチャートの未取得表示が無い', '');
      pair(!!A.missFor(a, 'timeframes'), 'timeframes:note', '時間軸の注記');
      whyIn('timeframes:note', 'timeframes');
      // 図：時間軸3連・メインチャート・3レーン
      const tfs = [...main.querySelectorAll('[data-chart="tf"]')];
      if (tfs.length !== 3) add('時間軸：小チャートが3つでない', String(tfs.length));
      const I = st.indicators || null, nRows = (st.prices && st.prices.rows || []).length;
      tfs.forEach((h) => {
        const k = h.dataset.k, n = h.querySelectorAll('.cdl > rect').length;
        const want = k === 'daily' ? nRows > 0 : !!(I && (I[k] || []).length);
        if (want && !n) add('時間軸：ローソク足が描かれていない', k);
        if (!want && n) add('時間軸：データが無いのに足がある', k);
      });
      const lv = main.querySelector('svg.lvchart');
      if (nRows && !lv) add('メインチャートが描かれていない', '');
      if (lv) {
        const W = lv.viewBox.baseVal.width, H = lv.viewBox.baseVal.height;
        (s.levels || []).forEach((L, i) => { if (L && typeof L.low === 'number' && !lv.querySelector(`.lvg[data-lv="${i}"]`)) add('メインチャート：レベルの線・札が無い', String(i)); });
        lv.querySelectorAll('.lvg').forEach((g) => { const b = g.getBBox(); if (b.x < -1 || b.y < -1 || b.x + b.width > W + 1 || b.y + b.height > H + 1) add('メインチャート：レベルが枠外', g.dataset.lv); });
        const vpb = [...lv.querySelectorAll('.vpbar')];
        if (I && I.volumeProfile && (I.volumeProfile.bins || []).length && !vpb.length) add('価格帯別出来高が描かれていない', '');
        const tags = [...lv.querySelectorAll('.tagtxt')].map((t) => t.getBBox());
        tags.forEach((t, i) => { if (tags.some((u, j) => j > i && t.x < u.x + u.width && t.x + t.width > u.x && t.y < u.y + u.height - 0.5 && t.y + t.height > u.y + 0.5)) add('メインチャート：右端の札どうしが重なる', String(i)); });
      }
      const pl = main.querySelector('[data-chart="plans"] svg');
      if (!pl) add('考え方の3レーンが描かれていない', '');
      else {
        const W = pl.viewBox.baseVal.width, H = pl.viewBox.baseVal.height, r = pl.getBoundingClientRect();
        if (r.left < document.getElementById('rail').getBoundingClientRect().right - 1 || r.right > window.innerWidth + 1) add('考え方：図が画面外にはみ出す', '');
        const inside = (el, what) => { const b = el.getBBox(); if (b.x < -1 || b.y < -1 || b.x + b.width > W + 1 || b.y + b.height > H + 1) add('考え方：要素が枠外', what); };
        if (pl.querySelectorAll('.pl-lane').length !== 3) add('考え方：レーンが3本でない', '');
        (s.plans || []).forEach((p, i) => {
          if (!p) return;
          const z = p.zone || {};
          const want = [['pl-zone', typeof z.low === 'number' || typeof z.high === 'number'], ['pl-stop', p.stop && typeof p.stop.price === 'number'], ['pl-tgt', p.target && typeof p.target.price === 'number']];
          const idx = ['pullback', 'breakout', 'wait'].indexOf(p.kind);
          want.forEach(([cls, w]) => { const el = pl.querySelector(`.${cls}[data-p="${idx}"]`); if (!!w !== !!el) add('考え方：価格の線・帯の有無が違う', `${p.kind} ${cls}`); if (el) inside(el, `${p.kind} ${cls}`); });
        });
        const now = pl.querySelector('.pl-now');
        if (typeof (a.price || {}).close === 'number' && !now) add('考え方：現在値の線が無い', '');
        if (now) inside(now, '現在値');
        pl.querySelectorAll('.pl-lab').forEach((t) => inside(t, t.textContent));
        const labs = [...pl.querySelectorAll('.pl-lab')].map((t) => t.getBBox());
        labs.forEach((t, i) => { if (labs.some((u, j) => j > i && t.x < u.x + u.width && t.x + t.width > u.x && t.y < u.y + u.height - 1 && t.y + t.height > u.y + 1)) add('考え方：ラベルどうしが重なる', String(i)); });
      }
    }
    if (a.type === 'kessan') {
      (s.results || []).forEach((r, i) => { if (r) pair(typeof r.value !== 'number', `results:${r.key || i}`, '主要数値'); });
      (s.results || []).forEach((r, i) => { if (r) whyIn(`results:${r.key || i}`, 'results'); });
      const pg = s.progress || {};
      pair(typeof pg.pct !== 'number', 'progress', '進捗率');
      const m = s.margin || {};
      pair(typeof m.pct !== 'number' && typeof m.prevPct !== 'number', 'margin', '利益率');
      pair(!m.peer, 'margin:peer', '同業比較');
      whyIn('margin:peer', 'margin');
      ((s.outlook || {}).forecast || []).forEach((x, i) => { if (x) pair(typeof x.value !== 'number', `outlook:${i}`, '通期予想'); });
      ((s.finance || {}).items || []).forEach((x, i) => { if (x) pair(typeof x.prev !== 'number' || typeof x.curr !== 'number', `finance:${i}`, '財務'); });
      if (A.secAbsent(a, 'segments')) { pair(!!A.missFor(a, 'segments'), 'segments', '稼ぎ頭'); whyIn('segments', 'segments'); }
      // 進捗リング：pct と均等ペースの位置（角度）
      const ring = main.querySelector('svg.pr-ring');
      if (typeof pg.pct === 'number' && !ring) add('進捗リングが無い', '');
      if (ring) {
        const cx = +ring.dataset.cx, cy = +ring.dataset.cy;
        const ang = (x, y) => (Math.atan2(x - cx, -(y - cy)) * 180 / Math.PI + 360) % 360;
        const pace = typeof pg.pace === 'number' ? pg.pace : null;
        const tick = ring.querySelector('.pr-pace');
        if (pace != null) {
          if (!tick) add('進捗リング：均等ペースの目盛りが無い', '');
          else { const g = ang(+tick.getAttribute('x2'), +tick.getAttribute('y2')), want = Math.min(Math.max(pace, 0), 100) * 3.6 % 360; if (Math.min(Math.abs(g - want), 360 - Math.abs(g - want)) > 1.2) add('進捗リング：均等ペースの位置が違う', `${g.toFixed(1)}° ≠ ${want.toFixed(1)}°`); }
        }
        const end = ring.querySelector('.pr-end');
        const pc = Math.min(Math.max(pg.pct, 0), 100);
        if (pc > 0 && !end) add('進捗リング：進捗の弧が無い', '');
        if (end) { const g = ang(+end.getAttribute('cx'), +end.getAttribute('cy')), want = pc * 3.6 % 360; if (Math.min(Math.abs(g - want), 360 - Math.abs(g - want)) > 1.2) add('進捗リング：進捗の位置が違う', `${g.toFixed(1)}° ≠ ${want.toFixed(1)}°`); }
        if ((pg.pct > 100) !== !!ring.querySelector('.pr-over')) add('進捗リング：100%超の表示が不一致', String(pg.pct));
        if (!ring.textContent.includes(String(Math.round(pg.pct * 10) / 10).replace(/\B(?=(\d{3})+(?!\d))/g, ','))) add('進捗リング：中央の数値が pct と違う', String(pg.pct));
      }
      // 中計のブレットチャート：帯・実績・予想の印が軸の中、文字が枠内で重ならない、判定バッジがデータと一致
      const K = window.KABU_CHARTS, tg = (((s.deep || {}).plan || {}).targets || []).filter((x) => x && typeof x === 'object');
      const rows = [...main.querySelectorAll('[data-sec="deep"] .kbr')];
      if (s.deep && rows.length !== tg.length) add('3点読み：目標の行数が違う', `${rows.length} ≠ ${tg.length}`);
      rows.forEach((row, i) => {
        const t = tg[i], m = t ? K.bulletModel(t) : null, lab = (t && t.label) || String(i);
        const rbl = row.querySelector('.rbl');
        if (!!m !== !!rbl) add('3点読み：数値があるのに図が無い／無いのに図がある', lab);
        if (!m && !row.querySelector('.bl.nil')) add('3点読み：「数値の比較なし」が無い', lab);
        if (!rbl) return;
        const tr = rbl.querySelector('.rbt').getBoundingClientRect(), box = row.getBoundingClientRect();
        rbl.querySelectorAll('.rb-band, .rb-tl, .rb-a, .rb-f').forEach((e) => { const r = e.getBoundingClientRect(); const cx = r.width ? (r.left + r.right) / 2 : r.left; if (cx < tr.left - 1 || cx > tr.right + 1 || (e.classList.contains('rb-band') && (r.left < tr.left - 1 || r.right > tr.right + 1))) add('3点読み：印が軸の外', `${lab} ${e.className}`); });
        const want = [['rb-a', m.actual], ['rb-f', m.forecast]];
        want.forEach(([c, v]) => { if ((v != null) !== !!rbl.querySelector('.' + c)) add('3点読み：実績・予想の印の有無が違う', `${lab} ${c}`); });
        if ((m.lo != null) !== !!rbl.querySelector('.rb-band, .rb-tl')) add('3点読み：目標の帯・線の有無が違う', lab);
        const texts = [...rbl.querySelectorAll('.rb-lab, .rbs span')].map((e) => [e.getBoundingClientRect(), e.textContent]);
        texts.forEach(([r, tx], k) => {
          if (r.left < box.left - 1 || r.right > box.right + 1) add('3点読み：文字が枠からはみ出す', `${lab} ${tx}`);
          texts.forEach(([q, ty], j) => { if (j > k && r.left < q.right - 1 && r.right > q.left + 1 && r.top < q.bottom - 1 && r.bottom > q.top + 1) add('3点読み：文字が重なる', `${lab} ${tx} / ${ty}`); });
        });
        const st = [...row.querySelectorAll('.rbg')].map((e) => e.dataset.status).join(',');
        const exp = [m.sActual, m.sForecast].filter(Boolean).map((x) => x.k).join(',');
        if (st !== exp) add('3点読み：判定バッジがデータと違う', `${lab} ${st} ≠ ${exp}`);
      });
      // 主要数値：前年の逆算（yoyPct があれば前年の棒、なければ今期だけ）
      main.querySelectorAll('[data-chart="pair"]').forEach((h) => {
        const r = (s.results || [])[+h.dataset.i] || {}, n = h.querySelectorAll('svg text.cur').length, pv = [...h.querySelectorAll('svg text')].some((t) => t.textContent.startsWith('≈'));
        if (n !== 1) add('主要数値：今期の値が無い', r.label || '');
        if (pv !== (typeof r.yoyPct === 'number' && r.yoyPct > -100)) add('主要数値：前年の棒の有無が違う', r.label || '');
      });
    }
  }

  /** チャート型・決算型の操作：サポレジ行の選択→チャート強調、チェックリストのセル→理由カードの強調。最後は初期状態に戻す */
  function checkInteractionsP2(route, a, add) {
    const A = app(), main = document.getElementById('main');
    if (a.type === 'chart') {
      const svg = () => main.querySelector('svg.lvchart');
      if (svg()) main.querySelectorAll('.lvr').forEach((r) => {
        r.click();
        const g = svg() && svg().querySelector(`.lvg[data-lv="${r.dataset.lv}"]`);
        if (!svg() || !svg().classList.contains('hl') || !g || !g.classList.contains('on')) add('サポレジ：行を選んでもチャートが強調されない', r.dataset.lv);
        if (svg() && svg().querySelectorAll('.lvg.on').length !== 1) add('サポレジ：強調が1本でない', r.dataset.lv);
        if (r.getAttribute('aria-pressed') !== 'true') add('サポレジ：選んだ行の aria-pressed が true でない', r.dataset.lv);
        if (g) { const b = g.getBoundingClientRect(); if (!(b.width > 0 && b.height > 0)) add('サポレジ：強調した線が見えない', r.dataset.lv); }
        r.click();
        if (svg() && (svg().classList.contains('hl') || svg().querySelector('.lvg.on'))) add('サポレジ：もう一度押しても強調が解除されない', r.dataset.lv);
      });
      if (A.lvState() != null) add('サポレジ：選択が初期状態に戻らない', String(A.lvState()));
      main.querySelectorAll('.ck10 .ck').forEach((c) => {
        c.click();
        const card = main.querySelector(`.cr[data-why="${c.dataset.ck}"]`);
        const it = A.ckState().items.find((x) => x.id === c.dataset.ck);
        if (it && ['done', 'progress', 'none'].includes(it.status) && (!card || !card.classList.contains('sel'))) add('チェックリスト：セルを押しても理由カードが強調されない', c.dataset.ck);
        c.click();
      });
      if (main.querySelector('.cr.sel')) add('チェックリスト：強調が初期状態に戻らない', '');
      // 10項目の reason がすべて読める（状態別の列に1回ずつ）
      A.ckState().items.forEach((x) => { if (['done', 'progress', 'none'].includes(x.status) && main.querySelectorAll(`.cr[data-why="${x.id}"]`).length !== 1) add('チェックリスト：理由カードが1枚でない', x.id); });
    }
  }

  /** 操作の検査：稼ぎ頭の展開（他パネルが動かない・全事業が画面内）とチェックリストの理由。最後は閉じた初期状態に戻す */
  function checkInteractions(route, add) {
    const A = app(), main = document.getElementById('main');
    const D = window.KABU, st = D.stocks[route.code];
    if (route.view === 'market') { checkMarketRange(add); return; }
    const a = st && (st.analyses || []).find((x) => x.type === (route.type || 'quick') && (!route.date || x.date === route.date));
    if (!a || !['quick', 'chart', 'kessan'].includes(route.type || 'quick')) return;
    if (a.type !== 'quick') checkInteractionsP2(route, a, add);
    const rects = () => [...main.querySelectorAll('[data-sec]')].map((p) => { const r = p.getBoundingClientRect(); return [p.dataset.sec, Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(':'); }).join('|');
    const segs = (a.sections && a.sections.segments || []).filter((x) => x && x.name);
    const btn = main.querySelector('.srow.other[data-seg-toggle]');
    if (segs.length >= 5 && !btn) add('稼ぎ頭：5事業以上なのに展開ボタンが無い', String(segs.length));
    if (segs.length < 5 && btn) add('稼ぎ頭：4事業以下なのに展開ボタンがある', String(segs.length));
    if (btn) {
      const before = rects(), sw0 = document.documentElement.scrollWidth;
      btn.click();
      const pop = document.getElementById('seg-pop');
      if (!pop) add('稼ぎ頭：押しても開かない', '');
      else {
        if (btn.getAttribute('aria-expanded') !== 'true') add('稼ぎ頭：aria-expanded が true にならない', '');
        if (document.activeElement !== pop.querySelector('.sp-list')) add('稼ぎ頭：開いた後のフォーカスが一覧に無い', String(document.activeElement && document.activeElement.className));
        const rows = [...pop.querySelectorAll('.sp-r')];
        if (rows.length !== Math.min(segs.length, 8)) add('稼ぎ頭：一覧の行数が違う', `${rows.length}`);
        const pr = pop.getBoundingClientRect(), rail = document.getElementById('rail').getBoundingClientRect().right;
        if (pr.left < rail - 1 || pr.right > window.innerWidth + 1) add('稼ぎ頭：展開パネルが画面外にはみ出す', `${Math.round(pr.left)}〜${Math.round(pr.right)}`);
        const pair = main.querySelector('.pair').getBoundingClientRect(), seg = main.querySelector('[data-sec="segments"]').getBoundingClientRect();
        if (Math.abs(pr.right - seg.right) > 1 || Math.abs(pr.left - pair.left) > 1) add('稼ぎ頭：展開パネルの位置（右端固定・2枠ぶん）が違う', `${Math.round(pr.left)}/${Math.round(pair.left)} ${Math.round(pr.right)}/${Math.round(seg.right)}`);
        rows.forEach((r, i) => { const b = r.getBoundingClientRect(); if (!(b.width > 0 && b.height > 0) || b.right > pr.right + 1 || b.bottom > pr.bottom + 1) add('稼ぎ頭：一覧の行が見えない／枠外', String(i + 1)); });
        pop.querySelectorAll('.sp-r .nm b, .sp-r .pf').forEach((e) => { if (e.scrollWidth > e.clientWidth + 1) add('稼ぎ頭：一覧の文字が切れている', e.textContent); });
        const names = rows.map((r) => r.querySelector('.nm b').textContent);
        const want = [...segs].sort((x, y) => (y.profit ?? -Infinity) - (x.profit ?? -Infinity)).slice(0, 8).map((x) => x.name);
        if (names.join('|') !== want.join('|')) add('稼ぎ頭：一覧の並び（利益の大きい順）が違う', names.join(','));
        if (rects() !== before) add('稼ぎ頭：開くと他のパネルが動く', '');
        if (document.documentElement.scrollWidth > window.innerWidth || document.documentElement.scrollWidth > Math.max(sw0, window.innerWidth)) add('稼ぎ頭：開くと横スクロールが出る', '');
        const bad = pop.innerHTML.match(/NaN|undefined|Infinity/);
        if (bad) add('稼ぎ頭：展開パネルに不正値', bad[0]);
        // 閉じ方：Esc
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        if (document.getElementById('seg-pop')) add('稼ぎ頭：Esc で閉じない', '');
        if (document.activeElement !== btn) add('稼ぎ頭：閉じた後のフォーカスがボタンに戻らない', '');
        // 閉じ方：枠外クリック・×ボタン・同じボタン（たたむ）
        btn.click(); main.querySelector('.sh').click();
        if (document.getElementById('seg-pop')) add('稼ぎ頭：枠外クリックで閉じない', '');
        btn.click(); const x = document.querySelector('#seg-pop [data-seg-close]'); if (x) x.click();
        if (document.getElementById('seg-pop')) add('稼ぎ頭：×で閉じない', '');
        btn.click(); const fold = document.querySelector('#seg-pop .sp-fold'); if (fold) fold.click();
        if (document.getElementById('seg-pop')) add('稼ぎ頭：たたむボタンで閉じない', '');
        btn.click(); btn.click();
        if (document.getElementById('seg-pop')) add('稼ぎ頭：同じボタンで閉じない', '');
        if (rects() !== before) add('稼ぎ頭：閉じても元の位置・大きさに戻らない', '');
        if (btn.getAttribute('aria-expanded') !== 'false') add('稼ぎ頭：閉じても aria-expanded が false にならない', '');
      }
    }
    // チェックリスト：セルを順に押すと、理由欄にその項目の reason が出る。もう一度押すと既定に戻る
    const cells = a.type === 'quick' ? [...main.querySelectorAll('.ckg .ck')] : [];
    const why = main.querySelector('[data-ck-why]');
    if (cells.length && !why) add('チェックリスト：理由欄が無い', '');
    if (cells.length && why) {
      const items = A.ckState().items;
      const prog = items.filter((x) => x.status === 'progress');
      const defIds = (prog.length ? prog : items.filter((x) => x.status === 'done').slice(-2).reverse()).map((x) => x.id);
      const shown = () => [...why.querySelectorAll('[data-why]')].map((e) => e.dataset.why).join(',');
      if (shown() !== defIds.join(',')) add('チェックリスト：初期表示の理由が規則と違う', `${shown()} ≠ ${defIds.join(',')}`);
      const h0 = main.querySelector('[data-sec="checklist"]').getBoundingClientRect().height;
      cells.forEach((c) => {
        c.click();
        const it = items.find((x) => x.id === c.dataset.ck);
        if (!c.classList.contains('sel') || c.getAttribute('aria-pressed') !== 'true') add('チェックリスト：選んだセルが強調されない', c.dataset.ck);
        if (shown() !== c.dataset.ck || (it && it.reason && !why.textContent.includes(it.reason))) add('チェックリスト：理由欄に選んだ項目の reason が出ない', c.dataset.ck);
        const pi = main.querySelector('[data-sec="checklist"] > .pi');
        if (pi.scrollHeight > pi.clientHeight + 1) add('チェックリスト：理由が枠で切れる', c.dataset.ck);
        main.querySelectorAll('[data-chart]').forEach((h) => { const r = h.querySelector('svg') && h.querySelector('svg').getBoundingClientRect(); if (!r || Math.abs(r.height - h.clientHeight) > 1.5 || Math.abs(r.width - h.clientWidth) > 1.5) add('チェックリスト：理由欄の開閉で図が描き直されない', `${h.dataset.chart} ${c.dataset.ck}`); });
        c.click();
      });
      if (shown() !== defIds.join(',')) add('チェックリスト：もう一度押しても既定に戻らない', shown());
      if (Math.abs(main.querySelector('[data-sec="checklist"]').getBoundingClientRect().height - h0) > 1) add('チェックリスト：操作後に高さが元に戻らない', '');
    }
  }

  /** 市場の折れ線の期間切替：押すと図が描き直され（期間が変わる）、最後は初期の期間に戻す */
  function checkMarketRange(add) {
    const A = app(), main = document.getElementById('main');
    const host = main.querySelector('[data-chart="mkchart"]');
    if (!host) return;
    const init = A.mkState();
    const btns = [...main.querySelectorAll('[data-mk-range]')];
    if (btns.length !== 3) add('市場：期間の切替が3つでない', String(btns.length));
    btns.forEach((b) => {
      b.click();
      const svg = host.querySelector('svg');
      if (host.dataset.range !== b.dataset.mkRange || b.getAttribute('aria-pressed') !== 'true') add('市場：期間の切替が反映されない', b.dataset.mkRange);
      if (!svg || !svg.getAttribute('aria-label').includes(window.KABU_CHARTS.RANGES[b.dataset.mkRange][1])) add('市場：期間を切り替えても図が描き直されない', b.dataset.mkRange);
      if (svg && BAD.test(svg.innerHTML)) add('市場：期間を切り替えた図に不正値', b.dataset.mkRange);
      if (main.querySelectorAll('[data-mk-range][aria-pressed="true"]').length !== 1) add('市場：選択中の期間が1つでない', b.dataset.mkRange);
    });
    A.mkSetRange(init);
    if (A.mkState() !== init || host.dataset.range !== init) add('市場：期間が初期状態に戻らない', String(A.mkState()));
  }


  /* ---------- P5a：自動更新の表示（更新時刻と内訳・最新の見出し・鮮度の印・市場の版） ---------- */
  const isP5a = (fx) => fx && typeof fx === 'object' && fx.schema === 'kabu-p5a-fixture@1';
  const agoIso = (min, now) => (typeof min === 'number' ? new Date(now - min * 60e3).toISOString() : null);
  /** フィクスチャ → {refresh, headlines}。hl: fresh / old / none、rf: ok / fail / none */
  function p5aData(fx, v, now = Date.now()) {
    const shift = v.hl === 'old' ? 4 * 1440 : 0; // 古い見出し：4日前に取得
    const headlines = v.hl === 'none' ? null : { fetchedAt: agoIso(fx.headlines.agoMin + shift, now), sources: clone(fx.headlines.sources), items: fx.headlines.items.map((x) => ({ title: x.title, url: x.url, source: x.source, publishedAt: agoIso(x.agoMin == null ? null : x.agoMin + shift, now) })) };
    const r = v.rf === 'ok' ? fx.refreshOk : v.rf === 'fail' ? fx.refreshFail : null;
    const refresh = r ? { at: agoIso(r.agoMin, now), finishedAt: agoIso(r.agoMin - r.took / 60, now), steps: clone(r.steps), stocks: clone(r.stocks) } : null;
    return { refresh, headlines };
  }
  /** 鮮度の印の検査用に、全分析へ _age を順に割り当てる（list の値を巡回） */
  function setAges(D, list) {
    let i = 0;
    Object.values(D.stocks || {}).forEach((st) => (st.analyses || []).forEach((a) => { if (a && typeof a === 'object') a._age = list[i++ % list.length]; }));
    ((D.market && D.market.analyses) || []).forEach((a) => { if (a && typeof a === 'object') a._age = list[i++ % list.length]; });
    if (D.market && D.market.analyses) D.market.analysis = D.market.analyses[0] || null;
  }
  const P5A_VARIANTS = [
    { name: '見出しあり・一部失敗・鮮度 3/12/0/null', hl: 'fresh', rf: 'fail', ages: [3, 12, 0, null], ed: 'pre' },
    { name: '古い見出し・全部成功・鮮度 0', hl: 'old', rf: 'ok', ages: [0], ed: 'post' },
    { name: '見出しなし・refresh なし・鮮度 null', hl: 'none', rf: 'none', ages: [null], ed: null },
    { name: '市場の分析なし（raw だけ）・見出しあり', hl: 'fresh', rf: 'ok', ages: [5, 1], ed: null, noMarketAnalysis: true },
  ];
  const fontPx = (el) => parseFloat(getComputedStyle(el).fontSize);
  /** 文字を持つ要素の最小文字（12px 未満を積む） */
  function minFont(root, add, label) {
    root.querySelectorAll('*').forEach((el) => { if ([...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim()) && fontPx(el) < 11.95) add(`${label}：最小文字12px未満`, `${fontPx(el)}px ${el.textContent.trim().slice(0, 12)}`); });
  }
  function checkP5a(route, v, fx, add) {
    const A = app(), D = window.KABU, main = document.getElementById('main');
    // ヘッダのデータ更新
    const u = document.querySelector('#top .upd');
    if (!D.refresh) { if (u) add('更新時刻：refresh が無いのに出ている', ''); }
    else {
      const p = A.jstParts(D.refresh.at);
      if (!u || !visible(u.querySelector('.updb'))) add('更新時刻：表示されない', v.name);
      else {
        const txt = u.querySelector('.updb').textContent;
        if (!txt.includes(`データ更新 ${p.md} ${p.hm}`)) add('更新時刻：時刻の表示が違う', txt);
        const fail = D.refresh.steps.some((s) => !s.ok) || D.refresh.stocks.some((s) => !s.ok);
        if (fail !== txt.includes('一部失敗')) add('更新時刻：一部失敗の表示が違う', `${fail} / ${txt}`);
        if (fail !== (u.dataset.refresh === 'fail')) add('更新時刻：data-refresh が違う', u.dataset.refresh);
        if (fail && getComputedStyle(u.querySelector('.updb em')).backgroundColor !== 'rgb(255, 179, 64)') add('更新時刻：一部失敗が注意色でない', '');
        const pop = u.querySelector('.upd-pop');
        if (visible(pop)) add('更新時刻：内訳が最初から開いている', '');
        A.updSet(true);
        if (!visible(pop)) add('更新時刻：押しても内訳が開かない', '');
        else {
          const r = pop.getBoundingClientRect();
          if (r.right > window.innerWidth + 1 || r.left < 0 || r.bottom > window.innerHeight + 1) add('更新時刻：内訳が画面からはみ出す', `${Math.round(r.left)}-${Math.round(r.right)} / ${Math.round(r.bottom)}`);
          D.refresh.steps.forEach((s) => { const li = pop.querySelector(`[data-step="${s.key}"]`); if (!li || li.classList.contains('ng') === s.ok) add('更新時刻：手順の成否が内訳と違う', s.key); });
          D.refresh.stocks.forEach((s) => { const li = pop.querySelector(`[data-step-stock="${s.code}"]`); if (!li || li.classList.contains('ng') === s.ok || (!s.ok && !li.textContent.includes(s.message.slice(0, 20)))) add('更新時刻：銘柄の成否・理由が内訳に無い', s.code); });
          minFont(pop, add, '更新時刻の内訳');
          if (document.documentElement.scrollWidth > window.innerWidth) add('更新時刻：内訳を開くと横スクロール', '');
        }
        A.updSet(false);
        if (visible(pop) && !u.matches(':hover') && !u.matches(':focus-within')) add('更新時刻：内訳が閉じない', '');
        if (u.querySelector('[aria-expanded="true"]')) add('更新時刻：閉じても aria-expanded が true', '');
      }
    }
    // 鮮度の印
    const badge = (a) => (a && typeof a._age === 'number' && a._age > 0 ? (a._age >= 5 ? 'old' : 'soft') : '');
    const badgeOk = (el, a, where) => {
      const want = badge(a), got = el ? (el.classList.contains('old') ? 'old' : 'soft') : '';
      if (want !== got) add('鮮度の印：表示が違う', `${where} 期待=${want || 'なし'} 実際=${got || 'なし'}`);
      if (el && want && !el.textContent.includes(`${a._age}営業日前の分析`)) add('鮮度の印：文言が違う', el.textContent);
      if (el && !visible(el)) add('鮮度の印：見えない', where);
    };
    if (route.view === 'home') {
      main.querySelectorAll('[data-sec="library"] tr[data-href]').forEach((tr) => {
        const code = decodeURIComponent(tr.dataset.href.split('/')[2] || ''), st = D.stocks[code];
        badgeOk(tr.querySelector('.age'), st && (st.analyses || [])[0], `ホーム ${code}`);
      });
    }
    if (route.view === 'stock') {
      const st = D.stocks[route.code], a = st && (st.analyses || []).find((x) => x.type === (route.type || 'quick') && (!route.date || x.date === route.date));
      badgeOk(main.querySelector('.tabs .age'), a, `銘柄 ${route.code}`);
    }
    if (route.view === 'market') {
      const a = marketAnalysis(D, route);
      badgeOk(main.querySelector('.mk-sh .age'), a, '市場');
      const ed = a && a.sections && A.EDITION[a.sections.edition];
      const edEl = main.querySelector('.mk-sh [data-edition]');
      if (!!ed !== !!edEl || (edEl && edEl.textContent !== ed)) add('市場：版（寄り付き前・大引け後）の表示が違う', `${ed || 'なし'} / ${edEl ? edEl.textContent : 'なし'}`);
      // 最新の見出し
      const pn = main.querySelector('[data-sec="headlines"]'), H = D.market && D.market.headlines;
      const items = H ? (H.items || []).filter((x) => x && typeof x.title === 'string' && x.title.trim()) : [];
      if (!visible(pn)) add('見出し：枠が見えない', v.name);
      else if (!items.length) { if (!pn.querySelector('[data-standby="headlines"]') || !/node tools\/refresh\.mjs/.test(pn.textContent)) add('見出し：未実行の案内が無い', ''); }
      else {
        const lis = [...pn.querySelectorAll('li.hl')];
        if (lis.length !== items.length) add('見出し：件数が違う', `${lis.length} ≠ ${items.length}`);
        const shown = () => lis.filter((li) => visible(li)).length;
        if (shown() !== Math.min(A.HL_FIRST, items.length)) add('見出し：最初に見える件数が違う', String(shown()));
        // XSS：題名のタグは要素にならず、javascript: はリンクにならない
        if (pn.querySelector('img, script, iframe, [onerror], [onload]') || document.querySelector('#main [onerror]') || window.__KABU_XSS) add('見出し：XSS（題名から要素が作られた）', '');
        lis.forEach((li, i) => {
          const it = items[i], a2 = li.querySelector('a');
          const http = /^https?:\/\//i.test(String(it.url || '').trim());
          if (http !== !!a2) add('見出し：リンクの有無が URL と合わない', it.url);
          if (a2 && (!/^https?:\/\//.test(a2.getAttribute('href')) || a2.target !== '_blank' || a2.rel !== 'noopener')) add('見出し：外部リンクの属性が違う', a2.getAttribute('href'));
          if (li.querySelector('.hlt').textContent !== it.title) add('見出し：題名がそのまま表示されない', it.title.slice(0, 20));
          if (!li.querySelector('.hls') || li.querySelector('.hls').textContent !== (it.source || '出典不明')) add('見出し：出典名が無い', String(i));
          const p = A.jstParts(it.publishedAt), want = p ? (p.day === new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) ? p.hm : p.md) : '—';
          if (li.querySelector('time').textContent !== want) add('見出し：時刻の表示が違う', `${li.querySelector('time').textContent} ≠ ${want}`);
        });
        const old = Date.now() - Date.parse(H.fetchedAt) >= 3 * 864e5;
        if (old !== !!pn.querySelector('[data-hl-old]')) add('見出し：古い見出しの表示が違う', String(old));
        if ((H.sources || []).some((x) => x && x.ok === false) !== !!pn.querySelector('[data-hl-failed]')) add('見出し：取得できなかった出典の表示が違う', '');
        // 今日のニュース（解説つき）とは別枠
        if (pn.closest('[data-sec="news"]') || pn.querySelector('.nwc')) add('見出し：今日のニュースと混ざっている', '');
        const more = pn.querySelector('[data-hl-more]');
        if (items.length > A.HL_FIRST) {
          if (!more) add('見出し：「もっと見る」が無い', '');
          else {
            more.click();
            if (shown() !== items.length) add('見出し：もっと見るで全件が見えない', String(shown()));
            if (document.documentElement.scrollWidth > window.innerWidth) add('見出し：全件表示で横スクロール', '');
            const pi = pn.querySelector('.pi');
            if (pi.scrollHeight > pi.clientHeight + 1) add('見出し：全件表示で枠が切れる', `${pi.scrollHeight}>${pi.clientHeight}`);
            more.click();
            if (shown() !== A.HL_FIRST || more.getAttribute('aria-expanded') !== 'false') add('見出し：閉じても初期状態に戻らない', String(shown()));
          }
        } else if (more) add('見出し：12件以下なのに「もっと見る」がある', '');
        minFont(pn, add, '見出し');
      }
    }
  }
  /** P5a の表示の組み合わせ（見出し・refresh・鮮度）でホーム・市場・各銘柄の最新の分析を描いて検査する */
  function runP5a(fx, base, failures, counters) {
    const A = app();
    P5A_VARIANTS.forEach((v) => {
      const D = clone(base);
      const d = p5aData(fx, v);
      D.refresh = d.refresh;
      D.market = D.market && typeof D.market === 'object' ? D.market : { raw: null, analysis: null, analyses: [], series: null };
      D.market.headlines = d.headlines;
      if (v.noMarketAnalysis) { D.market.analyses = []; D.market.analysis = null; }
      setAges(D, v.ages);
      (D.market.analyses || []).forEach((a, i) => { if (a && a.sections) { if (v.ed && i === 0) a.sections.edition = v.ed; else delete a.sections.edition; } });
      window.KABU = D;
      const routes = [{ view: 'home' }, { view: 'market', date: null }];
      Object.keys(D.stocks).forEach((code) => { const a = (D.stocks[code].analyses || [])[0]; if (a) routes.push({ view: 'stock', code, type: a.type, date: a.date }); });
      routes.forEach((route) => {
        const label = `[P5a ${v.name}] ${routeLabel(route)}`;
        let n = 0;
        const addF = (check, detail) => { n++; failures.push({ route: label, check, detail }); };
        try {
          A.render(route);
          counters.pages++;
          checkPage(route, addF);
          checkP5a(route, v, fx, addF);
        } catch (e) {
          addF('描画で例外', String(e && e.stack ? e.stack : e).slice(0, 300));
        }
        if (!n) counters.pass++;
      });
    });
  }
  /** 検査対象の画面一覧（ホーム、各銘柄の全分析、分析の無い型タブ、存在しない銘柄） */
  function routesOf(D) {
    const A = app();
    const routes = [{ view: 'home' }];
    Object.keys(D.stocks).forEach((code) => {
      const ans = (D.stocks[code].analyses || []).filter((x) => x && typeof x === 'object');
      ans.forEach((x) => routes.push({ view: 'stock', code, type: x.type, date: x.date }));
      A.TYPES.forEach((t) => { if (!ans.some((x) => x.type === t.key)) routes.push({ view: 'stock', code, type: t.key, date: null }); });
    });
    routes.push({ view: 'stock', code: '0000', type: null, date: null });
    routes.push({ view: 'market', date: null });
    ((D.market && D.market.analyses) || []).filter((x) => x && x.type === 'market').forEach((x) => routes.push({ view: 'market', date: x.date }));
    // 用語帳：一覧・詳しい解説つきの語（最大6）・解説の無い語・無い語。気づきノート
    const g = glossOf(D);
    routes.push({ view: 'glossary', term: null });
    g.filter((t) => t.detail && typeof t.detail === 'object').slice(0, 6).forEach((t) => routes.push({ view: 'glossary', term: t.term }));
    const plain = g.find((t) => !(t.detail && typeof t.detail === 'object'));
    if (plain) routes.push({ view: 'glossary', term: plain.term });
    routes.push({ view: 'glossary', term: '検査用の存在しない語' });
    routes.push({ view: 'notes' });
    return routes;
  }

  function runAll(opts = {}) {
    const A = app();
    if (!A) return { pass: 0, fail: 1, failures: [{ route: '-', check: '起動', detail: 'アプリが起動していない（data.js を確認）' }], pages: 0 };
    const saved = { hash: location.hash, x: window.scrollX, y: window.scrollY, snap: A.snapshot(), kabu: window.KABU };
    const failures = [];
    let pass = 0, pages = 0;
    try {
      const fxList = opts.fixture ? (Array.isArray(opts.fixture) ? opts.fixture : [opts.fixture]) : [];
      const p5aFx = opts.p5a || fxList.find(isP5a) || null;
      if (fxList.length) { window.KABU = clone(saved.kabu); addAll(window.KABU, fxList.filter((x) => !isP5a(x)), opts.bare !== false); }
      // empty: 用語・ノート・答え合わせが0件のときの「未実行」表示の検査
      if (opts.empty) { window.KABU = { ...clone(window.KABU), glossary: [], notes: [], review: [] }; }
      A.setTesting(true);
      const routes = routesOf(window.KABU);
      routes.forEach((route) => {
        const label = routeLabel(route);
        let n = 0;
        try {
          A.render(route);
          pages++;
          const addF = (check, detail) => { n++; failures.push({ route: label, check, detail }); };
          checkPage(route, addF);
          if (route.view === 'stock' || route.view === 'market') checkInteractions(route, addF);
          if (route.view === 'glossary') checkGlossaryUI(addF);
          if (route.view === 'notes') checkNotesUI(addF);
        } catch (e) {
          n++;
          failures.push({ route: label, check: '描画で例外', detail: String(e && e.stack ? e.stack : e).slice(0, 300) });
        }
        if (!n) pass++;
      });
      // P5a：見出し・refresh・鮮度の組み合わせ（フィクスチャ kabu-p5a-fixture@1 を渡したとき）
      if (p5aFx) { const cnt = { pass: 0, pages: 0 }; runP5a(p5aFx, window.KABU, failures, cnt); pass += cnt.pass; pages += cnt.pages; }
    } finally {
      window.KABU = saved.kabu;
      A.restore(saved.snap);
      A.render(A.parseHash(saved.hash));
      A.restore(saved.snap);
      A.setTesting(false);
      if (location.hash !== saved.hash) history.replaceState(null, '', saved.hash || location.pathname + location.search);
      window.scrollTo(saved.x, saved.y);
    }
    return { pass, fail: failures.length ? new Set(failures.map((f) => f.route)).size : 0, failures, pages };
  }

  window.__KABU_TEST = { runAll, inject, restore, _buildReview: buildReview, checkPage: (route) => { const out = []; checkPage(route || app().current(), (check, detail) => out.push({ check, detail })); return out; } };
})();
