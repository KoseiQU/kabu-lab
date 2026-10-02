# KABU LAB

日本株の「銘柄分析 兼 勉強ツール」。仕様は `DESIGN.md`（契約）。運用費$0・依存パッケージなし（Node 24 標準＋pypdf）。

```
node collect/run.mjs 6501 [--type quick|chart] [--if-stale]  # 株価(Yahoo)・株探を収集し指標計算 → prices.json, profile.json, digest.md
node collect/run.mjs 6501 --type kessan [--if-stale]         # 株探の決算ページ → finance.json, digest-kessan.md（株価は取らない）
node collect/market.mjs                    # 指数・為替・金利・原油 → data/market/<日付>-raw.json
node tools/fetch-doc.mjs 6501 <PDFのURL> --name 2027-1Q-tanshin   # PDF → raw/docs/<名前>.pdf/.txt、ページ数・文字数・目次
node tools/doc-slice.mjs <txt> --pages 1-2,8 | --grep 調整後営業利益  # 必要なページ・行だけ（20KBまで）
node tools/validate.mjs <分析JSON>          # type（quick/chart/kessan）でスキーマを選び、意味検証（禁止語・順序など）。NG は exit 1
node build.mjs                             # data/ → app/data.js（window.KABU）。分析ファイル名の型と中身の type が違えば exit 1
python3 tools/pdf2text.py <pdf> <out.txt>  # PDF → ページ区切り付きテキスト（fetch-doc が内部で使う）
npm test                                   # = node --test tests/
```

収集は1回の実行で1サイト最大4リクエスト・間隔1秒以上。生HTMLとPDFは `data/stocks/<code>/raw/`（コミットしない）。
決算短信PDFのURLは `digest-kessan.md` の「決算短信PDF」節に載る（株探経由の tdnet-pdf.kabutan.jp）。
`window.KABU.stocks[code]` の `indicators`（指標）と `finance`（決算）の形は `schemas/indicators.md` を参照。
