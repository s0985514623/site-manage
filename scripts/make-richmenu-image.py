"""
產生 LINE Rich Menu 圖片（2500x843，四格）：近期到期 / 待處理報價 / 進行中專案 / 新增專案。

    python scripts/make-richmenu-image.py

輸出 scripts/assets/richmenu.png（已提交進版控，通常不需要重跑）。
格子順序必須與 scripts/line-richmenu.mjs 的 AREAS 一致。
"""
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 2500, 843
ITEMS = [
    ("近期到期", "30 天內到期"),
    ("待處理報價", "待確認、未回覆、未收款"),
    ("進行中專案", "未完成的專案"),
    ("新增專案", "按鈕逐步建立"),
]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bold = ImageFont.truetype(os.path.join(ROOT, "public/fonts/NotoSansTC-Bold.ttf"), 100)
small = ImageFont.truetype(os.path.join(ROOT, "public/fonts/NotoSansTC-Regular.ttf"), 44)

img = Image.new("RGB", (W, H), "#ffffff")
draw = ImageDraw.Draw(img)
cell = W // len(ITEMS)
for i, (title, sub) in enumerate(ITEMS):
    x0 = i * cell
    fill = "#1f6feb" if title == "新增專案" else "#f6f7f9"
    color = "#ffffff" if title == "新增專案" else "#1d2939"
    muted = "#dbe7ff" if title == "新增專案" else "#667085"
    draw.rectangle([x0 + 12, 12, x0 + cell - 12, H - 12], fill=fill, outline="#d0d5dd", width=4)
    cx = x0 + cell / 2
    draw.text((cx, H / 2 - 50), title, font=bold, fill=color, anchor="mm")
    draw.text((cx, H / 2 + 90), sub, font=small, fill=muted, anchor="mm")

out = os.path.join(ROOT, "scripts/assets/richmenu.png")
img.save(out, optimize=True)
print("done:", out)
