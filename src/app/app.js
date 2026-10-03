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
    ['i-market', '市場', '地合いとリスク', '中', 3, '/kabu 市場', ['#/market', '市場ページ']],
    ['i-yogo', '用語', '言葉を1つ覚える', '極軽', 1, '/kabu 用語 <言葉か質問>', ['#/glossary', '用語帳']],
  ];
  /** パネル見出しの右端に置く「別の画面へ」リンク */
  const goLink = (href, label, key) => `<a class="plink" href="${href}" data-go="${esc(key)}">${esc(label)} ›</a>`;
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
  // チャート型・決算型の missing の振り分け（上から順に最初に当たったもの）
  const MISS_BY = {
    quick: MISS_RULES,
    chart: [
      ['timeframes', /週足|月足|時間軸/], ['heat', /過熱|乖離|RSI|騰落|出来高比/], ['levels', /サポート|レジスタンス|節目|価格帯/],
      ['plans', /考え方|撤退|目安|プラン/], ['checklist', /チェック/], ['lesson', /読み方|学び/], ['price', /株価|日足|移動平均/],
    ],
    kessan: [
      ['segments', /事業別|セグメント|稼ぎ頭/], ['margin', /利益率|同業/], ['progress', /進捗/], ['outlook', /予想|見通し/],
      ['finance', /財務|現金|負債|自己資本|CF|キャッシュ/], ['returns', /配当|EPS|1株|自社株/], ['invest', /投資|設備|使い道/],
      ['deep', /有報|有価証券報告書|中期経営計画|中計/], ['results', /決算短信|売上|利益|決算/],
    ],
  };
  MISS_BY.market = [
    ['level', /PER|乖離|割高|割安|高い安い|値幅/], ['rates', /金利/], ['fx', /為替|ドル円|円安|円高/], ['geo', /地政学/],
    ['news', /ニュース/], ['calendar', /予定|日程|カレンダー/], ['outlook', /シナリオ|見通し/], ['mkchart', /日経平均|指数|日足/],
  ];
  MISS_BY.news = [
    ['cases', /過去事例|事例/], ['reaction', /株価|騰落|反応|日足/], ['related', /波及|関連/], ['impact', /影響|要因|違約|契約/],
    ['event', /出来事|発表|報道/], ['takeaway', /受け止め|確認/],
  ];
  MISS_BY.hansei = [
    ['result', /購入後|値動き|損益|含み/], ['at', /過熱|乖離|RSI|騰落|出来高/], ['position', /位置|サポート|レジスタンス|節目|流れ/],
    ['alt', /別の入り方/], ['entry', /購入日|購入価格/], ['chart', /株価|日足|チャート/],
  ];
  const rulesOf = (a) => MISS_BY[a && a.type] || MISS_RULES;

  /* ---------- 状態 ---------- */
  const S = { route: null, recent: null, seen: {}, testing: false, ctx: null, animTimer: 0, segTimer: 0, ckSel: null, ckItems: [], lvPin: null, mkRange: '1y' };
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
      const rule = rulesOf(a).find(([, re]) => re.test(m));
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
    if (p[0] === 'market') return { view: 'market', date: p[1] || null };
    if (p[0] === 'glossary') return { view: 'glossary', term: p[1] || null };
    if (p[0] === 'notes') return { view: 'notes' };
    return { view: 'home' };
  }
  const hrefMarket = (date) => '#/market' + (date ? '/' + date : '');
  /** ヘッダの画面切替（ホーム・市場・用語帳・気づきノート）。銘柄ページはホームの下にある扱い */
  const GNAV = [
    { key: 'home', href: '#/', icon: 'i-home', label: 'ホーム', fk: 'F1' },
    { key: 'market', href: '#/market', icon: 'i-market', label: '市場', fk: 'F7' },
    { key: 'glossary', href: '#/glossary', icon: 'i-yogo', label: '用語帳', fk: 'F8' },
    { key: 'notes', href: '#/notes', icon: 'i-note', label: '気づきノート', fk: 'F9' },
  ];
  const navKey = (route) => (route.view === 'stock' ? 'home' : route.view);
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
    const nk = navKey(route);
    const cur = (on) => (on ? ' on" aria-current="page' : '');
    const railX = [['market', 'i-market', 'MKT', '市場ページ'], ['glossary', 'i-yogo', 'TERM', '用語帳'], ['notes', 'i-note', 'NOTE', '気づきノート']];
    $('#rail').innerHTML = LOGO
      + `<a class="rl${cur(route.view === 'home')}" href="#/" aria-label="ホーム（銘柄ライブラリ）" data-nav="home"><svg><use href="#i-home"/></svg><span>HOME</span></a>`
      + (rc ? `<a class="rl${cur(onStock)}" href="${hrefStock(rc)}" aria-label="${esc((D.stocks[rc] && D.stocks[rc].name) || rc)} ${esc(rc)}" data-nav="stock"><svg><use href="#i-stock"/></svg><span>${esc(rc)}</span></a>` : '')
      + '<div class="sep"></div>'
      + railX.map(([k, ic, lab, aria]) => `<a class="rl${cur(nk === k)}" href="${GNAV.find((g) => g.key === k).href}" aria-label="${aria}" data-nav="${k}"><svg><use href="#${ic}"/></svg><span>${lab}</span></a>`).join('')
      + '<div class="foot"><i></i>SYS<br>OK</div>';
    const cmd = info.cmd
      ? `<span>${esc(info.cmd)}<i class="cur"></i></span>`
      : '<span><i class="cur"></i><span class="hint">/kabu &lt;銘柄名 or コード&gt; [型]</span></span>';
    const gnav = `<nav class="gnav" aria-label="画面の切替">${GNAV.map((g) => `<a class="gn${cur(nk === g.key)}" href="${g.href}" data-gnav="${g.key}"><svg aria-hidden="true"><use href="#${g.icon}"/></svg>${g.label}</a>`).join('')}</nav>`;
    $('#top').innerHTML = '<div class="brand"><b>KABU LAB</b><span>銘柄分析 × 学習ノート</span></div>' + gnav
      + `<div class="cmdw"><div class="cmdbox" aria-label="コマンド（表示のみ）"><span class="lbl">CMD</span><span class="pr">&gt;</span>${cmd}<kbd>ENTER</kbd></div></div>`
      + `<div class="meta"><span>VIEW <b>${esc(info.view)}</b></span><span>DATE <b>${esc(info.date)}</b></span><span class="u-mid">MODE <b>LEARN</b></span></div>`;
    // 下部：ティッカー（市場データがある時だけ）＋ファンクションキー
    const tape = tapeHtml();
    const types = [['F3', 'kessan', '決算'], ['F4', 'chart', 'チャート'], ['F5', 'news', 'ニュース'], ['F6', 'hansei', '反省']];
    const stockOn = onStock && !types.some(([, ty]) => ty === route.type);
    $('#bot').innerHTML = tape
      + '<nav class="fk" aria-label="ビュー切替">'
      + `<a class="k${route.view === 'home' ? ' on' : ''}" href="#/"><i>F1</i>HOME 銘柄ライブラリ</a>`
      + (rc ? `<a class="k${stockOn ? ' on' : ''}" href="${hrefStock(rc)}"><i>F2</i>STOCK ${esc(rc)}</a>` : '<span class="k off"><i>F2</i>STOCK —</span>')
      + types.map(([k, ty, l]) => (rc ? `<a class="k${onStock && route.type === ty ? ' on' : ''}" href="${hrefStock(rc, ty)}"><i>${k}</i>${l}</a>` : `<span class="k off"><i>${k}</i>${l}</span>`)).join('')
      + GNAV.slice(1).map((g) => `<a class="k${nk === g.key ? ' on' : ''}" href="${g.href}"><i>${g.fk}</i>${g.label}</a>`).join('')
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
    const head = `<div class="ph"><span class="code">MKT-01 / MARKET</span><h2>市場パネル</h2><div class="pm"><span>${esc(raw && raw.date ? raw.date : '')}</span>${goLink('#/market', '市場ページ', 'market')}</div></div>`;
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
    const head = `<div class="ph"><span class="code">MKT-02 / GEO-RISK</span><h2>地政学リスク</h2><div class="pm"><span class="jp">影響度 5段階</span>${goLink('#/market', '市場ページ', 'geo')}</div></div>`;
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
    const head = `<div class="ph"><span class="code">EDU-01 / TERM</span><h2>今日の用語カード</h2><div class="pm">${goLink('#/glossary', '用語帳', 'term')}</div></div>`;
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
    const menu = MENU.map((m, i) => {
      const inner = `<div class="ic"><svg><use href="#${m[0]}"/></svg><i>M-${String(i + 1).padStart(2, '0')}</i></div><b>${m[1]}</b><p>${m[2]}</p><code class="mcmd">${esc(m[5])}</code><div class="wt"><span>${[1, 2, 3, 4].map((k) => `<u class="${k <= m[4] ? 'on' : ''}"></u>`).join('')}</span>${m[3]}${m[6] ? '<em class="mgo">開く ›</em>' : ''}</div>`;
      return m[6] ? `<a class="mi go" href="${m[6][0]}" data-menu="${m[0]}" aria-label="${esc(m[1])}：${esc(m[6][1])}を開く（コマンド ${esc(m[5])}）">${inner}</a>` : `<div class="mi" data-menu="${m[0]}">${inner}</div>`;
    }).join('');
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
      return `<span><i class="sw bd"></i>${name} ${v.map((x) => `<b>${K.fmtP(x.price)}円</b>${x.label ? `（${esc(x.label)}）` : ''}`).join('・')}</span>`;
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
  function segRowHtml(x, i, noMargin, maxP, maxM, total) {
    const m = isNum(x.margin) ? x.margin : null;
    const w = noMargin ? (isNum(x.profit) && maxP > 0 ? K.clamp(x.profit / maxP * 100, 0, 100) : 0) : m != null ? K.clamp(m / maxM * 100, 0, 100) : 0;
    const head = `<span class="srh"><i></i><span class="sn">${esc(x.name)}</span>${x.note ? `<span class="yoy">${esc(x.note)}</span>` : ''}<span class="pf${isNum(x.profit) && x.profit < 0 ? ' dn' : ''}">${fmt(x.profit)}<small>億円</small></span></span>`;
    const xp = x.other ? `<b class="xp" aria-hidden="true">◀ 全${total}事業を見る</b>` : '';
    const bar = noMargin
      ? `<span class="mbar pbar"><span class="tr"><u class="a-gx" style="width:${w.toFixed(1)}%"></u></span>${xp}</span>`
      : `<span class="mbar"><span class="tr"><u class="a-gx" style="width:${w.toFixed(1)}%"></u></span>${x.other ? xp : `<b>${m != null ? fmt(m, 1) + '%' : '—'}</b>`}</span>`;
    if (x.other) return `<button type="button" class="srow other" style="--k:${x.color}" data-seg-toggle aria-expanded="false" aria-controls="seg-pop" aria-label="${esc(x.name)}を含む全${total}事業を一覧で開く">${head}${bar}</button>`;
    return `<div class="srow" style="--k:${x.color}">${head}${bar}</div>`;
  }
  function segPanel(a) {
    if (secAbsent(a, 'segments')) return panel('segments', 'SYS-07 / SEGMENT', '稼ぎ頭マップ', '', `<div class="pb">${noData('segments', a, { sm: true })}</div>`);
    const M = K.segModel(arr(a.sections.segments));
    // 利益率が1つも無いとき（純利益だけの開示など）は、利益率の凡例とバーを出さず、利益額の横棒にする
    const noMargin = !M.hasMargin;
    const rows = M.collapsed;
    const maxP = Math.max(1, ...rows.map((x) => (isNum(x.profit) ? x.profit : 0)));
    const donut = K.donut(rows.map((x) => ({ v: x.profit, color: x.color })));
    const rowsH = rows.map((x, i) => segRowHtml(x, i, noMargin, maxP, M.maxM, M.count)).join('');
    return panel('segments', 'SYS-07 / SEGMENT', '稼ぎ頭マップ', '', `<div class="pb"><div class="sg-top">${donut}<div class="t"><span class="code">PROFIT</span>円＝事業別の利益<br>${noMargin ? 'バー＝利益の大きさ' : `バー＝利益率（0〜${M.maxM}%）`}</div></div><div class="sg-rows">${rowsH}</div></div>`);
  }
  /** 展開パネル（業績推移の上に重なる。右端は稼ぎ頭パネルと揃え、幅は2枠ぶん） */
  function segPopHtml(a) {
    const M = K.segModel(arr(a.sections.segments));
    const donut = K.donut(M.all.map((x) => ({ v: x.profit, color: x.color })), { cls: 'sp-dn' });
    const why = arr(a.missing).filter((m) => typeof m === 'string' && rulesOf(a).find(([, re]) => re.test(m))?.[0] === 'segments').join(' ／ ');
    return `<div class="seg-pop" id="seg-pop" role="region" aria-label="稼ぎ頭マップ（全${M.count}事業）"><section class="panel" data-pop="segments"><div class="pi">
      <div class="ph"><span class="code">SYS-07 / SEGMENT</span><h2>稼ぎ頭マップ（全${M.count}事業）</h2><div class="pm"><span class="jp">利益の大きい順${M.count > 8 ? '・上位8' : ''}</span><button type="button" class="sp-x" data-seg-close aria-label="閉じる">×</button></div></div>
      <div class="sp-b">
        <div class="sp-l">${donut}<div class="sp-tot"><span>合計</span><b>${fmt(M.total)}<small>億円</small></b></div><p class="cap">円＝事業別の利益<br>横棒＝利益の大きさ（最大の事業＝100%）${M.hasMargin ? '<br>右＝利益率' : ''}</p>${why ? `<p class="cap">${esc(why)}</p>` : ''}</div>
        <ol class="sp-list${M.hasMargin ? ' m' : ''}" tabindex="-1" aria-label="事業の一覧">${K.segListHtml(M)}</ol>
      </div>
      <div class="sp-f"><button type="button" class="sp-fold" data-seg-toggle aria-expanded="true" aria-controls="seg-pop">▶ たたむ（上位3＋その他に戻す）</button><span class="cap">Esc・枠の外を押しても閉じます</span></div>
    </div></section></div>`;
  }
  function segIsOpen() { return !!$('#seg-pop'); }
  function segSet(open, opt = {}) {
    const pair = $('.pair');
    const btn = $('.srow.other[data-seg-toggle]');
    const pop = $('#seg-pop');
    if (!pair || !S.ctx || !btn) return;
    clearTimeout(S.segTimer);
    if (open) {
      if (pop && !pop.classList.contains('closing')) return;
      if (pop) pop.remove();
      pair.insertAdjacentHTML('beforeend', segPopHtml(S.ctx.a));
      const el = $('#seg-pop');
      el.style.minHeight = pair.getBoundingClientRect().height + 'px';
      btn.setAttribute('aria-expanded', 'true');
      if (!RM && !S.testing) {
        const off = $('[data-sec="segments"]', pair).getBoundingClientRect().left - pair.getBoundingClientRect().left;
        el.style.clipPath = `inset(0 0 0 ${off}px)`;
        el.getBoundingClientRect();
        el.classList.add('tr');
        S.segTimer = setTimeout(() => { el.style.clipPath = 'inset(0 0 0 0px)'; S.segTimer = setTimeout(() => { el.style.clipPath = ''; el.classList.remove('tr'); }, 260); }, 16);
      }
      if (opt.focus !== false) $('.sp-list', el).focus({ preventScroll: true });
    } else {
      if (!pop) return;
      btn.setAttribute('aria-expanded', 'false');
      const done = () => { pop.remove(); };
      if (!RM && !S.testing) {
        const off = $('[data-sec="segments"]', pair).getBoundingClientRect().left - pair.getBoundingClientRect().left;
        pop.classList.add('tr', 'closing');
        pop.style.clipPath = 'inset(0 0 0 0px)';
        pop.getBoundingClientRect();
        pop.style.clipPath = `inset(0 0 0 ${off}px)`;
        S.segTimer = setTimeout(done, 200);
      } else done();
      if (opt.focus !== false) btn.focus({ preventScroll: true });
    }
  }
  function scenPanel(a, dec) {
    const close = a.price && isNum(a.price.close) ? a.price.close : null;
    const pm = `<span class="jp">起点 <span class="u-wide">現在値 </span><span class="mono">${K.fmtP(close)}</span>円</span>`;
    if (secAbsent(a, 'scenarios')) return panel('scenarios', 'SYS-06 / SCENARIO', '3つのシナリオ', pm, `<div class="pb">${noData('scenarios', a)}</div>`);
    const cards = scenCards(arr(a.sections.scenarios));
    return panel('scenarios', 'SYS-06 / SCENARIO', '3つのシナリオ', pm, `<div class="pb"><div class="scn"><div class="host" id="fan" data-chart="fan"></div><div class="scards">${cards}</div></div></div>`);
  }
  /** シナリオ3枚（強気・中立・弱気）。quick の scenarios と market の outlook で共通 */
  function scenCards(list) {
    const order = [['bull', 'SCN-A', 'bull'], ['base', 'SCN-B', 'mid'], ['bear', 'SCN-C', 'bear']];
    return order.map(([k, code, cls]) => {
      const s = list.find((x) => x && x.kind === k);
      if (!s) return '';
      const label = s.target && typeof s.target.label === 'string' ? s.target.label : '';
      const m = /\d[\d,.]*(?:[〜~]\d[\d,.]*)?円/.exec(label);
      const tgt = label ? (k !== 'base' ? '目安 ' : '') + (m ? esc(label.slice(0, m.index)) + `<em>${esc(m[0])}</em>` + esc(label.slice(m.index + m[0].length)) : esc(label)) : '';
      const txt = s.text && s.text !== label ? s.text + (/[。．.！？!?」]$/.test(s.text) ? '' : '。') : '';
      return `<div class="sc ${cls}" data-scn="${k}"><div class="sch"><span class="scode">${code}</span><b>${esc(s.title || '')}</b><span class="tgt">${tgt}</span></div>${txt ? `<p>${esc(txt)}</p>` : ''}${s.breakIf ? `<div class="inv"><span>崩れる条件</span>${esc(s.breakIf)}</div>` : ''}</div>`;
    }).join('');
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
    S.ckItems = items;
    return panel('checklist', 'SYS-08 / PATTERN', 'チャート型チェックリスト', `<span class="jp">${items.length}項目</span>`, `<div class="pb"><div class="ck-sum">${ck.summary}</div><div class="ckg" role="group" aria-label="チェックリスト（押すと理由を表示）">${ck.cells}</div><div class="ck-why" data-ck-why aria-live="polite">${K.ckReasons(items, null)}</div></div>`);
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

  /* =====================================================================
     チャート型（P2b）：3つの時間軸・メインチャート＋価格帯別出来高・サポレジ一覧・過熱の物差し・
     チェックリスト（理由つき）・売買タイミングの考え方（3レーン）・今回の読み方
     ===================================================================== */
  const TF = {
    monthly: ['TF-1', '月足', '大きな流れ'],
    weekly: ['TF-2', '週足', '中くらいの流れ'],
    daily: ['TF-3', '日足', '直近の動き'],
  };
  const TREND = { up: ['上昇', 'up'], flat: ['横ばい', 'flat'], down: ['下降', 'down'] };
  const HEAT_STATE = { calm: '落ち着き', warm: 'やや過熱', hot: '過熱' };
  const PLAN = { pullback: ['PLAN-A', '押し目を待つ考え方'], breakout: ['PLAN-B', '上抜けを待つ考え方'], wait: ['PLAN-C', '見送る考え方'] };
  const PLAN_AXIS = 76, PLAN_GAP = 10;
  const trendIcon = (k) => {
    const d = k === 'up' ? 'M2 14L18 4M11.5 3.2L18 4L15.8 10.2' : k === 'down' ? 'M2 3L18 13M15.8 6.8L18 13L11.5 13.8' : 'M2 8.5H19M14 4.5L19 8.5L14 12.5';
    return `<svg class="tri" viewBox="0 0 21 17" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  };
  const secs = (a) => (a && a.sections && typeof a.sections === 'object' ? a.sections : {});
  const ymd = (d) => (typeof d === 'string' && d.length >= 7 ? d.slice(0, 7).replace('-', '.') : '');

  /** チャート型の描画材料（日足6か月の窓と、それに揃えた移動平均・週足・月足） */
  function chartCtx(st, a) {
    const raw = arr(st && st.prices && st.prices.rows);
    const asOf = (a.price && a.price.asOf) || a.date || '';
    const I = st && st.indicators && typeof st.indicators === 'object' ? st.indicators : null;
    const ok = (r) => r && typeof r.d === 'string' && isNum(r.c) && (!asOf || r.d <= asOf);
    const idx = [];
    raw.forEach((r, i) => { if (ok(r)) idx.push(i); });
    let si = 0;
    if (idx.length) {
      const dt = new Date(raw[idx[idx.length - 1]].d + 'T00:00:00Z');
      dt.setUTCMonth(dt.getUTCMonth() - 6);
      const start = isNaN(dt) ? '' : dt.toISOString().slice(0, 10);
      si = Math.max(0, idx.findIndex((i) => raw[i].d > start));
    }
    const maArr = (k) => (I && I.ma && Array.isArray(I.ma[k]) && I.ma[k].length === raw.length ? I.ma[k] : null);
    const pick = (ids, k) => { const m = maArr(k); return m ? ids.map((i) => m[i]) : null; };
    const wi = idx.slice(si), di = idx.slice(-60);
    const agg = (list, n) => arr(list).filter((r) => r && typeof r.d === 'string' && (!asOf || r.d <= asOf)).slice(-n);
    const S2 = secs(a);
    return {
      kind: 'chart', st, a, I,
      dec: stockDec(st, [a.price && a.price.close]),
      close: a.price && isNum(a.price.close) ? a.price.close : null,
      rows: wi.map((i) => raw[i]),
      ma: { ma25: pick(wi, 'ma25'), ma75: pick(wi, 'ma75'), ma200: pick(wi, 'ma200') },
      tf: {
        monthly: { bars: I ? agg(I.monthly, 36) : [], ma: null },
        weekly: { bars: I ? agg(I.weekly, 52) : [], ma: null },
        daily: { bars: di.map((i) => raw[i]), ma: pick(di, 'ma25') },
      },
      levels: arr(S2.levels).map((L, i) => (L && typeof L === 'object' ? { ...L, i } : null)).filter((L) => L && isNum(L.low) && isNum(L.high)),
      plans: ['pullback', 'breakout', 'wait'].map((k) => arr(S2.plans).find((p) => p && p.kind === k) || null),
    };
  }

  function tfPanel(c) {
    const a = c.a, list = arr(secs(a).timeframes);
    const why = missFor(a, 'timeframes');
    const pm = '<span class="jp tf-rd">読む順 <b>月足</b> ▶ <b>週足</b> ▶ <b>日足</b>（上位の足から）</span>';
    const note = why ? `<p class="tfmiss" data-nodata="timeframes:note"><span class="nd">未取得</span>${esc(why)}</p>` : '';
    if (secAbsent(a, 'timeframes')) return panel('timeframes', 'SYS-C1 / TIMEFRAME', '3つの時間軸', pm, `<div class="pb">${noData('timeframes', a, { sm: true })}</div>`);
    const cells = ['monthly', 'weekly', 'daily'].map((k, i) => {
      const t = list.find((x) => x && x.frame === k), d = TF[k], tr = t && TREND[t.trend];
      const bars = c.tf[k].bars, n = bars.length;
      const cap = n ? `${k === 'daily' ? bars[0].d.replace(/-/g, '.') : ymd(bars[0].d)} – ${k === 'daily' ? bars[n - 1].d.slice(5).replace('-', '.') : ymd(bars[n - 1].d)} ・ ${n}本${k === 'daily' && c.tf.daily.ma ? ' ・ 白線＝25日線' : ''}` : '';
      const badge = tr ? `<span class="trd ${tr[1]}">${trendIcon(t.trend)}${tr[0]}</span>` : `<span class="trd nd" data-nodata="timeframes:${k}">未取得</span>`;
      return `<div class="tf" data-tf="${k}"><div class="tfh"><span class="stp">${String(i + 1).padStart(2, '0')}</span><span class="code">${d[0]}</span><b>${d[1]}</b><span class="tfs">${d[2]}</span>${badge}</div>`
        + `<div class="host tfc" data-chart="tf" data-k="${k}"></div><div class="tfcap mono">${esc(cap)}</div>`
        + `<p>${t ? richNums(t.text) : esc(missFor(a, 'timeframes') || 'この時間軸の判断がありません')}</p></div>`
        + (i < 2 ? '<div class="tfa" aria-hidden="true"><i></i><b>▶</b><i></i></div>' : '');
    }).join('');
    return panel('timeframes', 'SYS-C1 / TIMEFRAME', '3つの時間軸', pm, `<div class="pb">${note}<div class="tf3">${cells}</div></div>`);
  }

  function lvChartPanel(c) {
    const a = c.a;
    if (!c.rows.length) return panel('lvchart', 'SYS-C2 / CHART', '株価チャートと節目（日足）', '', `<div class="pb">${noData('price', a, { def: '株価データ（prices.json）がありません' })}</div>`);
    const first = c.rows[0].d, last = c.rows[c.rows.length - 1].d;
    const lt = c.I && c.I.latest && Array.isArray(c.I.latest.ma) ? c.I.latest.ma : [];
    const maV = (n) => { const m = lt.find((x) => x && x.n === n); return m && isNum(m.value) ? `<b>${K.fmtP(c.dec === 0 ? Math.round(m.value) : m.value)}円</b>` : ''; };
    const hasMa = !!(c.ma.ma25 || c.ma.ma75 || c.ma.ma200);
    const vp = c.I && c.I.volumeProfile && arr(c.I.volumeProfile.bins).length ? c.I.volumeProfile : null;
    const legend = '<span><i class="sw cu"></i>陽線</span><span><i class="sw cd"></i>陰線</span>'
      + (hasMa ? `<span><i class="sw l25"></i>25日線 ${maV(25)}</span><span><i class="sw l75"></i>75日線 ${maV(75)}</span><span><i class="sw l200"></i>200日線 ${maV(200)}</span>` : '')
      + '<span><i class="sw lvr-r"></i>レジスタンス（線・帯）</span><span><i class="sw lvr-s"></i>サポート（線・帯）</span>'
      + (vp ? '<span><i class="sw vpw"></i>価格帯別出来高</span>' : '')
      + (!hasMa || !vp ? `<span class="ndn" data-nodata="indicators">${!hasMa && !vp ? '移動平均線・価格帯別出来高' : !hasMa ? '移動平均線' : '価格帯別出来高'}は未取得${missFor(a, 'price') ? '（' + esc(missFor(a, 'price')) + '）' : ''}</span>` : '');
    const cap = vp ? `<div class="lvcap"><span>価格帯別出来高＝直近250日 ・ 刻み <span class="mono">${esc(K.fmtP(vp.step))}</span>円</span><span><i class="sw vpm"></i>最多の帯（％は全体に占める割合）</span><span><i class="sw vpn"></i>現在値を含む帯</span><span>右端の札＝線は価格、帯は「下限–上限」</span></div>` : '';
    return panel('lvchart', 'SYS-C2 / CHART', '株価チャートと節目（日足）', `<span>${esc(first.replace(/-/g, '.'))} – ${esc(last.slice(5).replace('-', '.'))}</span><span>${c.rows.length}本</span>`,
      `<div class="pb"><div class="legend">${legend}</div><div class="host lvhost" data-chart="lv"></div>${cap}</div>`);
  }

  function levelsPanel(c) {
    const a = c.a;
    if (!c.levels.length) return panel('levels', 'SYS-C3 / LEVELS', 'サポート／レジスタンス', '', `<div class="pb">${noData('levels', a, { sm: true })}</div>`);
    const close = c.close;
    const mid = (L) => (L.low + L.high) / 2;
    const list = [...c.levels].sort((x, y) => mid(y) - mid(x) || y.high - x.high);
    const nR = list.filter((L) => L.kind === 'resistance').length;
    const dist = (L) => {
      if (!isNum(close) || !close) return '';
      const lo = Math.min(L.low, L.high), hi = Math.max(L.low, L.high);
      if (close >= lo && close <= hi) return '<em class="ld in">現在値を含む</em>';
      const p = close > hi ? hi : lo;
      return `<em class="ld">現在値比 <span class="mono">${fmtS((p / close - 1) * 100, 1)}%</span></em>`;
    };
    let nowDone = false;
    const nowRow = `<div class="lvnow" aria-hidden="true"><i></i><span>現在値 <b class="mono">${K.fmtP(close)}</b>円</span><i></i></div>`;
    const rows = list.map((L) => {
      let pre = '';
      if (!nowDone && isNum(close) && mid(L) < close) { pre = nowRow; nowDone = true; }
      const r = L.kind === 'resistance';
      const lo = Math.min(L.low, L.high), hi = Math.max(L.low, L.high);
      // 折り返すのは「〜」の後だけ（「円」だけが次の行に落ちないよう、数値と後ろの文字をひとかたまりにする）
      const price = lo === hi ? `<span class="nw"><span class="mono">${K.fmtP(lo)}</span><small>円</small></span>` : `<span class="nw"><span class="mono">${K.fmtP(lo)}</span><small>〜</small></span><span class="nw"><span class="mono">${K.fmtP(hi)}</span><small>円</small></span>`;
      const basis = arr(L.basis).filter((b) => typeof b === 'string' && b).map((b) => `<span>${esc(b)}</span>`).join('');
      return `${pre}<button type="button" class="lvr ${r ? 'r' : 's'}" data-lv="${L.i}" aria-pressed="false" aria-label="${r ? 'レジスタンス' : 'サポート'} ${esc(lo === hi ? K.fmtP(lo) : K.fmtP(lo) + '〜' + K.fmtP(hi))}円 ${esc(L.label || '')}。押すとチャートの線を強調">`
        + `<span class="lvk"><b>${r ? 'RES' : 'SUP'}<i>${lo === hi ? '線' : '帯'}</i></b><small>${r ? '上値の壁' : '下値の支え'}</small></span>`
        + `<span class="lp"><span class="lpv">${price}</span>${dist(L)}</span>`
        + `<span class="lvs" title="強さ ${esc(L.strength)}／5">${K.segs(L.strength)}<small>強さ</small></span>`
        + `<span class="ll"><b>${esc(L.label || '')}</b><span class="lb">${basis}</span></span></button>`;
    }).join('') + (!nowDone && isNum(close) ? nowRow : '');
    return panel('levels', 'SYS-C3 / LEVELS', 'サポート／レジスタンス', `<span class="jp">上 ${nR} ・ 下 ${list.length - nR}</span>`,
      `<div class="pb"><div class="lvhd"><span>種別</span><span>価格</span><span>強さ</span><span>根拠</span></div><div class="lvlist" role="group" aria-label="サポート・レジスタンスの一覧（価格の高い順）">${rows}</div><p class="cap lvtip">行にマウスを重ねる・押すと、チャートの該当ラインを強調（もう一度押すと解除）</p></div>`);
  }

  function heatPanel(c) {
    const a = c.a;
    const pm = '<span class="jp"><i class="sw hzsw"></i>過熱の目安の帯</span><span class="jp"><i class="hdot calm"></i>落ち着き <i class="hdot warm"></i>やや過熱 <i class="hdot hot"></i>過熱</span>';
    if (secAbsent(a, 'heat')) return panel('heat', 'SYS-C4 / HEAT', '過熱の物差し', pm, `<div class="pb">${noData('heat', a, { sm: true })}</div>`);
    const list = arr(secs(a).heat);
    const cells = ['ma25dev', 'rsi', 'change3d', 'volume'].map((k) => {
      const h = K.HEAT[k], it = list.find((x) => x && x.key === k);
      const v = it && isNum(it.value) ? it.value : null;
      const note = it && typeof it.note === 'string' ? it.note : '';
      if (v == null) {
        return `<div class="hc" data-nodata="heat:${k}"><div class="hch"><span class="hn">${esc(h.name)}</span><span class="nd">未取得</span></div><div class="hv"><b class="na">—</b></div>${K.heatGauge(k, null)}<p class="hr">${esc(h.rule)}</p><p class="hnote">${esc(note || missFor(a, 'heat') || '値の記載がありません')}</p></div>`;
      }
      const stt = HEAT_STATE[it.state] ? it.state : 'calm';
      return `<div class="hc ${stt}"><div class="hch"><span class="hn">${esc(h.name)}</span><span class="hs ${stt}">${HEAT_STATE[stt]}</span></div>`
        + `<div class="hv"><b>${esc(K.heatValue(k, v))}</b><small>${esc(h.unit)}</small></div>${K.heatGauge(k, v, stt)}<p class="hr">${esc(h.rule)}</p>${note ? `<p class="hnote">${richNums(note)}</p>` : ''}</div>`;
    }).join('');
    return panel('heat', 'SYS-C4 / HEAT', '過熱の物差し', pm, `<div class="pb"><div class="heat4">${cells}</div></div>`);
  }

  function ckPanelC(c) {
    const a = c.a;
    const pm = '<span class="jp">10項目 ・ 理由つき</span>';
    if (secAbsent(a, 'checklist')) return panel('checklist', 'SYS-C5 / PATTERN', 'チャート型チェックリスト（詳しい理由）', pm, `<div class="pb">${noData('checklist', a)}</div>`);
    const names = arr(window.KABU.checklistItems), got = arr(secs(a).checklist);
    const base = names.length ? names : got.map((x) => ({ id: x && x.id, name: '' }));
    const items = base.map((it) => { const x = got.find((y) => y && y.id === it.id) || {}; return { id: it.id, name: it.name, status: x.status, reason: x.reason, watch: x.watch }; });
    const ck = K.checklist(items);
    S.ckItems = items;
    const G = [['progress', 'p', '進行中', '次に見る点つき'], ['done', 'd', '完成済み', ''], ['none', 'x', 'なし', '']];
    const cols = G.map(([st, k, lab, sub]) => {
      const its = items.filter((x) => x.status === st);
      const cards = its.map((x) => `<div class="cr ${k}" data-why="${esc(x.id)}"><div class="crt"><span class="cid">${esc(String(x.id).replace(/^C/, 'C-'))}</span><b>${esc(x.name || '')}</b></div><p>${richNums(x.reason || '理由の記載がありません')}</p>`
        + (st === 'progress' && x.watch ? `<div class="wch"><span>次に見る点</span><p>${richNums(x.watch)}</p></div>` : '') + '</div>').join('');
      return `<div class="crc ${k}"><div class="crh"><svg><use href="#st-${k}"/></svg><b>${lab}</b><em>${its.length}</em>${sub ? `<small>${sub}</small>` : ''}</div>${cards || '<p class="cwn">該当なし</p>'}</div>`;
    }).join('');
    const unk = items.filter((x) => !CKS.includes(x.status));
    const unkH = unk.length ? `<div class="cr-u" data-nodata="checklist:status">判定が未取得の項目：${unk.map((x) => esc(String(x.id).replace(/^C/, 'C-'))).join('・')}</div>` : '';
    return panel('checklist', 'SYS-C5 / PATTERN', 'チャート型チェックリスト（詳しい理由）', pm,
      `<div class="pb"><div class="ck-sum">${ck.summary}</div><div class="ckg ck10" role="group" aria-label="チェックリスト（押すと下の理由を強調）">${ck.cells}</div><div class="crb">${cols}</div>${unkH}</div>`);
  }
  const CKS = ['done', 'progress', 'none'];

  function plansPanel(c) {
    const a = c.a;
    const pm = `<span class="jp">3つの考え方を同じ物差しで比べる</span><span class="jp">起点 現在値 <span class="mono">${K.fmtP(c.close)}</span>円</span>`;
    if (secAbsent(a, 'plans')) return panel('plans', 'SYS-C6 / TIMING', '売買タイミングの考え方', pm, `<div class="pb">${noData('plans', a)}</div>`);
    const kinds = ['pullback', 'breakout', 'wait'];
    const heads = kinds.map((k, i) => {
      const p = c.plans[i], d = PLAN[k];
      return `<div class="plh"><span class="code">${d[0]}</span><b>${d[1]}</b>${p && p.title ? `<span class="plt">${esc(p.title)}</span>` : ''}</div>`;
    }).join('');
    const px = (v) => (isNum(v) ? `<span class="mono">${K.fmtP(v)}</span>円` : '');
    const cards = kinds.map((k, i) => {
      const p = c.plans[i];
      if (!p) return `<div class="plc" data-nodata="plans:${k}"><div class="nodata sm"><span class="nd">未取得</span><p class="why">${esc(missFor(a, 'plans') || 'この考え方の記載がありません')}</p></div></div>`;
      const z = p.zone || {}, zl = isNum(z.low) ? z.low : null, zh = isNum(z.high) ? z.high : null;
      const zone = zl != null && zh != null ? (zl === zh ? px(zl) : `${px(Math.min(zl, zh))}〜${px(Math.max(zl, zh))}`) : zl != null ? px(zl) : zh != null ? px(zh) : '';
      const dd = (val, lab) => (val ? `<dd>${val}${lab ? `<small>${esc(lab)}</small>` : ''}</dd>` : `<dd class="na">指定なし${lab ? `<small>${esc(lab)}</small>` : ''}</dd>`);
      return `<div class="plc"><div class="plw"><span>どうなったら</span><p>${richNums(p.when || '')}</p></div>`
        + `<dl class="pld"><div><dt><i class="sw plz"></i>入る価格帯</dt>${dd(zone, '')}</div><div><dt><i class="sw pls"></i>撤退ライン</dt>${dd(p.stop && isNum(p.stop.price) ? px(p.stop.price) : '', p.stop && p.stop.label)}</div><div><dt><i class="sw plg"></i>目安</dt>${dd(p.target && isNum(p.target.price) ? px(p.target.price) : '', p.target && p.target.label)}</div></dl>`
        + `<div class="plpc"><div class="pp"><span>良い点</span><p>${richNums(p.pros || '')}</p></div><div class="pc"><span>注意点</span><p>${richNums(p.cons || '')}</p></div></div></div>`;
    }).join('');
    const axisHead = '<div class="plax"><span>価格</span><small>円</small></div>';
    const legend = '<div class="pllg"><span><i class="sw pln"></i>現在値</span><span><i class="sw plz"></i>入る価格帯</span><span><i class="sw pls"></i>撤退</span><span><i class="sw plg"></i>目安</span><span class="cap">％は現在値比</span></div>';
    return panel('plans', 'SYS-C6 / TIMING', '売買タイミングの考え方', pm,
      `<div class="pb"><div class="plgrid" style="grid-template-columns:${PLAN_AXIS}px repeat(3,minmax(0,1fr));column-gap:${PLAN_GAP}px">${axisHead}${heads}<div class="host plhost" data-chart="plans"></div>${legend}${cards}</div><p class="plnote">どれも「〜なら」という条件つきの考え方です。どれかを勧めるものではなく、売買の推奨ではありません。</p></div>`);
  }

  function lessonPanel(c) {
    const a = c.a, S2 = secs(a);
    const ls = S2.lesson && typeof S2.lesson === 'object' ? S2.lesson : null;
    const tfs = arr(S2.timeframes);
    const tr = ['monthly', 'weekly', 'daily'].map((k) => { const t = tfs.find((x) => x && x.frame === k), r = t && TREND[t.trend]; return `<span class="trd sm ${r ? r[1] : ''}">${r ? trendIcon(t.trend) : ''}${TF[k][1]}${r ? '' : ' —'}</span>`; }).join('');
    const nR = c.levels.filter((L) => L.kind === 'resistance').length, nS = c.levels.length - nR;
    const heat = arr(S2.heat).filter((h) => h && isNum(h.value));
    const hc = (s) => heat.filter((h) => h.state === s).length;
    const cks = arr(S2.checklist);
    const cc = (s) => cks.filter((x) => x && x.status === s).length;
    const steps = [
      ['01', '流れ', '上位の足から', `<span class="sv">${tr}</span>`],
      ['02', '節目', 'どこで止まりやすいか', `<span class="sv"><b class="r">上 ${nR}</b><b class="s">下 ${nS}</b></span>`],
      ['03', '過熱', '行き過ぎていないか', heat.length ? `<span class="sv"><b>過熱 ${hc('hot')}</b><b>やや ${hc('warm')}</b><b>平常 ${hc('calm')}</b></span>` : '<span class="sv"><b class="na">値なし</b></span>'],
      ['04', '形', 'チェックリスト', `<span class="sv"><b>完成 ${cc('done')}</b><b>進行中 ${cc('progress')}</b></span>`],
      ['05', '考え方', '条件つきで3案', `<span class="sv"><b>${arr(S2.plans).length}案</b></span>`],
    ];
    const flow = steps.map((s, i) => `<div class="lsn"><span class="n">${s[0]}</span><b>${s[1]}</b><small>${s[2]}</small>${s[3]}</div>${i < steps.length - 1 ? '<i class="lsa" aria-hidden="true">▶</i>' : ''}`).join('');
    const body = ls ? `<div class="lsx"><span class="code">LESSON</span><h3>${esc(ls.title || '')}</h3><p>${richNums(ls.text || '')}</p></div>` : noData('lesson', a, { sm: true });
    return panel('lesson', 'SYS-C7 / LESSON', '今回の読み方', '<span class="jp">このページを読む手順と今回の結果</span>', `<div class="pb"><div class="lsgrid"><div class="lsf">${flow}</div>${body}</div></div>`);
  }

  function chartView(c) {
    return `<div id="cview" class="cv">
    ${tfPanel(c)}
    <div class="cv-r2">${lvChartPanel(c)}${levelsPanel(c)}</div>
    ${heatPanel(c)}
    ${ckPanelC(c)}
    ${plansPanel(c)}
    ${lessonPanel(c)}
    ${notesPanel(c.a)}
  </div>`;
  }

  /* =====================================================================
     決算型（P2b）
     ===================================================================== */
  const GRADE = { good: [0.85, '好決算', 'g'], normal: [0.5, '普通', 'n'], bad: [0.15, '悪決算', 'b'] };
  const STANCE = { bullish: [0.85, '強気'], neutral: [0.5, '中立'], cautious: [0.15, '慎重'] };
  const REVISION = { up: ['▲', '上方修正', 'up'], none: ['―', '据え置き', 'flat'], down: ['▼', '下方修正', 'dn'] };
  const unitTxt = (u) => (typeof u === 'string' ? u : '');
  const numU = (v, u, d) => (isNum(v) ? `<span class="mono">${fmt(v, d == null ? decOf(v, 2) : d)}</span><small>${esc(unitTxt(u))}</small>` : '');
  const yoyBadge = (v, lab = '前年比') => (isNum(v) ? `<span class="yy ${v > 0 ? 'up' : v < 0 ? 'dn' : 'flat'}">${v > 0 ? '▲' : v < 0 ? '▼' : '＝'} ${esc(lab)} <span class="mono">${fmtS(v, 1)}%</span></span>` : `<span class="yy na">${esc(lab)} —</span>`);
  const decOf = K.decOf;

  function kessanCtx(st, a) {
    const S2 = secs(a), F = st && st.finance && typeof st.finance === 'object' ? st.finance : null;
    const q = F && F.quarterly && Array.isArray(F.quarterly.rows) ? F.quarterly.rows.filter((r) => r && typeof r.period === 'string' && isNum(r.opMargin)).slice(-8).map((r) => ({ period: r.period, v: r.opMargin })) : [];
    return {
      kind: 'kessan', st, a, F,
      results: arr(S2.results).filter((r) => r && typeof r === 'object'),
      qm: q.length >= 2 ? q : [],
      divs: S2.returns && typeof S2.returns === 'object' ? arr(S2.returns.dividends) : [],
      eps: S2.returns && typeof S2.returns === 'object' ? arr(S2.returns.eps) : [],
    };
  }
  function kmeter(v, l, r) { return `<div class="mt">${K.meter(v)}<span class="ml" data-side="l">${esc(l)}</span><span class="ml" data-side="r">${esc(r)}</span></div>`; }

  function verdictPanel(c) {
    const a = c.a, S2 = secs(a), p = S2.period && typeof S2.period === 'object' ? S2.period : {}, v = S2.verdict && typeof S2.verdict === 'object' ? S2.verdict : null;
    const g = v && GRADE[v.grade];
    const per = `<div class="kpd"><span class="code">PERIOD</span><b>${esc(p.label || '—')}</b><span class="kpmeta"><span>発表 <span class="mono">${esc(p.announced || '—')}</span></span></span>${p.docTitle ? `<span class="kdoc"><i>資料</i>${esc(p.docTitle)}</span>` : ''}</div>`;
    const body = g
      ? `<div class="kvm">${kmeter(g[0], '悪決算', '好決算')}<div class="kvl ${g[2]}"><span class="code">GRADE</span><b>${esc(v.label || g[1])}</b><small>出来の評価</small></div></div><p class="kvr">${richNums(v.reason || '')}</p>`
      : noData('verdict', a, { sm: true });
    return panel('verdict', 'SYS-K1 / RESULT', '決算の判定', '', `<div class="pb">${per}${body}<p class="kno">※ 決算の出来（好決算・普通・悪決算）の評価であり、売買の判断ではありません</p></div>`);
  }
  function pointsPanel(c) {
    const a = c.a, list = arr(secs(a).points).filter((x) => x && typeof x === 'object');
    if (!list.length) return panel('points', 'SYS-K2 / POINTS', '判定の理由', '', `<div class="pb">${noData('points', a, { sm: true })}</div>`);
    const cards = list.map((x, i) => `<div class="kpt"><span class="kn">${String(i + 1).padStart(2, '0')}</span><div><b>${esc(x.title || '')}</b><p>${richNums(x.text || '')}</p></div></div>`).join('');
    return panel('points', 'SYS-K2 / POINTS', '判定の理由', `<span class="jp">${list.length}点</span>`, `<div class="pb"><div class="kpts">${cards}</div></div>`);
  }
  function resultsPanel(c) {
    const a = c.a, S2 = secs(a), dr = S2.driver && typeof S2.driver === 'object' ? S2.driver : null;
    const pm = '<span class="jp"><i class="sw r3c"></i>今期</span><span class="jp"><i class="sw r3p"></i>前年（今期と前年比から逆算した概算）</span>';
    const drv = `<aside class="kdr"><span class="code">DRIVER</span><span class="kdl">伸びた（落ちた）一番の理由</span>${dr ? `<b>${esc(dr.title || '')}</b><p>${richNums(dr.text || '')}</p>` : noData('driver', a, { sm: true })}</aside>`;
    if (!c.results.length) return panel('results', 'SYS-K3 / RESULTS', '主要数値（前年同期比）', pm, `<div class="pb"><div class="kres">${noData('results', a, { sm: true })}${drv}</div></div>`);
    const cells = c.results.map((r, i) => {
      const has = isNum(r.value);
      const inner = has
        ? `<div class="host krh" data-chart="pair" data-i="${i}"></div><div class="krv">${numU(r.value, r.unit)}</div>${yoyBadge(r.yoyPct)}`
        : `<div class="nodata sm" data-nodata="results:${esc(r.key || i)}"><span class="nd">未取得</span><p class="why">${esc(missFor(a, 'results') || '数値の記載がありません')}</p></div>`;
      return `<div class="krc"><b class="krl">${esc(r.label || r.key || '')}</b>${inner}${r.note ? `<p class="krn">${richNums(r.note)}</p>` : ''}</div>`;
    }).join('');
    return panel('results', 'SYS-K3 / RESULTS', '主要数値（前年同期比）', pm, `<div class="pb"><div class="kres"><div class="krs" style="grid-template-columns:repeat(${c.results.length},minmax(0,1fr))">${cells}</div>${drv}</div></div>`);
  }
  function progressPanel(c) {
    const a = c.a, p = secs(a).progress && typeof secs(a).progress === 'object' ? secs(a).progress : null;
    const fp = c.F && c.F.progress && typeof c.F.progress === 'object' ? c.F.progress : null;
    const others = fp ? arr(fp.items).filter((x) => x && isNum(x.pct)) : [];
    const pace = p && isNum(p.pace) ? p.pace : fp && isNum(fp.pace) ? fp.pace : null;
    const oth = others.length ? `<div class="kpo"><span class="kpoh">株探の進捗率（${esc(fp.cumulativePeriod || '')}累計 ÷ 通期予想）</span>${others.map((x) => `<div class="kpr"><span>${esc(x.label || x.key)}</span>${K.paceBar(x.pct, fp.pace)}<b class="mono">${fmt(x.pct, 1)}%</b></div>`).join('')}</div>` : '';
    let main;
    if (p && isNum(p.pct)) {
      const d = p.pct - (isNum(pace) ? pace : 0);
      main = `<div class="kring">${K.ring(p.pct, pace)}<div class="krg"><b class="kpl">${esc(p.label || '')}</b>`
        + `<span class="kpc"><i class="sw pcs"></i>均等ペース <span class="mono">${isNum(pace) ? fmt(pace, decOf(pace, 1)) + '%' : '—'}</span></span>`
        + (isNum(pace) ? `<span class="kpc ${d >= 0 ? 'up' : 'dn'}">ペースとの差 <span class="mono">${fmtS(d, 1)}pt</span></span>` : '')
        + (p.pct > 100 ? '<span class="kpc am"><i class="sw pco"></i>内側の輪＝100%を超えた分</span>' : '')
        + `${p.note ? `<p>${richNums(p.note)}</p>` : ''}</div></div>`;
    } else {
      main = `<div class="kring nd1">${noData('progress', a, { sm: true })}${isNum(pace) ? `<span class="kpc"><i class="sw pcs"></i>均等ペース <span class="mono">${fmt(pace, decOf(pace, 1))}%</span></span>` : ''}</div>`;
    }
    return panel('progress', 'SYS-K4 / PROGRESS', '通期予想に対する進捗率', '', `<div class="pb">${main}${oth}</div>`);
  }
  function marginPanelK(c) {
    const a = c.a, m = secs(a).margin && typeof secs(a).margin === 'object' ? secs(a).margin : {};
    const cur = isNum(m.pct) ? m.pct : null, prv = isNum(m.prevPct) ? m.prevPct : null;
    let bars;
    if (cur == null && prv == null) bars = noData('margin', a, { sm: true });
    else {
      const max = K.niceCeil(Math.max(cur || 0, prv || 0, 1) * 1.25);
      const row = (lab, v, cls) => `<div class="kmr ${cls}"><span>${lab}</span><span class="kmt">${v != null ? `<u class="a-gx" style="width:${K.clamp(Math.max(0, v) / max * 100, 0, 100).toFixed(1)}%"></u>` : ''}</span><b class="mono">${v != null ? fmt(v, 1) + '%' : '—'}</b></div>`;
      const dlt = cur != null && prv != null ? `<span class="yy ${cur - prv > 0 ? 'up' : cur - prv < 0 ? 'dn' : 'flat'}">前年から <span class="mono">${fmtS(cur - prv, 1)}pt</span></span>` : '';
      bars = `<div class="kmg">${row('今期', cur, 'c')}${row('前年', prv, 'p')}<div class="kms"><span>0%</span><span>${fmt(max / 2, decOf(max / 2, 1))}%</span><span>${fmt(max, decOf(max, 1))}%</span></div>${dlt}</div>`;
    }
    const peer = m.peer ? `<p class="kpe"><span>同業比較</span>${richNums(m.peer)}</p>` : `<div class="kpe" data-nodata="margin:peer"><span>同業比較</span><span class="nd">未取得</span>${missFor(a, 'margin') ? `<em>${esc(missFor(a, 'margin'))}</em>` : ''}</div>`;
    const line = c.qm.length ? `<div class="kml"><span class="kmlh">営業利益率の推移（3か月ごと・株探の営業利益で計算）</span><div class="host kmlc" data-chart="mline"></div></div>` : '';
    return panel('margin', 'SYS-K5 / MARGIN', '利益率', '<span class="jp">今期と前年の比較</span>', `<div class="pb">${m.label ? `<p class="kmlab">${esc(m.label)}</p>` : ''}${bars}${peer}${line}</div>`);
  }
  function outlookPanel(c) {
    const a = c.a, o = secs(a).outlook && typeof secs(a).outlook === 'object' ? secs(a).outlook : null;
    if (!o) return panel('outlook', 'SYS-K6 / OUTLOOK', '会社の見通し', '', `<div class="pb">${noData('outlook', a, { sm: true })}</div>`);
    const sv = STANCE[o.stance], rv = REVISION[o.revision];
    const fc = arr(o.forecast).filter((x) => x && typeof x === 'object');
    const sc = Math.max(10, ...fc.map((x) => (isNum(x.yoyPct) ? Math.abs(x.yoyPct) : 0)));
    const rows = fc.map((x, i) => `<tr><td>${esc(x.label || '')}</td><td class="r">${isNum(x.value) ? numU(x.value, x.unit) : `<span class="nd" data-nodata="outlook:${i}">未取得</span>`}</td><td class="yc">${K.yoyBar(x.yoyPct, sc)}</td><td class="r mono ${isNum(x.yoyPct) ? (x.yoyPct >= 0 ? 'up' : 'dn') : 'na'}">${isNum(x.yoyPct) ? fmtS(x.yoyPct, 1) + '%' : '—'}</td></tr>`).join('');
    const left = `<div class="kol">${sv ? kmeter(sv[0], '慎重', '強気') : ''}<div class="kos"><span>会社のスタンス</span><b>${sv ? sv[1] : '—'}</b></div>${rv ? `<span class="krv2 ${rv[2]}"><i>${rv[0]}</i>${rv[1]}</span>` : ''}</div>`;
    const tbl = `<table class="kft"><thead><tr><th>通期予想</th><th class="r">金額</th><th class="yc">前期比</th><th class="r">率</th></tr></thead><tbody>${rows}</tbody></table>`;
    return panel('outlook', 'SYS-K6 / OUTLOOK', '会社の見通し', '<span class="jp">会社が出した通期予想</span>', `<div class="pb"><div class="kog">${left}<div class="kor">${tbl}${o.text ? `<p class="kot">${richNums(o.text)}</p>` : ''}</div></div></div>`);
  }
  function pmPanel(c) {
    const a = c.a, pmx = secs(a).plusMinus && typeof secs(a).plusMinus === 'object' ? secs(a).plusMinus : null;
    if (!pmx) return panel('plusminus', 'SYS-K7 / PLUS-MINUS', '良い点・悪い点', '', `<div class="pb">${noData('plusminus', a, { sm: true })}</div>`);
    const col = (x, k, g, lab) => `<div class="kpmc ${k}"><span class="kg" aria-hidden="true">${g}</span><div><span class="kpml">${lab}</span><b>${esc(x && x.title || '')}</b><p>${richNums(x && x.text || '')}</p></div></div>`;
    return panel('plusminus', 'SYS-K7 / PLUS-MINUS', '良い点・悪い点', '<span class="jp">左右で比べる</span>', `<div class="pb"><div class="kpm">${col(pmx.plus, 'p', '＋', '良い点')}<div class="kpmv" aria-hidden="true"><i></i><b>VS</b><i></i></div>${col(pmx.minus, 'm', '−', '悪い点')}</div></div>`);
  }
  function investPanel(c) {
    const a = c.a, list = arr(secs(a).investments).filter((x) => x && typeof x === 'object');
    if (!list.length) return panel('invest', 'SYS-K8 / INVEST', 'お金の使い道', '', `<div class="pb">${noData('invest', a, { sm: true })}</div>`);
    const nums = list.filter((x) => isNum(x.amount));
    const max = Math.max(1, ...nums.map((x) => Math.abs(x.amount)));
    let body;
    if (nums.length) {
      body = `<div class="kiv">${list.map((x) => `<div class="kir"><div class="kih"><b>${esc(x.title || '')}</b>${isNum(x.amount) ? `<span class="mono">${fmt(x.amount, decOf(x.amount, 1))}<small>億円</small></span>` : '<span class="kina">金額の記載なし</span>'}</div><span class="kib${isNum(x.amount) ? '' : ' nil'}">${isNum(x.amount) ? `<u class="a-gx" style="width:${K.clamp(Math.abs(x.amount) / max * 100, 0.6, 100).toFixed(1)}%"></u>` : ''}</span>${x.text ? `<p>${richNums(x.text)}</p>` : ''}</div>`).join('')}</div>`;
    } else {
      body = `<div class="kic">${list.map((x, i) => `<div class="kicc"><span class="kn">${String(i + 1).padStart(2, '0')}</span><b>${esc(x.title || '')}</b><span class="kina">金額の記載なし</span>${x.text ? `<p>${richNums(x.text)}</p>` : ''}</div>`).join('')}</div>`;
    }
    return panel('invest', 'SYS-K8 / INVEST', 'お金の使い道', nums.length ? '<span class="jp">横棒＝金額（億円・最大＝100%）</span>' : '', `<div class="pb">${body}</div>`);
  }
  function financePanel(c) {
    const a = c.a, F = secs(a).finance && typeof secs(a).finance === 'object' ? secs(a).finance : null;
    const pm = '<span class="jp"><i class="sw fpv"></i>前</span><span class="jp"><i class="sw fcu"></i>今</span>';
    if (!F) return panel('finance', 'SYS-K9 / BALANCE', '財務', pm, `<div class="pb">${noData('finance', a, { sm: true })}</div>`);
    const rows = arr(F.items).filter((x) => x && typeof x === 'object').map((x, i) => {
      const u = unitTxt(x.unit), ch = K.changeOf(x.prev, x.curr, u);
      const v = (n) => (isNum(n) ? `<span class="mono">${fmt(n, decOf(n, 2))}</span><small>${esc(u)}</small>` : '<span class="na">—</span>');
      const nd = !isNum(x.prev) || !isNum(x.curr);
      return `<div class="kfr"${nd ? ` data-nodata="finance:${i}"` : ''}><span class="kfl">${esc(x.label || '')}</span><span class="kfv p">${v(x.prev)}</span><i class="kfa" aria-hidden="true">→</i><span class="kfv c">${v(x.curr)}</span>${K.cmpPair(x.prev, x.curr)}${ch ? `<span class="yy ${ch.dir}">${ch.dir === 'up' ? '▲' : ch.dir === 'dn' ? '▼' : '＝'} <span class="mono">${esc(ch.text)}</span></span>` : '<span class="nd">未取得</span>'}</div>`;
    }).join('');
    return panel('finance', 'SYS-K9 / BALANCE', '財務', pm, `<div class="pb"><div class="kfh"><span>項目</span><span>前</span><span></span><span>今</span><span>前→今</span><span>増減</span></div><div class="kfs">${rows}</div><div class="kfv2">${F.verdict ? `<span class="kfj">${esc(F.verdict)}</span>` : ''}${F.text ? `<p>${richNums(F.text)}</p>` : ''}</div></div>`);
  }
  function returnsPanel(c) {
    const a = c.a, R2 = secs(a).returns && typeof secs(a).returns === 'object' ? secs(a).returns : null;
    const pm = '<span class="jp"><i class="sw r3c"></i>1株配当</span><span class="jp"><i class="sw l25"></i>EPS（1株利益）</span><span class="jp"><i class="sw r3f"></i>予想</span>';
    if (!R2) return panel('returns', 'SYS-K10 / RETURN', '配当とEPS', pm, `<div class="pb">${noData('returns', a, { sm: true })}</div>`);
    const periods = K.returnsPeriods(c.divs, c.eps);
    const cell = (list, p) => { const x = list.find((y) => y && y.period === p); if (!x) return '<td class="na">—</td>'; const v = x.value; const s = isNum(v) ? `<span class="mono">${fmt(v, decOf(v, 2))}</span>` : typeof v === 'string' && v ? esc(v) : '—'; return `<td class="${x.forecast ? 'fc' : ''}${v == null ? ' na' : ''}">${s}</td>`; };
    const tbl = periods.length ? `<table class="krt"><thead><tr><th>決算期</th>${periods.map((p) => { const fc = [...c.divs, ...c.eps].some((x) => x && x.period === p && x.forecast); return `<th class="${fc ? 'fc' : ''}">${esc(p)}${fc ? '<small>予想</small>' : ''}</th>`; }).join('')}</tr></thead><tbody><tr><td>1株配当（円）</td>${periods.map((p) => cell(c.divs, p)).join('')}</tr><tr><td>EPS（円）</td>${periods.map((p) => cell(c.eps, p)).join('')}</tr></tbody></table>` : '';
    const bb = `<div class="kbb"><span class="kbi" aria-hidden="true">⟲</span><span>自社株買い</span><p>${R2.buyback ? richNums(R2.buyback) : '<span class="na">記載なし</span>'}</p></div>`;
    return panel('returns', 'SYS-K10 / RETURN', '配当とEPS', pm, `<div class="pb"><div class="host krch${[...c.divs, ...c.eps].some((x) => x && isNum(x.value)) ? '' : ' sm'}" data-chart="returns"></div>${tbl}${bb}</div>`);
  }
  function nextPanel(c) {
    const a = c.a, list = arr(secs(a).next).filter((x) => typeof x === 'string' && x);
    if (!list.length) return panel('next', 'SYS-K12 / NEXT', '次の決算で見る点', '', `<div class="pb">${noData('next', a, { sm: true })}</div>`);
    return panel('next', 'SYS-K12 / NEXT', '次の決算で見る点', `<span class="jp">${list.length}項目</span>`, `<div class="pb"><ol class="knx">${list.map((x, i) => `<li><i class="cb" aria-hidden="true"></i><span class="n">${String(i + 1).padStart(2, '0')}</span><p>${richNums(x)}</p></li>`).join('')}</ol><p class="cap knc">次の決算が出たら、この項目を確かめると今回の読みの答え合わせになります</p></div>`);
  }
  function deepPanel(c) {
    const a = c.a, d = secs(a).deep && typeof secs(a).deep === 'object' ? secs(a).deep : null;
    const name = (c.st && c.st.name) || a.name || a.code;
    if (!d) return `<div class="kguide" data-sec="deep-guide"><span class="code">SYS-K11 / DEEP</span><span>有報・中期経営計画まで読む「3点読み」はこの分析に含まれていません。</span><span class="cmdl"><em>&gt;</em>/kabu ${esc(name)} 決算 3点</span><span>で追加できます</span></div>`;
    const y = d.yuho && typeof d.yuho === 'object' ? d.yuho : {}, p = d.plan && typeof d.plan === 'object' ? d.plan : {};
    const yc = [['ky-e', '▲', '稼ぎ頭', y.earner], ['ky-d', '▼', '足を引っ張る事業', y.dragger], ['ky-o', '◆', '一時的な要因', y.oneOff]].map(([k, g, lab, t]) => `<div class="kyc ${k}"><span class="kyg">${g}</span><div><span class="kyl">${lab}</span><p>${t ? richNums(t) : '<span class="na">記載なし</span>'}</p></div></div>`).join('');
    const risks = arr(y.risks).filter((x) => typeof x === 'string' && x);
    const rk = risks.length ? `<div class="kyr"><span class="kyrh">会社が挙げるリスク</span><ol>${risks.map((x, i) => `<li><span class="n">R${i + 1}</span><p>${richNums(x)}</p></li>`).join('')}</ol></div>` : '';
    const tv = (v) => (isNum(v) ? `<span class="mono">${fmt(v, decOf(v, 2))}</span>` : typeof v === 'string' && v ? esc(v) : '<span class="na">—</span>');
    const badge = (lab, st) => (st ? `<span class="rbg ${st.k}" data-status="${st.k}">${lab}：${esc(st.text)}</span>` : '');
    const tg = arr(p.targets).filter((x) => x && typeof x === 'object').map((x) => {
      const m = K.bulletModel(x);
      return `<div class="kbr"><span class="kbl">${esc(x.label || '')}${x.unit ? `<small>単位 ${esc(x.unit)}</small>` : ''}</span>${K.bullet(x)}`
        + `<span class="kbv"><span><i class="sw btgs"></i>目標 ${tv(x.target)}</span><span><i class="sw rbas"></i>実績 ${tv(x.actual)}</span><span><i class="sw rbfs"></i>今期予想 ${tv(x.forecast)}</span>`
        + (m ? `<span class="rbgs">${badge('実績', m.sActual)}${badge('今期予想', m.sForecast)}</span>` : '') + '</span></div>';
    }).join('');
    const vd = (lab, t, g) => `<div class="kvc"><span class="kvg">${g}</span><div><span class="kyl">${lab}</span><p>${t ? richNums(t) : '<span class="na">記載なし</span>'}</p></div></div>`;
    const left = `<div class="kdy"><div class="kdh"><span class="code">YUHO</span><b>有価証券報告書から</b></div>${yc}${rk}</div>`;
    const right = `<div class="kdpn"><div class="kdh"><span class="code">PLAN</span><b>${esc(p.name || '中期経営計画')}</b></div>${p.goal ? `<p class="kgl"><span>目指す姿</span>${richNums(p.goal)}</p>` : ''}${tg ? `<div class="kbs"><div class="kbsh"><span>目標 vs 実績 vs 今期予想</span><span class="cap"><i class="sw rbbs"></i>帯＝目標の範囲（縦線＝目標が1つの値） ・ <i class="sw rbas"></i>実＝実績 ・ <i class="sw rbfs"></i>予＝今期予想</span></div>${tg}</div>` : ''}${vd('お金の使い道と目標の一致', p.consistent, '⇄')}${vd('現実的か', p.realistic, '◎')}</div>`;
    return panel('deep', 'SYS-K11 / DEEP', '3点読み（有報・中期経営計画）', '<span class="jp">決算 3点</span>', `<div class="pb"><div class="kdg">${left}${right}</div></div>`);
  }
  function kessanView(c) {
    const a = c.a;
    const segShow = !secAbsent(a, 'segments') || !!missFor(a, 'segments');
    return `<div id="kview" class="kv">
    <div class="kv-r1">${verdictPanel(c)}${pointsPanel(c)}</div>
    ${resultsPanel(c)}
    <div class="kv-r3">${progressPanel(c)}${marginPanelK(c)}${outlookPanel(c)}</div>
    <div class="kv-r4">${pmPanel(c)}${investPanel(c)}</div>
    <div class="kv-r5">${financePanel(c)}${returnsPanel(c)}</div>
    ${segShow ? `<div class="pair kv-pair">${nextPanel(c)}${segPanel(a)}</div>` : `<div class="kv-r6">${nextPanel(c)}</div>`}
    ${deepPanel(c)}
    ${notesPanel(a)}
  </div>`;
  }

  /* =====================================================================
     ニュース型・反省型（P3b）の共通：出来事の日・購入日まで遡る日足の窓
     ===================================================================== */
  /** 日足の窓。通常は直近約6か月、need（日付の配列）がそれより前なら、その15営業日前から（データのある範囲まで） */
  function stockWin(st, a, need) {
    const raw = arr(st && st.prices && st.prices.rows);
    const asOf = (a.price && a.price.asOf) || a.date || '';
    const I = st && st.indicators && typeof st.indicators === 'object' ? st.indicators : null;
    const idx = [];
    raw.forEach((r, i) => { if (r && typeof r.d === 'string' && isNum(r.c) && (!asOf || r.d <= asOf)) idx.push(i); });
    let si = 0;
    if (idx.length) {
      const dt = new Date(raw[idx[idx.length - 1]].d + 'T00:00:00Z');
      dt.setUTCMonth(dt.getUTCMonth() - 6);
      const start = isNaN(dt) ? '' : dt.toISOString().slice(0, 10);
      si = Math.max(0, idx.findIndex((i) => raw[i].d > start));
      const early = arr(need).filter((d) => typeof d === 'string' && d >= raw[idx[0]].d).sort()[0];
      if (early) { const k = idx.findIndex((i) => raw[i].d >= early); if (k >= 0) si = Math.min(si, Math.max(0, k - 15)); }
    }
    const wi = idx.slice(si);
    const maArr = (k) => (I && I.ma && Array.isArray(I.ma[k]) && I.ma[k].length === raw.length ? I.ma[k] : null);
    const pick = (k) => { const m = maArr(k); return m ? wi.map((i) => m[i]) : null; };
    const rows = wi.map((i) => raw[i]);
    const inWin = (d) => rows.some((r) => r.d === d);
    return { rows, ma: { ma25: pick('ma25'), ma75: pick('ma75'), ma200: pick('ma200') }, I, inWin, first: rows.length ? rows[0].d : null, last: rows.length ? rows[rows.length - 1].d : null, upto: idx.map((i) => raw[i]) };
  }
  const DIR3 = { plus: ['＋', 'プラス', 'p'], minus: ['−', 'マイナス', 'm'], mixed: ['±', '両面', 'n'], neutral: ['＝', '中立', 'n'] };
  const dirBadge = (k) => { const d = DIR3[k] || DIR3.neutral; return `<span class="nwd ${d[2]}" data-dir="${esc(k || '')}"><i>${d[0]}</i>${d[1]}</span>`; };
  /** 図に印を付けられなかった日付の注記 */
  const outNote = (list) => (list.length ? `<p class="cap ocap" data-outside>表示範囲（日足のある期間）の外のため図に印なし：${list.map((x) => esc(x)).join(' ／ ')}</p>` : '');
  function chartPanelS(sec, code, title, c, legendExtra, cap) {
    const a = c.a, w = c.w;
    if (!w.rows.length) return panel(sec, code, title, '', `<div class="pb">${noData(sec === 'hchart' ? 'chart' : 'reaction', a, { def: '株価データ（prices.json）がありません' })}</div>`);
    const lt = w.I && w.I.latest && Array.isArray(w.I.latest.ma) ? w.I.latest.ma : [];
    const hasMa = !!(w.ma.ma25 || w.ma.ma75);
    const legend = '<span><i class="sw cu"></i>陽線</span><span><i class="sw cd"></i>陰線</span>'
      + (hasMa ? '<span><i class="sw l25"></i>25日線</span><span><i class="sw l75"></i>75日線</span>' + (sec === 'hchart' ? '<span><i class="sw l200"></i>200日線</span>' : '') : '<span class="ndn" data-nodata="indicators">移動平均線は未取得</span>') + (legendExtra || '');
    void lt;
    return panel(sec, code, title, `<span>${esc(w.first.replace(/-/g, '.'))} – ${esc(w.last.replace(/-/g, '.'))}</span><span>${w.rows.length}本</span>`,
      `<div class="pb"><div class="legend">${legend}</div><div class="host shost" data-chart="${sec}"></div>${cap || ''}</div>`);
  }

  /* ---------- ニュース型 ---------- */
  function newsCtx(st, a) {
    const S2 = secs(a), rc = S2.reaction && typeof S2.reaction === 'object' ? S2.reaction : null;
    const pins = arr(S2.chart && S2.chart.pins).filter((p) => p && typeof p.date === 'string');
    const ev = S2.event && typeof S2.event === 'object' ? S2.event : null;
    const need = [...pins.map((p) => p.date), ev && ev.date, rc && rc.from && rc.from.date].filter(Boolean);
    const w = stockWin(st, a, need);
    return { kind: 'news', st, a, w, pins, ev, rc, dec: stockDec(st, [a.price && a.price.close]) };
  }
  function eventPanel(c) {
    const a = c.a, e = c.ev;
    if (!e) return panel('event', 'SYS-N1 / EVENT', '出来事の概要', '', `<div class="pb">${noData('event', a, { sm: true })}</div>`);
    let since = '';
    if (typeof e.date === 'string' && c.w.upto.length) {
      const n = c.w.upto.filter((r) => r.d > e.date).length;
      since = `<div class="evn"><span>出来事の日から</span><b class="mono">${n}</b><small>営業日</small></div>`;
    }
    return panel('event', 'SYS-N1 / EVENT', '出来事の概要', '', `<div class="pb"><div class="evh"><span class="evk">${esc(e.kind || '種別不明')}</span><span class="evd"><b class="mono">${esc(String(e.date || '—').replace(/-/g, '.'))}</b></span>${since}</div><h3 class="evt">${esc(e.title || '')}</h3>${e.what ? `<p class="evw">${richNums(e.what)}</p>` : ''}</div>`);
  }
  function impactPanel(c) {
    const a = c.a, m = secs(a).impact && typeof secs(a).impact === 'object' ? secs(a).impact : null;
    if (!m) return panel('impact', 'SYS-N2 / IMPACT', '影響度と期間', '', `<div class="pb">${noData('impact', a, { sm: true })}</div>`);
    const lv = isNum(m.level) ? K.clamp(Math.round(m.level), 0, 5) : 0;
    return panel('impact', 'SYS-N2 / IMPACT', '影響度と期間', '<span class="jp">影響度 5段階 ・ 期間 3段階</span>', `<div class="pb"><div class="imh"><div class="imv"><span class="code">LEVEL</span><b class="mono">${lv}<small>／5</small></b></div><div class="iml">${K.stars(lv)}${K.segs(lv)}</div><div class="imd"><span>株価への向き</span>${dirBadge(m.dir)}</div></div><div class="imdu"><span class="imdl">影響が続く期間の見方</span>${K.durationBar(m.duration)}</div>${m.text ? `<p class="mkt">${richNums(m.text)}</p>` : ''}</div>`);
  }
  function reactionPanel(c) {
    const a = c.a, r = c.rc;
    if (!r) return panel('reaction', 'SYS-N4 / REACTION', '株価の反応', '', `<div class="pb">${noData('reaction', a, { sm: true })}</div>`);
    const f = r.from || {}, t = r.to || {}, pct = isNum(r.changePct) ? r.changePct : null;
    const cls = pct == null ? '' : pct > 0 ? 'up' : pct < 0 ? 'dn' : '';
    const pt = (lab, x) => `<div class="rcp"><span>${lab}</span><b class="mono">${K.fmtP(x.price)}<small>円</small></b><em class="mono">${esc(String(x.date || '—').replace(/-/g, '.'))}</em></div>`;
    return panel('reaction', 'SYS-N4 / REACTION', '株価の反応', '<span class="jp">出来事の前日終値 → 直近</span>', `<div class="pb"><div class="rcg">${pt('前日終値', f)}<div class="rca" aria-hidden="true"><i></i>▶</div>${pt('直近', t)}<div class="rcv ${cls}"><span>騰落率</span><b class="mono">${pct == null ? '—' : fmtS(pct, 2) + '%'}</b></div></div><div class="rcb">${K.yoyBar(pct, Math.max(10, K.niceCeil(Math.abs(pct || 0))))}<div class="rcs"><span>−${fmt(Math.max(10, K.niceCeil(Math.abs(pct || 0))))}%</span><span>0</span><span>+${fmt(Math.max(10, K.niceCeil(Math.abs(pct || 0))))}%</span></div></div>${r.text ? `<p class="mkt">${richNums(r.text)}</p>` : ''}</div>`);
  }
  function factorsPanel(c) {
    const a = c.a, m = secs(a).impact && typeof secs(a).impact === 'object' ? secs(a).impact : null;
    const fs = m ? arr(m.factors).filter((x) => x && (x.label || x.text)) : [];
    if (!fs.length) return panel('factors', 'SYS-N3 / FACTORS', '長引くかを分ける要因', '', `<div class="pb">${noData('impact', a, { sm: true, def: '要因の記載がありません' })}</div>`);
    const col = (k, lab, g, sub) => { const xs = fs.filter((x) => x.dir === k); return `<div class="fxc ${k === 'better' ? 'plus' : 'minus'}" data-factor="${k}"><div class="fxh"><span class="kg">${g}</span><b>${lab}</b><em>${xs.length}</em></div><small class="fxsub">${sub}</small>${xs.map((x) => `<div class="fxe"><b>${esc(x.label || '')}</b><p>${richNums(x.text || '')}</p></div>`).join('') || '<p class="cwn">該当なし</p>'}</div>`; };
    return panel('factors', 'SYS-N3 / FACTORS', '長引くかを分ける要因', '<span class="jp">左右で比べる</span>', `<div class="pb"><div class="fxg">${col('better', '短く済む方向', '↘', '一時的に近づく')}<div class="kpmv" aria-hidden="true"><i></i><b>VS</b><i></i></div>${col('worse', '長引く方向', '↗', '影響が残りやすい')}</div></div>`);
  }
  function casesPanel(c) {
    const a = c.a, list = arr(secs(a).cases).filter((x) => x && typeof x === 'object');
    if (!list.length) return panel('cases', 'SYS-N5 / CASES', '過去事例との比較', '', `<div class="pb">${noData('cases', a, { sm: true })}</div>`);
    const sc = K.caseScale(list);
    const unk = (k) => `<span class="unk" data-unknown="${k}">不明</span>`;
    const rows = list.map((x, i) => {
      const drop = isNum(x.dropPct) ? `<span class="cv2 ${x.dropPct < 0 ? 'dn' : x.dropPct > 0 ? 'up' : ''}"><b class="mono">${fmtS(x.dropPct, 1)}%</b>${isNum(x.days) ? `<small>${fmt(x.days)}日で</small>` : '<small>日数 不明</small>'}</span>${K.yoyBar(x.dropPct, sc.drop)}` : `${unk('drop')}<span class="yb nil"></span>`;
      const rec = isNum(x.recoveryMonths) ? `<span class="cv2"><b class="mono">${fmt(x.recoveryMonths, K.decOf(x.recoveryMonths, 1))}</b><small>か月</small></span>${K.monthBar(x.recoveryMonths, sc.rec)}` : `${unk('rec')}<span class="mb nil"></span>`;
      return `<div class="csr" data-case="${i}"><div class="csn"><b>${esc(x.name || '')}</b><span class="mono">${isNum(x.year) ? x.year + '年' : ''}</span>${x.outcome ? `<p>${richNums(x.outcome)}</p>` : ''}${srcLink(x.url) ? `<span class="nwu">出典 ${srcLink(x.url)}</span>` : ''}</div><div class="csb" data-bar="drop">${drop}</div><div class="csb" data-bar="rec">${rec}</div><div class="cspair"><div class="css"><span>似ている点</span><p>${richNums(x.similar || '—')}</p></div><div class="csd"><span>違う点</span><p>${richNums(x.different || '—')}</p></div></div></div>`;
    }).join('');
    const head = `<div class="csh"><span>事例</span><span>初動の騰落率<small>（−${fmt(sc.drop)}〜+${fmt(sc.drop)}%）</small></span><span>元の水準に戻るまで<small>（0〜${fmt(sc.rec)}か月）</small></span><span>今回と比べて</span></div>`;
    return panel('cases', 'SYS-N5 / CASES', '過去事例との比較', '<span class="jp">数字は出典で確かめられたものだけ ・ 無いものは「不明」</span>', `<div class="pb">${head}${rows}</div>`);
  }
  function relatedPanel(c) {
    const a = c.a, list = arr(secs(a).related).filter((x) => x && x.name);
    const D = window.KABU;
    const body = list.length ? `<div class="rlg">${list.map((x, i) => {
      const has = x.code && D.stocks[x.code];
      const code = x.code ? (has ? `<a class="rlc" href="${hrefStock(x.code)}">${esc(x.code)}</a>` : `<span class="rlc">${esc(x.code)}</span>`) : '<span class="rlc na">—</span>';
      return `<div class="rli" data-rel="${i}">${code}<div class="rln"><b>${esc(x.name)}</b>${x.relation ? `<small>${esc(x.relation)}</small>` : ''}</div>${dirBadge(x.dir)}</div>`;
    }).join('')}</div>` : '<p class="cwn" data-empty="related">波及が見込まれる会社・業種の記載はありません</p>';
    return panel('related', 'SYS-N6 / RELATED', '波及先', `<span class="jp">${list.length}件</span>`, `<div class="pb">${body}</div>`);
  }
  function takeawayPanel(c) {
    const a = c.a, t = secs(a).takeaway && typeof secs(a).takeaway === 'object' ? secs(a).takeaway : null;
    if (!t) return panel('takeaway', 'SYS-N7 / TAKEAWAY', '受け止め方と次に確認する点', '', `<div class="pb">${noData('takeaway', a, { sm: true })}</div>`);
    const cks = arr(t.checks).filter((x) => typeof x === 'string' && x);
    return panel('takeaway', 'SYS-N7 / TAKEAWAY', '受け止め方と次に確認する点', `<span class="jp">確認 ${cks.length}項目</span>`, `<div class="pb"><div class="tkg">${t.text ? `<div class="lsx"><span class="code">VIEW</span><p>${richNums(t.text)}</p></div>` : ''}${cks.length ? `<ol class="knx">${cks.map((x, i) => `<li><i class="cb" aria-hidden="true"></i><span class="n">${String(i + 1).padStart(2, '0')}</span><p>${richNums(x)}</p></li>`).join('')}</ol>` : ''}</div></div>`);
  }
  function newsView(c) {
    const out = [...c.pins.map((p) => p.date), c.rc && c.rc.from && c.rc.from.date].filter((d) => d && !c.w.inWin(d));
    const cap = outNote([...new Set(out)]);
    return `<div id="nview" class="tv">
    <div class="sv-r1">${eventPanel(c)}${impactPanel(c)}</div>
    <div class="sv-r2">${chartPanelS('nchart', 'SYS-N0 / CHART', '株価チャート（出来事の日に印）', c, '<span><i class="sw pinw"></i>出来事の日などの印</span>', cap)}<div class="mv-rc">${reactionPanel(c)}${factorsPanel(c)}</div></div>
    ${casesPanel(c)}
    <div class="sv-r4">${relatedPanel(c)}${takeawayPanel(c)}</div>
    ${notesPanel(c.a)}
  </div>`;
  }

  /* ---------- 反省型 ---------- */
  function hanseiCtx(st, a) {
    const S2 = secs(a);
    const entry = S2.entry && typeof S2.entry === 'object' && isNum(S2.entry.price) ? S2.entry : null;
    const res = S2.result && typeof S2.result === 'object' ? S2.result : null;
    const ch = S2.chart && typeof S2.chart === 'object' ? S2.chart : {};
    const pins0 = arr(ch.pins).filter((p) => p && typeof p.date === 'string' && p.label);
    const hpins = [];
    if (entry && typeof entry.date === 'string') hpins.push({ date: entry.date, label: `購入 ${K.fmtP(entry.price)}円`, at: entry.price, low: false, color: K.C.amb, cls: 'pin-entry' });
    if (res && typeof res.maxUpDate === 'string' && isNum(res.maxUpPct)) hpins.push({ date: res.maxUpDate, label: `最大含み益 ${fmtS(res.maxUpPct, 2)}%`, low: false, cls: 'pin-up' });
    if (res && typeof res.maxDownDate === 'string' && isNum(res.maxDownPct)) hpins.push({ date: res.maxDownDate, label: `最大含み損 ${fmtS(res.maxDownPct, 2)}%`, low: true, color: K.C.mag, cls: 'pin-dn' });
    pins0.forEach((p) => { if (!hpins.some((q) => q.date === p.date)) hpins.push(p); });
    const w = stockWin(st, a, hpins.map((p) => p.date));
    const levels = arr(ch.levels).map((L, i) => (L && typeof L === 'object' && isNum(L.low) && isNum(L.high) ? { ...L, i, strength: isNum(L.strength) ? L.strength : 3 } : null)).filter(Boolean);
    return { kind: 'hansei', st, a, w, entry, res, hpins, levels, dec: stockDec(st, [a.price && a.price.close, entry && entry.price]) };
  }
  function heatCells(list, a, sec) {
    return ['ma25dev', 'rsi', 'change3d', 'volume'].map((k) => {
      const h = K.HEAT[k], it = arr(list).find((x) => x && x.key === k);
      const v = it && isNum(it.value) ? it.value : null;
      const note = it && typeof it.note === 'string' ? it.note : '';
      if (v == null) return `<div class="hc" data-nodata="${sec}:${k}"><div class="hch"><span class="hn">${esc(h.name)}</span><span class="nd">未取得</span></div><div class="hv"><b class="na">—</b></div>${K.heatGauge(k, null)}<p class="hr">${esc(h.rule)}</p><p class="hnote">${esc(note || missFor(a, sec) || '値の記載がありません')}</p></div>`;
      const stt = HEAT_STATE[it.state] ? it.state : 'calm';
      return `<div class="hc ${stt}"><div class="hch"><span class="hn">${esc(h.name)}</span><span class="hs ${stt}">${HEAT_STATE[stt]}</span></div><div class="hv"><b>${esc(K.heatValue(k, v))}</b><small>${esc(h.unit)}</small></div>${K.heatGauge(k, v, stt)}<p class="hr">${esc(h.rule)}</p>${note ? `<p class="hnote">${richNums(note)}</p>` : ''}</div>`;
    }).join('');
  }
  function hchartPanel(c) {
    const e = c.entry, r = c.res;
    const out = c.hpins.map((p) => p.date).filter((d) => !c.w.inWin(d));
    const adj = e && e.adjusted === true ? `<p class="cap ocap adj" data-adjusted>※ 購入日は休場日のため、翌営業日（${esc(String(e.date || '').replace(/-/g, '.'))}）に寄せています</p>` : '';
    const legend = '<span><i class="sw ent"></i>購入価格</span><span><i class="sw lvr-r"></i>レジスタンス</span><span><i class="sw lvr-s"></i>サポート</span>';
    void r;
    return chartPanelS('hchart', 'SYS-H0 / CHART', '株価チャート（購入日と購入価格）', c, legend, adj + outNote([...new Set(out)]));
  }
  function resultPanel(c) {
    const a = c.a, e = c.entry, r = c.res;
    const pm = '<span class="jp">色＝損益の正負（評価ではありません）</span>';
    const eb = e ? `<div class="hen"><div><span>購入日</span><b class="mono">${esc(String(e.date || '—').replace(/-/g, '.'))}</b>${e.adjusted === true ? '<em class="adjb">休場日のため翌営業日に寄せた</em>' : ''}</div><div><span>購入価格</span><b class="mono">${K.fmtP(e.price)}<small>円</small></b></div>${e.note ? `<p>${richNums(e.note)}</p>` : ''}</div>` : noData('entry', a, { sm: true });
    if (!r) return panel('result', 'SYS-H1 / RESULT', '結果の数値', pm, `<div class="pb">${eb}${noData('result', a, { sm: true })}</div>`);
    const sg = (v) => (isNum(v) ? (v > 0 ? 'up' : v < 0 ? 'dn' : '') : 'na');
    const pc = (v) => (isNum(v) ? fmtS(v, 2) + '%' : '—');
    const cell = (k, lab, v, d) => `<div class="hrc ${sg(v)}" data-num="${k}"><span>${lab}</span><b class="mono">${pc(v)}</b>${d ? `<small class="mono">${esc(String(d).replace(/-/g, '.'))}</small>` : isNum(v) ? '' : `<small>${esc(missFor(a, 'result') || '記載なし')}</small>`}</div>`;
    const sc = K.niceCeil(Math.max(5, ...[r.maxUpPct, r.maxDownPct, r.pnlPct].filter(isNum).map(Math.abs)));
    const P = (v) => K.clamp(50 + v / sc * 50, 0, 100);
    const band = isNum(r.maxUpPct) || isNum(r.maxDownPct) ? `<u class="hrb" style="left:${P(isNum(r.maxDownPct) ? Math.min(0, r.maxDownPct) : 0).toFixed(1)}%;right:${(100 - P(isNum(r.maxUpPct) ? Math.max(0, r.maxUpPct) : 0)).toFixed(1)}%"></u>` : '';
    const mk = (v, cls, lab) => (isNum(v) ? `<i class="${cls}" style="left:${P(v).toFixed(1)}%" title="${esc(lab)}"></i>` : '');
    const range = `<div class="hrr"><div class="hrt">${band}<i class="h0" style="left:50%"></i>${mk(r.maxDownPct, 'hdn', '最大含み損')}${mk(r.maxUpPct, 'hup', '最大含み益')}${mk(r.pnlPct, 'hnow', '直近')}</div><div class="hrs"><span>−${fmt(sc)}%</span><span>買値 0</span><span>+${fmt(sc)}%</span></div><div class="hrl"><span><i class="sw hrbs"></i>購入後の値動きの幅</span><span><i class="sw hnows"></i>直近の損益率</span></div></div>`;
    return panel('result', 'SYS-H1 / RESULT', '結果の数値', pm, `<div class="pb">${eb}<div class="hrm ${sg(r.pnlPct)}" data-num="pnl"><span>直近の損益率<small class="mono">${esc(String(r.asOf || '').replace(/-/g, '.'))} 終値 ${K.fmtP(r.close)}円</small></span><b class="mono">${pc(r.pnlPct)}</b></div><div class="hrg">${cell('maxUp', '最大含み益', r.maxUpPct, r.maxUpDate)}${cell('maxDown', '最大含み損', r.maxDownPct, r.maxDownDate)}<div class="hrc" data-num="days"><span>経過営業日数</span><b class="mono">${isNum(r.days) ? fmt(r.days) : '—'}<small>日</small></b></div></div>${range}</div>`);
  }
  function atPanel(c) {
    const a = c.a;
    const pm = '<span class="jp"><i class="sw hzsw"></i>過熱の目安の帯</span><span class="jp"><i class="hdot calm"></i>落ち着き <i class="hdot warm"></i>やや過熱 <i class="hdot hot"></i>過熱</span>';
    if (secAbsent(a, 'at')) return panel('at', 'SYS-H2 / HEAT', '買った日の過熱の物差し', pm, `<div class="pb">${noData('at', a, { sm: true })}</div>`);
    return panel('at', 'SYS-H2 / HEAT', '買った日の過熱の物差し', pm, `<div class="pb"><div class="heat4">${heatCells(secs(a).at, a, 'at')}</div></div>`);
  }
  function positionPanel(c) {
    const a = c.a, p = secs(a).position && typeof secs(a).position === 'object' ? secs(a).position : null;
    if (!p) return panel('position', 'SYS-H3 / POSITION', '買った日の位置', '', `<div class="pb">${noData('position', a, { sm: true })}</div>`);
    const tr = TREND[p.trend];
    const e = c.entry;
    const marks = [];
    if (p.resistance && isNum(p.resistance.price)) marks.push({ k: 'r', lab: 'レジスタンス', price: p.resistance.price, note: p.resistance.label });
    if (e) marks.push({ k: 'e', lab: '購入価格', price: e.price, note: '' });
    if (p.support && isNum(p.support.price)) marks.push({ k: 's', lab: 'サポート', price: p.support.price, note: p.support.label });
    marks.sort((x, y) => y.price - x.price);
    let ladder;
    if (marks.length >= 2) {
      const hi = marks[0].price, lo = marks[marks.length - 1].price;
      const top = (v) => (hi > lo ? (hi - v) / (hi - lo) * 100 : 50);
      ladder = `<div class="pld2"><div class="pltr">${marks.map((m) => `<i class="${m.k}" style="top:${top(m.price).toFixed(1)}%"></i>`).join('')}</div><div class="plls">${marks.map((m) => `<div class="pll ${m.k}" data-pos="${m.k}"><span>${m.lab}</span><b class="mono">${K.fmtP(m.price)}<small>円</small></b>${e && m.k !== 'e' ? `<em class="mono">買値比 ${fmtS((m.price / e.price - 1) * 100, 1)}%</em>` : ''}${m.note ? `<small>${esc(m.note)}</small>` : ''}</div>`).join('')}</div></div>`;
    } else {
      ladder = `<div class="pld2 nil" data-nodata="position:levels"><span class="nd0">節目の記載なし</span>${e ? `<span>購入価格 <b class="mono">${K.fmtP(e.price)}</b>円</span>` : ''}</div>`;
    }
    return panel('position', 'SYS-H3 / POSITION', '買った日の位置', tr ? `<span class="trd ${tr[1]}">${trendIcon(p.trend)}流れ ${tr[0]}</span>` : '', `<div class="pb">${ladder}${p.text ? `<p class="mkt">${richNums(p.text)}</p>` : ''}</div>`);
  }
  function goodImprovePanel(c) {
    const a = c.a, S2 = secs(a);
    const g = arr(S2.good).filter((x) => x && (x.title || x.text)), im = arr(S2.improve).filter((x) => x && (x.title || x.text));
    const col = (list, k, lab, gl) => `<div class="fxc ${k}" data-col="${k}"><div class="fxh"><span class="kg">${gl}</span><b>${lab}</b><em>${list.length}</em></div>${list.map((x) => `<div class="fxe"><b>${esc(x.title || '')}</b><p>${richNums(x.text || '')}</p></div>`).join('') || '<p class="cwn">記載なし</p>'}</div>`;
    return panel('goodimprove', 'SYS-H4 / REVIEW', '良かった点と改善点', '<span class="jp">左右で比べる</span>', `<div class="pb"><div class="fxg">${col(g, 'plus', '良かった点', '＋')}<div class="kpmv" aria-hidden="true"><i></i><b>VS</b><i></i></div>${col(im, 'imp', '改善点', '△')}</div></div>`);
  }
  function altPanel(c) {
    const a = c.a, list = arr(secs(a).alt).filter((x) => x && typeof x === 'object');
    const pm = '<span class="hind" data-hindsight>後から見た話</span>';
    if (!list.length) return panel('alt', 'SYS-H5 / ALT', '別の入り方', pm, `<div class="pb"><p class="cwn" data-empty="alt">別の入り方の記載はありません</p><p class="cap hnc">※ 別の入り方は、結果を知ったうえで「後から見た話」です</p></div>`);
    const e = c.entry;
    const cards = list.map((x, i) => {
      const z = x.zone || {}, lo = isNum(z.low) ? z.low : null, hi = isNum(z.high) ? z.high : null;
      let zone = '<span class="na">価格帯の記載なし</span>', fig = '';
      if (lo != null || hi != null) {
        const a2 = lo != null ? lo : hi, b2 = hi != null ? hi : lo, l = Math.min(a2, b2), h = Math.max(a2, b2);
        zone = `<span class="nw"><span class="mono">${K.fmtP(l)}</span>${l !== h ? `<small>〜</small><span class="mono">${K.fmtP(h)}</span>` : ''}<small>円</small></span>${e ? `<em class="mono">買値比 ${fmtS((((l + h) / 2) / e.price - 1) * 100, 1)}%</em>` : ''}`;
        if (e) {
          const sc = K.niceCeil(Math.max(5, Math.abs(l / e.price - 1) * 100, Math.abs(h / e.price - 1) * 100) * 1.1);
          const P = (v) => K.clamp(50 + ((v / e.price - 1) * 100) / sc * 50, 0, 100);
          fig = `<div class="alf"><div class="alt2"><u style="left:${P(l).toFixed(1)}%;width:${Math.max(0.8, P(h) - P(l)).toFixed(1)}%"></u><i style="left:50%"></i></div><div class="hrs"><span>−${fmt(sc)}%</span><span>買値</span><span>+${fmt(sc)}%</span></div></div>`;
        }
      }
      return `<div class="alc" data-alt="${i}"><div class="alh"><span class="n mono">ALT-${i + 1}</span><b>${esc(x.title || '')}</b></div>${x.when ? `<div class="plw"><span>どうなったら</span><p>${richNums(x.when)}</p></div>` : ''}<div class="alz"><span>入る価格帯</span>${zone}</div>${fig}${x.text ? `<p class="alx">${richNums(x.text)}</p>` : ''}</div>`;
    }).join('');
    return panel('alt', 'SYS-H5 / ALT', '別の入り方', pm, `<div class="pb"><p class="cap hnc">※ 結果を知ったうえでの「後から見た話」です。当時に分かっていた材料だけで同じ判断ができたかを考えるための例です</p><div class="als">${cards}</div></div>`);
  }
  function nextChecksPanel(c) {
    const a = c.a, list = arr(secs(a).nextChecks).filter((x) => x && (x.label || x.how));
    if (!list.length) return panel('nextChecks', 'SYS-H6 / NEXT', '次に買う前の確認カード', '', `<div class="pb">${noData('nextChecks', a, { sm: true })}</div>`);
    return panel('nextChecks', 'SYS-H6 / NEXT', '次に買う前の確認カード', `<span class="jp">${list.length}枚</span>`, `<div class="pb"><div class="ncg">${list.map((x, i) => `<div class="ncc" data-check="${i}"><div class="nch"><i class="cb" aria-hidden="true"></i><span class="n mono">${String(i + 1).padStart(2, '0')}</span><b>${esc(x.label || '')}</b></div><p>${richNums(x.how || '')}</p></div>`).join('')}</div></div>`);
  }
  function lessonPanelH(c) {
    const a = c.a, S2 = secs(a), ls = S2.lesson && typeof S2.lesson === 'object' ? S2.lesson : null;
    const at = arr(S2.at).filter((h) => h && isNum(h.value)), hc = (s2) => at.filter((h) => h.state === s2).length;
    const p = S2.position && typeof S2.position === 'object' ? S2.position : null, tr = p && TREND[p.trend];
    const r = c.res;
    const steps = [
      ['01', '位置', '流れと節目', `<span class="sv">${tr ? `<span class="trd sm ${tr[1]}">${trendIcon(p.trend)}${tr[0]}</span>` : '<b class="na">—</b>'}</span>`],
      ['02', '過熱', '買った日の物差し', at.length ? `<span class="sv"><b>過熱 ${hc('hot')}</b><b>やや ${hc('warm')}</b><b>平常 ${hc('calm')}</b></span>` : '<span class="sv"><b class="na">値なし</b></span>'],
      ['03', '結果', '購入後の値動き', `<span class="sv"><b class="${r && isNum(r.pnlPct) ? (r.pnlPct > 0 ? 'up' : r.pnlPct < 0 ? 'dn' : '') : 'na'}">${r && isNum(r.pnlPct) ? fmtS(r.pnlPct, 2) + '%' : '—'}</b></span>`],
      ['04', '振り返り', '良かった点・改善点', `<span class="sv"><b>良 ${arr(S2.good).length}</b><b>改 ${arr(S2.improve).length}</b></span>`],
      ['05', '次回', '確認カード', `<span class="sv"><b>${arr(S2.nextChecks).length}枚</b></span>`],
    ];
    const flow = steps.map((x, i) => `<div class="lsn"><span class="n">${x[0]}</span><b>${x[1]}</b><small>${x[2]}</small>${x[3]}</div>${i < steps.length - 1 ? '<i class="lsa" aria-hidden="true">▶</i>' : ''}`).join('');
    const body = ls ? `<div class="lsx"><span class="code">LESSON</span><h3>${esc(ls.title || '')}</h3><p>${richNums(ls.text || '')}</p></div>` : noData('lesson', a, { sm: true });
    return panel('lesson', 'SYS-H7 / LESSON', '教訓', '<span class="jp">振り返りの手順と今回の結果</span>', `<div class="pb"><div class="lsgrid"><div class="lsf">${flow}</div>${body}</div></div>`);
  }
  function hanseiView(c) {
    return `<div id="hview" class="tv">
    <div class="sv-r2">${hchartPanel(c)}<div class="mv-rc">${resultPanel(c)}${positionPanel(c)}</div></div>
    ${atPanel(c)}
    <div class="sv-r3">${goodImprovePanel(c)}${altPanel(c)}</div>
    ${nextChecksPanel(c)}
    ${lessonPanelH(c)}
    ${notesPanel(c.a)}
  </div>`;
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
    const deep = a && a.type === 'kessan' && a.sections && a.sections.deep && typeof a.sections.deep === 'object';
    const cmd = `/kabu ${name} ${t.cmd}${deep ? ' 3点' : ''}${t.arg ? ' ' + t.arg : ''}`;
    let body;
    S.ctx = null;
    S.ckSel = null;
    S.ckItems = [];
    S.lvPin = null;
    clearTimeout(S.segTimer);
    if (!a) {
      const q = quoteOf(st);
      const none = !arr(st.analyses).length;
      body = emptyHtml({
        code: `SYS-T-0${TYPES.indexOf(t) + 1} / STANDBY`, title: t.label,
        h3: none && t.key === 'quick' ? 'この銘柄はまだ分析していません' : `${t.label}は未実行です`,
        p: none && t.key === 'quick'
          ? 'クイック診断を実行すると、4点診断・株価チャート・業績推移・シナリオ・需給などの図解がここに並びます。'
          : 'この型の分析はまだ走らせていません。実行すると、ここに図解つきの結果が並びます。',
        note: (q.date ? `株価・基本情報は収集済み（<b>${esc(q.date)}</b>）。下のコマンドで分析を実行できます。` : '')
          + (t.key === 'news' ? '<br>出来事を決めていないときは <b>/kabu ニュース 探して</b>（直近1週間に株価が大きく動いた出来事を1つ選びます）。' : t.key === 'hansei' ? '<br>例：<b>/kabu ' + esc(name) + ' 反省 2026-08-28 5600</b>（いま売るべきかには答えず、振り返りと次回の確認点だけを出します）。' : ''),
        cmd: `/kabu ${name}${t.key === 'quick' ? '' : ' ' + t.cmd}`, arg: t.arg || '',
      });
    } else if (R.type === 'chart') {
      S.ctx = chartCtx(st, a);
      body = chartView(S.ctx);
    } else if (R.type === 'kessan') {
      S.ctx = kessanCtx(st, a);
      body = kessanView(S.ctx);
    } else if (R.type === 'news') {
      S.ctx = newsCtx(st, a);
      body = newsView(S.ctx);
    } else if (R.type === 'hansei') {
      S.ctx = hanseiCtx(st, a);
      body = hanseiView(S.ctx);
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
     市場ページ（#/market、#/market/<date>）
     ===================================================================== */
  const FXDIR = { weak: ['円安方向', 'weak', 2], range: ['もみ合い', 'range', 1], strong: ['円高方向', 'strong', 0] };
  const NEWSDIR = { plus: ['＋', 'プラス', 'p'], minus: ['−', 'マイナス', 'm'], neutral: ['＝', '中立', 'n'] };
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const dayNum = (d) => { const t = Date.parse(String(d) + 'T00:00:00Z'); return isNaN(t) ? null : Math.round(t / 864e5); };
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
  const srcLink = (u, lab) => (/^https?:\/\//.test(u || '') ? `<a class="srcl" href="${esc(u)}" target="_blank" rel="noopener">${esc(lab || hostOf(u) || '出典')} ↗</a>` : '');
  const seriesOf = (D, k) => { const S2 = D.market && D.market.series && D.market.series.series; const x = S2 && S2[k]; return x && Array.isArray(x.rows) ? x : null; };

  /** 市場ページの材料：表示する分析（日付指定があればその日）・raw・series・基準日 */
  function marketCtx(route) {
    const D = window.KABU, M = D.market && typeof D.market === 'object' ? D.market : {};
    const list = arr(M.analyses).filter((x) => x && typeof x === 'object' && x.type === 'market');
    if (!list.length && M.analysis && M.analysis.type === 'market') list.push(M.analysis);
    let a = null, badDate = null;
    if (route.date) { a = list.find((x) => x.date === route.date) || null; if (!a) badDate = route.date; }
    if (!a) a = list[0] || null;
    const raw = M.raw && typeof M.raw === 'object' ? M.raw : null;
    const asOf = a ? (a.price && a.price.asOf) || a.date : null;
    const nk = seriesOf(D, '^N225'), fx = seriesOf(D, 'JPY=X');
    const upto = (S2) => (S2 ? S2.rows.filter((r) => r && typeof r.d === 'string' && isNum(r.c) && (!asOf || r.d <= asOf)) : []);
    return { kind: 'market', a, list, badDate, raw, asOf, nk, fx, nkRows: upto(nk), fxRows: upto(fx), series: M.series || null };
  }
  function mkHeader(c) {
    const a = c.a, it = c.raw && c.raw.items ? c.raw.items : {};
    const nkI = it.nikkei225 || {};
    const close = a && a.price && isNum(a.price.close) ? a.price.close : c.nkRows.length ? c.nkRows[c.nkRows.length - 1].c : nkI.value;
    const ch = a && a.price ? a.price.change : nkI.change, pct = a && a.price ? a.price.changePct : nkI.changePct;
    const asOf = c.asOf || nkI.asOf || (c.nkRows.length ? c.nkRows[c.nkRows.length - 1].d : '');
    const up = isNum(ch) ? ch > 0 : isNum(pct) && pct > 0, dn = isNum(ch) ? ch < 0 : isNum(pct) && pct < 0;
    const lastOf = (rows, item) => (rows.length ? rows[rows.length - 1] : item && isNum(item.value) ? { c: item.value, d: item.asOf } : null);
    const fxL = lastOf(c.fxRows, it.usdjpy), usS = seriesOf(window.KABU, '^TNX');
    const usRows = usS ? usS.rows.filter((r) => r && isNum(r.c) && (!c.asOf || r.d <= c.asOf)) : [];
    const usL = lastOf(usRows, it.us10y);
    const kv = (lab, v, unit, d) => `<div class="sh-kv"><span>${lab}${v && v.d ? `<small>${esc(mmdd(v.d))}</small>` : ''}</span><b>${v ? `${fmt(v.c, 2)}<span>${unit}</span>` : '<span>未取得</span>'}</b></div>`;
    const tags = ['日経平均・ドル円・米10年金利', a ? `分析 ${a.date}` : '指標のみ（分析は未実行）'].map((x) => `<span>${esc(x)}</span>`).join('');
    return `<div class="sh mk-sh">
    <div class="sh-id"><div class="ticker">MKT</div><div><h1>市場</h1><div class="tags">${tags}</div></div></div>
    <div class="sh-price"><svg class="ret" aria-hidden="true"><use href="#ret"/></svg><div>
      <div class="lbl"><span>日経平均 ／ ${asOf ? esc(jpDate(asOf)) + '終値' : '基準日不明'}</span></div>
      <div class="pxrow"><span class="px"><span class="num">${fmt(close, 2)}</span><small>円</small></span><span class="chg ${up ? 'up' : dn ? 'dn' : ''}">${up ? '▲' : dn ? '▼' : '―'} <span>前日比</span> ${fmtS(ch, 2)}<span>円</span> / ${fmtS(pct, 2)}%</span></div>
    </div></div>
    ${kv('ドル円', fxL, '円')}${kv('米10年金利', usL, '%')}
    <div class="sh-fill"><svg viewBox="0 0 150 26" aria-hidden="true" fill="none" stroke="#3ee6ff"><path d="M0 13h40" stroke-opacity=".35"/><path d="M46 5v16M52 9v8M58 3v20M64 9v8M70 7v12" stroke-opacity=".5"/><path d="M78 13h30" stroke-dasharray="2 3" stroke-opacity=".45"/><circle cx="123" cy="13" r="9" stroke-opacity=".6"/><circle cx="123" cy="13" r="2.5" fill="#3ee6ff" stroke="none"/><path d="M138 13h12" stroke-opacity=".35"/></svg></div>
  </div>`;
  }
  function mkTabs(c) {
    let right;
    if (c.list.length > 1) {
      const items = c.list.map((x) => ({ d: x.date, on: c.a && x.date === c.a.date }));
      right = c.list.length > 5
        ? `<span class="dates"><span class="lb">履歴</span><select aria-label="分析日を選ぶ" data-dates>${items.map((x) => `<option value="${esc(hrefMarket(x.d))}"${x.on ? ' selected' : ''}>${esc(x.d)}</option>`).join('')}</select></span>`
        : `<span class="dates"><span class="lb">履歴</span>${items.map((x) => `<a class="${x.on ? 'on' : ''}" href="${hrefMarket(x.d)}">${esc(mmdd(x.d))}</a>`).join('')}</span>`;
    } else right = `<span class="note">ANALYSIS <b>${c.a ? 'MARKET' : 'STANDBY'}</b>${c.a ? ' ／ ' + esc(mmdd(c.a.date)) : ''}</span>`;
    return `<nav class="tabs" aria-label="市場ページ"><a class="tab on" href="${hrefMarket(c.a && c.list.length > 1 ? c.a.date : null)}"><i>M-01</i>市場の分析<span class="dot"></span></a><div class="rt"><span class="lgd"><i style="background:var(--cy)"></i>上昇・プラス</span><span class="lgd"><i style="background:var(--mag)"></i>下落・マイナス</span><span class="lgd"><i style="background:var(--amber)"></i>警告・注目</span>${right}</div></nav>`;
  }
  function mkChartPanel(c) {
    const R = K.RANGES[S.mkRange] ? S.mkRange : '1y';
    const btns = Object.keys(K.RANGES).map((k) => `<button type="button" class="rg${k === R ? ' on' : ''}" data-mk-range="${k}" aria-pressed="${k === R}">${K.RANGES[k][1]}</button>`).join('');
    const pm = `<span class="rgs" role="group" aria-label="表示する期間">${btns}</span>`;
    if (!c.nkRows.length) return panel('mkchart', 'MKT-C1 / INDEX', '日経平均とドル円', pm, `<div class="pb">${noData('mkchart', c.a, { def: '指数の日足（series.json）がありません。/kabu 市場 の収集で作られます' })}</div>`);
    const closes = c.nkRows.map((r) => r.c);
    const ma = (n) => { const v = K.sma(closes, n); return v[v.length - 1]; };
    const vv = (v) => (isNum(v) ? `<b>${fmt(v, 0)}</b>` : '<b>—</b>');
    const legend = `<span><i class="sw mkl"></i>日経平均</span><span><i class="sw l25"></i>25日線 ${vv(ma(25))}</span><span><i class="sw l75"></i>75日線 ${vv(ma(75))}</span><span><i class="sw l200"></i>200日線 ${vv(ma(200))}</span>${c.fxRows.length ? '<span><i class="sw mkf"></i>ドル円（下段）</span>' : '<span class="ndn" data-nodata="mkchart:fx">ドル円の日足は未取得</span>'}`;
    const fxc = c.fxRows.map((r) => r.c);
    const dev = [[25, '日経平均 25日線との乖離'], [75, '75日線'], [200, '200日線']].map(([n, l]) => K.devCell(l, K.deviation(closes, n))).join('') + K.devCell('ドル円 25日線との乖離', K.deviation(fxc, 25));
    return panel('mkchart', 'MKT-C1 / INDEX', '日経平均とドル円', pm, `<div class="pb"><div class="legend">${legend}</div><div class="host mkhost" data-chart="mkchart" data-range="${R}"></div><div class="dev" aria-label="移動平均線からの乖離率">${dev}</div></div>`);
  }
  function mkIndPanel(c) {
    const items = c.raw && c.raw.items && typeof c.raw.items === 'object' ? c.raw.items : null;
    const pm = `<span>${esc(c.raw && c.raw.date ? c.raw.date : '')}</span>`;
    if (!items || !Object.keys(items).length) return panel('mkind', 'MKT-C2 / TICKER', '指標の直近値', pm, `<div class="pb">${noData('mkind', null, { sm: true, def: '指標の直近値（raw）がありません' })}</div>`);
    const rows = marketRows(items).map((m) => {
      const it = m.it, up = isNum(it.change) ? it.change >= 0 : true;
      const cg = m.key === 'usdjpy' ? (isNum(it.change) ? `<span class="n">${fmtS(it.change, 2)} ${it.change >= 0 ? '円安方向' : '円高方向'}</span>` : '') : `<span class="${up ? 'up' : 'dn'}">${isNum(it.change) && m.viz !== 'zt' ? fmtS(it.change, m.dec) : ''}${isNum(it.changePct) && m.viz === 'zt' ? fmtS(it.changePct, 2) + '%' : ''}</span>`;
      const p = isNum(it.changePct) ? K.clamp(it.changePct, -4, 4) : 0;
      const bar = `<span class="zt"><u class="a-gx${p < 0 ? ' neg' : ''}" style="${p < 0 ? 'right:50%' : 'left:50%'};width:${(Math.abs(p) / 4 * 50).toFixed(2)}%"></u></span>`;
      return `<div class="mki"${it.note ? ` title="${esc(it.note)}"` : ''}><span class="nm">${esc(m.name)}<i class="${m.subAlt ? 'alt' : ''}">${esc(m.sub)}</i></span><span class="vl">${fmt(it.value, m.dec)}${m.unit ? `<small>${esc(m.unit)}</small>` : ''}</span><span class="cg">${cg}</span>${bar}</div>`;
    }).join('');
    return panel('mkind', 'MKT-C2 / TICKER', '指標の直近値', `${pm}<span class="jp">棒＝前日比（±4%）</span>`, `<div class="pb"><div class="mkis">${rows}</div></div>`);
  }
  function levelPanelM(c) {
    const a = c.a, L = secs(a).level && typeof secs(a).level === 'object' ? secs(a).level : null;
    if (!L) return panel('level', 'MKT-A1 / LEVEL', '相場の高い安い', '', `<div class="pb">${noData('level', a, { sm: true })}</div>`);
    const pos = isNum(L.position) ? K.clamp(L.position, 0, 1) : null;
    const g = arr(L.gauges).filter((x) => x && typeof x === 'object').map((x, i) => {
      const has = isNum(x.value);
      const val = has ? `<span class="vl">${fmt(x.value, K.decOf(x.value, 2))}<small>${esc(x.unit || '')}</small></span>` : `<span class="nd" data-nodata="level:${esc(x.key || i)}">未取得</span>`;
      const ref = x.refLabel ? `<span class="ref"><i class="sw rfs"></i>${esc(x.refLabel)}</span>` : '';
      return `<div class="mg" data-gauge="${esc(x.key || i)}"><div class="hd"><span class="nm">${esc(x.label || x.key || '')}</span>${val}</div>${ref}${K.refGauge(x)}${!has && missFor(a, 'level') ? `<span class="ref">${esc(missFor(a, 'level'))}</span>` : ''}</div>`;
    }).join('');
    const meter = pos != null ? `<div class="mkm">${kmeter(pos, '安い', '高い')}<div class="mkv"><span class="code">VERDICT</span><b>${esc(L.verdict || '—')}</b><small>位置 <span class="mono">${fmt(pos * 100, 0)}</span> ／ 100</small></div></div>` : `<div class="mkm">${noData('level', a, { sm: true, word: '位置' })}</div>`;
    return panel('level', 'MKT-A1 / LEVEL', '相場の高い安い', '<span class="jp"><i class="sw rfs"></i>基準 ・ <i class="sw gms"></i>いまの値</span>', `<div class="pb">${meter}${L.text ? `<p class="mkt">${richNums(L.text)}</p>` : ''}<div class="mgs">${g}</div></div>`);
  }
  function outlookPanelM(c) {
    const a = c.a, list = arr(secs(a).outlook);
    const close = a.price && isNum(a.price.close) ? a.price.close : null;
    const pm = `<span class="jp">来年末までの日経平均 ・ 起点 <span class="mono">${K.fmtP(close)}</span>円</span>`;
    if (!list.length) return panel('outlook', 'MKT-A2 / SCENARIO', '3つのシナリオ', pm, `<div class="pb">${noData('outlook', a)}</div>`);
    return panel('outlook', 'MKT-A2 / SCENARIO', '3つのシナリオ', pm, `<div class="pb"><div class="scn mk-scn"><div class="host" data-chart="mkfan"></div><div class="scards">${scenCards(list)}</div></div><div class="mk-review" data-slot="review" hidden></div></div>`);
  }
  function fxPanel(c) {
    const a = c.a, F = secs(a).fx && typeof secs(a).fx === 'object' ? secs(a).fx : null;
    if (!F) return panel('fx', 'MKT-A3 / FX', '為替（ドル円）', '', `<div class="pb">${noData('fx', a, { sm: true })}</div>`);
    const d = FXDIR[F.direction] || null;
    const zones = [['strong', '円高方向'], ['range', 'もみ合い'], ['weak', '円安方向']].map(([k, l]) => `<span class="fz${d && d[1] === k ? ' on' : ''}" data-fx="${k}">${l}</span>`).join('');
    const last = c.fxRows.length ? c.fxRows[c.fxRows.length - 1] : null;
    const dirH = `<div class="fxd"><div class="fxa" role="img" aria-label="為替の向き ${d ? d[0] : '不明'}"><div class="fzs">${zones}</div><div class="fxt"><i style="left:${d ? [16.7, 50, 83.3][d[2]] : 50}%"></i></div><div class="fxs"><span>◀ 円が強くなる</span><span>円が弱くなる ▶</span></div></div><div class="fxn"><span>ドル円</span><b>${last ? fmt(last.c, 2) : '—'}<small>円</small></b><em class="${d ? d[1] : ''}">${d ? d[0] : '向き未取得'}</em></div></div>`;
    const eff = arr(F.effects).filter((x) => x && x.who);
    const col = (dir, lab, g) => { const xs = eff.filter((x) => x.dir === dir); return `<div class="fxc ${dir}"><div class="fxh"><span class="kg">${g}</span><b>${lab}</b><em>${xs.length}</em></div>${xs.map((x) => `<div class="fxe"><b>${esc(x.who)}</b><p>${richNums(x.text || '')}</p></div>`).join('') || '<p class="cwn">該当なし</p>'}</div>`; };
    const eh = `<div class="fxg">${col('plus', 'プラスになる側', '＋')}<div class="kpmv" aria-hidden="true"><i></i><b>${d ? esc(d[0].replace('方向', '')) : 'FX'}</b><i></i></div>${col('minus', 'マイナスになる側', '−')}</div>`;
    const tx = [F.text ? `<p><span class="tl">いま</span>${richNums(F.text)}</p>` : '', F.outlook ? `<p><span class="tl">この先</span>${richNums(F.outlook)}</p>` : ''].join('');
    return panel('fx', 'MKT-A3 / FX', '為替（ドル円）', '<span class="jp">誰にプラス・誰にマイナスか</span>', `<div class="pb">${dirH}${eh}${tx ? `<div class="fxx">${tx}</div>` : ''}</div>`);
  }
  function ratesPanel(c) {
    const a = c.a, R = secs(a).rates && typeof secs(a).rates === 'object' ? secs(a).rates : null;
    const items = R ? arr(R.items).filter((x) => x && typeof x === 'object') : [];
    if (!items.length) return panel('rates', 'MKT-A4 / RATES', '金利', '', `<div class="pb">${noData('rates', a, { sm: true })}</div>`);
    const mx = K.niceCeil(Math.max(1, ...items.map((x) => (isNum(x.value) ? Math.abs(x.value) : 0))) * 1.15);
    const cards = items.map((x, i) => {
      const has = isNum(x.value);
      return `<div class="rtc" data-rate="${esc(x.key || i)}"><span class="nm">${esc(x.label || x.key || '')}</span>${has ? `<b class="vl">${fmt(x.value, Math.max(2, K.decOf(x.value, 3)) === 3 ? 3 : 2)}<small>${esc(x.unit || '')}</small></b>${K.refGauge({ value: x.value, ref: null, max: mx })}` : `<span class="nd" data-nodata="rates:${esc(x.key || i)}">未取得</span>${missFor(a, 'rates') ? `<small class="ref">${esc(missFor(a, 'rates'))}</small>` : ''}`}${x.note ? `<small class="ref">${esc(x.note)}</small>` : ''}</div>`;
    }).join('');
    return panel('rates', 'MKT-A4 / RATES', '金利', `<span class="jp">物差し 0〜${fmt(mx, K.decOf(mx, 1))}</span>`, `<div class="pb"><div class="rts">${cards}</div>${R.text ? `<p class="mkt">${richNums(R.text)}</p>` : ''}</div>`);
  }
  function geoPanelM(c) {
    const a = c.a, list = arr(secs(a).geo).filter((g) => g && (g.name || g.title));
    const pm = '<span class="jp">影響の大きい順 ・ 影響度 5段階</span><span class="jp"><i class="sw chp"></i>プラス <i class="sw chm"></i>マイナス</span>';
    if (!list.length) return panel('geo', 'MKT-A5 / GEO-RISK', '地政学ランキング', pm, `<div class="pb">${noData('geo', a, { sm: true })}</div>`);
    const rows = list.map((g, i) => {
      const chips = arr(g.sectors).filter((x) => x && x.name).map((x) => `<span class="chp ${x.dir === 'plus' ? 'p' : 'm'}">${x.dir === 'plus' ? '▲' : '▼'} ${esc(x.name)}</span>`).join('');
      return `<div class="gk" data-geo="${i}"><span class="r">${String(i + 1).padStart(2, '0')}</span><div class="gt2"><b>${esc(g.name || g.title)}</b>${g.text ? `<p>${richNums(g.text)}</p>` : ''}</div><div class="gl">${K.stars(g.level)}${K.segs(g.level)}</div><div class="gs">${chips || '<span class="cwn">業種の記載なし</span>'}</div></div>`;
    }).join('');
    return panel('geo', 'MKT-A5 / GEO-RISK', '地政学ランキング', pm, `<div class="pb"><div class="gkh"><span>順位</span><span>出来事</span><span>影響度</span><span>影響する業種</span></div>${rows}</div>`);
  }
  function newsPanelM(c) {
    const a = c.a, list = arr(secs(a).news).filter((x) => x && x.title);
    const cnt = (k) => list.filter((x) => x.dir === k).length;
    const pm = `<span class="jp">プラス ${cnt('plus')} ・ マイナス ${cnt('minus')} ・ 中立 ${cnt('neutral')}</span>`;
    if (!list.length) return panel('news', 'MKT-A6 / NEWS', '今日のニュース', '', `<div class="pb">${noData('news', a, { sm: true })}</div>`);
    const bar = `<div class="nwb" aria-hidden="true">${list.map((x) => `<i class="${(NEWSDIR[x.dir] || NEWSDIR.neutral)[2]}"></i>`).join('')}</div>`;
    const cards = list.map((x, i) => {
      const d = NEWSDIR[x.dir] || NEWSDIR.neutral;
      const chips = arr(x.sectors).filter((y) => typeof y === 'string' && y).map((y) => `<span>${esc(y)}</span>`).join('');
      return `<article class="nwc ${d[2]}" data-news="${i}"><div class="nwh"><span class="nwd ${d[2]}"><i>${d[0]}</i>${d[1]}</span>${chips ? `<span class="nws">${chips}</span>` : ''}</div><b>${esc(x.title)}</b>${x.text ? `<p>${richNums(x.text)}</p>` : ''}${srcLink(x.url) ? `<span class="nwu">出典 ${srcLink(x.url)}</span>` : ''}</article>`;
    }).join('');
    return panel('news', 'MKT-A6 / NEWS', '今日のニュース', pm, `<div class="pb">${bar}<div class="nwg">${cards}</div></div>`);
  }
  function calendarPanel(c) {
    const a = c.a, list = arr(secs(a).calendar).filter((x) => x && typeof x.date === 'string').sort((x, y) => x.date.localeCompare(y.date));
    const base = dayNum(a.date);
    if (!list.length) {
      const why = missFor(a, 'calendar');
      return panel('calendar', 'MKT-A7 / CALENDAR', '今後の予定', '', `<div class="pb"><div class="cal0" data-nodata="calendar">${why ? `<span class="nd">未取得</span>${esc(why)}` : '<span class="nd0">予定なし</span>今後2週間ほどの予定の記載はありません'}</div></div>`);
    }
    const rows = list.map((x, i) => {
      const dn = dayNum(x.date), diff = dn != null && base != null ? dn - base : null;
      const wd = dn != null ? WD[((dn + 4) % 7 + 7) % 7] : '';
      const rel = diff == null ? '' : diff === 0 ? '当日' : diff > 0 ? `あと${diff}日` : `${-diff}日前`;
      return `<li data-cal="${i}"><i class="dt"></i><span class="cd"><b class="mono">${esc(mmdd(x.date))}</b><small>${wd ? `（${wd}）` : ''}</small></span><span class="cr2">${esc(rel)}</span><p>${esc(x.label || '')}</p></li>`;
    }).join('');
    return panel('calendar', 'MKT-A7 / CALENDAR', '今後の予定', `<span class="jp">${list.length}件 ・ 分析日 ${esc(mmdd(a.date))} 起点</span>`, `<div class="pb"><ol class="cal">${rows}</ol></div>`);
  }
  function mkStandby() {
    const parts = ['相場の高い安い', '3つのシナリオ', '為替（誰にプラス・マイナスか）', '金利', '地政学ランキング', '今日のニュース', '今後の予定'];
    return `<section class="panel" data-sec="standby"><div class="pi"><div class="ph"><span class="code">MKT-A0 / STANDBY</span><h2>市場の分析</h2><div class="pm"><span>STATUS: <span class="jp">未実行</span></span></div></div>
      <div class="mkst">${RADAR.replace(/<text[^]*?<\/text>/, '')}<div><span class="code">MODULE STANDBY</span><h3>市場の分析は未実行です</h3><p>いまは指標の直近値と日経平均・ドル円の折れ線だけを表示しています。分析を実行すると、次の枠がここに並びます。</p>
      <div class="mkps">${parts.map((x) => `<span>${esc(x)}</span>`).join('')}</div><div class="cmdl"><em>&gt;</em>/kabu 市場<i class="cur"></i></div></div></div></div></section>`;
  }
  function renderMarket(route) {
    const D = window.KABU;
    const c = marketCtx(route);
    S.ctx = c;
    S.ckSel = null; S.ckItems = []; S.lvPin = null;
    const a = c.a;
    let body;
    if (!a) {
      body = `<div id="mview" class="mv"><div class="mv-r1">${mkChartPanel(c)}<div class="mv-rc">${mkIndPanel(c)}${mkStandby()}</div></div></div>`;
    } else {
      body = `<div id="mview" class="mv">
    <div class="mv-r1">${mkChartPanel(c)}<div class="mv-rc">${levelPanelM(c)}${mkIndPanel(c)}</div></div>
    <div class="mv-r2">${outlookPanelM(c)}${fxPanel(c)}</div>
    <div class="mv-r3">${geoPanelM(c)}<div class="mv-rc">${ratesPanel(c)}${calendarPanel(c)}</div></div>
    ${newsPanelM(c)}
    ${notesPanel(a)}
  </div>`;
    }
    const notice = c.badDate ? `<div class="foot-b" style="margin:0 0 6px;border:0;padding:0 4px"><span class="warn">指定の日付 ${esc(c.badDate)} の市場の分析は無いため、最新の分析を表示しています</span></div>` : '';
    const ser = c.series && c.series.source ? [c.series.source] : [];
    const sources = a ? a.sources : [...(c.raw && c.raw.source ? [c.raw.source] : []), ...ser].filter((x, i, l) => x && l.findIndex((y) => y && y.url === x.url) === i);
    const missing = a ? a.missing : arr(c.series && c.series.missing);
    $('#main').innerHTML = `<section class="view" id="v-market" aria-label="市場ページ" data-view="market">${mkHeader(c)}${mkTabs(c)}${notice}${body}${footHtml(sources, missing)}</section>`;
    return { cmd: '/kabu 市場', view: 'MARKET 市場', date: a ? a.date : c.raw && c.raw.date ? c.raw.date : localDate(D.generatedAt) };
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
    // 市場ページ
    mkchart: (W, H, c) => {
      const R = K.RANGES[S.mkRange] ? S.mkRange : '1y', m = K.RANGES[R][0];
      const main = K.seriesWindow(c.nkRows, c.asOf, m, [25, 75, 200]), sub = K.seriesWindow(c.fxRows, c.asOf, m, []);
      return K.marketChart({ main: { name: '日経平均', unit: '円', rows: main.rows, ma: main.ma }, sub: c.fxRows.length ? { name: 'ドル円', unit: '円', rows: sub.rows } : null, W, H, label: `日経平均とドル円の推移（${K.RANGES[R][1]}）` });
    },
    mkfan: (W, H, c) => {
      const sc = arr(secs(c.a).outlook), by = (k) => { const s2 = sc.find((x) => x && x.kind === k); return s2 && s2.target ? s2.target : null; };
      return K.fan({ hist: c.nkRows.slice(-20).map((r) => r.c), now: c.a.price && c.a.price.close, bull: by('bull'), base: by('base'), bear: by('bear'), W, H });
    },
    // ニュース型・反省型
    nchart: (W, H, c) => {
      const pins = [...c.pins];
      const f0 = c.rc && c.rc.from;
      if (f0 && typeof f0.date === 'string' && isNum(f0.price) && !pins.some((p) => p.date === f0.date)) pins.push({ date: f0.date, label: `前日終値 ${K.fmtP(f0.price)}円`, at: f0.price });
      return K.priceChart({ rows: c.w.rows, ma25: c.w.ma.ma25 || [], ma75: c.w.ma.ma75 || [], dec: c.dec, pins, W, H, label: `${c.st.name || c.st.code} 日足チャートと出来事の日` });
    },
    hchart: (W, H, c) => K.levelChart({ rows: c.w.rows, ma: c.w.ma, levels: c.levels, vp: null, dec: c.dec, entry: c.entry ? { price: c.entry.price, date: c.entry.date, label: '買' } : null, pins: c.hpins, W, H, label: `${c.st.name || c.st.code} 日足チャートと購入日` }),
    // チャート型
    lv: (W, H, c) => K.levelChart({ rows: c.rows, ma: c.ma, levels: c.levels, vp: c.I && c.I.volumeProfile, dec: c.dec, W, H, label: `${c.st.name || c.st.code} 日足チャートとサポート・レジスタンス` }),
    tf: (W, H, c, h) => { const t = c.tf && c.tf[h.dataset.k]; return t ? K.miniCandles({ bars: t.bars, ma: t.ma, W, H, label: `${TF[h.dataset.k][1]}のローソク足`, empty: `${TF[h.dataset.k][1]}のデータがありません` }) : ''; },
    plans: (W, H, c) => K.plansChart({ plans: c.plans, close: c.close, W, H, axisW: PLAN_AXIS, gap: PLAN_GAP }),
    // 決算型
    pair: (W, H, c, h) => { const r = c.results && c.results[+h.dataset.i]; return r ? K.pairBars3d({ curr: r.value, prev: K.prevFromYoy(r.value, r.yoyPct), W, H }) : ''; },
    returns: (W, H, c) => K.returns3d({ divs: c.divs, eps: c.eps, W, H }),
    mline: (W, H, c) => K.marginLine({ rows: c.qm, W, H }),
  };
  function drawHost(h) {
    const fn = DRAW[h.dataset.chart];
    const W = h.clientWidth, H = h.clientHeight;
    h.dataset.wh = `${W}x${H}`;
    h.innerHTML = fn && S.ctx && W > 0 && H > 0 ? fn(W, H, S.ctx, h) : '';
    if (h.dataset.chart === 'lv') lvApply(S.lvPin);
  }
  /** サポレジ一覧の行 i に対応するチャートの線・帯・札を強調（null で解除）。押して固定した行は aria-pressed */
  function lvApply(i) {
    const key = i == null ? null : String(i);
    const svg = $('svg.lvchart');
    if (svg) {
      svg.classList.toggle('hl', key != null);
      $$('.lvg', svg).forEach((g) => g.classList.toggle('on', g.dataset.lv === key));
    }
    $$('.lvr').forEach((r) => {
      r.classList.toggle('on', r.dataset.lv === key);
      const pin = S.lvPin != null && r.dataset.lv === String(S.lvPin);
      r.classList.toggle('pin', pin);
      r.setAttribute('aria-pressed', pin ? 'true' : 'false');
    });
  }
  function lvSelect(i) { S.lvPin = S.lvPin != null && String(S.lvPin) === String(i) ? null : String(i); lvApply(S.lvPin); }
  // 枠の大きさが変わったら（理由欄の開閉・行の伸縮など）その図だけ描き直す
  const RO = window.ResizeObserver ? new ResizeObserver((ents) => {
    ents.forEach((en) => { const h = en.target; if (h.isConnected && h.dataset.wh !== `${h.clientWidth}x${h.clientHeight}`) drawHost(h); });
  }) : null;
  function drawAll() {
    $$('[data-chart]').forEach((h) => { drawHost(h); if (RO) RO.observe(h); });
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
    // チャート型：サポレジ一覧の枠はメインチャートの枠より短くしない（下端を揃える）
    const lc = $('.cv-r2 > [data-sec="lvchart"]'), lvp = $('.cv-r2 > [data-sec="levels"]');
    if (lc && lvp) lvp.style.minHeight = lc.offsetHeight + 'px';
    const pop = $('#seg-pop'), pair = $('.pair');
    if (pop && pair) pop.style.minHeight = pair.getBoundingClientRect().height + 'px';
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
      <h1>${kind === 'broken' ? 'データファイル（src/app/data.js）を読み込めませんでした' : 'データファイル（src/app/data.js）がまだありません'}</h1>
      <p>${kind === 'broken' ? 'data.js が途中で壊れているようです。作り直せば直ります。' : 'アプリは data/ の中身から作る src/app/data.js を読んで表示します。'}</p>
      <ol><li>ターミナルで KABU LAB のプログラムのフォルダ（kabu-lab/src）を開く</li><li><code>node build.mjs</code> を実行する</li><li>このページを再読み込みする</li></ol>
      <div class="cmdl"><em>$</em>node build.mjs<i class="cur"></i></div>
    </div></section></div>`;
  }

  /** 用語帳・気づきノート（中身は P3c）。ルートと「準備中」の枠だけ */
  function renderPending(route) {
    const D = window.KABU;
    const g = arr(D.glossary).filter((x) => x && x.term), n = arr(D.notes).filter((x) => x && x.text);
    const o = route.view === 'glossary'
      ? { code: 'EDU-02 / GLOSSARY', title: '用語帳', h3: '用語帳は準備中です', p: `全分析の用語（いま ${g.length}語）を1つの一覧にして、検索・分類・暗記用の「定義をかくす」切替をここに並べます。`, view: 'GLOSSARY 用語帳' }
      : { code: 'EDU-03 / NOTES', title: '気づきノート', h3: '気づきノートは準備中です', p: `全分析の気づき・教訓・次回の確認点（いま ${n.length}件）を日付の新しい順に並べ、型と銘柄で絞り込めるようにします。`, view: 'NOTES 気づきノート' };
    $('#main').innerHTML = `<section class="view" id="v-${route.view}" aria-label="${o.title}" data-view="${route.view}">${emptyHtml({ code: o.code, title: o.title, status: '準備中', mod: 'MODULE PENDING', h3: o.h3, p: o.p, note: '今日の用語はホームの「今日の用語カード」で見られます。' })}</section>`;
    return { cmd: '', view: o.view, date: localDate(D.generatedAt) };
  }

  function render(route) {
    S.route = route;
    if (!K) return;
    if (!dataOk()) { renderBoot(); return; }
    const info = route.view === 'stock' ? renderStock(route) : route.view === 'market' ? renderMarket(route) : route.view === 'glossary' || route.view === 'notes' ? renderPending(route) : renderHome();
    chrome(route, info);
    drawAll();
    animate(route.view === 'stock' ? 'stock:' + route.code : route.view);
    if (!S.testing) window.scrollTo(0, 0);
  }

  /* ---------- イベント ---------- */
  window.addEventListener('hashchange', () => render(parseHash(location.hash)));
  /** チェックリストのセルを選ぶ（同じセルをもう一度押すと既定の表示に戻す） */
  function ckSelect(id, keep) {
    S.ckSel = keep ? id : S.ckSel === id ? null : id;
    $$('.ckg .ck').forEach((c) => { const on = c.dataset.ck === S.ckSel; c.classList.toggle('sel', on); c.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    const why = $('[data-ck-why]');
    if (why) why.innerHTML = K.ckReasons(S.ckItems, S.ckSel);
    $$('.cr[data-why]').forEach((c) => c.classList.toggle('sel', c.dataset.why === S.ckSel));
    // 理由欄の高さが変わると同じ段の図の枠も変わるので、すぐ描き直す（ResizeObserver を待たない）
    $$('[data-chart]').forEach((h) => { if (h.dataset.wh !== `${h.clientWidth}x${h.clientHeight}`) drawHost(h); });
  }
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const tr = t.closest('tr[data-href]');
    if (tr) { location.hash = tr.dataset.href; return; }
    if (t.closest('[data-seg-toggle]')) { segSet(!segIsOpen() || $('#seg-pop').classList.contains('closing')); return; }
    if (t.closest('[data-seg-close]')) { segSet(false); return; }
    if (segIsOpen() && !t.closest('#seg-pop')) segSet(false, { focus: false });
    const ck = t.closest('.ckg .ck');
    if (ck) ckSelect(ck.dataset.ck);
    const lr = t.closest('.lvr');
    if (lr) lvSelect(lr.dataset.lv);
    const rg = t.closest('[data-mk-range]');
    if (rg) mkSetRange(rg.dataset.mkRange);
  });
  /** 市場の折れ線の期間（3か月・1年・2年）を切り替えて、その図だけ描き直す */
  function mkSetRange(k) {
    if (!K.RANGES[k]) return;
    S.mkRange = k;
    $$('[data-mk-range]').forEach((b) => { const on = b.dataset.mkRange === k; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    const h = $('[data-chart="mkchart"]');
    if (h) { h.dataset.range = k; drawHost(h); }
  }
  // サポレジ一覧：マウス・フォーカスを合わせている間だけ強調（離れたら固定中の行に戻す）
  document.addEventListener('mouseover', (e) => { const r = e.target.closest && e.target.closest('.lvr'); if (r) lvApply(r.dataset.lv); else if (e.target.closest && e.target.closest('.lvlist')) lvApply(S.lvPin); });
  document.addEventListener('mouseout', (e) => { const r = e.target.closest && e.target.closest('.lvr'); if (r && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.lvr'))) lvApply(S.lvPin); });
  document.addEventListener('focusin', (e) => { const r = e.target.closest && e.target.closest('.lvr'); if (r) lvApply(r.dataset.lv); });
  document.addEventListener('focusout', (e) => { if (e.target.closest && e.target.closest('.lvr')) lvApply(S.lvPin); });
  // 展開一覧の行にマウス・フォーカスを合わせると、ドーナツの該当部分を強調
  const segHl = (i) => { const dn = $('#seg-pop .sp-dn'); if (!dn) return; dn.classList.toggle('hl', i != null); $$('.arc', dn).forEach((a) => a.classList.toggle('on', a.dataset.i === String(i))); $$('#seg-pop .sp-r').forEach((r) => r.classList.toggle('on', r.dataset.i === String(i))); };
  document.addEventListener('mouseover', (e) => { const r = e.target.closest && e.target.closest('#seg-pop .sp-r'); if (r) segHl(r.dataset.i); else if (e.target.closest && e.target.closest('#seg-pop')) segHl(null); });
  document.addEventListener('change', (e) => { if (e.target && e.target.matches && e.target.matches('select[data-dates]')) location.hash = e.target.value; });
  document.addEventListener('keydown', (e) => {
    const tr = e.target.closest && e.target.closest('tr[data-href]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); location.hash = tr.dataset.href; return; }
    if (!dataOk()) return;
    if (e.key === 'Escape' && segIsOpen()) { e.preventDefault(); segSet(false); return; }
    const ck = e.target.closest && e.target.closest('.ckg .ck');
    if (ck && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      const cells = $$('.ckg .ck'), i = cells.indexOf(ck), cols = ck.closest('.ck10') ? 10 : 5;
      const j = { ArrowLeft: i - 1, ArrowRight: i + 1, ArrowUp: i - cols, ArrowDown: i + cols }[e.key];
      if (j >= 0 && j < cells.length) { e.preventDefault(); cells[j].focus(); ckSelect(cells[j].dataset.ck, true); }
      return;
    }
    if (e.key === 'F1') { e.preventDefault(); location.hash = '#/'; }
    if (e.key === 'F2') { const c = recentCode(); if (c) { e.preventDefault(); location.hash = hrefStock(c); } }
    const g = GNAV.find((x) => x.fk === e.key && x.key !== 'home');
    if (g) { e.preventDefault(); location.hash = g.href; }
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
    render, redraw: drawAll, current: () => S.route, segSet, segIsOpen, ckSelect, ckState: () => ({ sel: S.ckSel, items: S.ckItems }),
    lvSelect, lvState: () => S.lvPin, rulesOf, PLAN_AXIS, PLAN_GAP,
    setTesting: (b) => { S.testing = !!b; if (b) { clearTimeout(S.animTimer); document.body.classList.remove('anim'); } },
    mkSetRange, mkState: () => S.mkRange,
    snapshot: () => ({ recent: S.recent, seen: { ...S.seen }, mkRange: S.mkRange }),
    restore: (s) => { if (!s) return; S.recent = s.recent; S.seen = { ...s.seen }; S.mkRange = s.mkRange || '1y'; try { if (s.recent) window.localStorage.setItem('kabu.recent', s.recent); else window.localStorage.removeItem('kabu.recent'); } catch (e) { /* 無視 */ } },
  };

  render(parseHash(location.hash));
})();
