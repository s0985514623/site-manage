"""
產生報價單 PDF 用的中文字型。

@react-pdf/renderer 需要靜態 TTF，而 Google 提供的 Noto Sans TC 是可變字型，
所以要先固定字重再做子集化。

子集範圍刻意保留完整的 CJK 基本區（U+4E00–U+9FFF）：
客戶名稱與備註是使用者自由輸入的文字，切得太小會讓罕用字在 PDF 上
變成空白方框，而那是會直接寄到客戶信箱的東西。Ext-A 等罕用區塊才省略。

需求：pip install fonttools brotli
執行：npm run build:fonts
"""

import os
import subprocess
import sys

SRC = ".fonts-src/NotoSansTC.ttf"
OUT_DIR = "public/fonts"

WEIGHTS = [("Regular", 400), ("Bold", 700)]

# 保留的 Unicode 範圍
RANGES = [
    (0x0020, 0x007E),  # ASCII
    (0x00A0, 0x00FF),  # Latin-1 補充（°、×、÷ 等）
    (0x2000, 0x206F),  # 一般標點（—、…、「」用的引號）
    (0x20A0, 0x20BF),  # 貨幣符號
    (0x2100, 0x214F),  # 字母式符號（№、℃）
    (0x2190, 0x21FF),  # 箭頭
    (0x2460, 0x24FF),  # 圈號（①②③）
    (0x25A0, 0x25FF),  # 幾何圖形（■●）
    (0x3000, 0x303F),  # CJK 標點（、。「」『』）
    (0x3100, 0x312F),  # 注音符號
    (0x4E00, 0x9FFF),  # CJK 基本區 —— 完整保留
    (0xFE30, 0xFE4F),  # CJK 相容形式
    (0xFF00, 0xFFEF),  # 全形字元
]


def unicodes_arg():
    return ",".join("U+%04X-%04X" % (a, b) for a, b in RANGES)


def run(cmd):
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        sys.stderr.write(result.stdout + result.stderr)
        raise SystemExit("命令失敗: %s" % " ".join(cmd))


def main():
    if not os.path.exists(SRC):
        raise SystemExit(
            "找不到 %s\n"
            "請先下載：curl -sL -o %s "
            '"https://github.com/google/fonts/raw/main/ofl/notosanstc/NotoSansTC%%5Bwght%%5D.ttf"'
            % (SRC, SRC)
        )

    os.makedirs(OUT_DIR, exist_ok=True)

    for name, weight in WEIGHTS:
        instanced = ".fonts-src/instance-%d.ttf" % weight
        output = os.path.join(OUT_DIR, "NotoSansTC-%s.ttf" % name)

        # 1. 把可變字型固定在單一字重
        run([
            sys.executable, "-m", "fontTools.varLib.instancer",
            SRC, "wght=%d" % weight,
            "-o", instanced,
        ])

        # 2. 子集化並移除用不到的表
        run([
            sys.executable, "-m", "fontTools.subset",
            instanced,
            "--unicodes=%s" % unicodes_arg(),
            "--layout-features=kern,liga,locl,ccmp",
            "--no-hinting",
            "--desubroutinize",
            "--drop-tables+=GSUB,GPOS,DSIG",
            "--output-file=%s" % output,
        ])

        os.remove(instanced)
        size_mb = os.path.getsize(output) / 1024 / 1024
        print("  %s  %.1f MB" % (os.path.basename(output), size_mb))

    print("\n字型已輸出到 %s" % OUT_DIR)


if __name__ == "__main__":
    main()
