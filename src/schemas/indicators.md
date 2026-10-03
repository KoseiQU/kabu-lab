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
