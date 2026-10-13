import { readFileSync } from "node:fs";

const DIR = "E:\\DeepSeekHarnessWork\\NKtab\\";
const html = readFileSync(DIR + "newtab.html", "utf8");
const js = readFileSync(DIR + "newtab.js", "utf8");
const css = readFileSync(DIR + "newtab.css", "utf8");
const storage = readFileSync(DIR + "storage.js", "utf8");

const fail = [];
const note = [];

/* ---- 1. HTML 里的 id ---- */
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

/* ---- 2. JS 里 getElementById 的 id ---- */
const usedIds = new Set(
  [...js.matchAll(/getElementById\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1])
);

for (const id of usedIds) {
  if (!htmlIds.has(id)) fail.push(`JS 用了 id="${id}"，但 HTML 里没有`);
}
for (const id of htmlIds) {
  if (!usedIds.has(id)) note.push(`HTML 里的 id="${id}" 好像没被用到`);
}
console.log(`id 对账：HTML ${htmlIds.size} 个，JS 取用 ${usedIds.size} 个`);

/* ---- 3. 各个模块的 export vs newtab.js 的 import ---- */
for (const mod of ["storage", "weather"]) {
  const source = readFileSync(DIR + mod + ".js", "utf8");
  const exported = new Set(
    [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z_$][\w$]*)/g)]
      .map((m) => m[1])
  );

  // 注意用 [^}]* 而不是 [\s\S]*?：文件里有多个 import { ... }，
  // 非贪婪跨行匹配会从第一个 import 一路吃到目标那一行。
  const block = js.match(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*"\\./${mod}\\.js"`));
  if (!block) {
    fail.push(`newtab.js 里找不到 import ... from './${mod}.js'`);
    continue;
  }

  const imported = block[1].split(",").map((s) => s.trim()).filter(Boolean);
  for (const name of imported) {
    if (!exported.has(name)) fail.push(`newtab.js 导入了 ${name}，但 ${mod}.js 没有导出`);
  }
  console.log(`导入对账：${mod}.js 导出 ${exported.size} 个，newtab.js 导入其中 ${imported.length} 个`);
}

/* ---- 4. JS 里写的 class 名 vs CSS 里定义的 ---- */
const jsClasses = new Set();
for (const m of js.matchAll(/className\s*=\s*"([^"]+)"/g)) {
  for (const c of m[1].split(/\s+/)) if (c) jsClasses.add(c);
}
for (const m of js.matchAll(/classList\.(?:add|remove|toggle)\(\s*"([^"]+)"/g)) {
  jsClasses.add(m[1]);
}
for (const c of jsClasses) {
  if (!css.includes("." + c)) fail.push(`JS 用了 class="${c}"，但 CSS 里没有样式规则`);
}
console.log(`class 对账：JS 里用到 ${jsClasses.size} 个 class`);

/* ---- 5. CSS 自定义属性是否成对 ----
   注意：--face / --face-text 这类是 JS 运行时写在元素行内 style 上的，
   CSS 里只提供 var(--face, 兜底值) 的默认值，所以要把它们排除掉。 */
const jsVars = new Set(
  [...js.matchAll(/setProperty\(\s*"(--[\w-]+)"/g)].map((m) => m[1])
);

const definedVars = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
const usedVars = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
for (const v of usedVars) {
  if (!definedVars.has(v) && !jsVars.has(v)) fail.push(`CSS 用了 var(${v})，但没有地方定义它`);
}
console.log(`CSS 变量：定义 ${definedVars.size} 个，使用 ${usedVars.size} 个（其中 ${jsVars.size} 个由 JS 运行时写入）`);

/* ---- 6. JS 里 setProperty 的自定义属性 ---- */
for (const m of js.matchAll(/setProperty\(\s*"(--[\w-]+)"/g)) {
  if (!css.includes(m[1])) fail.push(`JS 设置了 ${m[1]}，但 CSS 里没用它`);
}
for (const m of js.matchAll(/var\((--[\w-]+)/g)) {
  if (!definedVars.has(m[1]) && !css.includes(m[1])) fail.push(`JS 用了 var(${m[1]})，CSS 里没有`);
}

/* ---- 结果 ---- */
console.log("");
if (note.length) {
  console.log("提示：");
  for (const n of note) console.log("  · " + n);
}
if (fail.length) {
  console.log("");
  console.log("有问题：");
  for (const f of fail) console.log("  ✗ " + f);
  process.exitCode = 1;
} else {
  console.log("全部对账通过。");
}
