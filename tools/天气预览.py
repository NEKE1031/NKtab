"""
天气卡片效果预览 —— 在装之前先看看长什么样。

画的是 1.6 倍大小，让细节看得清。数据是**现拿的真实数据**
（先问 weather.service.msn.com 要城市经纬度，再问 api.msn.com 要逐小时），
所以这张图上的温度、天气、接下来 3 小时、未来 3 天全是真的。

它顺便还起了个作用：Python 和 JavaScript 是两套独立代码，
如果 weather.js 里读的字段名写错了，这张图就会露馅。

跑法：
  python tools/天气预览.py
输出：
  tools/天气预览.png
"""

import json
import math
import os
import sys
import urllib.parse
import urllib.request
import uuid
from datetime import datetime
from xml.etree import ElementTree

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "天气预览.png")

SCALE = 1.35

# ---- 版面数值，全部对着 newtab.css 抄 ----
CONTENT_W = 1500        # newtab.css 里的 --page-max
LEFT_W = 248            # 天气卡片宽
PANEL_W = 248           # 右边那一栏宽
GAP = 24                # 三块之间的间距
TILE_W, TILE_H = 132, 74
TGX, TGY = 20, 22
COLS = 6                # 1500 宽时中间一行放得下 6 个
EDGE = 34               # 画布左右各留一点，不然贴边看不清

GRID_W = CONTENT_W - LEFT_W - GAP - PANEL_W - GAP          # 956
TILES_W = COLS * TILE_W + (COLS - 1) * TGX                 # 892
TILES_PAD = (GRID_W - TILES_W) / 2                         # 中间那 32px 余量

# 画布按 CSS 像素算，最后再整体放大 SCALE 倍。
CW = EDGE + CONTENT_W + EDGE
CH = 34 + 412 + 46                                         # 上空 + 卡片高 + 底下那行说明
W, H = int(CW * SCALE), int(CH * SCALE)

CITY = "上海"
API_KEY = "j5i4gDqHL6nGYwx5wi5kRhXjtf2c5qgFX9fzfk0TOo"

CITY_URL = ("https://weather.service.msn.com/find.aspx?src=msn&weadegreetype=C"
            "&culture=zh-Hans-CN&weasearchstr=" + urllib.parse.quote(CITY))

FONT_DIR = "C:/Windows/Fonts"
EMOJI = os.path.join(FONT_DIR, "seguiemj.ttf")

# 色块上用到的几个默认网站（名字 + 颜色），只是为了把"天气卡片摆在色块旁边"画出来
TILES = [
    ("百度", "#4c7cf3"), ("哔哩哔哩", "#d6409f"), ("知乎", "#0d74ce"),
    ("微博", "#e5484d"), ("抖音", "#12a594"), ("淘宝", "#f0921f"),
    ("CSDN", "#e5484d"), ("GitHub", "#5a6472"), ("网易云音乐", "#e5484d"),
    ("豆瓣", "#46a758"), ("京东", "#e5484d"), ("微软必应", "#12a594"),
]

ICON_COLORS = ["#4c7cf3", "#0d74ce", "#5b5bd6", "#8e4ec6", "#d6409f", "#e5484d",
               "#f0921f", "#e8b931", "#46a758", "#12a594", "#a18072", "#5a6472"]

FALLBACK = {
    "city": "上海市", "temp": 27, "sky": "大部晴朗", "code": "34", "night": False,
    "feels": 30, "humidity": 56, "wind": "西北 19 公里/小时", "aqi": None,
    "updated": "12:55",
    "hours": [("13时", 27, "大部晴朗"), ("14时", 28, "大部晴朗"), ("15时", 28, "局部晴朗")],
    "days": [("今天", "大部晴朗", 19, 28), ("明天", "局部晴朗", 20, 25), ("后天", "局部晴朗", 22, 27)],
}


# ---------------------------------------------------------------- 字体

def font(size, bold=False):
    name = "msyhbd.ttc" if bold else "msyh.ttc"
    return ImageFont.truetype(os.path.join(FONT_DIR, name), int(round(size * SCALE)))


