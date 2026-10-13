"""生成 NKtab 的插件图标（16 / 48 / 128 三种尺寸）。

画的是一个圆角方块 + 里面 2x2 的小格子，对应「图标宫格」这个主题。
想换颜色就改下面的 COLOR_A / COLOR_B，然后重跑这个脚本。
"""

from PIL import Image, ImageDraw

COLOR_A = (76, 124, 243)    # 左上：蓝
COLOR_B = (142, 78, 198)    # 右下：紫

OUT_DIR = r"E:\DeepSeekHarnessWork\NKtab\icons"
SIZES = [16, 48, 128]
SS = 8                      # 超采样倍数，画大再缩小，边缘更干净


def gradient(size):
    """对角线渐变色块。"""
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1)) if size > 1 else 0
            px[x, y] = tuple(
                round(COLOR_A[i] + (COLOR_B[i] - COLOR_A[i]) * t) for i in range(3)
            )
    return img


def make_icon(size):
    big = size * SS
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))

    # 圆角方形底
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, big - 1, big - 1], radius=int(big * 0.22), fill=255
    )
    canvas.paste(gradient(big), (0, 0), mask)

    # 里面 2x2 的白色小格子
    draw = ImageDraw.Draw(canvas)
    cell = big * 0.24          # 每个小格子边长
    gap = big * 0.07
    total = cell * 2 + gap
    left = (big - total) / 2
    top = (big - total) / 2
    radius = max(1, int(cell * 0.22))

    for row in range(2):
        for col in range(2):
            x0 = left + col * (cell + gap)
            y0 = top + row * (cell + gap)
            draw.rounded_rectangle(
                [x0, y0, x0 + cell, y0 + cell], radius=radius, fill=(255, 255, 255, 245)
            )

    return canvas.resize((size, size), Image.LANCZOS)


def main():
    import os

    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        path = os.path.join(OUT_DIR, f"icon{size}.png")
        make_icon(size).save(path, "PNG")
        print("wrote", path)


if __name__ == "__main__":
    main()
