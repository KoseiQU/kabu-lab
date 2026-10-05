# KABU LAB 設計書（契約）

実装・改修はすべて本書に従う。**変更は必ず本書を先に更新してから行う。** 本書と `docs/` の編集権はメインセッションのみ。

作成日: 2026-10-03

## 1. 目的

日本株専門の「銘柄分析 兼 勉強ツール」。PC専用。
AIは売買の正解を当てる装置ではない。複数のシナリオと根拠を示し、利用者が自分で次の展開を考える「相場観」と「変動感覚」を養うための分析・学習ツールである。

## 2. 絶対条件

1. **運用費$0。** 有料API・Claude API従量課金を使わない。Claude Code の中で完結する。
2. **売買の断定をしない。** 「買い」「売り」「推奨」を画面にも分析文にも出さない。出すのはシナリオ・根拠・崩れる条件・確認すべき点。
3. **数字には出典を付ける。** 分析ごとに `sources` を必ず持つ。取得できなかった資料は `missing` に書き、画面に「未取得」と明示する。数字の捏造・推測での穴埋めは禁止。
4. **収集はスクリプト、分析はClaude、表示はアプリ。** Claude は生HTMLを読まず、スクリプトが作る要約（digest）を読む。digest は1銘柄8KB以内。
5. **グラフ・図解を主役にする。** 数値は図に変換して見せる。文章だけのブロックを作らない。
6. **file:// で動く。** アプリは `fetch` を使わず、`<script src>` でデータを読む。サーバー不要。
7. **外部サイトへの配慮。** 1回の実行で1サイト最大4リクエスト、間隔1秒以上、タイムアウト15秒、リトライ1回、User-Agent明示。

## 3. 使い方

```
/kabu <銘柄名 or コード> [型]
```

| 型 | 引数 | 中身 | 重さ |
|---|---|---|---|
| クイック診断（既定） | 省略 / `クイック` | 4点診断・株価チャート・業績推移・割高割安・シナリオ・需給・チェックリスト・学びノート | 軽 |
| 決算 | `決算` | 決算短信の5点解説。`決算 3点` で有報・中計も読む | 重 |
| チャート | `チャート` | サポート／レジスタンス・10項目チェックリストの理由・売買タイミングの考え方 | 中 |
| ニュース | `/kabu <銘柄> ニュース <出来事>`、`/kabu ニュース 探して` | 出来事の影響度・一時的か長期か・過去事例との比較。「探して」は直近1週間に株価が大きく動いた日本企業の出来事を1つ選ぶ | 中 |
| 反省 | `反省 <購入日> <購入価格>` | 買いタイミングの振り返りと次回のチェックポイント | 軽 |
| 市場 | `/kabu 市場` | 相場の高い安い・為替・金利・地政学ランキング・今日のニュース5本 | 中 |
| 用語 | `/kabu 用語 <言葉か質問>` | 用語・考え方の解説（因果の流れ図つき）。用語帳に追加 | 極軽 |

実行すると分析結果が保存され、アプリ（`app/index.html`）がその銘柄ページを開く。

## 4. アーキテクチャ

```
/kabu 日立 →（スキル）
  （cd src してから）
  ① node collect/run.mjs 6501 --type quick   収集と指標計算（トークン0）
       → data/stocks/6501/prices.json, profile.json, digest.md
  ② Claude が digest.md と Web検索で分析 → data/stocks/6501/analyses/2026-10-03-quick.json
  ③ node tools/validate.mjs <その JSON>      スキーマ検証（不合格なら②を直す）
  ④ node build.mjs                           data/ 全体 → app/data.js と デスクトップのビューア
  ⑤ open "file://$HOME/Desktop/KABU LAB.html#/stock/6501/quick"
```

### ディレクトリ（2026-10-03 整理。利用者指示「散らかっていてどこを押せばいいか分からない」）

フォルダ直下は5つだけにする。利用者が普段開くのはデスクトップの `KABU LAB.html` だけ。

```
~/Desktop/KABU LAB.html   ★ビューア。ダブルクリックで分析結果が開く。分析のたびに build が作り直す（単体で動く1ファイル）

kabu-lab/
├── README.md             はじめに（どこを開けばよいか・フォルダの意味）
├── DESIGN.md             設計書（契約）
├── data/                 分析データ（学習ノートの本体。コミットする）
│   ├── stocks/<code>/{profile.json, prices.json, digest.md, digest-kessan.md, finance.json, memo.md, analyses/<date>-<type>.json}
│   ├── market/{<date>-raw.json, series.json, sectors.json, movers.json, picks-prices.json, digest-market.md, headlines.json, <実行日>.json＝市場型の分析}
│   ├── refresh.json（自動更新の結果）
│   └── glossary/<用語>.json（用語型。1語1ファイル）
├── src/                  プログラム一式（コマンドはここで実行する）
│   ├── package.json, build.mjs, config.json
│   ├── collect/          収集スクリプト（run.mjs, prices.mjs, kabutan.mjs, kabutan-finance.mjs, market.mjs, lib/）
│   ├── tools/            validate.mjs, fetch-doc.mjs, doc-slice.mjs, pdf2text.py
│   ├── schemas/          型ごとの JSON スキーマ、indicators.md
│   ├── app/              アプリ本体（index.html, styles.css, app.js, charts.js, test-hooks.js, data.js＝生成物）
│   ├── tests/            node --test
│   └── skill/SKILL.md    /kabu スキルの正文（~/.claude/skills/kabu/ へ設置）
└── archive/              制作時の資料（mocks/・スクリーンショット・モック指示書）。普段は開かない
```

