/**
 * storage.js —— 所有「存取数据」的事情都集中在这里。
 *
 * 规矩：别的文件不许直接碰 chrome.storage，一律通过这里的方法。
 * 好处是以后想换存储方式，只改这一个文件。
 *
 * 存哪儿的分工：
 *   小本子（网页列表，含每个网站的颜色）-> chrome.storage.sync
 *       小、快、跟着微软账号跨设备同步。一个颜色就是一串 "#4c7cf3"，几字节，随便存。
 *   小本子（已经补过的预置网站 id）-> chrome.storage.sync   同上，就十几个短字符串
 *   大柜子（背景图）-> chrome.storage.local   大，图片专用
 *   大柜子（壁纸库里的每一张）-> chrome.storage.local   同上。每张存两份：
 *       一份原图（当背景用）、一份小缩略图（壁纸库里铺网格用，只有几十 KB）
 *   抽屉（搜索记录）-> chrome.storage.local   只属于这台电脑，不同步
 *   便签（城市名）-> chrome.storage.sync     几个字，跟着账号走
 *   草稿（天气数据）-> chrome.storage.local   只是缓存，随时可以扔
 */

const BOOKMARKS_KEY = "nk.bookmarks";
const WALLPAPER_KEY = "nk.wallpaper";
const HISTORY_KEY = "nk.history";

/* ------------------------------------------------------------------ *
 * 颜色
 *
 * 每个网站配一个色块颜色。用户没自己挑的话，就按名字算一个固定的，
 * 同一个名字每次算出来都一样，不会今天蓝明天绿。
 * ------------------------------------------------------------------ */

/** 给用户挑的颜色（也是新网站自动配色的来源）。 */
export const ICON_COLORS = [
  "#4c7cf3", // 蓝
  "#0d74ce", // 深蓝
  "#5b5bd6", // 靛
  "#8e4ec6", // 紫
  "#d6409f", // 玫红
  "#e5484d", // 红
  "#f0921f", // 橙
  "#e8b931", // 金
  "#46a758", // 绿
  "#12a594", // 青
  "#a18072", // 棕
  "#5a6472", // 石板灰
];

/** 按名字算一个固定的颜色。 */
export function colorForName(name) {
  const text = String(name || "?");
  let hash = 0;
  for (const ch of text) {
    hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  }
  return ICON_COLORS[hash % ICON_COLORS.length];
}

/** 第一次打开时预置的网站，用户可以随便删。 */
export const DEFAULT_BOOKMARKS = [
  { id: "d01", title: "百度", url: "https://www.baidu.com", color: "#4c7cf3" },
  { id: "d02", title: "哔哩哔哩", url: "https://www.bilibili.com", color: "#d6409f" },
  { id: "d03", title: "知乎", url: "https://www.zhihu.com", color: "#0d74ce" },
  { id: "d04", title: "微博", url: "https://weibo.com", color: "#e5484d" },
  { id: "d05", title: "抖音", url: "https://www.douyin.com", color: "#12a594" },
  { id: "d06", title: "淘宝", url: "https://www.taobao.com", color: "#f0921f" },
  { id: "d07", title: "京东", url: "https://www.jd.com", color: "#e5484d" },
  { id: "d08", title: "CSDN", url: "https://www.csdn.net", color: "#e5484d" },
  { id: "d09", title: "GitHub", url: "https://github.com", color: "#5a6472" },
  { id: "d10", title: "网易云音乐", url: "https://music.163.com", color: "#e5484d" },
  { id: "d11", title: "豆瓣", url: "https://www.douban.com", color: "#46a758" },
  { id: "d12", title: "微软必应", url: "https://www.bing.com", color: "#12a594" },
  { id: "d13", title: "GPT", url: "https://chatgpt.com", color: "#2d3138" },
  { id: "d14", title: "gemini", url: "https://gemini.google.com", color: "#4285f4" },
  { id: "d15", title: "谷歌地图", url: "https://www.google.com/maps", color: "#34a853" },
  { id: "d16", title: "HLTV", url: "https://www.hltv.org", color: "#1f4e79" },
  { id: "d17", title: "pixiv", url: "https://www.pixiv.net", color: "#0096fa" },
];

