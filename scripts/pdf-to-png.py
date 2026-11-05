# -*- coding: utf-8 -*-
"""
把 PDF 每一頁轉成 PNG，供版面目視檢查。

用 pypdfium2 而不是 pdftoppm：它內建 PDFium，不需要另外安裝 poppler。

需求：pip install pypdfium2
執行：python scripts/pdf-to-png.py <file.pdf> [scale]
"""

import os
import sys

import pypdfium2 as pdfium


def main():
    if len(sys.argv) < 2:
        raise SystemExit("用法：python scripts/pdf-to-png.py <file.pdf> [scale]")

    src = sys.argv[1]
    scale = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0

    if not os.path.exists(src):
        raise SystemExit("找不到檔案：%s" % src)

    stem = os.path.splitext(src)[0]
    pdf = pdfium.PdfDocument(src)

    for i, page in enumerate(pdf):
        img = page.render(scale=scale).to_pil()
        out = "%s-p%d.png" % (stem, i + 1)
        img.save(out)
        print("  第 %d 頁 → %s  (%dx%d)" % (i + 1, out, img.width, img.height))

    print("共 %d 頁" % len(pdf))


if __name__ == "__main__":
    main()