- **ビューア**：`build.mjs` は `src/app/data.js` を作った後、`src/app/index.html` に styles・charts・app・data をすべて埋め込んだ単体HTMLを `src/config.json` の `viewerPath`（既定 `~/Desktop/KABU LAB.html`）へ書き出す。test-hooks は含めない。外部読み込みは Google Fonts だけ。書き出しに失敗しても build 全体は失敗させず、警告を出す。
- 生データ（`data/stocks/<code>/raw/`）はコミットしない。
- スキルの手順は `cd ~/Desktop/kabu-lab/src` で実行し、表示は `open "file://$HOME/Desktop/KABU LAB.html#/stock/<code>/<type>"`。

### 指標計算（collect/lib/indicators.mjs。機械テスト必須）

移動平均（5・25・75・200日）と乖離率、RSI(14)、出来高の20日平均比、スイング高値・安値（前後8日）、価格帯別出来高（直近250日）、窓（1.5%以上）、ゴールデンクロス／デッドクロスの日付、終値が75日線・200日線を跨いだ日付、52週高値・安値。
digest.md にはこれらの結果と直近20日の四本値を載せる。チェックリスト10項目の判定はClaudeが digest の数値を根拠に行い、根拠を1文で書く。

### 効率化（2026-10-03 利用者指示）

- **会社メモ** `data/stocks/<code>/memo.md`：変わりにくい事実（事業の構成と事業別利益、決算発表の時期、会社の想定為替レート、株価を動かしやすい要因、出典URL）を箇条書きで残す。分析のたびに Claude が読み、新しく分かったことを追記・更新する。2回目以降はメモにある事項を調べ直さない。3KB以内。
- **再収集の省略**：digest.md の生成日が今日で、日足の最終日が変わっていなければ、収集を省いて既存の digest を使う（`node collect/run.mjs <code> --if-stale`）。
- **複数銘柄**：`/kabu 日立 伊藤忠 三菱商事` のように並べたら順に処理し、build と表示は最後に1回。

## 5. 分析JSON（共通の骨格）

```json
{
  "schema": "kabu-analysis@1",
  "type": "quick",
  "code": "6501",
  "name": "日立製作所",
  "date": "2026-10-01",
  "price": { "close": 5510, "change": 21, "changePct": 0.38, "asOf": "2026-10-01" },
  "summary": "一言の要約（60字以内）",
  "sections": { },
  "terms": [ { "term": "PER", "def": "株価が1年分の利益の何倍か" } ],
  "insight": "今回の気づき（1〜2文）",
  "sources": [ { "title": "株探 日立製作所", "url": "https://kabutan.jp/stock/?code=6501" } ],
  "missing": [ "事業別利益（決算資料を未取得）" ]
}
```

`sections` の中身が型ごとに異なる。quick 型の `sections`：

| キー | 中身 |
|---|---|
| `diagnosis` | 4件。`{key: quality/value/supply/trend, label, level(0〜1), verdict, reason}` |
| `chart` | `{resistance:[{price,label}], support:[{price,label}], pins:[{date,label}]}`。足と移動平均は prices.json から描く |
| `performance` | `[{period, sales, profit, eps, dividend, forecast}]` 3期分 |
| `valuation` | `[{key, value, unit, ref, refLabel, max}]`（PER・PBR・PSR） |
| `segments` | `[{name, profit, margin, note}]`。未取得なら省き `missing` に書く |
| `scenarios` | 3件。`{kind: bull/base/bear, title, text, target, breakIf}`。基準価格と日付は `price` を使う |
| `margin` | `[{date, sell, buy, ratio}]` 直近5週 |
| `checklist` | 10件固定順。`{id, status: done/progress/none, reason}` |

補足（P1a で確定）:
- `scenarios[].target` は `{label, price}` または `{label, low, high}`。答え合わせで数値を使う。
- `performance` は1〜3期。取得できた期だけを載せる（穴埋め禁止）。
- `valuation[].max` はゲージの上限（PER 40・PBR 5・PSR 5 を既定）。
- `window.KABU` には `checklistItems`（C01〜C10 の名称）も入る。checklist の id と名称の対応は `schemas/checklist-items.json` が正。
- TOPIX は指数を取得できないため連動ETF（1306.T）で代用し、その旨を画面に注記する。
- 型のキー（URLとファイル名に使う）: quick / kessan / chart / news / hansei / market / yougo。
- テストの入口は `npm test`（`tests/index.js` が `*.test.mjs` を読む）。

他の型のスキーマは各フェーズの冒頭で本書に追記する。

### 5.1 chart 型（P2）

`type: "chart"`。骨格（schema〜missing）は共通。`sections`：

| キー | 中身 |
|---|---|
| `timeframes` | 3件固定。`{frame: monthly/weekly/daily, trend: up/flat/down, text}`（text 120字以内）。上位の足から順に流れを述べる |
| `levels` | 2〜12件。`{kind: resistance/support, low, high, strength(1〜5), label, basis:[...]}`。`low`=`high` なら線、違えば帯。`basis` は根拠の語（「過去の高値」「役割の逆転」「75日線」「節目」「価格帯別出来高」など）1〜4個 |
| `heat` | 4件固定。`{key: ma25dev/rsi/change3d/volume, value, state: calm/warm/hot, note}`。過熱の物差し（25日線乖離・RSI・直近3日の騰落率・出来高の20日平均比） |
| `checklist` | 10件固定順。`{id, status: done/progress/none, reason, watch}`。`reason` 160字以内、`watch` は進行中の項目で次に見る点（80字以内、他は空文字） |
| `plans` | 3件固定。`{kind: pullback/breakout/wait, title, when, zone:{low,high}, stop:{price,label}, target:{price,label}, pros, cons}`。「〜なら」という条件つきの考え方として書く。断定しない |
| `lesson` | `{title, text}`。このチャートから学べる読み方を1つ（text 160字以内） |

### 5.2 kessan 型（P2）

`type: "kessan"`。`sections`：

