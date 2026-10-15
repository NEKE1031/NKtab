/**
 * 测试搜索.mjs —— 把搜索框「用哪个引擎」这套逻辑真跑一遍。
 *
 * 两件事：
 *   1. search.js 里那套「给一段文字，返回要打开的地址」和引擎表 —— 这一半纯函数，
 *      直接 import 来查，不需要任何假环境。
 *   2. newtab.js 里的选择菜单（建项 / 改选中态 / 点一下换引擎 / 记下来）——
 *      这一半要给 newtab.js 搭一套假 DOM 和假 localStorage 才能跑
 *      （假环境在 tools\假DOM.mjs 里）。
 *
 * 跑法：
 *   node tools\测试搜索.mjs
 */

import { ENGINES, DEFAULT_ENGINE, findEngine, engineQuery, looksLikeAddress, targetFor } from "../search.js";
import { mountFakePage, makeElement, reloadNewtab, sleep } from "./假DOM.mjs";

/* ---------------- 纯函数那一半 ---------------- */

const fail = [];
const expect = (label, got, want) => {
  if (got === want) console.log(`  ✓ ${label}`);
  else fail.push(`${label}：期望 ${want}，实际 ${got}`);
};
const expectTrue = (label, ok) => {
  if (ok) console.log(`  ✓ ${label}`);
  else fail.push(`${label}：判断为假`);
};

console.log("搜索引擎（纯逻辑）：");

