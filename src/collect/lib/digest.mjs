// digest.md（Claude が読む銘柄要約）を組み立てる。8KB（8192バイト）以内に収める。
export const DIGEST_LIMIT = 8192;

const nf = (x, d = 0) =>
  x == null || !Number.isFinite(x) ? '未取得' : x.toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d });
const nfa = (x) => (x == null || !Number.isFinite(x) ? '未取得' : x.toLocaleString('ja-JP', { maximumFractionDigits: 2 }));
const u = (x, unit) => (x == null || !Number.isFinite(x) ? '未取得' : nfa(x) + unit);
const sign = (x, d = 2) => (x == null || !Number.isFinite(x) ? '未取得' : (x > 0 ? '+' : '') + x.toLocaleString('ja-JP', { maximumFractionDigits: d }));
const bytes = (s) => Buffer.byteLength(s, 'utf8');

/**
 * セクション = { title, head: string[], items: string[], order: 'old-first'|'new-first', minKeep }
 * 超過時は items の古い側から1行ずつ削る（items が最も多いセクションから）。
 */
function render(sections) {
  return sections
    .filter(Boolean)
    .map((s) => [`## ${s.title}`, ...s.head, ...s.items, s.trimmed ? `（古い${s.trimmed}行を省略）` : null].filter((x) => x != null).join('\n'))
    .join('\n\n') + '\n';
}

export function fitToLimit(header, sections, limit = DIGEST_LIMIT) {
  let text = header + render(sections);
  while (bytes(text) > limit) {
    const cand = sections.filter((s) => s && s.items.length > (s.minKeep ?? 0)).sort((a, b) => b.items.length - a.items.length)[0];
    if (!cand) break;
    if (cand.order === 'new-first') cand.items.pop();
    else cand.items.shift();
    cand.trimmed = (cand.trimmed ?? 0) + 1;
    text = header + render(sections);
  }
  if (bytes(text) > limit) {
    // 最後の手段: バイト境界で切る
    const note = '\n…（8KB上限のため以降を省略）\n';
    let buf = Buffer.from(text, 'utf8').subarray(0, limit - bytes(note));
    text = buf.toString('utf8').replace(/�+$/, '') + note;
  }
  return text;
}

