"""从 Wallpaper Engine 的「视频壁纸」里抽一张静帧，做成 NKtab 的内置壁纸。

为什么只做视频壁纸：
  WE 的壁纸分三种。`video` 类型在工坊文件夹里就是一个真·mp4（有的 4K），
  所以抽出来的帧是**真正的全分辨率画面**。
  而 `scene` 类型的内容全塞在 `scene.pkg` 这个私有压缩包里，里面是分层材质，
  没有一张现成的整图；能从文件夹里拿到的只有作者传的 1024x1024 预览图，
  铺满屏幕会糊 —— 所以这个脚本不碰 scene。

依赖：一个 ffmpeg 可执行文件。脚本会先翻 `.cache` 文件夹，再退回 imageio-ffmpeg。
    python -m pip install imageio-ffmpeg
    （或者手动下载 https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip
      解压到扩展文件夹里的 .cache/ 下 —— 注意它有一百多兆，跑完记得把 .cache 删掉，
      别留在扩展文件夹里。）

跑一次就够，结果写进 wallpapers/。脚本最后会打印该贴进 storage.js 的代码。
"""

import json
import os
import re
import subprocess
import sys
import unicodedata

from PIL import Image

# 控制台默认是 GBK，标题里常带特殊字符，直接 print 会崩。强制走 UTF-8。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "..", "wallpapers")
LIB = r"G:\steam\steamapps\workshop\content\431960"

MAX_SIDE = 2560
QUALITY = 88
NAME_MAX = 12          # 卡片上名字最多显示几个字

# 卡片上只留这些东西，其余（表情、数学字母、日文假名、装饰符）一律去掉
CJK = r"\u4e00-\u9fff"
KEEP = re.compile(r"[^A-Za-z0-9" + CJK + r"·・\-—_ ()（）\[\]【】《》.。×]")


def clean_label(text, fallback="WE 壁纸"):
    """把 WE 的标题收拾成能在色块卡片上显示的样子。

    WE 的标题长这样：「银狼（why would i...」「Initialclip Mercedes C63S AMG」
    「𝐢'𝐦 𝐚𝐥𝐰𝐚𝐲𝐬 𝐡𝐞𝐫𝐞」——有全角括号、有超长英文副标题、还有数学粗体字母。
    """
    text = unicodedata.normalize("NFC", text or "")
    text = "".join(ch for ch in text if ch.isprintable())
    text = KEEP.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) < 2:
        return fallback

    # 中文开头（且不是以【《[ 打头）：碰到第一个拉丁字母就把后面的全砍掉
    if not text.startswith(("【", "《", "[", "(", "（")) and re.match(r"^[" + CJK + r"]", text):
        text = re.split(r"[A-Za-z]", text, maxsplit=1)[0]
    text = text.strip(" -·_—:.。,")
    if len(text) < 2:
        return fallback

    if len(text) > NAME_MAX:
        cut = text[:NAME_MAX]
        nxt = text[NAME_MAX:NAME_MAX + 1]
        if nxt and re.match(r"[A-Za-z0-9]", nxt):
            space = cut.rfind(" ")          # 截在词中间了，退回上一个空格
            if space >= 4:
                cut = cut[:space]
        text = cut

    text = text.strip(" -·_—:.。（(")
    return text if len(text) >= 2 else fallback


def ffmpeg_exe():
    """先看 .cache 里有没有解压好的，再退回 imageio-ffmpeg 自带的那个。"""
    cache = os.path.join(HERE, "..", ".cache")
    if os.path.isdir(cache):
        for dirpath, _dirs, files in os.walk(cache):
            if "ffmpeg.exe" in files:
                return os.path.join(dirpath, "ffmpeg.exe")
    try:
        import imageio_ffmpeg
    except ImportError:
        print("找不到 ffmpeg。两个办法：")
        print("  a) 把 ffmpeg 的 zip 解压到 .cache 文件夹里")
        print("  b) python -m pip install imageio-ffmpeg")
        sys.exit(1)
    return imageio_ffmpeg.get_ffmpeg_exe()


def project_title(folder):
    path = os.path.join(folder, "project.json")
    if not os.path.exists(path):
        return ""
    try:
        with open(path, encoding="utf-8-sig") as handle:
            return (json.load(handle).get("title") or "").strip()
    except Exception:
        return ""