def is_emoji(ch):
    """判断这个字符是不是表情。

    注意不能简单用 ord(ch) > 0x2000：汉字（大部晴朗、上海市）也满足这个条件，
    会被丢给表情字体去画，结果是满屏方块。表情其实只落在几个固定的区间里。
    """
    o = ord(ch)
    return (0x1F000 <= o <= 0x1FAFF) or (0x2600 <= o <= 0x27BF) or (0x2B00 <= o <= 0x2BFF)


def text_with_emoji(draw, xy, text, f, fill=(255, 255, 255)):
    """把一串里夹着的表情挑出来单独画（表情字体和汉字字体不是同一个）。"""
    if not os.path.exists(EMOJI):
        draw.text(xy, text, font=f, fill=fill)
        return
    ef = ImageFont.truetype(EMOJI, f.size)
    x, y = xy
    for ch in text:
        if ord(ch) in (0xFE0E, 0xFE0F, 0x200D):   # 变体选择符、零宽连接符，不占位置
            continue
        here = ef if is_emoji(ch) else f
        draw.text((x, y), ch, font=here, fill=fill,
                  **({"embedded_color": True} if here is ef else {}))
        x += draw.textlength(ch, font=here)


# ---------------------------------------------------------------- 取数据

def http(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def icon_of(text, code, night=False):
    """weather.js 里 iconFor() 的副本。"""
    t = str(text or "")
    if "雷" in t:
        return "⛈️"
    if any(k in t for k in ("雪", "冰", "冻雨")):
        return "🌨️" if any(k in t for k in ("小", "阵", "零星")) else "❄️"
    if "雨" in t:
        return "🌦️" if any(k in t for k in ("小", "阵", "零星")) else "🌧️"
    if any(k in t for k in ("雾", "霾", "沙", "尘")):
        return "🌫️"
    if any(k in t for k in ("风", "飑")):
        return "💨"
    if "阴" in t:
        return "☁️"
    if any(k in t for k in ("多云", "少云", "局部", "短时")):
        return "⛅"
    if "晴" in t:
        if night:
            return "🌙"
        return "🌤️" if any(k in t for k in ("大部", "以晴", "晴间")) else "☀️"
    return "🌡️"


def day_label(iso, index):
    """weather.js 里 dayLabel() 的简化版：只按顺序给今天/明天/后天。"""
    return ["今天", "明天", "后天"][index] if index < 3 else ""


def load():
    """先拿城市（顺带经纬度），再拿逐小时。哪一步失败就整体退回样本。"""
    try:
        xml = http(CITY_URL)
        node = ElementTree.fromstring(xml).find("weather")
        if node is None:
            raise ValueError("find.aspx 没有返回 <weather>")
        lat, lon = node.get("lat"), node.get("long")
        name = (node.get("weatherlocationname") or CITY).replace("中华人民共和国", "")

        url = ("https://api.msn.com/weather/overview?apikey=" + API_KEY +
               "&ocid=msftweather&locale=zh-cn&units=C" +
               "&lat=" + urllib.parse.quote(lat) + "&lon=" + urllib.parse.quote(lon) +
               "&activityId=" + str(uuid.uuid4()))
        payload = json.loads(http(url))
        weather = payload["value"][0]["responses"][0]["weather"][0]

        cur = weather.get("current", {})
        raw_days = weather.get("forecast", {}).get("days", [])

        hours = []
        now = datetime.now().astimezone()
        for day in raw_days:
            for h in day.get("hourly", []) or []:
                valid = h.get("valid", "")
                if "T" not in valid:
                    continue
                # 和 weather.js 一样：已经过去的小时不要
                try:
                    if datetime.fromisoformat(valid) <= now:
                        continue
                except ValueError:
                    pass
                hours.append((valid[11:13].lstrip("0") + "时", h.get("temp"), h.get("cap", "")))
                if len(hours) >= 3:
                    break
            if len(hours) >= 3:
                break

        days = []
        for i, day in enumerate(raw_days[:3]):
            d = day.get("daily", {})
            part = d.get("day") or d.get("night") or {}
            days.append((day_label(d.get("valid"), i),
                         d.get("pvdrCap") or part.get("cap") or "",
                         d.get("tempLo"), d.get("tempHi")))

        wind = " ".join(x for x in [cur.get("pvdrWindDir"), cur.get("pvdrWindSpd")] if x)
        data = {
            "city": name,
            "temp": cur.get("temp"),
            "sky": cur.get("cap") or "",
            "code": cur.get("icon"),
            "night": str(cur.get("symbol", "")).startswith("n"),
            "feels": cur.get("feels"),
            "humidity": cur.get("rh"),
            "wind": wind or (f"{cur.get('windSpd')} 公里/小时" if cur.get("windSpd") else ""),
            "aqi": cur.get("aqi"),
            "updated": str(cur.get("created", ""))[11:16],
            "hours": hours or FALLBACK["hours"],
            "days": days or FALLBACK["days"],
        }
        print(f"真实数据：{data['city']} {data['temp']}° {data['sky']}  "
              f"逐小时 {len(hours)} 条 / 未来 {len(days)} 天")
        return data
    except Exception as exc:  # noqa: BLE001
        print(f"没联上网（{type(exc).__name__}: {exc}），用固定样本")
        return dict(FALLBACK)


# ---------------------------------------------------------------- 画图

def px(v):
    return int(round(v * SCALE))


def fmt(value):
    """数字统一画成整数：27.0 -> "27"。weather.js 那边 JSON 给的就是 27，
    只有 Python 拿到的会是浮点，所以在这边抹平。"""
    if value is None:
        return "--"
    try:
        return str(int(round(float(value))))
    except (TypeError, ValueError):
        return str(value)


def clip(draw, text, f, max_w):
    """太长就掐掉尾巴加省略号，别让它压到右边的温度上。"""
    if draw.textlength(text, font=f) <= max_w:
        return text
    while text and draw.textlength(text + "…", font=f) > max_w:
        text = text[:-1]
    return text + "…" if text else ""


def background(draw):
    top, bottom = (26, 42, 74), (92, 132, 176)
    for y in range(H):
        t = y / H
        draw.line([(0, y), (W, y)],
                  fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))

    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for cx, cy, r, alpha in [(960, 120, 260, 46), (1050, 300, 180, 34),
                             (140, 470, 300, 26), (600, 90, 220, 22)]:
        gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, alpha))
    return glow


