"""生成 README 里用的说明图（不是截图 —— 沙箱里起不了浏览器，没法截真图）。

图都按 newtab.css 里的真实数值画：色块 132x74、间距 20/22、左边卡片 248 宽、
圆角 16/18、毛玻璃 rgba(18,22,32,.52)、搜索框宽 620 高 52。站点名字和颜色
是手抄 storage.js 里 DEFAULT_BOOKMARKS 的 d01~d12，不是编的；改预置时记得同步这里。

产物在 docs/ 下：
  01-整页.png          整页长什么样（带 1~5 标注）
  02-卡片轮播.png      右边那栏五张卡片都长什么样
  03-搜索选引擎.png    点搜索框左边的图标换引擎
  04-添加网站.png      色块右上角的编辑/删除 + 添加网站的小窗
  05-壁纸库.png        右下角「换背景」里的小图墙

跑法：python -X utf8 tools/gen_docs_images.py
"""
import pathlib

from PIL import Image, ImageDraw, ImageFont

PROJECT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = PROJECT / "docs"

MSYH = "E:/Windows/Fonts/msyh.ttc"
MSYH_BOLD = "E:/Windows/Fonts/msyhbd.ttc"
_cache = {}


def font(size, bold=False):
    key = (size, bold)
    if key not in _cache:
        try:
            _cache[key] = ImageFont.truetype(MSYH_BOLD if bold else MSYH, size)
        except OSError:
            _cache[key] = ImageFont.load_default()
    return _cache[key]


# ---------- 画半透明形状：必须画在单独一层再合回去，
# ---------- 直接往 RGBA 图上画低 alpha 色块会被拍成纯白（踩过这个坑）----------

def blend(base, box, painter):
    x1, y1, x2, y2 = [int(v) for v in box]
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(base.width, x2), min(base.height, y2)
    if x2 <= x1 or y2 <= y1:
        return
    layer = Image.new("RGBA", (x2 - x1, y2 - y1), (0, 0, 0, 0))
    painter(ImageDraw.Draw(layer), (0, 0, x2 - x1, y2 - y1))
    base.alpha_composite(layer, (x1, y1))


def rrect(base, box, radius, fill):
    blend(base, box, lambda d, b: d.rounded_rectangle(b, radius, fill=fill))


def ring(base, box, radius, color, width=1):
    blend(base, box, lambda d, b: d.rounded_rectangle(b, radius, outline=color, width=width))


def circle(base, cx, cy, r, fill):
    blend(base, (cx - r, cy - r, cx + r, cy + r),
          lambda d, b: d.ellipse(b, fill=fill))


def glass(base, box, radius=18, alpha=132, edge=30):
    rrect(base, box, radius, (18, 22, 32, alpha))
    ring(base, box, radius, (255, 255, 255, edge), 1)


def sun_cloud(base, cx, cy, r=13):
    """手画一个太阳/云，别用 emoji —— PIL 画不出彩色 emoji，会变成豆腐块。"""
    circle(base, cx, cy, r, (255, 214, 110, 240))
    circle(base, cx - 2, cy + 2, r - 4, (255, 240, 190, 240))


def magnifier(base, cx, cy, r=6):
    ring(base, (cx - r, cy - r, cx + r, cy + r), r, (255, 255, 255, 190), 2)
    blend(base, (cx + r - 2, cy + r - 2, cx + r + 5, cy + r + 5),
          lambda dd, b: dd.line([(b[0], b[1]), (b[2] - 1, b[3] - 1)], fill=(255, 255, 255, 190), width=2))


def text(draw, xy, s, size, bold=False, anchor="la", fill=(255, 255, 255, 235)):
    draw.text(xy, s, font=font(size, bold), anchor=anchor, fill=fill)


def hexc(value):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def cover(path, size):
    image = Image.open(path).convert("RGB")
    want = size[0] / size[1]
    have = image.width / image.height
    if have > want:
        new_w = int(image.height * want)
        left = (image.width - new_w) // 2
        image = image.crop((left, 0, left + new_w, image.height))
    else:
        new_h = int(image.width / want)
        top = (image.height - new_h) // 2
        image = image.crop((0, top, image.width, top + new_h))
    return image.resize(size, Image.LANCZOS).convert("RGBA")


# ---------- 站点：对着 storage.js 的 d01~d12 抄，别自己编 ----------
# 只放大众站点。这里会出现在 README 的图上，别把个人的常用站塞进来。