/* ------------------------------------------------------------------ *
 * 「新预置自动补上」
 *
 * 问题：网站列表一旦写进浏览器，之后光改上面那张表是没用的——用户手里
 * 那份数据不会自己变。以前想加个预置网站，只能让用户手动点 ＋ 一个个加。
 *
 * 做法：把「已经补过的预置 id」记一份（nk.presets）。每次读列表时看一眼
 * 有没有新 id，有就追加到末尾，然后记下来。于是：
 *   · 同一个预置只会补一次，不会越补越多；
 *   · 用户自己删掉的预置也不会被塞回来（删之前它就已经记在册上了）。
 *
 * EARLIER_PRESETS 是这套机制上线**之前**就发出去的那批 id。
 * 老用户第一次跑新代码时没有 nk.presets，只能靠这份名单认出「哪些是早就有的」，
 * 否则会把 d01~d12 再补一遍。以后再往 DEFAULT_BOOKMARKS 里加东西，
 * 从 d18 往后顺着编就行，**这个名单不用再动**。
 * ------------------------------------------------------------------ */

const PRESETS_KEY = "nk.presets";

const EARLIER_PRESETS = [
  "d01", "d02", "d03", "d04", "d05", "d06",
  "d07", "d08", "d09", "d10", "d11", "d12",
];

/* ------------------------------------------------------------------ *
 * 底层读写
 *
 * 正常在 Edge 里跑时用 chrome.storage。
 * 万一 chrome.storage 不可用（比如以后脱离了扩展环境），自动退回 localStorage，
 * 至少不会白屏。
 * ------------------------------------------------------------------ */

const IN_EXTENSION =
  typeof chrome !== "undefined" && !!chrome.storage && !!chrome.storage.sync;

