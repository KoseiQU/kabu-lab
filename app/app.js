/* KABU LAB — app.js
   ハッシュルーティングと画面（ホーム／銘柄ページ quick）。データは window.KABU（build.mjs が生成する data.js）。
   図は charts.js（KABU_CHARTS）の純粋関数に寸法を渡して描く。fetch は使わない（file:// で動かす）。 */
(function () {
  'use strict';
  const K = window.KABU_CHARTS;
  const { esc, fmt, fmtS, isNum } = K;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const RM = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- 定義 ---------- */
  const TYPES = [
    { key: 'quick', label: 'クイック診断', cmd: 'クイック', badge: 'クイック' },
    { key: 'kessan', label: '決算', cmd: '決算', badge: '決算' },
    { key: 'chart', label: 'チャート', cmd: 'チャート', badge: 'チャート' },
    { key: 'news', label: 'ニュース', cmd: 'ニュース', arg: '<出来事>', badge: 'ニュース' },
    { key: 'hansei', label: '反省', cmd: '反省', arg: '<購入日> <購入価格>', badge: '反省' },
  ];
  const typeOf = (k) => TYPES.find((t) => t.key === k) || null;
  // DESIGN.md §3 の型（アイコン・名前・一言・重さ）
  const MENU = [
    ['i-quick', 'クイック診断', '4点で全体像', '軽', 2, '/kabu <銘柄>'],
    ['i-kessan', '決算', '業績と予想を読む', '重', 4, '/kabu <銘柄> 決算'],
    ['i-chart', 'チャート', '形と節目を確認', '中', 3, '/kabu <銘柄> チャート'],
    ['i-news', 'ニュース', '材料の影響を整理', '中', 3, '/kabu <銘柄> ニュース <出来事>'],
    ['i-hansei', '反省', '過去の読みを検証', '軽', 2, '/kabu <銘柄> 反省 <購入日> <購入価格>'],
    ['i-market', '市場', '地合いとリスク', '中', 3, '/kabu 市場'],
    ['i-yogo', '用語', '言葉を1つ覚える', '極軽', 1, '/kabu 用語 <言葉>'],
  ];
  const DIAG = {
    quality: { icon: 'i-q', label: '会社の質', l: '低', r: '高' },
    value: { icon: 'i-price', label: '値段', l: '安い', r: '高い' },
    supply: { icon: 'i-supply', label: '需給', l: '売り優勢', r: '買い優勢' },
    trend: { icon: 'i-flow', label: '流れ', l: '下降', r: '上昇' },
  };
  const VAL_KEYS = ['PER', 'PBR', 'PSR'];
  // 用語の式（定義そのもの。アプリ固定の学習補助）
  const FX = {
    PER: ['株価', '÷', '1株利益'], PBR: ['株価', '÷', '1株純資産'], PSR: ['時価総額', '÷', '売上高'],
    信用倍率: ['買い残', '÷', '売り残'], EPS: ['最終利益', '÷', '発行済株式数'], '1株利益': ['最終利益', '÷', '発行済株式数'],
    ROE: ['最終利益', '÷', '自己資本'], 配当利回り: ['1株配当', '÷', '株価'], 時価総額: ['株価', '×', '発行済株式数'],
  };
  // missing の文 → どの枠の理由か（上から順に最初に当たったもの）
  const MISS_RULES = [
    ['segments', /事業別|セグメント|稼ぎ頭/], ['margin', /信用|需給|貸借/], ['valuation', /PER|PBR|PSR|割高|割安/],
    ['performance', /業績|売上|最終益|最終利益|1株/], ['scenarios', /シナリオ/], ['checklist', /チェック/],
    ['diagnosis', /診断/], ['chart', /サポート|レジスタンス|サポレジ|注釈/], ['price', /株価|日足/],
  ];

  /* ---------- 状態 ---------- */
  const S = { route: null, recent: null, seen: {}, testing: false, ctx: null, animTimer: 0 };
  try { S.recent = window.localStorage.getItem('kabu.recent'); } catch (e) { /* 使えない環境では記憶しない */ }

  const dataOk = () => { const D = window.KABU; return !!(D && typeof D === 'object' && D.stocks && typeof D.stocks === 'object' && !Array.isArray(D.stocks)); };
  const mmdd = (d) => (typeof d === 'string' && d.length >= 10 ? d.slice(5, 7) + '/' + d.slice(8, 10) : '—');
  const jpDate = (d) => (typeof d === 'string' && d.length >= 10 ? `${+d.slice(5, 7)}月${+d.slice(8, 10)}日` : '');
  const localDate = (iso) => { const t = new Date(iso); if (isNaN(t)) return '—'; const p = (n) => String(n).padStart(2, '0'); return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`; };
  const arr = (v) => (Array.isArray(v) ? v : []);
  const secAbsent = (a, key) => { const s = a && a.sections; if (!s || typeof s !== 'object' || !(key in s)) return true; const v = s[key]; return v == null || (Array.isArray(v) && v.length === 0); };
  /** その枠に対応する missing の文（無ければ ''） */
  function missFor(a, sec, word) {
    for (const m of arr(a && a.missing)) {
      if (typeof m !== 'string') continue;
      const rule = MISS_RULES.find(([, re]) => re.test(m));
      if (rule && rule[0] === sec && (!word || m.includes(word))) return m;
    }
    return '';
  }
  function noData(sec, a, opt = {}) {
    const why = missFor(a, sec.split(':')[0], opt.word);
    return `<div class="nodata${opt.sm ? ' sm' : ''}" data-nodata="${esc(sec)}"><span class="nd">未取得</span>`
      + (why ? `<p class="why">${esc(why)}</p>` : `<p class="why">${esc(opt.def || 'この分析にはデータが含まれていません')}</p>`)
      + (opt.sm ? '' : '<p>取得できた資料だけで分析しています。数字の推測での穴埋めはしません。</p>') + '</div>';
  }
  /** 数値を等幅に、数値＋単位を改行させない（期間の「25日」などはそのまま） */
  function richNums(s) {
    const str = String(s == null ? '' : s);
    const re = /((?:[A-Z]{2,5} )?\d[\d,.]*)(?![\d,.]|[日期年月週ヶ])([倍円%株万億兆本]*[・。、]?)/g;
    let out = '', last = 0, m;
    while ((m = re.exec(str))) {
      out += esc(str.slice(last, m.index)) + `<span class="nw"><span class="mono">${esc(m[1])}</span>${esc(m[2])}</span>`;
      last = re.lastIndex;
    }
    return out + esc(str.slice(last));
  }
  const jpParts = (parts) => parts.map(([n, u]) => `${esc(n)}<span>${esc(u)}</span>`).join('');

  /* ---------- 株価データ ---------- */
  function priceRows(st) { return arr(st && st.prices && st.prices.rows).filter((r) => r && typeof r.d === 'string' && isNum(r.c)); }
  /** asOf までの足と、直近約6か月の表示窓 */
  function windowOf(st, asOf) {
    const all = priceRows(st);
    const upto = asOf ? all.filter((r) => r.d <= asOf) : all;
    if (!upto.length) return { upto, win: [], si: 0 };
    const end = upto[upto.length - 1].d;
    const dt = new Date(end + 'T00:00:00Z');
    dt.setUTCMonth(dt.getUTCMonth() - 6);
    const start = isNaN(dt) ? '' : dt.toISOString().slice(0, 10);
    let si = upto.findIndex((r) => r.d > start);
    if (si < 0) si = 0;
    return { upto, win: upto.slice(si), si };
  }
  /** 一覧・ヘッダー用の最新値（profile 優先、無ければ日足から計算） */
  function quoteOf(st) {
    const p = (st && st.profile) || {};
    const rows = priceRows(st);
    if (isNum(p.price)) {
      return { price: p.price, change: isNum(p.change) ? p.change : null, pct: isNum(p.changePct) ? p.changePct : null, date: typeof p.priceTime === 'string' ? p.priceTime.slice(0, 10) : rows.length ? rows[rows.length - 1].d : '' };
    }
    if (rows.length) {
      const l = rows[rows.length - 1], pv = rows[rows.length - 2];
      const ch = pv ? l.c - pv.c : null;
      return { price: l.c, change: ch, pct: pv && pv.c ? ch / pv.c * 100 : null, date: l.d };
    }
    return { price: null, change: null, pct: null, date: '' };
  }
  /** 価格の変化幅（+21 ／ −27.5）。価格と同じく小数部が0なら整数 */
  const fmtSP = (v) => (isNum(v) ? fmtS(v, Number.isInteger(Math.round(v * 10) / 10) ? 0 : 1) : '—');
  const stockDec = (st, extra) => K.priceDec([...priceRows(st).slice(-60).map((r) => r.c), ...(extra || []).filter(isNum)]);

  /* ---------- ルーティング ---------- */
  function parseHash(h) {
    const p = String(h || '').replace(/^#\/?/, '').split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch (e) { return x; } });
    if (p[0] === 'stock' && p[1]) return { view: 'stock', code: p[1], type: p[2] || null, date: p[3] || null };
    return { view: 'home' };
  }
  const hrefStock = (code, type, date) => '#/stock/' + encodeURIComponent(code) + (type ? '/' + type : '') + (date ? '/' + date : '');

  function resolve(route) {
    const st = window.KABU.stocks[route.code] || null;
    const type = typeOf(route.type) ? route.type : 'quick';
    if (!st) return { st: null, type, code: route.code };
    const ofType = arr(st.analyses).filter((a) => a && typeof a === 'object' && a.type === type);
    let a = null, badDate = null;
    if (route.date) { a = ofType.find((x) => x.date === route.date) || null; if (!a) badDate = route.date; }
    if (!a) a = ofType[0] || null;
    return { st, type, code: route.code, a, ofType, badDate };
  }

  /* =====================================================================
     共通の枠（レール・上部バー・下部バー）
     ===================================================================== */
  const LOGO = '<div class="logo" title="KABU LAB"><svg viewBox="0 0 46 52" fill="none" aria-hidden="true"><path d="M23 2l20 11.5v25L23 50 3 38.5v-25z" stroke="#3ee6ff" stroke-width="1.6" opacity=".85"/><path d="M23 9l14 8v17.6L23 43 9 34.6V17z" stroke="#3ee6ff" stroke-width="1" opacity=".35"/></svg><b>KL</b></div>';
  function recentCode() {
    const D = window.KABU;
    if (S.recent && D.stocks[S.recent]) return S.recent;
    const codes = Object.keys(D.stocks);
    return codes.find((c) => arr(D.stocks[c].analyses).length) || codes[0] || null;
  }
  function chrome(route, info) {
    const D = window.KABU;
    const rc = route.view === 'stock' && D.stocks[route.code] ? route.code : recentCode();
    const onStock = route.view === 'stock';
    $('#rail').innerHTML = LOGO
      + `<a class="rl${onStock ? '' : ' on'}" href="#/" aria-label="ホーム（銘柄ライブラリ）"><svg><use href="#i-home"/></svg><span>HOME</span></a>`
      + (rc ? `<a class="rl${onStock ? ' on' : ''}" href="${hrefStock(rc)}" aria-label="${esc((D.stocks[rc] && D.stocks[rc].name) || rc)} ${esc(rc)}"><svg><use href="#i-stock"/></svg><span>${esc(rc)}</span></a>` : '')
      + '<div class="sep"></div><div class="foot"><i></i>SYS<br>OK</div>';
    const cmd = onStock
      ? `<span>${esc(info.cmd)}<i class="cur"></i></span>`
      : '<span><i class="cur"></i><span class="hint">/kabu &lt;銘柄名 or コード&gt; [型]</span></span>';
    $('#top').innerHTML = '<div class="brand"><b>KABU LAB</b><span>銘柄分析 × 学習ノート</span></div>'
      + `<div class="cmdw"><div class="cmdbox" aria-label="コマンド（表示のみ）"><span class="lbl">CMD</span><span class="pr">&gt;</span>${cmd}<kbd>ENTER</kbd></div></div>`
      + `<div class="meta"><span>VIEW <b>${esc(info.view)}</b></span><span>DATE <b>${esc(info.date)}</b></span><span>MODE <b>LEARN</b></span></div>`;
    // 下部：ティッカー（市場データがある時だけ）＋ファンクションキー
    const tape = tapeHtml();
    const offs = [['F3', '決算'], ['F4', 'チャート'], ['F5', 'ニュース'], ['F6', '反省'], ['F7', '市場'], ['F8', '用語']];
    $('#bot').innerHTML = tape
      + '<nav class="fk" aria-label="ビュー切替">'
      + `<a class="k${onStock ? '' : ' on'}" href="#/"><i>F1</i>HOME 銘柄ライブラリ</a>`
      + (rc ? `<a class="k${onStock ? ' on' : ''}" href="${hrefStock(rc)}"><i>F2</i>STOCK ${esc(rc)}</a>` : '<span class="k off"><i>F2</i>STOCK —</span>')
      + offs.map(([k, l]) => `<span class="k off"><i>${k}</i>${l}</span>`).join('')
      + '<span class="st"><b>学習用 ・ 売買推奨なし</b><span>CLOSE BASIS</span></span></nav>';
    document.body.style.setProperty('--botH', tape ? '41px' : '23px');
  }
  function tapeHtml() {
    const D = window.KABU;
    const items = D.market && D.market.raw && D.market.raw.items;
    if (!items || typeof items !== 'object' || !Object.keys(items).length) return '';
    const chg = (v, pct, d) => {
      if (!isNum(pct) && !isNum(v)) return '';
      const up = (isNum(pct) ? pct : v) >= 0;
      return `<em class="${up ? 'up' : 'dn'}">${up ? '▲' : '▼'} ${isNum(v) ? fmtS(v, d) + ' / ' : ''}${isNum(pct) ? fmtS(pct, 2) + '%' : ''}</em>`;
    };
    let s = '<div class="tape" aria-label="ティッカー"><span class="lb">MKT</span>';
    marketRows(items).forEach((m) => {
      if (!isNum(m.it.value)) return;
      s += `<span class="it">${esc(m.tape)} <b>${fmt(m.it.value, m.dec)}${esc(m.unitTape)}</b>${m.key === 'usdjpy' ? (isNum(m.it.change) ? `<span>${m.it.change >= 0 ? '円安方向' : '円高方向'}</span>` : '') : chg(m.key === 'nikkei225' ? m.it.change : null, m.it.changePct, m.dec)}</span>`;
    });
    Object.values(D.stocks).forEach((st) => {
      const q = quoteOf(st);
      if (!isNum(q.price)) return;
      s += `<span class="it">${esc(st.code)} ${esc(st.name)} <b>${K.fmtP(q.price)}</b>${chg(null, q.pct, 0)}</span>`;
    });
    return s + '</div>';
  }

  /* =====================================================================
     ホーム
     ===================================================================== */
  const MKT_DEF = {
    nikkei225: { name: '日経平均', sub: 'N225', tape: '日経平均', dec: 2, viz: 'zt' },
    topixEtf: { name: 'TOPIX(ETF)', sub: '1306で代用', subAlt: true, tape: 'TOPIX連動ETF', dec: 1, viz: 'zt' },
    usdjpy: { name: 'ドル円', sub: 'USDJPY', tape: 'ドル円', dec: 2, viz: 'dir' },
    us10y: { name: '米10年金利', sub: 'US10Y', tape: '米10年金利', dec: 2, viz: 'lv', max: 6 },
    brent: { name: 'ブレント原油', sub: 'BRENT', tape: 'ブレント原油', dec: 2, viz: 'lv', max: 120 },
    wti: { name: 'WTI原油', sub: 'WTI', tape: 'WTI原油', dec: 2, viz: 'lv', max: 120 },
  };
  function marketRows(items) {
    return Object.keys(items).filter((k) => items[k] && typeof items[k] === 'object').map((k) => {
      const it = items[k], d = MKT_DEF[k] || { name: it.name || k, sub: it.symbol || '', tape: it.name || k, dec: 2, viz: 'lv' };
      const unit = it.unit === '円' ? '' : it.unit || '';
      return { key: k, it, ...d, unit: k === 'usdjpy' ? '' : unit, unitTape: k === 'usdjpy' || it.unit === '円' ? '' : unit };
    });
  }
  function marketPanel() {
    const D = window.KABU, raw = D.market && D.market.raw;
    const items = raw && raw.items && typeof raw.items === 'object' ? raw.items : null;
    const head = `<div class="ph"><span class="code">MKT-01 / MARKET</span><h2>市場パネル</h2><div class="pm"><span>${esc(raw && raw.date ? raw.date : '')}</span></div></div>`;
    if (!items || !Object.keys(items).length) {
      return `<section class="panel" data-sec="market"><div class="pi">${head}<div class="nodata" data-standby="market"><span class="nd">未実行</span><p class="why">市場データはまだ集めていません</p><div class="cmdl"><em>&gt;</em>/kabu 市場<i class="cur"></i></div></div></div></section>`;
    }
    const rows = marketRows(items).slice(0, 6).map((m) => {
      const it = m.it, v = it.value;
      const up = isNum(it.change) ? it.change >= 0 : true;
      let cg = '', cls = '';
      if (m.viz === 'zt') cg = `<span class="${up ? 'up' : 'dn'}">${m.key === 'nikkei225' && isNum(it.change) ? fmtS(it.change, m.dec) + ' / ' : ''}${isNum(it.changePct) ? fmtS(it.changePct, 2) + '%' : ''}</span>`;
      else if (m.viz === 'dir') { cls = 'n'; cg = isNum(it.change) ? `${fmtS(it.change, 2)} ${it.change >= 0 ? '円安方向' : '円高方向'}` : ''; }
      else { cls = 'n'; cg = isNum(it.change) ? `<span class="${up ? 'up' : 'dn'}">${fmtS(it.change, m.dec)}</span>` : ''; }
      let viz = '';
      if (m.viz === 'zt') {
        const p = isNum(it.changePct) ? K.clamp(it.changePct, -4, 4) : 0, w = Math.abs(p) / 4 * 50;
        viz = `<div class="zt"><u class="a-gx${p < 0 ? ' neg' : ''}" style="${p < 0 ? 'right:50%' : 'left:50%'};width:${w.toFixed(2)}%"></u></div><div class="vz-s"><span>−4%</span><span>0</span><span>+4%</span></div>`;
      } else if (m.viz === 'dir') {
        const pos = isNum(it.changePct) ? 50 + K.clamp(it.changePct, -1, 1) * 45 : 50;
        viz = `<div class="dir"><span>円高</span><span class="ax"><i style="left:${pos.toFixed(1)}%"></i></span><b>円安</b></div>`;
      } else {
        let max = m.max || K.niceCeil((isNum(v) ? v : 1) * 1.2);
        while (isNum(v) && v > max) max *= 2;
        viz = `<div class="lv"><u class="a-gx" style="width:${isNum(v) ? K.clamp(v / max * 100, 0, 100).toFixed(1) : 0}%"></u></div><div class="vz-s"><span>0${m.unit === '%' ? '%' : ''}</span><span>${fmt(max / 2, K.decOf(max / 2, 1))}${m.unit === '%' ? '%' : ''}</span><span>${fmt(max, 0)}${m.unit === '%' ? '%' : ''}</span></div>`;
      }
      const title = it.note ? ` title="${esc(it.note)}"` : '';
      return `<div class="h-mr"${title}><span class="nm">${esc(m.name)}<i class="${m.subAlt ? 'alt' : ''}">${esc(m.sub)}</i></span><span class="vl">${fmt(v, m.dec)}${m.unit ? `<small>${esc(m.unit)}</small>` : ''}</span><span class="cg ${cls}">${cg}</span><div>${viz}</div></div>`;
    }).join('');
    return `<section class="panel" data-sec="market"><div class="pi">${head}<div class="h-mk">${rows}</div></div></section>`;
  }
  function geoPanel() {
    const D = window.KABU, an = D.market && D.market.analysis;
    const list = an && an.sections && Array.isArray(an.sections.geo) ? an.sections.geo.filter((g) => g && (g.name || g.title)) : [];
    const head = '<div class="ph"><span class="code">MKT-02 / GEO-RISK</span><h2>地政学リスク</h2><div class="pm"><span class="jp">影響度 5段階</span></div></div>';
    if (!list.length) {
      return `<section class="panel" data-sec="geo"><div class="pi">${head}<div class="nodata" data-standby="geo"><span class="nd">未実行</span><p class="why">地政学リスクのランキングは市場分析で作ります</p><div class="cmdl"><em>&gt;</em>/kabu 市場<i class="cur"></i></div></div></div></section>`;
    }
    const rows = list.slice(0, 5).map((g, i) => `<div class="gr"><span class="r">${String(i + 1).padStart(2, '0')}</span><span class="nm">${esc(g.name || g.title)}</span>${K.stars(g.level)}${K.segs(g.level)}</div>`).join('');
    return `<section class="panel" data-sec="geo"><div class="pi">${head}<div class="h-geo">${rows}<div class="geo-lg"><span>影響度</span><span>小 ◀ ━━ ▶ 大</span></div></div></div></section>`;
  }
  function libRow(st) {
    const q = quoteOf(st);
    const ans = arr(st.analyses);
    const latest = ans[0] || null;
    const types = TYPES.filter((t) => ans.some((a) => a.type === t.key)).map((t) => `<span>${t.badge}</span>`).join('');
    const warnN = latest ? arr(latest.missing).length : 0;
    const warn = warnN ? `<span class="w" title="${esc(arr(latest.missing).join(' ／ '))}">⚠ 未取得 ${warnN}</span>` : '';
    const up = !isNum(q.change) || q.change >= 0;
    const rows = priceRows(st).slice(-40).map((r) => r.c);
    const go = ans.length > 0;
    const nm = esc(st.name || st.code);
    return `<tr class="${go ? 'go' : 'lk'}" data-href="${hrefStock(st.code)}" tabindex="0" aria-label="${nm}の${go ? '分析' : '銘柄ページ'}を開く">`
      + `<td><span class="h-cd">${esc(st.code)}</span></td>`
      + `<td><span class="h-nm" title="${nm}">${nm}</span>${go ? '<span class="h-op">OPEN ›</span>' : '<span class="h-op na">未分析 ›</span>'}</td>`
      + `<td class="r"><span class="h-px">${K.fmtP(q.price)}<small>円</small></span></td>`
      + `<td class="r"><span class="h-ch ${isNum(q.pct) ? (up ? 'up' : 'dn') : ''}">${isNum(q.pct) ? (up ? '▲ ' : '▼ ') + fmtS(q.pct, 2) + '%' : '—'}</span></td>`
      + `<td><div class="h-bd">${warn}${types || '<span class="na">未分析</span>'}</div></td>`
      + `<td><span class="h-dt">${latest ? mmdd(latest.date) : '—'}</span></td>`
      + `<td>${K.spark(rows, up)}</td></tr>`;
  }
  function termCard() {
    const D = window.KABU, g = arr(D.glossary).filter((x) => x && x.term);
    const head = '<div class="ph"><span class="code">EDU-01 / TERM</span><h2>今日の用語カード</h2></div>';
    if (!g.length) return `<section class="panel" data-sec="term"><div class="pi">${head}<div class="nodata sm" data-standby="term"><span class="nd">用語なし</span><p class="why">分析を実行すると、出てきた用語がここに日替わりで並びます</p></div></div></section>`;
    const now = new Date();
    const day = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 864e5);
    const t = g[day % g.length];
    const len = [...t.term].reduce((w, ch) => w + (ch.charCodeAt(0) < 0x2e80 ? 0.78 : 1), 0);
    const size = Math.round(Math.max(18, Math.min(34, 150 / Math.max(1, len))));
    const viz = t.term === 'PER'
      ? '<div class="perviz" aria-hidden="true"><div class="row"><span>1年分の利益</span><i class="unit"></i></div><div class="row"><span>株価</span><i class="px2"></i><span class="x">×N</span></div></div>'
      : fxHtml(t.term);
    const org = t.firstCode ? `<div class="org">${esc(t.firstCode)} <span>${esc(t.firstName || '')}</span> ${esc(mmdd(t.firstDate))}</div>` : '';
    return `<section class="panel" data-sec="term"><div class="pi">${head}<div class="h-term"><div class="w" style="font-size:${size}px">${esc(t.term)}</div><p>${esc(t.def || '')}</p>${viz || org}</div></div></section>`;
  }
  function renderHome() {
    const D = window.KABU;
    const stocks = Object.values(D.stocks).filter((s) => s && typeof s === 'object');
    const analyzed = stocks.filter((s) => arr(s.analyses).length);
    const lastRun = stocks.reduce((m, s) => { const d = arr(s.analyses)[0] && s.analyses[0].date; return d && d > m ? d : m; }, '');
    const menu = MENU.map((m, i) => `<div class="mi" title="${esc(m[5])}"><div class="ic"><svg><use href="#${m[0]}"/></svg><i>M-${String(i + 1).padStart(2, '0')}</i></div><b>${m[1]}</b><p>${m[2]}</p><div class="wt"><span>${[1, 2, 3, 4].map((k) => `<u class="${k <= m[4] ? 'on' : ''}"></u>`).join('')}</span>${m[3]}</div></div>`).join('');
    const src = D.market && D.market.raw && D.market.raw.source;
    $('#main').innerHTML = `<section class="view" id="v-home" aria-label="ホーム（銘柄ライブラリ）">
  <div class="h-strip">
    <div class="h-brand"><svg aria-hidden="true"><use href="#ret"/></svg><b>KABU LAB</b><span class="h-div"></span><div class="sub">銘柄分析 × 学習ノート<em>${esc(localDate(D.generatedAt))}</em></div></div>
    <div class="h-stat"><span><i>LIBRARY</i><b>${stocks.length}<small>銘柄</small></b></span><span><i>LAST RUN</i><b>${lastRun ? mmdd(lastRun) : '—'}</b></span><span><i>MODE</i><b>LEARN</b></span></div>
  </div>
  <div class="h-a">
    <section class="panel" data-sec="library"><div class="pi">
      <div class="ph"><span class="code">LIB-01 / LIBRARY</span><h2>銘柄ライブラリ</h2><div class="pm"><span class="jp">分析済み ${analyzed.length}銘柄</span><span class="jp"><span class="up">▲ 上昇</span>　<span class="dn">▼ 下落</span></span></div></div>
      <div class="h-lib"><table class="h-tbl">
        <thead><tr><th>コード</th><th>社名</th><th class="r">株価</th><th class="r">前日比</th><th>実施済みの型</th><th>最終分析日</th><th>推移（40日）</th></tr></thead>
        <tbody>${stocks.map(libRow).join('')}<tr class="add"><td colspan="7"><div class="addl"><span>銘柄を増やすには</span><span class="cmdl"><em>&gt;</em>/kabu &lt;銘柄名 or コード&gt;</span><span>を実行（型を省くとクイック診断）</span></div></td></tr></tbody>
      </table></div>
      <div class="h-tf"><span>行を選ぶと銘柄ページを開く</span><span class="mono">LIB ${analyzed.length} / ${stocks.length}</span></div>
    </div></section>
    <div class="h-rc">${marketPanel()}${geoPanel()}</div>
  </div>
  <div class="h-b">
    <section class="panel" data-sec="menu"><div class="pi"><div class="ph"><span class="code">OPS-01 / MENU</span><h2>分析メニュー</h2><div class="pm"><span class="jp">型 7種 ・ 重さ　□ 極軽 ─ ■■■■ 重</span></div></div><div class="h-menu">${menu}</div></div></section>
    ${termCard()}
  </div>
  <footer class="foot-b"><span class="lft"><span class="src" data-sources>出典：株価・市場＝${src && src.url ? `<a href="${esc(src.url)}" target="_blank" rel="noopener">Yahoo!ファイナンス</a>` : 'Yahoo!ファイナンス'}<span class="sep">・</span>基本情報＝株探<span class="sep">・</span>分析ごとの出典は各銘柄ページ</span></span><span class="warn">本ツールは学習用の分析であり、売買の推奨ではありません</span></footer>
</section>`;
    return { cmd: '', view: 'HOME 銘柄ライブラリ', date: localDate(D.generatedAt) };
  }

  /* =====================================================================
     銘柄ページ
     ===================================================================== */
  const RADAR = '<svg viewBox="0 0 220 220" fill="none" aria-hidden="true"><circle cx="110" cy="110" r="100" stroke="rgba(62,230,255,.25)"/><circle cx="110" cy="110" r="72" stroke="rgba(62,230,255,.4)" stroke-dasharray="4 6"/><circle cx="110" cy="110" r="40" stroke="rgba(62,230,255,.25)"/><path d="M110 0v36M110 184v36M0 110h36M184 110h36" stroke="#3ee6ff" stroke-width="1.5"/><path d="M110 110L171 61" stroke="#3ee6ff" stroke-width="1.2" opacity=".7"/><path d="M110 38A72 72 0 0 1 171 61" stroke="#3ee6ff" stroke-width="3" opacity=".8"/><circle cx="110" cy="110" r="4" fill="#3ee6ff"/><text x="110" y="150" text-anchor="middle" font-family="Orbitron" font-size="12" letter-spacing="2" style="fill:#9db3c2">NO SIGNAL</text></svg>';
  function headerHtml(st, a, code) {
    const p = (st && st.profile) || {};
    const q = quoteOf(st);
    const ap = a && a.price && typeof a.price === 'object' ? a.price : null;
    const close = ap && isNum(ap.close) ? ap.close : q.price;
    const ch = ap ? ap.change : q.change, pct = ap ? ap.changePct : q.pct;
    const asOf = ap && ap.asOf ? ap.asOf : q.date;
    const dec = stockDec(st, [close]);
    const up = isNum(ch) ? ch > 0 : isNum(pct) && pct > 0, dn = isNum(ch) ? ch < 0 : isNum(pct) && pct < 0;
    const tags = [p.market, p.industry].filter((x) => typeof x === 'string' && x).map((x) => `<span>${esc(x)}</span>`);
    if (arr(p.tags).includes('225')) tags.push('<span>日経225採用</span>');
    const mc = p.marketCap || {};
    const mparts = K.jpAmountParts(mc.text) || (isNum(mc.yen) ? (() => { const cho = Math.floor(mc.yen / 1e12), oku = Math.round((mc.yen - cho * 1e12) / 1e8); return cho ? [[fmt(cho), '兆'], [fmt(oku), '億円']] : [[fmt(oku), '億円']]; })() : null);
    const pDate = typeof p.priceTime === 'string' ? p.priceTime.slice(0, 10) : '';
    const mcDate = mparts && pDate && asOf && pDate !== asOf ? `<small>${esc(mmdd(pDate))}時点</small>` : '';
    const mp = isNum(close) && isNum(p.unitShares) ? K.yenParts(close * p.unitShares) : null;
    const name = (st && st.name) || code;
    return `<div class="sh">
    <div class="sh-id"><div class="ticker">${esc(code)}</div><div><h1>${esc(name)}</h1><div class="tags">${tags.join('')}</div></div></div>
    <div class="sh-price"><svg class="ret" aria-hidden="true"><use href="#ret"/></svg><div>
      <div class="lbl"><span>株価 ／ ${asOf ? esc(jpDate(asOf)) + '終値' : '基準日不明'}</span></div>
      <div class="pxrow"><span class="px"><span class="num" data-count="${isNum(close) ? close : ''}" data-p="1">${K.fmtP(close)}</span><small>円</small></span><span class="chg ${up ? 'up' : dn ? 'dn' : ''}">${up ? '▲' : dn ? '▼' : '―'} <span>前日比</span> ${fmtSP(ch)}<span>円</span> / ${fmtS(pct, 2)}%</span></div>
    </div></div>
    <div class="sh-kv"><span>時価総額${mcDate}</span><b>${mparts ? jpParts(mparts) : '<span>未取得</span>'}</b></div>
    <div class="sh-kv"><span>最低購入額</span><b>${mp ? jpParts(mp) : '<span>未取得</span>'}</b></div>
    <div class="sh-fill"><svg viewBox="0 0 150 26" aria-hidden="true" fill="none" stroke="#3ee6ff"><path d="M0 13h40" stroke-opacity=".35"/><path d="M46 5v16M52 9v8M58 3v20M64 9v8M70 7v12" stroke-opacity=".5"/><path d="M78 13h30" stroke-dasharray="2 3" stroke-opacity=".45"/><rect x="114" y="4" width="18" height="18" stroke-opacity=".6" transform="rotate(45 123 13)"/><circle cx="123" cy="13" r="2.5" fill="#3ee6ff" stroke="none"/><path d="M138 13h12" stroke-opacity=".35"/></svg></div>
  </div>`;
  }
  function tabsHtml(R) {
    const tabs = TYPES.map((t, i) => {
      const on = t.key === R.type;
      return `<a class="tab${on ? ' on' : ''}" href="${hrefStock(R.code, t.key)}" data-type="${t.key}"><i>T-0${i + 1}</i>${t.label}${on ? '<span class="dot"></span>' : ''}</a>`;
    }).join('');
    let right;
    const list = R.ofType || [];
    if (list.length > 1) {
      const items = list.map((a) => ({ d: a.date, on: R.a && a.date === R.a.date }));
      right = list.length > 5
        ? `<span class="dates"><span class="lb">履歴</span><select aria-label="分析日を選ぶ" data-dates>${items.map((x) => `<option value="${esc(hrefStock(R.code, R.type, x.d))}"${x.on ? ' selected' : ''}>${esc(x.d)}</option>`).join('')}</select></span>`
        : `<span class="dates"><span class="lb">履歴</span>${items.map((x) => `<a class="${x.on ? 'on' : ''}" href="${hrefStock(R.code, R.type, x.d)}">${esc(mmdd(x.d))}</a>`).join('')}</span>`;
    } else {
      right = `<span class="note">ANALYSIS <b>${R.a ? esc(R.type.toUpperCase()) : 'STANDBY'}</b>${R.a ? ' ／ ' + esc(mmdd(R.a.date)) : ''}</span>`;
    }
    return `<nav class="tabs" aria-label="分析の型">${tabs}<div class="rt"><span class="lgd"><i style="background:var(--cy)"></i>上昇</span><span class="lgd"><i style="background:var(--mag)"></i>下落</span><span class="lgd"><i style="background:var(--amber)"></i>警告・注目</span>${right}</div></nav>`;
  }
  function emptyHtml(o) {
    return `<div class="empty"><section class="panel" data-sec="empty"><div class="pi">
      <div class="ph"><span class="code">${esc(o.code)}</span><h2>${esc(o.title)}</h2><div class="pm"><span>STATUS: <span class="jp">${esc(o.status || '未実行')}</span></span></div></div>
      <div class="emp">${RADAR}<div><span class="code">${esc(o.mod || 'MODULE STANDBY')}</span><h3>${esc(o.h3)}</h3><p>${esc(o.p)}</p>${o.note ? `<p class="note2">${o.note}</p>` : ''}
        ${o.cmd ? `<div class="cmdl"><em>&gt;</em>${esc(o.cmd)}${o.arg ? ` <var>${esc(o.arg)}</var>` : ''}<i class="cur"></i></div>` : ''}</div></div>
    </div></section></div>`;
  }
  function footHtml(sources, missing) {
    const links = arr(sources).filter((s) => s && s.title).map((s) => (/^https?:\/\//.test(s.url || '') ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>` : esc(s.title))).join('<span class="sep">・</span>');
    const miss = arr(missing).filter((m) => typeof m === 'string' && m);
    return `<footer class="foot-b"><span class="lft"><span class="src" data-sources>出典：${links || '<span>記載なし</span>'}</span>${miss.length ? `<span class="miss" data-missing-list><b>未取得</b>${miss.map(esc).join(' ／ ')}</span>` : ''}</span><span class="warn">本ツールは学習用の分析であり、売買の推奨ではありません</span></footer>`;
  }

  /* ---------- クイック診断の各枠 ---------- */
  const panel = (sec, code, title, pm, body, extra = '') => `<section class="panel" data-sec="${sec}"${extra}><div class="pi"><div class="ph"><span class="code">${code}</span><h2>${title}</h2>${pm ? `<div class="pm">${pm}</div>` : ''}</div>${body}</div></section>`;

  function pricePanel(ctx) {
    const { win, a, dec } = ctx;
    if (!win.length) return panel('price', 'SYS-02 / PRICE', '株価チャート（日足）', '', `<div class="pb">${noData('price', a, { def: '株価データ（prices.json）がありません' })}</div>`);
    const first = win[0].d, last = win[win.length - 1].d;
    const range = `${first.replace(/-/g, '.')} – ${first.slice(0, 4) === last.slice(0, 4) ? last.slice(5).replace('-', '.') : last.replace(/-/g, '.')}`;
    const maP = (v) => (isNum(v) ? K.fmtP(dec === 0 ? Math.round(v) : v) : '—');
    const ma25 = ctx.ma25[ctx.ma25.length - 1], ma75 = ctx.ma75[ctx.ma75.length - 1];
    const chart = a.sections && a.sections.chart && typeof a.sections.chart === 'object' ? a.sections.chart : null;
    const lv = (list, name) => {
      const v = arr(list).filter((x) => x && isNum(x.price));
      if (!v.length) return '';
      return `<span><i class="sw bd"></i>${name} <b>${K.fmtP(v[0].price)}円</b>${v[0].label ? `（${esc(v[0].label)}）` : ''}${v.length > 1 ? `<span class="cap">ほか${v.length - 1}</span>` : ''}</span>`;
    };
    const legend = '<span><i class="sw cu"></i>陽線（上昇）</span><span><i class="sw cd"></i>陰線（下落）</span>'
      + (isNum(ma25) ? `<span><i class="sw l25"></i>25日線 <b>${maP(ma25)}円</b></span>` : '')
      + (isNum(ma75) ? `<span><i class="sw l75"></i>75日線 <b>${maP(ma75)}円</b></span>` : '')
      + (chart ? lv(chart.resistance, 'レジスタンス帯') + lv(chart.support, 'サポート帯') : `<span class="ndn" data-nodata="chart">サポレジ・注釈は未取得${missFor(a, 'chart') ? '（' + esc(missFor(a, 'chart')) + '）' : ''}</span>`);
    const closes = ctx.upto.map((r) => r.c);
    const dev = [[5, '乖離率 5日線'], [25, '25日線'], [75, '75日線'], [200, '200日線']].map(([n, l]) => K.devCell(l, K.deviation(closes, n))).join('');
    return panel('price', 'SYS-02 / PRICE', '株価チャート（日足）', `<span>${esc(range)}</span><span>${win.length}本</span>`,
      `<div class="pb"><div class="legend">${legend}</div><div class="host" id="chart" data-chart="price"></div><div class="dev" aria-label="移動平均線からの乖離率">${dev}</div></div>`);
  }
  function diagPanel(a) {
    if (secAbsent(a, 'diagnosis')) return panel('diagnosis', 'SYS-01 / DIAG', '4点診断', '<span class="jp">評価メーター</span>', noData('diagnosis', a));
    const list = arr(a.sections.diagnosis);
    const cells = Object.keys(DIAG).map((k) => {
      const d = list.find((x) => x && x.key === k), m = DIAG[k];
      if (!d) return `<div class="dg nd" data-nodata="diagnosis:${k}"><div class="dgh"><svg><use href="#${m.icon}"/></svg>${m.label}<b class="vd">—</b></div><div class="mt"><span class="nd">未取得</span></div><p>${esc(missFor(a, 'diagnosis') || 'この観点の評価がありません')}</p></div>`;
      return `<div class="dg"><div class="dgh"><svg><use href="#${m.icon}"/></svg>${esc(d.label || m.label)}<b class="vd${String(d.verdict || '').length > 5 ? ' long' : ''}">${esc(d.verdict || '—')}</b></div>`
        + `<div class="mt">${K.meter(d.level)}<span class="ml" data-side="l">${m.l}</span><span class="ml" data-side="r">${m.r}</span></div><p>${richNums(d.reason)}</p></div>`;
    }).join('');
    return panel('diagnosis', 'SYS-01 / DIAG', '4点診断', '<span class="jp">評価メーター</span>', `<div class="diag">${cells}</div>`);
  }
  function valuePanel(a) {
    const pm = '<span class="jp">◀ 割安寄り ｜ 割高寄り ▶</span>';
    if (secAbsent(a, 'valuation')) return panel('valuation', 'SYS-04 / VALUE', '割高・割安ゲージ', pm, noData('valuation', a, { sm: true }));
    const list = arr(a.sections.valuation);
    const cells = VAL_KEYS.map((k) => {
      const it = list.find((x) => x && x.key === k);
      if (!it || !isNum(it.value)) {
        const why = missFor(a, 'valuation', k);
        return `<div class="vg" data-nodata="valuation:${k}"><div class="hd"><span class="nm">${k}</span><span class="nd">未取得</span></div><span class="ref" title="${esc(why)}">${esc(why || 'この分析には含まれていません')}</span><div class="gtr"><span>0</span><div class="gt nil"></div><span>—</span></div></div>`;
      }
      const d = k === 'PER' ? 1 : 2;
      const ref = typeof it.refLabel === 'string' && it.refLabel ? it.refLabel + (isNum(it.ref) && /[\d.]+倍$/.test(it.refLabel) ? 'と比較' : '') : '';
      return `<div class="vg"><div class="hd"><span class="nm">${k}</span><span class="vl">${fmt(it.value, d)}<small>${esc(it.unit || '倍')}</small></span></div><span class="ref">${esc(ref)}</span>${K.gauge(it)}</div>`;
    }).join('');
    return panel('valuation', 'SYS-04 / VALUE', '割高・割安ゲージ', pm, `<div class="vals">${cells}</div>`);
  }
  function perfPanel(a) {
    if (secAbsent(a, 'performance')) return panel('performance', 'SYS-03 / PERF', '業績推移', '', `<div class="pb">${noData('performance', a, { sm: true })}</div>`);
    const n = arr(a.sections.performance).length;
    return panel('performance', 'SYS-03 / PERF', '業績推移', n < 3 ? `<span class="jp">取得できた${n}期のみ</span>` : '', '<div class="pb"><div class="host" id="perf" data-chart="perf"></div></div>');
  }
  function segPanel(a) {
    if (secAbsent(a, 'segments')) return panel('segments', 'SYS-07 / SEGMENT', '稼ぎ頭マップ', '', `<div class="pb">${noData('segments', a, { sm: true })}</div>`);
    let list = arr(a.sections.segments).filter((x) => x && x.name);
    list = [...list].sort((x, y) => (isNum(y.profit) ? y.profit : -Infinity) - (isNum(x.profit) ? x.profit : -Infinity));
    let rows = list;
    // 1440×900 の枠に収まるのは4行まで。5事業以上は上位3＋「その他」にまとめる（合計は足し算のみ）
    if (list.length > 4) {
      const rest = list.slice(3), sum = rest.reduce((s, x) => s + (isNum(x.profit) ? x.profit : 0), 0);
      rows = [...list.slice(0, 3), { name: `その他 ${rest.length}事業`, profit: sum, margin: null, note: '', other: true }];
    }
    // 利益率が1つも無いとき（純利益だけの開示など）は、利益率の凡例とバーを出さず、利益額の横棒にする
    const noMargin = list.every((x) => !isNum(x.margin));
    const maxP = Math.max(1, ...rows.map((x) => (isNum(x.profit) ? x.profit : 0)));
    const maxM = Math.max(20, ...rows.map((x) => (isNum(x.margin) ? Math.ceil(x.margin / 5) * 5 : 0)));
    const colors = rows.map((x, i) => (x.other ? '#47606f' : K.SEG_COLORS[i % K.SEG_COLORS.length]));
    const donut = K.donut(rows.map((x, i) => ({ v: x.profit, color: colors[i] })));
    const rowsH = rows.map((x, i) => {
      const m = isNum(x.margin) ? x.margin : null;
      const w = noMargin ? (isNum(x.profit) ? K.clamp(x.profit / maxP * 100, 0, 100) : 0) : m != null ? K.clamp(m / maxM * 100, 0, 100) : 0;
      return `<div class="srow" style="--k:${colors[i]}"><div class="srh"><i></i><span class="sn" title="${esc(x.name)}">${esc(x.name)}</span>${x.note ? `<span class="yoy">${esc(x.note)}</span>` : ''}<span class="pf${isNum(x.profit) && x.profit < 0 ? ' dn' : ''}">${fmt(x.profit)}<small>億円</small></span></div>`
        + (noMargin ? `<div class="mbar pbar"><span class="tr"><u class="a-gx" style="width:${w.toFixed(1)}%"></u></span></div></div>`
          : `<div class="mbar"><span class="tr"><u class="a-gx" style="width:${w.toFixed(1)}%"></u></span><b>${m != null ? fmt(m, 1) + '%' : '—'}</b></div></div>`);
    }).join('');
    return panel('segments', 'SYS-07 / SEGMENT', '稼ぎ頭マップ', '', `<div class="pb"><div class="sg-top">${donut}<div class="t"><span class="code">PROFIT</span>円＝事業別の利益<br>${noMargin ? 'バー＝利益の大きさ' : `バー＝利益率（0〜${maxM}%）`}</div></div><div class="sg-rows">${rowsH}</div></div>`);
  }
  function scenPanel(a, dec) {
    const close = a.price && isNum(a.price.close) ? a.price.close : null;
    const pm = `<span class="jp">起点 <span class="u-wide">現在値 </span><span class="mono">${K.fmtP(close)}</span>円</span>`;
    if (secAbsent(a, 'scenarios')) return panel('scenarios', 'SYS-06 / SCENARIO', '3つのシナリオ', pm, `<div class="pb">${noData('scenarios', a)}</div>`);
    const list = arr(a.sections.scenarios);
    const order = [['bull', 'SCN-A', 'bull'], ['base', 'SCN-B', 'mid'], ['bear', 'SCN-C', 'bear']];
    const cards = order.map(([k, code, cls]) => {
      const s = list.find((x) => x && x.kind === k);
      if (!s) return '';
      const label = s.target && typeof s.target.label === 'string' ? s.target.label : '';
      const m = /\d[\d,.]*(?:[〜~]\d[\d,.]*)?円/.exec(label);
      const tgt = label ? (k !== 'base' ? '目安 ' : '') + (m ? esc(label.slice(0, m.index)) + `<em>${esc(m[0])}</em>` + esc(label.slice(m.index + m[0].length)) : esc(label)) : '';
      const txt = s.text && s.text !== label ? s.text + (/[。．.！？!?」]$/.test(s.text) ? '' : '。') : '';
      return `<div class="sc ${cls}"><div class="sch"><span class="scode">${code}</span><b>${esc(s.title || '')}</b><span class="tgt">${tgt}</span></div>${txt ? `<p>${esc(txt)}</p>` : ''}${s.breakIf ? `<div class="inv"><span>崩れる条件</span>${esc(s.breakIf)}</div>` : ''}</div>`;
    }).join('');
    return panel('scenarios', 'SYS-06 / SCENARIO', '3つのシナリオ', pm, `<div class="pb"><div class="scn"><div class="host" id="fan" data-chart="fan"></div><div class="scards">${cards}</div></div></div>`);
  }
  function marginPanel(a) {
    const pm = '<span class="jp u-wide">単位：千株</span>';
    if (secAbsent(a, 'margin')) return panel('margin', 'SYS-05 / MARGIN', '需給（信用残）', pm, `<div class="pb">${noData('margin', a, { sm: true })}</div>`);
    const list = arr(a.sections.margin).filter((x) => x && typeof x === 'object');
    const n = list.length, lastI = n - 1;
    const hl = (i) => (i === lastI ? ' style="color:var(--cy2)"' : '');
    const shares = (v) => (isNum(v) && Math.abs(v) >= 10000 ? fmt(v, 0) : fmt(v, 1)); // 1万千株以上は小数を落とす
    const row = (lab, key, d) => `<tr><td>${lab}</td>${list.map((r, i) => `<td${hl(i)}>${d === 2 ? fmt(r[key], 2) : shares(r[key])}</td>`).join('')}</tr>`;
    const table = `<table class="tbl sm"><thead><tr><th>日付</th>${list.map((r, i) => `<th${hl(i)}>${esc(mmdd(r.date))}</th>`).join('')}</tr></thead><tbody>${row('売り残', 'sell', 1)}${row('買い残', 'buy', 1)}${row('倍率', 'ratio', 2)}</tbody></table>`;
    return panel('margin', 'SYS-05 / MARGIN', '需給（信用残）', pm,
      `<div class="pb"><div class="legend"><span><i class="sw" style="background:rgba(62,230,255,.55)"></i>買い残</span><span><i class="sw" style="background:repeating-linear-gradient(135deg,#9db3c2 0 2px,transparent 2px 4px)"></i>売り残</span><span><i class="sw l25"></i>倍率</span>${n < 5 ? `<span class="few">取得できた${n}週のみ</span>` : ''}<span class="u-narrow">単位：千株</span></div><div class="host" id="supply" data-chart="supply"></div>${table}</div>`);
  }
  function checkPanel(a) {
    const pm = '<span class="jp">10項目</span>';
    if (secAbsent(a, 'checklist')) return panel('checklist', 'SYS-08 / PATTERN', 'チャート型チェックリスト', pm, `<div class="pb">${noData('checklist', a)}</div>`);
    const names = arr(window.KABU.checklistItems);
    const got = arr(a.sections.checklist);
    const base = names.length ? names : got.map((c) => ({ id: c && c.id, name: '' }));
    const items = base.map((it) => { const c = got.find((x) => x && x.id === it.id) || {}; return { id: it.id, name: it.name, status: c.status, reason: c.reason }; });
    const ck = K.checklist(items);
    return panel('checklist', 'SYS-08 / PATTERN', 'チャート型チェックリスト', `<span class="jp">${items.length}項目</span>`, `<div class="pb"><div class="ck-sum">${ck.summary}</div><div class="ckg">${ck.cells}</div></div>`);
  }
  function fxHtml(term) {
    if (term === '乖離率') return '<div class="fx"><b class="m">−10%</b><span style="flex:1;max-width:120px;height:6px;background:linear-gradient(90deg,rgba(255,179,64,.55),rgba(62,230,255,.12) 20% 80%,rgba(255,179,64,.55))"></span><b class="m">+10%</b><span style="color:var(--amber);font-family:var(--jp)">過熱</span></div>';
    const f = FX[term];
    if (!f) return '';
    return `<div class="fx"><b>${esc(f[0])}</b>${f[1]}<b>${esc(f[2])}</b>=<b class="eq">${esc(term)}</b></div>`;
  }
  function notesPanel(a) {
    const terms = arr(a.terms).filter((t) => t && t.term);
    const ins = typeof a.insight === 'string' && a.insight ? a.insight : '';
    const pm = `<span class="jp">用語 ${terms.length} ・ 気づき ${ins ? 1 : 0}</span>`;
    if (!terms.length && !ins) return `<div class="rowC">${panel('notes', 'SYS-09 / NOTE', '学びノート', pm, noData('notes', a, { sm: true, def: '用語と気づきがありません' }))}</div>`;
    const cols = Math.min(Math.max(terms.length, 1), 3), rowsN = Math.max(1, Math.ceil(terms.length / cols));
    const grid = terms.length ? `repeat(${cols},minmax(0,1fr))${ins ? ' minmax(0,1.45fr)' : ''}` : 'minmax(0,1fr)';
    const th = terms.map((t, i) => `<div class="term${i % cols === 0 ? ' c0' : ''}${i >= cols ? ' wrap' : ''}"><span class="chip">${esc(t.term)}</span><div><p>${esc(t.def || '')}</p>${fxHtml(t.term)}</div></div>`).join('');
    const ih = ins ? `<div class="insight" style="grid-row:1 / span ${rowsN}"><span class="code">INSIGHT / 今回の気づき</span><p>「${esc(ins)}」</p></div>` : '';
    return `<div class="rowC">${panel('notes', 'SYS-09 / NOTE', '学びノート', pm, `<div class="notes" style="grid-template-columns:${grid}">${th}${ih}</div>`)}</div>`;
  }

  function renderStock(route) {
    const D = window.KABU;
    const R = resolve(route);
    if (!R.st) {
      $('#main').innerHTML = `<section class="view" id="v-stock" aria-label="銘柄ページ">${emptyHtml({ code: 'SYS-404 / NO DATA', title: route.code, status: 'データなし', mod: 'NO DATA', h3: `銘柄 ${route.code} のデータがありません`, p: '株価・基本情報をまだ集めていません。コマンドを実行すると、収集と分析がまとめて走ります。', cmd: `/kabu ${route.code}` })}${footHtml([], [])}</section>`;
      return { cmd: `/kabu ${route.code}`, view: `${route.code}`, date: '—' };
    }
    const st = R.st, a = R.a, t = typeOf(R.type);
    if (st.code) { S.recent = st.code; try { window.localStorage.setItem('kabu.recent', st.code); } catch (e) { /* 記憶できなくても動く */ } }
    const name = st.name || R.code;
    const cmd = `/kabu ${name} ${t.cmd}${t.arg ? ' ' + t.arg : ''}`;
    let body;
    S.ctx = null;
    if (!a) {
      const q = quoteOf(st);
      const none = !arr(st.analyses).length;
      body = emptyHtml({
        code: `SYS-T-0${TYPES.indexOf(t) + 1} / STANDBY`, title: t.label,
        h3: none && t.key === 'quick' ? 'この銘柄はまだ分析していません' : `${t.label}は未実行です`,
        p: none && t.key === 'quick'
          ? 'クイック診断を実行すると、4点診断・株価チャート・業績推移・シナリオ・需給などの図解がここに並びます。'
          : 'この型の分析はまだ走らせていません。実行すると、ここに図解つきの結果が並びます。',
        note: q.date ? `株価・基本情報は収集済み（<b>${esc(q.date)}</b>）。下のコマンドで分析を実行できます。` : '',
        cmd: `/kabu ${name}${t.key === 'quick' ? '' : ' ' + t.cmd}`, arg: t.arg || '',
      });
    } else if (R.type !== 'quick') {
      body = emptyHtml({ code: `SYS-T-0${TYPES.indexOf(t) + 1} / PENDING`, title: t.label, status: '表示準備中', mod: 'VIEW PENDING', h3: `${t.label}の表示は次の段階で対応します`, p: `${a.date} の分析は保存されています。要約：${a.summary || '—'}` });
    } else {
      const w = windowOf(st, a.price && a.price.asOf ? a.price.asOf : a.date);
      const closesAll = w.upto.map((r) => r.c);
      const dec = stockDec(st, [a.price && a.price.close]);
      const ctx = {
        st, a, dec, upto: w.upto, win: w.win,
        ma25: K.sma(closesAll, 25).slice(w.si), ma75: K.sma(closesAll, 75).slice(w.si),
      };
      S.ctx = ctx;
      body = `<div id="quick">
    <div class="rowA">${pricePanel(ctx)}
      <div class="rcol">${diagPanel(a)}${valuePanel(a)}<div class="pair">${perfPanel(a)}${segPanel(a)}</div></div>
    </div>
    <div class="rowB">${scenPanel(a, dec)}${marginPanel(a)}${checkPanel(a)}</div>
    ${notesPanel(a)}
  </div>`;
    }
    const notice = R.badDate ? `<div class="foot-b" style="margin:0 0 6px;border:0;padding:0 4px"><span class="warn">指定の日付 ${esc(R.badDate)} の分析は無いため、最新の分析を表示しています</span></div>` : '';
    const sources = a ? a.sources : st.profile && st.profile.source ? [st.profile.source] : [];
    $('#main').innerHTML = `<section class="view" id="v-stock" aria-label="銘柄ページ">${headerHtml(st, a, R.code)}${tabsHtml(R)}${notice}${body}${footHtml(sources, a ? a.missing : [])}</section>`;
    const q = quoteOf(st);
    return { cmd, view: `${R.code} ${name}`, date: a ? a.date : q.date || '—' };
  }

  /* =====================================================================
     図の描画（寸法を測って charts.js に渡す）
     ===================================================================== */
  const DRAW = {
    price: (W, H, c) => K.priceChart({
      rows: c.win, ma25: c.ma25, ma75: c.ma75, dec: c.dec, W, H,
      res: c.a.sections && c.a.sections.chart ? arr(c.a.sections.chart.resistance) : [],
      sup: c.a.sections && c.a.sections.chart ? arr(c.a.sections.chart.support) : [],
      pins: c.a.sections && c.a.sections.chart ? arr(c.a.sections.chart.pins) : [],
      label: `${c.st.name || c.st.code} 日足チャート ${c.win.length ? c.win[0].d + 'から' + c.win[c.win.length - 1].d : ''}`,
    }),
    perf: (W, H, c) => K.perf3d(arr(c.a.sections.performance), W, H),
    supply: (W, H, c) => K.supply3d(arr(c.a.sections.margin), W, H),
    fan: (W, H, c) => {
      const sc = arr(c.a.sections.scenarios), by = (k) => { const s = sc.find((x) => x && x.kind === k); return s && s.target ? s.target : null; };
      return K.fan({ hist: c.upto.slice(-20).map((r) => r.c), now: c.a.price && c.a.price.close, bull: by('bull'), base: by('base'), bear: by('bear'), dec: c.dec, W, H });
    },
  };
  function drawAll() {
    $$('[data-chart]').forEach((h) => {
      const fn = DRAW[h.dataset.chart];
      const W = h.clientWidth, H = h.clientHeight;
      h.innerHTML = fn && S.ctx && W > 0 && H > 0 ? fn(W, H, S.ctx) : '';
    });
    $$('.mt').forEach((h) => {
      const W = h.clientWidth, Hs = h.clientHeight - 15;
      const ls = $$('.ml', h);
      ls.forEach((sp) => {
        const x = K.meterLabelX(W, Hs, sp.dataset.side === 'r' ? 1 : 0), w = sp.offsetWidth;
        sp.style.left = Math.max(w / 2, Math.min(W - w / 2, x)) + 'px';
      });
      // 両端ラベルが重なりそうなら枠の左右端へ寄せる
      if (ls.length === 2) {
        const [l, r] = ls, lw = l.offsetWidth, rw = r.offsetWidth;
        if (parseFloat(l.style.left) + lw / 2 + 6 > parseFloat(r.style.left) - rw / 2) { l.style.left = lw / 2 + 'px'; r.style.left = (W - rw / 2) + 'px'; }
      }
    });
    if (document.body.classList.contains('anim')) setLens();
  }
  function setLens() {
    $$('.ma, .ray, .arc, .mv').forEach((p) => { try { p.style.setProperty('--len', p.getTotalLength().toFixed(1)); } catch (e) { /* 長さが測れなければ線はそのまま */ } });
  }
  function animate(key) {
    clearTimeout(S.animTimer);
    const first = !S.seen[key];
    S.seen[key] = true;
    const on = first && !RM && !S.testing && document.visibilityState === 'visible';
    document.body.classList.toggle('anim', on);
    if (!on) return;
    setLens();
    $$('.ndl').forEach((g) => {
      if (!g.animate) return;
      const v = +g.dataset.v || 0;
      g.style.transformOrigin = '70px 62px';
      g.animate([{ transform: `rotate(${-180 * v}deg)` }, { transform: 'rotate(0deg)' }], { duration: 1300, delay: 300, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'backwards' });
    });
    $$('[data-count]').forEach((e) => {
      const end = +e.dataset.count;
      if (!e.dataset.count || !isNum(end)) return;
      const t0 = performance.now(), dur = 1100, start = end * 0.94;
      const step = (t) => { const k = Math.min(1, (t - t0) / dur), ev = 1 - Math.pow(1 - k, 3); e.textContent = K.fmtP(start + (end - start) * ev); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
      setTimeout(() => { e.textContent = K.fmtP(end); }, dur + 150);
    });
    // 最終状態は既定のCSS。止まった環境でも必ず外す（アニメは加点要素）
    S.animTimer = setTimeout(() => { document.body.classList.remove('anim'); $$('[data-count]').forEach((e) => { const v = +e.dataset.count; if (e.dataset.count && isNum(v)) e.textContent = K.fmtP(v); }); }, 2600);
  }

  /* =====================================================================
     起動・案内画面
     ===================================================================== */
  function renderBoot() {
    const kind = window.__KABU_LOAD_ERROR === 'broken' ? 'broken' : 'missing';
    $('#rail').innerHTML = LOGO + '<div class="sep"></div><div class="foot"><i></i>SYS<br>WAIT</div>';
    $('#top').innerHTML = '<div class="brand"><b>KABU LAB</b><span>銘柄分析 × 学習ノート</span></div><div class="cmdw"><div class="cmdbox"><span class="lbl">CMD</span><span class="pr">&gt;</span><span>node build.mjs<i class="cur"></i></span></div></div>';
    $('#bot').innerHTML = '<nav class="fk"><span class="k off"><i>F1</i>HOME</span><span class="st"><b>学習用 ・ 売買推奨なし</b></span></nav>';
    document.body.style.setProperty('--botH', '23px');
    $('#main').innerHTML = `<div class="boot"><section class="panel"><div class="pi">
      <span class="code">SYS-00 / BOOT</span>
      <h1>${kind === 'broken' ? 'データファイル（app/data.js）を読み込めませんでした' : 'データファイル（app/data.js）がまだありません'}</h1>
      <p>${kind === 'broken' ? 'data.js が途中で壊れているようです。作り直せば直ります。' : 'アプリは data/ の中身から作る app/data.js を読んで表示します。'}</p>
      <ol><li>ターミナルで KABU LAB のフォルダ（kabu-lab）を開く</li><li><code>node build.mjs</code> を実行する</li><li>このページを再読み込みする</li></ol>
      <div class="cmdl"><em>$</em>node build.mjs<i class="cur"></i></div>
    </div></section></div>`;
  }

  function render(route) {
    S.route = route;
    if (!K) return;
    if (!dataOk()) { renderBoot(); return; }
    const info = route.view === 'stock' ? renderStock(route) : renderHome();
    chrome(route, info);
    drawAll();
    animate(route.view === 'stock' ? 'stock:' + route.code : 'home');
    if (!S.testing) window.scrollTo(0, 0);
  }

  /* ---------- イベント ---------- */
  window.addEventListener('hashchange', () => render(parseHash(location.hash)));
  document.addEventListener('click', (e) => {
    const tr = e.target.closest && e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
  });
  document.addEventListener('change', (e) => { if (e.target && e.target.matches && e.target.matches('select[data-dates]')) location.hash = e.target.value; });
  document.addEventListener('keydown', (e) => {
    const tr = e.target.closest && e.target.closest('tr[data-href]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); location.hash = tr.dataset.href; return; }
    if (!dataOk()) return;
    if (e.key === 'F1') { e.preventDefault(); location.hash = '#/'; }
    if (e.key === 'F2') { const c = recentCode(); if (c) { e.preventDefault(); location.hash = hrefStock(c); } }
  });
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { document.body.classList.remove('anim'); if (dataOk()) drawAll(); }, 150); });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (!dataOk()) return;
      // フォント確定後に寸法だけ取り直す（初回アニメ中なら終わってから）
      if (document.body.classList.contains('anim')) setTimeout(() => { document.body.classList.remove('anim'); drawAll(); }, 2700);
      else drawAll();
    });
  }

  /* ---------- 検証フック用の窓口（test-hooks.js が使う） ---------- */
  window.__KABU_APP = {
    TYPES, VAL_KEYS, DIAG_KEYS: Object.keys(DIAG), parseHash, secAbsent, missFor,
    render, redraw: drawAll, current: () => S.route,
    setTesting: (b) => { S.testing = !!b; if (b) { clearTimeout(S.animTimer); document.body.classList.remove('anim'); } },
    snapshot: () => ({ recent: S.recent, seen: { ...S.seen } }),
    restore: (s) => { if (!s) return; S.recent = s.recent; S.seen = { ...s.seen }; try { if (s.recent) window.localStorage.setItem('kabu.recent', s.recent); else window.localStorage.removeItem('kabu.recent'); } catch (e) { /* 無視 */ } },
  };

  render(parseHash(location.hash));
})();