def project_type(folder):
    path = os.path.join(folder, "project.json")
    if not os.path.exists(path):
        return ""
    try:
        with open(path, encoding="utf-8-sig") as handle:
            return (json.load(handle).get("type") or "").strip().lower()
    except Exception:
        return ""


def find_video(folder):
    """文件夹里最大的那个 mp4 就是主视频。"""
    best, best_size = "", 0
    for dirpath, _dirs, files in os.walk(folder):
        for name in files:
            if not name.lower().endswith((".mp4", ".webm", ".mkv", ".avi")):
                continue
            path = os.path.join(dirpath, name)
            size = os.path.getsize(path)
            if size > best_size:
                best, best_size = path, size
    return best


def grab_frame(ffmpeg, video, out_path, at_seconds):
    """用 ffmpeg 抽一帧存成 png（中间文件），失败返回 False。"""
    tmp = out_path + ".png"
    cmd = [
        ffmpeg, "-y", "-loglevel", "error",
        "-ss", str(at_seconds), "-i", video,
        "-frames:v", "1", tmp,
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0 or not os.path.exists(tmp):
        return None
    return tmp


def shrink_and_save(src, out_path):
    with Image.open(src) as img:
        img = img.convert("RGB")
        w, h = img.size
        if max(w, h) > MAX_SIDE:
            if w >= h:
                img = img.resize((MAX_SIDE, round(h * MAX_SIDE / w)), Image.LANCZOS)
            else:
                img = img.resize((round(w * MAX_SIDE / h), MAX_SIDE), Image.LANCZOS)
        img.save(out_path, "JPEG", quality=QUALITY, optimize=True)
        return img.size


def main():
    ffmpeg = ffmpeg_exe()
    print("ffmpeg:", ffmpeg)
    os.makedirs(OUT_DIR, exist_ok=True)

    if not os.path.isdir(LIB):
        print("找不到 Wallpaper Engine 工坊目录：", LIB)
        return

    folders = sorted(
        d for d in os.listdir(LIB) if os.path.isdir(os.path.join(LIB, d))
    )

    videos = []
    for name in folders:
        folder = os.path.join(LIB, name)
        if project_type(folder) != "video":
            continue
        video = find_video(folder)
        if not video:
            continue
        size = os.path.getsize(video)
        videos.append((size, folder, video, project_title(folder) or name))

    videos.sort(reverse=True)
    print(f"找到 {len(videos)} 个视频壁纸")
    print()

    made, seen_titles = [], {}
    for index, (size, folder, video, title) in enumerate(videos, start=1):
        out_name = f"we{index:02d}.jpg"
        out_path = os.path.join(OUT_DIR, out_name)

        # 先试 8 秒处（避开黑场/片头），抽不到就退回第 1 秒、再退回第 0 秒
        tmp = None
        for at in (8, 1, 0):
            tmp = grab_frame(ffmpeg, video, out_path, at)
            if tmp:
                break
        if not tmp:
            print(f"  跳过 {title}（抽帧失败）")
            continue

        dims = shrink_and_save(tmp, out_path)
        os.remove(tmp)

        # 重名的尾巴上加个序号，免得卡片上两格一模一样的字
        label = clean_label(title, f"WE 壁纸 {index}") or f"WE 壁纸 {index}"
        seen_titles[label] = seen_titles.get(label, 0) + 1
        if seen_titles[label] > 1:
            label = f"{label} {seen_titles[label]}"

        made.append((out_name, label, dims, os.path.getsize(out_path), size / 1024 / 1024))
        print(f"  {out_name}  {dims[0]}x{dims[1]:<5} {os.path.getsize(out_path)/1024:6.0f}KB  {label}")

    print()
    print("=== 贴进 storage.js 的 BUILTIN_WALLPAPERS（接在现有那些后面）===")
    for out_name, label, _d, _l, _s in made:
        print(
            f'  {{ id: "builtin:{os.path.splitext(out_name)[0]}", '
            f'name: "{label}", path: "wallpapers/{out_name}" }},'
        )
    print()
    print(f"共 {len(made)} 张，合计 {sum(m[3] for m in made)/1024/1024:.1f} MB")


if __name__ == "__main__":
    main()