async function read(area, key, fallback) {
  try {
    if (IN_EXTENSION) {
      const result = await chrome.storage[area].get(key);
      return key in result ? result[key] : fallback;
    }
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (error) {
    console.warn("[NKtab] 读取失败：", key, error);
    return fallback;
  }
}

async function write(area, key, value) {
  if (IN_EXTENSION) {
    await chrome.storage[area].set({ [key]: value });
  } else {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

/** 一次删掉好几个键。 */
async function removeKeys(area, keys) {
  if (!keys.length) return;
  if (IN_EXTENSION) {
    await chrome.storage[area].remove(keys);
  } else {
    for (const key of keys) localStorage.removeItem(key);
  }
}

/* ------------------------------------------------------------------ *
 * 网页列表
 * ------------------------------------------------------------------ */

/** 拿出全部网站。第一次运行会自动放入预置列表。 */
export async function getBookmarks() {
  const list = await read("sync", BOOKMARKS_KEY, null);
  if (Array.isArray(list)) return await mergeNewPresets(list);

  await write("sync", BOOKMARKS_KEY, DEFAULT_BOOKMARKS);
  await write("sync", PRESETS_KEY, DEFAULT_BOOKMARKS.map((item) => item.id));
  return DEFAULT_BOOKMARKS;
}

/**
 * 把 DEFAULT_BOOKMARKS 里「以前没出现过」的补到末尾。
 *
 * 分成两份看：fresh = 从来没补过的预置；add = fresh 里用户手上还没有的。
 * fresh 有东西就更新名册（只写一次）；add 有东西才真的动网站列表。
 * 一切正常时后面每次调用都只是多读一个 key，不会再写。
 */
async function mergeNewPresets(list) {
  const stored = await read("sync", PRESETS_KEY, null);
  const seen = new Set(Array.isArray(stored) ? stored : EARLIER_PRESETS);

  const fresh = DEFAULT_BOOKMARKS.filter((item) => !seen.has(item.id));

  if (!Array.isArray(stored) || fresh.length) {
    for (const item of fresh) seen.add(item.id);
    await write("sync", PRESETS_KEY, [...seen]);
  }

  if (!fresh.length) return list;

  // 用户手上已经有同 id 的、或者已经自己手动加过同一个网址的，都不补。
  // 网址要「归一化」再比：末尾多个斜杠、大小写不同都算同一个。
  const haveIds = new Set();
  const haveUrls = new Set();
  for (const item of list) {
    if (!item) continue;
    haveIds.add(item.id);
    const key = sameUrlKey(item.url);
    if (key) haveUrls.add(key);
  }

  const add = fresh.filter((item) => {
    if (haveIds.has(item.id)) return false;
    const key = sameUrlKey(item.url);
    return !(key && haveUrls.has(key));
  });
  if (!add.length) return list;

  const merged = [...list, ...add];
  await saveBookmarks(merged);
  return merged;
}

/** 比对「是不是同一个网址」用的归一化：去掉末尾斜杠、主机名统一小写。 */
function sameUrlKey(url) {
  const full = normalizeUrl(url);
  if (!full) return "";
  try {
    const parsed = new URL(full);
    return (parsed.origin + parsed.pathname).replace(/\/+$/, "");
  } catch {
    return full.replace(/\/+$/, "").toLowerCase();
  }
}

async function saveBookmarks(list) {
  await write("sync", BOOKMARKS_KEY, list);
}

/** 加一个网站，加在最后。名字为空时用网址当名字。 */
export async function addBookmark(title, url, color) {
  const list = await getBookmarks();
  const name = (title || "").trim() || hostOf(url) || "新网站";
  const item = {
    id: newId(),
    title: name,
    url: normalizeUrl(url),
    color: color || colorForName(name),
  };
  list.push(item);
  await saveBookmarks(list);
  return item;
}

/** 改一个网站的名字 / 网址。 */
export async function updateBookmark(id, patch) {
  const list = await getBookmarks();
  const next = list.map((item) => (item.id === id ? { ...item, ...patch } : item));
  await saveBookmarks(next);
  return next.find((item) => item.id === id) || null;
}

/** 按传进来的顺序，整体重排（拖拽排序用）。 */
export async function reorderBookmarks(orderedList) {
  await saveBookmarks(orderedList);
}

/** 按 id 删掉一个网站。 */
export async function removeBookmark(id) {
  const list = await getBookmarks();
  await saveBookmarks(list.filter((item) => item.id !== id));
}

/* ------------------------------------------------------------------ *
 * 背景图
 *
 * 「现在用哪张」和「库里有哪些」是两件事：
 *   nk.wallpaper              现在这张。值只有三种可能：
 *                               ""                  没设背景，显示自带的渐变底色
 *                               "builtin:xxx"       扩展自带的那张
 *                               "data:image/..."    用户自己加的图
 *   nk.wallpaper.lib          库里所有壁纸的清单：[{ id, name, addedAt }]
 *   nk.wallpaper.img.<id>     每张的原图（当背景时才读）
 *   nk.wallpaper.thumb.<id>   每张的小缩略图（铺壁纸库的网格只看这个，快）
 *
 * 为什么原图和缩略图分开存：库里有十几张的时候，如果每次都把原图全读出来
 * 铺网格，光读就要好几 MB，打开弹窗会明显卡一下。缩略图就只有几十 KB。
 * ------------------------------------------------------------------ */

const WALLPAPER_LIB_KEY = "nk.wallpaper.lib";
const WALLPAPER_IMG_PREFIX = "nk.wallpaper.img.";
const WALLPAPER_THUMB_PREFIX = "nk.wallpaper.thumb.";
const WALLPAPER_SEEDED_KEY = "nk.wallpaper.seeded";
const WALLPAPER_HIDDEN_KEY = "nk.wallpaper.hidden";

/** 扩展自带、不用选就有的壁纸。path 是扩展文件夹里的相对路径。
 *
 *  这些图直接躺在扩展文件夹的 wallpapers/ 里，**完全不占 chrome.storage**，
 *  所以打开壁纸库就有三十几种可以挑。想换成别的图，覆盖同名文件即可。
 *
 *  desktop / pic* / bing* 由 tools/生成内置壁纸.py 生成。
 *  we* 由 tools/抽取WE视频壁纸.py 生成 —— 它们是从 Wallpaper Engine 的
 *  「视频壁纸」里抽的一帧（真·全分辨率）。WE 的 scene 壁纸抽不了，
 *  内容全在私有的 scene.pkg 里；想用那种，就在 WE 里换成它、
 *  再双击 tools/更新桌面壁纸.bat 把渲染出来的 4K 静帧抓下来。 */
export const BUILTIN_WALLPAPERS = [
  { id: "builtin:desktop", name: "桌面壁纸", path: "wallpapers/desktop.jpg" },
  { id: "builtin:pic1", name: "异环 · 樱花", path: "wallpapers/pic1.jpg" },
  { id: "builtin:pic2", name: "异环 · 黄昏", path: "wallpapers/pic2.jpg" },
  { id: "builtin:pic3", name: "异环 · 双子", path: "wallpapers/pic3.jpg" },
  { id: "builtin:pic4", name: "异环 · 晴空", path: "wallpapers/pic4.jpg" },
  { id: "builtin:pic5", name: "初音 · 钢琴", path: "wallpapers/pic5.jpg" },
  { id: "builtin:bing1", name: "风景 1", path: "wallpapers/bing1.jpg" },
  { id: "builtin:bing2", name: "风景 2", path: "wallpapers/bing2.jpg" },
  { id: "builtin:bing3", name: "风景 3", path: "wallpapers/bing3.jpg" },
  { id: "builtin:bing4", name: "风景 4", path: "wallpapers/bing4.jpg" },
  { id: "builtin:bing5", name: "风景 5", path: "wallpapers/bing5.jpg" },
  { id: "builtin:bing6", name: "风景 6", path: "wallpapers/bing6.jpg" },
  // ↓↓↓ 以下 24 张是从 Wallpaper Engine 的视频壁纸里抽出来的静帧 ↓↓↓
  { id: "builtin:we01", name: "Initialclip", path: "wallpapers/we01.jpg" },
  { id: "builtin:we02", name: "银狼", path: "wallpapers/we02.jpg" },
  { id: "builtin:we03", name: "世界很温柔 —《龙族》上", path: "wallpapers/we03.jpg" },
  { id: "builtin:we04", name: "kabaneri of", path: "wallpapers/we04.jpg" },
  { id: "builtin:we05", name: "Darling In", path: "wallpapers/we05.jpg" },
  { id: "builtin:we06", name: "战双帕弥什 露西亚鸦羽", path: "wallpapers/we06.jpg" },
  { id: "builtin:we07", name: "Ave mujica", path: "wallpapers/we07.jpg" },
  { id: "builtin:we08", name: "Cozy Winter", path: "wallpapers/we08.jpg" },
  { id: "builtin:we09", name: "[4K]二见原莉莉子", path: "wallpapers/we09.jpg" },
  { id: "builtin:we10", name: "露西亚誓焰", path: "wallpapers/we10.jpg" },
  { id: "builtin:we11", name: "【国家队4K】02×16", path: "wallpapers/we11.jpg" },
  { id: "builtin:we12", name: "【战双帕弥什】糖霜露西亚", path: "wallpapers/we12.jpg" },
  { id: "builtin:we13", name: "Steam Winter", path: "wallpapers/we13.jpg" },
  { id: "builtin:we14", name: "弗洛洛", path: "wallpapers/we14.jpg" },
  { id: "builtin:we15", name: "Star Ride by", path: "wallpapers/we15.jpg" },
  { id: "builtin:we16", name: "阿尔托莉雅-潘德拉贡", path: "wallpapers/we16.jpg" },
  { id: "builtin:we17", name: "WE 壁纸 17", path: "wallpapers/we17.jpg" },
  { id: "builtin:we18", name: "Sledding", path: "wallpapers/we18.jpg" },
  { id: "builtin:we19", name: "初音", path: "wallpapers/we19.jpg" },
  { id: "builtin:we20", name: "zero-two", path: "wallpapers/we20.jpg" },
  { id: "builtin:we21", name: "战双露西亚官方动态壁纸", path: "wallpapers/we21.jpg" },
  { id: "builtin:we22", name: "战双帕弥什", path: "wallpapers/we22.jpg" },
  { id: "builtin:we23", name: "战双帕弥什 2", path: "wallpapers/we23.jpg" },
  { id: "builtin:we24", name: "很多弗洛洛", path: "wallpapers/we24.jpg" },
];

/** 被用户从壁纸库里「拿掉」的自带壁纸。只记 id，图片文件本身不动。 */
export async function getHiddenBuiltins() {
  const list = await read("local", WALLPAPER_HIDDEN_KEY, []);
  return Array.isArray(list) ? list.filter((item) => typeof item === "string") : [];
}

/** 把一张自带壁纸从库里拿掉（不删文件，只记一笔，随时能还回来）。 */
export async function hideBuiltinWallpaper(id) {
  const list = await getHiddenBuiltins();
  if (!list.includes(id)) list.push(id);
  await write("local", WALLPAPER_HIDDEN_KEY, list);
}

/** 把拿掉过的自带壁纸全还回来。 */
export async function unhideAllBuiltins() {
  await removeKeys("local", [WALLPAPER_HIDDEN_KEY]);
}

/** 这个值是不是「扩展自带的」那种。 */
export function isBuiltinWallpaper(value) {
  return typeof value === "string" && value.startsWith("builtin:");
}

/** 内置壁纸在扩展文件夹里的路径。找不到就返回空串。 */
export function builtinWallpaperPath(value) {
  const found = BUILTIN_WALLPAPERS.find((item) => item.id === value);
  return found ? found.path : "";
}

/**
 * 第一次运行时默认就用那张桌面壁纸。
 * 单独记一个「补过了」的记号，这样用户以后自己清掉背景，不会又被塞回来。
 */
async function seedWallpaper() {
  if (await read("local", WALLPAPER_SEEDED_KEY, false)) return;
  await write("local", WALLPAPER_SEEDED_KEY, true);

  const current = await read("local", WALLPAPER_KEY, "");
  if (!current) await write("local", WALLPAPER_KEY, BUILTIN_WALLPAPERS[0].id);
}

/** 现在用的背景。空串 = 没设背景。 */
export async function getWallpaper() {
  await seedWallpaper();
  return (await read("local", WALLPAPER_KEY, "")) || "";
}

export async function setWallpaper(value) {
  await write("local", WALLPAPER_KEY, value || "");
}

export async function clearWallpaper() {
  await removeKeys("local", [WALLPAPER_KEY]);
}

/* ---- 壁纸库 ---- */

/** 用户自己加进库里的清单（只有名字之类的信息，不含图片本身）。 */
export async function getWallpaperLibrary() {
  const list = await read("local", WALLPAPER_LIB_KEY, null);
  return Array.isArray(list) ? list : [];
}

/** 某一张的小缩略图，用来铺壁纸库的网格。 */
export async function getWallpaperThumb(id) {
  return (await read("local", WALLPAPER_THUMB_PREFIX + id, "")) || "";
}

/** 某一张的原图，点「用它当背景」的时候才读。 */
export async function getWallpaperImage(id) {
  return (await read("local", WALLPAPER_IMG_PREFIX + id, "")) || "";
}

/** 把一张图片文件收进壁纸库，返回它的 id。 */
export async function addWallpaperFromFile(file) {
  const big = await prepareWallpaper(file);
  const thumb = await prepareWallpaperThumb(file);

  const id = newId();
  await write("local", WALLPAPER_IMG_PREFIX + id, big);
  await write("local", WALLPAPER_THUMB_PREFIX + id, thumb);

  const list = await getWallpaperLibrary();
  list.push({ id, name: file.name || "图片", addedAt: Date.now() });
  await write("local", WALLPAPER_LIB_KEY, list);

  return id;
}

/** 从库里删掉一张（清单、原图、缩略图三处一起清干净）。 */
export async function removeWallpaperFromLibrary(id) {
  const list = await getWallpaperLibrary();
  await write("local", WALLPAPER_LIB_KEY, list.filter((item) => item.id !== id));
  await removeKeys("local", [WALLPAPER_IMG_PREFIX + id, WALLPAPER_THUMB_PREFIX + id]);
}

/* ------------------------------------------------------------------ *
 * 搜索记录
 *
 * 只放 local，理由：
 *   ① 这是「这台电脑上搜过什么」，没必要跨设备同步；
 *   ② 完全不占 sync 那个 100KB 的小抽屉。
 * 最新的排最前面，最多留 10 条，重复的会自动挪到最前面而不是多一条。
 * ------------------------------------------------------------------ */

const HISTORY_MAX = 10;

/** 最近搜过的词，数组，最新的在最前面。 */
export async function getSearchHistory() {
  const list = await read("local", HISTORY_KEY, []);
  if (!Array.isArray(list)) return [];
  return list.filter((item) => typeof item === "string" && item);
}

/** 记一条。返回记完之后的新列表。 */
export async function addSearchHistory(query) {
  const text = String(query || "").trim();
  if (!text) return await getSearchHistory();

  const list = await getSearchHistory();
  const next = [text, ...list.filter((item) => item !== text)].slice(0, HISTORY_MAX);
  await write("local", HISTORY_KEY, next);
  return next;
}

/** 删掉其中一条。 */
export async function removeSearchHistory(query) {
  const list = await getSearchHistory();
  const next = list.filter((item) => item !== query);
  await write("local", HISTORY_KEY, next);
  return next;
}

/** 全清。 */
export async function clearSearchHistory() {
  await write("local", HISTORY_KEY, []);
  return [];
}

/* ------------------------------------------------------------------ *
 * 天气
 *
 * 城市名 -> sync：就几个字，跟着账号走，换台电脑不用重设。
 * 天气数据 -> local：它只是「缓存」，本来就是临时的，没必要同步，
 *              也免得那 100KB 的小抽屉被占掉。
 * ------------------------------------------------------------------ */

const CITY_KEY = "nk.city";
const WEATHER_KEY = "nk.weather";

/** 用户设的城市。形状是 { name, lat, lon }；没设过就是 null。
 *
 *  为什么要连经纬度一起存：MSN 那个能返回「逐小时」的接口只认经纬度，
 *  不认城市名。所以第一次拿城市名换一次经纬度，之后就一直用存下来的，
 *  不用每次都多问一趟。早先的版本只存了名字，这里顺手兼容一下。
 */
export async function getCity() {
  const value = await read("sync", CITY_KEY, "");
  if (!value) return null;

  // 老版本存的是一个纯字符串
  if (typeof value === "string") {
    const name = value.trim();
    return name ? { name, lat: "", lon: "" } : null;
  }

  if (typeof value === "object" && value.name) {
    return {
      name: String(value.name).trim(),
      lat: String(value.lat || ""),
      lon: String(value.lon || ""),
    };
  }

  return null;
}

/** 存城市。传名字或 { name, lat, lon } 都行；传空的就清掉。 */
export async function setCity(input) {
  const value = typeof input === "string" ? { name: input } : (input || {});
  const name = String(value.name || "").trim();

  if (!name) {
    await write("sync", CITY_KEY, "");
    return null;
  }

  const saved = {
    name,
    lat: String(value.lat || ""),
    lon: String(value.lon || ""),
  };
  await write("sync", CITY_KEY, saved);
  return saved;
}

/** 上次存下来的天气，没存过就是 null。形状：{ savedAt, data } */
export async function getWeatherCache() {
  const value = await read("local", WEATHER_KEY, null);
  if (!value || typeof value !== "object") return null;
  return value;
}

/** 存一份天气，顺便记下存的时间。 */
export async function setWeatherCache(data) {
  await write("local", WEATHER_KEY, { savedAt: Date.now(), data });
}

/** 清掉天气缓存。 */
export async function clearWeatherCache() {
  if (IN_EXTENSION) {
    await chrome.storage.local.remove(WEATHER_KEY);
  } else {
    localStorage.removeItem(WEATHER_KEY);
  }
}

/* ------------------------------------------------------------------ *
 * 右侧那一栏看的是哪张卡片
 *
 * 就一个 id，几个字节，放 sync：换台电脑打开还是上次看的那张。
 * 卡片本身的数据各归各的，将来加待办 / 便签时再单独开键，别塞这里。
 * ------------------------------------------------------------------ */

const PANEL_CARD_KEY = "nk.panel.card";

/** 上次看的是哪张卡片；没存过或存的已经不认识，就返回空串由调用方兜底。 */
export async function getPanelCard() {
  const value = await read("sync", PANEL_CARD_KEY, "");
  return typeof value === "string" ? value : "";
}

/** 记住当前看的是哪张卡片。 */
export async function setPanelCard(id) {
  await write("sync", PANEL_CARD_KEY, String(id || ""));
}

/* ------------------------------------------------------------------ *
 * 卡片自己的数据：待办 / 便签 / 倒计时 / 每日一句
 *
 * 四个键都放 sync。原因：都是纯文本，几十 KB 撑死也到不了 100KB 上限，
 * 而 sync 能跟着浏览器账号走 —— 换台电脑打开，待办和便签还在，这才像话。
 * （壁纸那种大东西才必须放 local。）
 *
 * 每个 set 都会把形状收一遍再存：存储里可能是旧版本留下的、或者被手动
 * 改坏的数据，收干净了后面用起来就不用到处判断。
 * ------------------------------------------------------------------ */

const TODOS_KEY = "nk.card.todos";
const MEMOS_KEY = "nk.card.memos";
const COUNTDOWNS_KEY = "nk.card.countdowns";
const QUOTE_KEY = "nk.card.quote";

/**
 * 待办列表。每条形如 { id, text, done }。
 *
 * @returns {Promise<Array<{id:string,text:string,done:boolean}>>}
 */
export async function getTodos() {
  const raw = await read("sync", TODOS_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object" && typeof item.text === "string")
    .map((item, i) => ({
      id: typeof item.id === "string" && item.id ? item.id : `t${i}`,
      text: item.text,
      done: !!item.done,
    }));
}

/** 存待办列表。 */
export async function setTodos(items) {
  const clean = (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item.text === "string" && item.text.trim())
    .map((item) => ({ id: String(item.id || ""), text: String(item.text), done: !!item.done }));
  await write("sync", TODOS_KEY, clean);
}

/** 便签正文，就是一整块文字。 */
export async function getMemos() {
  const raw = await read("sync", MEMOS_KEY, "");
  return typeof raw === "string" ? raw : "";
}

/** 存便签正文。 */
export async function setMemos(text) {
  await write("sync", MEMOS_KEY, String(text ?? ""));
}

/**
 * 倒计时列表。每条形如 { id, name, date }，date 是 "2026-02-17"。
 *
 * @returns {Promise<Array<{id:string,name:string,date:string}>>}
 */
export async function getCountdowns() {
  const raw = await read("sync", COUNTDOWNS_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object" && typeof item.name === "string")
    .map((item, i) => ({
      id: typeof item.id === "string" && item.id ? item.id : `c${i}`,
      name: item.name,
      date: typeof item.date === "string" ? item.date : "",
    }));
}

/** 存倒计时列表。 */
export async function setCountdowns(items) {
  const clean = (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item.name === "string" && item.name.trim())
    .map((item) => ({ id: String(item.id || ""), name: String(item.name), date: String(item.date || "") }));
  await write("sync", COUNTDOWNS_KEY, clean);
}

/**
 * 「换一句」攒下来的偏移量。
 *
 * 每天默认看哪句是靠日期算的（不用存），这里只记用户手点了几次「换一句」，
 * 所以它是个只会往上加的小整数。
 */
export async function getQuoteIndex() {
  const raw = await read("sync", QUOTE_KEY, 0);
  return Number.isFinite(raw) ? Number(raw) : 0;
}

/** 存「换一句」的偏移量。 */
export async function setQuoteIndex(value) {
  const n = Number(value);
  await write("sync", QUOTE_KEY, Number.isFinite(n) ? n : 0);
}

/* ------------------------------------------------------------------ *
 * 图片处理
 * ------------------------------------------------------------------ */

/** 把 File 读成 data URL 文本。 */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("这张图打不开，换一张试试"));
    img.src = src;
  });
}

async function drawToDataUrl(dataUrl, maxSide, mime, quality) {
  const img = await loadImage(dataUrl);
  if (!img.naturalWidth || !img.naturalHeight) {
    throw new Error("这张图没有尺寸信息");
  }

  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));

  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);

  return quality === undefined
    ? canvas.toDataURL(mime)
    : canvas.toDataURL(mime, quality);
}