| キー | 中身 |
|---|---|
| `period` | `{label, announced, docTitle}`。例 label「2027年3月期 第1四半期」 |
| `verdict` | `{grade: good/normal/bad, label, reason}`。決算の出来の評価（好決算／普通／悪決算）であり売買の判断ではない |
| `points` | 3件固定。`{title, text}`（text 120字以内）。判定の理由 |
| `results` | 2〜6件。`{key, label, value, unit, yoyPct, note}`。売上・本業の利益・純利益など |
| `driver` | `{title, text}`。伸びた（落ちた）一番の理由 |
| `progress` | `{label, pct, pace, note}`。通期予想に対する進捗率。`pace` は均等ペース（1Q=25 など） |
| `margin` | `{label, pct, prevPct, peer}`。利益率と同業比較の一言（概算なら「概算」と明記） |
| `outlook` | `{stance: bullish/neutral/cautious, revision: up/none/down, text, forecast:[{label, value, unit, yoyPct}]}` |
| `plusMinus` | `{plus:{title, text}, minus:{title, text}}` |
| `investments` | 1〜5件。`{title, amount, text}`。何にお金を使っているか |
| `finance` | `{items:[{label, prev, curr, unit}], verdict, text}`。現金・有利子負債・D/Eレシオ・自己資本比率・営業CF など |
| `returns` | `{dividends:[{period, value, forecast}], eps:[{period, value, forecast}], buyback}` |
| `segments` | quick と同じ形（任意） |
| `next` | 1〜3件の文字列。次の決算で確認する点 |
| `deep` | 任意（`決算 3点`）。`{yuho:{earner, dragger, oneOff, risks:[...]}, plan:{name, goal, targets:[{label, target, actual, forecast, unit, nums}], consistent, realistic}}`。`target`/`actual`/`forecast` は表示用の文字（「7〜9%」など）。`nums:{targetLow, targetHigh, actual, forecast}` と `unit` を入れると、目標の範囲と実績・今期予想を図で比べられる |

文字数・件数の上限の正は `schemas/*.schema.json`。chart の checklist は「進行中の項目だけ `watch` 必須」。kessan の `investments.amount` は億円の数値か null。

### 5.3 P2 で足す収集

- `build.mjs` は各銘柄の指標（移動平均の系列・価格帯別出来高・スイング・クロス・窓・週足と月足への集約）を `stocks[code].indicators` として data.js に入れる。画面は自前で再計算しない。
- digest に「移動平均線へのタッチと反発」（安値が75日線・200日線の±1.5%以内に入り、その後5日以内に終値が3%以上戻した日）を直近250日ぶん追加する。
- `collect/kabutan-finance.mjs`：株探の決算ページ（`/stock/finance?code=`）から、通期と四半期の業績推移、財務（自己資本比率・有利子負債倍率など）、キャッシュフローを取り `finance.json` と `digest-kessan.md`（8KB以内）を書く。`node collect/run.mjs <code> --type kessan`。
- `tools/fetch-doc.mjs <code> <url> --name <名前>`：決算短信などのPDFを `raw/docs/` に保存し、pdf2text でテキスト化し、ページ数と文字数を出す。`tools/doc-slice.mjs <txt> --pages 1-2,8 | --grep <語>`：必要なページだけを取り出す（Claude が読むのは1資料あたり20KBまで）。

### 5.4 market 型（P3）

`type: "market"`。`code` は null、`name` は「市場」、`price` は日経平均。保存先は `data/market/<最終取引日>.json`。画面は `#/market`（日付の切替で履歴）。`sections`：

| キー | 中身 |
|---|---|
| `level` | 相場の高い安い。`{verdict(12字), position(0〜1。0=安い・1=高い), text(160字), gauges:[{key, label, value, unit, ref, refLabel, max}]}`。gauges は2〜4件（日経平均の予想PER、200日線からの乖離、52週の値幅の中の位置など。取れたものだけ） |
| `outlook` | 3件固定（bull / base / bear）。quick の `scenarios` と同じ形。来年末までの日経平均の流れ |
| `fx` | `{direction: weak/strong/range（円安方向・円高方向・もみ合い）, text(160字), effects:[{who(16字), dir: plus/minus, text(80字)}], outlook(160字)}`。effects は2〜4件（輸出企業・輸入企業・家計など、誰にどう効くか） |
| `rates` | `{items:[{key, label, value, unit, note}], text(160字)}`。items は1〜4件（米10年金利・日本10年金利・政策金利など取れたもの）。金利と株価の関係を一言 |
| `geo` | 5件固定・影響の大きい順。`{name(20字), level(1〜5), text(120字), sectors:[{name(12字), dir: plus/minus}]}`。sectors は1〜4件 |
| `news` | 3〜5件。`{title(40字), text(120字), dir: plus/minus/neutral, sectors:[文字列], url}`。今日の日本株に効きそうなニュースを初心者の言葉で |
| `calendar` | 0〜5件。`{date, label(30字)}`。今後2週間ほどの予定（決算・統計・会合） |

収集：`node collect/market.mjs [--if-stale]` が、これまでの `<date>-raw.json` に加えて `series.json`（日経平均・ドル円・米10年金利の日足2年分）と `digest-market.md`（4KB以内）を書く。digest には各指標の直近値・前日比・1か月／3か月／1年の変化率、日経平均の25・75・200日線と乖離・RSI・52週高値安値とその中の位置、ドル円の25・75日線と向きを載せる。Yahoo へのリクエストは合計4回以内。日経平均の予想PERと日本の金利は Claude が Web検索で補う。

### 5.5 news 型（P3）

`type: "news"`。主役の会社を1社決め、その銘柄の分析として保存する（`data/stocks/<code>/analyses/<最終取引日>-news.json`）。会社を特定できない出来事（景気・政策・地政学）は市場型で扱う。収集は quick と同じ digest を使う。`sections`：

