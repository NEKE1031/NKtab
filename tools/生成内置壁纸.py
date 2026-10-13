"""把一批图片做成 NKtab 自带的内置壁纸。

跑一次就够了，结果直接写进 wallpapers/ 文件夹。
想换掉哪张，就把生成的 jpg 覆盖掉，文件名别改。

内置壁纸放在扩展文件夹里，**不占 chrome.storage**，
所以它们可以比用户自己加的图大一些（这里统一压到最长边 2560）。
"""

import json
import os
import sys
import urllib.request

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "..", "wallpapers")

MAX_SIDE = 2560
QUALITY = 88

PICTURES = os.path.expanduser(r"~\Pictures")

# ---- 第一部分：从 Pictures 里挑出来的 5 张 ----
# 名字 -> (相对 Pictures 的路径片段, 输出文件名, 卡片上显示的名字, 要不要裁掉游戏边框)
#
# 最后那个 True 是给「异环」的照片模式截图用的：它外面套了一圈灰色的
# 「SPECIAL FILETRAME」文件框。不裁掉的话，图片比例是 1.724，铺到 1.778 的
# 屏幕上时上下会各留一条灰边。
# 这几个数是在 3922×2275 的原图上量出来的（看每行的饱和度：灰框几乎没有颜色）：
#   上 52px、左 58px、右 58px，下面那条要宽得多、约 170px ——
#   那一条里印着「郁闷黄瓜neke酱 / BUREAU OF ANOMALY CONTROL / UID:215017140078」。
# 裁完是 3806×2053（比例 1.854），比屏幕 1.778 略宽，左右会由毛玻璃补一点点。
FRAME_TRIM = (58, 52, 58, 170)         # 左, 上, 右, 下

LOCAL = [
    ("NevernessToEverness", "26_08_18_20_19_52.png", "pic1.jpg", "异环 · 樱花", True),
    ("NevernessToEverness", "26_04_25_14_40_04.png", "pic2.jpg", "异环 · 黄昏", True),
    ("NevernessToEverness", "26_04_24_00_35_41.png", "pic3.jpg", "异环 · 双子", True),
    ("NevernessToEverness", "26_04_24_00_30_36.png", "pic4.jpg", "异环 · 晴空", True),
    ("gogh", "20251219160643.png", "pic5.jpg", "初音 · 钢琴", False),
]

# ---- 第二部分：Bing 每日壁纸 ----
BING_COUNT = 6
BING_NAME = "风景"


def find_local(folder, filename):
    """在 Pictures 下找到那个文件（不区分路径大小写）。"""
    target = filename.lower()
    for dirpath, _dirs, files in os.walk(PICTURES):
        if os.path.basename(dirpath).lower() != folder.lower():
            continue
        for f in files:
            if f.lower() == target:
                return os.path.join(dirpath, f)
    return None


def save_shrunk(src_path_or_img, out_path, trim=0):
    """读图（或直接给一个 Image）、压到 MAX_SIDE、存成 JPEG。

    trim 是每边先裁掉多少像素（用来去掉游戏的灰色文件框）。
    """
    if isinstance(src_path_or_img, Image.Image):
        img = src_path_or_img
    else:
        img = Image.open(src_path_or_img)
    with img:
        img = img.convert("RGB")
        if trim:
            w, h = img.size
            if isinstance(trim, (tuple, list)):
                left, top, right, bottom = trim
            else:
                left = top = right = bottom = trim
            img = img.crop((left, top, w - right, h - bottom))
        w, h = img.size
        if max(w, h) > MAX_SIDE:
            if w >= h:
                img = img.resize((MAX_SIDE, round(h * MAX_SIDE / w)), Image.LANCZOS)
            else:
                img = img.resize((round(w * MAX_SIDE / h), MAX_SIDE), Image.LANCZOS)
        img.save(out_path, "JPEG", quality=QUALITY, optimize=True)
        return img.size


def main():
    # 加 --local-only 就只重做 Pictures 那几张，不去 Bing 重新下（免得把风景换掉）
    only_local = "--local-only" in sys.argv

    os.makedirs(OUT_DIR, exist_ok=True)
    made = []

    print("=== 一、从 Pictures 里拿 ===")
    for folder, filename, out_name, label, trim in LOCAL:
        src = find_local(folder, filename)
        out = os.path.join(OUT_DIR, out_name)
        if not src:
            print(f"  跳过 {filename}（没找到）")
            continue
        size = save_shrunk(src, out, FRAME_TRIM if trim else 0)
        made.append((out_name, label, size, os.path.getsize(out)))
        note = f"，裁掉灰框 {FRAME_TRIM}" if trim else ""
        print(f"  {out_name:10} <- {filename}  变成 {size[0]}x{size[1]}{note}")

    print()
    print("=== 二、Bing 每日壁纸 ===")
    if only_local:
        print("  （--local-only，跳过）")
        images = []
    else:
        try:
            url = (
                "https://www.bing.com/HPImageArchive.aspx"
                f"?format=js&idx=0&n={BING_COUNT}&mkt=zh-CN"
            )
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            data = json.load(urllib.request.urlopen(req, timeout=20))
            images = data.get("images", [])
        except Exception as exc:
            print("  拿不到列表：", type(exc).__name__, exc)
            images = []

    for i, item in enumerate(images[:BING_COUNT], start=1):
        out_name = f"bing{i}.jpg"
        out = os.path.join(OUT_DIR, out_name)
        base = item.get("urlbase", "")
        ok = False
        for suffix in ("_1920x1080.jpg", "_UHD.jpg"):
            try:
                full = "https://www.bing.com" + base + suffix
                req = urllib.request.Request(full, headers={"User-Agent": "Mozilla/5.0"})
                raw = urllib.request.urlopen(req, timeout=25).read()
                tmp = out + ".tmp"
                with open(tmp, "wb") as handle:
                    handle.write(raw)
                size = save_shrunk(tmp, out)
                os.remove(tmp)
                made.append((out_name, f"{BING_NAME} {i}", size, os.path.getsize(out)))
                print(f"  {out_name:10} <- {suffix}  变成 {size[0]}x{size[1]}")
                ok = True
                break
            except Exception:
                continue
        if not ok:
            print(f"  {out_name} 下载失败，跳过")

    print()
    print("=== 结果 ===")
    total = 0
    for name, label, size, length in made:
        total += length
        print(f"  {name:10} {size[0]:>5}x{size[1]:<5} {length/1024:7.0f}KB  {label}")
    print(f"  合计 {total/1024/1024:.1f} MB，都在 {os.path.abspath(OUT_DIR)}")

    print()
    print("=== 贴进 storage.js 的 BUILTIN_WALLPAPERS ===")
    print('  { id: "builtin:desktop", name: "桌面壁纸", path: "wallpapers/desktop.jpg" },')
    for name, label, _size, _length in made:
        print(
            f'  {{ id: "builtin:{os.path.splitext(name)[0]}", '
            f'name: "{label}", path: "wallpapers/{name}" }},'
        )


if __name__ == "__main__":
    main()
