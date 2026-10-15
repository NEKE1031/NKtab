/**
 * search.js —— 搜索框那点逻辑：用哪个引擎、怎么拼地址、什么时候直接当网址打开。
 *
 * 单独拎出来是为了能测：newtab.js 一开头就要抓一堆 DOM，Node 里跑不起来，
 * 而这些纯粹是「给一段文字，返回一个地址」的活，跟界面无关。
 *
 * 约定：query 模板里的 {q} 会被 encodeURIComponent 之后的词替掉。
 */

/** 搜索框能用的引擎。mark 是菜单左边小方块里的字（不用 logo 图，省得引外部资源）。 */
export const ENGINES = [
  { id: "bing", name: "必应", mark: "B", query: "https://www.bing.com/search?q={q}" },
  { id: "baidu", name: "百度", mark: "百", query: "https://www.baidu.com/s?wd={q}" },
  { id: "google", name: "Google", mark: "G", query: "https://www.google.com/search?q={q}" },
  { id: "zhihu", name: "知乎", mark: "知", query: "https://www.zhihu.com/search?q={q}" },
  { id: "bilibili", name: "哔哩哔哩", mark: "哔", query: "https://search.bilibili.com/all?keyword={q}" },
];

export const DEFAULT_ENGINE = "bing";

/** 按 id 找一个引擎；找不到返回 null（调用方决定怎么兜底）。 */
export function findEngine(id) {
  return ENGINES.find((item) => item.id === id) || null;
}

/** 把关键词拼成要打开的地址。id 不认识就退回默认引擎。 */
export function engineQuery(id, text) {
  const engine = findEngine(id) || findEngine(DEFAULT_ENGINE);
  return engine.query.replace("{q}", encodeURIComponent(text));
}

/**
 * 看着像个网址吗。
 *
 * 这样输 "github.com" 能直接打开，不用先搜一遍再点。
 * 判断得松一点：带空格的一律当搜索词（"怎么用 github.com" 显然是在搜东西）。
 */
export function looksLikeAddress(text) {
  if (text.includes(" ")) return false;
  if (/^https?:\/\//i.test(text)) return true;
  return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text);
}

/**
 * 搜索框里敲下回车之后，到底该打开哪个地址。
 *
 * 两种可能：像网址就直接去那个网址（缺协议头就补 https://），
 * 否则拿当前选的引擎搜。
 */
export function targetFor(text, engineId) {
  const query = String(text || "").trim();
  if (!query) return "";

  if (looksLikeAddress(query)) {
    return query.includes("://") ? query : "https://" + query;
  }
  return engineQuery(engineId, query);
}
