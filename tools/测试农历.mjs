/**
 * 测试农历.mjs —— 拿 lunar.js 的换算结果跟权威实现逐日对一遍。
 *
 * 权威数据是 tools/gen_lunar_table.py 顺手导出的 .tmp/lunar-days.json，
 * 每一行是「公历日 -> [农历年, 月, 日, 是否闰月]」。两边对不上就报出来。
 *
 *   python tools/导出农历核对数据.py     # 没有 json 时先跑这个（或在 gen 脚本里加）
 *   node tools/测试农历.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { solarToLunar } from "../lunar.js";

const JSON_PATH = new URL("../.tmp/lunar-days.json", import.meta.url);

if (!existsSync(JSON_PATH)) {
  console.error("找不到 .tmp/lunar-days.json，先跑 python tools/gen_lunar_table.py 生成权威数据。");
  process.exitCode = 1;
} else {
  const expect = JSON.parse(readFileSync(JSON_PATH, "utf8"));
  const bad = [];
  let checked = 0;

  for (const [stamp, [ly, lm, ld, leap]] of Object.entries(expect)) {
    const [y, m, d] = stamp.split("-").map(Number);
    const got = solarToLunar(y, m, d);
    checked += 1;
    if (!got) {
      bad.push(`${stamp} 算不出来`);
      continue;
    }
    if (got.year !== ly || got.month !== lm || got.day !== ld || (got.leap ? 1 : 0) !== leap) {
      bad.push(
        `${stamp} 对不上：lunar.js 得到 ${got.year}-${got.month}-${got.day}(闰=${got.leap})，` +
        `权威是 ${ly}-${lm}-${ld}(闰=${leap})`
      );
      if (bad.length >= 10) break;
    }
  }

  // 边界：表头之前、表尾之后必须老老实实返回 null
  const edges = [];
  if (solarToLunar(1900, 1, 30) !== null) edges.push("1900-01-30 应该是 null");
  if (solarToLunar(2101, 2, 1) !== null) edges.push("2101-02-01 应该是 null");

  console.log(`农历逐日核对：${checked} 天`);
  if (edges.length) {
    console.log("边界有问题：");
    for (const e of edges) console.log("  ✗ " + e);
  }
  if (bad.length || edges.length) {
    console.log("对不上：");
    for (const b of bad) console.log("  ✗ " + b);
    process.exitCode = 1;
  } else {
    console.log("全部对上。");
  }
}