SITES = [
    ("百度", "#4c7cf3"), ("哔哩哔哩", "#d6409f"), ("知乎", "#0d74ce"), ("微博", "#e5484d"),
    ("抖音", "#12a594"), ("淘宝", "#f0921f"), ("京东", "#e5484d"), ("CSDN", "#e5484d"),
    ("GitHub", "#5a6472"), ("网易云音乐", "#e5484d"), ("豆瓣", "#46a758"), ("微软必应", "#12a594"),
]

TILE_W, TILE_H, GAP_X, GAP_Y = 132, 74, 20, 22
SIDE_W = 248


def draw_tiles(base, d, box, cols, sites, with_add=True):
    """一堆色块。box 是内容区左上角。"""
    x0, y0 = box
    items = list(sites) + ([("+", None)] if with_add else [])
    for i, (label, color) in enumerate(items):
        row, col = divmod(i, cols)
        x = x0 + col * (TILE_W + GAP_X)
        y = y0 + row * (TILE_H + GAP_Y)
        if color is None:
            ring(base, (x, y, x + TILE_W, y + TILE_H), 16, (255, 255, 255, 90), 2)
            text(d, (x + TILE_W / 2, y + TILE_H / 2), "+", 26, False, "mm", (255, 255, 255, 150))
        else:
            rrect(base, (x, y, x + TILE_W, y + TILE_H), 16, hexc(color) + (255,))
            size = 17 if len(label) <= 4 else 14
            text(d, (x + TILE_W / 2, y + TILE_H / 2), label, size, True, "mm", (255, 255, 255, 245))


def draw_weather(base, d, box):
    x, y = box
    w, h = SIDE_W, 400
    glass(base, (x, y, x + w, y + h), 18)
    rrect(base, (x + 16, y + 16, x + 70, y + 74), 14, (255, 255, 255, 34))
    sun_cloud(base, x + 43, y + 45, 15)
    text(d, (x + 82, y + 40), "29°", 36, True, "lm", (255, 255, 255, 245))
    text(d, (x + 82, y + 70), "大部晴朗", 14, False, "lm", (255, 255, 255, 235))
    text(d, (x + 18, y + 96), "体感 34° · 湿度 61% · 南风 2 级 · 空气 79", 11, False, "lm", (255, 255, 255, 150))
    text(d, (x + 18, y + 130), "接下来 3 小时", 12, False, "lm", (255, 255, 255, 175))
    for i, (hour, temp) in enumerate((("17时", "29°"), ("18时", "29°"), ("19时", "28°"))):
        hx = x + 16 + i * 72
        rrect(base, (hx, y + 146, hx + 64, y + 202), 12, (255, 255, 255, 30))
        sun_cloud(base, hx + 32, y + 162, 7)
        text(d, (hx + 32, y + 176), hour, 11, False, "mm", (255, 255, 255, 160))
        text(d, (hx + 32, y + 192), temp, 13, True, "mm", (255, 255, 255, 240))
    text(d, (x + 18, y + 224), "未来 3 天", 12, False, "lm", (255, 255, 255, 175))
    for i, (day, sky, temp) in enumerate((("今天", "局部雷阵雨", "31° / 23°"),
                                          ("明天", "局部雷阵雨", "31° / 23°"),
                                          ("后天", "阵雨", "31° / 24°"))):
        ly = y + 248 + i * 32
        sun_cloud(base, x + 22, ly, 6)
        text(d, (x + 36, ly), day, 13, False, "lm", (255, 255, 255, 230))
        text(d, (x + 70, ly), sky, 12, False, "lm", (255, 255, 255, 195))
        text(d, (x + w - 18, ly), temp, 12, False, "rm", (255, 255, 255, 215))
    text(d, (x + 18, y + h - 18), "16:24 更新", 11, False, "lm", (255, 255, 255, 140))
    for i, label in enumerate(("刷新", "换城市", "MSN")):
        bx = x + 122 + i * 44
        rrect(base, (bx, y + h - 34, bx + 40, y + h - 12), 8, (255, 255, 255, 30))
        text(d, (bx + 20, y + h - 23), label, 10, False, "mm", (255, 255, 255, 200))


