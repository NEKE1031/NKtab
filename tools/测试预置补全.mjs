/**
 * 测「新预置自动补上」这套逻辑。
 *
 * storage.js 正常是跑在扩展里的，这里用一个假的 chrome.storage 顶替，
 * 把几种情况各跑一遍，确认：
 *   · 该补的补上，但不会补两遍
 *   · 用户自己删掉的不会被塞回来
 *   · 用户已经手动加过的网址不会重复加
 *
 * 跑法：
 *   node tools\测试预置补全.mjs
 *
 * 小技巧：storage.js 是 .js，Node 默认当 CommonJS，直接 import 会报错。
 * 所以先复制一份改名成 .mjs（放系统临时目录，不污染项目）再 import。
 */

import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const tempDir = mkdtempSync(join(tmpdir(), "nktab-preset-"));
const copyPath = join(tempDir, "storage.mjs");
copyFileSync(fileURLToPath(new URL("../storage.js", import.meta.url)), copyPath);

const syncData = {};
const localData = {};

function makeArea(store) {
  return {
    async get(key) {
      if (typeof key === "string") return key in store ? { [key]: store[key] } : {};
      return { ...store };
    },
    async set(obj) {
      Object.assign(store, obj);
    },
    async remove(key) {
      delete store[key];
    },
  };
}

globalThis.chrome = {
  storage: { sync: makeArea(syncData), local: makeArea(localData) },
};

const { getBookmarks, DEFAULT_BOOKMARKS } = await import(pathToFileURL(copyPath).href);

const NEW_IDS = ["d13", "d14", "d15", "d16", "d17"];
const FIRST_12 = DEFAULT_BOOKMARKS.slice(0, 12).map((x) => ({ ...x }));

function reset(bookmarks) {
  for (const key of Object.keys(syncData)) delete syncData[key];
  if (bookmarks) syncData["nk.bookmarks"] = bookmarks;
}

let failed = 0;
function check(name, ok, extra = "") {
  console.log((ok ? "✓ " : "✗ ") + name + (extra ? "   " + extra : ""));
  if (!ok) failed += 1;
}

const ids = (list) => list.map((x) => x.id).join(",");

// ---- 1. 老用户：手里是 d01~d12 -------------------------------------------
reset(FIRST_12);
let list = await getBookmarks();
check("老用户 12 个补成 17 个", list.length === 17, `实际 ${list.length}`);
check("补上的正好是 d13~d17", ids(list.slice(12)) === "d13,d14,d15,d16,d17", ids(list.slice(12)));
check("名册记下了 17 个 id",
  Array.isArray(syncData["nk.presets"]) && syncData["nk.presets"].length === 17,
  JSON.stringify(syncData["nk.presets"]));

const snapshot = JSON.stringify(syncData["nk.bookmarks"]);
list = await getBookmarks();
check("再读一次不会又补一遍", JSON.stringify(syncData["nk.bookmarks"]) === snapshot,
  `长度 ${list.length}`);

// ---- 2. 老用户删过 d03 ---------------------------------------------------
reset(FIRST_12.filter((x) => x.id !== "d03"));
list = await getBookmarks();
check("自己删掉的 d03 不会被塞回来", !list.some((x) => x.id === "d03"), `长度 ${list.length}`);
check("该补的 5 个还是补上了",
  list.filter((x) => NEW_IDS.includes(x.id)).length === 5);

// ---- 3. 全新用户 ---------------------------------------------------------
reset(null);
list = await getBookmarks();
check("全新用户一次给 17 个", list.length === 17, `实际 ${list.length}`);
check("全新用户也写了名册",
  Array.isArray(syncData["nk.presets"]) && syncData["nk.presets"].length === 17);

// ---- 4. 用户已经手动加过 GPT ---------------------------------------------
reset([...FIRST_12, { id: "user-1", title: "GPT", url: "https://chatgpt.com", color: "#000000" }]);
list = await getBookmarks();
check("手动加过 GPT 就不再补 d13", !list.some((x) => x.id === "d13"), `长度 ${list.length}`);
check("其余 4 个照补", list.filter((x) => ["d14", "d15", "d16", "d17"].includes(x.id)).length === 4);
check("手动加的那条没被动过",
  list.find((x) => x.id === "user-1")?.title === "GPT");

// ---- 5. 网址写法不同也算重复（末尾多个斜杠） -----------------------------
reset([...FIRST_12, { id: "user-2", title: "地图", url: "https://www.google.com/maps/", color: "#000000" }]);
list = await getBookmarks();
check("末尾多个斜杠也认得出是同一条", !list.some((x) => x.id === "d15"), `长度 ${list.length}`);

console.log(failed ? `\n${failed} 项没过` : "\n全部通过");
process.exit(failed ? 1 : 0);