| キー | 中身 |
|---|---|
| `event` | `{title(40字), date, kind(12字), what(160字)}`。何が起きたか。kind は「不祥事」「業績修正」「提携・買収」「規制」「事故」など |
| `impact` | `{level(1〜5), dir: plus/minus/mixed, duration: short/mid/long, text(160字), factors:[{label(20字), dir: better/worse, text(80字)}]}`。duration は 一時的（数日〜数週）／数か月／長引く（1年以上）。factors は2〜4件（長引くかどうかを分ける要因） |
| `reaction` | `{from:{date, price}, to:{date, price}, changePct, text(120字)}`。出来事の前日の終値から直近まで。数字は digest から |
| `chart` | `{pins:[{date, label}]}` 1〜5件。株価チャートに出来事の日を示す |
| `cases` | 2〜4件。`{name(30字), year, dropPct, days, recoveryMonths, outcome(80字), similar(80字), different(80字), url}`。過去の似た事例。`dropPct`（初動の騰落率）・`days`（その日数）・`recoveryMonths`（元の水準に戻るまでの月数。戻っていなければ null）は出典で確認できた数字だけを入れ、無ければ null |
| `related` | 0〜5件。`{code, name, relation(20字), dir: plus/minus/neutral}`。波及しそうな会社・業種（code は分かれば） |
| `takeaway` | `{text(160字), checks:[文字列(60字)]}`。今回はどう受け止めるか。checks は次に確認する点1〜3件 |

### 5.6 hansei 型（P3）

`type: "hansei"`。`/kabu <銘柄> 反省 <購入日> <購入価格>`。保存先は `analyses/<最終取引日>-hansei.json`。「いま売るべきか」には答えない（振り返りと次回の確認点だけ）。

`node tools/entry-stats.mjs <code> <購入日> <購入価格>` が prices.json から次を計算して標準出力に出す（2KB以内。機械テスト必須）：購入日の四本値と購入価格がその日の値幅に収まるか、購入日の25日線乖離・RSI・直近3日の騰落率・出来高の20日平均比、25・75・200日線の位置と向き、直前のスイング高値・安値、購入後の最大含み益と最大含み損（日付つき）、最終取引日の損益率、経過営業日数。購入日が休場日なら翌営業日に寄せ、その旨を出す。データの範囲外なら exit 1。

| キー | 中身 |
|---|---|
| `entry` | `{date, price, adjusted, note(80字)}`。adjusted は購入日を営業日に寄せたとき true |
| `result` | `{asOf, close, pnlPct, maxUpPct, maxUpDate, maxDownPct, maxDownDate, days}` |
| `at` | 4件固定順（ma25dev / rsi / change3d / volume）。chart の `heat` と同じ形。買った日の過熱の物差し |
| `position` | `{trend: up/flat/down, text(160字), support:{price, label}, resistance:{price, label}}`。買った日がチャートのどこだったか。support・resistance は無ければ null |
| `good` | 0〜3件。`{title(20字), text(120字)}`。良かった点 |
| `improve` | 1〜3件。同じ形。改善点 |
| `alt` | 0〜2件。`{title(20字), when(80字), zone:{low, high}, text(120字)}`。別の入り方。画面に「後から見た話」と注記する |
| `nextChecks` | 3〜5件。`{label(20字), how(80字)}`。次に買う前に確認すること |
| `chart` | `{pins:[{date, label}], levels:[{kind: resistance/support, low, high, label}]}`。各0〜4件。購入日と購入価格の印は `entry` から描く |
| `lesson` | `{title, text(160字)}` |

### 5.7 yougo 型（P3）

`/kabu 用語 <言葉か質問>`。1語1ファイルで `data/glossary/<用語>.json`（ファイル名は用語の `/ \ : * ? " < > |` と空白を `_` に置換）。銘柄の分析ではないので骨格は別：

```json
{ "schema": "kabu-term@1", "type": "yougo", "term": "金利と株価", "reading": "きんりとかぶか", "category": "マクロ",
  "def": "80字以内の一言の定義", "body": "初心者向けの説明（300字以内）", "analogy": "身近なたとえ（120字以内）",
  "flow": [ { "label": "金利が上がる", "dir": "up" }, { "label": "借りるお金が高くなる", "dir": "up" }, { "label": "会社の利益が減る", "dir": "down" }, { "label": "株価に下向きの力", "dir": "down" } ],
  "seesaw": { "left": "金利", "right": "株価", "note": "片方が上がるともう片方に下向きの力" },
  "example": "数字を使った例（160字以内）", "stockLink": "株価とどう関係するか（160字以内）", "pitfall": "よくある誤解（120字以内）",
  "related": ["長期金利", "PER"], "addedAt": "2026-10-03", "sources": [] }
```

- `category` は 指標／チャート／決算／需給／マクロ／制度／その他。`flow` は2〜5件（因果の流れ図。label 16字以内、dir は up / down / none）。`seesaw` は逆に動く2つの関係を説明するときだけ（任意）。`reading`・`related`（0〜5）・`sources`（0件可）は任意。
- build は `data/glossary/*.json` を用語帳に統合する（分析の `terms` と同じ語があれば、こちらの定義を優先し、詳しい解説つきとして扱う）。

### 5.8 学習機能（P3）

