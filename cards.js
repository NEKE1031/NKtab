/**
 * cards.js —— 右边那栏五张卡片里真正要显示的东西。
 *
 * 每张卡片就两个可选函数，newtab.js 的轮播按约定调用：
 *
 *   mount(box, api)    往 box 里画内容。来回切卡片时只在第一次调，之后复用。
 *   unmount(box)       有定时器 / 正在等的数据要收尾时写这个。
 *
 * 写法上跟别处保持一致：元素用 document.createElement 一个个建，
 * 不用 innerHTML 拼字符串（外面来的字（比如用户自己写的待办）拼进去会出问题）。
 * 类名都是字面量写死的，tools/check.mjs 会拿它们跟 CSS 对账。
 *
 * 所有卡片的共同点：数据都存在 storage.js 里，改一下就存一次，
 * 不要求按「保存」按钮。
 */

import {
  getTodos,
  setTodos,
  getMemos,
  setMemos,
  getCountdowns,
  setCountdowns,
  getQuoteIndex,
  setQuoteIndex,
} from "./storage.js";

import { solarToLunar, lunarText, festivalText, isLunarNewYearEve, DAY_NAMES } from "./lunar.js";

/* ---------------- 顺手要用的几个小工具 ---------------- */

/** 补零：7 -> "07" */
function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Date -> "2026-10-15"（就是本地日历上的那一天，不涉及时区换算） */
function dayKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** "2026-10-15" -> Date（本地零点）。写不出合法日期就返回 null。 */
function parseDayKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || "").trim());
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // 反过来验一下：2 月 31 号这种会被 Date 悄悄滚到 3 月，这里当非法处理
  if (date.getFullYear() !== Number(m[1]) || date.getMonth() !== Number(m[2]) - 1 || date.getDate() !== Number(m[3])) {
    return null;
  }
  return date;
}

/**
 * 建一个元素，顺便把类名 / 文字 / 子节点安上。
 *
 * 参数都走对象，是怕位置参数一多就记不清哪个是哪个。
 */
function el(tag, { className, text, html, attrs, children, on } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (html !== undefined) node.innerHTML = html;
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value === false || value === undefined) continue;
      node.setAttribute(name, value === true ? "" : value);
    }
  }
  if (children) {
    for (const child of children) {
      if (child) node.append(child);
    }
  }
  if (on) {
    for (const [type, fn] of Object.entries(on)) node.addEventListener(type, fn);
  }
  return node;
}

/** 卡片顶上一行小标题，五张卡片长一个样，所以抽出来。 */
function sectionLabel(text) {
  return el("div", { className: "card__label", text });
}

/** 一条空状态提示。 */
function emptyHint(text) {
  return el("p", { className: "card__empty", text });
}

/** 列表底部那一行「＋ 加一条」的文字按钮。 */
function addButton(text, onClick) {
  return el("button", {
    className: "card__add",
    text,
    attrs: { type: "button" },
    on: { click: onClick },
  });
}

/** 把一串子节点塞进 box，先清空。 */
function fill(box, children) {
  box.replaceChildren(...children.filter(Boolean));
}

/* ------------------------------------------------------------------ *
 * ① 日历：今天几号、农历、节日，再加一个当月小月历
 * ------------------------------------------------------------------ */

const WEEK_HEADS = ["一", "二", "三", "四", "五", "六", "日"];

/**
 * 当月月历。
 *
 * 中国习惯周一开头，所以先算出 1 号是星期几，再往前补空格；
 * 每格上排公历日，下排农历（只写日子，比如「廿一」；初一写成月份，比如「九月」）。
 */
