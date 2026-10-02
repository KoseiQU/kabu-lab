#!/usr/bin/env python3
"""決算PDF → ページ区切り付きテキスト。

使い方: python3 tools/pdf2text.py <pdf> <out.txt>
各ページの前に "===== PAGE n =====" を入れる（n は1始まり）。
"""
import sys
from pathlib import Path


def main(argv):
    if len(argv) != 3:
        print("使い方: python3 tools/pdf2text.py <pdf> <out.txt>", file=sys.stderr)
        return 1
    src, out = Path(argv[1]), Path(argv[2])
    try:
        from pypdf import PdfReader
    except ImportError:
        print("エラー: pypdf がありません（pip install pypdf）", file=sys.stderr)
        return 1
    if not src.is_file():
        print(f"エラー: PDFが見つかりません: {src}", file=sys.stderr)
        return 1
    try:
        reader = PdfReader(str(src))
        if reader.is_encrypted:
            reader.decrypt("")
        parts = []
        empty = 0
        for i, page in enumerate(reader.pages, start=1):
            try:
                text = page.extract_text() or ""
            except Exception as e:  # 1ページの失敗で全体を止めない
                text = f"[このページの抽出に失敗: {e}]"
            if not text.strip():
                empty += 1
            parts.append(f"===== PAGE {i} =====\n{text.rstrip()}\n")
    except Exception as e:
        print(f"エラー: PDFを読めません: {src} ({e})", file=sys.stderr)
        return 1
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(parts), encoding="utf-8")
    n = len(reader.pages)
    note = f"（文字のないページ {empty}。画像PDFの可能性）" if empty else ""
    print(f"{out}: {n}ページ{note}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
