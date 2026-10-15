# -*- coding: utf-8 -*-
"""gen_lunar_table.py —— 生成 lunar.js 里那张「农历年份编码表」。

为什么要有这个东西
------------------
lunar.js 要能算 1900~2100 每一年的农历，但项目规矩是**不用 npm、不用编译**，
装不了 lunar-javascript 之类的库。通行办法是：把每年农历的
「闰哪个月、每个月 29 还是 30 天」压成一个整数，201 个整数连成一串字符串，
换算时现查现解（lunar.js 里的 monthsOfYear/solarToLunar 就是这么干的）。

编码格式（每年一个 5 位十六进制，201 年共 1005 个字符）
--------------------------------------------------------
    v = (闰月 << 16) | 各月天数压缩 | (闰月是不是 30 天 ? 0x2000 : 0)

    · 低 12 位：**正月占最低位**（bit 0），往后一个月上一位，
      1 = 这个月 30 天，0 = 29 天。这样「从小到大累加」正好就是从年初
      往后数天数，闰月插在前一个月后面，这套累加仍然成立。
    · 闰月号放在 bit 16 以上（解码时要 & 0xF0000 再 >> 16）。
    · bit 13 单独留给「闰月本身够不够 30 天」：它跟那 12 位月份位不重叠，
      也够不着 bit 16 的月号。曾经把它塞在 bit 16 上，结果解码时那个 1
      混进月号里，整个闰月都错位了。

  举例：1900 年闰八月（小月），正月 30 天 → 0x84bd0。

核对（这一步是这张表唯一值钱的地方）
------------------------------------
脚本**不用自己算农历**（自己算再拿自己核对，是循环论证）。它把权威实现
lunar_python 从 PyPI 下下来（只借用、不安装进项目），对 1900-01-31 到
2100-12-31 的**每一天**做三件事：

  ① 让权威实现报出这一天的农历年月日（含闰月记号）；
  ② 用它算出来的每一年月序，反推出一份编码；
  ③ 拿这份编码去解码，把每一天的农历重新算一遍，和 ① 逐日比对。

对不上就 raise，不会生成坏表。另外还会核一遍每年「冬至在哪个月」（农历十一月）
和若干写死的节日日期（春节、中秋、端午、腊八）。

用法
----
    python tools/gen_lunar_table.py            # 核对并把表写进 lunar.js
    python tools/gen_lunar_table.py --check    # 只核对，不改文件
"""

import datetime
import re
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
LUNAR_JS = PROJECT / "lunar.js"
DEPS = PROJECT / ".tmp" / "src"          # 借用 lunar_python 的地方（不进 git）

START_YEAR = 1900
END_YEAR = 2100
BASE = datetime.date(1900, 1, 31)         # 1900 年正月初一，整套换算的零点

# 正月在 bit 0，腊月在 bit 11：低位在前 = 时间在前，累加即天数。
MONTH_BITS = [0x001, 0x002, 0x004, 0x008, 0x010, 0x020,
              0x040, 0x080, 0x100, 0x200, 0x400, 0x800]

# 写死的节日日期，用来兜底核对：(公历年, 月, 日, 农历月, 农历日, 名字)
FESTIVALS = [
    (1900, 1, 31, 1, 1, "1900 春节"),
    (2024, 2, 10, 1, 1, "2024 春节"),
    (2025, 1, 29, 1, 1, "2025 春节"),
    (2026, 2, 17, 1, 1, "2026 春节"),
    (2024, 9, 17, 8, 15, "2024 中秋"),
    (2025, 10, 6, 8, 15, "2025 中秋"),
    (2026, 9, 25, 8, 15, "2026 中秋"),
    (2025, 5, 31, 5, 5, "2025 端午"),
    (2026, 6, 19, 5, 5, "2026 端午"),
    (2026, 1, 26, 12, 8, "2026 腊八"),
    (2100, 12, 31, 12, 1, "2100 年末"),
]


# --------------------------------------------------------------------- #
# 借用权威实现
# --------------------------------------------------------------------- #

