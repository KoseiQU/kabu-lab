# window.KABU.stocks[code] の指標と決算データ（P2a）

`build.mjs` が `data/stocks/<code>/` から作る。画面は指標を自前で再計算しない（DESIGN.md §5.3）。
既存のキー（`code` `name` `profile` `prices` `analyses`）の形は P1 から変わらない。追加は `indicators` と `finance`（どちらも無ければ `null`）。

```
stocks[code] = { code, name, profile, prices, indicators, finance, analyses }
```

## indicators

計算元は `prices.json` の全日足（約2年）。`prices.rows` は直近250本に切り詰められ、`indicators.ma.*` はそれと**同じ長さ・同じ添字**。

| キー | 形 | 意味 |
|---|---|---|
| `asOf` | `"YYYY-MM-DD"` | 最終日 |
| `bars` | number | 表示本数（= `prices.rows.length`） |
| `ma` | `{ma5:[…], ma25:[…], ma75:[…], ma200:[…]}` | 単純移動平均（終値、小数1桁）。`prices.rows[i]` に対応。計算できない位置は `null` |
| `latest.close` `latest.change` `latest.changePct` | number | 最終日の終値・前日比（円・%） |
| `latest.ma` | `[{n, value, deviationPct, slope}]` | n=5/25/75/200。`deviationPct`=乖離率%、`slope`=5日前と比べた向き `up`/`down`/`flat` |
| `latest.rsi14` | number | RSI(14)（Wilder 平滑） |
| `latest.volumeRatio20` | number | 最終日の出来高 ÷ 前20日平均 |
| `latest.change3dPct` | number | 直近3日の騰落率%（最終日終値 ÷ 3営業日前の終値 − 1） |
| `latest.week52` | `{high, highDate, low, lowDate}` | 52週（最終日から365日以内）の高値・安値 |
| `volumeProfile` | `{step, bins:[{from, to, volume, share}]}` | 価格帯別出来高（直近250日）。`bins` は価格の低い順、`share` は%。刻みは終値の約2%を1・2・5刻みに丸めた幅 |
| `swings` | `{highs:[{d, price}], lows:[{d, price}]}` | スイング高値・安値（前後8日、直近250日、日付昇順） |
| `crosses` | `[{pair:"5/25"\|"25/75"\|"75/200", events:[{d, type:"GC"\|"DC"}]}]` | 移動平均どうしのクロス（全期間、日付昇順） |
| `priceCrosses` | `[{n:75\|200, events:[{d, dir:"up"\|"down"}]}]` | 終値が75日線・200日線を上抜け/下抜けした日 |
| `gaps` | `[{d, dir:"up"\|"down", from, to, pct, filled}]` | 窓（1.5%以上、直近250日）。`from`=前日の高値（下窓は安値）、`to`=当日の安値（下窓は高値） |
| `maTouches` | `[{line:"ma75"\|"ma200", d, low, ma, distPct, reboundPct, reboundDate}]` | 移動平均線へのタッチと反発（下記）。日付昇順 |
| `weekly` | `[{d, o, h, l, c, v}]` | 週足（月曜始まり、直近2年）。`d` はその週の最初の営業日 |
| `monthly` | `[{d, o, h, l, c, v}]` | 月足（取得できる全期間＝日足の約2年）。`d` はその月の最初の営業日 |

`maTouches` の条件: 安値が75日線・200日線の ±1.5% 以内に入り、その後（翌日〜5営業日以内）に終値がその日の安値から +3% 以上戻した日。直近250日。
直前の該当日から5営業日以内に続く該当日は同じ押し目とみなし、安値が最も低い日を残す。`distPct` は (安値 − 線)/線 %、`reboundPct` は5日以内の最大の戻り%、`reboundDate` はその日。

## finance（`node collect/run.mjs <code> --type kessan` の結果。無ければ null）

金額は株探の表示どおり**百万円**（1株益・配当・1株純資産は円、比率は%、有利子負債倍率は倍）。株探に掲載がない値は `null`。

| キー | 形 |
|---|---|
| `annual` | `{rows:[{period:"2026.03", forecast, sales, operatingProfit, ordinaryProfit, netProfit, eps, dividend, announced:"26/04/27"}], yoy:{sales, …}}`（実績数期＋予想。`yoy` は予想期の前期比%） |
| `cumulative` | `{label:"第１四半期累計決算", quarter:1, rows:[{period:"26.04-06", …, progressH1, announced}], yoy}`（各年の同じ累計期間） |
| `quarterly` | `{rows:[{period:"26.04-06", sales, operatingProfit, ordinaryProfit, netProfit, eps, opMargin, announced}], yoy}`（3か月ごと、古い順） |
| `progress` | `{fiscalYear:"2027.03", cumulativePeriod, quarter, pace, items:[{key, label, actual, forecast, pct}]}`（累計 ÷ 通期予想 %、`pace`=均等ペース%） |
| `revisions` | `{period, revised, history:[{period, date, kind:"初"\|"修"\|"実", sales, …, dividend}], latest:{date, kind, sales:"up"\|"down"\|"flat"\|null, …}\|null}` |
| `profitability` | `[{period, forecast, opMargin, roe, roa, assetTurnover}]` |
| `balance` | `[{period, bps, equityRatio, totalAssets, equity, retainedEarnings, deRatio, announced}]`（最後の行は直近四半期末） |
| `cashflow` | `[{period, fcf, operating, investing, financing, cash, cashRatio}]`（通期のみ） |
| `docs` | `[{date, url, pdf}]`（`url`=株探の閲覧ページ、`pdf`=PDF本体） |
| `source` `fetchedAt` `missing` `units` | 出典・取得時刻・取れなかった項目・単位 |

