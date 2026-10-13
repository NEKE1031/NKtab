"""
核对 weather.js 的解析代码：它读的每一个属性名，在 MSN 真实返回里是否真的存在。

为什么要单独做这件事：
  MSN 返回的是 XML，属性名有不少容易写错的坑
  （比如经度叫 long 不叫 lon、预报的代号叫 skycodeday 不叫 skycode、
   星期几叫 shortday 不叫 day）。写错了不会报错，只会显示成空白，
  所以必须拿真实数据核对一遍。

跑法：
  python tools/核对天气字段.py

数据来源：直接请求 MSN 接口。有网就现拿，没网就用下面这段固定样本。
"""

import re
import sys
import urllib.request
from xml.etree import ElementTree

# 一段真实抓下来的返回（上海），没网的时候用这个兜底
SAMPLE = """<?xml version="1.0"?><weatherdata>
<weather weatherlocationcode="wc:CHXX0093" weatherlocationname="上海市" lat="31.082" long="121.419" alert="">
<current temperature="27" skycode="34" skytext="大部晴朗" date="2026-10-13" observationtime="12:55:00" observationpoint="上海市" feelslike="30" humidity="56" winddisplay="19 公里/小时 西北" day="星期二" shortday="周二" windspeed="19 公里/小时" />
<forecast low="19" high="28" skycodeday="34" skytextday="大部晴朗" date="2026-10-13" day="星期二" shortday="周二" precip="4" />
<forecast low="16" high="25" skycodeday="30" skytextday="局部晴朗" date="2026-10-14" day="星期三" shortday="周三" precip="0" />
<toolbar timewindow="60" minversion="1.0.1965.0" /></weather></weatherdata>"""

URL = ("https://weather.service.msn.com/find.aspx?src=msn&weadegreetype=C"
       "&culture=zh-Hans-CN&weasearchstr=" + urllib.parse.quote("上海"))

# weather.js 里实际读取的字段 -> 应该在哪个标签上、叫什么属性
WEATHER_ATTRS = ["weatherlocationname", "lat", "long", "alert"]
CURRENT_ATTRS = ["date", "observationtime", "temperature", "feelslike",
                 "humidity", "winddisplay", "skytext", "skycode"]
FORECAST_ATTRS = ["low", "high", "skytextday", "skycodeday", "date", "shortday", "precip"]


def fetch():
    try:
        req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=12) as resp:
            text = resp.read().decode("utf-8", "replace")
        if text.strip():
            print("数据来源：刚刚从 MSN 现拿的")
            return text
        print("MSN 返回了空内容，改用固定样本")
    except Exception as exc:  # noqa: BLE001
        print(f"联网没成功（{exc}），改用固定样本")
    return SAMPLE


def main():
    xml = fetch()

    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError as exc:
        print(f"✗ XML 本身就不合法：{exc}")
        return 1

    node = root.find("weather")
    if node is None:
        print("✗ 找不到 <weather> 标签，解析代码会返回 null")
        return 1

    bad = []

    def check(scope, element, names):
        for name in names:
            value = element.get(name)
            if value is None:
                bad.append(f"{scope} 缺少属性 {name}")
            else:
                shown = value if len(value) <= 30 else value[:30] + "…"
                print(f"  {scope:9s} {name:20s} = {shown}")

    print("\n【weather 标签】")
    check("weather", node, WEATHER_ATTRS)

    current = node.find("current")
    if current is None:
        print("✗ 找不到 <current>，当前温度和天气文字会全是空")
        return 1
    print("\n【current 标签】（当前实况）")
    check("current", current, CURRENT_ATTRS)

    forecasts = node.findall("forecast")
    print(f"\n【forecast 标签】共 {len(forecasts)} 条")
    if not forecasts:
        print("✗ 没有任何 <forecast>，未来几天会是空的")
        return 1
    check("forecast", forecasts[0], FORECAST_ATTRS)

    # weather.js 的 iconFor() 靠 skycode / skycodeday 取表情
    codes = [current.get("skycode")] + [f.get("skycodeday") for f in forecasts]
    bad_codes = [c for c in codes if c is None or not re.fullmatch(r"\d+", c)]
    if bad_codes:
        bad.append(f"天气代号不是纯数字：{bad_codes}")
    else:
        print(f"\n  天气代号（拿去查表情表）：{', '.join(codes)}")

    if node.get("weatherlocationname", "").startswith("中华人民共和国"):
        print("  提示：城市名带了'中华人民共和国'前缀，weather.js 的 shortCity() 会掐掉它")

    print()
    if bad:
        print("有问题：")
        for item in bad:
            print("  ✗ " + item)
        return 1

    print("全部字段都在，weather.js 读的属性和 MSN 返回的对得上。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
