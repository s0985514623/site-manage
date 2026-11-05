# -*- coding: utf-8 -*-
"""
產生資料匯入用的 Excel 範本。

範本欄位對應系統的資料結構，填好後用 `npm run db:import <檔案>` 匯入。
下拉選單的選項直接對應資料庫的列舉值，填錯的機會較低。

需求：pip install openpyxl
執行：npm run template:import
"""

import os

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

OUT = "匯入範本_網站續約管理.xlsx"

FONT = "Arial"

# ── 樣式 ────────────────────────────────────────────────
HEADER_FILL = PatternFill("solid", fgColor="D9D9D9")
REQUIRED_FILL = PatternFill("solid", fgColor="FFF2CC")  # 必填欄位的表頭
EXAMPLE_FILL = PatternFill("solid", fgColor="F2F2F2")
TITLE_FONT = Font(name=FONT, size=14, bold=True)
HEADER_FONT = Font(name=FONT, size=10, bold=True)
BODY_FONT = Font(name=FONT, size=10)
HINT_FONT = Font(name=FONT, size=9, color="808080")
EXAMPLE_FONT = Font(name=FONT, size=10, color="808080", italic=True)
THIN = Side(style="thin", color="BFBFBF")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

# ── 選項（對應資料庫列舉）────────────────────────────────
SERVICE_TYPES = ["網域", "主機", "SSL憑證", "維護合約", "企業信箱", "外掛授權", "CDN", "其他"]
CYCLES = ["每月", "每季", "每年", "每兩年", "每三年"]
SITE_STATUS = ["建置中", "已上線", "暫停", "已結案"]
ROLES = ["決策者", "財務窗口", "技術窗口", "其他"]
YES_NO = ["是", "否"]
CURRENCIES = ["TWD", "USD", "EUR"]
PLANS = [
    "虛擬主機 10GB（報價單既有版本）",
    "基本方案（形象官網）",
    "流量方案 3 萬",
    "流量方案 5 萬",
    "流量方案 15 萬",
    "流量方案 40 萬",
    "流量方案 100 萬",
    "流量方案 160 萬",
    "流量方案 200 萬",
    "流量方案 240 萬",
    "流量方案 300 萬",
]

# ── 服務項目工作表欄位 ──────────────────────────────────
# (標題, 必填, 欄寬, 提示, 下拉選項, 數字格式)
SERVICE_COLUMNS = [
    ("客戶全名", True, 30, "正式全名，印在報價單甲方欄。相同名稱視為同一客戶", None, None),
    ("客戶簡稱", False, 16, "報價單「專案名稱」用。留空則用全名", None, None),
    ("統一編號", False, 12, "8 位數字", None, "@"),
    ("客戶負責人", False, 12, "報價單甲乙方對照區", None, None),
    ("客戶電話", False, 16, "", None, "@"),
    ("客戶地址", False, 30, "", None, None),
    ("網站名稱", True, 18, "同一客戶下名稱相同視為同一網站", None, None),
    ("網站網址", False, 26, "https:// 開頭。存活監控與 SSL 偵測會用到", None, None),
    ("CMS平台", False, 12, "WordPress / Shopify / 靜態站…", None, None),
    ("網站狀態", False, 10, "留空預設「已上線」", SITE_STATUS, None),
    ("服務類型", True, 12, "", SERVICE_TYPES, None),
    ("項目名稱", True, 24, "印在報價單「名稱」欄。例：虛擬主機續約、example.com", None, None),
    ("偵測目標", False, 20, "要查 WHOIS／SSL 的網域。項目名稱本身是網域時可留空", None, None),
    ("供應商", False, 16, "Gandi / Cloudflare / 中華電信…", None, None),
    ("註冊商帳號", False, 18, "這個項目掛在誰的帳號下", None, None),
    ("我方代管", True, 10, "「否」= 客戶自己買的，照常提醒但不開進報價單", YES_NO, None),
    ("開始日", False, 12, "YYYY-MM-DD", None, "YYYY-MM-DD"),
    ("到期日", True, 12, "YYYY-MM-DD", None, "YYYY-MM-DD"),
    ("計費週期", True, 10, "", CYCLES, None),
    ("自動續約", False, 10, "供應商端是否已設定自動續約。僅供參考，提醒照常發送", YES_NO, None),
    ("成本價", False, 12, "你付給供應商的金額", None, "#,##0.00"),
    ("售價", False, 12, "跟客戶收的金額，會帶入報價單", None, "#,##0.00"),
    ("幣別", False, 8, "留空預設 TWD", CURRENCIES, None),
    ("方案範本", False, 28, "選了會自動帶入規格說明到報價單", PLANS, None),
    ("規格說明", False, 34, "會蓋過方案範本。多行請用 Alt+Enter 換行", None, None),
    ("備註", False, 24, "內部備註，不會出現在報價單", None, None),
]

