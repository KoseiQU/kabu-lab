# KABU LAB

日本株の「銘柄分析 兼 勉強ツール」。仕様は `DESIGN.md`（契約）。運用費$0・依存パッケージなし（Node 24 標準＋pypdf）。

```
node collect/run.mjs 6501 [--type quick]   # 株価(Yahoo)・株探を収集し指標計算 → data/stocks/6501/{prices,profile}.json, digest.md
node collect/market.mjs                    # 指数・為替・金利・原油 → data/market/<日付>-raw.json
node tools/validate.mjs <分析JSON>          # スキーマ＋意味検証（禁止語・チェックリスト順など）。NG は exit 1
node build.mjs                             # data/ → app/data.js（window.KABU）
python3 tools/pdf2text.py <pdf> <out.txt>  # 決算PDF → ページ区切り付きテキスト
npm test                                   # = node --test tests/
```

収集は1回の実行で1サイト最大4リクエスト・間隔1秒以上。生HTMLは `data/stocks/<code>/raw/`（コミットしない）。