- **用語帳**（`#/glossary`、`#/glossary/<用語>`）：全分析の `terms` と用語型の解説を1つの一覧にする。絞り込み（文字検索・分類）、初出の銘柄と日付へのリンク、詳しい解説つきの語は開くと流れ図・シーソー図・たとえ・例・誤解を表示。「定義をかくす」切替（思い出してから開く暗記用）。
- **気づきノート**（`#/notes`）：全分析の `insight`、chart と hansei の `lesson`、hansei の `nextChecks` を日付の新しい順に並べる。型と銘柄で絞り込み、元の分析へリンク。
- **シナリオの答え合わせ**：quick の `scenarios` と market の `outlook` について、分析日より後の株価（日経平均）があれば、基準価格・3つの目安（線または帯）・その後の実際の値動きを1つの図に重ねる。経過営業日数と、現在値にいちばん近い目安（機械的な距離の比較であり評価ではない旨を注記）を示す。5営業日未満は「まだ日が浅い」と表示。銘柄ページのクイック診断と市場ページに置き、気づきノートから一覧でたどれる。build が `review`（分析ごとの基準・目安・その後の終値列）を data.js に入れ、画面は再計算しない。

### 5.9 自動更新（P5。2026-10-05 利用者指示「毎回最新に更新される仕組みを、API課金なしで」）

二層に分ける。数字と見出しはスクリプトで更新し（トークン0）、解説は Claude Code の定時タスクで更新する（サブスクリプションの利用枠内。API課金なし）。

**第1層 `node tools/refresh.mjs [--no-viewer]`（トークン0）**
1. 市場の収集（`collect/market.mjs` と同じ処理）。
2. 登録銘柄（`data/stocks/<code>/analyses/` に分析が1件以上ある銘柄）の株価と銘柄情報の再収集（quick 型の収集と同じ。digest も作り直す）。銘柄と銘柄の間は2秒以上あける。
3. 見出しの収集 `collect/headlines.mjs` → `data/market/headlines.json`。
4. build（ビューアも作り直す。`--no-viewer` で省略）。
- どれかが失敗しても残りを続ける。結果を `data/refresh.json` に書く：`{at, steps:[{key: market/stocks/headlines/build, ok, message}], stocks:[{code, ok, lastDate, message}]}`。build はこれを data.js の `refresh` に入れる。全部成功で exit 0、一部失敗で exit 2、build 失敗で exit 1。
- **見出し**：公開RSSだけを使う（NHK 経済 `https://news.web.nhk/n-data/conf/na/rss/cat5.xml`、Yahoo!ニュース 経済 `https://news.yahoo.co.jp/rss/topics/business.xml`、日本銀行 新着 `https://www.boj.or.jp/rss/whatsnew.xml`。各1リクエスト）。`{fetchedAt, items:[{title, url, source, publishedAt}]}`。新しい順に最大30件、同じ題名は1つにまとめる。題名とリンクだけを持ち、本文は取らない。1つのRSSが失敗しても他は載せる。
- 銘柄ごとの分析（クイック診断など）は自動でやり直さない。株価・チャート・答え合わせだけが進み、分析には鮮度の印が付く。

**第2層 定時タスク（平日 7:30 と 16:00）**
- Claude Code の定時タスクが `/kabu 市場 定時` を実行する：refresh → 市場型の分析 → 検証 → build。利用者への質問・ブラウザを開く動作はしない。デスクトップアプリが起動している間だけ動く（閉じていたら次の起動時に実行）。
- 市場型の分析のファイル名は**実行日**（日本時間）にする：`data/market/<実行日>.json`。`date` は実行日、`price.asOf` は日経平均の最終取引日。同じ日の2回目は上書きする（朝＝寄り付き前の版、夕＝大引け後の版）。手動の `/kabu 市場` も同じ規則。
- 市場型に任意欄 `sections.edition`（`pre`＝寄り付き前／`post`＝大引け後／`other`）を足す。画面は分析日の横に版を表示する。
- 定時の分析は前回の分析を読み、変わっていない項目（地政学の文章・用語）を流用して短く済ませる。Web検索は3回まで。

**画面**
- **データ更新の時刻**：全ページの共通部（ヘッダかフッター）に「データ更新 10/05 07:21」。失敗した手順があれば注意色で「一部失敗」とし、どれが失敗したかを読める。`refresh` が無ければ出さない。
- **最新の見出し**：市場ページに「最新の見出し（自動取得・解説なし）」の枠。出典名・時刻・題名（リンク）。今日のニュース（Claude の解説つき）とは別枠にして、混同しないようにする。取得から3日以上たっていたら「古い見出し」と表示。
- **鮮度の印**：各分析に、分析の基準日（`price.asOf`）より後の取引日数を「◯営業日前の分析」として表示する（銘柄は株価データ、市場は日経平均の系列から数える）。0日は表示なし、1〜4日は控えめ、5日以上は注意色。ホームの銘柄ライブラリ、銘柄ページの日付切替の近く、市場ページに出す。

### 5.10 業種の動きと注目候補（P6。2026-10-05 利用者指示「市場分析→どんな銘柄が上がりそうか→個別分析の順。どのジャンル・どの銘柄が上がりそうか、上がったかも出す」）

市場型に「上がった（事実）」と「追い風を受けそう（見立て）」を足す。**§2-2 は変えない**：「買い」「売り」「推奨」とは書かず、**注目候補**として理由と崩れる条件を必ず付ける。向かい風のジャンルも並べる。見立ては後で必ず答え合わせする。