def draw_panel(base, d, box, current="待办"):
    """右上角那一栏（只画当前这一张）。"""
    x, y = box
    w, h = SIDE_W, 430
    glass(base, (x, y, x + w, y + h), 18)
    text(d, (x + 18, y + 26), current, 14, True, "lm", (255, 255, 255, 240))
    for i, ch in enumerate(("‹", "›")):
        cx = x + w - 46 + i * 26
        circle(base, cx, y + 26, 11, (255, 255, 255, 34))
        text(d, (cx, y + 26), ch, 14, True, "mm", (255, 255, 255, 235))

    if current == "待办":
        text(d, (x + 18, y + 64), "要做的事", 12, False, "lm", (255, 255, 255, 170))
        text(d, (x + 18, y + 106), "还没有要做的事", 13, False, "lm", (255, 255, 255, 200))
        rrect(base, (x + 18, y + h - 78, x + w - 18, y + h - 46), 12, (255, 255, 255, 30))
        text(d, (x + 30, y + h - 62), "加一件要做的事，回车", 12, False, "lm", (255, 255, 255, 165))
    for i in range(5):
        cx = x + w / 2 - 22 + i * 11
        circle(base, cx, y + h - 22, 3, (255, 255, 255, 235 if current == "待办" and i == 1 else 90))

    # 自动翻页的小注解
    text(d, (x + w / 2, y + h + 16), "每 3 分钟自己翻一张", 11, False, "mm", (255, 255, 255, 170))


def pencil(base, cx, cy, color=(255, 255, 255, 235)):
    """小铅笔（改名字/网址那个按钮）。用画的，别用 "✎" 字符。"""
    blend(base, (cx - 8, cy - 8, cx + 8, cy + 8),
          lambda dd, b: (dd.line([(cx - 5, cy + 5), (cx + 4, cy - 4)], fill=color, width=3),
                         dd.line([(cx + 2, cy - 6), (cx + 6, cy - 2)], fill=color, width=3)))


def trash(base, cx, cy, color=(255, 210, 210, 235)):
    """小垃圾桶（删掉那个按钮）。用画的，别用 "🗑"。"""
    blend(base, (cx - 8, cy - 8, cx + 8, cy + 8),
          lambda dd, b: (dd.rectangle((cx - 4, cy - 4, cx + 4, cy + 6), outline=color, width=2),
                         dd.line([(cx - 6, cy - 6), (cx + 6, cy - 6)], fill=color, width=2),
                         dd.line([(cx - 1, cy - 7), (cx + 1, cy - 7)], fill=color, width=2)))


def cross(base, cx, cy, size=5, color=(255, 220, 220, 240), width=2):
    """画一个叉（删掉这张壁纸）。用画的，别指望字体里的 × / ✕ 一定好看。"""
    blend(base, (cx - size - 2, cy - size - 2, cx + size + 2, cy + size + 2),
          lambda dd, b: (dd.line([(cx - size, cy - size), (cx + size, cy + size)], fill=color, width=width),
                         dd.line([(cx - size, cy + size), (cx + size, cy - size)], fill=color, width=width)))


def check_mark(base, cx, cy, size=5, color=(255, 255, 255, 230), width=2):
    """画一个对勾。别用 "✓" 字符 —— 微软雅黑里没有这个字形，会变成豆腐块。"""
    blend(base, (cx - size - 2, cy - size - 2, cx + size + 2, cy + size + 2),
          lambda dd, b: dd.line([(cx - size, cy), (cx - size * 0.25, cy + size * 0.7),
                                 (cx + size, cy - size * 0.9)], fill=color, width=width, joint="curve"))


def draw_background_btn(base, d, W, H):
    """右下角那个「换背景」按钮。"""
    rrect(base, (W - 150, H - 62, W - 34, H - 26), 12, (255, 255, 255, 30))
    ring(base, (W - 138, H - 52, W - 124, H - 38), 2, (255, 255, 255, 190), 2)
    text(d, (W - 116, H - 44), "换背景", 12, False, "lm", (255, 255, 255, 225))