/** profile(株探) と ind(computeAll の結果) と prices.meta から digest を作る */
export function buildDigest({ code, type = 'quick', profile, ind, pricesMeta, missing = [], generatedAt = new Date().toISOString() }) {
  const p = profile ?? {};
  const name = p.name ?? pricesMeta?.name ?? code;
  const header =
    `# ${code} ${name} digest（${type}）\n` +
    `生成 ${generatedAt} / 日足の最終日 ${ind?.asOf ?? '未取得'} / 出典: 株探 ${p.source?.url ?? '未取得'} ・ Yahoo chart API\n` +
    `数値は下記の取得値のみ。ない数字は推測で埋めない。\n\n`;

  const S = [];
  // 基本情報
  S.push({
    title: '基本情報（株探）',
    head: profile
      ? [
          `市場 ${p.market ?? '未取得'} / 業種 ${p.industry ?? '未取得'} / 区分 ${p.tags?.length ? p.tags.join('・') : '未取得'}`,
          `株価 ${u(p.price, '円')}（前日比 ${sign(p.change, 1)} / ${sign(p.changePct)}%）時刻 ${p.priceTime ?? '未取得'}`,
          `PER ${u(p.per, '倍')} / PBR ${u(p.pbr, '倍')} / PSR ${u(p.psr, '倍')} / 利回り ${u(p.yield, '%')} / 信用倍率 ${u(p.marginRatio, '倍')}`,
          `時価総額 ${p.marketCap?.text ?? '未取得'} / 単元 ${u(p.unitShares, '株')} / 売買最低代金 ${u(p.minPurchase, '円')}`,
          `概要: ${p.overview ?? '未取得'}`,
          `テーマ: ${p.themes?.length ? p.themes.join('、') : '未取得'}`,
        ]
      : ['株探の取得に失敗（基本情報なし）'],
    items: [],
  });

  if (ind) {
    S.push({
      title: `テクニカル指標（終値 ${u(ind.close, '円')} ${ind.asOf}・前日比 ${sign(ind.change, 1)} / ${sign(ind.changePct)}%・日足${ind.bars}本）`,
      head: [
        '| 線 | 値 | 乖離率 | 向き(5日前比) |',
        '|---|---|---|---|',
        ...ind.ma.map((m) => `| ${m.n}日 | ${nf(m.value, 1)} | ${sign(m.deviationPct)}% | ${m.slope ?? '-'} |`),
        `RSI(14) ${nfa(ind.rsi14)} / 出来高 前20日平均比 ${u(ind.volumeRatio20, '倍')} / 直近3日の騰落率 ${ind.change3dPct == null ? '未取得' : sign(ind.change3dPct) + '%'}`,
        ind.week52 ? `52週高値 ${nfa(ind.week52.high)}（${ind.week52.highDate}）/ 52週安値 ${nfa(ind.week52.low)}（${ind.week52.lowDate}）` : '52週高安 未取得',
      ],
      items: [],
    });
    const hs = ind.swings.highs.slice(-10), ls = ind.swings.lows.slice(-10);
    S.push({
      title: 'スイング高値・安値（前後8日・直近250日、新しい順）',
      head: [],
      items: [
        ...Array.from({ length: Math.max(hs.length, ls.length) }, (_, i) => {
          const h = hs[hs.length - 1 - i], l = ls[ls.length - 1 - i];
          return `- 高 ${h ? `${h.d} ${nfa(h.price)}` : '-'} / 安 ${l ? `${l.d} ${nfa(l.price)}` : '-'}`;
        }),
      ],
      order: 'new-first',
      minKeep: 3,
    });
    const vp = ind.volumeProfile;
    const cur = ind.close;
    const top = [...vp.bins].sort((a, b) => b.volume - a.volume).slice(0, 6);
    S.push({
      title: `価格帯別出来高（直近250日・刻み${nf(vp.step)}円・上位6帯）`,
      head: top.map((b, i) => `${i + 1}. ${nf(b.from)}〜${nf(b.to)}円 ${b.share}%${cur >= b.from && cur < b.to ? ' ←現在値' : cur >= b.to ? '（現在値より下）' : '（現在値より上）'}`),
      items: [],
    });
    S.push({
      title: '窓（1.5%以上・直近250日、新しい順）',
      head: ind.gaps.length ? [] : ['なし'],
      items: [...ind.gaps].reverse().map((g) => `- ${g.d} ${g.dir === 'up' ? '上窓' : '下窓'} ${nfa(g.from)}→${nfa(g.to)}（${sign(g.pct)}%）${g.filled ? '埋め済' : '未埋め'}`),
      order: 'new-first',
      minKeep: 2,
    });
    S.push({
      title: '移動平均線へのタッチと反発（安値が75日・200日線の±1.5%以内→5日以内に終値が安値から+3%以上。直近250日、新しい順）',
      head: (ind.maTouches ?? []).length ? [] : ['なし'],
      items: [...(ind.maTouches ?? [])].reverse().map(
        (t) => `- ${t.d} ${t.line.replace('ma', '')}日線 安値 ${nfa(t.low)}（線 ${nfa(t.ma)}・${sign(t.distPct)}%）→ ${t.reboundDate} までに +${nfa(t.reboundPct)}%`,
      ),
      order: 'new-first',
      minKeep: 3,
    });
    S.push({
      title: 'クロス（新しい順・各最大4件）',
      head: [],
      items: [
        ...ind.crosses.map((c) => `- ${c.pair}日線: ${c.events.slice(-4).reverse().map((e) => `${e.d} ${e.type}`).join(' / ') || 'なし'}`),
        ...ind.priceCrosses.map((c) => `- 終値×${c.n}日線: ${c.events.slice(-4).reverse().map((e) => `${e.d} ${e.dir === 'up' ? '上抜け' : '下抜け'}`).join(' / ') || 'なし'}`),
      ],
      minKeep: 5,
    });
  } else {
    S.push({ title: 'テクニカル指標', head: ['株価の取得に失敗（指標なし）'], items: [] });
  }

  if (profile) {
    S.push({
      title: '信用残（千株、古い順）',
      head: p.margin?.length ? ['| 日付 | 売り残 | 買い残 | 倍率 |', '|---|---|---|---|'] : ['未取得'],
      items: (p.margin ?? []).map((m) => `| ${m.date} | ${nf(m.sell, 1)} | ${nf(m.buy, 1)} | ${nfa(m.ratio)} |`),
      order: 'old-first',
      minKeep: 2,
    });
    const perf = p.performance;
    const h = perf?.headers ?? [];
    S.push({
      title: `業績推移（${perf?.unit ?? '単位不明'}）`,
      head: perf?.rows?.length
        ? [`| 決算期 | ${h[1] ?? '売上高'} | ${h[2] ?? '経常益'} | ${h[3] ?? '最終益'} | 1株益 | 1株配 | 発表日 |`, '|---|---|---|---|---|---|---|']
        : ['未取得'],
      items: (perf?.rows ?? []).map(
        (r) => `| ${r.period}${r.forecast ? '予' : ''} | ${nf(r.sales)} | ${nf(r.ordinaryProfit)} | ${nf(r.netProfit)} | ${nfa(r.eps)} | ${nfa(r.dividend)} | ${r.announced ?? '-'} |`,
      ),
      order: 'old-first',
      minKeep: 2,
    });
  }

  if (ind) {
    S.push({
      title: '直近20日の四本値（古い順）',
      head: ['| 日付 | 始 | 高 | 安 | 終 | 出来高 |', '|---|---|---|---|---|---|'],
      items: ind.last20.map((r) => `| ${r.d} | ${nfa(r.o)} | ${nfa(r.h)} | ${nfa(r.l)} | ${nfa(r.c)} | ${nf(r.v)} |`),
      order: 'old-first',
      minKeep: 5,
    });
  }

  S.push({ title: '取得できなかった項目', head: missing.length ? [] : ['なし'], items: missing.map((m) => `- ${m}`), order: 'new-first', minKeep: 5 });
  return fitToLimit(header, S);
}