# P3a で window.KABU に足したキー（画面は再計算しない）

既存のキーの形は変えていない（`market.raw` `market.analysis` `glossary[].term/def/first*` `notes[].date/code/name/type/text` はそのまま）。

## market（`data/market/`）

```
market = { raw, analysis, analyses, series }
```

| キー | 形 |
|---|---|
| `raw` | 最新の `<日付>-raw.json`（6指標の直近値と前日比。従来どおり） |
| `analysis` | 最新の市場型の分析（= `analyses[0]`。無ければ null） |
| `analyses` | 市場型の分析 `<最終取引日>.json` の全件・日付降順（`_file` つき）。日付の切替（`#/market/<date>`）用。無ければ `[]` |
| `series` | `series.json` そのまま。無ければ null。`{generatedAt, source:{title,url}, missing:[…], series:{"^N225"\|"JPY=X"\|"^TNX": {key:"nikkei225"\|"usdjpy"\|"us10y", name, unit:"円"\|"%", rows:[{d, c}]}}}`。日足の終値（約2年、日付は日本時間、昇順） |

## review（シナリオの答え合わせ、DESIGN.md §5.8）

quick の `scenarios` と market の `outlook` ごとに1件。日付降順の配列。

```
{ kind: "stock"|"market", code (市場は null), name, type: "quick"|"market", date, file,
  base: {price, date},            // 分析の price.close と price.asOf
  targets: [{kind: "bull"|"base"|"bear", label, price? | low?/high?, breakIf}],   // 数値の無い目安は label だけ
  after: [{d, c}],                // base.date より後の終値（銘柄は prices.json の全日足、市場は series の日経平均）
  days,                           // = after.length（経過営業日数）
  young,                          // days < 5 なら true（「まだ日が浅い」）
  latest: {d, c} | null,          // after の最後
  nearest: {kind, distPct} | null // latest にいちばん近い目安。距離% = |終値−目安|÷目安、帯の中は 0。機械的な比較であり評価ではない
}
```

## glossary（用語帳）

各要素 `{term, def, firstCode, firstName, firstDate, firstType, category, detail}`。

- 分析の `terms` から: `category`・`detail` は null。市場の分析の語は `firstCode` が null・`firstType` が `"market"`。
- 用語型（`data/glossary/*.json`）がある語は `def` を用語型の定義で上書きし、`category`（指標／チャート／決算／需給／マクロ／制度／その他）と `detail`（用語型の本体から `schema`・`type` を除いたもの＋`_file`。`reading`・`body`・`analogy`・`flow`・`seesaw`・`example`・`stockLink`・`pitfall`・`related`・`addedAt`・`sources`）を持つ。分析に出てこない語は `firstCode` が null・`firstType` が `"yougo"`・`firstDate` が `addedAt`。
- 旧 `data/glossary.json` も引き続き統合する。

## notes（気づきノート）

各要素 `{date, code, name, type, kind, text, title?}`、日付降順。`kind` は次の3種（旧 `data/notes.json` の要素には `kind` が無いことがある）。

| kind | 元 | title |
|---|---|---|
| `insight` | 全分析（市場も含む。市場は `code` が null）の `insight` | なし |
| `lesson` | chart・hansei の `sections.lesson` | `lesson.title` |
| `nextCheck` | hansei の `sections.nextChecks[]`（1項目=1件） | `label`（`text` は `how`） |

# P5a で window.KABU に足したキー（自動更新。DESIGN.md §5.9）

既存のキーの形は変えていない。下の3つは無ければ `null`（`_age` は数えられなければ `null`）。

## refresh（`data/refresh.json`。`node tools/refresh.mjs` が書く）

```
refresh = { at, finishedAt, steps: [{key, ok, message, sec?}], stocks: [{code, ok, lastDate, message}] } | null
```

| キー | 形 |
|---|---|
| `at` | 更新を始めた時刻（ISO、UTC）。画面の「データ更新 10/05 07:21」はこれを日本時間で表示する |
| `finishedAt` | 終えた時刻（ISO）。無ければ null |
| `steps` | 4件・この順: `key` = `market` / `stocks` / `headlines` / `build`。`ok` は真偽、`message` は1行の説明、`sec` は所要秒（任意） |
| `stocks` | 登録銘柄（分析が1件以上ある銘柄）ごとの結果。`lastDate` は prices.json の最終日（無ければ null） |

