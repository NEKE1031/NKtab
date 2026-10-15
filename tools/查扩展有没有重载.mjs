/**
 * 查扩展有没有重载.mjs —— 判断 Edge 现在跑的是不是磁盘上的最新代码。
 *
 * 为什么要这个：改完扩展代码必须在 edge://extensions/ 点「重新加载」才生效，
 * 不点的话 Edge 会一直跑内存里那份旧的。这个脚本把「磁盘上的代码有什么特征」
 * 和「Edge 记在 Secure Preferences 里的状态」摆到一起看。
 *
 * 跑法：
 *   node tools\查扩展有没有重载.mjs
 */

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";

const DIR = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/* ---- 1. 磁盘上的代码有什么特征 ---- */

const features = [
  ["newtab.html", "engine-btn", "搜索框左边的小引擎图标"],
  ["newtab.html", "search__icon", "搜索框里的放大镜"],
  ["newtab.js", "./search.js", "搜索逻辑抽成了独立模块"],
];

console.log("=== 磁盘上的代码（E:\\DeepSeekHarnessWork\\NKtab）===");
const disk = {};
for (const [file, needle, what] of features) {
  const text = readFileSync(DIR + file, "utf8");
  const has = text.includes(needle);
  disk[needle] = has;
  console.log(`  ${has ? "有" : "没有"}  ${file} 里的 ${needle.padEnd(14)} —— ${what}`);
}

const html = readFileSync(DIR + "newtab.html", "utf8");
console.log(`  newtab.html 最后改动：${statSync(DIR + "newtab.html").mtime.toLocaleString()}`);
console.log(`  newtab.css  最后改动：${statSync(DIR + "newtab.css").mtime.toLocaleString()}`);

/* ---- 2. Edge 记的扩展状态 ---- */

const EXT_ID = "cghghgdnefpiigppddmkelgnbapmnlhl";
const profiles = [
  "AppData/Local/Microsoft/Edge/User Data/Default/Secure Preferences",
  "AppData/Local/Microsoft/Edge/User Data/Default/Preferences",
];

console.log("");
console.log("=== Edge 记的 NKtab 状态 ===");
let found = false;
for (const rel of profiles) {
  const path = `${homedir()}/${rel}`.replace(/\\/g, "/");
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    continue;
  }
  const ext = data?.extensions?.settings?.[EXT_ID];
  if (!ext) continue;
  found = true;
  const mf = ext.manifest || {};
  console.log(`  （读自 ${rel.split("/").pop()}）`);
  console.log(`  path             = ${ext.path}`);
  console.log(`  location         = ${ext.location}  (4 = 本机加载的未打包扩展)`);
  console.log(`  manifest.version = ${mf.version ?? "（Edge 没记版本号）"}`);
  console.log(`  记录的描述        = ${mf.description ?? "（空）"}`);
}

if (!found) {
  console.log("  两个配置文件里都没找到这个扩展 —— 可能换了 profile，或者扩展已被移除。");
}

/* ---- 3. 结论 ---- */

console.log("");
console.log("=== 怎么用这个结果 ===");
console.log("  磁盘上「有」+ 新标签页上看不到  =>  Edge 还在跑旧代码，去 edge://extensions/ 点「重新加载」");
console.log("  连点两次重新加载都没用          =>  把 NKtab 移除，再「加载解压缩的扩展」重新选这个目录");
console.log("  想确认重载有没有生效，看新标签页搜索框：");
console.log("    新版 = 左边有个白色小圆（写着 B / 百 / G / 知 / 哔），旁边才是放大镜");
console.log("    旧版 = 左边空空如也，什么图标都没有");
