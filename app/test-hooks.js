/* KABU LAB — test-hooks.js
   画面の機械テスト。window.__KABU_TEST.runAll() で全銘柄×全分析（＋未実行タブ・ホーム）を順に描画して検査し、
   {pass, fail, failures:[...], pages} を返す。実行後は元のハッシュ・データ・状態へ戻す。
   フィクスチャ（tests/fixtures/sparse-quick.json・realistic-quick.json）は runAll({fixture}) か inject(fixture) で注入する（配列で複数可）。 */
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
    const codes = (Array.isArray(fx) ? fx : [fx]).flatMap((x) => addCases(window.KABU, x));
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
    main.querySelectorAll('[data-chart="price"] svg').forEach((svg) => {
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
        if (segs.every((x) => typeof x.margin !== 'number') && (/利益率/.test(panelEl.querySelector('.sg-top').textContent) || panelEl.querySelector('.mbar b'))) add('利益率が無いのに利益率の表示がある', '');
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
      if (opts.fixture) { window.KABU = clone(saved.kabu); (Array.isArray(opts.fixture) ? opts.fixture : [opts.fixture]).forEach((fx) => addCases(window.KABU, fx)); }
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
