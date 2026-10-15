/**
 * lunar.js —— 公历转农历（1900–2100）。
 *
 * 为什么不直接用现成的库：这个项目从头到尾「不用 npm、不用编译」，装不了
 * lunar-javascript 之类的东西。所以走通行做法——把每一年农历的「闰哪个月、
 * 每个月 29 还是 30 天」压成一串十六进制，201 年连成一张表，用的时候现查现解。
 *
 * 表在下面 LUNAR_TABLE 里，**别手改**。要重新生成就跑
 *     python tools/gen_lunar_table.py
 * 那个脚本会用 tools/农历核对.py（借 lunar_python 当权威）逐日核对，对不上就报错，
 * 所以那张表是核对过的，不是抄来的。
 *
 * 对外只提供三样东西：
 *     solarToLunar(year, month, day) -> { year, month, day, leap, monthName, dayName, ... }
 *     lunarText(year, month, day)    -> "正月初一" 这种字符串
 *     festivalText(year, month, day) -> 今天该显示哪个节日（没有就返回空串）
 */

/* 表格：每年 5 位十六进制。位含义见 tools/gen_lunar_table.py 的说明。
   1900 年排在最前面。 */
const LUNAR_TABLE =
  "80bd20075200ea550b2a0064b00a9b42aa60056a00b5920baa0075260da500b2500a4b52a4b0" +
  "02ad0056b205b500da972e9200e9200d2550d2d00a56002b642ad5006d400ea920f4a00e9260" +
  "6a60052b00a575295600b5a006d4327610074972b1300a930052b6251b00aad0056a42da500b" +
  "a400b4920d4b00a9570aad0053600aad52aca005b200da532ea200d4a8059500a97005566057" +
  "500ad5006d24075500ea50064a3064f00a9b70ada0056a00b6950bb200b5200b2540b2b00a4b" +
  "80aab002ad0056d625a900da900d9240e9500d25a0e4d00a56002b6602f5006d500ea950f520" +
  "0e9200d263052e00a5780ad60035a006d550b69007490069340a9b0052b00a5b20aae0056a70" +
  "dd500ba400b4950d5300a950052d4055d00ab590baa005d200da562e8a00d4a00c9540a9e005" +
  "5600ab520ada006d260765007250064b5065700cab0055a3056e00b69b0f5200b5200b2562d0" +
  "b00a4b004ab502bb005ad00b6a20daa00d9270ea500d2500a5552a4d004b6005b5326d200ec9" +
  "80f9200e9200d266251600a57004d64236500755007493074b0069370aab0052b00a5b50aba0" +
  "056a00b6540baa00b4a80d9500a950052d6056d00ab5005aa405d500da500d4a30e4d00c9670" +
  "cce0055600ab552ad2006d200ea54072a0068b80697004ab0055b6255600b6a0075240b9500b" +
  "4500a8b20a4f004ab";

/** 表里第一年（也是换算零点所在的那一年）。 */
const START_YEAR = 1900;

/** 1900 年正月初一对应的公历日期。整张表都是从这里往后数天数。 */
const BASE_UTC = Date.UTC(1900, 0, 31);

/** 十二个月的名字。注意第 11、12 个不叫「十一月」「十二月」。 */
export const MONTH_NAMES = [
  "正月", "二月", "三月", "四月", "五月", "六月",
  "七月", "八月", "九月", "十月", "冬月", "腊月",
];

/** 初一到三十的叫法。 */
export const DAY_NAMES = [
  "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
  "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十",
];

/* ------------------------------------------------------------------ *
 * 解码：把某一年的那 5 位十六进制还原成「每个月多少天」
 * ------------------------------------------------------------------ */

/**
 * 返回这一年的 12 或 13 个月，每项形如 { month, days, leap }。
 *
 * 解码办法就是把 gen_lunar_table.py 的编码反过来：
 *   · bit 16 以上记的是闰哪个月，0 表示不闰；
 *   · 低 12 位从「正月」开始（bit 0），一位一个月，1 表示 30 天、0 表示 29 天；
 *   · 闰月是 30 天的话，bit 13 单独记一位。
 */
function monthsOfYear(value) {
  const leapMonth = (value & 0xf0000) >> 16;   // bit 16 不是月号的一部分，要挡掉
  const leapIsLong = (value & 0x2000) !== 0;

  const list = [];
  for (let month = 1; month <= 12; month += 1) {
    // 正月占最低位（bit 0），所以几月就往左挪几位
    const long = (value & (1 << (month - 1))) !== 0;
    list.push({ month, days: long ? 30 : 29, leap: false });

    // 闰月排在它前面那个月的后头，而且「闰几月」就紧跟在几月后面
    if (leapMonth === month) {
      list.push({ month, days: leapIsLong ? 30 : 29, leap: true });
    }
  }

  // 闰腊月（闰十二月）要排在最后，上面的循环里已经跟着十二月插进去了；
  // 闰正月会插在正月后面，都对。
  return list;
}

