/**
 * 测「发布包里没有 wallpapers/」的时候，页面还活不活得下去。
 *
 * 背景：wallpapers/ 那 36 张是作者自己攒的图，不进仓库、也不进公开发布包
 * （见 README「壁纸」那一节）。文件不在的时候必须做到三件事：
 *   · 不崩 —— 36 条内置壁纸一条都加载不出来，也不能抛错
 *   · 不裂 —— 壁纸库那一排不能摆 36 个裂图，干脆一张都不摆，只留「去添加」那句提示
 *   · 不指空 —— 背景不能指向一个 404 的 chrome-extension:// 地址
 * 反过来，作者自己那份（wallpapers/ 齐全）行为必须一点不变。
 *
 * 跑法：
 *   node tools\测试壁纸降级.mjs
 *
 * 跟 测试壁纸库.mjs 的分工：那个测的是 storage.js 那一层（存进去的是个什么字符串），
 * 这个测的是 newtab.js 那一层（文件不在时页面怎么反应），所以必须搭假 DOM 才跑得起来。
 */

import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mountFakePage, reloadNewtab, setWallpaperFiles, sleep } from "./假DOM.mjs";

// storage.js 是 .js，这里只是为了拿 BUILTIN_WALLPAPERS 那张表，所以复制一份改名成 .mjs
// 再 import（跟 测试壁纸库.mjs 一个套路），放系统临时目录，不污染项目。
const tempDir = mkdtempSync(join(tmpdir(), "nktab-fallback-"));
const copyPath = join(tempDir, "storage.mjs");
copyFileSync(fileURLToPath(new URL("../storage.js", import.meta.url)), copyPath);

const S = await import(pathToFileURL(copyPath).href);
const ALL = S.BUILTIN_WALLPAPERS;
const ALL_PATHS = ALL.map((item) => item.path);

let failed = 0;
function check(name, ok, extra = "") {
  console.log((ok ? "✓ " : "✗ ") + name + (extra ? "   " + extra : ""));
  if (!ok) failed += 1;
}

/** 起一页新的：换一套假 DOM + 一份「哪些壁纸文件在」的清单，再把 newtab.js 重跑一遍。 */
async function boot(files) {
  const page = mountFakePage();
  setWallpaperFiles(files);
  await reloadNewtab();
  await sleep(60);
  return page;
}

/** 点一下「换背景」，等弹窗把库铺完。 */
async function openLibrary(page) {
  const btn = page.stubs.get("wallpaper-btn");
  for (const fn of btn.listeners.click || []) await fn();
  await sleep(30);
  return page.stubs.get("wp-grid");
}

/** 直接读假的 localStorage，看 newtab.js 到底往 nk.wallpaper 里写了什么。 */
function storedWallpaper(page) {
  const raw = page.store.get("nk.wallpaper");
  return raw === undefined ? undefined : JSON.parse(raw);
}

const cardsIn = (grid) => grid.children.filter((n) => n.className === "wp__card");

/* ---------------- 1. 发布包：wallpapers/ 一张都没有 ---------------- */

{
  const page = await boot([]);

  check("一张壁纸都没有时也没崩", !!page.stubs.get("bg"));

  const bg = page.stubs.get("bg").style.backgroundImage;
  check("背景不往 404 上指", bg === "", JSON.stringify(bg));
  check(
    "存着的内置默认值被清掉了",
    storedWallpaper(page) === "",
    JSON.stringify(storedWallpaper(page))
  );

  const grid = await openLibrary(page);
  check("壁纸库不摆内置那 36 格", cardsIn(grid).length === 0, `摆了 ${cardsIn(grid).length} 格`);
  check(
    "改摆「还什么都没有」那句提示",
    grid.children.length === 1 && String(grid.children[0].textContent).includes("添加图片"),
    String(grid.children[0] && grid.children[0].textContent)
  );
  check("「还回来」按钮不出现", page.stubs.get("wp-restore").hidden === true);
}

/* ---------------- 2. 作者自己那份：wallpapers/ 齐全 ---------------- */

{
  const page = await boot(ALL_PATHS);

  const bg = page.stubs.get("bg").style.backgroundImage;
  check("文件齐全时照常铺上第一张", bg.includes(ALL[0].path), bg);
  check(
    "用户存的默认值原样不动",
    S.isBuiltinWallpaper(storedWallpaper(page)),
    String(storedWallpaper(page))
  );

  const grid = await openLibrary(page);
  check(
    `壁纸库把 ${ALL.length} 张全摆出来`,
    cardsIn(grid).length === ALL.length,
    `摆了 ${cardsIn(grid).length} 格`
  );
}

/* ---------------- 3. 只在了一部分：默认那张没了 ---------------- */

{
  const only = ALL[3];
  const page = await boot([only.path]);

  const bg = page.stubs.get("bg").style.backgroundImage;
  check("默认那张不在时改用第一张真的在的", bg.includes(only.path), bg);
  check("存储也被修正成那一张", storedWallpaper(page) === only.id, String(storedWallpaper(page)));

  const grid = await openLibrary(page);
  check("库里只摆这一张", cardsIn(grid).length === 1, `摆了 ${cardsIn(grid).length} 格`);
}

console.log(failed ? `\n${failed} 项没过` : "\n全部通过");
process.exit(failed ? 1 : 0);
