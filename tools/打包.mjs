/**
 * 打包.mjs —— 把「能公开的那部分」打成一个 zip，用来发 GitHub Release。
 *
 * 为什么要有这个脚本：wallpapers/ 那 36 张壁纸是作者自己攒的，既不在仓库里、也不能
 * 进发布包（见 README「壁纸」那一节）；根目录还躺着 README.md、预览.html 这些
 * 「给人看的、不是给扩展看的」东西。手工拖文件夹太容易顺手带上，所以这里干脆不列清单，
 * 而是从 manifest.json 出发，把「扩展真正要用到的文件」一个个顺着引用爬出来：
 *
 *   manifest.json → 新标签页 html、图标
 *   newtab.html   → 它 <script>/<link> 到的东西
 *   newtab.js     → 它 import 的模块（cards / lunar / search / storage / weather）
 *
 * 爬不到的（wallpapers/、docs/、tools/、README.md、预览.html……）自然就进不了包。
 * 反过来，以后加了新模块也不用改这个脚本 —— 只要 newtab.js import 了它，它就在包里。
 * 要是 import 的东西硬盘上根本没有，这里当场报错，不会打出一个装不上的包。
 *
 * 最后再把打好的 zip 中央目录读一遍，确认里面真的只有爬出来的那几个。
 *
 * 纯 Node，不喊 git、不喊 PowerShell：不依赖外面装了什么，换个系统照样能跑。
 *
 * 跑法：
 *   node tools\打包.mjs
 *   → dist\NKtab-v1.9.1.zip
 *
 * 包里长这样（解压得到一个 NKtab 文件夹，直接拖进扩展管理页就能加载）：
 *   NKtab\manifest.json
 *   NKtab\newtab.html
 *   NKtab\newtab.css
 *   NKtab\newtab.js
 *   NKtab\icons\icon16.png
 *   ...
 * 文件夹名不带版本号：Edge 加载过一次之后认的是这个路径，升级时覆盖同名文件夹即可，
 * 用户不用再拖一次。
 */

import { deflateRawSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const zipFolder = "NKtab";

/* ---------------- 1. 顺着引用爬出「扩展真正用到的那几个文件」 ---------------- */

/** 外链、锚点、data: 这些不是文件，跳过 */
const SKIP_REF = /^(https?:|data:|#|mailto:|\/)/;

/** 一个文件里提到了哪些「自己人」（相对路径，已归一到仓库根的位置） */
function references(entry, text) {
  const found = [];
  if (entry.endsWith(".html")) {
    for (const m of text.matchAll(/(?:src|href)="([^"]+)"/g)) found.push(m[1]);
  }
  if (entry.endsWith(".js")) {
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) found.push(m[1]);
  }
  if (entry === "manifest.json") {
    // 图标、新标签页、脚本……全都是一串串带后缀的路径，抓出来就行
    for (const m of text.matchAll(/"([^"\n]*\.(?:html|js|css|png))"/g)) found.push(m[1]);
  }
  return found
    .filter((ref) => !SKIP_REF.test(ref))
    .map((ref) => posix.normalize(posix.join(posix.dirname(entry) === "." ? "" : posix.dirname(entry), ref)))
    .filter((ref) => ref !== "" && ref !== "." && !ref.startsWith(".."));
}

/** 引到了但硬盘上没有的（这几个出来了就说明包会装不上） */
const broken = [];

function collect() {
  const seen = new Set();
  const queue = ["manifest.json"];

  while (queue.length) {
    const entry = queue.shift();
    if (seen.has(entry)) continue;

    const full = join(root, entry);
    if (!existsSync(full) || !statSync(full).isFile()) {
      broken.push(entry);
      continue;
    }

    seen.add(entry);

    // 图片没什么可往下爬的，翻文本就行（manifest.json 也要翻，图标和新标签页都写在那）
    if (!/\.(html|js|css|json)$/.test(entry)) continue;
    for (const ref of references(entry, readFileSync(full, "utf8"))) queue.push(ref);
  }

  return [...seen].sort();
}

/** 这几样出现在包里就是出事了，宁可打不出包也不能发出去。 */
const NEVER_SHIP = [/^wallpapers\//, /^docs\//, /^tools\//, /^\.git/, /\.md$/, /\.bat$/, /^预览\.html$/];

/** 少一个扩展都装不起来 */
const MUST_HAVE = ["manifest.json", "newtab.html", "newtab.js", "newtab.css"];

/* ---------------- 2. 一个够用的 zip 写入器 ---------------- */
// 只用 Node 自带的 zlib，不引第三方库。ZIP 那套头结构照规范摆一遍。

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function buildZip(entries) {
  const now = new Date();
  // ZIP 里时间/日期是老 DOS 那套：秒只有 5 位，得除以 2
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDay = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const squeezed = deflateRawSync(data);
    // 压不小就用存的（png 基本都压不动，deflate 反而更大）
    const useStore = squeezed.length >= data.length;
    const body = useStore ? data : squeezed;
    const method = useStore ? 0 : 8;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // 解压需要 2.0
    local.writeUInt16LE(0x0800, 6); // 文件名是 UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDay, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra

    chunks.push(local, nameBuf, body);

    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4); // 制造者版本
    head.writeUInt16LE(20, 6); // 解压需要
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(method, 10);
    head.writeUInt16LE(dosTime, 12);
    head.writeUInt16LE(dosDay, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(body.length, 20);
    head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(nameBuf.length, 28);
    head.writeUInt16LE(0, 30); // extra
    head.writeUInt16LE(0, 32); // 注释
    head.writeUInt16LE(0, 34); // 第几个磁盘
    head.writeUInt16LE(0, 36); // 内部属性
    head.writeUInt32LE(0, 38); // 外部属性
    head.writeUInt32LE(offset, 42);
    central.push(head, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // 没有注释

  return Buffer.concat([...chunks, ...central, end]);
}

/** 把刚打出来的 zip 再读一遍：中央目录里到底有哪些名字。 */
function listZipEntries(buf) {
  const eocd = buf.length - 22;
  if (buf.readUInt32LE(eocd) !== 0x06054b50) throw new Error("这不是一个 zip：尾标记对不上");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("这不是一个 zip：中央目录对不上");
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    names.push(buf.toString("utf8", p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/* ---------------- 3. 干活 ---------------- */

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const version = manifest.version;

let failed = 0;
function check(name, ok, extra = "") {
  console.log((ok ? "✓ " : "✗ ") + name + (extra ? "   " + extra : ""));
  if (!ok) failed += 1;
}

console.log(`打包 NKtab v${version}\n`);

const files = collect();
const texts = new Map(files.map((f) => [f, readFileSync(join(root, f))]));

console.log("顺着引用爬出来的文件：");
for (const f of files) console.log(`  ${f}   ${(texts.get(f).length / 1024).toFixed(1)} KB`);
console.log("");

// (1) 引用不能断
check("引到的东西硬盘上都有", broken.length === 0, broken.join(", "));

// (2) 该在的在
const absent = MUST_HAVE.filter((f) => !files.includes(f));
check("扩展离不了的那几个都在", absent.length === 0, absent.join(", "));

// (3) 不该在的不在
const leaked = files.filter((f) => NEVER_SHIP.some((rule) => rule.test(f)));
check("没混进墙纸 / 文档 / 工具 / 说明文件", leaked.length === 0, leaked.join(", "));

// (4) 真打出来，再拆开读一遍
const zipName = `NKtab-v${version}.zip`;
const zipBuffer = buildZip(files.map((f) => ({ name: posix.join(zipFolder, f), data: texts.get(f) })));
const inside = listZipEntries(zipBuffer);
const inner = inside.map((n) => (n.startsWith(zipFolder + "/") ? n.slice(zipFolder.length + 1) : n));

check("zip 里文件数对得上", inside.length === files.length, `${inside.length} 个`);
check("zip 里的名字跟爬出来的一模一样", inner.every((n) => files.includes(n)) && files.every((f) => inner.includes(f)));
check("zip 里翻不出墙纸", !inner.some((n) => NEVER_SHIP.some((rule) => rule.test(n))));

if (failed) {
  console.log(`\n${failed} 项没过，没写出 zip。`);
  process.exit(1);
}

const distDir = join(root, "dist");
mkdirSync(distDir, { recursive: true });
const outPath = join(distDir, zipName);
writeFileSync(outPath, zipBuffer);

console.log(`\ndist\\${zipName}   ${(zipBuffer.length / 1024).toFixed(1)} KB`);
console.log(`解压出来是 ${zipFolder}\\ 文件夹，直接拖进 edge://extensions/ 就能加载。`);
