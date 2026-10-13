"""画一张「壁纸库」弹窗的效果图，用来给用户看长什么样。

为什么用画而不是截图：这个环境里起不了浏览器（沙箱不让），
所以只能按 CSS 里的真实尺寸和配色，用 Pillow 把界面复刻一遍。

缩略图用的是 Wallpaper Engine 工坊目录里真实的 preview 图，
所以看起来跟真跑起来几乎一样。
"""

import json
import os
import re

from PIL import Image, ImageDraw, ImageFont

# ---------- 输出 ----------
OUT = r"E:\DeepSeekHarnessWork\NKtab\tools\壁纸库预览.png"
WP_DIR = r"E:\DeepSeekHarnessWork\NKtab\wallpapers"

# 直接从 storage.js 里读 BUILTIN_WALLPAPERS，免得两边对不上
STORAGE_JS = r"E:\DeepSeekHarnessWork\NKtab\storage.js"

# 面板是有滚动条的，预览图里只画前这么多格
SHOW_MAX = 16


def read_builtins():
    with open(STORAGE_JS, encoding="utf-8") as handle:
        source = handle.read()
    block = source.split("BUILTIN_WALLPAPERS = [")[1].split("];")[0]
    return re.findall(r'name:\s*"([^"]+)"[^}]*?path:\s*"([^"]+)"', block)

SCALE = 1.5
FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
FONT_REG = "C:/Windows/Fonts/msyh.ttc"


def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, int(round(size * SCALE)))


def s(value):
    """把 CSS 像素换算成画布像素。"""
    return int(round(value * SCALE))


def builtin_cards():
    """壁纸库里那几格：全部用真实的图片文件。"""
    cards = []
    for title, rel in read_builtins():
        path = os.path.join(os.path.dirname(WP_DIR), rel.replace("/", os.sep))
        if os.path.exists(path):
            cards.append((path, title))
    return cards[:SHOW_MAX]


def cover(path, w, h):
    """把图裁成铺满 w×h（跟 CSS 的 background-size: cover 一个意思）。"""
    img = Image.open(path).convert("RGB")
    target = w / h
    src = img.width / img.height
    if src > target:
        nw = int(img.height * target)
        left = (img.width - nw) // 2
        img = img.crop((left, 0, left + nw, img.height))
    else:
        nh = int(img.width / target)
        top = (img.height - nh) // 2
        img = img.crop((0, top, img.width, top + nh))
    return img.resize((max(1, w), max(1, h)), Image.LANCZOS)


def paste_round(canvas, img, box, radius):
    """把图按圆角贴上去。"""
    w = box[2] - box[0]
    h = box[3] - box[1]
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=255)
    canvas.paste(img, (box[0], box[1]), mask)


# ---------- 版式（先把 CSS 里的真实数字摆好）----------
DIALOG_W = 620
PAD = 22
GAP = 10
COLS = 4
ROWS = 4

CONTENT_W = DIALOG_W - PAD * 2                     # 576
CARD_W = (CONTENT_W - GAP * (COLS - 1)) / COLS     # 136.5
CARD_H = CARD_W * 10 / 16                          # 85.3

HEAD_H = 26
HINT_H = 15
GRID_H = ROWS * CARD_H + (ROWS - 1) * GAP
BTN_H = 34
BTN_W = 76

DIALOG_H = PAD + HEAD_H + 10 + HINT_H + 16 + GRID_H + 20 + BTN_H + PAD

MARGIN = 46
CANVAS_W = DIALOG_W + MARGIN * 2
CANVAS_H = DIALOG_H + MARGIN * 2 + 30

W, H = s(CANVAS_W), s(CANVAS_H)
canvas = Image.new("RGB", (W, H), (26, 34, 54))
draw = ImageDraw.Draw(canvas)

# 背景：跟新标签页一样的深蓝渐变
for y in range(H):
    t = y / max(1, H - 1)
    draw.line(
        [(0, y), (W, y)],
        fill=(
            int(27 + (106 - 27) * t),
            int(42 + (143 - 42) * t),
            int(74 + (199 - 74) * t),
        ),
    )

# ---------- 弹窗本体 ----------
dx0, dy0 = s(MARGIN), s(MARGIN)
dx1, dy1 = s(MARGIN + DIALOG_W), s(MARGIN + DIALOG_H)