/**
 * 处理用户选的背景图。
 *
 * 手机拍的照片动辄 5~15MB，直接塞进去每次开新标签页都要读一大坨，会卡。
 * 所以：本来就够小的图原样保留；大的图等比缩到最长边 2560 像素再存。
 * 肉眼看不出区别，但文件小很多。
 */
export async function prepareWallpaper(file) {
  const SMALL_ENOUGH = 1.5 * 1024 * 1024; // 1.5MB
  const MAX_SIDE = 2560;

  const raw = await fileToDataUrl(file);

  if (file.size <= SMALL_ENOUGH) {
    try {
      const img = await loadImage(raw);
      if (Math.max(img.naturalWidth, img.naturalHeight) <= MAX_SIDE) return raw;
    } catch {
      /* 读不了就走下面的压缩 */
    }
  }

  return await drawToDataUrl(raw, MAX_SIDE, "image/jpeg", 0.88);
}

/**
 * 生成壁纸库里铺网格用的小缩略图。
 *
 * 一格缩略图在屏幕上也就 120 像素宽，480 已经绰绰有余。
 * 存成 JPEG 一张才几十 KB，库里放十几张也读得飞快。
 */
export async function prepareWallpaperThumb(file) {
  const raw = await fileToDataUrl(file);
  return await drawToDataUrl(raw, 480, "image/jpeg", 0.82);
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 用户可能只输入 "baidu.com"，补上 https:// */
export function normalizeUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  return "https://" + raw;
}

/** 从网址里取出域名，用来抓网站图标。 */
export function hostOf(url) {
  try {
    return new URL(normalizeUrl(url)).hostname;
  } catch {
    return "";
  }
}
