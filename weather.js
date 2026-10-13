/**
 * weather.js —— 天气数据，来源是 MSN 天气（就是 Edge 新标签页原来显示的那个）。
 *
 * 用到的两个 MSN 接口，分工不一样：
 *
 *   ① 查城市 —— 不需要密钥，返回 XML
 *      https://weather.service.msn.com/find.aspx
 *        src=msn              固定写法
 *        weadegreetype=C      摄氏度
 *        culture=zh-Hans-CN   要中文。★注意：写 zh-CN 会返回空白，必须是 zh-Hans-CN★
 *        weasearchstr=北京     城市名，中文英文都认
 *      能拿到：城市全名 + 经纬度 + 当前天气 + 未来 5 天（没有逐小时）
 *
 *   ② 拿逐小时 —— 需要密钥，返回 JSON
 *      https://api.msn.com/weather/overview
 *        apikey=<密钥>        MSN 自己网页里公开带着的那把，不是我们申请的
 *        ocid=msftweather     ★这里写 msnweather 会 401，必须是 msftweather★
 *        locale=zh-cn & units=C & lat=.. & lon=..
 *      能拿到：当前天气（字段更全）+ 未来 3 小时逐小时 + 未来 10 天（含高低温）
 *
 * 因为 ② 只认经纬度，所以第一次要先走 ① 把城市名换成经纬度，之后存下来复用。
 *
 * 两个接口拿到的数据会被整理成同一个形状（见 normalize 里的说明），
 * 页面那边不用关心数据到底是从哪个接口来的。
 */

/** 数据超过这个时间才去重新拉一次，免得每开一个新标签页都请求一遍。 */
export const REFRESH_AFTER = 20 * 60 * 1000;

/** 从 MSN 网页里公开带着的那把密钥。它不是我们的私钥，是 MSN 发给每个浏览器的。 */
export const MSN_API_KEY = "j5i4gDqHL6nGYwx5wi5kRhXjtf2c5qgFX9fzfk0TOo";

const CITY_ENDPOINT = "https://weather.service.msn.com/find.aspx";
const HOURLY_ENDPOINT = "https://api.msn.com/weather/overview";

/* ------------------------------------------------------------------ *
 * 天气图标
 *
 * 两个接口给的代号不是同一套（同一个「晴」，① 给 32，② 给 1），
 * 所以不靠代号认，改成**看中文描述**。反正这里只用中文。
 * 万一看不懂描述，才拿代号去查下面这张老表兜底。
 * ------------------------------------------------------------------ */

const LEGACY_ICONS = {
  0: "🌪️", 1: "🌀", 2: "🌀", 3: "⛈️", 4: "⛈️",
  5: "🌨️", 6: "🌨️", 7: "🌨️", 8: "🌧️", 9: "🌦️",
  10: "🌧️", 11: "🌧️", 12: "🌦️", 13: "🌨️", 14: "🌨️",
  15: "🌨️", 16: "❄️", 17: "🌨️", 18: "🌨️", 19: "🌫️",
  20: "🌫️", 21: "🌫️", 22: "🌫️", 23: "💨", 24: "💨",
  25: "🥶", 26: "☁️", 27: "☁️", 28: "☁️", 29: "⛅",
  30: "⛅", 31: "🌙", 32: "☀️", 33: "🌙", 34: "🌤️",
  35: "⛅", 36: "🔥", 37: "⛈️", 38: "⛈️", 39: "🌦️",
  40: "🌧️", 41: "🌨️", 42: "❄️", 43: "🌨️", 44: "☀️",
  45: "⛈️", 46: "🌨️", 47: "⛈️",
};

/**
 * 天气文字 -> 表情。
 *
 * @param {string} text  中文描述，例如「大部晴朗」「小雨」「阴」
 * @param {string|number} code  数字代号（认不出文字时才用）
 * @param {boolean} night  是不是夜里（夜里晴天要用月亮，不能用大太阳）
 */
