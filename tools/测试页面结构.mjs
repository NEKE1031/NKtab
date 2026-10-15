/**
 * 测试页面结构.mjs —— 钉住 newtab.html 的骨架，别让改动悄悄把布局搞坏。
 *
 * 为什么单独写这个：布局坏了肉眼在代码里看不出来 —— 标签都合法、CSS 也都在，
 * 就是排出来不对。这几个「位置约定」得靠机器钉住：
 *
 *   1. 背景层 .bg 必须在 .stage 外面，否则会把 stage 的层叠和滚动一起卷进来
 *   2. .stage 里只有搜索框和 .content，不该再冒出别的直接子元素
 *   3. 三栏必须是 .weather + .grid + .panel，而且左右两边一样宽（248px）才对称
 *   4. .grid 在 HTML 里必须是空的 —— newtab.js 用 replaceChildren 整个换掉它，
 *      往里塞静态元素会被一起拿掉（踩过这个坑）
 *   5. .panel 那几个 id 是 newtab.js 按 id 抓的，少一个轮播就整块不工作
 *
 * 跑法：
 *   node tools\测试页面结构.mjs
 */

import { readFileSync } from "node:fs";

const DIR = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const html = readFileSync(DIR + "newtab.html", "utf8");
const css = readFileSync(DIR + "newtab.css", "utf8");

const ok = [];
const fail = [];
const VOID = new Set(["br", "img", "input", "meta", "link", "hr", "source", "area",
                       "base", "col", "embed", "param", "track", "wbr"]);

/* ---------- 够用的 HTML 解析器：只要「谁是谁的孩子」和 class/id ---------- */

function parse(source) {
  const clean = source.replace(/<!--.*?-->/g, "");
  const body = clean.slice(clean.indexOf("<body"));
  const root = { tag: "root", cls: "", id: "", kids: [], parent: null };
  const stack = [root];
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const closing = m[1], tag = m[2].toLowerCase(), attrs = m[3], selfClose = m[4];
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const cls = (attrs.match(/class="([^"]*)"/) || ["", ""])[1];
    const id = (attrs.match(/id="([^"]*)"/) || ["", ""])[1];
    const node = { tag, cls, id, kids: [], parent: stack[stack.length - 1] };
    node.parent.kids.push(node);
    if (!VOID.has(tag) && !selfClose) stack.push(node);
  }
  return root;
}

const tree = parse(html);

function find(node, want) {
  if (node.tag !== "root" && want(node)) return node;
  for (const kid of node.kids) {
    const hit = find(kid, want);
    if (hit) return hit;
  }
  return null;
}

const byId = (id) => find(tree, (n) => n.id === id);
const byClass = (c) => find(tree, (n) => n.cls.split(/\s+/).includes(c));
const classesOf = (n) => (n ? n.cls.split(/\s+/).filter(Boolean) : []);

/** 某个元素及其全部后代的 tag/class 拼成文本，拿来查污染 */
function textOf(node) {
  if (!node) return "";
  let out = node.tag + "." + node.cls;
  for (const kid of node.kids) out += " " + textOf(kid);
  return out;
}

/* ---------- 1. 背景层 ---------- */

const bg = byClass("bg");
if (!bg) {
  fail.push("找不到背景层 .bg");
} else if (find(bg, (n) => classesOf(n).includes("stage"))) {
  fail.push(".bg 跑到 .stage 里面去了 —— 背景层必须留在外面");
} else if (bg.parent && bg.parent.tag !== "body") {
  fail.push(`.bg 的父元素是 <${bg.parent.tag}>，期望它是 <body> 的直接子元素`);
} else {
  ok.push(".bg 是 <body> 的直接子元素，在 .stage 外面");
}



const stage = byClass("stage");
if (!stage) {
  fail.push("找不到 .stage");
} else {
  const top = stage.kids.filter((n) => ["form", "div", "aside", "section"].includes(n.tag));
  const got = top.map((n) => classesOf(n)[0] || n.tag);
  const wanted = ["search", "content"];
  if (got.length !== wanted.length || !wanted.every((w, i) => got[i] === w)) {
    fail.push(`.stage 的直接子元素是 [${got.join(", ")}]，期望 [search, content]（顺序也要对）`);
  } else {
    ok.push(".stage 里正好是搜索框 + .content 两块");
  }
}


/* ---------- 3. 三栏 + 左右对称 ---------- */

