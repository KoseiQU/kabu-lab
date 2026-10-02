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
  const CHART_SECS = ['timeframes', 'lvchart', 'levels', 'heat', 'checklist', 'plans', 'lesson', 'notes'];
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
      ], consistent: '検査用：一致の説明', realistic: '検査用：現実的かの説明' },
    };
    return a;
  }
  function addAll(target, list, bare) {
    const routes = [];
    const kd = list.find((fx) => isAnalysis(fx) && fx.type === 'kessan' && !(fx.sections && fx.sections.deep));
    if (bare && kd) routes.push(addAnalysis(target, withDeep(kd), { code: '9998', name: '検査用（株価・指標なし）' }));
    list.forEach((fx) => {
      if (isAnalysis(fx)) {
        routes.push(addAnalysis(target, fx));
        if (bare) routes.push(addAnalysis(target, fx, { code: '9998', name: '検査用（株価・指標なし）' }));
      } else addCases(target, fx).forEach((c) => routes.push({ view: 'stock', code: c, type: null, date: null }));
    });
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
  function inject(fx) {
    if (!backup) backup = clone(window.KABU);
    const routes = addAll(window.KABU, Array.isArray(fx) ? fx : [fx], false);
    app().render(app().parseHash(location.hash));
    return routes.map((r) => `#/stock/${r.code}${r.type ? '/' + r.type : ''}${r.date ? '/' + r.date : ''}`);
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
      secs = a && type === 'quick' ? QUICK_SECS : a && type === 'chart' ? CHART_SECS : a && type === 'kessan' ? kessanSecs(a) : ['empty'];
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
    main.querySelectorAll('.ck, .sc, .vg, .term, .dg, .insight, .srow, .mi, .h-mr .cg, .h-mr .vl, .tf, .lvr, .hc, .cr, .plh, .plc, .lsn, .lsx, .kpt, .krc, .kdr, .kpmc, .kfr, .kir, .kicc, .kyc, .kvc, .kbr, .knx li, .kpd, .kvl, .kft td, .krt td').forEach((el) => {
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
    if (a && (a.type === 'chart' || a.type === 'kessan')) checkP2(a, route, add);
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

  /** チャート型・決算型の「未取得」と欠損の対応、図の要素が枠内にあること */
  function checkP2(a, route, add) {
    const main = document.getElementById('main'), A = app(), s = a.sections || {};
    const st = window.KABU.stocks[route.code] || {};
    const nd = (k) => main.querySelector(`[data-nodata="${k}"]`);
    const pair = (cond, key, label) => { if (cond !== !!nd(key)) add(`④ ${label}の未取得表示が不一致`, `${key}: ${cond ? '欠損なのに表示なし' : 'データがあるのに未取得'}`); };
    const whyIn = (key, sec) => { const el = nd(key), why = A.missFor(a, sec); if (el && why && !el.textContent.includes(why)) add('④ 未取得の理由が missing と違う', `${key}: ${why}`); };
    // 最小文字 12px（SVG は表示倍率を掛けて判定）
    main.querySelectorAll('*').forEach((el) => {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) return;
      const svg = el.closest('svg'), vb = svg && svg.viewBox && svg.viewBox.baseVal;
      const k = vb && vb.width ? svg.getBoundingClientRect().width / vb.width : 1;
      const px = parseFloat(getComputedStyle(el).fontSize) * k;
      if (px < 11.95) add('最小文字12px未満', `${px.toFixed(1)}px ${el.textContent.trim().slice(0, 12)}`);
    });
    // 図の中の文字どうしが重ならない（チャート型・決算型の全図）
    main.querySelectorAll('[data-chart] svg').forEach((svg) => {
      const ts = [...svg.querySelectorAll('text')].map((t) => { const b = t.getBBox(); return [b.x, b.y + 2, b.x + b.width, b.y + b.height - 2, t.textContent]; }).filter((b) => b[2] > b[0]);
      ts.forEach((t, i) => { const o = ts.find((u, j) => j > i && t[0] < u[2] - 1 && t[2] > u[0] + 1 && t[1] < u[3] && t[3] > u[1]); if (o) add('図の文字どうしが重なる', `${svg.parentElement.dataset.chart}: ${t[4]} / ${o[4]}`); });
    });
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
      if (opts.fixture) { window.KABU = clone(saved.kabu); addAll(window.KABU, Array.isArray(opts.fixture) ? opts.fixture : [opts.fixture], opts.bare !== false); }
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