def text_color_on(hex_color):
    """weather.js 里 textColorOn() 的副本：底色浅就用深色字，否则白字。"""
    h = hex_color.lstrip("#")
    rgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
    return (26, 29, 36) if lum > 0.55 else (255, 255, 255)


def draw_tiles(d, x0, y0):
    """把几个网站色块画出来（6 列，和 --page-max:1500 时的真实排布一致）。"""
    for i, (name, color) in enumerate(TILES):
        col, row = i % COLS, i // COLS
        x = x0 + col * (TILE_W + TGX)
        y = y0 + row * (TILE_H + TGY)
        d.rounded_rectangle([px(x), px(y), px(x + TILE_W), px(y + TILE_H)],
                            radius=px(16), fill=color)

        avail = TILE_W - 24
        f = font(30, True)
        natural = d.textlength(name, font=f)
        size = 30
        if natural > px(avail):
            size = 30 * px(avail) / natural
            f = font(size, True)
        fg = text_color_on(color)
        tw_ = d.textlength(name, font=f)
        d.text((px(x + TILE_W / 2) - tw_ / 2, px(y + TILE_H / 2) - f.size * 0.62),
               name, font=f, fill=fg)

    # 「添加网站」那一格
    i = len(TILES)
    col, row = i % COLS, i // COLS
    x = x0 + col * (TILE_W + TGX)
    y = y0 + row * (TILE_H + TGY)
    d.rounded_rectangle([px(x), px(y), px(x + TILE_W), px(y + TILE_H)], radius=px(16),
                        fill=(255, 255, 255, 26), outline=(255, 255, 255, 64),
                        width=max(1, px(1.2)))
    cross = font(24, True)
    cw = d.textlength("＋", font=cross)
    d.text((px(x + TILE_W / 2) - cw / 2, px(y + TILE_H / 2) - cross.size * 0.6), "＋",
           font=cross, fill=(255, 255, 255, 190))

    rows = (i // COLS) + 1
    return rows * TILE_H + (rows - 1) * TGY


# ---------------------------------------------------------------- 右边那一栏

def _round_rect_points(x0, y0, x1, y1, r, step=1.5):
    """把圆角矩形的边框拆成一串点，好沿着它画虚线。"""
    pts = []

    def arc(cx, cy, a0, a1):
        n = max(2, int(abs(a1 - a0) * r / step) + 1)
        for k in range(n + 1):
            a = a0 + (a1 - a0) * k / n
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))

    pts.append((x0 + r, y0))
    pts.append((x1 - r, y0))
    arc(x1 - r, y0 + r, -math.pi / 2, 0)
    pts.append((x1, y1 - r))
    arc(x1 - r, y1 - r, 0, math.pi / 2)
    pts.append((x0 + r, y1))
    arc(x0 + r, y1 - r, math.pi / 2, math.pi)
    pts.append((x0, y0 + r))
    arc(x0 + r, y0 + r, math.pi, 1.5 * math.pi)
    pts.append((x0 + r, y0))
    return pts


