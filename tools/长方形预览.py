"""
长方形预览.py —— 把「长方形色块 + 大字」画成一张图，方便先看效果再决定。

这不是网页的一部分，纯粹是给你看的预览图。
想改图上色块的大小，改下面 VARIANTS 里的数字，然后重新跑一次。
"""

from PIL import Image, ImageDraw, ImageFont

OUT = r"E:\DeepSeekHarnessWork\NKtab\tools\长方形预览.png"

# (标题, 宽, 高, 圆角)
VARIANTS = [
    ("A  ·  132 × 74    现在就是这个（比原来扁一点、宽一点）", 132, 74, 16),
    ("B  ·  150 × 70    更宽更扁，一行能写下的字更多", 150, 70, 16),
    ("C  ·  120 × 82    方一点，更像原来的方块", 120, 82, 18),
]

# 名字 + 颜色（跟 storage.js 里的预置站一致）
SITES = [
    ("百度", "#4c7cf3"),
    ("哔哩哔哩", "#d6409f"),
    ("知乎", "#0d74ce"),
    ("微博", "#e5484d"),
    ("抖音", "#12a594"),
    ("淘宝", "#f0921f"),
    ("CSDN", "#e5484d"),
    ("GitHub", "#5a6472"),
    ("网易云音乐", "#e5484d"),
    ("豆瓣", "#46a758"),
]

GAP_X, GAP_Y = 20, 22
PAD = 34
BG_TOP, BG_BOT = (27, 42, 74), (106, 143, 199)
TITLE_COLOR = (255, 255, 255)

FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_REG = r"C:\Windows\Fonts\msyh.ttc"

TEXT_MAX = 30
TEXT_MIN = 11


def text_color_on(hex_color):
    """底色太亮就用深色字 —— 跟 newtab.js 里的 textColorOn 同一套算法。"""
    raw = hex_color.lstrip("#")
    if len(raw) != 6:
        return "#ffffff"

    def channel(pair):
        v = int(pair, 16) / 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4

    lum = (
        0.2126 * channel(raw[0:2])
        + 0.7152 * channel(raw[2:4])
        + 0.0722 * channel(raw[4:6])
    )
    return "#1a1d24" if lum > 0.55 else "#ffffff"


def fit_size(draw, text, tile_w, font_path):
    """和网页一样：先按最大字号量一量，超宽就按比例缩小。"""
    avail = tile_w - 24
    font = ImageFont.truetype(font_path, TEXT_MAX)
    width = draw.textlength(text, font=font)
    if width > avail and width > 0:
        size = max(TEXT_MIN, int(TEXT_MAX * avail / width))
        font = ImageFont.truetype(font_path, size)
    return font


def gradient(size, top, bottom):
    w, h = size
    img = Image.new("RGB", (1, h))
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        px[0, y] = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return img.resize((w, h), Image.BILINEAR)


def hex_rgb(value):
    v = value.lstrip("#")
    return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4))


# ---- 先算画布要多高 ----
row_h = [h + 52 for _, _, h, _ in VARIANTS]   # 每个变体：标题 + 一行色块
canvas_h = PAD + sum(row_h) + PAD

measure = ImageDraw.Draw(Image.new("RGB", (10, 10)))
per_row = len(SITES)
row_width = per_row * 150 + (per_row - 1) * GAP_X
canvas_w = max(1180, row_width + PAD * 2)

img = gradient((canvas_w, canvas_h), BG_TOP, BG_BOT)
draw = ImageDraw.Draw(img)

font_title = ImageFont.truetype(FONT_BOLD, 19)
font_head = ImageFont.truetype(FONT_BOLD, 30)

# 大标题
draw.text((PAD, 18), "NKtab 长方形色块预览", font=font_head, fill=TITLE_COLOR)
y = 62

for label, tw, th, radius in VARIANTS:
    draw.text((PAD, y), label, font=font_title, fill=(214, 224, 244))
    y += 36

    x = PAD
    for name, color in SITES:
        # 阴影
        shadow = Image.new("RGBA", (tw + 20, th + 20), (0, 0, 0, 0))
        sd = ImageDraw.Draw(shadow)
        sd.rounded_rectangle((10, 12, 10 + tw, 12 + th), radius=radius,
                             fill=(0, 0, 0, 110))
        img.paste(shadow, (x - 10, y - 10), shadow)

        # 色块
        draw.rounded_rectangle((x, y, x + tw, y + th), radius=radius,
                               fill=hex_rgb(color))

        # 大字
        font = fit_size(measure, name, tw, FONT_BOLD)
        bbox = draw.textbbox((0, 0), name, font=font)
        tx = x + (tw - (bbox[2] - bbox[0])) / 2 - bbox[0]
        ty = y + (th - (bbox[3] - bbox[1])) / 2 - bbox[1]
        draw.text((tx, ty), name, font=font, fill=hex_rgb(text_color_on(color)))

        x += tw + GAP_X

    y += th + 16

img.save(OUT)
print("已生成:", OUT, img.size)
