/**
 * 测试历史记录.mjs —— 把右边那一栏「浏览历史」真跑一遍。
 *
 * 两件事：
 *   1. history.js 里那些纯函数（排序 / 按天分组 / 取标题 / 首字母 / 关键词过滤 /
 *      时间格式）—— 这一半不碰浏览器，直接 import 来查。
 *   2. newtab.js 里那一栏的装配（画行 / 点开 / 单删 / 过滤 / 清空要两下 / 刷新）——
 *      这一半得给 newtab.js 搭假 DOM + 假 chrome.history（都在 tools\假DOM.mjs 里）。
 *
 * 跑法：
 *   node tools\测试历史记录.mjs
 */

import {
  MAX_ITEMS,
  RECENT_SHOWN,
  clockText,
  dayKey,
  dayLabel,
  entryTitle,
  forgetAll,
  forgetUrl,
  groupByDay,
  hostOfUrl,
  isBrowsable,
  letterOf,
  loadRecent,
  normalizeItems,
  pickItems,
  sortRecent,
} from "../history.js";
import { mountFakePage, reloadNewtab, removeBrowserHistory, setBrowserHistory, sleep } from "./假DOM.mjs";

const fail = [];
const expect = (label, got, want) => {
  if (got === want) console.log(`  ✓ ${label}`);
  else fail.push(`${label}：期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`);
};
const expectTrue = (label, ok) => {
  if (ok) console.log(`  ✓ ${label}`);
  else fail.push(`${label}：判断为假`);
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = Date.now();

const visit = (url, title, msAgo, extra = {}) => ({
  url,
  title,
  lastVisitTime: now - msAgo,
  visitCount: 1,
  ...extra,
});

/* ---------------- 纯函数那一半 ---------------- */

console.log("浏览历史（纯逻辑）：");

expect("一次最多读多少条", MAX_ITEMS, 200);

expect("取域名", hostOfUrl("https://www.bilibili.com/video/x"), "www.bilibili.com");
expect("网址不合法时给空串，不抛", hostOfUrl("这不是网址"), "");
expect("http 算", isBrowsable("http://a.cn"), true);
expect("https 算", isBrowsable("https://a.cn"), true);
expect("file 算", isBrowsable("file:///C:/a.html"), true);
expect("chrome:// 不算", isBrowsable("chrome://settings"), false);
expect("edge:// 不算", isBrowsable("edge://history"), false);
expect("about: 不算", isBrowsable("about:blank"), false);

// 清洗：把内部页面丢掉，缺的字段补 0 / 空串
const cleaned = normalizeItems([
  { url: "https://a.cn/x", title: "  两边有空格  ", lastVisitTime: 100 },
  { url: "chrome://settings" },
  { url: "" },
  null,
  { url: "https://b.cn", title: undefined, lastVisitTime: undefined },
]);
expect("内部页面和空条目被清掉", cleaned.length, 2);
expect("标题两边空格去了", cleaned[0].title, "两边有空格");
expect("补上了域名", cleaned[0].host, "a.cn");
expect("时间缺了补 0", cleaned[1].lastVisitTime, 0);
expect("标题缺了给空串", cleaned[1].title, "");

// 排序：按最近访问倒序；同一个网址只留一条
const sorted = sortRecent([
  { url: "a", lastVisitTime: 10 },
  { url: "b", lastVisitTime: 30 },
  { url: "c", lastVisitTime: 20 },
  { url: "a", lastVisitTime: 40 },
]);
expect("倒序排", sorted.map((i) => i.url).join(","), "a,b,c");
expect("同一个网址只留最近那次", sorted[0].lastVisitTime, 40);

expect("有标题就用标题", entryTitle({ title: " 标题 ", url: "https://a.cn" }), "标题");
expect("没标题退回域名", entryTitle({ title: "", host: "a.cn", url: "https://a.cn" }), "a.cn");
expect("连域名都没有就退回网址", entryTitle({ title: "", url: "file:///C:/x.html" }), "file:///C:/x.html");

expect("首字母大写", letterOf("https://www.bilibili.com/x"), "B");
expect("www 剥掉", letterOf("https://www.zhihu.com"), "Z");
expect("数字开头也认", letterOf("https://123pan.com"), "1");
expect("中文域名取第一个字", letterOf("https://中文.cn"), "中");
expect("取不出来给个点", letterOf("这不是网址"), "·");

expect("几点几分补零", clockText(new Date(2026, 0, 5, 9, 7).getTime()), "09:07");
expect("下午也是 24 小时制", clockText(new Date(2026, 0, 5, 15, 30).getTime()), "15:30");
expect("天的记法", dayKey(new Date(2026, 2, 8, 23, 59).getTime()), "2026-03-08");
expect("今天", dayLabel(new Date(2026, 2, 8, 9, 0).getTime(), new Date(2026, 2, 8, 20, 0).getTime()), "今天");
expect("昨天", dayLabel(new Date(2026, 2, 7, 9, 0).getTime(), new Date(2026, 2, 8, 20, 0).getTime()), "昨天");
expect(
  "今年里的旧日子只写月日",
  dayLabel(new Date(2026, 1, 3, 9, 0).getTime(), new Date(2026, 2, 8, 20, 0).getTime()),
  "2月3日"
);
expect(
  "跨年就带上年份",
  dayLabel(new Date(2025, 2, 8, 9, 0).getTime(), new Date(2026, 2, 8, 20, 0).getTime()),
  "2025年3月8日"
);

// 「昨天」不能用 now - DAY 硬减：跨月、跨年、夏令时都要对得上
expect(
  "月初的昨天要跨到上个月",
  dayLabel(new Date(2026, 1, 28, 12, 0).getTime(), new Date(2026, 2, 1, 12, 0).getTime()),
  "昨天"
);
expect(
  "元旦的昨天要跨到上一年",
  dayLabel(new Date(2025, 11, 31, 12, 0).getTime(), new Date(2026, 0, 1, 12, 0).getTime()),
  "昨天"
);

const groupInput = [
  { url: "a", lastVisitTime: now - HOUR },
  { url: "b", lastVisitTime: now - 2 * HOUR },
  { url: "c", lastVisitTime: now - 26 * HOUR },
  { url: "d", lastVisitTime: now - 3 * DAY },
  { url: "e", lastVisitTime: now - 3 * DAY - HOUR },
];
const groups = groupByDay(groupInput);
expect("分成三组", groups.length, 3);
expect("第一组是今天", groups[0].label, "今天");
expect("今天有两条", groups[0].items.length, 2);
expect("第二组是昨天", groups[1].label, "昨天");
expect("昨天有一条", groups[1].items.length, 1);
expect("第三组两条同一日", groups[2].items.length, 2);
expectTrue("第三组标题是月日", /月.*日/.test(groups[2].label));

const pool = [
  { url: "https://github.com/a/b", host: "github.com", title: "issue 列表" },
  { url: "https://www.bilibili.com/v/1", host: "www.bilibili.com", title: "视频" },
  { url: "https://gitlab.com/x", host: "gitlab.com", title: "" },
];
expect("不填就全给", pickItems(pool, "").length, 3);
expect("按标题找", pickItems(pool, "issue").map((i) => i.host).join(","), "github.com");
expect("按域名找", pickItems(pool, "bilibili").length, 1);
expect("大小写不敏感", pickItems(pool, "GITHUB").length, 1);
expect("多个词是并且（都命中才留）", pickItems(pool, "github issue").length, 1);
expect("多个词缺一个就不留", pickItems(pool, "github bilibili").length, 0);
expect("没命中就是空", pickItems(pool, "根本没有").length, 0);

/* ---------------- 假环境 ---------------- */

const page = mountFakePage();
const { stubs, store } = page;

// 记一下真的去打开了哪些地址
const opened = [];
globalThis.window.open = (url) => {
  opened.push(url);
  return {};
};

// 故意乱序给，而且掺一个 chrome:// 页面 —— 排序和过滤都得真干活
const fake = setBrowserHistory([
  visit("https://example.com/old", "很旧的一条", 3 * DAY),
  visit("https://www.bilibili.com/video/BV1", "某个有意思的视频", HOUR),
  visit("chrome://settings", "设置", 2 * HOUR),
  visit("https://github.com/NEKE1031/NKtab", "NEKE1031/NKtab: 新标签页", 3 * HOUR),
  visit("https://www.baidu.com/s?wd=%E5%A4%A9%E6%B0%94", "", 4 * HOUR),
  visit("https://zhihu.com/question/1", "知乎上的一个问题", 26 * HOUR),
]);

await import("../newtab.js");
await sleep(80); // start() 是异步的：先读历史再画，等它落定

const list = stubs.get("recent-list");
const countEl = stubs.get("recent-count");
const filterEl = stubs.get("recent-filter");
const clearBtn = stubs.get("recent-clear");
const refreshBtn = stubs.get("recent-refresh");

const rows = () => list.querySelectorAll(".recent__item");
const dayHeads = () => list.querySelectorAll(".recent__day");
const tips = () => list.querySelectorAll(".recent__tip");
const urlOf = (row) => row.dataset.url;
const urls = () => rows().map(urlOf);
const titles = () => rows().map((r) => r.querySelector(".recent__title").textContent);
const avatarOf = (row) => row.querySelector(".recent__avatar").textContent;
const metaOf = (row) => row.querySelector(".recent__meta").textContent;

console.log("");
console.log("浏览历史那一栏：");

expect("画出来几条（chrome:// 被滤掉）", rows().length, 5);
expect("最新的排最前面", urls()[0], "https://www.bilibili.com/video/BV1");
expect("最旧的排最后", urls()[4], "https://example.com/old");
expectTrue("chrome:// 没混进来", !urls().some((u) => u.startsWith("chrome://")));
expect("一共几条写在底部", countEl.textContent, "最近 5 条");

expect("分组标题有三个", dayHeads().length, 3);
expect("第一个分组标题", dayHeads()[0].textContent, "今天");
expect("第二个分组标题", dayHeads()[1].textContent, "昨天");

expect("标题就是网页标题", titles()[0], "某个有意思的视频");
expect("没标题的退回域名", titles()[2], "www.baidu.com");
expect("首字母方块", avatarOf(rows()[0]), "B");
expectTrue("底下那行是域名 · 时间", /^www\.bilibili\.com · \d{2}:\d{2}$/.test(metaOf(rows()[0])));

// 点一条 -> 在新标签页打开
opened.length = 0;
rows()[1].querySelector(".recent__hit").fire("click", {});
await sleep(20);
expect("点一条就打开它", opened.join(","), "https://github.com/NEKE1031/NKtab");

// 单删：那条要从画面上消失，也要从浏览器历史里真删掉
const before = rows().length;
rows()[0].querySelector(".recent__del").fire("click", {});
await sleep(40);
expect("单删之后少一条", rows().length, before - 1);
expectTrue("假的历史里也真删了", !fake.items.some((i) => i.url === "https://www.bilibili.com/video/BV1"));
expect("底部数字跟着变", countEl.textContent, "最近 4 条");

// 过滤：纯本地筛，不重新读历史
filterEl.value = "github";
filterEl.fire("input", {});
await sleep(10);
expect("按关键字筛出来一条", rows().length, 1);
expect("底部变成「找到几条」", countEl.textContent, "找到 1 条");

filterEl.value = "根本搜不到";
filterEl.fire("input", {});
await sleep(10);
expect("一条都没有的时候给提示", tips().length, 1);
expect("提示说的是没匹配", tips()[0].textContent, "没有匹配的条目");

filterEl.value = "";
filterEl.fire("input", {});
await sleep(10);
expect("清空关键字就全回来", rows().length, 4);

// 刷新：外面又多了一条，点刷新应该读得到
fake.items.push(visit("https://new.example/x", "刷新之后才有的", 60 * 1000));
refreshBtn.fire("click", {});
await sleep(60);
expect("刷新读到了新的一条", rows().length, 5);
expect("新的一条排在最前面", urls()[0], "https://new.example/x");

/* ---------------- 只摆最近 6 条 ---------------- */

// 再塞 4 条新的，凑到 9 条可显示的（超过上限）
for (const [i, h] of [5, 6, 7, 8].entries()) {
  fake.items.push(visit(`https://bulk${i}.example/p${i}`, `多出来的一条 ${i}`, h * 60 * 60 * 1000));
}
refreshBtn.fire("click", {});
await sleep(60);

// 假历史里现在有 10 条原始记录，其中 chrome://settings 不算，可显示 9 条
const loaded = normalizeItems(fake.items).length;
expect("可显示的条目有 9 条（chrome:// 那条不算）", loaded, 9);

expect("再多也只摆 6 条", rows().length, RECENT_SHOWN);
expect("底部写的是「最近几条」", countEl.textContent, "最近 6 条");
expectTrue("最旧的那条没被摆出来", !urls().includes("https://www.zhihu.com/question/1"));
expect("最上面还是最新的", urls()[0], "https://new.example/x");

// 但过滤是在「读回来的那一批」里找，所以第 7 条以后照样找得到
filterEl.value = "很旧";
filterEl.fire("input", {});
await sleep(10);
expect("过滤能翻到上限以外的旧条目", rows().length, 1);
expect("找到的就是那条旧的", urls()[0], "https://example.com/old");

// 命中数超过上限时，底部写成「摆了几条 / 一共命中几条」
filterEl.value = "https";
filterEl.fire("input", {});
await sleep(10);
expect("命中多于上限也只摆 6 条", rows().length, RECENT_SHOWN);
expect("底部写成 x / y 条", countEl.textContent, `6 / ${loaded} 条`);

filterEl.value = "";
filterEl.fire("input", {});
await sleep(10);
expect("关键字清掉就回到 6 条", rows().length, RECENT_SHOWN);

// 清空要点两下：第一下只是问一句
clearBtn.fire("click", {});
await sleep(10);
expect("点第一下变问句", clearBtn.textContent, "确定清空？");
expectTrue("按钮举起来了", clearBtn.classes().has("recent__clear--armed"));
expectTrue("第一下不删东西", fake.items.length > 0);

clearBtn.fire("click", {});
await sleep(80);
expect("点第二下才真清", fake.items.length, 0);
expect("清完列表空了", rows().length, 0);
expect("清完给个提示", tips()[0].textContent, "还没有浏览记录");
expect("按钮字复原", clearBtn.textContent, "清空");

/* ---------------- 读不到历史记录那条路 ---------------- */

removeBrowserHistory();
await reloadNewtab();
await sleep(80);

const list2 = stubs.get("recent-list");
const tips2 = () => list2.querySelectorAll(".recent__tip");
expect("读不到时给一条提示", tips2().length, 1);
expectTrue("提示里点明了是 history 权限", /history 权限/.test(tips2()[0].textContent));

// history.js 这一层也得老实返回失败，而不是抛
const missing = await loadRecent();
expect("没有 chrome.history 时 ok 是假", missing.ok, false);
expect("原因写的是 no-api", missing.reason, "no-api");
expect("条目是空的", missing.items.length, 0);
expect("forgetUrl 也不硬来", await forgetUrl("https://a.cn"), false);
expect("forgetAll 同样", await forgetAll(), false);

/* ---------------- 输出 ---------------- */

console.log("");
if (fail.length) {
  console.log(`历史记录：${fail.length} 项没过`);
  for (const f of fail) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("历史记录：纯逻辑 / 排序 / 分组 / 单删 / 过滤 / 两下清空 / 没权限的兜底，全部通过。");