def draw_search(base, d, box, scale=2.0):
    """搜索框（左上角是选引擎的小圆图标）。"""
    x, y = box
    w, h = int(620 * scale), int(52 * scale)
    rrect(base, (x, y, x + w, y + h), h // 2, (20, 24, 34, 168))
    ring(base, (x, y, x + w, y + h), h // 2, (255, 255, 255, 40), 1)
    r = int(26 * scale / 2)
    circle(base, x + int(26 * scale), y + h // 2, r, (255, 255, 255, 224))
    text(d, (x + int(26 * scale), y + h // 2), "B", int(13 * scale), True, "mm", (27, 33, 48, 255))
    magnifier(base, x + int(58 * scale), y + h // 2, int(7 * scale))
    text(d, (x + int(72 * scale), y + h // 2), "输入搜索内容", int(14 * scale), False, "lm",
         (255, 255, 255, 150))
    return w, h


# ============================ 1. 整页 ============================

def page_shot():
    W, H = 1700, 1080
    base = cover(PROJECT / "wallpapers" / "bing2.jpg", (W, H))
    base = Image.eval(base, lambda v: int(v * 0.78 + 20)).convert("RGBA")
    base.putalpha(255)
    d = ImageDraw.Draw(base)

    sw, sh = 620, 52
    sx = (W - sw) // 2
    sy = 62
    rrect(base, (sx, sy, sx + sw, sy + sh), 26, (20, 24, 34, 168))
    ring(base, (sx, sy, sx + sw, sy + sh), 26, (255, 255, 255, 40), 1)
    circle(base, sx + 26, sy + 26, 13, (255, 255, 255, 224))
    text(d, (sx + 26, sy + 26), "B", 13, True, "mm", (27, 33, 48, 255))
    magnifier(base, sx + 58, sy + 26, 7)
    text(d, (sx + 72, sy + 26), "输入搜索内容", 14, False, "lm", (255, 255, 255, 150))

    content_top = 168
    left = (W - 1500) // 2
    draw_weather(base, d, (left, content_top))
    draw_panel(base, d, (left + 1500 - SIDE_W, content_top))

    mid_x = left + SIDE_W + 48
    mid_w = 1500 - SIDE_W * 2 - 96
    cols = max(1, (mid_w + GAP_X) // (TILE_W + GAP_X))
    used = cols * TILE_W + (cols - 1) * GAP_X
    tiles_x = mid_x + (mid_w - used) // 2
    draw_tiles(base, d, (tiles_x, content_top), cols, SITES)

    # 右下角「换背景」
    draw_background_btn(base, d, W, H)

    # 1~5 标注
    marks = [
        (sx + sw / 2, sy + 6, "1", "搜索框：打字回车；左上角小圆是换引擎的"),
        (left + SIDE_W / 2, content_top - 4, "2", "天气卡片：换城市 / 刷新"),
        (tiles_x + 4 * (TILE_W + GAP_X), content_top - 4, "3", "色块：点开网站；右上角能改能删；拖着能换顺序"),
        (left + 1500 - SIDE_W / 2, content_top - 4, "4", "卡片栏：5 张卡片左右切换，3 分钟自己翻一张"),
        (W - 92, H - 78, "5", "换背景 / 壁纸库"),
    ]
    for mx, my, num, label in marks:
        r = 14
        circle(base, mx, my, r, (229, 72, 77, 245))
        text(d, (mx, my), num, 15, True, "mm", (255, 255, 255, 255))
        tw = d.textlength(label, font=font(12))
        tx = min(max(mx + r + 8, 10), W - tw - 14)
        ty = my - 9
        rrect(base, (tx - 8, ty - 5, tx + tw + 8, ty + 17), 8, (10, 14, 22, 190))
        text(d, (tx, ty + 6), label, 12, False, "lm", (255, 255, 255, 235))

    return base.convert("RGB")


# ============================ 2. 五张卡片 ============================

def panel_shot():
    W, H = 1500, 660
    base = Image.new("RGBA", (W, H), (16, 20, 30, 255))
    d = ImageDraw.Draw(base)

    text(d, (40, 34), "右边那一栏：五张卡片，一次只露一张", 20, True, "la", (255, 255, 255, 240))
    text(d, (40, 64), "左右箭头 / 底下圆点 / 键盘 ← → / 鼠标横拖 都能换；鼠标停在里面它就不自动翻了",
         13, False, "la", (255, 255, 255, 160))

    names = ["日历", "待办", "便签", "倒计时", "每日一句"]
    pw, ph = SIDE_W, 430
    gap = (W - 80 - pw * 5) // 4
    top = 110

    for i, name in enumerate(names):
        x = 40 + i * (pw + gap)
        glass(base, (x, top, x + pw, top + ph), 18, alpha=255, edge=34)
        text(d, (x + 18, top + 26), name, 14, True, "lm", (255, 255, 255, 240))
        for k, ch in enumerate(("‹", "›")):
            circle(base, x + pw - 46 + k * 26, top + 26, 11, (255, 255, 255, 34))
            text(d, (x + pw - 46 + k * 26, top + 26), ch, 14, True, "mm", (255, 255, 255, 235))

        if name == "日历":
            text(d, (x + 18, top + 62), "今天", 12, False, "lm", (255, 255, 255, 150))
            text(d, (x + 18, top + 92), "10 月 15 日", 24, True, "lm", (255, 255, 255, 245))
            text(d, (x + 18, top + 118), "农历九月初五 · 周四", 12, False, "lm", (255, 255, 255, 190))
            rrect(base, (x + 18, top + 132, x + 84, top + 154), 11, (229, 72, 77, 220))
            text(d, (x + 51, top + 143), "无节日", 11, False, "mm", (255, 255, 255, 240))
            text(d, (x + 18, top + 172), "2026 年 10 月", 12, False, "lm", (255, 255, 255, 200))
            grid_top = top + 192
            for col, label in enumerate(("一", "二", "三", "四", "五", "六", "日")):
                cx = x + 24 + col * 31
                text(d, (cx, grid_top), label, 10, False, "mm", (255, 150, 150, 230) if col >= 5 else (255, 255, 255, 150))
            day = 1
            for row in range(5):
                for col in range(7):
                    if day > 31:
                        break
                    cx, cy = x + 24 + col * 31, grid_top + 26 + row * 34
                    if day == 15:
                        rrect(base, (cx - 14, cy - 14, cx + 14, cy + 14), 8, (255, 255, 255, 42))
                    text(d, (cx, cy - 4), str(day), 11, (day == 15), "mm", (255, 255, 255, 240))
                    text(d, (cx, cy + 8), "初" + "一二三四五六七八九十"[(day - 1) % 10], 8, False, "mm",
                         (255, 255, 255, 120))
                    day += 1
        elif name == "待办":
            text(d, (x + 18, top + 62), "要做的事", 12, False, "lm", (255, 255, 255, 150))
            for k, (task, done) in enumerate((("给妈妈打电话", True), ("改一下色块顺序", False), ("交电费", False))):
                ty = top + 98 + k * 34
                circle(base, x + 26, ty, 7, (255, 255, 255, 40) if not done else (70, 167, 88, 230))
                if done:
                    check_mark(base, x + 26, ty, 4)
                text(d, (x + 42, ty), task, 12, False, "lm", (255, 255, 255, 120) if done else (255, 255, 255, 235))
            rrect(base, (x + 18, top + ph - 78, x + pw - 18, top + ph - 46), 12, (255, 255, 255, 30))
            text(d, (x + 30, top + ph - 62), "加一件要做的事，回车", 12, False, "lm", (255, 255, 255, 165))
        elif name == "便签":
            text(d, (x + 18, top + 62), "随手记", 12, False, "lm", (255, 255, 255, 150))
            rrect(base, (x + 18, top + 82, x + pw - 18, top + ph - 76), 12, (255, 255, 255, 24))
            for k, line in enumerate(("明天 10:00 体检，","记得空腹。","", "把壁纸换成 bing3")):
                text(d, (x + 30, top + 100 + k * 22), line, 12, False, "la", (255, 255, 255, 225))
            text(d, (x + 18, top + ph - 52), "停手一会儿自动保存", 11, False, "lm", (255, 255, 255, 150))
            text(d, (x + pw - 18, top + ph - 52), "已保存 16:24:31", 10, False, "rm", (255, 255, 255, 130))
        elif name == "倒计时":
            text(d, (x + 18, top + 62), "纪念日", 12, False, "lm", (255, 255, 255, 150))
            rows = (("生日", "2027-02-17", "还有 125 天"), ("出发去玩", "2026-10-17", "后天"),
                    ("入职纪念日", "2024-09-01", "已经过了 774 天"))
            for k, (label, date, left) in enumerate(rows):
                ty = top + 92 + k * 52
                rrect(base, (x + 18, ty, x + pw - 18, ty + 44), 12, (255, 255, 255, 24))
                text(d, (x + 30, ty + 14), label, 12, True, "lm", (255, 255, 255, 235))
                text(d, (x + 30, ty + 31), date, 10, False, "lm", (255, 255, 255, 140))
                text(d, (x + pw - 30, ty + 22), left, 12, True, "rm", (255, 220, 140, 240) if k == 1 else (255, 255, 255, 220))
            rrect(base, (x + 18, top + ph - 78, x + pw - 18, top + ph - 46), 12, (255, 255, 255, 30))
            text(d, (x + 30, top + ph - 62), "+ 添一个日子", 12, False, "lm", (255, 255, 255, 165))
        else:
            text(d, (x + 24, top + 80), "“", 34, True, "la", (255, 255, 255, 90))
            for k, line in enumerate(("先把今天过好，", "明天的事明天再说。")):
                text(d, (x + 34, top + 116 + k * 26), line, 14, False, "la", (255, 255, 255, 235))
            text(d, (x + 18, top + ph - 52), "2026-10-15 · 第 1 句", 11, False, "lm", (255, 255, 255, 140))
            rrect(base, (x + pw - 86, top + ph - 64, x + pw - 18, top + ph - 40), 10, (255, 255, 255, 32))
            text(d, (x + pw - 52, top + ph - 52), "换一句", 11, False, "mm", (255, 255, 255, 220))

        for k in range(5):
            cx = x + pw / 2 - 22 + k * 11
            circle(base, cx, top + ph - 22, 3, (255, 255, 255, 235 if k == i else 90))

    text(d, (W / 2, H - 26), "图是按 newtab.css 的真实数值画的示意图，不是截屏", 11, False, "mm",
         (255, 255, 255, 130))
    return base.convert("RGB")


# ============================ 3. 选引擎 ============================

def engine_shot():
    W, H = 1200, 480
    base = Image.new("RGBA", (W, H), (16, 20, 30, 255))
    d = ImageDraw.Draw(base)
    text(d, (40, 34), "换搜索引擎：点搜索框左边那个小圆图标", 20, True, "la", (255, 255, 255, 240))
    text(d, (40, 64), "每个引擎一个记号（B / 百 / G / 知 / 哔），选过的记着，下次打开还是它",
         13, False, "la", (255, 255, 255, 160))

    w, h = draw_search(base, d, (40, 110), scale=1.0)
    # 下拉
    mx, my = 40, 110 + h + 8
    mw, mh = 200, 5 * 40 + 12
    rrect(base, (mx, my, mx + mw, my + mh), 14, (22, 26, 36, 250))
    ring(base, (mx, my, mx + mw, my + mh), 14, (255, 255, 255, 40), 1)
    for i, (mark, name) in enumerate((("B", "必应"), ("百", "百度"), ("G", "Google"),
                                      ("知", "知乎"), ("哔", "哔哩哔哩"))):
        iy = my + 6 + i * 40
        on = i == 4
        if on:
            rrect(base, (mx + 6, iy, mx + mw - 6, iy + 36), 10, (255, 255, 255, 30))
        circle(base, mx + 28, iy + 18, 12, (255, 255, 255, 224) if on else (255, 255, 255, 40))
        text(d, (mx + 28, iy + 18), mark, 12, True, "mm", (27, 33, 48, 255) if on else (255, 255, 255, 230))
        text(d, (mx + 50, iy + 18), name, 13, False, "lm", (255, 255, 255, 240))
        if on:
            check_mark(base, mx + mw - 22, iy + 18, 5, (255, 255, 255, 220), 2)

    # 说明
    text(d, (mx + mw + 60, 150), "① 点小圆图标，下拉出来五个引擎", 14, False, "la", (255, 255, 255, 225))
    text(d, (mx + mw + 60, 186), "② 点一个，图标上的记号就换成它", 14, False, "la", (255, 255, 255, 225))
    text(d, (mx + mw + 60, 222), "③ 之后打字回车，就用它搜（新开一个标签页）", 14, False, "la", (255, 255, 255, 225))
    text(d, (mx + mw + 60, 268), "看着像网址的（github.com 这种）直接打开，", 12, False, "la", (255, 255, 255, 165))
    text(d, (mx + mw + 60, 292), "不经过搜索引擎。", 12, False, "la", (255, 255, 255, 165))
    text(d, (mx + mw + 60, 336), "搜索框点一下会滑出「搜索记录」，", 12, False, "la", (255, 255, 255, 165))
    text(d, (mx + mw + 60, 360), "右上角有个「清空」。", 12, False, "la", (255, 255, 255, 165))

    text(d, (W / 2, H - 24), "图是按 newtab.css 的真实数值画的示意图，不是截屏", 11, False, "mm",
         (255, 255, 255, 130))
    return base.convert("RGB")


# ============================ 4. 色块操作 ============================

def tile_shot():
    W, H = 1200, 520
    base = Image.new("RGBA", (W, H), (16, 20, 30, 255))
    d = ImageDraw.Draw(base)
    text(d, (40, 34), "色块：怎么加、怎么改、怎么删、怎么换顺序", 20, True, "la", (255, 255, 255, 240))
    text(d, (40, 64), "鼠标移到色块上，右上角浮出两个小按钮：铅笔改名字 / 网址 / 颜色，垃圾桶删掉它",
         13, False, "la", (255, 255, 255, 160))

    # 左边：一排色块，其中一个悬停
    x0, y0 = 40, 110
    for i, (label, color) in enumerate(SITES[:4]):
        x = x0 + i * (TILE_W + GAP_X)
        rrect(base, (x, y0, x + TILE_W, y0 + TILE_H), 16, hexc(color) + (255,))
        text(d, (x + TILE_W / 2, y0 + TILE_H / 2), label, 17 if len(label) <= 4 else 14, True, "mm",
             (255, 255, 255, 245))
        if i == 1:
            rrect(base, (x + TILE_W - 56, y0 + 4, x + TILE_W - 4, y0 + 32), 10, (10, 14, 22, 220))
            pencil(base, x + TILE_W - 44, y0 + 18)
            trash(base, x + TILE_W - 18, y0 + 18)
            text(d, (x + TILE_W / 2, y0 + TILE_H + 24), "鼠标停上去", 11, False, "mm", (255, 255, 255, 170))
    # 末尾的+
    ax = x0 + 4 * (TILE_W + GAP_X)
    ring(base, (ax, y0, ax + TILE_W, y0 + TILE_H), 16, (255, 255, 255, 90), 2)
    text(d, (ax + TILE_W / 2, y0 + TILE_H / 2), "+", 26, False, "mm", (255, 255, 255, 150))
    text(d, (ax + TILE_W / 2, y0 + TILE_H + 24), "末尾永远是「+」", 11, False, "mm", (255, 255, 255, 170))

    text(d, (40, y0 + TILE_H + 58), "· 拖着色块左右挪，就能换顺序（松手自动保存）", 13, False, "la",
         (255, 255, 255, 200))
    text(d, (40, y0 + TILE_H + 86), "· 点末尾那个「+」加新网站，能选颜色、也能自己调一个", 13, False, "la",
         (255, 255, 255, 200))

    # 右边：添加网站的小窗
    dw, dh = 380, 420
    dx, dy = W - dw - 40, 110
    rrect(base, (dx, dy, dx + dw, dy + dh), 18, (24, 28, 40, 252))
    ring(base, (dx, dy, dx + dw, dy + dh), 18, (255, 255, 255, 44), 1)
    text(d, (dx + dw / 2, dy + 30), "添加网站", 16, True, "mm", (255, 255, 255, 240))
    tw, th = 100, 56
    tx, ty = dx + dw / 2 - tw / 2, dy + 56
    rrect(base, (tx, ty, tx + tw, ty + th), 14, hexc("#4c7cf3") + (255,))
    text(d, (tx + tw / 2, ty + th / 2), "预览", 16, True, "mm", (255, 255, 255, 245))
    text(d, (dx + dw / 2, ty + th + 22), "色块上显示的就是你填的名称", 10, False, "mm", (255, 255, 255, 150))

    for k, (label, value) in enumerate((("名称", "例如：百度"), ("网址", "例如：baidu.com"))):
        fy = dy + 176 + k * 62
        text(d, (dx + 24, fy), label, 12, False, "la", (255, 255, 255, 200))
        rrect(base, (dx + 24, fy + 18, dx + dw - 24, fy + 52), 10, (255, 255, 255, 26))
        text(d, (dx + 34, fy + 35), value, 12, False, "lm", (255, 255, 255, 120))

    text(d, (dx + 24, dy + 306), "颜色", 12, False, "la", (255, 255, 255, 200))
    for i, color in enumerate(("#4c7cf3", "#0d74ce", "#5b5bd6", "#8e4ec6", "#d6409f", "#e5484d",
                               "#f0921f", "#e8b931", "#46a758", "#12a594")):
        cx = dx + 32 + i * 34
        circle(base, cx, dy + 342, 13, hexc(color) + (255,))
        if i == 0:
            check_mark(base, cx, dy + 342, 5, (255, 255, 255, 245), 2)
    rrect(base, (dx + 24, dy + dh - 58, dx + 150, dy + dh - 26), 10, (255, 255, 255, 26))
    text(d, (dx + 87, dy + dh - 42), "取消", 12, False, "mm", (255, 255, 255, 220))
    rrect(base, (dx + dw - 150, dy + dh - 58, dx + dw - 24, dy + dh - 26), 10, (76, 124, 243, 255))
    text(d, (dx + dw - 87, dy + dh - 42), "确定", 12, True, "mm", (255, 255, 255, 245))

    text(d, (W / 2, H - 24), "图是按 newtab.css 的真实数值画的示意图，不是截屏", 11, False, "mm",
         (255, 255, 255, 130))
    return base.convert("RGB")


# ============================ 5. 壁纸库 ============================

# 缩略图一律画成占位图，**不去读 wallpapers/ 里的真图**。
# 那些是作者自己收的图，带个人口味；这张图要跟着 README 发到 GitHub 上，不能带出去。
TILE_PALETTES = [
    ((24, 34, 62), (86, 132, 208), (168, 202, 255)),
    ((40, 22, 58), (152, 92, 176), (236, 186, 255)),
    ((16, 44, 46), (52, 148, 138), (168, 236, 214)),
    ((52, 30, 20), (198, 122, 62), (255, 214, 160)),
    ((22, 30, 44), (74, 96, 132), (196, 212, 236)),
    ((30, 40, 28), (104, 150, 86), (206, 232, 176)),
    ((44, 24, 34), (168, 84, 108), (246, 190, 200)),
    ((20, 26, 40), (60, 74, 110), (150, 168, 206)),
]


def placeholder_tile(size, top, bottom, accent):
    """一块竖向渐变 + 两个柔光圆，冒充一张壁纸缩略图。"""
    w, h = size
    tile = Image.new("RGBA", size)
    d = ImageDraw.Draw(tile)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)],
               fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,))

    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((w * 0.56, -h * 0.62, w * 1.30, h * 0.46), fill=accent + (96,))
    gd.ellipse((-w * 0.14, h * 0.52, w * 0.44, h * 1.34), fill=accent + (58,))
    return Image.alpha_composite(tile, glow)


def wallpaper_shot():
    W, H = 1300, 640
    base = Image.new("RGBA", (W, H), (16, 20, 30, 255))
    d = ImageDraw.Draw(base)

    dw, dh = W - 80, H - 80
    dx, dy = 40, 40
    rrect(base, (dx, dy, dx + dw, dy + dh), 18, (24, 28, 40, 252))
    ring(base, (dx, dy, dx + dw, dy + dh), 18, (255, 255, 255, 44), 1)
    text(d, (dx + 28, dy + 34), "壁纸库", 18, True, "lm", (255, 255, 255, 240))
    rrect(base, (dx + dw - 148, dy + 18, dx + dw - 28, dy + 50), 10, (255, 255, 255, 26))
    text(d, (dx + dw - 88, dy + 34), "+ 添加图片", 12, False, "mm", (255, 255, 255, 225))
    text(d, (dx + 28, dy + 66), "点一下图片就换成它；鼠标移到图上，右上角会出现 ×，点它就从库里删掉",
         12, False, "lm", (255, 255, 255, 160))

    cols, rows = 4, 2
    cw, ch = 258, 150
    gx = (dw - 56 - cols * cw) // (cols - 1)
    for i in range(cols * rows):
        row, col = divmod(i, cols)
        x = dx + 28 + col * (cw + gx)
        y = dy + 96 + row * (ch + 40)
        image = placeholder_tile((cw, ch), *TILE_PALETTES[i])
        base.alpha_composite(image, (x, y))
        ring(base, (x, y, x + cw, y + ch), 12, (255, 255, 255, 46), 1)
        if i == 1:
            text(d, (x + cw / 2, y + ch / 2), "当前用着这张", 12, True, "mm", (255, 255, 255, 245))
            ring(base, (x, y, x + cw, y + ch), 12, (140, 200, 255, 200), 3)
            rrect(base, (x + cw - 30, y + 6, x + cw - 6, y + 30), 8, (10, 14, 22, 220))
            cross(base, x + cw - 18, y + 18, 4, (255, 220, 220, 240), 2)

    text(d, (dx + 28, dy + dh - 34), "自己加的图存在浏览器本机（chrome.storage.local），不占同步空间；随时能删，也能把图片直接拖到页面上换上",
         11, False, "lm", (255, 255, 255, 160))
    text(d, (W / 2, H - 18), "图是按 newtab.css 的真实数值画的示意图，缩略图是画出来的占位图（仓库里不带壁纸文件）", 11, False,
         "mm", (255, 255, 255, 130))
    return base.convert("RGB")


def main():
    OUT_DIR.mkdir(exist_ok=True)
    jobs = [
        ("01-整页.png", page_shot),
        ("02-卡片轮播.png", panel_shot),
        ("03-搜索选引擎.png", engine_shot),
        ("04-添加网站.png", tile_shot),
        ("05-壁纸库.png", wallpaper_shot),
    ]
    for name, fn in jobs:
        image = fn()
        path = OUT_DIR / name
        image.save(path)
        print(f"写好 {path}（{image.width}x{image.height}，{path.stat().st_size // 1024} KB）")


if __name__ == "__main__":
    main()
