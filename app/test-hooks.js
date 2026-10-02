/* KABU LAB — test-hooks.js
   画面の機械テスト。window.__KABU_TEST.runAll() で全銘柄×全分析（＋未実行タブ・ホーム）を順に描画して検査し、
   {pass, fail, failures:[...], pages} を返す。実行後は元のハッシュ・データ・状態へ戻す。
   欠損フィクスチャ（tests/fixtures/sparse-quick.json）は runAll({fixture}) か inject(fixture) で注入する。 */
(function () {
  'use strict';
  const BAD = /NaN|undefined|Infinity/;
  const BANNED = ['買い推奨', '売り推奨', '買うべき', '売るべき', '今が買い', '今が売り'];
  const SVG_ATTRS = ['d', 'points', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'transform', 'viewBox', 'style'];
  const QUICK_SECS = ['price', 'diagnosis', 'valuation', 'performance', 'segments', 'scenarios', 'margin', 'checklist', 'notes'];
  const ABSENT_SECS = ['diagnosis', 'performance', 'valuation', 'segments', 'scenarios', 'margin', 'checklist'];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const app = () => window.__KABU_APP;
  let backup = null;

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
  function inject(fx) {
    if (!backup) backup = clone(window.KABU);
    const codes = addCases(window.KABU, fx);
    app().render(app().parseHash(location.hash));
    return codes;
  }
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
      secs = a && type === 'quick' ? QUICK_SECS : ['empty'];
    }
    // ① 枠が存在し可視
    secs.forEach((s) => { if (!visible(main.querySelector(`[data-sec="${s}"]`))) add('① 枠が無い／見えない', s); });
    // 図の枠が空でない
    main.querySelectorAll('[data-chart]').forEach((h) => { const svg = h.querySelector('svg'); if (!svg || !(svg.getBoundingClientRect().width > 0)) add('① 図が描かれていない', h.dataset.chart); });
    // パネル見出しのはみ出し
    main.querySelectorAll('.ph').forEach((ph) => {
      const box = ph.getBoundingClientRect();
      const over = [...ph.querySelectorAll('*')].some((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.right > box.right - 1; });
      if (over) add('① 見出しがはみ出している', (ph.querySelector('h2') || {}).textContent || '');
    });
    // 文字の切れ（はみ出しを隠す枠の中で内容が収まっていない）
    main.querySelectorAll('.ck, .sc, .vg, .term, .dg, .insight, .srow, .mi, .h-mr .cg, .h-mr .vl').forEach((el) => {
      const tol = getComputedStyle(el).overflowY === 'visible' ? 4 : 1; /* 見える枠は字形のはみ出し（行高1）を許す */
      if (el.scrollHeight > el.clientHeight + tol || el.scrollWidth > el.clientWidth + 1) add('① 文字が切れている', el.textContent.trim().slice(0, 24));
    });
    // パネルの中身が枠（overflow:hidden）で切れていない
    main.querySelectorAll('.panel > .pi').forEach((pi) => {
      if (pi.scrollHeight > pi.clientHeight + 1) add('① パネルの中身が切れている', `${pi.parentElement.dataset.sec || ''} ${pi.scrollHeight}>${pi.clientHeight}`);
    });
    main.querySelectorAll('table').forEach((t) => {
      const box = t.parentElement.getBoundingClientRect(), r = t.getBoundingClientRect();
      if (r.right > box.right + 1) add('① 表が枠からはみ出している', (t.querySelector('td') || {}).textContent || '');
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
    return routes;
  }

  function runAll(opts = {}) {
    const A = app();
    if (!A) return { pass: 0, fail: 1, failures: [{ route: '-', check: '起動', detail: 'アプリが起動していない（data.js を確認）' }], pages: 0 };
    const saved = { hash: location.hash, x: window.scrollX, y: window.scrollY, snap: A.snapshot(), kabu: window.KABU };
    const failures = [];
    let pass = 0, pages = 0;
    try {
      if (opts.fixture) { window.KABU = clone(saved.kabu); addCases(window.KABU, opts.fixture); }
      A.setTesting(true);
      const routes = routesOf(window.KABU);
      routes.forEach((route) => {
        const label = route.view === 'home' ? '#/' : `#/stock/${route.code}${route.type ? '/' + route.type : ''}${route.date ? '/' + route.date : ''}`;
        let n = 0;
        try {
          A.render(route);
          pages++;
          checkPage(route, (check, detail) => { n++; failures.push({ route: label, check, detail }); });
        } catch (e) {
          n++;
          failures.push({ route: label, check: '描画で例外', detail: String(e && e.stack ? e.stack : e).slice(0, 300) });
        }
        if (!n) pass++;
      });
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

  window.__KABU_TEST = { runAll, inject, restore, checkPage: (route) => { const out = []; checkPage(route || app().current(), (check, detail) => out.push({ check, detail })); return out; } };
})();
