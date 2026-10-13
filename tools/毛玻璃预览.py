"""画几张「背景怎么铺」的对比图，用来挑一个不刺眼的做法。

画的是新标签页背景那一层在真实屏幕比例（2194x1234）下的样子：
  A 上一版：毛玻璃压得很暗（brightness .62）+ 原图直接贴上去 -> 接缝明显
  B 现在这样：亮度对齐 + 糊得更开 + 原图四边羽化 -> 化在一起
  C 另一个选法：干脆铺满（cover），一点边都不留，也就没有毛玻璃

只是拿 Pillow 复刻 CSS 的效果，不是真的截图。
"""

import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
WP = os.path.join(HERE, "..", "wallpapers")
OUT = os.path.join(HERE, "毛玻璃预览.png")

FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
FONT_REG = "C:/Windows/Fonts/msyh.ttc"

SCREEN_W, SCREEN_H = 2194, 1234          # 实际屏幕
PANEL_W = 1000
PANEL_H = round(PANEL_W * SCREEN_H / SCREEN_W)
GAP = 22
PAD = 30
LABEL_H = 46
NOTE_H = 26

# 拿异环那张当例子：裁完是 1.854，比屏幕的 1.778 宽，左右会剩一点
SAMPLE = os.path.join(WP, "pic2.jpg")
SAMPLE_WIDE = os.path.join(WP, "we21.jpg")


def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)


def fit(path, w, h, mode):
    img = Image.open(path).convert("RGB")
    if mode == "cover":
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
        return img.resize((w, h), Image.LANCZOS)

    scale = min(w / img.width, h / img.height)
    nw, nh = max(1, round(img.width * scale)), max(1, round(img.height * scale))
    return img.resize((nw, nh), Image.LANCZOS)


def feather_mask(size, fraction):
    """中间不透明、四边往里 fade 的遮罩。fraction=0 就是完全不羽化。"""
    w, h = size
    mask = Image.new("L", (w, h), 0)
    if fraction <= 0:
        return Image.new("L", (w, h), 255)
    band_x = max(1, round(w * fraction))
    band_y = max(1, round(h * fraction))
    px = mask.load()
    for y in range(h):
        fy = min(1.0, y / band_y, (h - 1 - y) / band_y)
        for x in range(w):
            fx = min(1.0, x / band_x, (w - 1 - x) / band_x)
            px[x, y] = int(255 * min(fx, fy))
    return mask


def render_panel(path, mode, blur_px, brightness, feather, saturate=1.0):
    panel = Image.new("RGB", (PANEL_W, PANEL_H), (0, 0, 0))

    if mode == "cover":
        panel.paste(fit(path, PANEL_W, PANEL_H, "cover"), (0, 0))
    else:
        base = fit(path, PANEL_W, PANEL_H, "cover")
        if blur_px:
            base = base.filter(ImageFilter.GaussianBlur(blur_px))
        if saturate != 1.0:
            from PIL import ImageEnhance
            base = ImageEnhance.Color(base).enhance(saturate)
        if brightness != 1.0:
            base = Image.eval(base, lambda v: min(255, int(v * brightness)))
        panel.paste(base, (0, 0))

        small = fit(path, PANEL_W, PANEL_H, "contain")
        ox, oy = (PANEL_W - small.width) // 2, (PANEL_H - small.height) // 2
        mask = feather_mask(small.size, feather) if feather > 0 else None
        panel.paste(small, (ox, oy), mask)

    # 暗色遮罩（对应 .bg::after 的 rgba(0,0,0,.22)）
    return Image.blend(panel, Image.new("RGB", panel.size, (0, 0, 0)), 0.22)


def main():
    cases = [
        ("A · 试过的第一版：毛玻璃压暗，原图直接贴上去（接缝明显）",
         SAMPLE, "contain", 38, 0.62, 0.0, 1.0),
        ("B · 试过的第二版：亮度对齐 + 原图四边羽化（接缝轻了，但还看得出）",
         SAMPLE, "contain", 48, 0.88, 0.10, 1.35),
        ("C · ★现在这样★ 干脆铺满，一点边都不留",
         SAMPLE, "cover", 0, 1.0, 0.0, 1.0),
        ("D · 比例差得多的图（we21，1.6）铺满之后是什么样",
         SAMPLE_WIDE, "cover", 0, 1.0, 0.0, 1.0),
    ]

    width = PAD * 2 + PANEL_W
    height = PAD * 2 + sum(LABEL_H + NOTE_H + PANEL_H for _ in cases) + GAP * len(cases)
    canvas = Image.new("RGB", (width, height), (24, 30, 44))
    draw = ImageDraw.Draw(canvas)

    y = PAD
    for label, path, mode, blur_px, bright, feather, sat in cases:
        draw.text((PAD, y + 8), label, font=font(18, True), fill=(255, 255, 255))
        y += LABEL_H
        canvas.paste(render_panel(path, mode, blur_px, bright, feather, sat), (PAD, y))
        draw.rectangle(
            (PAD, y, PAD + PANEL_W - 1, y + PANEL_H - 1),
            outline=(90, 100, 120), width=1,
        )
        y += PANEL_H
        draw.text(
            (PAD + 2, y + 4),
            "（拿「异环 · 黄昏」当例子，它是 1.854，比屏幕的 1.778 宽）" if path == SAMPLE
            else "（这张是 1.6，比屏幕窄，左右空的更多，看得更清楚）",
            font=font(13), fill=(150, 158, 175),
        )
        y += NOTE_H + GAP

    canvas.save(OUT, quality=95)
    print("画好了：", OUT, canvas.size)


if __name__ == "__main__":
    main()