def dashed_round_rect(d, box, radius, color, dash=7, gap=6, width=1):
    """圆角虚线框。PIL 没有现成的，只能自己沿着边框一段段画。"""
    x0, y0, x1, y1 = [px(v) for v in box]
    pts = _round_rect_points(x0, y0, x1, y1, px(radius))
    on, left = True, dash
    for i in range(len(pts) - 1):
        ax, ay = pts[i]
        bx, by = pts[i + 1]
        seg = math.hypot(bx - ax, by - ay)
        if seg <= 0:
            continue
        t = 0.0
        while t < seg:
            take = min(left, seg - t)
            if on and take > 0:
                u0, u1 = t / seg, (t + take) / seg
                d.line([ax + (bx - ax) * u0, ay + (by - ay) * u0,
                        ax + (bx - ax) * u1, ay + (by - ay) * u1],
                       fill=color, width=width)
            t += take
            left -= take
            if left <= 1e-6:
                on = not on
                left = dash if on else gap


def draw_panel(d, x, y, h):
    """右边那块占位栏。壳子照抄天气卡片，里面是先占着位置的虚线空位。"""
    pad = 16
    d.rounded_rectangle([px(x), px(y), px(x + PANEL_W), px(y + h)],
                        radius=px(18), fill=(18, 22, 32, 133))

    d.text((px(x + pad), px(y + pad)), "这一栏还空着", font=font(12, True),
           fill=(255, 255, 255, 178))

    note = ["待办 / 便签 / 日历 / 倒计时", "想放哪个说一声"]
    note_h = 2 * 16 + 2
    slot_y = y + pad + 17 + 12
    slot_h = h - (pad + 17 + 12) - (12 + note_h + 14)

    dashed_round_rect(d, (x + pad, slot_y, x + PANEL_W - pad, slot_y + slot_h),
                      14, (255, 255, 255, 66), dash=px(7), gap=px(6),
                      width=max(1, px(1)))

    plus = font(30)
    pw = d.textlength("＋", font=plus)
    hint = ["先在两边各占一块", "中间就正了"]
    block_h = plus.size + 10 + 2 * 20
    by = slot_y + slot_h / 2 - block_h / 2
    d.text((px(x + PANEL_W / 2) - pw / 2, px(by)), "＋", font=plus,
           fill=(255, 255, 255, 128))
    for k, line in enumerate(hint):
        w = d.textlength(line, font=font(12))
        d.text((px(x + PANEL_W / 2) - w / 2, px(by + plus.size / SCALE + 10 + k * 20)),
               line, font=font(12), fill=(255, 255, 255, 168))

    ny = y + h - 14 - note_h
    for k, line in enumerate(note):
        d.text((px(x + pad), px(ny + k * 16)), line, font=font(11),
               fill=(255, 255, 255, 117))


