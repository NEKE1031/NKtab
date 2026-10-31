/**
 * history.js —— 右边那一栏「历史记录」的两件事：
 *
 *   ① 纯函数部分：排序、按天分组、取标题、关键词过滤。
 *      全都不碰浏览器，所以 tools\测试历史记录.mjs 能直接跑，不用假 DOM。
 *   ② 跟 chrome.history 打交道的那一层。
 *      拿不到权限 / 在 Node 里跑，一律**返回失败而不是抛异常** ——
 *      侧栏读不到历史记录不是什么大事，界面显示一行提示就行，不能把整页带崩。
 *
 * 读的是**浏览器自己的浏览历史**，只读不写、不落我们自己的存储。
 * 别跟 newtab.js 里的 searchHistory 搞混：那是「在本页搜索框里打过的词」，
 * 存在 chrome.storage.sync 里，名字很像但完全是两回事。
 */

/** 一次最多读多少条。读得多是为了「在历史里找」能翻到更早的，不是全都摆出来。 */
export const MAX_ITEMS = 200;

/**
 * 面板上一次只摆几条。
 *
 * 这一栏又高又窄，摆多了得一直滚，翻起来还不如直接开 edge://history；
 * 只摆最近几条，扫一眼就够。想看更早的就在过滤框里打两个字 ——
 * 过滤是在读回来的 MAX_ITEMS 条里找，所以第 7 条以后也照样找得到。
 */
export const RECENT_SHOWN = 6;

/** 一天多少毫秒，「昨天」那一步要用。 */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 只保留这几种协议。
 *
 * chrome://  edge://  about:  view-source:  这些内部页面在历史里基本是噪音，
 * 而且新标签页这个东西一开来就是一串，全列出来反而看不见自己看过的网页。
 * file: 留着 —— 本地 HTML 是正常人会看的东西。
 */
const KEEP_SCHEMES = new Set(["http:", "https:", "file:"]);

/** 从网址里取域名。取不出来就给空串，绝不抛。 */
export function hostOfUrl(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** 这个网址值不值得列出来。 */
export function isBrowsable(url) {
  try {
    return KEEP_SCHEMES.has(new URL(String(url)).protocol);
  } catch {
    return false;
  }
}

/**
 * chrome.history 给的原始条目 → 这一栏用的形状。
 *
 * 顺手做两件清洁工作：丢掉内部页面，把可能缺的字段补成空串 / 0
 * （历史记录是别的程序写进来的东西，不能假设字段一定齐）。
 */
export function normalizeItems(items) {
  const out = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const url = String((raw && raw.url) || "");
    if (!url || !isBrowsable(url)) continue;
    out.push({
      url,
      title: String((raw && raw.title) || "").trim(),
      host: hostOfUrl(url),
      lastVisitTime: Number((raw && raw.lastVisitTime) || 0),
      visitCount: Number((raw && raw.visitCount) || 0),
    });
  }
  return out;
}

/**
 * 最近访问的排前面，同一个网址只留最后一次。
 *
 * 同一个网址本来就不该出现两次（chrome.history.search 是按网址聚合的），
 * 但万一以后换了别的数据源，这里挡一下总比列表里出现两条一模一样的强。
 */
export function sortRecent(items) {
  const seen = new Set();
  return [...(Array.isArray(items) ? items : [])]
    .filter((item) => item && item.url)
    .sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0))
    .filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
}

/** 显示什么标题：网站没给标题（很多页面就是空的）就退回域名。 */
export function entryTitle(item) {
  const title = String((item && item.title) || "").trim();
  if (title) return title;
  return String((item && (item.host || item.url)) || "");
}

