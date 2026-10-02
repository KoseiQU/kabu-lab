/* KABU LAB — charts.js
   SVG／HTML の描画部品。すべて「データ＋寸法 → 文字列」の純粋関数で、DOM には触らない。
   ブラウザでは <script src="charts.js">、Node では import して globalThis.KABU_CHARTS を使う。
   見た目の正は mocks/mock-6-final.html。軸・目盛り・ラベル位置はデータから自動計算する。 */
(function (G) {
  'use strict';

  const C = { cy: '#3ee6ff', cy2: '#a6f3ff', mag: '#ff5ca3', amb: '#ffb340', tx: '#d8e7ef', tx2: '#9db3c2', tx3: '#7f97a8', w: '#f4fbff', wh: '#effcff', bg: '#05080d', mid: '#cfdde6' };
  const SEG_COLORS = ['#3ee6ff', '#8ff0ff', '#2a9fc4', '#5d7f93', '#1f7d99', '#9db3c2', '#56c8e0', '#47606f'];

  /* ---------- 基本ユーティリティ ---------- */
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  /** 座標の文字列化。NaN／Infinity は 0 に落として属性に出さない */
  const f = (v) => (isNum(v) ? String(Math.round(v * 10) / 10) : '0');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /** 小数桁数（最大 max 桁） */
  function decOf(v, max = 2) {
    if (!isNum(v)) return 0;
    for (let d = 0; d <= max; d++) if (Math.abs(v * 10 ** d - Math.round(v * 10 ** d)) < 1e-6) return d;
    return max;
  }
  /** 価格の表示桁（配列中の最大桁。0〜2） */
  const priceDec = (vals) => (vals || []).reduce((m, v) => Math.max(m, decOf(v, 2)), 0);
  /** 3桁区切り。負号は数学の「−」。数値でなければ「—」 */
  function fmt(v, d = 0) {
    if (!isNum(v)) return '—';
    const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    return (v < 0 && Number(s.replace(/,/g, '')) !== 0 ? '−' : '') + s;
  }
  /** 価格の表記：小数部が0なら整数、そうでなければ小数1桁（2,227 ／ 2,175.5）。全画面でこの規則に統一する */
  function fmtP(v) {
    if (!isNum(v)) return '—';
    const r = Math.round(v * 10) / 10;
    return fmt(r, Number.isInteger(r) ? 0 : 1);
  }
  /** 符号つき（+21 ／ −0.23） */
  function fmtS(v, d = 0) {
    if (!isNum(v)) return '—';
    const s = fmt(Math.abs(v), d);
    if (Number(s.replace(/,/g, '')) === 0) return s;
    return (v > 0 ? '+' : '−') + s;
  }
  /** 出来高の短縮（3,000万 ／ 1.5億） */
  function fmtVol(v) {
    if (!isNum(v)) return '—';
    if (v >= 1e8) return fmt(v / 1e8, decOf(v / 1e8, 1)) + '億';
    if (v >= 1e4) return fmt(Math.round(v / 1e4)) + '万';
    return fmt(v);
  }
  /** 円を「55万1,000円」の部品 [[数, 単位], ...] に分ける */
  function yenParts(yen) {
    if (!isNum(yen) || yen < 0) return null;
    let y = Math.round(yen);
    const out = [];
    const oku = Math.floor(y / 1e8); y -= oku * 1e8;
    const man = Math.floor(y / 1e4); y -= man * 1e4;
    if (oku) out.push([fmt(oku), '億']);
    if (man) out.push([fmt(man), '万']);
    if (y || !out.length) out.push([fmt(y), '円']);
    else out[out.length - 1][1] += '円';
    return out;
  }
  /** 「25兆454億円」→ [['25','兆'],['454','億円']]。読めなければ null */
  function jpAmountParts(text) {
    if (typeof text !== 'string' || !/\d/.test(text)) return null;
    const out = [];
    text.replace(/([\d,.]+)([^\d,.]*)/g, (_, n, u) => { out.push([n, u]); return ''; });
    return out.length ? out : null;
  }
  /** 文字幅の見積もり（px）。等幅は0.6em、和文は1em */
  function textW(s, px = 12, mono = false) {
    let w = 0;
    for (const ch of String(s == null ? '' : s)) w += ch.charCodeAt(0) < 0x2e80 ? px * (mono ? 0.6 : 0.58) : px;
    return w;
  }

  /* ---------- 目盛りの自動計算 ---------- */
  /** raw 以上で最小の「きりのよい数」（1・2・2.5・5 × 10^n） */
  function niceStep(raw, steps = [1, 2, 2.5, 5, 10]) {
    if (!isNum(raw) || raw <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(raw));
    const n = raw / p;
    for (const s of steps) if (n <= s + 1e-9) return s * p;
    return 10 * p;
  }
  const niceCeil = (v) => niceStep(v, [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]);
  /** min〜max を count 区間前後で刻む。空・単一値・全同値・逆順でも有限の目盛りを返す */
  function niceTicks(min, max, count = 5, steps) {
    if (!isNum(min) || !isNum(max)) { min = 0; max = 1; }
    if (min > max) [min, max] = [max, min];
    if (max - min < 1e-9) { const pad = Math.abs(max) * 0.05 || 1; min -= pad; max += pad; }
    const step = niceStep((max - min) / Math.max(1, count), steps);
    const d = decOf(step, 6);
    const lo = Math.floor(min / step + 1e-9) * step;
    const hi = Math.ceil(max / step - 1e-9) * step;
    const ticks = [];
    for (let k = 0; k < 400; k++) {
      const v = lo + k * step;
      if (v > hi + step * 1e-6) break;
      ticks.push(Number(v.toFixed(d)));
    }
    return { lo: Number(lo.toFixed(d)), hi: Number(hi.toFixed(d)), step, ticks, dec: d };
  }
  /** 単純移動平均（足りない所・欠損を含む窓は null） */
  function sma(vals, n) {
    const a = Array.isArray(vals) ? vals : [];
    const out = new Array(a.length).fill(null);
    if (!(n >= 1)) return out;
    for (let i = n - 1; i < a.length; i++) {
      let s = 0, ok = true;
      for (let j = i - n + 1; j <= i; j++) { if (!isNum(a[j])) { ok = false; break; } s += a[j]; }
      if (ok) out[i] = s / n;
    }
    return out;
  }
  /** 最終値の n 日移動平均からの乖離率（%）。算出できなければ null */
  function deviation(vals, n) {
    const a = Array.isArray(vals) ? vals : [];
    if (a.length < n || !(n >= 1)) return null;
    const ma = sma(a.slice(-n), n)[n - 1];
    const last = a[a.length - 1];
    if (!isNum(ma) || !isNum(last) || ma === 0) return null;
    return (last / ma - 1) * 100;
  }
  /** ラベルの縦位置を重ならないよう押し広げる（順序は保つ） */
  function spread(ys, gap, lo, hi) {
    const idx = ys.map((y, i) => [isNum(y) ? y : lo, i]).sort((a, b) => a[0] - b[0]);
    const out = idx.map(([y]) => clamp(y, lo, hi));
    for (let k = 1; k < out.length; k++) if (out[k] < out[k - 1] + gap) out[k] = out[k - 1] + gap;
    if (out.length && out[out.length - 1] > hi) {
      out[out.length - 1] = hi;
      for (let k = out.length - 2; k >= 0; k--) if (out[k] > out[k + 1] - gap) out[k] = out[k + 1] - gap;
    }
    const res = [];
    idx.forEach(([, i], k) => { res[i] = out[k]; });
    return res;
  }

  /* ---------- SVG 文字列の部品 ---------- */
  const attrs = (a) => Object.entries(a || {}).filter(([, v]) => v !== '' && v != null && v !== false)
    .map(([k, v]) => ` ${k}="${typeof v === 'number' ? f(v) : esc(v)}"`).join('');
  const tag = (name, a, inner) => (inner == null ? `<${name}${attrs(a)}/>` : `<${name}${attrs(a)}>${inner}</${name}>`);
  /** SVG文字。fill はインライン style で確定させ、CSSの汎用セレクタに上書きされないようにする */
  function text(x, y, s, o = {}) {
    const st = `fill:${o.fill || C.tx2}${o.style ? ';' + o.style : ''}`;
    return tag('text', { x, y, class: o.cls || 'st-t', 'text-anchor': o.anchor || '', style: st }, esc(s));
  }
  const pathD = (pts) => (pts.length ? 'M' + pts.map((p) => f(p[0]) + ' ' + f(p[1])).join(' L') : '');
  const poly = (a) => 'M' + a.map((p) => f(p[0]) + ' ' + f(p[1])).join('L') + 'Z';
  /** null を飛ばして線をつなぐ path（途切れたら M で再開） */
  function seriesPath(vals, X, Y) {
    let d = '', on = false;
    vals.forEach((v, i) => {
      if (!isNum(v)) { on = false; return; }
      d += (on ? 'L' : 'M') + f(X(i)) + ' ' + f(Y(v));
      on = true;
    });
    return d;
  }
  const svgOpen = (W, H, label, cls) => `<svg${cls ? ` class="${cls}"` : ''} width="${f(W)}" height="${f(H)}" viewBox="0 0 ${f(W)} ${f(H)}" role="img" aria-label="${esc(label)}">`;
  const validBar = (r) => r && isNum(r.o) && isNum(r.h) && isNum(r.l) && isNum(r.c);
  const mmdd = (d) => (typeof d === 'string' && d.length >= 10 ? d.slice(5, 7) + '/' + d.slice(8, 10) : String(d || ''));
  const md = (d) => (typeof d === 'string' && d.length >= 10 ? +d.slice(5, 7) + '/' + +d.slice(8, 10) : String(d || ''));

  /* =====================================================================
     株価チャート：ローソク足＋出来高＋25日線・75日線＋サポレジ帯＋注釈ピン＋現在値タグ
     o = {rows:[{d,o,h,l,c,v}], ma25:[], ma75:[]（rows と同じ長さ）, res:[{price,label}], sup:[…],
          pins:[{date,label}], W, H, label, dec}
     ===================================================================== */
  function priceChart(o) {
    const W = Math.round(o.W), H = Math.round(o.H);
    if (!(W > 80 && H > 100)) return '';
    const rows = (o.rows || []).filter(validBar);
    const head = svgOpen(W, H, o.label || '株価チャート');
    if (!rows.length) return head + text(W / 2, H / 2, '株価データがありません', { cls: 'st-j', anchor: 'middle' }) + '</svg>';
    const dec = isNum(o.dec) ? o.dec : priceDec(rows.map((r) => r.c));
    // 右余白はタグの最長文字列に合わせる（既定84px＝モック）
    const rLo = Math.min(...rows.map((r) => r.l)), rHi = Math.max(...rows.map((r) => r.h)), rSp = rHi - rLo || Math.abs(rHi) * 0.05 || 1;
    const tagMax = Math.max(textW(fmtP(rows[rows.length - 1].c), 12, true),
      ...[...(o.res || []), ...(o.sup || [])].filter((x) => x && isNum(x.price)).map((x) => {
        const far = x.price < rLo - rSp * 0.35 || x.price > rHi + rSp * 0.35;
        return textW('RES ' + fmtP(x.price), 12, true) + (far ? 14 : 0);
      }));
    const padL = 4, padR = Math.max(84, Math.ceil(tagMax) + 18), padT = 28, padB = 19, gap = 8;
    const volH = Math.round((H - padT - padB) * 0.16), mainH = H - padT - padB - volH - gap, vTop = padT + mainH + gap, mainB = padT + mainH;
    const n = rows.length, pw = W - padL - padR, st = pw / n, bw = clamp(st * 0.6, 1, 7);
    const X = (i) => padL + st * (i + 0.5), ax = W - padR;
    const ma25 = (o.ma25 || []).slice(-n), ma75 = (o.ma75 || []).slice(-n);

    // 価格レンジ：足と移動平均。サポレジは近いものだけ取り込む（遠いものは端のタグで示す）
    let lo = Infinity, hi = -Infinity;
    rows.forEach((r) => { lo = Math.min(lo, r.l); hi = Math.max(hi, r.h); });
    [ma25, ma75].forEach((a) => a.forEach((v) => { if (isNum(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
    const span0 = hi - lo || Math.abs(hi) * 0.05 || 1;
    const levels = [
      ...(o.res || []).map((x) => ({ price: x && x.price, label: x && x.label, k: 'RES' })),
      ...(o.sup || []).map((x) => ({ price: x && x.price, label: x && x.label, k: 'SUP' })),
    ].filter((x) => isNum(x.price) && x.price > 0);
    levels.forEach((L) => {
      L.in = L.price >= lo - span0 * 0.35 && L.price <= hi + span0 * 0.35;
      if (L.in) { lo = Math.min(lo, L.price); hi = Math.max(hi, L.price); }
    });
    const span = hi - lo || span0;
    const P1 = hi + span * 0.085, P0 = Math.max(0, lo - span * 0.05);
    const Y = (p) => padT + (P1 - p) / (P1 - P0 || 1) * mainH;

    const vmax0 = rows.reduce((m, r) => (isNum(r.v) ? Math.max(m, r.v) : m), 0);
    const VMAX = vmax0 > 0 ? niceCeil(vmax0) : 1;
    const VY = (v) => vTop + volH - v / VMAX * volH;

    // 右端のタグ（現在値＋サポレジ）。重なりは縦にずらし、矢印は本来の価格を指す
    const lastC = rows[n - 1].c;
    const tagList = [{ k: 'NOW', price: lastC, y: Y(lastC) }];
    levels.forEach((L) => tagList.push({ k: L.k, price: L.price, out: !L.in, y: L.in ? Y(L.price) : (L.price > P1 ? padT + 9 : mainB - 9) }));
    const ty = spread(tagList.map((t) => t.y), 20, padT - 4, mainB + 2);
    tagList.forEach((t, i) => { t.ty = ty[i]; });

    let s = head;
    // 枠・目盛り
    s += tag('rect', { x: padL, y: padT, width: pw, height: mainH, fill: 'none', stroke: 'rgba(62,230,255,.16)' });
    s += tag('rect', { x: padL, y: vTop, width: pw, height: volH, fill: 'none', stroke: 'rgba(62,230,255,.12)' });
    const major = niceStep((P1 - P0) / 8, [1, 2, 5, 10]), minor = major / 2;
    const mdec = decOf(minor, 6), Mdec = decOf(major, 4);
    for (let k = Math.ceil(P0 / minor - 1e-9), guard = 0; k * minor <= P1 + 1e-9 && guard < 80; k++, guard++) {
      const p = Number((k * minor).toFixed(mdec));
      const y = Y(p);
      if (y < padT + 1 || y > mainB - 1) continue;
      const isMajor = Math.abs(p / major - Math.round(p / major)) < 1e-6;
      s += tag('line', { x1: padL, x2: ax, y1: y, y2: y, stroke: isMajor ? 'rgba(62,230,255,.085)' : 'rgba(62,230,255,.035)' });
      s += tag('line', { x1: ax, x2: ax + (isMajor ? 5 : 3), y1: y, y2: y, stroke: C.tx3 });
      if (isMajor && tagList.every((t) => Math.abs(t.ty - y) > 16)) s += text(ax + 10, y + 4, fmtP(p), { fill: C.tx2 });
    }
    s += tag('line', { x1: ax, x2: ax, y1: padT, y2: vTop + volH, stroke: 'rgba(62,230,255,.3)' });
    // 月の区切り
    let labEnd = -1e9;
    rows.forEach((r, i) => {
      const m = String(r.d).slice(5, 7), yr = String(r.d).slice(0, 4);
      if (i === 0 || m !== String(rows[i - 1].d).slice(5, 7)) {
        const x = X(i) - st / 2;
        s += tag('line', { x1: x, x2: x, y1: padT, y2: vTop + volH + 4, stroke: 'rgba(62,230,255,.10)', 'stroke-dasharray': '2 4' });
        const first = i === 0 || yr !== String(rows[i - 1].d).slice(0, 4);
        const lab = (first ? yr + '年 ' : '') + +m + '月';
        if (x < ax - 48 && x + 4 > labEnd + 8) { s += text(x + 4, H - 5, lab, { cls: 'st-j', fill: C.tx2 }); labEnd = x + 4 + textW(lab); }
      }
    });
    s += text(ax - 2, H - 5, mmdd(rows[n - 1].d), { anchor: 'end', fill: C.cy2 });
    s += text(padL + 6, vTop + 13, '出来高', { cls: 'st-j', fill: C.tx2 });
    s += text(ax + 10, vTop + 5, fmtVol(VMAX), { fill: C.tx3 });
    s += tag('line', { x1: ax, x2: ax + 5, y1: vTop, y2: vTop, stroke: C.tx3 });
    s += text(ax + 10, padT - 10, '円', { cls: 'st-j', fill: C.tx3 });
    // サポレジ帯
    const bandH = (P1 - P0) * 0.01125;
    levels.forEach((L) => {
      if (!L.in) return;
      const y = Y(L.price);
      s += tag('rect', { x: padL, y: Y(L.price + bandH), width: pw, height: Math.max(1, Y(L.price - bandH) - Y(L.price + bandH)), fill: 'url(#kl-hatch)' });
      s += tag('line', { x1: padL, x2: ax, y1: y, y2: y, stroke: 'rgba(216,231,239,.55)', 'stroke-dasharray': '5 4' });
    });
    tagList.forEach((t) => {
      if (t.k === 'NOW') return;
      const y = t.out ? t.ty : Y(t.price);
      s += tag('path', { d: `M${f(ax + 2)} ${f(y)} L${f(ax + 8)} ${f(t.ty - 9)} H${f(ax + padR - 2)} V${f(t.ty + 9)} H${f(ax + 8)} Z`, fill: '#0b1824', stroke: 'rgba(216,231,239,.6)', class: 'tagbox' });
      s += text(ax + 12, t.ty + 4, `${t.k} ${fmtP(t.price)}${t.out ? (t.price > P1 ? ' ▲' : ' ▼') : ''}`, { fill: C.tx, cls: 'st-t tagtxt' });
    });
    // 出来高
    s += '<g class="a-rv">';
    rows.forEach((r, i) => {
      if (!isNum(r.v) || r.v <= 0) return;
      const y = VY(r.v);
      s += tag('rect', { x: X(i) - bw / 2, y, width: bw, height: vTop + volH - y, fill: r.c >= r.o ? 'rgba(62,230,255,.42)' : 'rgba(255,92,163,.5)' });
    });
    s += '</g><g class="a-rv candles">';
    // ローソク足
    rows.forEach((r, i) => {
      const up = r.c >= r.o, x = X(i), col = up ? C.cy : C.mag;
      s += tag('line', { x1: x, x2: x, y1: Y(r.h), y2: Y(r.l), stroke: col, 'stroke-width': 1 });
      const yt = Y(Math.max(r.o, r.c)), hh = Math.max(1, Math.abs(Y(r.o) - Y(r.c)));
      s += tag('rect', { x: x - bw / 2, y: yt, width: bw, height: hh, fill: up ? 'rgba(62,230,255,.22)' : C.mag, stroke: col, 'stroke-width': 1 });
    });
    s += '</g>';
    const d75 = seriesPath(ma75, X, Y), d25 = seriesPath(ma25, X, Y);
    if (d75) s += tag('path', { d: d75, fill: 'none', stroke: C.amb, 'stroke-width': 1.6, 'stroke-linejoin': 'round', class: 'ma' });
    if (d25) s += tag('path', { d: d25, fill: 'none', stroke: C.w, 'stroke-width': 1.6, 'stroke-linejoin': 'round', filter: 'url(#kl-glow)', class: 'ma' });
    // 現在値
    const lt = tagList[0], lx = X(n - 1), ly = Y(lastC);
    s += tag('line', { x1: lx + 8, x2: ax, y1: ly, y2: ly, stroke: C.cy, 'stroke-dasharray': '2 3', opacity: 0.8 });
    s += tag('path', { d: `M${f(ax + 2)} ${f(ly)} L${f(ax + 8)} ${f(lt.ty - 10)} H${f(ax + padR)} V${f(lt.ty + 10)} H${f(ax + 8)} Z`, fill: C.cy, filter: 'url(#kl-glow)', class: 'tagbox' });
    s += text(ax + 12, lt.ty + 4.5, fmtP(lastC), { fill: C.bg, style: 'font-weight:700', cls: 'st-t tagtxt' });
    s += `<g stroke="${C.cy}" fill="none" stroke-width="1.2">` + tag('circle', { cx: lx, cy: ly, r: 8 }) + tag('circle', { cx: lx, cy: ly, r: 2, fill: C.cy })
      + tag('path', { d: `M${f(lx)} ${f(ly - 14)}v5M${f(lx)} ${f(ly + 9)}v5M${f(lx - 14)} ${f(ly)}h5` }) + '</g>';
    // 注釈ピン：高値系は上・安値系は下を優先し、札がローソク足・他のピン（札と引き出し線）・右端のタグ・現在値の照準に
    // 重ならない一番近い位置を探す（ピンの左右どちらにも置ける）
    const placed = [];
    const hitCandle = (x0, x1, y0, y1) => {
      for (let k = 0; k < n; k++) {
        const cx = X(k);
        if (cx + bw / 2 + 2 < x0 || cx - bw / 2 - 2 > x1) continue;
        if (Y(rows[k].h) - 2 < y1 && Y(rows[k].l) + 2 > y0) return true;
      }
      return false;
    };
    // 札・引き出し線（縦：px で ya→ly、横：ly で hx0→hx1）との交差
    const segHitsBox = (sx0, sy0, sx1, sy1, q) => Math.max(sx0, sx1) >= q.x0 - 3 && Math.min(sx0, sx1) <= q.x1 + 3 && Math.max(sy0, sy1) >= q.y0 - 3 && Math.min(sy0, sy1) <= q.y1 + 3;
    const hitPlaced = (c) => placed.some((q) => {
      if (c.x0 < q.x1 + 4 && c.x1 > q.x0 - 4 && c.y0 < q.y1 + 4 && c.y1 > q.y0 - 4) return true; // 札どうし
      if (segHitsBox(q.px, q.ya, q.px, q.ly, c) || segHitsBox(q.hx0, q.ly, q.hx1, q.ly, c)) return true; // 他の引き出し線が札を横切る
      return segHitsBox(c.px, c.ya, c.px, c.ly, q) || segHitsBox(c.hx0, c.ly, c.hx1, c.ly, q); // 自分の引き出し線が他の札を横切る
    });
    const pinRows = (o.pins || []).filter((p) => p && typeof p.date === 'string' && p.label)
      .map((p) => ({ p, i: rows.findIndex((r) => r.d === p.date) })).filter((x) => x.i >= 0)
      .sort((a, b) => a.i - b.i);
    pinRows.forEach(({ p, i }) => {
      const r = rows[i], x = X(i);
      const low = /安値|底|急落|下落|割れ|安/.test(p.label) && !/高値/.test(p.label);
      const lab = /^\d{1,2}\/\d{1,2}/.test(p.label) ? p.label : md(p.date) + ' ' + p.label;
      const bwid = textW(lab, 12) + 22;
      const ya = Y(low ? r.l : r.h);
      const yTop = padT - 14, yBot = mainB - 12;
      // 候補：上下 × 左右 × 横へのずらし（0〜192px）× 縦の距離。近さ（縦＋横×0.7、逆方向は+40）で一番良いものを選ぶ
      let best = null;
      for (const strict of [true, false]) {
        for (const dir of low ? [1, -1] : [-1, 1]) {
          for (const side of ['L', 'R']) {
            for (let off = 0; off <= 192; off += 24) {
              const bx = side === 'R' ? x + 12 + off : x - 12 - bwid - off;
              if (bx < padL + 2 || bx + bwid > ax - 4) continue;
              for (let d = 22; d < mainH + 40; d += 3) {
                const ly = ya + dir * d;
                if (ly < yTop || ly > yBot) break;
                const c = { x0: bx, x1: bx + bwid, y0: ly - 10, y1: ly + 10, px: x, ya, ly, hx0: Math.min(x, side === 'R' ? bx : bx + bwid), hx1: Math.max(x, side === 'R' ? bx : bx + bwid) };
                if (strict && hitCandle(c.x0, c.x1, c.y0, c.y1)) continue;
                if (hitPlaced(c)) continue;
                if (c.x0 < lx + 16 && c.x1 > lx - 16 && Math.abs(ly - Y(lastC)) < 26) continue; // 現在値の照準
                const score = d + off * 0.7 + (dir === (low ? 1 : -1) ? 0 : 40) + (side === 'L' ? 0 : 6);
                if (!best || score < best.score) best = { score, c, side };
                break;
              }
            }
          }
        }
        if (best) break;
      }
      if (!best) { // 置き場が無い時は従来の位置
        const side = x - 12 - bwid < padL + 2 ? 'R' : 'L', bx = side === 'R' ? x + 12 : x - 12 - bwid, ly = clamp(ya + (low ? 26 : -26), yTop, yBot);
        best = { side, c: { x0: bx, x1: bx + bwid, y0: ly - 10, y1: ly + 10, px: x, ya, ly, hx0: Math.min(x, side === 'R' ? bx : bx + bwid), hx1: Math.max(x, side === 'R' ? bx : bx + bwid) } };
      }
      const { side } = best, ly = best.c.ly, bx = best.c.x0;
      placed.push(best.c);
      s += '<g class="a-fade pin">';
      s += tag('path', { d: `M${f(x)} ${f(ya)} V${f(ly)} H${f(side === 'R' ? bx : bx + bwid)}`, stroke: C.cy2, 'stroke-width': 1, fill: 'none', opacity: 0.85 });
      s += tag('path', { d: `M${f(x)} ${f(ya - 4)} l4 4 -4 4 -4 -4z`, fill: C.bg, stroke: C.cy, 'stroke-width': 1.5 });
      s += tag('path', { d: `M${f(bx + 5)} ${f(ly - 10)} H${f(bx + bwid)} V${f(ly + 10)} H${f(bx)} V${f(ly - 5)} Z`, fill: '#071019', stroke: C.cy, 'stroke-width': 1, class: 'pinbox' });
      s += tag('rect', { x: bx, y: ly - 10, width: 3, height: 20, fill: C.cy });
      s += text(bx + bwid - 9, ly + 4.5, lab, { cls: 'st-j', fill: C.tx, anchor: 'end' });
      s += '</g>';
    });
    return s + '</svg>';
  }

  /* ---------- 小型円弧メーター（viewBox 140×66 固定。両端ラベルは HTML 側） ---------- */
  function meter(v) {
    const t = clamp(isNum(v) ? v : 0, 0.002, 1);
    const cx = 70, cy = 62, r = 46;
    const pt = (u, rr) => [cx - rr * Math.cos(Math.PI * u), cy - rr * Math.sin(Math.PI * u)];
    const arc = (t0, t1, rr) => { const a = pt(t0, rr), b = pt(t1, rr); return `M${f(a[0])} ${f(a[1])} A${rr} ${rr} 0 0 1 ${f(b[0])} ${f(b[1])}`; };
    let s = '<svg viewBox="0 0 140 66" preserveAspectRatio="xMidYMax meet" aria-hidden="true">';
    for (let k = 0; k < 5; k++) s += tag('path', { d: arc(k / 5 + 0.01, (k + 1) / 5 - 0.01, r), stroke: 'rgba(62,230,255,.15)', 'stroke-width': 8, fill: 'none' });
    s += tag('path', { d: arc(0.001, t, r), stroke: C.cy, 'stroke-width': 3.5, fill: 'none', filter: 'url(#mglow)', class: 'mv' });
    for (let k = 0; k <= 10; k++) { const a = pt(k / 10, r + 7), b = pt(k / 10, r + (k % 5 === 0 ? 13 : 10)); s += tag('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: C.tx3, 'stroke-width': 1 }); }
    s += tag('path', { d: arc(0.001, 0.999, r - 12), stroke: 'rgba(62,230,255,.2)', 'stroke-width': 1, fill: 'none', 'stroke-dasharray': '1 4' });
    const tip = pt(t, r + 1), base = pt(t, 14);
    s += `<g class="ndl" data-v="${Math.round(t * 1000) / 1000}">` + tag('line', { x1: base[0], y1: base[1], x2: tip[0], y2: tip[1], stroke: C.wh, 'stroke-width': 1.8 })
      + tag('circle', { cx: tip[0], cy: tip[1], r: 3.4, fill: C.bg, stroke: C.wh, 'stroke-width': 1.8 }) + '</g>';
    s += tag('circle', { cx, cy, r: 4, fill: 'none', stroke: C.cy, 'stroke-width': 1.4 });
    return s + '</svg>';
  }
  /** メーター両端ラベルの x（px）。W=枠の幅、Hs=SVG の高さ */
  function meterLabelX(W, Hs, side) {
    if (!(W > 0) || !(Hs > 0)) return 0;
    const sc = Math.min(W / 140, Hs / 66), off = (W - 140 * sc) / 2;
    return off + (side ? 116 : 24) * sc;
  }

  /* ---------- 乖離率の横バー（±10% スケール。HTML） ---------- */
  function devCell(label, v) {
    const ok = isNum(v);
    const a = ok ? Math.min(Math.abs(v), 10.6) * 4.7 : 0;
    const cls = !ok ? '' : Math.abs(v) >= 10 ? ' hot' : v < 0 ? ' neg' : '';
    const bar = ok && a > 0 ? `<i class="a-gx${cls}" style="${v < 0 ? 'right:50%' : 'left:50%'};width:${f(Math.max(a, 0.4))}%"></i>` : '';
    return `<div class="dv"><div class="dvh"><span>${esc(label)}</span><b class="${cls.trim()}">${ok ? fmtS(v, 2) + '%' : '—'}</b></div>`
      + `<div class="dvt">${bar}</div><div class="dvs"><span>−10%</span><span>${ok ? '0' : '算出不可'}</span><span>+10%</span></div></div>`;
  }

  /* ---------- 基準線つき横ゲージ（割高・割安。HTML） ---------- */
  function gauge(item) {
    const max = isNum(item.max) && item.max > 0 ? item.max : niceCeil(Math.max(item.value || 0, item.ref || 0, 1) * 1.25);
    const tk = niceTicks(0, max, 4, [1, 2, 2.5, 5, 10]).ticks.filter((t) => t <= max + 1e-9);
    const pos = (v) => clamp(v / max * 100, 0, 100);
    const over = isNum(item.value) && item.value > max;
    let g = tk.map((t) => `<span class="tk" style="left:${f(pos(t))}%"></span>`).join('');
    if (isNum(item.ref)) g += `<span class="rf" style="left:${f(pos(item.ref))}%"></span>`;
    if (isNum(item.value)) g += `<span class="gmk a-fade${over ? ' over' : ''}" style="left:${f(pos(item.value))}%"></span>`;
    return `<div class="gtr"><span>0</span><div class="gt">${g}</div><span>${fmt(max, decOf(max, 2))}${over ? '<em class="ov">超</em>' : ''}</span></div>`;
  }

  /* ---------- 立体棒の共通部品（正面・側面・上面の3面＋床） ---------- */
  function bar3d(x0, y, w, base, DX, DY, o) {
    const dash = o.dash || '';
    let s = tag('path', { d: poly([[x0, y], [x0 - DX, y - DY], [x0 - DX, base - DY], [x0, base]]), fill: o.side, stroke: o.edge || 'none', 'stroke-dasharray': dash, 'stroke-width': 0.8 });
    s += tag('path', { d: poly([[x0, y], [x0 + w, y], [x0 + w - DX, y - DY], [x0 - DX, y - DY]]), fill: o.top, stroke: o.edge || 'none', 'stroke-dasharray': dash, 'stroke-width': 0.8 });
    s += tag('rect', { x: x0, y, width: w, height: Math.max(0, base - y), fill: o.front, stroke: o.fedge || 'none', 'stroke-dasharray': o.fdash || '', 'stroke-width': 1 });
    if (o.hi) s += tag('rect', { x: x0, y, width: w, height: 1.6, fill: C.wh, filter: 'url(#mglow)' });
    return s;
  }
  function floor3d(x0, x1, base, DX, DY) {
    let s = tag('path', { d: poly([[x0, base], [x1, base], [x1 - DX, base - DY], [x0 - DX, base - DY]]), fill: 'url(#g3Floor)', stroke: 'rgba(62,230,255,.3)' });
    for (let x = x0 + 14; x < x1 - 4; x += 14) s += tag('line', { x1: x, x2: x - DX, y1: base, y2: base - DY, stroke: 'rgba(62,230,255,.07)' });
    return s;
  }
  /** 浮遊する発光ライン */
  function tube(d, col, dark, w) {
    if (!d) return '';
    return `<g fill="none" stroke-linejoin="round" stroke-linecap="round">`
      + tag('path', { d, stroke: col, 'stroke-width': w * 3.2, opacity: 0.14 })
      + tag('path', { d, stroke: dark, 'stroke-width': w * 1.7 })
      + tag('path', { d, stroke: col, 'stroke-width': w })
      + tag('path', { d, stroke: '#ffffff', 'stroke-width': Math.max(0.6, w * 0.32), opacity: 0.7, transform: 'translate(-.4,-.6)' }) + '</g>';
  }

  /* =====================================================================
     業績推移：立体棒（売上高）＋浮遊する最終利益の線＋転置した数表（1株利益・1株配当）
     rows = [{period, sales, profit, eps, dividend, forecast}]（1〜数期）
     ===================================================================== */
  function perf3d(rowsIn, W, H) {
    W = Math.round(W); H = Math.round(H);
    if (!(W > 120 && H > 120)) return '';
    const rows = (rowsIn || []).filter((r) => r && typeof r === 'object');
    const N = Math.max(1, rows.length);
    const label = '業績推移。' + rows.map((r) => `${r.period}${r.forecast ? '予' : ''} 売上高${fmt(r.sales)}億円 最終利益${fmt(r.profit)}億円`).join('／');
    let s = svgOpen(W, H, label);
    const GUT = 76, RH = 16, AX = 17;
    const DX = Math.round(Math.min(18, Math.max(12, W * 0.034))), DY = Math.round(DX * 0.66);
    const pl = GUT + DX + 2, pr = 4, base = H - 2 - RH * 2 - AX - 3;
    const gw = (W - pl - pr) / N, bwid = Math.min(70, gw * 0.52);
    const sales = rows.map((r) => (isNum(r.sales) && r.sales > 0 ? r.sales : null));
    const profits = rows.map((r) => (isNum(r.profit) ? r.profit : null));
    const smax = Math.max(1, ...sales.filter(isNum));
    const pv = profits.filter(isNum), pmax = pv.length ? Math.max(...pv) : 0, pmin = pv.length ? Math.min(...pv) : 0;
    let H3 = Math.max(10, Math.min(base - DY - 41, (base - 6) * 0.86));
    const layout = (h3) => {
      const RY = (v) => base - v / smax * h3;
      const labTop = (i) => (isNum(sales[i]) ? RY(sales[i]) : base) - DY - 13;
      const p3 = Math.min(...rows.map((_, i) => labTop(i))) - 6;
      let k = Infinity;
      rows.forEach((_, i) => { if (isNum(profits[i]) && profits[i] < pmax) k = Math.min(k, (labTop(i) - 6 - p3) / (pmax - profits[i])); });
      k = isNum(k) ? Math.max(0, k * 0.92) : 0;
      return { RY, labTop, PY: (v) => p3 + (pmax - v) * k, spread: k * (pmax - pmin) };
    };
    let L = layout(H3);
    // 利益の線が平らに潰れる並び（売上の高い期ほど利益が低い等）は、棒を少し縮めて線の帯を確保する
    if (pv.length > 1 && pmax > pmin && L.spread < 6 && H3 > 80) {
      H3 -= 34;
      const RY = (v) => base - v / smax * H3;
      const labTop = (i) => (isNum(sales[i]) ? RY(sales[i]) : base) - DY - 13;
      const top = 22, bandH = Math.max(8, Math.min(28, Math.min(...rows.map((_, i) => labTop(i))) - 6 - top));
      L = { RY, labTop, PY: (v) => top + (pmax - v) / (pmax - pmin) * bandH };
    }
    const anyF = rows.some((r) => r.forecast);
    // 左余白列：凡例
    let ly = 10;
    s += tag('rect', { x: 0, y: ly - 8, width: 10, height: 10, fill: 'rgba(62,230,255,.4)' }) + tag('rect', { x: 0, y: ly - 8, width: 10, height: 2, fill: C.cy }) + text(15, ly + 1.5, '売上高', { cls: 'st-j' }); ly += 18;
    s += tag('line', { x1: 0, x2: 10, y1: ly - 3, y2: ly - 3, stroke: C.w, 'stroke-width': 2 }) + text(15, ly + 1.5, '最終利益', { cls: 'st-j' }); ly += 18;
    if (anyF) { s += tag('rect', { x: 0.5, y: ly - 7.5, width: 10, height: 10, fill: 'url(#fch)', stroke: C.cy, 'stroke-dasharray': '2 2' }) + text(15, ly + 1.5, '予想', { cls: 'st-j' }); ly += 18; }
    s += text(0, ly + 1.5, '単位 億円', { cls: 'st-j', fill: C.tx3 });
    // 奥の壁の目盛＋床
    [0.25, 0.5, 0.75, 1].forEach((q) => { const y = base - H3 * q; s += tag('line', { x1: pl - DX, x2: W - pr - DX, y1: y - DY, y2: y - DY, stroke: 'rgba(62,230,255,.06)' }); });
    s += tag('line', { x1: pl - DX, x2: pl - DX, y1: base - H3 - DY, y2: base - DY, stroke: 'rgba(62,230,255,.14)' });
    s += floor3d(pl, W - pr, base, DX, DY);
    const pts = [];
    rows.forEach((r, i) => {
      const cx = pl + gw * (i + 0.5), x0 = cx - bwid / 2, fc = !!r.forecast, mx = cx - DX / 2;
      if (isNum(sales[i])) {
        const y = L.RY(sales[i]);
        s += tag('ellipse', { cx: cx - DX / 2, cy: base - DY / 2 + 1, rx: bwid * 0.62 + DX / 2, ry: DY * 0.55 + 2, fill: 'url(#g3Pool)', opacity: fc ? 0.5 : 0.9 });
        s += `<g class="a-grow" style="animation-delay:${f(i * 0.12)}s">` + bar3d(x0, y, bwid, base, DX, DY, fc
          ? { front: 'url(#fch)', side: 'rgba(62,230,255,.08)', top: 'rgba(62,230,255,.18)', edge: C.cy, dash: '3 3', fedge: C.cy, fdash: '4 3' }
          : { front: 'url(#g3BarF)', side: 'url(#g3BarL)', top: 'rgba(166,243,255,.82)', fedge: 'rgba(62,230,255,.55)', hi: true }) + '</g>';
        s += text(mx, y - DY - 4, fmt(sales[i]), { anchor: 'middle', fill: fc ? C.cy2 : C.tx });
      } else {
        s += text(mx, base - DY - 4, '売上 未取得', { cls: 'st-j', anchor: 'middle', fill: C.tx3 });
      }
      if (isNum(profits[i])) pts.push([mx, L.PY(profits[i]), profits[i]]);
      s += text(cx, base + AX - 3, r.period + (fc ? '予' : ''), { anchor: 'middle', fill: fc ? C.cy2 : C.tx2 });
    });
    if (pts.length > 1) s += `<g class="a-rv" style="animation-delay:.5s">` + tube(pathD(pts), C.w, '#5d7686', 1.6) + '</g>';
    pts.forEach((p) => {
      const lab = fmt(p[2]), w = textW(lab, 12, true) + 10;
      s += tag('circle', { cx: p[0], cy: p[1], r: 3.6, fill: 'url(#g3OrbW)', filter: 'url(#mglow)' });
      s += tag('rect', { x: p[0] - w / 2, y: p[1] - 20, width: w, height: 15, fill: 'rgba(6,14,22,.95)', stroke: 'rgba(244,251,255,.55)' });
      s += text(p[0], p[1] - 8.5, lab, { anchor: 'middle', fill: p[2] < 0 ? C.mag : C.w });
    });
    // 転置した数表
    s += text(0, base + AX - 3, '決算期', { cls: 'st-j', fill: C.tx3 });
    const t0 = base + AX;
    s += tag('line', { x1: 0, x2: W, y1: t0 + 0.5, y2: t0 + 0.5, stroke: 'rgba(62,230,255,.14)' });
    const cellOf = (v) => (isNum(v) ? fmt(v, decOf(v, 2)) : typeof v === 'string' && v ? v : '—');
    [['1株利益(円)', rows.map((r) => cellOf(r.eps))], ['1株配当(円)', rows.map((r) => cellOf(r.dividend))]].forEach(([lab, vals], j) => {
      const yb = t0 + RH * (j + 1) - 4.5;
      if (j) s += tag('line', { x1: 0, x2: W, y1: t0 + RH + 0.5, y2: t0 + RH + 0.5, stroke: 'rgba(62,230,255,.07)' });
      s += text(0, yb, lab, { cls: 'st-j' });
      vals.forEach((v, i) => {
        const cx = pl + gw * (i + 0.5), jp = /[^\d.,−\-]/.test(v) && v !== '—';
        const tw = textW(v, 12, !jp);
        const fill = rows[i].forecast ? C.cy2 : v === '—' ? C.tx3 : C.tx;
        if (cx + tw / 2 > W - 1) s += text(W - 1, yb, v, { cls: jp ? 'st-j' : 'st-t', anchor: 'end', fill });
        else s += text(cx, yb, v, { cls: jp ? 'st-j' : 'st-t', anchor: 'middle', fill });
      });
    });
    return s + '</svg>';
  }

  /* =====================================================================
     需給：買い残・売り残の立体棒＋信用倍率の発光ライン
     rows = [{date, sell, buy, ratio}]（古い順）
     ===================================================================== */
  function supply3d(rowsIn, W, H) {
    W = Math.round(W); H = Math.round(H);
    if (!(W > 80 && H > 50)) return '';
    const rows = (rowsIn || []).filter((r) => r && typeof r === 'object');
    let s = svgOpen(W, H, '信用残と信用倍率の推移');
    const N = Math.max(1, rows.length);
    const vals = [];
    rows.forEach((r) => { if (isNum(r.buy)) vals.push(r.buy); if (isNum(r.sell)) vals.push(r.sell); });
    const vmax = vals.length ? Math.max(...vals, 0) : 0;
    const DX = 6, DY = 4.2, pt = 6 + DY, pb = 4, base = H - pb, ch = base - pt, pr = 4;
    const pl = Math.max(40, Math.ceil(textW(fmt(vmax), 12, true)) + 10) + DX;
    const gw = (W - pl - pr) / N, bw = Math.min(15, gw * 0.26);
    const BMAX = vmax > 0 ? vmax / 0.455 : 1;
    const BY = (v) => base - Math.max(0, v) / BMAX * ch;
    // 買い残と売り残の差が大きくても、0でない棒は最低3pxの高さで見せる
    const barY = (v) => (v > 0 ? Math.min(BY(v), base - 3) : base);
    const step = niceStep((vmax || 1) / 2.2, [1, 2, 2.5, 5, 10]);
    const ticks = [];
    for (let v = 0, k = 0; v <= Math.max(vmax * 1.15, 0) + 1e-9 && k < 6; k++, v = k * step) ticks.push(Number(v.toFixed(decOf(step, 4))));
    const bandTop = pt + 16, bandBot = Math.max(bandTop + 6, BY(vmax) - DY - 8);
    const rv = rows.map((r) => r.ratio).filter(isNum);
    let rlo = rv.length ? Math.min(...rv) : 0, rhi = rv.length ? Math.max(...rv) : 1;
    const rpad = (rhi - rlo) * 0.1 || Math.max(rhi * 0.1, 0.5);
    rhi += rpad; rlo = Math.max(0, rlo - rpad);
    const RY = (v) => bandTop + (rhi - v) / (rhi - rlo || 1) * (bandBot - bandTop);
    ticks.forEach((v) => {
      if (v > 0) s += tag('line', { x1: pl - DX, x2: W - pr - DX, y1: BY(v) - DY, y2: BY(v) - DY, stroke: 'rgba(62,230,255,.07)' });
      s += text(pl - DX - 6, BY(v) - DY * 0.5 + 4, v ? fmt(v, decOf(v, 2)) : '0', { anchor: 'end', fill: C.tx3 });
    });
    s += floor3d(pl, W - pr, base, DX, DY);
    const pts = [], obst = [];
    rows.forEach((r, i) => {
      const cx = pl + gw * (i + 0.5), last = i === rows.length - 1;
      if (isNum(r.sell)) obst.push([cx + 2 - DX, barY(r.sell) - DY, cx + 2 + bw, base]);
      if (isNum(r.buy)) obst.push([cx - bw - 2 - DX, barY(r.buy) - DY, cx - 2, base]);
      s += `<g class="a-grow bars" style="animation-delay:${f(i * 0.08)}s">`;
      if (isNum(r.sell)) s += bar3d(cx + 2, barY(r.sell), bw, base, DX, DY, { front: 'url(#kl-sh)', side: 'rgba(90,110,122,.6)', top: 'rgba(200,215,225,.55)', fedge: 'rgba(157,179,194,.5)' });
      if (isNum(r.buy)) s += bar3d(cx - bw - 2, barY(r.buy), bw, base, DX, DY, { front: last ? 'rgba(62,230,255,.8)' : 'rgba(62,230,255,.5)', side: last ? 'rgba(30,140,168,.9)' : 'rgba(28,120,145,.75)', top: 'rgba(166,243,255,.85)' });
      s += '</g>';
      if (isNum(r.ratio)) pts.push([cx - DX * 0.5, RY(r.ratio), r.ratio, last]);
    });
    if (pts.length > 1) s += `<g class="a-rv rline" style="animation-delay:.5s">` + tube(pathD(pts), C.w, '#5d7686', 1.4) + '</g>';
    // 倍率ラベル：上を優先し、線・棒・他のラベル・枠にかかるなら下、左右へずらす
    const segHit = (b) => pts.some((p, k) => {
      if (!k) return false;
      const q = pts[k - 1], len = Math.hypot(p[0] - q[0], p[1] - q[1]);
      for (let t = 0; t <= len; t += 2) {
        const x = q[0] + (p[0] - q[0]) * t / len, y = q[1] + (p[1] - q[1]) * t / len;
        if (x > b[0] - 1 && x < b[2] + 1 && y > b[1] - 1 && y < b[3] + 1) return true;
      }
      return false;
    });
    const labs = [];
    pts.forEach((p) => {
      const last = p[3];
      s += tag('rect', { x: p[0] - 3.5, y: p[1] - 3.5, width: 7, height: 7, fill: last ? C.cy : '#0b1824', stroke: last ? C.wh : C.w, 'stroke-width': 1.4, transform: `rotate(45 ${f(p[0])} ${f(p[1])})`, filter: last ? 'url(#mglow)' : '' });
    });
    pts.forEach((p) => {
      const last = p[3], str = fmt(p[2], 2), w = textW(str, 12, true);
      const cands = [[0, -8], [0, 19], [w / 2 + 7, -6], [-(w / 2 + 7), -6], [w / 2 + 7, 10], [-(w / 2 + 7), 10], [0, -20]];
      let pick = cands[0];
      for (const c of cands) {
        const bx = [p[0] + c[0] - w / 2 - 1, p[1] + c[1] - 12, p[0] + c[0] + w / 2 + 1, p[1] + c[1] + 4]; // 字形の上下（約16px）を見込む
        if (bx[0] < pl - DX || bx[2] > W - 1 || bx[1] < 0 || bx[3] > base) continue;
        if (obst.some((o) => bx[0] < o[2] && bx[2] > o[0] && bx[1] < o[3] && bx[3] > o[1])) continue;
        if (labs.some((o) => bx[0] < o[2] + 2 && bx[2] > o[0] - 2 && bx[1] < o[3] && bx[3] > o[1])) continue;
        if (segHit(bx)) continue;
        pick = c; labs.push(bx); break;
      }
      s += text(p[0] + pick[0], p[1] + pick[1], str, { anchor: 'middle', fill: last ? C.cy : C.tx, cls: 'st-t rlab' });
    });
    s += text(pl - DX - 6, pt + 8, '倍率', { cls: 'st-j', anchor: 'end', fill: C.tx3 });
    return s + '</svg>';
  }

  /* =====================================================================
     シナリオの扇：直近20日の終値 → 現在値から強気・中立・弱気の3方向
     o = {hist:[終値], now, bull:{price}, base:{price|low,high}, bear:{price}, dec, W, H}
     ===================================================================== */
  function fan(o) {
    const W = Math.round(o.W), H = Math.round(o.H);
    if (!(W > 100 && H > 70)) return '';
    const now = isNum(o.now) ? o.now : null;
    let s = svgOpen(W, H, '現在値から3方向に分かれるシナリオ図');
    if (now == null) return s + text(W / 2, H / 2, '基準価格が未取得', { cls: 'st-j', anchor: 'middle' }) + '</svg>';
    const dec = isNum(o.dec) ? o.dec : decOf(now, 2);
    const hist = (o.hist || []).filter(isNum);
    const bullP = o.bull ? (isNum(o.bull.price) ? o.bull.price : isNum(o.bull.high) ? o.bull.high : null) : null;
    const bearP = o.bear ? (isNum(o.bear.price) ? o.bear.price : isNum(o.bear.low) ? o.bear.low : null) : null;
    const bLo = o.base && isNum(o.base.low) ? o.base.low : null, bHi = o.base && isNum(o.base.high) ? o.base.high : null;
    const baseP = o.base && isNum(o.base.price) ? o.base.price : null;
    const all = [now, ...hist, bullP, bearP, bLo, bHi, baseP].filter(isNum);
    let lo = Math.min(...all), hi = Math.max(...all);
    const sp = hi - lo || Math.abs(now) * 0.05 || 1;
    const pl = Math.max(44, Math.round(Math.max(...[now, bullP, bearP, bLo, bHi, baseP].filter(isNum).map((v) => textW(fmtP(v), 12, true))) + 10)), pr = 6, pt = 12, pb = 20;
    const P1 = hi + sp * 0.12, P0 = lo - sp * 0.08;
    const Y = (p) => pt + (P1 - p) / (P1 - P0 || 1) * (H - pt - pb);
    const nowX = pl + (W - pl - pr) * 0.4, endX = W - pr - 2;
    s += tag('rect', { x: pl, y: pt, width: W - pl - pr, height: H - pt - pb, fill: 'none', stroke: 'rgba(62,230,255,.12)' });
    // 価格の目盛り（目安の価格と現在値）。重なりは押し広げる
    const marks = [];
    const addM = (p, isNow) => { if (isNum(p) && !marks.some((m) => Math.abs(m.p - p) < 1e-9)) marks.push({ p, isNow }); };
    addM(now, true); [bullP, bHi, baseP, bLo, bearP].forEach((p) => addM(p, false));
    const my = spread(marks.map((m) => Y(m.p) + 4), 13, pt + 9, H - pb + 2);
    marks.forEach((m, i) => {
      s += tag('line', { x1: pl, x2: endX, y1: Y(m.p), y2: Y(m.p), stroke: m.isNow ? 'rgba(62,230,255,.35)' : 'rgba(62,230,255,.12)', 'stroke-dasharray': '2 4' });
      s += text(pl - 5, my[i], fmtP(m.p), { anchor: 'end', fill: m.isNow ? C.cy : C.tx2 });
    });
    if (isNum(bLo) && isNum(bHi)) s += tag('rect', { x: nowX, y: Y(Math.max(bLo, bHi)), width: endX - nowX, height: Math.abs(Y(bLo) - Y(bHi)), fill: 'rgba(216,231,239,.035)' });
    const nowY = Y(now), plotH = H - pt - pb;
    const upY = isNum(bullP) ? Y(bullP) : nowY - plotH * 0.3;
    const dnY = isNum(bearP) ? Y(bearP) : nowY + plotH * 0.3;
    const topY = Math.min(upY, dnY), botY = Math.max(upY, dnY);
    s += tag('path', { d: `M${f(nowX)} ${f(nowY)} L${f(endX)} ${f(topY - 4)} L${f(endX)} ${f(Math.min(H - pb, botY + 14))} Z`, fill: 'url(#fanG)', class: 'a-fade' });
    if (hist.length > 1) {
      const HX = (i) => pl + (nowX - pl) * (i / (hist.length - 1));
      s += tag('path', { d: pathD(hist.map((v, i) => [HX(i), Y(v)])), fill: 'none', stroke: C.tx2, 'stroke-width': 1.3 });
      s += text(pl + 4, pt + 13, `直近${hist.length}日`, { cls: 'st-j', fill: C.tx3 });
    }
    const midY = isNum(baseP) ? Y(baseP) : nowY;
    const ends = { bull: upY - 3, base: midY, bear: dnY + 10 };
    const rays = [
      [`M${f(nowX)} ${f(nowY)} C${f(nowX + 40)} ${f(nowY - 5)}, ${f(endX - 50)} ${f(ends.bull + 11)}, ${f(endX - 5)} ${f(ends.bull)}`, C.cy, 'arU', ''],
      [`M${f(nowX)} ${f(nowY)} L${f(endX - 5)} ${f(ends.base)}`, C.mid, 'arN', '6 4'],
      [`M${f(nowX)} ${f(nowY)} C${f(nowX + 40)} ${f(nowY + 5)}, ${f(endX - 56)} ${f(ends.bear - 22)}, ${f(endX - 5)} ${f(ends.bear)}`, C.mag, 'arD', ''],
    ];
    rays.forEach(([d, col, m, dash], k) => {
      s += tag('path', { d, fill: 'none', stroke: col, 'stroke-width': 2, 'marker-end': `url(#${m})`, 'stroke-dasharray': dash, class: k === 1 ? '' : 'ray', style: k === 1 ? '' : `animation-delay:${0.4 + k * 0.15}s` });
    });
    const ly = spread([ends.bull - 5, ends.base - 6, ends.bear + 16], 14, pt + 10, H - pb - 2);
    s += text(endX - 6, ly[0], '強気', { cls: 'st-j', anchor: 'end', fill: C.cy, style: 'font-weight:700' });
    s += text(endX - 6, ly[1], '中立', { cls: 'st-j', anchor: 'end', fill: C.mid, style: 'font-weight:700' });
    s += text(endX - 6, ly[2], '弱気', { cls: 'st-j', anchor: 'end', fill: C.mag, style: 'font-weight:700' });
    s += `<g fill="none" stroke="${C.cy}" stroke-width="1.2">` + tag('circle', { cx: nowX, cy: nowY, r: 8 }) + tag('circle', { cx: nowX, cy: nowY, r: 2.5, fill: C.cy })
      + tag('path', { d: `M${f(nowX)} ${f(nowY - 14)}v5M${f(nowX)} ${f(nowY + 9)}v5` }) + '</g>';
    if (nowY + 14 < H - pb) s += tag('line', { x1: nowX, x2: nowX, y1: nowY + 14, y2: H - pb, stroke: 'rgba(62,230,255,.4)', 'stroke-dasharray': '2 3' });
    s += text(nowX, H - 5, 'NOW', { anchor: 'middle', fill: C.cy, style: 'font-family:Orbitron,sans-serif;font-weight:700;letter-spacing:.12em' });
    return s + '</svg>';
  }

  /* ---------- 小型ドーナツ（事業別の利益の構成。正の値のみ） ---------- */
  function donut(items, opt = {}) {
    const vals = (items || []).map((x, i) => (x ? { ...x, i } : null)).filter((x) => x && isNum(x.v) && x.v > 0);
    const tot = vals.reduce((a, b) => a + b.v, 0);
    const cx = 32, cy = 32, r = 23, sw = 9;
    let s = `<svg viewBox="0 0 64 64" role="img" aria-label="事業別の利益の構成"${opt.cls ? ` class="${opt.cls}"` : ''}>`;
    s += tag('circle', { cx, cy, r: r + 8, fill: 'none', stroke: 'rgba(62,230,255,.3)', 'stroke-dasharray': '1 4' });
    s += tag('circle', { cx, cy, r: r - 8, fill: 'none', stroke: 'rgba(62,230,255,.15)' });
    if (!(tot > 0)) s += tag('circle', { cx, cy, r, fill: 'none', stroke: 'rgba(62,230,255,.12)', 'stroke-width': sw });
    else if (vals.length === 1) s += tag('circle', { cx, cy, r, fill: 'none', stroke: vals[0].color || C.cy, 'stroke-width': sw, class: 'arc', 'data-i': vals[0].i });
    else {
      let a = -Math.PI / 2;
      const gapA = 0.03;
      vals.forEach((x, i) => {
        const da = x.v / tot * Math.PI * 2;
        const a0 = a + Math.min(gapA, da / 4), a1 = a + da - Math.min(gapA, da / 4);
        const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)], p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
        s += tag('path', { d: `M${f(p0[0])} ${f(p0[1])} A${r} ${r} 0 ${da > Math.PI ? 1 : 0} 1 ${f(p1[0])} ${f(p1[1])}`, fill: 'none', stroke: x.color || SEG_COLORS[i % SEG_COLORS.length], 'stroke-width': sw, class: 'arc', 'data-i': x.i, style: `animation-delay:${f(i * 0.15)}s` });
        a += da;
      });
    }
    s += tag('circle', { cx, cy, r: 2.2, fill: C.cy });
    return s + '</svg>';
  }

  /* ---------- ミニ折れ線（ホームの推移 40日） ---------- */
  function spark(valsIn, up) {
    const vals = (valsIn || []).filter(isNum);
    const col = up ? C.cy : C.mag;
    let s = '<svg class="h-sp" viewBox="0 0 200 46" aria-hidden="true">';
    if (vals.length < 2) return s + tag('line', { x1: 0, x2: 200, y1: 45.5, y2: 45.5, stroke: 'rgba(62,230,255,.2)' }) + text(100, 28, 'データなし', { cls: 'st-j', anchor: 'middle', fill: C.tx3 }) + '</svg>';
    const n = vals.length, mn = Math.min(...vals), mx = Math.max(...vals);
    const X = (i) => 2 + i / (n - 1) * 188;
    const Y = (v) => (mx > mn ? 40 - (v - mn) / (mx - mn) * 34 : 23);
    const d = pathD(vals.map((v, i) => [X(i), Y(v)]));
    const ex = X(n - 1), ey = Y(vals[n - 1]);
    s += tag('line', { x1: 0, x2: 200, y1: Y(vals[0]), y2: Y(vals[0]), stroke: 'rgba(127,151,168,.4)', 'stroke-dasharray': '2 3' });
    s += tag('path', { d: `${d} L${f(ex)} 46 L2 46Z`, fill: up ? 'rgba(62,230,255,.08)' : 'rgba(255,92,163,.08)' });
    s += tag('path', { d, fill: 'none', stroke: col, 'stroke-width': 1.6 });
    s += tag('circle', { cx: ex, cy: ey, r: 5, fill: 'none', stroke: col, 'stroke-width': 1 }) + tag('circle', { cx: ex, cy: ey, r: 1.8, fill: col });
    s += tag('line', { x1: 0, x2: 200, y1: 45.5, y2: 45.5, stroke: 'rgba(62,230,255,.2)' });
    return s + '</svg>';
  }

  /* ---------- チェックリスト（セルと集計バー。HTML） ---------- */
  const CK = { done: ['d', '完成済み'], progress: ['p', '進行中'], none: ['x', 'なし'] };
  function checklist(items) {
    const cnt = { d: 0, p: 0, x: 0, u: 0 };
    const cells = (items || []).map((it, i) => {
      const st = CK[it && it.status];
      const k = st ? st[0] : 'u';
      cnt[k]++;
      const id = it && it.id ? String(it.id).replace(/^C/, 'C-') : 'C-' + String(i + 1).padStart(2, '0');
      const icon = st ? `<svg><use href="#st-${k}"/></svg>` : '';
      return `<button type="button" class="ck ${k}" data-ck="${esc(it && it.id ? it.id : '')}" data-i="${i}" aria-pressed="false" aria-label="${esc(id)} ${esc(it && it.name ? it.name : '')} ${st ? st[1] : '未取得'}。押すと理由を表示"><span class="n"><span>${esc(id)}</span>${icon}</span><p>${esc(it && it.name ? it.name : '（名称未定義）')}</p><span class="s">${st ? st[1] : '未取得'}</span></button>`;
    });
    const bar = (items || []).map((it) => { const st = CK[it && it.status]; return `<i class="${st ? st[0] : 'u'}"></i>`; }).join('');
    const sum = `<div class="ck-bar" aria-hidden="true">${bar}</div><div class="ck-cnt"><span class="d"><svg><use href="#st-d"/></svg>完成済み<b>${cnt.d}</b></span><span><svg><use href="#st-p"/></svg>進行中<b>${cnt.p}</b></span><span><svg><use href="#st-x"/></svg>なし<b>${cnt.x}</b></span></div>`;
    return { summary: sum, cells: cells.join(''), count: cnt };
  }

  /** チェックリストの理由欄。sel=選んだ id（無ければ既定：進行中すべて、0件なら完成済みを後ろの項目から2件） */
  function ckReasons(items, sel) {
    const list = (items || []).filter((x) => x && x.id);
    let show, head;
    const one = sel ? list.find((x) => x.id === sel) : null;
    if (one) { show = [one]; head = '選んだ項目の理由'; }
    else {
      show = list.filter((x) => x.status === 'progress');
      head = '進行中の項目の理由';
      if (!show.length) { show = list.filter((x) => x.status === 'done').slice(-2).reverse(); head = '完成済みの項目の理由'; }
    }
    const body = show.map((x) => {
      const st = CK[x.status];
      return `<div class="cw ${st ? st[0] : 'u'}" data-why="${esc(x.id)}"><span class="cid">${esc(String(x.id).replace(/^C/, 'C-'))}</span><b>${esc(x.name || '')}</b><span class="cs">${st ? st[1] : '未取得'}</span><p>${esc(x.reason || '理由の記載がありません')}</p></div>`;
    }).join('');
    return `<div class="cwh"><span>${head}</span><span class="cap">セルを押す（矢印キーで移動）と、その項目の理由を表示</span></div>${body || '<p class="cwn">表示できる理由がありません</p>'}`;
  }

  /* =====================================================================
     稼ぎ頭マップ：事業の並べ替え・折りたたみ（上位3＋その他）・展開時の全事業一覧
     ===================================================================== */
  function noteSign(note) {
    if (typeof note !== 'string') return '';
    if (/[+＋]\s*\d/.test(note)) return 'up';
    if (/[−\-－]\s*\d/.test(note)) return 'dn';
    return '';
  }
  function segModel(segsIn) {
    const list = (segsIn || []).filter((x) => x && typeof x.name === 'string' && x.name)
      .map((x) => ({ name: x.name, profit: isNum(x.profit) ? x.profit : null, margin: isNum(x.margin) ? x.margin : null, note: typeof x.note === 'string' ? x.note : '' }))
      .sort((a, b) => (b.profit == null ? -Infinity : b.profit) - (a.profit == null ? -Infinity : a.profit));
    const total = list.reduce((t, x) => t + (x.profit == null ? 0 : x.profit), 0);
    const maxP = Math.max(0, ...list.map((x) => (x.profit == null ? 0 : x.profit)));
    const hasMargin = list.some((x) => x.margin != null);
    const maxM = Math.max(20, ...list.map((x) => (x.margin != null ? Math.ceil(x.margin / 5) * 5 : 0)));
    const all = list.slice(0, 8).map((x, i) => ({
      ...x, rank: i + 1, color: SEG_COLORS[i % SEG_COLORS.length], sign: noteSign(x.note),
      barW: x.profit != null && x.profit > 0 && maxP > 0 ? x.profit / maxP * 100 : 0,
      marginW: x.margin != null && x.margin > 0 ? clamp(x.margin / maxM * 100, 0, 100) : 0,
      share: x.profit != null && x.profit > 0 && total > 0 ? x.profit / total * 100 : null,
    }));
    const expandable = list.length >= 5;
    let collapsed = all.slice(0, 4);
    if (expandable) {
      const rest = list.slice(3);
      collapsed = [...all.slice(0, 3), { name: `その他 ${rest.length}事業`, profit: rest.reduce((t, x) => t + (x.profit == null ? 0 : x.profit), 0), margin: null, note: '', other: true, count: rest.length, color: '#47606f' }];
    }
    return { all, total, maxP, hasMargin, maxM, expandable, collapsed, count: list.length };
  }
  /** 展開時の全事業一覧（ol の中身）。行：順位・色・事業名・note・利益額・利益の横棒・利益率（あれば） */
  function segListHtml(m) {
    return m.all.map((x, i) => `<li class="sp-r" data-i="${i}" style="--k:${x.color}"><span class="rk">${String(x.rank).padStart(2, '0')}</span><i class="ch"></i>`
      + `<span class="nm"><b>${esc(x.name)}</b>${x.note ? `<em class="nt ${x.sign}">${esc(x.note)}</em>` : ''}</span>`
      + `<span class="pf${x.profit != null && x.profit < 0 ? ' dn' : ''}">${fmt(x.profit)}<small>億円</small>${x.share != null ? `<em>${fmt(x.share, 0)}%</em>` : ''}</span>`
      + `<span class="br"><u style="width:${f(x.barW)}%"></u></span>`
      + (m.hasMargin ? `<span class="mg">${x.margin != null ? `<span class="tr"><u style="width:${f(x.marginW)}%"></u></span><b>${fmt(x.margin, 1)}%</b>` : '<b class="na">—</b>'}</span>` : '')
      + '</li>').join('');
  }

  /* ---------- ★5段階とセグメントバー（地政学など。HTML） ---------- */
  function stars(level, max = 5) {
    const lv = clamp(Math.round(isNum(level) ? level : 0), 0, max);
    return `<span class="lvl" aria-label="影響度 ${max}段階中${lv}"><b>${'★'.repeat(lv)}</b>${'☆'.repeat(max - lv)}</span>`;
  }
  function segs(level, max = 5) {
    const lv = clamp(Math.round(isNum(level) ? level : 0), 0, max);
    let s = '<span class="segs">';
    for (let k = 1; k <= max; k++) s += `<i class="${k <= lv ? 'on' : ''}"></i>`;
    return s + '</span>';
  }


  /* =====================================================================
     P2b：チャート型・決算型の図
     ===================================================================== */

  /* ---------- 3つの時間軸の小チャート（月足・週足・日足） ----------
     o = {bars:[{d,o,h,l,c,v}], ma:[]（bars と同じ長さ・任意）, W, H, label}
     高値・安値に値の札を付ける。期間の文字は HTML 側（キャプション）に出す。 */
  function miniCandles(o) {
    const W = Math.round(o.W), H = Math.round(o.H);
    if (!(W > 60 && H > 50)) return '';
    const all = o.bars || [];
    const idx = [];
    all.forEach((r, i) => { if (validBar(r)) idx.push(i); });
    const rows = idx.map((i) => all[i]);
    const ma = Array.isArray(o.ma) ? idx.map((i) => (isNum(o.ma[i]) ? o.ma[i] : null)) : [];
    let s = svgOpen(W, H, o.label || 'ローソク足');
    if (!rows.length) return s + text(W / 2, H / 2 + 4, o.empty || '足のデータがありません', { cls: 'st-j', anchor: 'middle', fill: C.tx3 }) + '</svg>';
    const n = rows.length, padL = 2, padR = 10, padT = 17, padB = 17;
    let lo = Infinity, hi = -Infinity, iHi = 0, iLo = 0;
    rows.forEach((r, i) => { if (r.h > hi) { hi = r.h; iHi = i; } if (r.l < lo) { lo = r.l; iLo = i; } });
    let plo = lo, phi = hi;
    ma.forEach((v) => { if (isNum(v)) { plo = Math.min(plo, v); phi = Math.max(phi, v); } });
    const sp = phi - plo || Math.abs(phi) * 0.05 || 1;
    const P1 = phi + sp * 0.04, P0 = plo - sp * 0.04;
    const ph = H - padT - padB;
    const Y = (p) => padT + (P1 - p) / (P1 - P0 || 1) * ph;
    const st = (W - padL - padR) / n, bw = clamp(st * 0.62, 1, 9);
    const X = (i) => padL + st * (i + 0.5);
    s += tag('rect', { x: padL, y: padT, width: W - padL - padR, height: ph, fill: 'none', stroke: 'rgba(62,230,255,.12)' });
    [0.25, 0.5, 0.75].forEach((q) => { const y = padT + ph * q; s += tag('line', { x1: padL, x2: W - padR, y1: y, y2: y, stroke: 'rgba(62,230,255,.05)' }); });
    s += '<g class="cdl">';
    rows.forEach((r, i) => {
      const up = r.c >= r.o, x = X(i), col = up ? C.cy : C.mag;
      s += tag('line', { x1: x, x2: x, y1: Y(r.h), y2: Y(r.l), stroke: col, 'stroke-width': 1 });
      s += tag('rect', { x: x - bw / 2, y: Y(Math.max(r.o, r.c)), width: bw, height: Math.max(1, Math.abs(Y(r.o) - Y(r.c))), fill: up ? 'rgba(62,230,255,.22)' : C.mag, stroke: col, 'stroke-width': 1 });
    });
    s += '</g>';
    const dm = seriesPath(ma, X, Y);
    if (dm) s += tag('path', { d: dm, fill: 'none', stroke: C.w, 'stroke-width': 1.3, opacity: 0.85, class: 'ma' });
    // 高値・安値の札（枠の中に収める）
    const lab = (i, v, top) => {
      const str = (top ? '高 ' : '安 ') + fmtP(v), tw = textW(str, 12, true) + 2;
      const x = clamp(X(i), padL + tw / 2 + 1, W - padR - tw / 2);
      const y = top ? Y(v) - 5 : Y(v) + 14;
      return tag('circle', { cx: X(i), cy: Y(v), r: 2.2, fill: top ? C.cy : C.mag }) + text(x, y, str, { anchor: 'middle', fill: C.tx, cls: 'st-t mlab' });
    };
    s += lab(iHi, hi, true) + lab(iLo, lo, false);
    // 最新の終値
    const lc = rows[n - 1].c;
    s += tag('line', { x1: X(n - 1), x2: W - 2, y1: Y(lc), y2: Y(lc), stroke: C.cy, 'stroke-dasharray': '2 2', opacity: 0.8 });
    s += tag('circle', { cx: X(n - 1), cy: Y(lc), r: 3, fill: 'none', stroke: C.cy, 'stroke-width': 1.2 });
    return s + '</svg>';
  }

  /* ---------- 価格帯別出来高の横棒（価格軸をチャートと共有） ----------
     bins=[{from,to,volume,share}]、P0〜P1 を top〜top+h に写す（チャートの Y と同じ式）。範囲外の帯は除き、はみ出す帯は切る */
  function vpLayout(bins, P0, P1, top, h) {
    const Y = (p) => top + (P1 - p) / (P1 - P0 || 1) * h;
    const vis = (bins || []).filter((b) => b && isNum(b.from) && isNum(b.to) && isNum(b.volume) && b.volume >= 0 && b.to > P0 && b.from < P1);
    const vmax = Math.max(0, ...vis.map((b) => b.volume));
    return vis.map((b) => {
      const a = Math.max(b.from, P0), z = Math.min(b.to, P1);
      return { from: b.from, to: b.to, volume: b.volume, share: isNum(b.share) ? b.share : null, y0: Y(z), y1: Y(a), w: vmax > 0 ? b.volume / vmax : 0, max: vmax > 0 && b.volume === vmax };
    });
  }

  /* =====================================================================
     チャート型のメインチャート：日足ローソク＋出来高＋25/75/200日線＋サポレジ（帯・線）＋右端の価格タグ＋価格帯別出来高
     o = {rows, ma:{ma25:[],ma75:[],ma200:[]}（rows と同じ長さ）, levels:[{i,kind,low,high,strength}], vp:{bins}, dec, W, H, label}
     各レベルは <g class="lvg" data-lv="i"> にまとめ、画面側で強調（.lvchart.hl .lvg.on）する
     ===================================================================== */
  const MA_STYLE = { ma25: [C.w, 1.6, '', 'url(#kl-glow)'], ma75: [C.amb, 1.6, '', ''], ma200: ['#9db3c2', 1.5, '7 3', ''] };
  function levelTag(L) { return (L.kind === 'R' ? 'RES ' : 'SUP ') + (L.lo === L.hi ? fmtP(L.lo) : fmtP(L.lo) + '–' + fmtP(L.hi)); }
  function levelChart(o) {
    const W = Math.round(o.W), H = Math.round(o.H);
    if (!(W > 200 && H > 160)) return '';
    const all = o.rows || [];
    const idx = [];
    all.forEach((r, i) => { if (validBar(r)) idx.push(i); });
    const rows = idx.map((i) => all[i]);
    const head = svgOpen(W, H, o.label || '株価チャートとサポート・レジスタンス', 'lvchart');
    if (!rows.length) return head + text(W / 2, H / 2, '株価データがありません', { cls: 'st-j', anchor: 'middle' }) + '</svg>';
    const n = rows.length;
    const ma = {};
    ['ma25', 'ma75', 'ma200'].forEach((k) => { const a = o.ma && Array.isArray(o.ma[k]) ? o.ma[k] : null; ma[k] = a ? idx.map((i) => (isNum(a[i]) ? a[i] : null)) : []; });
    let lo = Infinity, hi = -Infinity;
    rows.forEach((r) => { lo = Math.min(lo, r.l); hi = Math.max(hi, r.h); });
    Object.values(ma).forEach((a) => a.forEach((v) => { if (isNum(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
    const span0 = hi - lo || Math.abs(hi) * 0.05 || 1;
    const levels = (o.levels || []).map((L, k) => {
      if (!L || !isNum(L.low) || !isNum(L.high)) return null;
      const a = Math.min(L.low, L.high), b = Math.max(L.low, L.high);
      if (!(b > 0)) return null;
      return { i: isNum(L.i) ? L.i : k, kind: L.kind === 'resistance' ? 'R' : 'S', lo: a, hi: b, str: clamp(Math.round(isNum(L.strength) ? L.strength : 1), 1, 5) };
    }).filter(Boolean);
    levels.forEach((L) => { L.in = L.hi >= lo - span0 * 0.35 && L.lo <= hi + span0 * 0.35; });
    levels.forEach((L) => { if (L.in) { lo = Math.min(lo, L.lo); hi = Math.max(hi, L.hi); } });
    const span = hi - lo || span0;
    const P1 = hi + span * 0.07, P0 = Math.max(0, lo - span * 0.05);
    const dec = isNum(o.dec) ? o.dec : priceDec(rows.map((r) => r.c));
    void dec;
    const lastC = rows[n - 1].c;
    const tagMax = Math.max(textW(fmtP(lastC), 12, true) + 4, ...levels.map((L) => textW(levelTag(L), 12, true) + (L.in ? 0 : 16)));
    const bins = o.vp && Array.isArray(o.vp.bins) ? o.vp.bins : [];
    const padL = 4, padR = Math.max(84, Math.ceil(tagMax) + 20), padT = 28, padB = 19, gap = 8;
    const vpW = bins.length ? Math.round(clamp(W * 0.1, 56, 110)) : 0, vpGap = vpW ? 6 : 0;
    const ax = W - padR, plotR = ax - vpW - vpGap, pw = plotR - padL;
    const volH = Math.round((H - padT - padB) * 0.15), mainH = H - padT - padB - volH - gap, vTop = padT + mainH + gap, mainB = padT + mainH;
    const st = pw / n, bw = clamp(st * 0.6, 1, 7);
    const X = (i) => padL + st * (i + 0.5);
    const Y = (p) => padT + (P1 - p) / (P1 - P0 || 1) * mainH;
    const vmax0 = rows.reduce((m, r) => (isNum(r.v) ? Math.max(m, r.v) : m), 0);
    const VMAX = vmax0 > 0 ? niceCeil(vmax0) : 1;
    const VY = (v) => vTop + volH - v / VMAX * volH;
    // 右端のタグ：現在値＋各レベル（範囲外は上下の端に▲▼）
    const tagList = [{ now: true, y: Y(lastC) }];
    levels.forEach((L) => {
      const yy = L.in ? Y(L.lo === L.hi ? L.lo : (L.lo + L.hi) / 2) : (L.hi > P1 ? padT + 9 : mainB - 9);
      tagList.push({ L, y: yy });
    });
    const ty = spread(tagList.map((t) => t.y), 20, padT - 4, mainB + 2);
    tagList.forEach((t, k) => { t.ty = ty[k]; });

    let s = head;
    s += tag('rect', { x: padL, y: padT, width: pw, height: mainH, fill: 'none', stroke: 'rgba(62,230,255,.16)' });
    s += tag('rect', { x: padL, y: vTop, width: pw, height: volH, fill: 'none', stroke: 'rgba(62,230,255,.12)' });
    if (vpW) s += tag('rect', { x: plotR + vpGap, y: padT, width: vpW, height: mainH, fill: 'rgba(62,230,255,.025)', stroke: 'rgba(62,230,255,.12)' });
    // 目盛り
    const major = niceStep((P1 - P0) / 8, [1, 2, 5, 10]), minor = major / 2, mdec = decOf(minor, 6);
    for (let k = Math.ceil(P0 / minor - 1e-9), g = 0; k * minor <= P1 + 1e-9 && g < 80; k++, g++) {
      const p = Number((k * minor).toFixed(mdec)), y = Y(p);
      if (y < padT + 1 || y > mainB - 1) continue;
      const isMajor = Math.abs(p / major - Math.round(p / major)) < 1e-6;
      s += tag('line', { x1: padL, x2: ax, y1: y, y2: y, stroke: isMajor ? 'rgba(62,230,255,.085)' : 'rgba(62,230,255,.035)' });
      s += tag('line', { x1: ax, x2: ax + (isMajor ? 5 : 3), y1: y, y2: y, stroke: C.tx3 });
      if (isMajor && tagList.every((t) => Math.abs(t.ty - y) > 16)) s += text(ax + 10, y + 4, fmtP(p), { fill: C.tx2 });
    }
    s += tag('line', { x1: ax, x2: ax, y1: padT, y2: vTop + volH, stroke: 'rgba(62,230,255,.3)' });
    let labEnd = -1e9;
    rows.forEach((r, i) => {
      const m = String(r.d).slice(5, 7), yr = String(r.d).slice(0, 4);
      if (i === 0 || m !== String(rows[i - 1].d).slice(5, 7)) {
        const x = X(i) - st / 2;
        s += tag('line', { x1: x, x2: x, y1: padT, y2: vTop + volH + 4, stroke: 'rgba(62,230,255,.10)', 'stroke-dasharray': '2 4' });
        const first = i === 0 || yr !== String(rows[i - 1].d).slice(0, 4);
        const lab = (first ? yr + '年 ' : '') + +m + '月';
        if (x < plotR - 48 && x + 4 > labEnd + 8) { s += text(x + 4, H - 5, lab, { cls: 'st-j', fill: C.tx2 }); labEnd = x + 4 + textW(lab); }
      }
    });
    s += text(plotR - 2, H - 5, mmdd(rows[n - 1].d), { anchor: 'end', fill: C.cy2 });
    s += text(padL + 6, vTop + 13, '出来高', { cls: 'st-j', fill: C.tx2 });
    s += text(ax + 10, vTop + 5, fmtVol(VMAX), { fill: C.tx3 });
    s += text(ax + 10, padT - 10, '円', { cls: 'st-j', fill: C.tx3 });
    // サポレジ（帯・線・タグ）
    tagList.forEach((t) => {
      if (t.now) return;
      const L = t.L, rr = L.kind === 'R';
      const col = rr ? 'rgba(255,120,180,.9)' : 'rgba(166,243,255,.92)';
      const fill = rr ? `rgba(255,92,163,${f(0.06 + L.str * 0.025)})` : `rgba(62,230,255,${f(0.05 + L.str * 0.022)})`;
      const sw = 0.8 + L.str * 0.3;
      s += `<g class="lvg ${rr ? 'r' : 's'}" data-lv="${L.i}">`;
      if (L.in) {
        if (L.hi > L.lo) {
          const y0 = Y(L.hi), y1 = Y(L.lo);
          s += tag('rect', { x: padL, y: y0, width: ax - padL, height: Math.max(2, y1 - y0), fill, class: 'lvband' });
          s += tag('line', { x1: padL, x2: ax, y1: y0, y2: y0, stroke: col, 'stroke-width': 0.9, opacity: 0.7, class: 'lvline' });
          s += tag('line', { x1: padL, x2: ax, y1: y1, y2: y1, stroke: col, 'stroke-width': 0.9, opacity: 0.7, class: 'lvline' });
        } else {
          s += tag('line', { x1: padL, x2: ax, y1: Y(L.lo), y2: Y(L.lo), stroke: col, 'stroke-width': sw, 'stroke-dasharray': rr ? '7 4' : '3 3', class: 'lvline' });
        }
      }
      const yA = L.in ? Y(L.lo === L.hi ? L.lo : (L.lo + L.hi) / 2) : t.ty;
      s += tag('path', { d: `M${f(ax + 2)} ${f(yA)} L${f(ax + 8)} ${f(t.ty - 9)} H${f(W - 2)} V${f(t.ty + 9)} H${f(ax + 8)} Z`, fill: '#0b1824', stroke: col, class: 'tagbox' });
      s += text(ax + 12, t.ty + 4, levelTag(L) + (L.in ? '' : L.hi > P1 ? ' ▲' : ' ▼'), { fill: rr ? '#ffc2dc' : C.cy2, cls: 'st-t tagtxt' });
      s += '</g>';
    });
    // 価格帯別出来高
    if (vpW) {
      const vx = plotR + vpGap;
      const bars = vpLayout(bins, P0, P1, padT, mainH);
      s += '<g class="vp">';
      bars.forEach((b) => {
        const inNow = lastC >= b.from && lastC < b.to;
        const h = Math.max(1, b.y1 - b.y0 - (b.y1 - b.y0 > 3 ? 1 : 0));
        s += tag('rect', { x: vx, y: b.y0, width: Math.max(1, b.w * (vpW - 4)), height: h, fill: inNow ? 'rgba(62,230,255,.75)' : b.max ? 'rgba(216,231,239,.62)' : 'rgba(157,179,194,.32)', class: 'vpbar', 'data-from': b.from, 'data-to': b.to });
      });
      const top = bars.find((b) => b.max);
      if (top && isNum(top.share)) {
        const yl = clamp((top.y0 + top.y1) / 2 + 4, padT + 12, mainB - 3);
        s += text(vx + vpW - 3, yl, fmt(top.share, 1) + '%', { anchor: 'end', fill: C.wh, cls: 'st-t vplab', style: 'paint-order:stroke;stroke:#05080d;stroke-width:3px' });
      }
      s += text(vx + 2, padT - 10, '価格帯別', { cls: 'st-j', fill: C.tx3 });
      s += '</g>';
    }
    // 出来高・ローソク足・移動平均
    s += '<g class="a-rv">';
    rows.forEach((r, i) => {
      if (!isNum(r.v) || r.v <= 0) return;
      const y = VY(r.v);
      s += tag('rect', { x: X(i) - bw / 2, y, width: bw, height: vTop + volH - y, fill: r.c >= r.o ? 'rgba(62,230,255,.42)' : 'rgba(255,92,163,.5)' });
    });
    s += '</g><g class="a-rv candles">';
    rows.forEach((r, i) => {
      const up = r.c >= r.o, x = X(i), col = up ? C.cy : C.mag;
      s += tag('line', { x1: x, x2: x, y1: Y(r.h), y2: Y(r.l), stroke: col, 'stroke-width': 1 });
      s += tag('rect', { x: x - bw / 2, y: Y(Math.max(r.o, r.c)), width: bw, height: Math.max(1, Math.abs(Y(r.o) - Y(r.c))), fill: up ? 'rgba(62,230,255,.22)' : C.mag, stroke: col, 'stroke-width': 1 });
    });
    s += '</g>';
    ['ma200', 'ma75', 'ma25'].forEach((k) => {
      const d = seriesPath(ma[k], X, Y), m = MA_STYLE[k];
      if (d) s += tag('path', { d, fill: 'none', stroke: m[0], 'stroke-width': m[1], 'stroke-dasharray': m[2], 'stroke-linejoin': 'round', filter: m[3], class: 'ma' });
    });
    // 現在値
    const lt = tagList[0], lx = X(n - 1), ly = Y(lastC);
    s += tag('line', { x1: lx + 8, x2: ax, y1: ly, y2: ly, stroke: C.cy, 'stroke-dasharray': '2 3', opacity: 0.8 });
    s += tag('path', { d: `M${f(ax + 2)} ${f(ly)} L${f(ax + 8)} ${f(lt.ty - 10)} H${f(W)} V${f(lt.ty + 10)} H${f(ax + 8)} Z`, fill: C.cy, filter: 'url(#kl-glow)', class: 'tagbox now' });
    s += text(ax + 12, lt.ty + 4.5, fmtP(lastC), { fill: C.bg, style: 'font-weight:700', cls: 'st-t tagtxt' });
    s += `<g stroke="${C.cy}" fill="none" stroke-width="1.2">` + tag('circle', { cx: lx, cy: ly, r: 8 }) + tag('circle', { cx: lx, cy: ly, r: 2, fill: C.cy }) + '</g>';
    return s + '</svg>';
  }

  /* ---------- 過熱の物差し（目安の閾値つきゲージ。HTML） ---------- */
  const HEAT = {
    ma25dev: { name: '25日線からの乖離', min: -20, max: 20, zones: [[-20, -10], [10, 20]], ticks: [-20, -10, 0, 10, 20], from: 0, unit: '%', sign: true, tk: (v) => (v ? fmtS(v) : '0') + '%', rule: '±10%超で過熱の目安' },
    rsi: { name: 'RSI（14日）', min: 0, max: 100, zones: [[0, 30], [70, 100]], ticks: [0, 30, 50, 70, 100], from: null, unit: '', tk: (v) => String(v), rule: '70以上は買われすぎ・30以下は売られすぎの目安' },
    change3d: { name: '直近3日の騰落率', min: -20, max: 20, zones: [[-20, -10], [10, 20]], ticks: [-20, -10, 0, 10, 20], from: 0, unit: '%', sign: true, tk: (v) => (v ? fmtS(v) : '0') + '%', rule: '±10%超で過熱の目安' },
    volume: { name: '出来高（20日平均比）', min: 0, max: 4, zones: [[2, 4]], ticks: [0, 1, 2, 3, 4], from: 0, unit: '倍', tk: (v) => v + '倍', rule: '2倍以上で過熱の目安' },
  };
  function heatPos(key, v) {
    const h = HEAT[key];
    if (!h || !isNum(v)) return null;
    return { pos: clamp((v - h.min) / (h.max - h.min) * 100, 0, 100), over: v > h.max ? 1 : v < h.min ? -1 : 0, zero: h.from == null ? null : (h.from - h.min) / (h.max - h.min) * 100 };
  }
  function heatValue(key, v) {
    const h = HEAT[key];
    if (!h || !isNum(v)) return '—';
    if (key === 'rsi') return fmt(v, decOf(v, 1));
    if (key === 'volume') return fmt(v, 2);
    return fmtS(v, 2);
  }
  function heatGauge(key, v, state) {
    const h = HEAT[key];
    if (!h) return '';
    const P = heatPos(key, v);
    const pc = (x) => (x - h.min) / (h.max - h.min) * 100;
    let g = h.zones.map(([a, b]) => `<i class="hz" style="left:${f(pc(a))}%;width:${f(pc(b) - pc(a))}%"></i>`).join('');
    g += h.ticks.map((t) => `<i class="ht" style="left:${f(pc(t))}%"></i>`).join('');
    if (P) {
      const cls = state === 'hot' ? ' hot' : state === 'warm' ? ' warm' : '';
      if (P.zero != null) {
        const a = Math.min(P.zero, P.pos), w = Math.abs(P.pos - P.zero);
        g += `<i class="hb a-gx${cls}" style="left:${f(a)}%;width:${f(Math.max(w, 0.4))}%"></i>`;
      }
      g += `<i class="hm${cls}" style="left:${f(P.pos)}%" data-pos="${f(P.pos)}"></i>`;
    }
    const lab = h.ticks.map((t, k) => `<span style="left:${f(pc(t))}%"${k === 0 ? ' class="l"' : k === h.ticks.length - 1 ? ' class="r"' : ''}>${esc(h.tk(t))}</span>`).join('');
    const ov = P && P.over ? `<em class="hov">${P.over > 0 ? '目盛りの上限を超過 ▶' : '◀ 目盛りの下限を超過'}</em>` : '';
    return `<div class="hg"><div class="hgt${P ? '' : ' nil'}">${g}</div><div class="hgs">${lab}</div>${ov}</div>`;
  }

  /* =====================================================================
     売買タイミングの考え方：縦の価格軸を共有する3レーン
     o = {plans:[{zone:{low,high}, stop:{price}, target:{price}}], close, W, H, axisW, gap}
     レーンの横位置は CSS の grid（axisW と gap の4列）と同じ式：x_i = axisW + gap + i*(laneW+gap)
     ===================================================================== */
  function planLanes(W, axisW, gap, n = 3) {
    const lw = (W - axisW - gap * n) / n;
    return Array.from({ length: n }, (_, i) => ({ x: axisW + gap + i * (lw + gap), w: lw }));
  }
  function planPrices(p) {
    const z = p && p.zone ? p.zone : {}, out = [];
    [z.low, z.high, p && p.stop && p.stop.price, p && p.target && p.target.price].forEach((v) => { if (isNum(v) && v > 0) out.push(v); });
    return out;
  }
  function plansChart(o) {
    const W = Math.round(o.W), H = Math.round(o.H), axisW = o.axisW || 76, gap = isNum(o.gap) ? o.gap : 10;
    if (!(W > axisW + 120 && H > 80)) return '';
    const plans = (o.plans || []).slice(0, 3);
    const close = isNum(o.close) ? o.close : null;
    let s = svgOpen(W, H, '3つの考え方の価格帯・撤退ライン・目安と現在値');
    const vals = [...plans.flatMap(planPrices), ...(close != null ? [close] : [])];
    if (!vals.length) return s + text(W / 2, H / 2, '価格の指定がありません', { cls: 'st-j', anchor: 'middle', fill: C.tx3 }) + '</svg>';
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const sp = hi - lo || Math.abs(hi) * 0.06 || 1;
    const P1 = hi + sp * 0.12, P0 = Math.max(0, lo - sp * 0.12);
    const padT = 12, padB = 12, ph = H - padT - padB;
    const Y = (p) => padT + (P1 - p) / (P1 - P0 || 1) * ph;
    const lanes = planLanes(W, axisW, gap, 3);
    // 軸
    const tk = niceTicks(P0, P1, 5);
    const nowY = close != null ? Y(close) : null;
    tk.ticks.forEach((t) => {
      const y = Y(t);
      if (y < padT || y > H - padB) return;
      s += tag('line', { x1: axisW - 4, x2: W, y1: y, y2: y, stroke: 'rgba(62,230,255,.05)' });
      if (nowY == null || Math.abs(nowY - y) > 15) s += text(axisW - 9, y + 4, fmtP(t), { anchor: 'end', fill: C.tx3 });
    });
    s += tag('line', { x1: axisW - 4, x2: axisW - 4, y1: padT, y2: H - padB, stroke: 'rgba(62,230,255,.3)' });
    const pct = (p) => (close ? ' ' + fmtS((p / close - 1) * 100, 1) + '%' : '');
    lanes.forEach((ln, i) => {
      const p = plans[i] || {};
      const x0 = ln.x, x1 = ln.x + ln.w, bx1 = x0 + Math.max(60, ln.w * 0.46), cx = (x0 + 6 + bx1) / 2;
      s += tag('rect', { x: x0, y: padT - 6, width: ln.w, height: ph + 12, fill: 'rgba(62,230,255,.025)', stroke: 'rgba(62,230,255,.14)', class: 'pl-lane', 'data-p': i });
      const z = p.zone || {}, zl = isNum(z.low) ? z.low : null, zh = isNum(z.high) ? z.high : null;
      const zLo = zl != null && zh != null ? Math.min(zl, zh) : zl != null ? zl : zh, zHi = zl != null && zh != null ? Math.max(zl, zh) : zLo;
      const stop = p.stop && isNum(p.stop.price) ? p.stop.price : null, tgt = p.target && isNum(p.target.price) ? p.target.price : null;
      const labs = [];
      if (zLo != null) {
        const y0 = Y(zHi), y1 = Y(zLo), h = Math.max(3, y1 - y0);
        s += tag('rect', { x: x0 + 6, y: y0 - (h > y1 - y0 ? (h - (y1 - y0)) / 2 : 0), width: bx1 - x0 - 6, height: h, fill: 'url(#kl-hatch)', stroke: C.tx, 'stroke-width': 1, class: 'pl-zone', 'data-p': i });
        s += tag('line', { x1: bx1, x2: x1 - 6, y1: (y0 + y1) / 2, y2: (y0 + y1) / 2, stroke: 'rgba(216,231,239,.35)', 'stroke-dasharray': '1 3' });
        labs.push({ y: (y0 + y1) / 2 + 4, s: '入る価格帯 ' + (zLo === zHi ? fmtP(zLo) : fmtP(zLo) + '〜' + fmtP(zHi)), fill: C.tx });
      }
      if (tgt != null) {
        s += tag('line', { x1: x0 + 6, x2: x1 - 6, y1: Y(tgt), y2: Y(tgt), stroke: C.cy2, 'stroke-width': 1.6, 'stroke-dasharray': '1 3', 'stroke-linecap': 'round', class: 'pl-tgt', 'data-p': i });
        labs.push({ y: Y(tgt) - 4, s: '目安 ' + fmtP(tgt) + pct(tgt), fill: C.cy2 });
      }
      if (stop != null) {
        s += tag('line', { x1: x0 + 6, x2: x1 - 6, y1: Y(stop), y2: Y(stop), stroke: C.amb, 'stroke-width': 1.5, 'stroke-dasharray': '6 4', class: 'pl-stop', 'data-p': i });
        labs.push({ y: Y(stop) + 14, s: '撤退 ' + fmtP(stop) + pct(stop), fill: C.amb });
      }
      // 入る価格帯から目安・撤退ラインへの矢印（向きだけを示す中立の線）
      if (zLo != null) {
        const zm = Y((zLo + zHi) / 2);
        if (tgt != null && Math.abs(Y(tgt) - zm) > 14) s += tag('path', { d: `M${f(cx)} ${f(zm)} V${f(Y(tgt) + (Y(tgt) < zm ? 4 : -4))}`, stroke: C.mid, 'stroke-width': 1.2, 'stroke-dasharray': '3 3', fill: 'none', 'marker-end': 'url(#arN)', opacity: 0.75 });
        if (stop != null && Math.abs(Y(stop) - zm) > 14) s += tag('path', { d: `M${f(cx)} ${f(zm)} V${f(Y(stop) + (Y(stop) < zm ? 4 : -4))}`, stroke: C.mid, 'stroke-width': 1.2, 'stroke-dasharray': '3 3', fill: 'none', 'marker-end': 'url(#arN)', opacity: 0.5 });
      }
      if (!labs.length) {
        s += text(x0 + ln.w / 2, (nowY != null && Math.abs(nowY - (padT + ph * 0.3)) < 20 ? padT + ph * 0.62 : padT + ph * 0.3), '価格の指定なし', { cls: 'st-j pl-none', anchor: 'middle', fill: C.tx2 });
      }
      const ys = spread(labs.map((l) => l.y), 15, padT + 10, H - padB - 1);
      labs.forEach((l, k) => {
        // 現在値の線と重なる時は少しずらす
        let yy = ys[k];
        if (nowY != null && Math.abs(yy - 4 - nowY) < 7) yy = nowY + (yy - 4 < nowY ? -6 : 18);
        yy = clamp(yy, padT + 10, H - padB - 1);
        s += text(x1 - 10, yy, l.s, { anchor: 'end', fill: l.fill, cls: 'st-j pl-lab', style: 'paint-order:stroke;stroke:#08121b;stroke-width:3px' });
      });
    });
    if (nowY != null) {
      s += tag('line', { x1: axisW - 4, x2: W, y1: nowY, y2: nowY, stroke: C.cy, 'stroke-width': 1.2, opacity: 0.85, class: 'pl-now' });
      const str = fmtP(close), tw = textW(str, 12, true) + 12;
      s += tag('path', { d: `M${f(axisW - 4)} ${f(nowY)} L${f(axisW - 10)} ${f(nowY - 9)} H${f(axisW - 12 - tw)} V${f(nowY + 9)} H${f(axisW - 10)} Z`, fill: C.cy, class: 'tagbox' });
      s += text(axisW - 15, nowY + 4, str, { anchor: 'end', fill: C.bg, style: 'font-weight:700' });
      s += text(axisW - 9, Math.max(padT + 2, nowY - 13), '現在値', { cls: 'st-j', anchor: 'end', fill: C.cy });
    }
    return s + '</svg>';
  }

  /* ---------- 決算：前年値の逆算（value ÷ (1 + yoyPct/100)）。逆算できなければ null ---------- */
  function prevFromYoy(v, yoy) {
    if (!isNum(v) || !isNum(yoy)) return null;
    const k = 1 + yoy / 100;
    if (!(k > 0)) return null;
    return v / k;
  }

  /* ---------- 決算：今期と前年の立体棒（1項目ぶん）。前年は逆算値（≈）。負の値は下向き ----------
     o = {curr, prev, W, H} */
  function pairBars3d(o) {
    const W = Math.round(o.W), H = Math.round(o.H);
    if (!(W > 60 && H > 60)) return '';
    const curr = isNum(o.curr) ? o.curr : null, prev = isNum(o.prev) ? o.prev : null;
    let s = svgOpen(W, H, `今期 ${fmt(curr)}${prev != null ? ' 前年 約' + fmt(Math.round(prev)) : ''}`);
    if (curr == null) return s + '</svg>';
    const d = decOf(curr, 2);
    const vals = [curr, ...(prev != null ? [prev] : [])];
    const vmax = Math.max(0, ...vals), vmin = Math.min(0, ...vals);
    const DX = 8, DY = 5, padT = 20 + DY, padB = 34;
    const ph = H - padT - padB;
    const Yv = (v) => padT + (vmax - v) / (vmax - vmin || 1) * ph;
    const base = Yv(0);
    const items = prev != null ? [['前年', prev, true], ['今期', curr, false]] : [['今期', curr, false]];
    const bw = Math.min(46, (W - 20) / (items.length * 2));
    s += floor3d(10 + DX, W - 4, base, DX, DY);
    items.forEach(([lab, v, isPrev], k) => {
      const cx = items.length === 1 ? W / 2 + DX / 2 : W * (k === 0 ? 0.32 : 0.7) + DX / 2;
      const x0 = cx - bw / 2;
      const yv = Yv(v), top = Math.min(yv, base), bot = Math.max(yv, base);
      const neg = v < 0;
      const sty = isPrev
        ? { front: 'url(#kl-sh)', side: 'rgba(90,110,122,.6)', top: 'rgba(200,215,225,.5)', fedge: 'rgba(157,179,194,.5)' }
        : neg ? { front: 'rgba(255,92,163,.45)', side: 'rgba(150,40,90,.7)', top: 'rgba(255,160,200,.7)', fedge: C.mag }
          : { front: 'url(#g3BarF)', side: 'url(#g3BarL)', top: 'rgba(166,243,255,.82)', fedge: 'rgba(62,230,255,.55)', hi: true };
      s += `<g class="a-grow" style="animation-delay:${f(k * 0.12)}s">` + bar3d(x0, top, bw, Math.max(bot, top + 1.5), DX, DY, sty) + '</g>';
      const str = (isPrev ? '≈' : '') + fmt(v, isPrev ? (d ? Math.min(d, 1) : 0) : d);
      const ly = neg ? Math.min(bot + 14, H - padB + 12) : top - DY - 5;
      s += text(cx - DX / 2, ly, str, { anchor: 'middle', fill: isPrev ? C.tx2 : neg ? C.mag : C.wh, cls: 'st-t' + (isPrev ? '' : ' cur'), style: isPrev ? '' : 'font-weight:700' });
      s += text(cx - DX / 2, H - 4, lab + (isPrev ? '（逆算）' : ''), { anchor: 'middle', cls: 'st-j', fill: isPrev ? C.tx3 : C.tx2 });
    });
    return s + '</svg>';
  }

  /* ---------- 決算：進捗リング（0〜100% で1周、100%超は内側に超過分）＋均等ペースの目盛り ----------
     角度は真上から時計回り（度）。画面の検査は data 属性と目盛りの座標で確かめる */
  function ringGeom(pct, pace) {
    const p = isNum(pct) ? clamp(pct, 0, 200) : null;
    const pc = isNum(pace) ? clamp(pace, 0, 100) : null;
    return { pct: p, main: p == null ? 0 : Math.min(p, 100), over: p != null && p > 100 ? p - 100 : 0, mainDeg: p == null ? 0 : Math.min(p, 100) * 3.6, overDeg: p != null && p > 100 ? (p - 100) * 3.6 : 0, paceDeg: pc == null ? null : pc * 3.6 };
  }
  function ring(pct, pace, size = 180) {
    const g = ringGeom(pct, pace);
    const cx = size / 2, cy = size / 2, r = size * 0.33, sw = 13;
    const P = (deg, rr) => [cx + rr * Math.sin(deg * Math.PI / 180), cy - rr * Math.cos(deg * Math.PI / 180)];
    const arc = (d0, d1, rr) => {
      if (d1 - d0 >= 359.99) return `M${f(cx)} ${f(cy - rr)} A${rr} ${rr} 0 1 1 ${f(cx)} ${f(cy + rr)} A${rr} ${rr} 0 1 1 ${f(cx)} ${f(cy - rr)}`;
      const a = P(d0, rr), b = P(d1, rr);
      return `M${f(a[0])} ${f(a[1])} A${rr} ${rr} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${f(b[0])} ${f(b[1])}`;
    };
    let s = `<svg class="pr-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="進捗率 ${g.pct == null ? '未取得' : fmt(g.pct, decOf(g.pct, 1)) + '%'}・均等ペース ${g.paceDeg == null ? '—' : fmt(g.paceDeg / 3.6, 0) + '%'}" data-pct="${g.pct == null ? '' : g.pct}" data-pace="${g.paceDeg == null ? '' : f(g.paceDeg / 3.6)}" data-cx="${f(cx)}" data-cy="${f(cy)}">`;
    // 目盛り（10%ごと）
    for (let k = 0; k < 40; k++) {
      const d = k * 9, a = P(d, r + sw / 2 + 4), b = P(d, r + sw / 2 + (k % 4 === 0 ? 10 : 7));
      s += tag('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: k % 4 === 0 ? C.tx3 : 'rgba(127,151,168,.45)', 'stroke-width': 1 });
    }
    s += tag('circle', { cx, cy, r, fill: 'none', stroke: 'rgba(62,230,255,.1)', 'stroke-width': sw });
    s += tag('circle', { cx, cy, r: r - sw / 2 - 5, fill: 'none', stroke: 'rgba(62,230,255,.18)', 'stroke-dasharray': '1 4' });
    if (g.pct != null && g.mainDeg > 0) {
      s += tag('path', { d: arc(0, g.mainDeg, r), fill: 'none', stroke: C.cy, 'stroke-width': sw - 3, filter: 'url(#mglow)', class: 'pr-arc arc', 'data-deg': f(g.mainDeg) });
      const e = P(g.mainDeg, r);
      s += tag('circle', { cx: e[0], cy: e[1], r: 3.2, fill: C.wh, class: 'pr-end' });
    }
    if (g.overDeg > 0) s += tag('path', { d: arc(0, g.overDeg, r - sw - 4), fill: 'none', stroke: C.amb, 'stroke-width': 5, class: 'pr-over arc', 'data-deg': f(g.overDeg) });
    if (g.paceDeg != null) {
      const a = P(g.paceDeg, r - sw / 2 - 3), b = P(g.paceDeg, r + sw / 2 + 12);
      s += tag('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: C.amb, 'stroke-width': 2, class: 'pr-pace' });
      s += tag('circle', { cx: b[0], cy: b[1], r: 2.5, fill: C.amb });
    }
    if (g.pct != null) {
      const str = fmt(g.pct, decOf(g.pct, 1));
      s += `<text x="${f(cx)}" y="${f(cy + 7)}" text-anchor="middle" class="pr-num" style="fill:${C.wh};font:700 ${str.length > 4 ? 24 : 30}px var(--mono,monospace)">${esc(str)}<tspan style="font-size:14px;fill:${C.tx2}">%</tspan></text>`;
      s += text(cx, cy + 25, '進捗率', { cls: 'st-j', anchor: 'middle', fill: C.tx2 });
    }
    return s + '</svg>';
  }

  /* ---------- 小さな比率バー（進捗の一覧：pct と均等ペースの目盛り。HTML） ---------- */
  function paceBar(pct, pace) {
    const p = isNum(pct) ? clamp(pct, 0, 200) : null, pc = isNum(pace) ? clamp(pace, 0, 100) : null;
    const max = p != null && p > 100 ? 200 : 100;
    return `<span class="pcb">${p != null ? `<u style="width:${f(p / max * 100)}%"></u>` : ''}${pc != null ? `<i style="left:${f(pc / max * 100)}%"></i>` : ''}</span>`;
  }

  /* ---------- 増減率の横棒（0を中心に左右。HTML） ---------- */
  function yoyBar(v, scale) {
    const sc = isNum(scale) && scale > 0 ? scale : Math.max(10, isNum(v) ? Math.abs(v) : 0);
    if (!isNum(v)) return '<span class="yb nil"></span>';
    const w = Math.min(Math.abs(v), sc) / sc * 50;
    return `<span class="yb"><u class="a-gx${v < 0 ? ' neg' : ''}" style="${v < 0 ? 'right:50%' : 'left:50%'};width:${f(Math.max(w, 0.6))}%"></u></span>`;
  }

  /* ---------- 「前→今」の対比バー（財務。HTML）。共通の物差しは max(|prev|,|curr|) ---------- */
  function cmpPair(prev, curr) {
    const m = Math.max(isNum(prev) ? Math.abs(prev) : 0, isNum(curr) ? Math.abs(curr) : 0);
    const w = (v) => (isNum(v) && m > 0 ? Math.abs(v) / m * 100 : 0);
    return `<span class="cp"><span class="cpr p"><u style="width:${f(w(prev))}%"${isNum(prev) && prev < 0 ? ' class="neg"' : ''}></u></span><span class="cpr c"><u class="a-gx${isNum(curr) && curr < 0 ? ' neg' : ''}" style="width:${f(w(curr))}%"></u></span></span>`;
  }
  /** 増減の向きと率。単位が % なら差（pt）、それ以外は率（%）。計算できなければ null */
  function changeOf(prev, curr, unit) {
    if (!isNum(prev) || !isNum(curr)) return null;
    const diff = curr - prev;
    if (unit === '%') return { dir: diff > 1e-9 ? 'up' : diff < -1e-9 ? 'dn' : 'flat', text: fmtS(diff, 1) + 'pt' };
    if (prev === 0) return { dir: diff > 0 ? 'up' : diff < 0 ? 'dn' : 'flat', text: diff === 0 ? '±0' : '—' };
    const r = (curr / prev - 1) * 100 * (prev < 0 ? -1 : 1);
    return { dir: diff > 1e-9 ? 'up' : diff < -1e-9 ? 'dn' : 'flat', text: fmtS(r, 1) + '%' };
  }

  /* ---------- ブレットチャート（目標 vs 実績 vs 今期予想。HTML） ----------
     数値でない値（文字の目標など）は物差しに載せない。負の値は 0 の線を挟んで描く */
  function bulletScale(vals) {
    const v = (vals || []).filter(isNum);
    if (!v.length) return null;
    let lo = Math.min(0, ...v), hi = Math.max(0, ...v);
    if (hi - lo < 1e-9) hi = lo + 1;
    hi = hi > 0 ? hi + (hi - lo) * 0.12 : hi;
    lo = lo < 0 ? lo - (hi - lo) * 0.08 : lo;
    return { lo, hi, pos: (x) => clamp((x - lo) / (hi - lo) * 100, 0, 100), zero: (0 - lo) / (hi - lo) * 100 };
  }
  function bullet(t) {
    const T = t && isNum(t.target) ? t.target : null, A = t && isNum(t.actual) ? t.actual : null, F = t && isNum(t.forecast) ? t.forecast : null;
    const sc = bulletScale([T, A, F]);
    if (!sc) return '<div class="bl nil"><span>数値の比較なし</span></div>';
    const bar = (v, cls) => { if (v == null) return ''; const a = Math.min(sc.zero, sc.pos(v)), w = Math.abs(sc.pos(v) - sc.zero); return `<u class="${cls}${v < 0 ? ' neg' : ''}" style="left:${f(a)}%;width:${f(Math.max(w, 0.6))}%" data-v="${v}"></u>`; };
    let s = '<div class="bl"><div class="blt">';
    s += bar(F, 'bf') + bar(A, 'ba a-gx');
    if (T != null) s += `<i class="btg" style="left:${f(sc.pos(T))}%" data-v="${T}"></i>`;
    if (sc.lo < 0) s += `<i class="bz" style="left:${f(sc.zero)}%"></i>`;
    return s + '</div></div>';
  }

  /* =====================================================================
     配当とEPS：期ごとの立体棒（配当）＋浮遊する折れ線（EPS）。予想は斜線と点線
     o = {divs:[{period,value,forecast}], eps:[{period,value,forecast}], W, H}
     数値でない配当（「中間28・期末未定」など）は棒を描かず、表（HTML）で見せる
     ===================================================================== */
  function returnsPeriods(divs, eps) {
    const out = [];
    [...(divs || []), ...(eps || [])].forEach((x) => { if (x && typeof x.period === 'string' && !out.includes(x.period)) out.push(x.period); });
    return out;
  }
  function returns3d(o) {
    const W = Math.round(o.W), H = Math.round(o.H);
    if (!(W > 120 && H > 90)) return '';
    const divs = (o.divs || []).filter((x) => x && typeof x.period === 'string'), eps = (o.eps || []).filter((x) => x && typeof x.period === 'string');
    const periods = returnsPeriods(divs, eps);
    const N = Math.max(1, periods.length);
    let s = svgOpen(W, H, '配当とEPSの推移');
    const dOf = (p) => divs.find((x) => x.period === p) || null, eOf = (p) => eps.find((x) => x.period === p) || null;
    const dv = periods.map((p) => { const x = dOf(p); return x && isNum(x.value) ? x.value : null; });
    const ev = periods.map((p) => { const x = eOf(p); return x && isNum(x.value) ? x.value : null; });
    const DX = 12, DY = 8, pl = 6 + DX, pr = 6, base = H - 20;
    const gw = (W - pl - pr) / N, bw = Math.min(54, gw * 0.46);
    const dmax = Math.max(1, ...dv.filter(isNum));
    const bandTop = 18, H3 = Math.max(10, (base - DY - bandTop - 40) * 0.62);
    const RY = (v) => base - Math.max(0, v) / dmax * H3;
    s += floor3d(pl, W - pr, base, DX, DY);
    periods.forEach((p, i) => {
      const cx = pl + gw * (i + 0.5), x0 = cx - bw / 2, d = dOf(p), fc = !!(d && d.forecast) || !!(eOf(p) && eOf(p).forecast), mx = cx - DX / 2;
      if (isNum(dv[i])) {
        const y = RY(dv[i]);
        s += `<g class="a-grow rb" style="animation-delay:${f(i * 0.1)}s">` + bar3d(x0, Math.min(y, base - 1.5), bw, base, DX, DY, d.forecast
          ? { front: 'url(#fch)', side: 'rgba(62,230,255,.08)', top: 'rgba(62,230,255,.18)', edge: C.cy, dash: '3 3', fedge: C.cy, fdash: '4 3' }
          : { front: 'url(#g3BarF)', side: 'url(#g3BarL)', top: 'rgba(166,243,255,.82)', fedge: 'rgba(62,230,255,.55)', hi: true }) + '</g>';
        s += text(mx, y - DY - 4, fmt(dv[i], decOf(dv[i], 2)) + '円', { anchor: 'middle', fill: d.forecast ? C.cy2 : C.tx, cls: 'st-t rbl' });
      } else {
        s += tag('path', { d: poly([[x0, base], [x0 + bw, base], [x0 + bw - DX, base - DY], [x0 - DX, base - DY]]), fill: 'none', stroke: C.tx3, 'stroke-dasharray': '2 3' });
        s += text(mx, base - DY - 5, d && typeof d.value === 'string' && d.value ? '表を参照' : '—', { anchor: 'middle', cls: 'st-j', fill: C.tx3 });
      }
      s += text(cx, H - 4, p + (fc ? '予' : ''), { anchor: 'middle', fill: fc ? C.cy2 : C.tx2 });
    });
    // EPS の線（上の帯に独立した物差しで）
    const evn = ev.filter(isNum);
    if (!evn.length && !dv.some(isNum)) s += text(W / 2, Math.max(16, (base - DY) / 2), '数値の配当・EPSはありません（下の表を参照）', { cls: 'st-j', anchor: 'middle', fill: C.tx3 });
    if (evn.length) {
      const emax = Math.max(...evn), emin = Math.min(...evn);
      const top = bandTop, bot = Math.min(...periods.map((_, i) => (isNum(dv[i]) ? RY(dv[i]) : base) - DY - 24));
      const bandH = Math.max(6, bot - top);
      const EY = (v) => (emax > emin ? top + (emax - v) / (emax - emin) * bandH : top + bandH / 2);
      const pts = [];
      periods.forEach((p, i) => { if (isNum(ev[i])) pts.push([pl + gw * (i + 0.5) - DX / 2, EY(ev[i]), ev[i], !!(eOf(p) && eOf(p).forecast)]); });
      for (let k = 1; k < pts.length; k++) {
        const fc = pts[k][3];
        s += `<g class="a-rv eline">` + (fc ? tag('path', { d: pathD([pts[k - 1], pts[k]]), stroke: C.w, 'stroke-width': 1.6, 'stroke-dasharray': '4 3', fill: 'none' }) : tube(pathD([pts[k - 1], pts[k]]), C.w, '#5d7686', 1.6)) + '</g>';
      }
      pts.forEach((q) => {
        const lab = fmt(q[2], decOf(q[2], 2)), w = textW(lab, 12, true) + 10;
        const lx = clamp(q[0], w / 2 + 1, W - w / 2 - 1);
        s += tag('circle', { cx: q[0], cy: q[1], r: 3.6, fill: q[3] ? C.bg : 'url(#g3OrbW)', stroke: q[3] ? C.w : 'none', 'stroke-width': 1.4, filter: q[3] ? '' : 'url(#mglow)' });
        s += tag('rect', { x: lx - w / 2, y: q[1] - 20, width: w, height: 15, fill: 'rgba(6,14,22,.95)', stroke: 'rgba(244,251,255,.55)', 'stroke-dasharray': q[3] ? '3 2' : '' });
        s += text(lx, q[1] - 8.5, lab, { anchor: 'middle', fill: q[2] < 0 ? C.mag : C.w, cls: 'st-t elab' });
      });
    }
    return s + '</svg>';
  }

  /* ---------- 営業利益率の推移（3か月ごと。小さな折れ線） ---------- */
  function marginLine(o) {
    const W = Math.round(o.W), H = Math.round(o.H);
    if (!(W > 120 && H > 60)) return '';
    const rows = (o.rows || []).filter((r) => r && typeof r.period === 'string' && isNum(r.v));
    let s = svgOpen(W, H, '営業利益率の推移（3か月ごと）');
    if (rows.length < 2) return s + '</svg>';
    const vals = rows.map((r) => r.v), mn = Math.min(...vals), mx = Math.max(...vals);
    const tk = niceTicks(Math.min(0, mn) === 0 && mn > 0 ? mn - (mx - mn) * 0.3 : mn, mx, 3);
    const lo = tk.lo, hi = tk.hi;
    const pl = Math.max(34, Math.ceil(textW(fmt(hi, tk.dec) + '%', 12, true)) + 8), pr = 22, pt = 16, pb = 18;
    const X = (i) => pl + (W - pl - pr) * (rows.length === 1 ? 0.5 : i / (rows.length - 1));
    const Y = (v) => pt + (hi - v) / (hi - lo || 1) * (H - pt - pb);
    tk.ticks.forEach((t) => { s += tag('line', { x1: pl, x2: W - pr, y1: Y(t), y2: Y(t), stroke: 'rgba(62,230,255,.07)' }); s += text(pl - 6, Y(t) + 4, fmt(t, tk.dec) + '%', { anchor: 'end', fill: C.tx3 }); });
    const pts = rows.map((r, i) => [X(i), Y(r.v)]);
    s += tag('path', { d: pathD(pts) + ` L${f(pts[pts.length - 1][0])} ${f(H - pb)} L${f(pts[0][0])} ${f(H - pb)}Z`, fill: 'rgba(62,230,255,.06)' });
    s += tag('path', { d: pathD(pts), fill: 'none', stroke: C.cy, 'stroke-width': 1.6, class: 'ma' });
    let lastEnd = -1e9;
    rows.forEach((r, i) => {
      const last = i === rows.length - 1;
      s += tag('circle', { cx: pts[i][0], cy: pts[i][1], r: last ? 3.4 : 2.4, fill: last ? C.cy : C.bg, stroke: C.cy, 'stroke-width': 1.2 });
      const lab = String(r.period), w = textW(lab, 12, true);
      const x = clamp(pts[i][0], pl + w / 2, W - w / 2 - 1);
      if (last || (x - w / 2 > lastEnd + 8 && x + w / 2 < X(rows.length - 1) - textW(String(rows[rows.length - 1].period), 12, true) / 2 - 8)) { s += text(x, H - 4, lab, { anchor: 'middle', fill: last ? C.cy2 : C.tx3 }); lastEnd = x + w / 2; }
    });
    const lv = fmt(rows[rows.length - 1].v, 1) + '%', lw = textW(lv, 12, true);
    const lp = pts[pts.length - 1];
    s += text(clamp(lp[0], pl + lw / 2, W - lw / 2 - 1), lp[1] > pt + 14 ? lp[1] - 7 : lp[1] + 15, lv, { anchor: 'middle', fill: C.wh, cls: 'st-t', style: 'font-weight:700' });
    return s + '</svg>';
  }

  const api = {
    C, SEG_COLORS, isNum, clamp, esc, fmt, fmtP, fmtS, fmtVol, yenParts, jpAmountParts, decOf, priceDec, textW,
    niceStep, niceCeil, niceTicks, sma, deviation, spread, mmdd, md, segModel, segListHtml, ckReasons, noteSign,
    priceChart, meter, meterLabelX, devCell, gauge, perf3d, supply3d, fan, donut, spark, checklist, stars, segs,
    miniCandles, vpLayout, levelChart, levelTag, HEAT, heatPos, heatValue, heatGauge, planLanes, planPrices, plansChart,
    prevFromYoy, pairBars3d, ringGeom, ring, paceBar, yoyBar, cmpPair, changeOf, bulletScale, bullet, returnsPeriods, returns3d, marginLine,
  };
  G.KABU_CHARTS = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