export function iconFor(text, code, night = false) {
  const t = String(text || "");

  if (/雷/.test(t)) return "⛈️";
  if (/雪|冰|冻雨/.test(t)) return /小|阵|零星/.test(t) ? "🌨️" : "❄️";
  if (/雨/.test(t)) return /小|阵|零星/.test(t) ? "🌦️" : "🌧️";
  if (/雾|霾|沙|尘|浮尘/.test(t)) return "🌫️";
  if (/风|飑/.test(t)) return "💨";
  if (/阴/.test(t)) return "☁️";
  if (/多云|少云|局部|短时/.test(t)) return "⛅";
  if (/晴/.test(t)) {
    if (night) return "🌙";
    return /大部|以晴|晴间/.test(t) ? "🌤️" : "☀️";
  }

  return LEGACY_ICONS[Number(code)] || "🌡️";
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

/** 转数字，转不出来就是 null。 */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 取字符串，空的就当 null。 */
function str(value) {
  const s = String(value === null || value === undefined ? "" : value).trim();
  return s || null;
}

/**
 * 从 ISO 时间串里直接抠出「几点」，用的是这条数据**所在城市**的当地时间。
 * 不用 new Date().getHours()，因为那会换算成你这台电脑的时区，
 * 看国外城市的时候会错开好几个小时。
 */
function hourLabel(iso) {
  const m = /T(\d{2}):/.exec(String(iso || ""));
  return m ? `${Number(m[1])}时` : "";
}

/** 按和今天的间隔给个「今天 / 明天 / 后天」的名字。 */
function dayLabel(iso, index) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    return ["今天", "明天", "后天"][index] || "";
  }
  const dayStart = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((dayStart(new Date(t)) - dayStart(new Date())) / 86400000);
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff === 2) return "后天";
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 带超时的 fetch，超时抛的错误已经是能给用户看的中文。 */
async function request(url, { timeout, as = "text" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`MSN 返回了 ${response.status}`);
    return as === "json" ? await response.json() : await response.text();
  } catch (error) {
    if (error.name === "AbortError") throw new Error("等太久了，网络可能不通");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * 接口 ① 的解析（XML）
 * ------------------------------------------------------------------ */

/**
 * 解析 find.aspx 返回的 XML。
 * 解析不出来（空响应、城市没找到、格式变了）就返回 null。
 */
export function parseCityXml(xmlText) {
  if (!xmlText || !xmlText.trim()) return null;

  let doc;
  try {
    doc = new DOMParser().parseFromString(xmlText, "text/xml");
  } catch (error) {
    console.error(error);
    return null;
  }
  if (doc.querySelector("parsererror")) return null;

  // 搜「北京」这种名字，可能连国外的同名城市一起返回，第一个才是我们要的
  const node = doc.querySelector("weather");
  if (!node) return null;

  const current = node.querySelector("current");

  const days = Array.from(node.querySelectorAll("forecast"))
    .slice(0, 3)
    .map((f, i) => ({
      label: ["今天", "明天", "后天"][i] || "",
      text: str(f.getAttribute("skytextday")) || "",
      low: num(f.getAttribute("low")),
      high: num(f.getAttribute("high")),
    }));

  return {
    name: str(node.getAttribute("weatherlocationname")) || "",
    lat: str(node.getAttribute("lat")) || "",
    lon: str(node.getAttribute("long")) || "",
    temp: current ? num(current.getAttribute("temperature")) : null,
    sky: current ? str(current.getAttribute("skytext")) || "" : "",
    feelsLike: current ? num(current.getAttribute("feelslike")) : null,
    humidity: current ? num(current.getAttribute("humidity")) : null,
    wind: current ? str(current.getAttribute("winddisplay")) || "" : "",
    aqi: null,
    updated: current ? str(current.getAttribute("observationtime")) || "" : "",
    days,
  };
}

/* ------------------------------------------------------------------ *
 * 接口 ② 的解析（JSON）
 * ------------------------------------------------------------------ */

/**
 * 解析 api.msn.com 返回的 JSON。
 *
 * JSON 的形状（2026-10 实测）：
 *   value[0].responses[0].weather[0]
 *     .current              { temp, cap, symbol, feels, rh, windSpd, pvdrWindDir, aqi, uv, ... }
 *     .forecast.days[]      10 天，每天：
 *         .hourly[]        ★逐小时★ { valid, temp, cap, symbol, precip, ... }
 *         .daily           { tempHi, tempLo, feelsHi, feelsLo, rh, uv, pvdrCap, day:{cap,icon}, night:{...} }
 *         .almanac         { sunrise, sunset, moonPhase }
 *
 * 「接下来 3 小时」要小心：今天这一天的 hourly 只从下一个整点开始，
 * 而且可能已经被时间赶过去了，所以要按真实时间过滤，不够就去下一天接。
 */
export function parseOverview(json) {
  const weather = json && json.value && json.value[0] &&
    json.value[0].responses && json.value[0].responses[0] &&
    json.value[0].responses[0].weather && json.value[0].responses[0].weather[0];
  if (!weather) return null;

  const current = weather.current || {};
  const days = (weather.forecast && weather.forecast.days) || [];
  const nowMs = Date.now();

  /* ---- 接下来 3 小时：今天剩下的 + 明天，滤掉已经过去的 ---- */
  const hours = [];
  for (const day of days) {
    for (const h of day.hourly || []) {
      const at = Date.parse(h.valid);
      if (!Number.isFinite(at) || at <= nowMs) continue;
      hours.push({
        label: hourLabel(h.valid),
        temp: num(h.temp),
        text: str(h.cap) || "",
        code: h.icon,
        night: String(h.symbol || "").startsWith("n"),
      });
      if (hours.length >= 3) break;
    }
    if (hours.length >= 3) break;
  }

  /* ---- 未来 3 天：高低温在 daily.tempHi / daily.tempLo ---- */
  const forecast = days.slice(0, 3).map((day, i) => {
    const d = day.daily || {};
    const part = d.day || d.night || {};
    return {
      label: dayLabel(d.valid, i),
      text: str(d.pvdrCap) || str(part.cap) || "",
      code: d.icon,
      low: num(d.tempLo),
      high: num(d.tempHi),
    };
  });

  return {
    temp: num(current.temp),
    sky: str(current.cap) || "",
    code: current.icon,
    night: String(current.symbol || "").startsWith("n") || current.daytime === "n",
    feelsLike: num(current.feels),
    humidity: num(current.rh),
    wind: [str(current.pvdrWindDir), str(current.pvdrWindSpd)].filter(Boolean).join(" ") ||
      (num(current.windSpd) === null ? "" : `${num(current.windSpd)} 公里/小时`),
    aqi: num(current.aqi),
    aqiText: str(current.aqiSeverity) || "",
    uv: num(current.uv),
    rainHint: str(weather.nowcasting && weather.nowcasting.taskbarSummary) || "",
    updated: (str(current.created) || "").slice(11, 16),
    hours,
    days: forecast,
  };
}

/* ------------------------------------------------------------------ *
 * 对外的入口
 * ------------------------------------------------------------------ */

/** 走接口 ①：城市名 -> 城市全名 + 经纬度 + 天气（没有逐小时）。 */
async function askCityEndpoint(name, timeout) {
  const url = `${CITY_ENDPOINT}?src=msn&weadegreetype=C&culture=zh-Hans-CN` +
    `&weasearchstr=${encodeURIComponent(name)}`;
  const parsed = parseCityXml(await request(url, { timeout }));
  if (!parsed) return null;
  return {
    ...parsed,
    city: parsed.name,
    hours: [],
    hourly: false,
    source: "city",
  };
}

/** 走接口 ②：经纬度 -> 当前 + 逐小时 + 未来几天。 */
async function askOverviewEndpoint(lat, lon, timeout) {
  const url = `${HOURLY_ENDPOINT}?apikey=${MSN_API_KEY}&ocid=msftweather&locale=zh-cn&units=C` +
    `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
  const parsed = parseOverview(await request(url, { timeout, as: "json" }));
  if (!parsed) return null;
  return { ...parsed, lat: String(lat), lon: String(lon), hourly: true, source: "overview" };
}

/**
 * 去 MSN 拿天气。传城市名或 { name, lat, lon } 都行。
 *
 * 返回形状（两个接口统一成同一个）：
 *   { city, lat, lon, temp, sky, code, night, feelsLike, humidity, wind,
 *     aqi, aqiText, uv, rainHint, updated,
 *     hours: [{ label, temp, text, code, night }],   // 接下来 3 小时
 *     days:  [{ label, text, low, high }],           // 未来 3 天
 *     hourly: 有没有逐小时, source: 数据来自哪个接口 }
 *
 * 拿不到会抛错，错误信息已经是能直接给用户看的中文。
 */
export async function fetchWeather(location, { timeout = 9000 } = {}) {
  const given = typeof location === "string" ? { name: location } : (location || {});
  const name = String(given.name || "").trim();
  if (!name) throw new Error("还没设置城市");

  let lat = String(given.lat || "").trim();
  let lon = String(given.lon || "").trim();
  let fallback = null;

  // 没有经纬度就先问一次接口 ①，顺便把它当成备用数据
  if (!lat || !lon) {
    fallback = await askCityEndpoint(name, timeout);
    if (!fallback) throw new Error("没找到这个城市");
    lat = fallback.lat;
    lon = fallback.lon;
  }

  // 先试逐小时那个接口，成了就用它
  if (lat && lon) {
    try {
      const fresh = await askOverviewEndpoint(lat, lon, timeout);
      if (fresh) {
        fresh.city = fresh.city || name;
        return fresh;
      }
    } catch (error) {
      console.warn("MSN 逐小时接口没成功，退回只有当前和未来几天的版本：", error);
    }
  }

  // 退路：只有当前 + 未来几天，没有逐小时。页面上会把逐小时那一块藏起来。
  if (!fallback) fallback = await askCityEndpoint(name, timeout);
  if (!fallback) throw new Error("拿不到天气数据");
  return { ...fallback, city: fallback.city || name };
}