/** 从网址里挖出主机那一段（原样，不做 punycode 转换）。 */
function bareHost(url) {
  const text = String(url || "");
  const at = text.indexOf("://");
  const tail = at >= 0 ? text.slice(at + 3) : text;
  const cut = tail.search(/[/?#]/);
  return (cut >= 0 ? tail.slice(0, cut) : tail).replace(/^www\./i, "");
}

/**
 * 小方块里写什么：域名首字母。
 *
 * www. 先剥掉，不然一堆网站全显示 W。
 * 中文域名得留神：`new URL("https://中文.cn").hostname` 会变成
 * `xn--fiq228c.cn`（punycode），取首字母就只剩个 X，谁也认不出来 ——
 * 所以原文里本来有非 ASCII 字的话，直接拿原文第一个字。
 */
export function letterOf(url) {
  const original = bareHost(url);
  if (original && isBrowsable(url) && /[^\x00-\x7f]/.test(original[0])) return original[0];

  const host = hostOfUrl(url).replace(/^www\./, "");
  if (!host) return "·";
  const first = host[0];
  return /[a-z0-9]/i.test(first) ? first.toUpperCase() : first;
}

/** 个位补零。 */
function two(n) {
  return String(n).padStart(2, "0");
}

/** 几点几分（24 小时制）。一屏里想知道的是「今天几点看的」。 */
export function clockText(ts) {
  const d = new Date(Number(ts) || 0);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/**
 * 补一天。
 *
 * 用 Date 自己算，不要 `now - DAY_MS`：那样跨夏令时的时候会差一小时，
 * 「昨天」那组就可能整个错位（国内没夏令时，但这个函数没必要依赖这一点）。
 */
function shiftDay(ts, delta) {
  const d = new Date(Number(ts) || 0);
  d.setDate(d.getDate() + delta);
  return d;
}

/** 一天的记号，用**本地**年月日 —— 不能用 UTC，否则晚上 8 点以后就串到明天去了。 */
export function dayKey(ts) {
  const d = new Date(Number(ts) || 0);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** 那一组的标题：今天 / 昨天 / 10月30日 / 2025年3月8日。 */
export function dayLabel(ts, now = Date.now()) {
  const key = dayKey(ts);
  if (key === dayKey(now)) return "今天";
  if (key === dayKey(shiftDay(now, -1))) return "昨天";

  const d = new Date(Number(ts) || 0);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  // 今年就不写年份，省几个字
  return sameYear
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * 按天分组。传进来的 items 必须**已经排好序**（sortRecent 之后就是），
 * 这里只顺着扫一遍，不重排 —— 分组和排序是两件事，别搅在一起。
 */
export function groupByDay(items, now = Date.now()) {
  const groups = [];
  let current = null;

  for (const item of Array.isArray(items) ? items : []) {
    const key = dayKey(item.lastVisitTime);
    if (!current || current.key !== key) {
      current = { key, label: dayLabel(item.lastVisitTime, now), items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }

  return groups;
}

/**
 * 关键词过滤。
 *
 * 空格分开的每个词都要命中（AND），这样「github issue」能同时缩小范围；
 * 标题、域名、完整网址都算命中范围 —— 想找某个站的所有页面就直接打域名。
 */
export function pickItems(items, keyword) {
  const list = Array.isArray(items) ? items : [];
  const words = String(keyword || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...list];

  return list.filter((item) => {
    const hay = `${entryTitle(item)} ${item.host || ""} ${item.url || ""}`.toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}

/* ---------------- 跟浏览器打交道 ---------------- */

/**
 * 把 chrome.history 拿出来。拿不到就返回 null。
 *
 * 三种情况会拿不到：
 *   - 在 Node 里跑测试（根本没有 chrome）
 *   - manifest 里没写 "history" 权限
 *   - 用户手动关掉了这个权限
 * 这三种对界面来说是一回事：读不到，显示提示。
 */
export function historyApi() {
  const api = typeof globalThis.chrome !== "undefined" ? globalThis.chrome : null;
  if (!api || !api.history) return null;
  return typeof api.history.search === "function" ? api.history : null;
}

/**
 * chrome.runtime.lastError 只在回调**执行的那一刻**读得到，读完就没了，
 * 所以每个回调的第一行就得读它，不能等出了回调再读。
 */
function readLastError() {
  const api = typeof globalThis.chrome !== "undefined" ? globalThis.chrome : null;
  const error = api && api.runtime && api.runtime.lastError;
  if (!error) return "";
  return String(error.message || error);
}

/**
 * 读一遍浏览历史。
 *
 * 返回 { ok, reason, items, message }：
 *   ok: true   items 是排好序、清洗过的列表
 *   ok: false  reason 是 "no-api"（没权限 / 没有 chrome）或 "error"（真出错）
 *
 * 用回调式的那套写法（而不是 await chrome.history.search(...)）：
 * MV3 在 Chrome 96+ 才有 Promise 版本，回调式从 MV2 起就一直有，
 * 老一点的 Edge 也不会翻车。
 */
export function loadRecent({ max = MAX_ITEMS } = {}) {
  const api = historyApi();
  if (!api) return Promise.resolve({ ok: false, reason: "no-api", items: [] });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      api.search({ text: "", startTime: 0, maxResults: max }, (list) => {
        const failed = readLastError();
        if (failed) {
          finish({ ok: false, reason: "error", message: failed, items: [] });
          return;
        }
        finish({ ok: true, items: sortRecent(normalizeItems(list)) });
      });
    } catch (error) {
      finish({ ok: false, reason: "error", message: String((error && error.message) || error), items: [] });
    }
  });
}

/** 从历史记录里删掉一条。返回有没有删成功。 */
export function forgetUrl(url) {
  const api = historyApi();
  if (!api || typeof api.deleteUrl !== "function") return Promise.resolve(false);

  return new Promise((resolve) => {
    try {
      api.deleteUrl({ url }, () => resolve(!readLastError()));
    } catch {
      resolve(false);
    }
  });
}

/** 全清。删的是**整个浏览器历史**，不是只删这一栏里显示的，调用方必须先问一句。 */
export function forgetAll() {
  const api = historyApi();
  if (!api || typeof api.deleteAll !== "function") return Promise.resolve(false);

  return new Promise((resolve) => {
    try {
      api.deleteAll(() => resolve(!readLastError()));
    } catch {
      resolve(false);
    }
  });
}
