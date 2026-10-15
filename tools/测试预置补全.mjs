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
 * 两个小技巧：
 *   1. storage.js 是 .js，Node 默认当 CommonJS，直接 import 会报错。
 *      所以先复制一份改名成 .mjs（放系统临时目录，不污染项目）再 import。
 *   2. 「后面新加的预置」是往复制出来的那份源码里**现塞**的（见下面 FAKE），
 *      不拿真实的 DEFAULT_BOOKMARKS 当样本。这样以后预置怎么增删，
 *      这个测试都不需要跟着改——它测的是补全机制，不是预置清单本身。
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ---- 往 storage.js 副本里塞的「后加的预置」 --------------------------------
const FAKE = [
  { id: "t01", title: "测试站甲", url: "https://test-a.example", color: "#111111" },
  { id: "t02", title: "测试站乙", url: "https://test-b.example", color: "#222222" },
  { id: "t03", title: "测试站丙", url: "https://test-c.example/maps", color: "#333333" },
  { id: "t04", title: "测试站丁", url: "https://test-d.example", color: "#444444" },
  { id: "t05", title: "测试站戊", url: "https://test-e.example", color: "#555555" },
];
const NEW_IDS = FAKE.map((x) => x.id);
const FAKE_SOURCE = FAKE.map((x) => "  " + JSON.stringify(x) + ",").join("\n");

const storageSourcePath = fileURLToPath(new URL("../storage.js", import.meta.url));
const tempDir = mkdtempSync(join(tmpdir(), "nktab-preset-"));
const copyPath = join(tempDir, "storage.mjs");

const source = readFileSync(storageSourcePath, "utf8");
const patched = source.replace(
  /(export const DEFAULT_BOOKMARKS = \[[\s\S]*?)\n\];/,
  `$1\n${FAKE_SOURCE}\n];`
);
if (patched === source) {
  throw new Error("storage.js 里找不到 DEFAULT_BOOKMARKS = [...]; 这个测试要跟着改");
}
writeFileSync(copyPath, patched, "utf8");

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

// 「老用户手里那批」= 塞进去的假预置之外的全部（真实预置全在这边）
const OLD = DEFAULT_BOOKMARKS.filter((x) => !NEW_IDS.includes(x.id)).map((x) => ({ ...x }));
const OLD_COUNT = OLD.length;
const TOTAL = DEFAULT_BOOKMARKS.length;

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

// ---- 1. 老用户：手里只有最早那批 ------------------------------------------
reset(OLD);
let list = await getBookmarks();
check(`老用户 ${OLD_COUNT} 个补成 ${TOTAL} 个`, list.length === TOTAL, `实际 ${list.length}`);
check("补上的正好是后加的那 5 个", ids(list.slice(OLD_COUNT)) === NEW_IDS.join(","),
  ids(list.slice(OLD_COUNT)));
check(`名册记下了 ${TOTAL} 个 id`,
  Array.isArray(syncData["nk.presets"]) && syncData["nk.presets"].length === TOTAL,
  JSON.stringify(syncData["nk.presets"]));

const snapshot = JSON.stringify(syncData["nk.bookmarks"]);
list = await getBookmarks();
check("再读一次不会又补一遍", JSON.stringify(syncData["nk.bookmarks"]) === snapshot,
  `长度 ${list.length}`);

// ---- 2. 老用户删过最早那批里的一个 ----------------------------------------
const dropped = OLD[2].id;
reset(OLD.filter((x) => x.id !== dropped));
list = await getBookmarks();
check(`自己删掉的 ${dropped} 不会被塞回来`, !list.some((x) => x.id === dropped),
  `长度 ${list.length}`);
check("该补的 5 个还是补上了",
  list.filter((x) => NEW_IDS.includes(x.id)).length === 5);

// ---- 3. 全新用户 ---------------------------------------------------------
reset(null);
list = await getBookmarks();
check(`全新用户一次给 ${TOTAL} 个`, list.length === TOTAL, `实际 ${list.length}`);
check("全新用户也写了名册",
  Array.isArray(syncData["nk.presets"]) && syncData["nk.presets"].length === TOTAL);

// ---- 4. 用户已经手动加过后加预置里的一个 ----------------------------------
reset([...OLD, { id: "user-1", title: FAKE[0].title, url: FAKE[0].url, color: "#000000" }]);
list = await getBookmarks();
check(`手动加过 ${FAKE[0].title} 就不再补 ${FAKE[0].id}`,
  !list.some((x) => x.id === FAKE[0].id), `长度 ${list.length}`);
check("其余 4 个照补", list.filter((x) => NEW_IDS.slice(1).includes(x.id)).length === 4);
check("手动加的那条没被动过",
  list.find((x) => x.id === "user-1")?.title === FAKE[0].title);

// ---- 5. 网址写法不同也算重复（末尾多个斜杠） ------------------------------
reset([...OLD, { id: "user-2", title: "手写的", url: FAKE[2].url + "/", color: "#000000" }]);
list = await getBookmarks();
check("末尾多个斜杠也认得出是同一条", !list.some((x) => x.id === FAKE[2].id),
  `长度 ${list.length}`);

console.log(failed ? `\n${failed} 项没过` : "\n全部通过");
process.exit(failed ? 1 : 0);
