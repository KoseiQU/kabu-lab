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
  function donut(items) {
    const vals = (items || []).filter((x) => x && isNum(x.v) && x.v > 0);
    const tot = vals.reduce((a, b) => a + b.v, 0);
    const cx = 32, cy = 32, r = 23, sw = 9;
    let s = '<svg viewBox="0 0 64 64" role="img" aria-label="事業別の利益の構成">';
    s += tag('circle', { cx, cy, r: r + 8, fill: 'none', stroke: 'rgba(62,230,255,.3)', 'stroke-dasharray': '1 4' });
    s += tag('circle', { cx, cy, r: r - 8, fill: 'none', stroke: 'rgba(62,230,255,.15)' });
    if (!(tot > 0)) s += tag('circle', { cx, cy, r, fill: 'none', stroke: 'rgba(62,230,255,.12)', 'stroke-width': sw });
    else if (vals.length === 1) s += tag('circle', { cx, cy, r, fill: 'none', stroke: vals[0].color || C.cy, 'stroke-width': sw });
    else {
      let a = -Math.PI / 2;
      const gapA = 0.03;
      vals.forEach((x, i) => {
        const da = x.v / tot * Math.PI * 2;
        const a0 = a + Math.min(gapA, da / 4), a1 = a + da - Math.min(gapA, da / 4);
        const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)], p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
        s += tag('path', { d: `M${f(p0[0])} ${f(p0[1])} A${r} ${r} 0 ${da > Math.PI ? 1 : 0} 1 ${f(p1[0])} ${f(p1[1])}`, fill: 'none', stroke: x.color || SEG_COLORS[i % SEG_COLORS.length], 'stroke-width': sw, class: 'arc', style: `animation-delay:${f(i * 0.15)}s` });
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
      return `<div class="ck ${k}"${it && it.reason ? ` title="${esc(it.reason)}"` : ''}><div class="n"><span>${esc(id)}</span>${icon}</div><p>${esc(it && it.name ? it.name : '（名称未定義）')}</p><div class="s">${st ? st[1] : '未取得'}</div></div>`;
    });
    const bar = (items || []).map((it) => { const st = CK[it && it.status]; return `<i class="${st ? st[0] : 'u'}"></i>`; }).join('');
    const sum = `<div class="ck-bar" aria-hidden="true">${bar}</div><div class="ck-cnt"><span class="d"><svg><use href="#st-d"/></svg>完成済み<b>${cnt.d}</b></span><span><svg><use href="#st-p"/></svg>進行中<b>${cnt.p}</b></span><span><svg><use href="#st-x"/></svg>なし<b>${cnt.x}</b></span></div>`;
    return { summary: sum, cells: cells.join(''), count: cnt };
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

  const api = {
    C, SEG_COLORS, isNum, clamp, esc, fmt, fmtP, fmtS, fmtVol, yenParts, jpAmountParts, decOf, priceDec, textW,
    niceStep, niceCeil, niceTicks, sma, deviation, spread, mmdd, md,
    priceChart, meter, meterLabelX, devCell, gauge, perf3d, supply3d, fan, donut, spark, checklist, stars, segs,
  };
  G.KABU_CHARTS = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