function buildMonthGrid(today) {
  const year = today.getFullYear();
  const month = today.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const grid = el("div", { className: "calendar__grid" });

  for (const head of WEEK_HEADS) {
    grid.append(el("span", { className: "calendar__week", text: head }));
  }

  // getDay()：周日是 0。换算成「周一开头」的下标
  const lead = (first.getDay() + 6) % 7;
  for (let i = 0; i < lead; i++) {
    grid.append(el("span", { className: "calendar__cell calendar__cell--blank" }));
  }

  const todayKey = dayKey(today);
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const lunar = solarToLunar(year, month + 1, day);
    const isToday = dayKey(date) === todayKey;

    // 初一显示月名，其余显示日子；春节这种大节直接顶掉
    let sub = lunar.day === 1 ? lunar.monthName : lunar.dayName;
    const festival = festivalText(year, month + 1, day);
    if (festival) sub = festival;

    const cell = el("span", {
      className: isToday ? "calendar__cell calendar__cell--today" : "calendar__cell",
      attrs: { title: festival ? `${month + 1}月${day}日 ${festival}` : `${month + 1}月${day}日` },
      children: [
        el("b", { className: "calendar__num", text: String(day) }),
        el("i", { className: "calendar__sub", text: sub }),
      ],
    });
    // 今天的格子底色不一样，再给它个 aria，读屏能念出来
    if (isToday) cell.setAttribute("aria-current", "date");
    grid.append(cell);
  }

  return grid;
}

/** 头部：公历大字 + 星期 + 农历 + 节日 */
function buildTodayCard(today) {
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const day = today.getDate();
  const lunar = solarToLunar(year, month, day);
  const festival = festivalText(year, month, day);

  // 除夕那天 festivalText 是空的（春节才算节日），单独补一句
  const extra = !festival && isLunarNewYearEve(year, month, day) ? "除夕" : "";

  const lines = [
    el("div", { className: "calendar__big", text: `${month} 月 ${day} 日` }),
    el("div", {
      className: "calendar__weekday",
      text: `${lunar.year !== year ? `${lunar.year}年` : ""}${DAY_NAMES[today.getDay()]} · 农历${lunar.monthDayName}`,
    }),
  ];

  if (festival || extra) {
    lines.push(el("div", { className: "calendar__festival", text: festival || extra }));
  }

  return lines;
}

const calendarCard = {
  mount(box) {
    const today = new Date();
    fill(box, [
      sectionLabel("今天"),
      ...buildTodayCard(today),
      sectionLabel(`${today.getFullYear()} 年 ${today.getMonth() + 1} 月`),
      buildMonthGrid(today),
    ]);
  },
};

/* ------------------------------------------------------------------ *
 * ② 待办：一行一条，勾了就划掉，能删
 * ------------------------------------------------------------------ */

let todoSeq = 0;

const todoCard = {
  async mount(box) {
    let items = await getTodos();

    // 只重画列表那一块，标题和输入框不动 —— 不然打字打到一半会被刷掉
    const list = el("ul", { className: "todo__list" });

    const save = async () => {
      try {
        await setTodos(items);
      } catch (error) {
        console.error("[NKtab] 待办没存住：", error);
      }
    };

    const redraw = () => {
      list.replaceChildren();
      if (!items.length) {
        list.append(el("li", { className: "card__empty", text: "还没有要做的事" }));
        return;
      }
      for (const item of items) {
        const checkbox = el("input", {
          className: "todo__check",
          attrs: { type: "checkbox", "aria-label": `完成：${item.text}` },
        });
        checkbox.checked = !!item.done;
        checkbox.addEventListener("change", () => {
          item.done = checkbox.checked;
          row.classList.toggle("todo__row--done", item.done);
          save();
        });

        const text = el("span", { className: "todo__text", text: item.text });

        const del = el("button", {
          className: "todo__del",
          text: "✕",
          attrs: { type: "button", "aria-label": `删除：${item.text}`, title: "删除" },
        });
        del.addEventListener("click", () => {
          items = items.filter((it) => it.id !== item.id);
          save();
          redraw();
        });

        const row = el("li", {
          className: item.done ? "todo__row todo__row--done" : "todo__row",
          children: [checkbox, text, del],
        });
        list.append(row);
      }
    };

    const input = el("input", {
      className: "card__input",
      attrs: { type: "text", placeholder: "加一件要做的事，回车", maxlength: "80" },
    });

    const commit = () => {
      const value = input.value.trim();
      if (!value) return;
      items.push({ id: `t${Date.now()}${todoSeq++}`, text: value, done: false });
      input.value = "";
      save();
      redraw();
    };

    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      // 输入法还在选字的时候回车是「确认候选」，不该当成提交
      if (event.isComposing) return;
      event.preventDefault();
      commit();
    });

    redraw();
    fill(box, [sectionLabel("要做的事"), list, input, addButton("＋ 添加", commit)]);
  },
};