CONTACT_COLUMNS = [
    ("客戶全名", True, 30, "要與「服務項目」分頁的客戶全名完全一致", None, None),
    ("姓名", True, 14, "", None, None),
    ("角色", False, 12, "留空預設「其他」", ROLES, None),
    ("Email", False, 26, "勾選「接收報價單」時必填", None, None),
    ("電話", False, 16, "", None, "@"),
    ("主要聯絡人", False, 12, "每個客戶只能有一位", YES_NO, None),
    ("接收報價單", False, 12, "續約報價單會寄給這些人", YES_NO, None),
]

SERVICE_EXAMPLE = [
    "財團法人台北市九如禪林基金會", "九如基金會", "92006852", "吳如英",
    "03-2551994", "台北市建國北路一段90號10樓",
    "主機", "https://example.org.tw", "WordPress", "已上線",
    "主機", "虛擬主機續約", "example.org.tw", "冠澄代管", "studio@ren-codes.com",
    "是", "2025-10-16", "2026-10-15", "每年", "否",
    3000, 5000, "TWD", "虛擬主機 10GB（報價單既有版本）", "", "",
]

CONTACT_EXAMPLE = [
    "財團法人台北市九如禪林基金會", "王小明", "決策者",
    "ming@example.org.tw", "02-1234-5678", "是", "是",
]


def style_header(ws, columns, row=1):
    for i, (title, required, width, hint, options, numfmt) in enumerate(columns, start=1):
        letter = get_column_letter(i)
        ws.column_dimensions[letter].width = width

        cell = ws.cell(row=row, column=i, value=title + ("  *" if required else ""))
        cell.font = HEADER_FONT
        cell.fill = REQUIRED_FILL if required else HEADER_FILL
        cell.border = BORDER
        cell.alignment = Alignment(horizontal="center", vertical="center")

        hint_cell = ws.cell(row=row + 1, column=i, value=hint or "")
        hint_cell.font = HINT_FONT
        hint_cell.border = BORDER
        hint_cell.alignment = Alignment(wrap_text=True, vertical="top")

    ws.row_dimensions[row].height = 22
    ws.row_dimensions[row + 1].height = 46
    ws.freeze_panes = ws.cell(row=row + 2, column=1)


def add_validations(ws, columns, first_row, last_row):
    for i, (_t, _r, _w, _h, options, _n) in enumerate(columns, start=1):
        if not options:
            continue
        letter = get_column_letter(i)
        # 選項字串放在公式裡，長度上限 255 字元；方案名稱較長改放對照表
        joined = ",".join(options)
        if len(joined) < 250:
            dv = DataValidation(type="list", formula1=f'"{joined}"', allow_blank=True)
        else:
            col = REFERENCE_COLUMN[tuple(options)]
            dv = DataValidation(
                type="list",
                formula1=f"=對照表!${col}$2:${col}${len(options) + 1}",
                allow_blank=True,
            )
        dv.error = "請從下拉選單選擇，或參考「對照表」分頁"
        dv.errorTitle = "不是允許的值"
        ws.add_data_validation(dv)
        dv.add(f"{letter}{first_row}:{letter}{last_row}")


def write_example(ws, columns, values, row):
    for i, value in enumerate(values, start=1):
        cell = ws.cell(row=row, column=i, value=value)
        cell.font = EXAMPLE_FONT
        cell.fill = EXAMPLE_FILL
        cell.border = BORDER
        numfmt = columns[i - 1][5]
        if numfmt:
            cell.number_format = numfmt
        cell.alignment = Alignment(vertical="top", wrap_text=False)


def prepare_blank_rows(ws, columns, first_row, count):
    for r in range(first_row, first_row + count):
        for i, (_t, _r2, _w, _h, _o, numfmt) in enumerate(columns, start=1):
            cell = ws.cell(row=r, column=i)
            cell.font = BODY_FONT
            cell.border = BORDER
            if numfmt:
                cell.number_format = numfmt


REFERENCE_COLUMN = {}


def build_reference(wb):
    ws = wb.create_sheet("對照表")
    groups = [
        ("服務類型", SERVICE_TYPES),
        ("計費週期", CYCLES),
        ("網站狀態", SITE_STATUS),
        ("聯絡人角色", ROLES),
        ("是／否", YES_NO),
        ("幣別", CURRENCIES),
        ("方案範本", PLANS),
    ]
    for i, (title, options) in enumerate(groups, start=1):
        letter = get_column_letter(i)
        ws.column_dimensions[letter].width = max(14, min(32, len(title) * 3))
        head = ws.cell(row=1, column=i, value=title)
        head.font = HEADER_FONT
        head.fill = HEADER_FILL
        head.border = BORDER
        for j, option in enumerate(options, start=2):
            cell = ws.cell(row=j, column=i, value=option)
            cell.font = BODY_FONT
            cell.border = BORDER
        REFERENCE_COLUMN[tuple(options)] = letter

    ws.column_dimensions[get_column_letter(len(groups))].width = 30
    return ws


