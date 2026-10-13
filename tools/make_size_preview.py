# -*- coding: utf-8 -*-
"""
生成「图标大小对比」图 —— 给用户挑大小用的。

1:1 实际像素画，不是缩放示意图。
改下面的 SIZES 就能重新出图。
"""

import os
from PIL import Image, ImageDraw, ImageFont

# 要对比的几档（像素）  标签左半边文字  备注
SIZES = [
    (60, "A · 60px", "原来的大小"),
    (68, "B · 68px", "大一点点（现在是这个）"),
    (80, "C · 80px", "明显大"),
    (92, "D · 92px", "很大"),
]

SITES = [
    ("百", "#4c7cf3"), ("C", "#e5484d"), ("B", "#f0921f"), ("抖", "#12a594"),
    ("G", "#8e4ec6"), ("知", "#0d74ce"), ("A", "#d6409f"), ("淘", "#46a758"),
]

GAP_X = 18          # 格子间距（和 CSS 里一致）
PAD_X = GAP_X       # 为了 1:1 还原
LABEL_ROW = 22      # 名字那一行占的高度
HEADER = 96
ROW_GAP = 34
LEFT_COL = 250      # 左边写档位文字用的宽度
MARGIN = 32

FONT_DIR = r"C:\Windows\Fonts"
F_REG = os.path.join(FONT_DIR, "msyh.ttc")
F_BOLD = os.path.join(FONT_DIR, "msyhbd.ttc")


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def main():
    f_head = font(F_BOLD, 26)
    f_title = font(F_BOLD, 22)
    f_note = font(F_REG, 16)
    f_name = font(F_REG, 13)

    widest = max(s for s, _, _ in SIZES)
    tile_w = widest + 48
    row_h = widest + 16 + LABEL_ROW

    width = MARGIN * 2 + LEFT_COL + 8 * (tile_w + GAP_X)
    height = HEADER + len(SIZES) * (row_h + ROW_GAP) + MARGIN

    img = Image.new("RGB", (width, height), "#1b2a4a")
    draw = ImageDraw.Draw(img)

    # 背景渐变，模仿默认那层深蓝
    top, bottom = (27, 42, 74), (106, 143, 199)
    for y in range(height):
        t = y / max(1, height - 1)
        draw.line(
            [(0, y), (width, y)],
            fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)),
        )

    draw.text((MARGIN, 26), "NKtab 图标大小对比", font=f_head, fill="#ffffff")
    draw.text(
        (MARGIN, 62),
        "1:1 实际像素，同一行画 8 个。挑一个字母告诉我就行。",
        font=f_note,
        fill="#d7e3f5",
    )

    y = HEADER
    for size, title, note in SIZES:
        cy = y + size / 2
        draw.text((MARGIN, cy - 16), title, font=f_title, fill="#ffffff")
        draw.text((MARGIN, cy + 10), note, font=f_note, fill="#c9dbf3")

        x = MARGIN + LEFT_COL
        radius = int(size * 0.30)
        for text, color in SITES:
            # 图标底色（白）
            rounded(draw, [x, y, x + size, y + size], radius, (255, 255, 255))
            # 里面那个彩色的网站图标
            inner = int(size * 0.62)
            off = (size - inner) / 2
            rounded(
                draw,
                [x + off, y + off, x + off + inner, y + off + inner],
                max(4, int(inner * 0.22)),
                tuple(int(color[i:i + 2], 16) for i in (1, 3, 5)),
            )
            bb = draw.textbbox((0, 0), text, font=f_name)
            draw.text(
                (x + (size - (bb[2] - bb[0])) / 2 - bb[0],
                 y + (size - (bb[3] - bb[1])) / 2 - bb[1] - 2),
                text,
                font=f_name if size < 80 else font(F_BOLD, 15 if size < 88 else 17),
                fill="#ffffff",
            )
            # 网站名字
            nm = ImageDraw.Draw(img)
            nb = nm.textbbox((0, 0), text + "站", font=f_name)
            nm.text(
                (x + (size - (nb[2] - nb[0])) / 2 - nb[0], y + size + 6),
                text + "站",
                font=f_name,
                fill="#ffffff",
            )
            x += tile_w + GAP_X

        y += row_h + ROW_GAP

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "图标大小对比.png")
    img.save(out)
    print("已生成:", out, img.size)


if __name__ == "__main__":
    main()
