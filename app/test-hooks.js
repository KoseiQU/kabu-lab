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

  /** 操作の検査：稼ぎ頭の展開（他パネルが動かない・全事業が画面内）とチェックリストの理由。最後は閉じた初期状態に戻す */
  function checkInteractions(route, add) {
    const A = app(), main = document.getElementById('main');
    const D = window.KABU, st = D.stocks[route.code];
    const a = st && (st.analyses || []).find((x) => x.type === (route.type || 'quick') && (!route.date || x.date === route.date));
    if (!a || (route.type || 'quick') !== 'quick') return;
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
    const cells = [...main.querySelectorAll('.ckg .ck')];
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
          const addF = (check, detail) => { n++; failures.push({ route: label, check, detail }); };
          checkPage(route, addF);
          if (route.view === 'stock') checkInteractions(route, addF);
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