**収集（トークン0。`collect/market.mjs` と refresh に足す）**
- **業種の動き** `data/market/sectors.json`：TOPIX-17 の業種別ETF（1617 食品／1618 エネルギー資源／1619 建設・資材／1620 素材・化学／1621 医薬品／1622 自動車・輸送機／1623 鉄鋼・非鉄／1624 機械／1625 電機・精密／1626 情報通信・サービスその他／1627 電力・ガス／1628 運輸・物流／1629 商社・卸売／1630 小売／1631 銀行／1632 金融（除く銀行）／1633 不動産）の終値から、1日・1週（5営業日）・1か月（21営業日）の騰落率。`{asOf, items:[{key, code, name, close, d1, w1, m1}]}`。指数そのものは取れないのでETFで代用し、画面に注記する。
- **値上がり・値下がりの上位** `data/market/movers.json`：東証プライムの当日の値上がり率・値下がり率の上位10銘柄ずつ。`{asOf, source, up:[{code, name, pct, close}], down:[...]}`。取得元は実装時に確かめ（株探のランキングなど、1サイト4リクエスト以内）、安定して取れなければ持たずに `missing` 扱いにする（推測で埋めない）。
- **候補の株価**：直近60日の市場分析に出てきた注目候補のコードの終値を取り、`data/market/picks-prices.json` に持つ（Yahoo の複数銘柄取得で1〜2リクエスト）。
- `digest-market.md` に業種の騰落率（17業種）と値上がり・値下がりの上位を載せる。上限を 6KB にする。

**分析（市場型の `sections` に足す。どちらも任意欄だが、スキルでは毎回書く）**

| キー | 中身 |
|---|---|
| `sectorNote` | 160字以内。上がった業種・下がった業種の理由を一言（digest の騰落率とニュースから） |
| `themes` | 3〜6件。`{name(16字), dir: tailwind/headwind, horizon: short/mid, sectorKey, reason(120字), stocks:[{code, name(20字), why(60字)}], breakIf(80字)}`。追い風を2件以上、向かい風を1件以上。`horizon` は short＝数日〜数週／mid＝数か月。`sectorKey` は TOPIX-17 のETFコード（該当なしは null）。`stocks` は0〜3件で、そのジャンルの代表的な上場企業（実在のコード。自信のないコードは書かない）。`breakIf` はこの見立てが崩れる条件 |

**build と画面**
- data.js に `market.sectors`・`market.movers`・`market.picks` を入れる。`picks` は分析ごとの注目候補の追跡：`{date, asOf, theme, dir, code, name, base, latest, pct, nikkeiPct, days}`（`base` は分析の基準日の終値、`nikkeiPct` は同じ期間の日経平均の騰落率。株価が無ければ null）。画面は再計算しない。
- 市場ページに足す枠：
  - **業種の動き**：17業種の横棒（上げ下げで色分け・騰落率順）。1日／1週／1か月の切替。`sectorNote` を添える。分析が無くても数字だけで出す。
  - **値上がり・値下がりの上位**：左右に10銘柄ずつ（コード・社名・騰落率）。登録済みの銘柄は銘柄ページへ、未登録は `/kabu <コード>` の案内。
  - **追い風・向かい風と注目候補**：ジャンルごとのカード。追い風と向かい風を色と位置で分け、理由・期間・崩れる条件・その業種の直近の騰落率（`sectorKey`）を示す。候補の銘柄は押すと、登録済みなら銘柄ページへ、未登録なら `/kabu <コード>` をコピーできる（市場→候補→個別分析の流れ）。枠に「注目候補は売買の推奨ではありません」と明記。
  - **注目候補の答え合わせ**：過去の候補の一覧（挙げた日・ジャンル・追い風／向かい風・基準→直近の騰落率・同期間の日経平均との差・経過営業日数）。追い風の候補が日経平均を上回ったか、向かい風が下回ったかを数で集計して見せる（評価語は付けず、数と図で）。5営業日未満は「まだ日が浅い」。
- ホームの市場パネルの近くから、今日の上昇業種の上位3つが分かるとよい（配置バランスは変えない範囲で）。

## 6. 画面

見た目の正は `mocks/mock-6-final.html`（案4の高密度HUD＋業績推移と需給の立体棒グラフ。メーター・株価チャート・ゲージは平面）。配色・フォント・枠・文言の調子はこれに従う。

- **ホーム**（`#/`）：銘柄ライブラリ（表）、市場パネル、地政学、分析メニュー、今日の用語。データがない欄は「未実行」。
- **銘柄ページ**（`#/stock/<code>/<type>`）：型タブ。同じ型を複数回実行したら日付の切替で履歴を見られる。
- **画面の切替**：ヘッダにホーム・市場・用語帳・気づきノートの切替を置く（確定版モックの調子に合わせる）。ホームの市場パネル・地政学パネル・今日の用語は、それぞれ市場ページ・用語帳へ飛べる。
- **市場ページ**（`#/market`、`#/market/<date>`）：日経平均とドル円の折れ線（`series.json`）、高い安いのメーターと物差し、3つのシナリオと答え合わせ、為替の影響図（誰にプラス・マイナスか）、金利、地政学ランキング（星と影響する業種）、今日のニュース、予定。分析が無く raw だけのときは指標だけ表示し、残りは「未実行」。
- **ニュース型・反省型**は銘柄ページの型タブに加える（§5.5・§5.6）。ニュース型は影響度の星・期間の3段階表示・株価チャート（出来事の日に印）・過去事例の比較図（初動の騰落率と回復までの月数を横棒で。null は「不明」）。反省型は株価チャート（購入日と購入価格の印、その後の最大含み益・含み損）・買った日の過熱の物差し・良かった点と改善点・次回の確認カード。
- **用語帳**（`#/glossary`）、**気づきノート**（`#/notes`）、**シナリオの答え合わせ**：§5.8。
- 対応幅 1280〜1920px。横スクロール禁止。最小文字12px、本文コントラスト比4.5:1以上、本文は発光させない。
- **情報優先（2026-10-03 利用者指示）**：1画面に収めるために情報を省かない。縦スクロールは可。枠は中身に合わせて伸ばす。全体の配置バランス（確定版モックの並び）は変えない。
- **稼ぎ頭マップの展開**：通常は上位3事業＋「その他 N事業」。「その他」を押すとパネルが左隣（業績推移の上）へ重なる形で横に広がり、全事業を利益額の横棒つきで一覧できる（利益率があれば併記）。もう一度押すか Esc・枠外クリックで元に戻る。展開中も他のパネルの配置は動かさない。
- **チェックリストの理由**：各セルを押す（またはキーボードで選ぶ）と、その項目の判定理由（`reason`）がチェックリストの下に表示される。初期状態では「進行中」の項目の理由を並べておく。