# 阴影
shadow = Image.new("RGB", (W, H), (0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle(
    (dx0 + s(6), dy0 + s(12), dx1 + s(6), dy1 + s(12)), radius=s(18), fill=(0, 0, 0)
)
canvas = Image.blend(canvas, shadow, 0.35)
draw = ImageDraw.Draw(canvas)

draw.rounded_rectangle((dx0, dy0, dx1, dy1), radius=s(18), fill=(35, 38, 47))

x = dx0 + s(PAD)
y = dy0 + s(PAD)

# 标题 + 右上角按钮
draw.text((x, y + s(2)), "壁纸库", font=font(17, True), fill=(242, 243, 245))

btn_w, btn_h = s(112), s(30)
bx1 = dx1 - s(PAD)
bx0 = bx1 - btn_w
draw.rounded_rectangle((bx0, y, bx1, y + btn_h), radius=s(8), fill=(58, 64, 80))
label = "＋ 添加图片"
lw = draw.textlength(label, font=font(12))
draw.text(((bx0 + bx1 - lw) / 2, y + s(7)), label, font=font(12), fill=(242, 243, 245))

y += s(HEAD_H + 10)

# 那行说明
draw.text(
    (x, y),
    "点一下图片就换成它。鼠标移到图片上，右上角会出现 ×，点它就从库里删掉。",
    font=font(12),
    fill=(125, 132, 148),
)

y += s(HINT_H + 16)

# ---------- 缩略图网格 ----------
cards = builtin_cards()

CARD_R = s(12)
HOVER_INDEX = 2  # 让第 3 张显示「鼠标移上去」的样子，好解释 × 在哪

for index, (path, title) in enumerate(cards):
    col = index % COLS
    row = index // COLS
    cx0 = x + col * (s(CARD_W) + s(GAP))
    cy0 = y + row * (s(CARD_H) + s(GAP))
    cx1 = cx0 + s(CARD_W)
    cy1 = cy0 + s(CARD_H)

    try:
        cover(path, cx1 - cx0, cy1 - cy0)
        paste_round(canvas, cover(path, cx1 - cx0, cy1 - cy0), (cx0, cy0, cx1, cy1), CARD_R)
    except Exception:
        draw.rounded_rectangle((cx0, cy0, cx1, cy1), radius=CARD_R, fill=(43, 47, 58))

    draw = ImageDraw.Draw(canvas)

    # 名字压在底部（真实界面是一条渐变压暗的横条）
    name_area = Image.new("RGB", (cx1 - cx0, s(26)), (0, 0, 0))
    nd = ImageDraw.Draw(name_area)
    for i in range(name_area.height):
        t = i / max(1, name_area.height - 1)
        nd.line([(0, i), (name_area.width, i)], fill=(int(0 + 40 * t),) * 3)
    mask = Image.new("L", name_area.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, name_area.width - 1, name_area.height - 1), radius=CARD_R, fill=255
    )
    canvas.paste(name_area, (cx0, cy1 - name_area.height), mask)

    draw = ImageDraw.Draw(canvas)
    show = title if len(title) <= 11 else title[:10] + "…"
    draw.text((cx0 + s(8), cy1 - s(20)), show, font=font(11), fill=(255, 255, 255))

    # 正在用的那张描蓝边
    if index == 0:
        draw.rounded_rectangle(
            (cx0, cy0, cx1, cy1), radius=CARD_R, outline=(91, 141, 239), width=s(2)
        )
        tag = "正在用"
        tw = draw.textlength(tag, font=font(10))
        draw.rounded_rectangle(
            (cx0 + s(6), cy0 + s(6), cx0 + s(6) + tw + s(10), cy0 + s(6) + s(18)),
            radius=s(9),
            fill=(91, 141, 239),
        )
        draw.text((cx0 + s(11), cy0 + s(8)), tag, font=font(10), fill=(255, 255, 255))

    # 悬停那张显示 ✕
    if index == HOVER_INDEX:
        cxc, cyc = cx1 - s(6) - s(11), cy0 + s(6) + s(11)
        draw.ellipse(
            (cxc - s(11), cyc - s(11), cxc + s(11), cyc + s(11)), fill=(20, 20, 24)
        )
        xw = draw.textlength("×", font=font(16, True))
        draw.text((cxc - xw / 2, cyc - s(11)), "×", font=font(16, True), fill=(255, 255, 255))

y += s(GRID_H + 20)

# ---------- 底部两个按钮 ----------
by0 = y
by1 = y + s(BTN_H)

# 右边：关闭（蓝色主按钮）
close_w = s(72)
bx1 = dx1 - s(PAD)
bx0 = bx1 - close_w
draw.rounded_rectangle((bx0, by0, bx1, by1), radius=s(9), fill=(77, 124, 240))
lw = draw.textlength("关闭", font=font(13))
draw.text(((bx0 + bx1 - lw) / 2, by0 + s(8)), "关闭", font=font(13), fill=(255, 255, 255))

# 左边：不用背景图（灰色）
clear_w = s(104)
cx1b = bx0 - s(10)
cx0b = cx1b - clear_w
draw.rounded_rectangle((cx0b, by0, cx1b, by1), radius=s(9), fill=(48, 52, 64))
lw = draw.textlength("不用背景图", font=font(13))
draw.text(((cx0b + cx1b - lw) / 2, by0 + s(8)), "不用背景图", font=font(13), fill=(242, 243, 245))

# ---------- 底下那行小字 ----------
draw.text(
    (s(MARGIN), s(MARGIN + DIALOG_H + 12)),
    "NKtab 壁纸库 · 自带 36 张 · 最后 24 张是从你 WE 视频壁纸抽的静帧",
    font=font(13, True),
    fill=(255, 255, 255),
)

canvas.save(OUT, quality=95)
print("画好了：", OUT, canvas.size)
print("库里放进去的缩略图：")
for path, title in cards:
    print("   ", title)