/* ------------------------------------------------------------------ *
 * ③ 便签：一块大 textarea，随手写，停下来就存
 * ------------------------------------------------------------------ */

const memoCard = {
  async mount(box) {
    const area = el("textarea", {
      className: "memo__area",
      attrs: { placeholder: "随手记点什么…", spellcheck: "false" },
    });
    area.value = await getMemos();

    let timer = 0;
    const stamp = el("span", { className: "memo__stamp", text: "" });

    const save = async () => {
      try {
        await setMemos(area.value);
        const now = new Date();
        stamp.textContent = `已保存 ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
      } catch (error) {
        stamp.textContent = "没存住";
        console.error("[NKtab] 便签没存住：", error);
      }
    };

    // 打字停下来 400ms 才存，别每敲一个字写一次存储
    area.addEventListener("input", () => {
      clearTimeout(timer);
      stamp.textContent = "…";
      timer = setTimeout(save, 400);
    });

    // 切走卡片 / 关掉页面时，把没落盘的那点补上
    memoCard.flush = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = 0;
      save();
    };

    const clear = el("button", {
      className: "card__mini",
      text: "清空",
      attrs: { type: "button" },
    });
    clear.addEventListener("click", () => {
      if (!area.value || !confirm("便签里的内容全删掉？")) return;
      area.value = "";
      clearTimeout(timer);
      timer = 0;
      save();
    });

    fill(box, [
      el("div", { className: "memo__head", children: [sectionLabel("便签"), clear] }),
      area,
      el("div", { className: "memo__foot", children: [stamp] }),
    ]);
  },

  unmount() {
    // 定时器还没跑就把内容存掉，不然刚打的字会丢
    if (typeof memoCard.flush === "function") memoCard.flush();
  },
};

/* ------------------------------------------------------------------ *
 * ④ 倒计时：离某个日子还有几天
 * ------------------------------------------------------------------ */

/** 从今天到目标那天差几天。两边都按本地零点算，免得被时分秒搅乱。 */
function daysUntil(target) {
  const today = new Date();
  const a = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const b = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((b - a) / 86400000);
}

function countdownPhrase(days) {
  if (days === 0) return "就是今天";
  if (days === 1) return "明天";
  if (days === 2) return "后天";
  if (days < 0) return `已经过了 ${Math.abs(days)} 天`;
  return `还有 ${days} 天`;
}

const countdownCard = {
  async mount(box) {
    let items = await getCountdowns();
    const list = el("ul", { className: "count__list" });

    const save = async () => {
      try {
        await setCountdowns(items);
      } catch (error) {
        console.error("[NKtab] 倒计时没存住：", error);
      }
    };

    const redraw = () => {
      list.replaceChildren();
      if (!items.length) {
        list.append(el("li", { className: "card__empty", text: "还没有要数的日子" }));
        return;
      }
      // 近的排前面，这样一眼看到的就是最要紧的那个
      const sorted = [...items].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      for (const item of sorted) {
        const date = parseDayKey(item.date);
        const days = date ? daysUntil(date) : null;

        const del = el("button", {
          className: "count__del",
          text: "✕",
          attrs: { type: "button", "aria-label": `删除：${item.name}`, title: "删除" },
        });
        del.addEventListener("click", () => {
          items = items.filter((it) => it.id !== item.id);
          save();
          redraw();
        });

        list.append(
          el("li", {
            className: days !== null && days <= 7 ? "count__row count__row--soon" : "count__row",
            children: [
              el("div", {
                className: "count__left",
                children: [
                  el("span", { className: "count__name", text: item.name }),
                  el("span", { className: "count__date", text: item.date || "" }),
                ],
              }),
              el("div", {
                className: "count__right",
                children: [
                  el("span", {
                    className: "count__days",
                    text: days === null ? "？" : String(Math.abs(days)),
                  }),
                  el("span", {
                    className: "count__phrase",
                    text: days === null ? "日期不对" : countdownPhrase(days),
                  }),
                ],
              }),
              del,
            ],
          })
        );
      }
    };

    const name = el("input", {
      className: "card__input",
      attrs: { type: "text", placeholder: "叫什么（比如：春节）", maxlength: "20" },
    });
    const date = el("input", {
      className: "card__input card__input--date",
      attrs: { type: "date" },
    });

    const commit = () => {
      const label = name.value.trim();
      const when = parseDayKey(date.value);
      if (!label || !when) return;
      items.push({ id: `c${Date.now()}${todoSeq++}`, name: label, date: dayKey(when) });
      name.value = "";
      date.value = "";
      save();
      redraw();
    };

    for (const node of [name, date]) {
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.isComposing) commit();
      });
    }

    redraw();
    fill(box, [
      sectionLabel("数着过的日子"),
      list,
      el("div", { className: "count__form", children: [name, date] }),
      addButton("＋ 添加", commit),
    ]);
  },
};

/* ------------------------------------------------------------------ *
 * ⑤ 每日一句：不联网，本地一撮句子，按天轮着来
 * ------------------------------------------------------------------ */

const QUOTES = [
  "慢慢来，比较快。",
  "先把事情做出来，再想怎么做好。",
  "今天能做完的事，别留给明天的自己。",
  "你不必很厉害才开始，但要开始才会厉害。",
  "焦虑多半是因为想得多、做得少。",
  "复杂的事情简单做，简单的事情重复做。",
  "把大目标拆成今天能做完的一小步。",
  "与其抱怨天黑，不如点一盏灯。",
  "专注做一件事，比同时做三件更快。",
  "想清楚再动手，动手后就别回头。",
  "完成比完美更重要。",
  "每天进步 1%，一年后是 37 倍。",
  "把时间花在会积累的事情上。",
  "不懂就问，不会就练。",
  "身体是干活的本钱，先睡够。",
  "别人怎么看你，不归你管。",
  "做对的事，比把事做对更先一步。",
  "心里有数，手上不慌。",
  "今天的难，是明天的顺手。",
  "少一点比较，多一点自己的节奏。",
  "不着急，一件一件来。",
  "把注意力拿回来，它比时间更值钱。",
  "先做最难的，剩下的都轻。",
  "会休息的人才会干活。",
  "同意的事就认真做，不同意就说出来。",
  "犯了错就改，别急着解释。",
  "把话说短，把事做完。",
  "习惯比意志力可靠。",
  "先干五分钟，剩下的自然会来。",
  "慢慢积累，别指望一夜之间。",
];

/**
 * 今天该看第几句。
 *
 * 不按数组下标轮，而是按「从 2020-01-01 起过了多少天」取余 ——
 * 这样同一天打开几次都是同一句，明天自动换下一句，不用存任何东西。
 * 存过的下标只在用户手点「换一句」时才用得上。
 */
function quoteForToday(total) {
  const anchor = new Date(2020, 0, 1);
  const today = new Date();
  const days = Math.floor(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()) - anchor) / 86400000
  );
  return ((days % total) + total) % total;
}

const quoteCard = {
  async mount(box) {
    const total = QUOTES.length;
    const offset = await getQuoteIndex();     // 手点换一句攒下来的偏移
    let index = quoteForToday(total) + (Number(offset) || 0);

    const text = el("p", { className: "quote__text" });
    const dateLine = el("p", { className: "quote__date" });

    const paint = () => {
      text.textContent = QUOTES[((index % total) + total) % total];
      const today = new Date();
      dateLine.textContent = `${today.getFullYear()} 年 ${today.getMonth() + 1} 月 ${today.getDate()} 日 ${DAY_NAMES[today.getDay()]}`;
    };

    const next = el("button", {
      className: "card__mini",
      text: "换一句",
      attrs: { type: "button" },
    });
    next.addEventListener("click", async () => {
      index += 1;
      paint();
      try {
        await setQuoteIndex(Number(offset || 0) + 1);
      } catch (error) {
        console.error("[NKtab] 换一句没记住：", error);
      }
    });

    paint();
    fill(box, [
      el("div", { className: "quote__mark", text: "“" }),
      text,
      el("div", { className: "quote__foot", children: [dateLine, next] }),
    ]);
  },
};

/* ------------------------------------------------------------------ *
 * 交给轮播
 * ------------------------------------------------------------------ */

/** id -> 卡片。newtab.js 按 id 挂上去。 */
export const CARDS = {
  calendar: calendarCard,
  todo: todoCard,
  memo: memoCard,
  countdown: countdownCard,
  quote: quoteCard,
};