/* ------------------------------------------------------------------ *
 * 换算
 * ------------------------------------------------------------------ */

/** 两个日期之间差几天（都按 UTC 零点算，不受时区影响）。 */
function daysBetween(fromUtc, toUtc) {
  return Math.round((toUtc - fromUtc) / 86400000);
}

/**
 * 公历 -> 农历。
 *
 * 返回 { year, month, day, leap, monthName, dayName, monthDayName }；
 * 落在 1900–2100 之外（表管不到）就返回 null，调用方自己决定显示什么。
 *
 * 注意返回的 year 是**农历年**：2026 年 1 月 20 日属于农历 2025 年腊月。
 */
export function solarToLunar(year, month, day) {
  const targetUtc = Date.UTC(year, month - 1, day);
  if (Number.isNaN(targetUtc)) return null;

  let offset = daysBetween(BASE_UTC, targetUtc);
  if (offset < 0) return null;            // 1900-01-31 之前，表管不到

  let lunarYear = START_YEAR;
  let rest = offset;

  // 一年一年往前推，直到剩下的天数不够再推一年
  for (;;) {
    const index = lunarYear - START_YEAR;
    if (index >= LUNAR_TABLE.length / 5) return null;   // 超出表尾（2100 之后）

    const value = parseInt(LUNAR_TABLE.slice(index * 5, index * 5 + 5), 16);
    if (Number.isNaN(value)) return null;

    const months = monthsOfYear(value);
    const yearDays = months.reduce((sum, item) => sum + item.days, 0);
    if (rest < yearDays) break;

    rest -= yearDays;
    lunarYear += 1;
  }

  // 剩下的天数在年里一个月一个月地减
  const value = parseInt(
    LUNAR_TABLE.slice((lunarYear - START_YEAR) * 5, (lunarYear - START_YEAR) * 5 + 5),
    16,
  );
  const months = monthsOfYear(value);

  let monthIndex = 0;
  while (monthIndex < months.length && rest >= months[monthIndex].days) {
    rest -= months[monthIndex].days;
    monthIndex += 1;
  }

  if (monthIndex >= months.length) return null;   // 理论上到不了这

  const slot = months[monthIndex];
  const monthName = (slot.leap ? "闰" : "") + MONTH_NAMES[slot.month - 1];
  const dayName = DAY_NAMES[rest] || "";

  return {
    year: lunarYear,
    month: slot.month,
    day: rest + 1,
    leap: slot.leap,
    monthName,
    dayName,
    // 「腊月初八」这种完整叫法
    monthDayName: monthName + dayName,
  };
}

/** 只要「正月初一」这种字符串。换算不出来时返回空串。 */
export function lunarText(year, month, day) {
  const result = solarToLunar(year, month, day);
  return result ? result.monthDayName : "";
}

/* ------------------------------------------------------------------ *
 * 节日
 *
 * 只列了几个大家都记得住的，够新标签页上那一行用。农历节日要拿农历月日去比，
 * 公历节日（元旦、劳动节、国庆）拿公历月日去比。
 * ------------------------------------------------------------------ */

const LUNAR_FESTIVALS = {
  "1-1": "春节",
  "1-15": "元宵节",
  "5-5": "端午节",
  "7-7": "七夕",
  "7-15": "中元节",
  "8-15": "中秋节",
  "9-9": "重阳节",
  "12-8": "腊八节",
  "12-23": "小年",
};

const SOLAR_FESTIVALS = {
  "1-1": "元旦",
  "2-14": "情人节",
  "3-8": "妇女节",
  "5-1": "劳动节",
  "6-1": "儿童节",
  "10-1": "国庆节",
  "12-25": "圣诞节",
};

/** 今天是什么节日；不是节日就返回空串。农历节日优先。 */
export function festivalText(year, month, day) {
  const lunar = solarToLunar(year, month, day);
  if (lunar) {
    const key = `${lunar.month}-${lunar.day}`;
    if (!lunar.leap && LUNAR_FESTIVALS[key]) return LUNAR_FESTIVALS[key];
  }
  return SOLAR_FESTIVALS[`${month}-${day}`] || "";
}

/** 春节那天最有用：除夕是腊月最后一天，单独判一下。 */
export function isLunarNewYearEve(year, month, day) {
  const lunar = solarToLunar(year, month, day);
  if (!lunar) return false;
  return lunar.month === 12 && !lunar.leap;
}