def build_instructions(wb):
    ws = wb.create_sheet("說明", 0)
    ws.column_dimensions["A"].width = 100
    ws.sheet_view.showGridLines = False

    lines = [
        ("網站續約管理　資料匯入範本", "title"),
        ("", None),
        ("怎麼填", "h"),
        ("1. 到「服務項目」分頁，每一列填一個會到期的東西（一個網域、一台主機、一份維護合約各一列）。", None),
        ("2. 同一個客戶有多個項目時，客戶欄位重複填即可，系統會以「客戶全名」自動合併。", None),
        ("3. 網站也一樣，同一客戶下「網站名稱」相同的會視為同一個網站。", None),
        ("4. 到「聯絡人」分頁填每個客戶的窗口，「客戶全名」要與服務項目分頁完全一致。", None),
        ("5. 灰色斜體的範例列請在填寫前刪掉。", None),
        ("", None),
        ("欄位標示", "h"),
        ("・表頭底色為淺黃並帶 * 號 = 必填", None),
        ("・表頭底色為灰色 = 選填，留空即可", None),
        ("・表頭下方那一列是填寫說明，匯入時會自動略過", None),
        ("・有下拉選單的欄位請從選單挑，完整清單見「對照表」分頁", None),
        ("", None),
        ("幾個容易填錯的地方", "h"),
        ("・日期一律 YYYY-MM-DD，例如 2026-10-15。", None),
        ("・「我方代管」填「否」代表客戶自己購買：系統照常提醒到期，但絕不會開進報價單。", None),
        ("　 這個欄位填錯會導致向客戶重複收費，請特別留意。", None),
        ("・「項目名稱」是印在報價單上的文字；「偵測目標」才是拿去查 WHOIS 的網域。", None),
        ("　 例如項目名稱寫「網域名稱續約」時，偵測目標要另外填 example.com.tw。", None),
        ("・售價留空的代管項目不會被開進自動報價單，避免寄出金額為零的報價。", None),
        ("・同一個網站若混用不同幣別，系統會略過不合併報價（不會把 TWD 與 USD 相加）。", None),
        ("", None),
        ("匯入方式", "h"),
        ("填好後把檔案放進專案目錄，執行：", None),
        ("    npm run db:import 匯入範本_網站續約管理.xlsx", "code"),
        ("匯入前會先試算並列出將建立的筆數，確認後才寫入資料庫。", None),
        ("", None),
        ("這份範本由 scripts/make-import-template.py 產生，欄位與系統資料結構一致。", "hint"),
    ]

    row = 1
    for text, kind in lines:
        cell = ws.cell(row=row, column=1, value=text)
        if kind == "title":
            cell.font = TITLE_FONT
        elif kind == "h":
            cell.font = Font(name=FONT, size=11, bold=True)
        elif kind == "code":
            cell.font = Font(name="Consolas", size=10)
            cell.fill = PatternFill("solid", fgColor="F2F2F2")
        elif kind == "hint":
            cell.font = HINT_FONT
        else:
            cell.font = BODY_FONT
        cell.alignment = Alignment(vertical="center", wrap_text=False)
        row += 1
    return ws


def main():
    wb = Workbook()
    wb.remove(wb.active)

    # 對照表要先建，資料驗證才引用得到
    build_reference(wb)

    services = wb.create_sheet("服務項目", 0)
    style_header(services, SERVICE_COLUMNS)
    write_example(services, SERVICE_COLUMNS, SERVICE_EXAMPLE, 3)
    prepare_blank_rows(services, SERVICE_COLUMNS, 4, 200)
    add_validations(services, SERVICE_COLUMNS, 3, 300)

    contacts = wb.create_sheet("聯絡人", 1)
    style_header(contacts, CONTACT_COLUMNS)
    write_example(contacts, CONTACT_COLUMNS, CONTACT_EXAMPLE, 3)
    prepare_blank_rows(contacts, CONTACT_COLUMNS, 4, 100)
    add_validations(contacts, CONTACT_COLUMNS, 3, 200)

    build_instructions(wb)
    wb.active = 0

    wb.save(OUT)
    print("已產生 %s（%.0f KB）" % (OUT, os.path.getsize(OUT) / 1024))
    print("分頁：說明 / 服務項目 / 聯絡人 / 對照表")


if __name__ == "__main__":
    main()