build は refresh.json を data.js に入れる前に作るため、data.js の `steps` の build は「成功した前提」の行（build が失敗したときは data.js 自体が作り直されない）。

## market.headlines（`data/market/headlines.json`。`collect/headlines.mjs` が書く）

```
market.headlines = { fetchedAt, sources: [{name, url, ok, count, message}], items: [{title, url, source, publishedAt}] } | null
```

- `items` は新しい順に最大30件。同じ題名は1つ。`publishedAt` は ISO（読めなければ null）。題名とリンクだけ（本文・要約は持たない）。
- build は `url` が http(s) でない項目・題名が文字列でない項目を落としてから渡す。題名は外部の文字列なので、画面は必ずエスケープして描く。

## analyses[]._age（鮮度）

各分析（`stocks[code].analyses[]`・`market.analyses[]`）に `_age` を足す。分析の基準日（`price.asOf`。無ければ `date`）より**後**の取引日数。
銘柄は `prices.json` の全期間（`prices.rows` の250本ではない）、市場は `series.json` の日経平均で数える。日足が無い・基準日が読めないときは `null`。画面は再計算しない。

## 市場型の sections.edition（任意）

`pre`（寄り付き前の版）／`post`（大引け後の版）／`other`。スキーマは `schemas/market.schema.json`。

## P6a（§5.10）業種の動き・値上がり／値下がりの上位・注目候補の答え合わせ

### market.sectors（`data/market/sectors.json`。`collect/market.mjs` が書く）

```
market.sectors = { asOf, generatedAt, note, source:{title, url}, items: [{key, code, name, close, d1, w1, m1, asOf}], missing: [文字列] } | null
```

- `items` は 17件（TOPIX-17 業種別ETF 1617〜1633。業種コード順）。`d1`・`w1`・`m1` は 1日・1週（5営業日前）・1か月（21営業日前）の終値との騰落率（%・小数2桁）。データ不足は `null`。
- 指数そのものではなくETFで代用（画面に注記する）。市場型の分析の `themes[].sectorKey` はこの `code`（文字列）。
- 収集が昼に走ると `d1` は取引中の値（大引け後の実行で確定値に置き換わる）。

### market.movers（`data/market/movers.json`）

```
market.movers = { asOf, time, generatedAt, source:{title, url}, up: [{code, name, pct, close}], down: [...] } | null
```

- 株探のランキング（値上がり率 `mode=2_1`・値下がり率 `mode=2_2`、`market=1`＝プライム）から、市場の欄が「東Ｐ」の株式だけを各最大10件。ETF・REIT・優先株などは名前でも除く。
- `asOf`・`time` は株探の表示（`2026-10-05`・`11:53`）。社名は株探の略称（全角英数は NFKC で半角に）。外部の文字列なので画面は必ずエスケープ。
- build はコードの形が違う行・`pct` が数値でない行を落とす。両方0件なら null（画面は「未取得」）。

### market.picks・market.picksSummary（注目候補の答え合わせ）

```
market.picks = [{ date, asOf, file, theme, dir: tailwind|headwind, horizon: short|mid, sectorKey, code, name, why,
                  base, baseDate, latest, latestDate, pct, nikkeiPct, diff, days, young, priceFrom: stock|picks|null }]
market.picksSummary = { all, tailwind:{above, total}, headwind:{below, total}, young, noPrice }
```

- 市場型の分析（全期間）の `sections.themes[].stocks[]` 1件ごとに1行。新しい分析から。
- 終値は登録済み銘柄の `prices.json` を優先し、無ければ `picks-prices.json`（直近60日の分析の候補を Yahoo で取ったもの）。登録済みでも `prices.json` の最終日が `picks-prices.json` より前なら新しいほうを使う（`priceFrom` で分かる）。
- `base` は分析の `price.asOf` の日の終値（無ければその直前の取引日。`baseDate`）。`latest` は手元の最新の終値。`pct` は騰落率（%）、`nikkeiPct` は `baseDate`〜`latestDate` の日経平均の騰落率（同じく直前の取引日に寄せる）、`diff`＝`pct`−`nikkeiPct`、`days` は `baseDate` より後の営業日数（その銘柄の日足で数える）、`young` は5営業日未満。
- 株価が無い（基準日以前の株価が無いものも含む）候補は `base`〜`days` を null にして残す（`young` は false）。
- `picksSummary` は young と数値の欠けた候補を除いて、追い風の候補のうち `pct > nikkeiPct` の数／対象数、向かい風の候補のうち `pct < nikkeiPct` の数／対象数。同じ値はどちらにも数えない。評価語は付けない（機械的な比較）。画面は再計算しない。

### data/market/picks-prices.json

```
{ generatedAt, range: "3mo", source, codes: [...], prices: { "<code>": { rows: [{d, c}] } }, missing: [{code, reason}] }
```

- 応答に無いコード（コードの誤り・上場廃止）と、1回の上限（20銘柄×2リクエスト）を超えたコードは `missing` に残す。候補が0件なら書かない。