expect("默认引擎还在表里", findEngine(DEFAULT_ENGINE) ? DEFAULT_ENGINE : "没有", DEFAULT_ENGINE);
expectTrue("至少 4 个引擎", ENGINES.length >= 4);
expectTrue(
  "每个引擎都有 id / 名字 / 模板，且模板里带 {q}",
  ENGINES.every((e) => e.id && e.name && e.query.includes("{q}"))
);
expectTrue("引擎 id 不重复", new Set(ENGINES.map((e) => e.id)).size === ENGINES.length);
expectTrue("模板都是 http(s) 地址", ENGINES.every((e) => /^https?:\/\//.test(e.query)));

expect("必应拼出来的地址", engineQuery("bing", "abc"), "https://www.bing.com/search?q=abc");
expect("百度用 wd 参数", engineQuery("baidu", "abc"), "https://www.baidu.com/s?wd=abc");
expect("Google", engineQuery("google", "abc"), "https://www.google.com/search?q=abc");
expect("bilibili 用 keyword", engineQuery("bilibili", "abc"), "https://search.bilibili.com/all?keyword=abc");
expect("空格会转义", engineQuery("bing", "a b"), "https://www.bing.com/search?q=a%20b");
expect(
  "中文和特殊符号会转义",
  engineQuery("baidu", "中文&x=1"),
  "https://www.baidu.com/s?wd=%E4%B8%AD%E6%96%87%26x%3D1"
);
expect("不认识的引擎退回默认的必应", engineQuery("没有这个", "abc"), engineQuery("bing", "abc"));

expectTrue("带空格的不算网址", looksLikeAddress("a b") === false);
expectTrue("baidu.com 算网址", looksLikeAddress("baidu.com") === true);
expectTrue("带路径的算网址", looksLikeAddress("github.com/a/b") === true);
expectTrue("http:// 开头算网址", looksLikeAddress("http://x.cn") === true);
expectTrue("单个词不算网址", looksLikeAddress("hello") === false);

expect("搜东西 -> 走当前引擎", targetFor("天气", "google"), "https://www.google.com/search?q=%E5%A4%A9%E6%B0%94");
expect("网址 -> 直接打开并补 https", targetFor("github.com", "bing"), "https://github.com");
expect("带协议的网址 -> 原样打开", targetFor("http://x.cn", "bing"), "http://x.cn");
expect("空串 -> 什么都不打开", targetFor("   ", "bing"), "");
expect(
  "看着像网址但带空格 -> 还是搜索",
  targetFor("怎么用 github.com", "bing").startsWith("https://www.bing.com/search"),
  true
);

/* ---------------- 假环境 ---------------- */

const page = mountFakePage();
const { documentStub, stubs, store } = page;

// 选引擎那三个节点得先造出来、按钮里还得真的装着那个 label，
// 因为代码是靠 engineBtn.contains(目标) 判断「点的是不是这个按钮」的。
const engineBtn = makeElement("button", "engine-btn");
const engineLabel = makeElement("span", "engine-label");
const engineMenu = makeElement("ul", "engine-menu");
engineMenu.hidden = true;
engineBtn.append(engineLabel);
engineBtn.setAttribute("aria-expanded", "false");
stubs.set("engine-btn", engineBtn);
stubs.set("engine-label", engineLabel);
stubs.set("engine-menu", engineMenu);

// 记一下真的去打开了哪些地址
const opened = [];
globalThis.window.open = (url) => {
  opened.push(url);
  return {};
};

await import("../newtab.js");
await sleep(60); // start() 是异步的：先读存储再画，等它落定

const items = () => engineMenu.querySelectorAll(".engine-menu__item");
const itemOf = (id) => items().find((b) => b.dataset.engine === id);
const onIds = () =>
  items()
    .filter((b) => b.classes().has("engine-menu__item--on"))
    .map((b) => b.dataset.engine);
const savedEngine = () => {
  const raw = store.get("nk.search.engine");
  return raw === undefined ? "" : JSON.parse(raw);
};

console.log("");
console.log("搜索引擎选择菜单：");

expect("菜单里有几个引擎", items().length, ENGINES.length);
expect("按钮上写的是默认引擎", engineLabel.textContent, "必应");
expect("默认选中的就是必应", onIds().join(","), "bing");
expect("一开始菜单是收着的", engineMenu.hidden, true);

// 按下按钮 -> 打开
engineBtn.fire("mousedown", {});
expect("按下按钮就把菜单打开", engineMenu.hidden, false);
expect("按钮上的展开状态跟着改", engineBtn.getAttribute("aria-expanded"), "true");

// 点「百度」那一项（走冒泡到菜单上的那个委托监听）
itemOf("baidu").fire("click", {});
await sleep(40);

expect("按钮上换成百度", engineLabel.textContent, "百度");
expect("选中的只有百度", onIds().join(","), "baidu");
expect("存下了百度", savedEngine(), "baidu");
expect("选完菜单自己收起来", engineMenu.hidden, true);

// 再选 Google
itemOf("google").fire("click", {});
await sleep(40);
expect("换成 Google", engineLabel.textContent, "Google");
expect("存下了 google", savedEngine(), "google");

// 换了引擎之后，输入框回车真的去搜那个引擎
const input = stubs.get("search-input");
const form = stubs.get("search-form");
input.value = "hello world";
form.fire("submit", {});
await sleep(60);
expect("用的是 Google，不是必应", opened[opened.length - 1], "https://www.google.com/search?q=hello%20world");

// 网址还是直接打开，不经过引擎
input.value = "github.com";
form.fire("submit", {});
await sleep(60);
expect("网址仍然直接打开", opened[opened.length - 1], "https://github.com");

// 空输入什么都不开
const before = opened.length;
input.value = "   ";
form.fire("submit", {});
await sleep(40);
expect("空输入不开新页", opened.length, before);

// 键盘：↑↓ 在菜单里挪「高亮」，不是跳回当前选中的那一个 ——
// 当前选的是 google，↓ 先把高亮放到它后面那一项（zhihu），再 ↑ 退回 baidu。
stubs.get("search-input").focus();
engineBtn.fire("keydown", { key: "ArrowDown" });
expect("↓ 之后菜单是开着的", engineMenu.hidden, false);
expect("↓ 把高亮挪到当前项的下一项", globalThis.__focused === itemOf("zhihu"), true);
engineBtn.fire("keydown", { key: "ArrowUp" });
expect("↑ 再往回挪一项", globalThis.__focused === itemOf("baidu"), true);

// ↑↓ 也会顺手 preventDefault（免得按一下整页跟着滚）
const scrollEvent = { key: "ArrowDown", prevented: false, preventDefault() { scrollEvent.prevented = true; } };
engineBtn.fire("keydown", scrollEvent);
expect("↑↓ 被拦下，页面不跟着滚", scrollEvent.prevented, true);

// mousedown 是开关（不是只会打开），别依赖进它之前是什么状态
engineMenu.hidden = false;
const toggleEvent = { prevented: false, preventDefault() { toggleEvent.prevented = true; } };
engineBtn.fire("mousedown", toggleEvent);
expect("mousedown 顺手 preventDefault（输入框不失焦）", toggleEvent.prevented, true);
expect("开着的时候按一下 -> 收起来", engineMenu.hidden, true);

engineMenu.hidden = false;
documentStub.listeners.keydown.forEach((fn) => fn({ key: "Escape", preventDefault() {} }));
expect("Esc 收起来", engineMenu.hidden, true);

/* ---------------- 换个环境再跑一遍：存了个不认识的引擎 ---------------- */

store.set("nk.search.engine", JSON.stringify("没有这个引擎"));
await reloadNewtab();
await sleep(60);
expect("存了个不认识的引擎 -> 退回必应", engineLabel.textContent, "必应");
expect("退回之后选中的也是必应", onIds().join(","), "bing");

/* ---------------- 结果 ---------------- */

console.log("");
if (fail.length) {
  console.log("失败：");
  for (const line of fail) console.log("  ✗ " + line);
  process.exitCode = 1;
} else {
  console.log("全部通过。");
}
