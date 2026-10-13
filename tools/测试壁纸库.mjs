/**
 * 测壁纸库这套逻辑。
 *
 * storage.js 正常是跑在扩展里的，这里用一个假的 chrome.storage 顶替，确认：
 *   · 内置壁纸那个图片文件真的在（不然库里第一格就是空的）
 *   · 全新用户会自动用上桌面壁纸，而且只补一次
 *   · 用户自己清掉背景后，不会被偷偷塞回来
 *   · 从库里删一张，清单 / 原图 / 缩略图三处一起清干净，也不会误伤别的
 *
 * 跑法：
 *   node tools\测试壁纸库.mjs
 *
 * 小技巧：storage.js 是 .js，Node 默认当 CommonJS，直接 import 会报错。
 * 所以先复制一份改名成 .mjs（放系统临时目录，不污染项目）再 import。
 */

import { copyFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const tempDir = mkdtempSync(join(tmpdir(), "nktab-wallpaper-"));
const copyPath = join(tempDir, "storage.mjs");
copyFileSync(fileURLToPath(new URL("../storage.js", import.meta.url)), copyPath);

const localData = {};
const syncData = {};

function makeArea(store) {
  return {
    async get(key) {
      if (typeof key === "string") return key in store ? { [key]: store[key] } : {};
      if (Array.isArray(key)) {
        const out = {};
        for (const k of key) if (k in store) out[k] = store[k];
        return out;
      }
      return { ...store };
    },
    async set(obj) {
      Object.assign(store, obj);
    },
    async remove(key) {
      for (const k of Array.isArray(key) ? key : [key]) delete store[k];
    },
  };
}

globalThis.chrome = {
  storage: { sync: makeArea(syncData), local: makeArea(localData) },
};

const S = await import(pathToFileURL(copyPath).href);

let failed = 0;
function check(name, ok, extra = "") {
  console.log((ok ? "✓ " : "✗ ") + name + (extra ? "   " + extra : ""));
  if (!ok) failed += 1;
}

function reset() {
  for (const k of Object.keys(localData)) delete localData[k];
}

// ---- 1. 内置壁纸本身 ------------------------------------------------------
const builtin = S.BUILTIN_WALLPAPERS[0];
const builtinFile = fileURLToPath(new URL("../" + builtin.path, import.meta.url));

check("内置壁纸的文件真的存在", existsSync(builtinFile), builtin.path);
check("认得出内置标记", S.isBuiltinWallpaper(builtin.id));
check("自己的图不算内置", !S.isBuiltinWallpaper("data:image/png;base64,xx"));
check("查得到内置壁纸的路径", S.builtinWallpaperPath(builtin.id) === builtin.path);
check("查不到的返回空串", S.builtinWallpaperPath("builtin:nope") === "");

// ---- 2. 全新用户自动用上桌面壁纸 ------------------------------------------
reset();
check("全新用户自动用上桌面壁纸", (await S.getWallpaper()) === builtin.id);
check("「补过了」的记号写下了", localData["nk.wallpaper.seeded"] === true);

await S.setWallpaper("data:image/png;base64,AAA");
check("换成自己的图能存能读", (await S.getWallpaper()) === "data:image/png;base64,AAA");

// ---- 3. 清掉背景后不该被塞回来 --------------------------------------------
await S.clearWallpaper();
check("清掉之后读出来是空串", (await S.getWallpaper()) === "");
check("清掉之后那个键被整个删掉了", !("nk.wallpaper" in localData));

// ---- 4. 空库 --------------------------------------------------------------
reset();
check("空库返回 []", JSON.stringify(await S.getWallpaperLibrary()) === "[]");
check("读不存在的缩略图返回空串", (await S.getWallpaperThumb("nope")) === "");
check("读不存在的原图返回空串", (await S.getWallpaperImage("nope")) === "");

// ---- 5. 删一张要三处一起清，还不能误伤别的 --------------------------------
localData["nk.wallpaper.lib"] = [
  { id: "w1", name: "a.jpg", addedAt: 1 },
  { id: "w2", name: "b.jpg", addedAt: 2 },
];
localData["nk.wallpaper.img.w1"] = "data:image/jpeg;base64,BIG1";
localData["nk.wallpaper.img.w2"] = "data:image/jpeg;base64,BIG2";
localData["nk.wallpaper.thumb.w1"] = "data:image/jpeg;base64,SMALL1";
localData["nk.wallpaper.thumb.w2"] = "data:image/jpeg;base64,SMALL2";

check("读得到缩略图", (await S.getWallpaperThumb("w1")) === "data:image/jpeg;base64,SMALL1");
check("读得到原图", (await S.getWallpaperImage("w1")) === "data:image/jpeg;base64,BIG1");

await S.removeWallpaperFromLibrary("w1");

const left = await S.getWallpaperLibrary();
check("清单里只剩 w2", left.length === 1 && left[0].id === "w2", JSON.stringify(left));
check("w1 的原图被清掉了", !("nk.wallpaper.img.w1" in localData));
check("w1 的缩略图被清掉了", !("nk.wallpaper.thumb.w1" in localData));
check("w2 的原图没被误删", localData["nk.wallpaper.img.w2"] === "data:image/jpeg;base64,BIG2");
check("w2 的缩略图没被误删", localData["nk.wallpaper.thumb.w2"] === "data:image/jpeg;base64,SMALL2");

// ---- 6. 更新桌面壁纸的那个 bat 在不在 -------------------------------------
check(
  "「更新桌面壁纸.bat」在位",
  existsSync(fileURLToPath(new URL("更新桌面壁纸.bat", import.meta.url)))
);

console.log(failed ? `\n${failed} 项没过` : "\n全部通过");
process.exit(failed ? 1 : 0);