def load_authority():
    """把 lunar_python 下到 .tmp 里借来用（不装进系统、不进 git）。"""
    import io
    import json
    import os
    import tarfile
    import urllib.request

    for entry in DEPS.glob("lunar_python-*"):
        sys.path.insert(0, str(entry))
        break
    else:                                   # 还没下过 -> 现下
        DEPS.mkdir(parents=True, exist_ok=True)
        meta = json.load(urllib.request.urlopen("https://pypi.org/pypi/lunar_python/json"))
        url = next(u["url"] for u in meta["urls"] if u["packagetype"] == "sdist")
        blob = urllib.request.urlopen(url).read()
        with tarfile.open(fileobj=io.BytesIO(blob)) as tar:
            tar.extractall(DEPS)
        for entry in DEPS.glob("lunar_python-*"):
            sys.path.insert(0, str(entry))
            break

    from lunar_python import Solar       # noqa: E402
    return Solar


# --------------------------------------------------------------------- #
# 编码 / 解码：两边必须互为逆运算，否则后面那次逐日核对会立刻炸掉
# --------------------------------------------------------------------- #

def encode_months(months):
    """months = [(月号, 天数, 是否闰月), ...]（按时间顺序）-> 一个整数。

    普通月按 1..12 记，闰月插在它前一个月后面。找不到的月份位留 0
    （闰年时总有一位月份号会出现两次，那一位用不上）。
    """
    leap_month = 0
    leap_long = False
    bits = 0

    for month, days, leap in months:
        long = days == 30
        if leap:
            leap_month = month
            leap_long = long
        else:
            if long:
                bits |= MONTH_BITS[month - 1]

    # 闰月号放 bit 16 以上；「闰月有没有 30 天」不能也挤在 bit 16 上，
    # 否则解码时那个 1 会混进月号里（踩过一次），所以放到空着的 bit 13。
    return (leap_month << 16) | (0x2000 if leap_long else 0) | bits


def decode_months(value):
    """encode_months 的反着走，返回 [(月号, 天数, 是否闰月), ...]。"""
    leap_month = (value & 0xF0000) >> 16       # bit 16 以上才是月号
    leap_long = (value & 0x2000) != 0          # bit 13 单独记闰月够不够 30 天

    out = []
    for month in range(1, 13):
        out.append((month, 30 if (value & MONTH_BITS[month - 1]) else 29, False))
        if leap_month == month:
            out.append((month, 30 if leap_long else 29, True))
    return out


# --------------------------------------------------------------------- #
# 正事
# --------------------------------------------------------------------- #

def collect(Solar):
    """跑遍每一天，返回 (每年的编码, 每年的月序, 逐日农历表)。"""
    day = BASE
    end = datetime.date(END_YEAR, 12, 31)
    daily = {}          # date -> (农历年, 月, 日, 是否闰月)
    years = {}          # 农历年 -> [(月, 天数, 闰), ...]
    order = []          # 农历年的出现顺序

    while day <= end:
        lunar = Solar.fromYmd(day.year, day.month, day.day).getLunar()
        ly, lm, ld = lunar.getYear(), lunar.getMonth(), lunar.getDay()
        leap = lm < 0
        # lunar_python 用负数月号表示闰月（闰四月 -> -4）
        month = abs(lm)

        daily[day] = (ly, month, ld, leap)

        if ly not in years:
            years[ly] = []
            order.append(ly)
        slot = years[ly]
        if not slot or slot[-1][0] != month or slot[-1][2] != leap:
            slot.append([month, 0, leap])
        slot[-1][1] += 1

        day += datetime.timedelta(days=1)

    table = [encode_months([tuple(x) for x in years[y]]) for y in range(START_YEAR, END_YEAR + 1)]
    return table, years, daily, order


def decode_one(table, index, want):
    """按 lunar.js 的思路解码，返回 want（1 起的第几天）落在哪个农历日。"""
    value = table[index]
    months = decode_months(value)
    rest = want
    for month, days, leap in months:
        if rest < days:
            return month, rest + 1, leap
        rest -= days
    return None