# ---------------------------------------------------------------- 天气卡片


def draw_card(d, data, x, y):
    """天气卡片本体。尺寸尽量贴着 newtab.css 里的数值。"""
    cw = 248
    pad = 16
    inner = cw - pad * 2
    fg = (255, 255, 255)

    # 先算高度
    h = pad + 76 + 10 + 19                      # 顶部大图标 + 温度
    h += 12 + 10 + 18 + 67                      # 分隔 + 「接下来 3 小时」
    h += 12 + 10 + 18 + 3 * 26 + 2              # 分隔 + 「未来 3 天」
    h += 11 + 9 + 20 + 12                       # 底部分隔 + 按钮

    d.rounded_rectangle([px(x), px(y), px(x + cw), px(y + h)],
                        radius=px(18), fill=(18, 22, 32, 133))

    cy = y + pad

    # ---- 大图标框 ----
    d.rounded_rectangle([px(x + pad), px(y + pad), px(x + pad + 76), px(y + pad + 76)],
                        radius=px(20), fill=(255, 255, 255, 33),
                        outline=(255, 255, 255, 56), width=max(1, px(1)))
    big = font(40)
    icon = icon_of(data["sky"], data["code"], data.get("night"))
    iw = d.textlength(icon, font=ImageFont.truetype(EMOJI, big.size)) if os.path.exists(EMOJI) else 0
    text_with_emoji(d, (px(x + pad + 38) - iw / 2, px(y + pad + 38) - big.size * 0.62), icon, big)

    # ---- 右边文字 ----
    tx = x + pad + 76 + 13
    ft = font(30, True)
    d.text((px(tx), px(cy + 4)), f"{fmt(data['temp'])}°", font=ft, fill=fg)
    d.text((px(tx), px(cy + 38)), data["sky"], font=font(13), fill=(255, 255, 255, 235))
    d.text((px(tx), px(cy + 56)), data["city"], font=font(12), fill=(255, 255, 255, 153))
    cy += 76

    # ---- 体感 / 湿度 / 风 ----
    bits = []
    if data["feels"] is not None:
        bits.append(f"体感 {fmt(data['feels'])}°")
    if data["humidity"] is not None:
        bits.append(f"湿度 {fmt(data['humidity'])}%")
    if data["wind"]:
        bits.append(data["wind"])
    if data.get("aqi"):
        bits.append(f"空气 {fmt(data['aqi'])}")
    cy += 10
    d.text((px(x + pad), px(cy)), " · ".join(bits), font=font(12), fill=(255, 255, 255, 189))
    cy += 19

    # ---- 接下来 3 小时 ----
    cy += 12
    d.line([(px(x + pad), px(cy)), (px(x + cw - pad), px(cy))], fill=(255, 255, 255, 36), width=1)
    cy += 10
    d.text((px(x + pad), px(cy)), "接下来 3 小时", font=font(11), fill=(255, 255, 255, 153))
    cy += 18

    col_w = (inner - 6 * 2) / 3
    for i, (label, temp, sky) in enumerate(data["hours"][:3]):
        hx = x + pad + i * (col_w + 6)
        d.rounded_rectangle([px(hx), px(cy), px(hx + col_w), px(cy + 67)],
                            radius=px(11), fill=(255, 255, 255, 23), width=1,
                            outline=(255, 255, 255, 8))
        mid = hx + col_w / 2
        t1 = font(11)
        w1 = d.textlength(label, font=t1)
        d.text((px(mid) - w1 / 2, px(cy + 8)), label, font=t1, fill=(255, 255, 255, 184))

        hi = font(19)
        glyph = icon_of(sky, None)
        w2 = d.textlength(glyph, font=ImageFont.truetype(EMOJI, hi.size)) if os.path.exists(EMOJI) else 0
        text_with_emoji(d, (px(mid) - w2 / 2, px(cy + 24)), glyph, hi)

        t3 = font(13, True)
        w3 = d.textlength(f"{fmt(temp)}°", font=t3)
        d.text((px(mid) - w3 / 2, px(cy + 45)), f"{fmt(temp)}°", font=t3, fill=fg)
    cy += 67

    # ---- 未来 3 天 ----
    cy += 12
    d.line([(px(x + pad), px(cy)), (px(x + cw - pad), px(cy))], fill=(255, 255, 255, 36), width=1)
    cy += 10
    d.text((px(x + pad), px(cy)), "未来 3 天", font=font(11), fill=(255, 255, 255, 153))
    cy += 18

    for i, (label, sky, low, high) in enumerate(data["days"][:3]):
        if i:
            d.line([(px(x + pad), px(cy - 1)), (px(x + cw - pad), px(cy - 1))],
                   fill=(255, 255, 255, 23), width=1)
        row_y = cy + (26 - 16) / 2
        d.text((px(x + pad), px(row_y)), label, font=font(12), fill=(255, 255, 255, 209))

        glyph = icon_of(sky, None)
        gi = font(16)
        gw = d.textlength(glyph, font=ImageFont.truetype(EMOJI, gi.size)) if os.path.exists(EMOJI) else 0
        text_with_emoji(d, (px(x + pad + 34 + 11) - gw / 2, px(row_y)), glyph, gi)

        fh = font(14, True)
        fl = font(12)
        hi_txt, lo_txt = f"{fmt(high)}°", f"{fmt(low)}°"
        w_hi = d.textlength(hi_txt, font=fh)
        w_lo = d.textlength(lo_txt, font=fl)

        # 温度那一列有多宽（设备像素），剩下的才归天气描述用
        sky_x = px(x + pad + 34 + 22 + 7)
        temp_left = px(x + cw - pad) - w_hi - w_lo - px(3)
        sky = clip(d, sky, font(12), temp_left - sky_x - px(6))
        d.text((sky_x, px(row_y)), sky, font=font(12), fill=(255, 255, 255, 174))

        d.text((temp_left, px(cy + 3)), hi_txt, font=fh, fill=fg)
        d.text((temp_left + w_hi + px(3), px(cy + 5)), lo_txt, font=fl,
               fill=(255, 255, 255, 153))
        cy += 26

    # ---- 底部：更新时间 + 三个按钮（从右往左摆：MSN、换城市、刷新）----
    cy += 11
    d.line([(px(x + pad), px(cy)), (px(x + cw - pad), px(cy))], fill=(255, 255, 255, 36), width=1)
    cy += 9
    d.text((px(x + pad), px(cy + 3)), f"{data['updated']} 更新", font=font(11),
           fill=(255, 255, 255, 184))

    bx = x + cw - pad
    for label, alpha in [("MSN", 56), ("换城市", 33), ("刷新", 33)]:
        bw = d.textlength(label, font=font(11)) / SCALE + 16
        bx -= bw
        d.rounded_rectangle([px(bx), px(cy - 1), px(bx + bw), px(cy + 21)],
                            radius=px(11), fill=(255, 255, 255, alpha))
        d.text((px(bx + 8), px(cy + 3)), label, font=font(11), fill=fg)
        bx -= 4

    return h


def main():
    data = load()

    base = Image.new("RGB", (W, H))
    background(ImageDraw.Draw(base))
    img = base.convert("RGBA")
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    x0, y0 = EDGE, 34
    card_h = draw_card(d, data, x0, y0)

    grid_x = x0 + LEFT_W + GAP + TILES_PAD
    tiles_h = draw_tiles(d, grid_x, y0)

    panel_x = x0 + LEFT_W + GAP + GRID_W + GAP
    draw_panel(d, panel_x, y0, max(card_h, tiles_h))

    img = Image.alpha_composite(img, layer)
    d2 = ImageDraw.Draw(img)
    d2.text((px(x0), px(y0 + max(card_h, tiles_h) + 16)),
            "NKtab 现在的排布 · 左边天气卡片 │ 中间色块 │ 右边那一栏（占位中）",
            font=font(13, True), fill=(255, 255, 255))
    img.convert("RGB").save(OUT)
    print("画好了：" + OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