## 7. フェーズ

| フェーズ | 内容 | 完了条件 | 担当 |
|---|---|---|---|
| P1a | データ基盤：収集・指標計算・quickスキーマと検証・build・機械テスト。日立のサンプル分析JSON（モックと同じ中身） | `node --test` 全通過。`node collect/run.mjs 6501` が実データで digest を作る | Opus |
| P1b | アプリ：ホームと銘柄ページ（quick）を data.js から描画。確定版モックと同じ見た目 | 日立のサンプルで確定版モックと見た目が一致。別銘柄のデータでも崩れない | Opus |
| P1c | スキル v0 と通し運転。`/kabu` を実銘柄で1本通す | 利用者が実際に `/kabu` を打って触る（縦切りゲート） | メイン |
| P2a | 収集の拡張（§5.3）と chart・kessan のスキーマ・検証・フィクスチャ | `npm test` 全通過。実銘柄で kessan の digest が作れる | Opus |
| P2b | チャート型・決算型の画面 | フィクスチャと実データで崩れなし | Opus |
| P2c | スキルに2つの型を追加し、実銘柄で通す | 触って確認 | メイン |
| P3a | 基盤：4つの型のスキーマ・検証・フィクスチャ（標準・極端・欠損多め）、市場の収集拡張（series・digest-market）、entry-stats、build 拡張（market 履歴・glossary/・review） | `npm test` 全通過。実データで digest-market と entry-stats が出る | Opus |
| P3b | 画面1：ヘッダの切替、市場ページ、ニュース型・反省型のタブ | フィクスチャで崩れなし。`__KABU_TEST.runAll()` 通過 | Opus |
| P3c | 画面2：用語帳・気づきノート・シナリオの答え合わせ | 同上 | Opus |
| P3d | スキルに4つの型を追記し、実データで各1本通す | 触って確認 | メイン |
| P5a | 自動更新の第1層（§5.9）：refresh・見出し・build・画面（更新時刻・見出し枠・鮮度の印）・市場型の edition 欄 | `npm test` 全通過。`node tools/refresh.mjs` が実データで通る | Opus |
| P5b | スキルに定時の手順を追記、定時タスク2本（平日 7:30・16:00）の登録、実走1回 | 定時タスクが1回通る | メイン |
| P6a | 業種の動きと注目候補（§5.10）：収集（sectors・movers・picks-prices）・digest・スキーマ（themes・sectorNote）・build（picks）・画面4枠・テスト | `npm test` 全通過。実データで sectors と movers が出る | Opus |
| P6b | スキルに themes の書き方を追記、実データで市場型を1本通す | 触って確認 | メイン |
| P4 | スキル仕上げ（skill-forge で監査と発動テスト）、起動の入口 | 完成 | メイン |

## 8. 運用ルール

- コミットは小さく。メッセージは `P1a: …` の形。`app/data.js` と `data/**/raw/` はコミットしない。
- 機械テスト（`node --test`）全通過を全フェーズの品質要件にする。バグを直したら同類を検出するテストを足す。
- アプリには `window.__KABU_TEST.runAll()` を用意する（全セクションが描画され、SVGパスに NaN がなく、実行後に初期状態へ戻る）。
- 依存パッケージを増やさない（Node 標準と pypdf のみ）。チャートライブラリ禁止。外部読み込みは Google Fonts のみ。

## 9. 決定の経緯

- 2026-10-02 方式＝Claude Code コマンド型＋専用スキル。出力＝メニュー型（型を省くとクイック診断）。
- 2026-10-02 モック5案を比較。2026-10-03 デザイン確定＝案4＋立体棒グラフ（`mock-6-final.html`）。
- 2026-10-03 P1a 完了（収集・指標・検証・build・テスト37本）。メインが別銘柄で再検証のうえ合格。
- 2026-10-03 P1b 完了（アプリ画面。日立はモックと一致）。P1c の実データ通し運転（伊藤忠）で、5桁の信用残・小数の株価・利益率なしの事業で表示崩れが出たため差し戻し中。以後、フィクスチャは実データ型の極端値を必ず含める。
- 2026-10-03 P2 への申し送り: digest に「移動平均線へのタッチと反発」の日付がなく、チェックリスト C10 を過去分まで判定できない。チャート型の実装時に digest へ追加する。
- 2026-10-03 縦切りの利用者評価: スクロール可・情報の質と量を優先／文章と待ち時間はOK／回数を重ねるほど効率化したい／事業は「その他」を押して全部見たい（全体のバランスは変えない）。→ §4 効率化・§6 を改訂。
- 2026-10-03 P2a 完了（テスト106本）。株探の決算ページから通期・四半期・進捗率・修正履歴・財務・CFを取得。四半期の営業CFなど株探にない数字は決算短信PDFから読む。`indicators` の形は `schemas/indicators.md` が正。
- 2026-10-03 利用者指示: フォルダが散らかっていて分かりにくい → 直下を5つに整理（README・DESIGN・data・src・archive）。分析結果だけを見る単体ビューアをデスクトップに置き、build のたびに更新する。
- 2026-10-03 学習機能（用語帳・気づきノート・シナリオの答え合わせ）を採用。朝のニュースは市場型に含め、定時実行はしない。
- 2026-10-05 利用者指示「日々ニュースも情勢も変わる。毎回最新に更新される仕組みを、API課金なしで」→ 自動更新（§5.9）を採用。**2026-10-03 の「定時実行はしない」は失効。** 範囲＝数字・見出し・解説つき市場分析、時刻＝平日の朝と大引け後の両方。市場型のファイル名は最終取引日から実行日に変更（既存の 2026-10-02.json はそのまま）。
- 2026-10-05 利用者指示「市場分析→上がりそうな銘柄を考える→個別分析の順。ジャンルと具体的な銘柄、上がったかも出す」→ §5.10 を追加。銘柄は「注目候補」として理由・崩れる条件つきで出し、推奨はしない（§2-2 は維持）。候補のその後を日経平均と比べて答え合わせする。
- 2026-10-05 NHK 経済の RSS は旧URL（www3.nhk.or.jp）が2026-08-08で更新停止していたため、現行の news.web.nhk に差し替え。最新の項目が7日より古い RSS は「更新が止まっている可能性」として画面に出す。
- 2026-10-04 P3 完了（P3a 基盤・P3b 画面1・P3c 画面2・P3d スキル設置と市場型・用語型の実データ通し）。テスト204本。review の「その後」は `price.asOf` より後で切る（基準価格との整合を優先）。
- 2026-10-03 P3 着手（利用者指示「4つの型を一気に」）。ニュース型は主役の会社を1社決めて銘柄の分析として保存（会社を特定できない出来事は市場型）。用語型は `data/glossary/<用語>.json` の1語1ファイル（旧 `data/glossary.json`・`notes.json` も build は読み続ける）。アナリストの見方の別枠は P3 の後に判断。チャート型・決算型は利用者未評価のまま進める。