def verify(table, daily):
    """拿解码结果逐日对权威实现；对不上就把第一处不同报出来。"""
    index = 0
    want = 0
    checked = 0

    day = BASE
    end = datetime.date(END_YEAR, 12, 31)
    while day <= end:
        got = decode_one(table, index, want)
        expect_ly, expect_m, expect_d, expect_leap = daily[day]

        if got is None:
            raise AssertionError(f"{day} 落在农历年之外（表切错了）")

        m, d, leap = got
        if (m, d, leap) != (expect_m, expect_d, expect_leap):
            raise AssertionError(
                f"{day} 对不上：解码得到 {m}月{d}日 闰={leap}，"
                f"权威实现是 {expect_m}月{expect_d}日 闰={expect_leap}"
            )

        # 这一天是不是这个农历年的最后一天？是的话明年从头开始
        year_days = sum(days for _, days, _ in decode_months(table[index]))
        want += 1
        if want >= year_days:
            index += 1
            want = 0
        checked += 1
        day += datetime.timedelta(days=1)

    return checked


def verify_festivals(Solar, daily):
    for gy, gm, gd, lm, ld, name in FESTIVALS:
        got = daily[datetime.date(gy, gm, gd)]
        if (got[1], got[2]) != (lm, ld):
            raise AssertionError(f"{name}（{gy}-{gm}-{gd}）对不上：权威实现说 {got}")

    # 冬至必须落在农历十一月（这是农历置闰的根本，错了整张表都错）
    winter_start = datetime.date(1900, 12, 1)
    winter_end = datetime.date(END_YEAR, 12, 31)
    year, checked = 1900, 0
    while year <= END_YEAR:
        for day in range(18, 25):           # 冬至总在 12/18~12/24 之间
            try:
                stamp = datetime.date(year, 12, day)
            except ValueError:
                continue
            if stamp < winter_start or stamp > winter_end:
                continue
            # 用权威实现判断这天是不是冬至：lunar_python 的节气表
            if Solar.fromYmd(year, 12, day).getLunar().getJieQi() == "冬至":
                month = daily[stamp][1]
                if month != 11:
                    raise AssertionError(f"{stamp} 是冬至，却落在农历{month}月（应该是十一月）")
                checked += 1
                break
        year += 1
    return checked


def table_to_js(table):
    """拼成 lunar.js 里那段带引号的字符串，每行 76 个字符。"""
    text = "".join(f"{value:05x}" for value in table)
    lines = [text[i:i + 76] for i in range(0, len(text), 76)]
    body = "\n".join(f'  "{line}" +' if i < len(lines) - 1 else f'  "{line}";'
                     for i, line in enumerate(lines))
    return body, text


def patch_js(body):
    src = LUNAR_JS.read_text(encoding="utf-8")
    pattern = re.compile(
        r'(const LUNAR_TABLE =\n)(?:  "[0-9a-f]*"[ +]*\n)*  "[0-9a-f]*";'
    )
    if not pattern.search(src):
        raise SystemExit("lunar.js 里没找到 LUNAR_TABLE 那段，先手工确认一下格式")
    out = pattern.sub(lambda m: m.group(1) + body, src, count=1)
    LUNAR_JS.write_text(out, encoding="utf-8")


def main():
    check_only = "--check" in sys.argv
    Solar = load_authority()

    print("正在跑 1900-01-31 ~ 2100-12-31 的每一天……")
    table, years, daily, order = collect(Solar)

    leap_years = sum(1 for y in range(START_YEAR, END_YEAR + 1) if table[y - START_YEAR] >> 16)
    print(f"  年份数 {len(table)}，其中有闰月的 {leap_years} 年")

    checked = verify(table, daily)
    print(f"  逐日核对通过：{checked} 天")

    seasons = verify_festivals(Solar, daily)
    print(f"  节日核对通过（含 {seasons} 个冬至落在十一月）")

    body, text = table_to_js(table)
    print(f"  表长度 {len(text)} 字符")

    if check_only:
        print("--check：只核对，没有改动 lunar.js")
        return

    patch_js(body)
    print(f"已写入 {LUNAR_JS}")


if __name__ == "__main__":
    main()
