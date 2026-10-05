# KABU LAB — 開発者向け（src/）

コマンドはすべて `src/` で実行する。分析データは兄弟フォルダ `../data/`（環境変数 `KABU_DATA_DIR` で変更可）。

日本株の「銘柄分析 兼 勉強ツール」。仕様は `DESIGN.md`（契約）。運用費$0・依存パッケージなし（Node 24 標準＋pypdf）。

```
node collect/run.mjs 6501 [--type quick|chart|news|hansei] [--if-stale]  # 株価(Yahoo)・株探を収集し指標計算 → prices.json, profile.json, digest.md（4型とも同じ digest）
node collect/run.mjs 6501 --type kessan [--if-stale]         # 株探の決算ページ → finance.json, digest-kessan.md（株価は取らない）
node collect/market.mjs [--if-stale]       # 指数・為替・金利・原油（Yahoo spark range=2y を1回）→ data/market/<日付>-raw.json, series.json（日経平均・ドル円・米10年の日足2年）, digest-market.md（4KB以内）
node collect/headlines.mjs                 # 最新の見出し（NHK 経済・Yahoo!ニュース 経済・日本銀行 新着の公開RSS、各1リクエスト）→ data/market/headlines.json（題名とリンクだけ。全部失敗なら既存を残して exit 1）
node tools/entry-stats.mjs 6501 2026-08-28 5600   # 反省型の材料: 購入日の四本値と過熱の物差し・移動平均・直前のスイング・購入後の最大含み益/損（md 2KB以内）。範囲外は exit 1
node tools/fetch-doc.mjs 6501 <PDFのURL> --name 2027-1Q-tanshin   # PDF → raw/docs/<名前>.pdf/.txt、ページ数・文字数・目次
node tools/doc-slice.mjs <txt> --pages 1-2,8 | --grep 調整後営業利益  # 必要なページ・行だけ（20KBまで）
node tools/validate.mjs ../data/stocks/6501/analyses/<file>.json          # type（quick/chart/kessan/news/hansei/market/yougo）でスキーマを選び、意味検証（禁止語・順序など）と置き場所・ファイル名の検査。NG は exit 1
node build.mjs [--no-viewer]               # ../data → app/data.js と ~/Desktop/KABU LAB.html（単体ビューア。config.json の viewerPath）。分析ファイル名の型と中身の type が違えば exit 1
node tools/refresh.mjs [--no-viewer]       # 自動更新の第1層（トークン0）: 市場 → 登録銘柄（分析が1件以上。--if-stale・間2秒）→ 見出し → build。結果は data/refresh.json。exit 0=全部成功・2=一部失敗・1=build 失敗（知らない引数も1）
python3 tools/pdf2text.py <pdf> <out.txt>  # PDF → ページ区切り付きテキスト（fetch-doc が内部で使う）
npm test                                   # = node --test tests/
```

収集は1回の実行で1サイト最大4リクエスト・間隔1秒以上。生HTMLとPDFは `data/stocks/<code>/raw/`（コミットしない）。
決算短信PDFのURLは `digest-kessan.md` の「決算短信PDF」節に載る（株探経由の tdnet-pdf.kabutan.jp）。
`window.KABU.stocks[code]` の `indicators`（指標）と `finance`（決算）、P3a で足した `market.analyses`・`market.series`・`review`・`glossary[].detail`・`notes[].kind` の形は `schemas/indicators.md` を参照。
市場型の分析は `data/market/<最終取引日>.json`、用語型は `data/glossary/<用語>.json`（骨格は `kabu-term@1`）に置く。