## 10. 現在地と次の一手（引き継ぎ用。作業のたびに更新する）

最終更新 2026-10-05。新しい会話で続きをやるときは、本節と `src/docs/origin-prompts.md` を先に読む。

**できていること**
- P1（データ基盤・アプリ・スキル）、P2（チャート型・決算型と3点読み）、P2d（フォルダ整理・デスクトップの単体ビューア）、**P3（市場・ニュース・反省・用語の4型、用語帳・気づきノート・シナリオの答え合わせ）**。7つの型すべてが `/kabu` で動く。**P5 自動更新（§5.9）**：`node tools/refresh.mjs`（数字・株価・見出し・build。約7秒・トークン0）と、定時タスク2本（`kabu-market-morning` 平日7:30頃、`kabu-market-close` 平日16:00頃。`/kabu 市場 定時` を実行。タスクの正文は `~/.claude/scheduled-tasks/<id>/SKILL.md`）。`cd src && npm test` は230本合格。
- 分析済み: 6501 日立（quick・kessan 3点）、8001 伊藤忠（quick・chart）、7013 IHI（quick・kessan・chart）、市場（2026-10-02）、用語「金利と株価」。8058 三菱商事は収集のみ。
- ニュース型と反省型は見本データ（`tests/fixtures/`）での画面確認まで。実データでは未実行（出来事・購入日と購入価格は利用者が指定するため）。
- スキル正文は `src/skill/SKILL.md`。直したら `~/.claude/skills/kabu/SKILL.md` へコピーする（2026-10-04 設置済み）。

**次にやること**
- 利用者の実機評価（P3 の7画面と、未評価のチャート型・決算型）。評価を契約に反映して手直し。
- P4: skill-forge でスキルの監査と発動テスト。`src/docs/origin-prompts.md` の状態欄を実装済みに更新。
- 実データでニュース型・反省型を1本ずつ通す（利用者の指定で）。

**利用者に確認中のこと**
- チャート型の「売買タイミングの考え方」の書き方、決算型の節の量、画面の長さへの評価（2026-10-04「まだ見ていない」）。
- 証券会社の目標株価・レーティングを「アナリストの見方」として別枠で載せるか（2026-10-04「P3 の後で考える」）。いまの見通しはすべて Claude の分析。

**把握している制約**
- クイック診断の事業別利益は記事頼み。正確な数字は決算型（決算短信PDF）で取る。
- 有価証券報告書の本体は自動取得していない（通期決算資料とリスク情報で代用）。
- 中計のブレットチャートは「大きいほど良い」前提。「低いほど良い」目標は未対応。
- 株探の四半期キャッシュフローは無い（決算短信から読む）。商社は売上予想なし。
- 株価データは直近250日ぶんだけを画面に渡す。それより前の購入日・出来事は印が出ず、範囲外の注記になる。
- 反省型の「直前のスイング」は、買った時点ではまだ確定していなかった山・谷を含むことがある。日経平均の52週高安は終値ベース。
- 答え合わせは分析日より後の株価が要る。次に収集するまでは「まだ値なし」。
- 定時タスクはデスクトップアプリの起動中だけ動く（閉じていたら次の起動時）。日中に refresh すると日経平均の取引中の値が「その日の終値」として系列に入る（大引け後の実行で確定値に置き換わる）。銘柄の株価は大引け後の実行でだけ取り直す。
- 見出しの出典が更新を止めたら画面に「更新が止まっているかもしれない出典」と出る。URL の差し替えは `collect/headlines.mjs` と本書 §5.9。
- `node build.mjs` は知らない引数では実行しない（`--help` で本番 build が走りビューアを上書きした事故への対策）。

**開発の作法（このプロジェクトで効いたもの）**
- 契約（本書）を先に直してから実装。実装はサブエージェント、メインは契約・監査・スキル正文。
- 画面の確認は、ビューアを一時フォルダへコピーして `python3 -m http.server` で配信し、スクリーンショットを目視。
- フィクスチャには実データ型の極端値（5桁の信用残・小数の株価・利益率なし・赤字の事業）を必ず入れる。
- サブエージェントは長い一括作業で無進捗停止することがある。小さく区切ってコミットさせ、2回止まったらメインが引き取る。
- 分析（/kabu の実行）は新しい会話で行うと軽い。
