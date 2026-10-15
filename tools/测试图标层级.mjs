/**
 * 测试图标层级.mjs —— regression 测试：搜索框左边的图标不能被输入框盖住。
 *
 * 为什么单独写这个：这个 bug 肉眼查代码看不出来 —— HTML 有、CSS 有、位置也对，
 * 就是画出来被盖住。只有在真浏览器里 elementFromPoint 才发现得了。
 *
 * 这个脚本做两件不依赖浏览器的事：
 *   1. 静态检查：newtab.css 里 .search__icon / .engine 必须带 z-index，
 *      而且 z-index 要大于输入框的（输入框没写 = auto = 0）。
 *   2. 顺序检查：newtab.html 里输入框必须排在图标后面（DOM 顺序靠后者画在上面），
 *      这正是必须靠 z-index 补救的原因 —— 顺便把这个前提钉住。
 *
 * 跑法：
 *   node tools\测试图标层级.mjs
 */

import { readFileSync } from "node:fs";

const DIR = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const css = readFileSync(DIR + "newtab.css", "utf8");
const html = readFileSync(DIR + "newtab.html", "utf8");

const fail = [];
const ok = [];

/** 取出某个选择器的规则体（第一个匹配到的） */
function ruleOf(selector) {
  const re = new RegExp(
    "(?:^|\\n)\\s*" + selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}"
  );
  const m = css.match(re);
  return m ? m[1] : null;
}

/* ---- 1. 图标和按钮得有 z-index ---- */

for (const sel of [".search__icon", ".engine"]) {
  const body = ruleOf(sel);
  if (body === null) {
    fail.push(`newtab.css 里找不到 ${sel}`);
    continue;
  }
  const z = body.match(/z-index\s*:\s*(\d+)/);
  if (!z) {
    fail.push(`${sel} 没写 z-index —— 它会被后面画的输入框盖住，肉眼看着像「没有图标」`);
  } else if (Number(z[1]) < 1) {
    fail.push(`${sel} 的 z-index=${z[1]} 不够，得压过输入框（>=1）`);
  } else {
    ok.push(`${sel} 有 z-index: ${z[1]}`);
  }
}

/* ---- 2. 输入框自己不该偷偷抬层级把图标盖回去 ---- */

const inputBody = ruleOf(".search__input");
if (inputBody === null) {
  fail.push("newtab.css 里找不到 .search__input");
} else {
  const z = inputBody.match(/z-index\s*:\s*(\d+)/);
  if (z && Number(z[1]) > 0) {
    // 输入框要是也抬了层级，得保证图标更高
    const iconZ = Number((ruleOf(".search__icon") || "").match(/z-index\s*:\s*(\d+)/)?.[1] ?? 0);
    if (iconZ <= Number(z[1])) {
      fail.push(`输入框 z-index=${z[1]}，图标只有 ${iconZ} —— 图标又被盖住了`);
    } else {
      ok.push(`输入框 z-index=${z[1]}，图标更高（${iconZ}）`);
    }
  } else {
    ok.push("输入框没抬层级（z-index auto）");
  }
}

/* ---- 3. 钉住「输入框在 DOM 里排在图标后面」这个前提 ---- */

const iIcon = html.indexOf("search__icon");
const iBtn = html.indexOf('id="engine-btn"');
const iInput = html.indexOf('id="search-input"');
if (iIcon < 0 || iBtn < 0 || iInput < 0) {
  fail.push("newtab.html 里缺 search__icon / engine-btn / search-input 之一");
} else if (!(iIcon < iInput && iBtn < iInput)) {
  fail.push("DOM 顺序变了：输入框不再排在图标后面 —— 那 z-index 的必要性得重新评估");
} else {
  ok.push(`DOM 顺序：放大镜(${iIcon}) < 引擎按钮(${iBtn}) < 输入框(${iInput})`);
}

/* ---- 4. 输入框左边要留够位置给这两个图标 ---- */

const pad = (inputBody || "").match(/padding\s*:\s*0\s+\S+\s+0\s+(\d+)px/);
if (!pad) {
  fail.push(".search__input 的 padding-left 找不到（格式变了？）");
} else if (Number(pad[1]) < 64) {
  fail.push(`输入框 padding-left=${pad[1]}px，图标占到 64px，文字会压到图标上`);
} else {
  ok.push(`输入框 padding-left=${pad[1]}px，给图标留够了（需要 >=64）`);
}

/* ---- 输出 ---- */

for (const s of ok) console.log("  ✓ " + s);
for (const s of fail) console.log("  ✗ " + s);
console.log("");
if (fail.length) {
  console.log(`图标层级回归：${fail.length} 项没过`);
  process.exit(1);
}
console.log("图标层级回归：输入框不会盖住搜索框左边的图标 / 全部通过。");