const content = byClass("content");
if (!content) {
  fail.push("找不到 .content");
} else {
  const cols = content.kids
    .filter((n) => ["aside", "div", "section"].includes(n.tag))
    .map((n) => classesOf(n)[0] || n.tag);
  if (cols.join("|") !== "weather|grid|panel") {
    fail.push(`.content 里的三栏是 [${cols.join(", ")}]，期望 [weather, grid, panel]`);
  } else {
    ok.push(".content 里三栏齐全且顺序是 天气 / 色块 / 卡片");
  }
}

/** 去掉 @media 块（响应式断点里也会出现 .panel，先剥掉免得匹配到那一份） */
function stripMedia(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const at = source.indexOf("@media", i);
    if (at < 0) { out += source.slice(i); break; }
    out += source.slice(i, at);
    let j = source.indexOf("{", at);
    if (j < 0) break;
    let depth = 1;
    j += 1;
    while (j < source.length && depth > 0) {
      if (source[j] === "{") depth += 1;
      else if (source[j] === "}") depth -= 1;
      j += 1;
    }
    i = j;
  }
  return out;
}

const flatCss = stripMedia(css);

/** 取某个选择器规则体（只在 @media 外面找） */
function ruleOf(selector) {
  const re = new RegExp("(?:^|\\n)[ \\t]*" + selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[^\\n{}]*\\{([^}]*)\\}");
  return (flatCss.match(re) || ["", ""])[1];
}

function widthOf(selector) {
  const body = ruleOf(selector);
  const px = body.match(/(?:^|[\s;])width\s*:\s*(\d+)px/);
  if (px) return Number(px[1]);
  const v = body.match(/width\s*:\s*var\((--[\w-]+)\)/);
  if (v) {
    const def = css.match(new RegExp(v[1] + "\\s*:\\s*(\\d+)px"));
    if (def) return Number(def[1]);
  }
  return null;
}

const wW = widthOf(".weather");
const wP = widthOf(".panel");
if (wW === null || wP === null) {
  fail.push(`两边宽度读不出来（.weather=${wW} / .panel=${wP}）—— CSS 格式变了？`);
} else if (wW !== wP || wW !== 248) {
  fail.push(`左右两栏宽度不一致（.weather=${wW}px / .panel=${wP}px）—— 中间那一列就不居中了`);
} else {
  ok.push(`左右两栏一样宽（都是 ${wW}px）`);
}

if (!/align-self\s*:\s*stretch/.test(ruleOf(".panel"))) {
  fail.push(".panel 少了 align-self: stretch —— 两边不会一样高");
} else {
  ok.push(".panel 有 align-self: stretch，高度跟着最高的那一栏走");
}

/* ---------- 4. .grid 必须是空的 ---------- */

const grid = byId("grid");
if (!grid) {
  fail.push('找不到 <div class="grid" id="grid">');
} else {
  const staticKids = grid.kids.filter((n) => n.tag !== "script");
  if (staticKids.length) {
    fail.push(`#grid 里有 ${staticKids.length} 个写死的子元素（${staticKids.map((n) => n.tag + "." + n.cls).join(", ")}） —— newtab.js 会用 replaceChildren 把它们一起拿掉`);
  } else {
    ok.push("#grid 在 HTML 里是空的（内容全部由 newtab.js 生成）");
  }
}

/* ---------- 5. 卡片轮播那几个 id ---------- */

const panelIds = ["panel-icon", "panel-name", "panel-prev", "panel-next",
                  "panel-view", "panel-track", "panel-dots"];
const missing = panelIds.filter((id) => !byId(id));
if (missing.length) {
  fail.push(`卡片轮播缺 id：${missing.join("、")} —— newtab.js 抓不到就不工作`);
} else {
  ok.push(`卡片轮播的 ${panelIds.length} 个 id 齐全`);
}

const view = byId("panel-view");
const track = byId("panel-track");
if (!view || !track) {
  fail.push("找不到 #panel-view / #panel-track");
} else if (track.parent !== view) {
  fail.push("#panel-track 不在 #panel-view 里面 —— 滑动窗口那套会失效");
} else {
  ok.push("#panel-track 在 #panel-view 里面");
}

/* ---------- 输出 ---------- */

for (const s of ok) console.log("  \u2713 " + s);
for (const s of fail) console.log("  \u2717 " + s);
console.log("");
if (fail.length) {
  console.log(`页面结构：${fail.length} 项没过`);
  process.exit(1);
}
console.log("页面结构：背景层 / 三栏对称 / 色块宫格是空的 / 卡片壳都在 / 全部通过。");