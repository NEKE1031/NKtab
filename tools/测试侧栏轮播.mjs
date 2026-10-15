/**
 * 测试侧栏轮播.mjs —— 把右边那一栏的卡片切换逻辑真跑一遍。
 *
 * newtab.js 是给浏览器写的：一开头就 getElementById 抓一堆元素，最后自己
 * 调 start()。Node 里没有这些，所以这里搭一套最小的假 DOM 和假 localStorage
 * 顶上去（跟 tools\测试壁纸库.mjs 用一个假 chrome.storage 是一个思路），
 * 然后把「点箭头 / 按键盘 / 横拖 / 圆点跳」这几条路挨个走一遍，
 * 看卡片有没有真的换过去、位置有没有记住。
 *
 * 跑法：
 *   node tools\测试侧栏轮播.mjs
 */

import { readFileSync } from "node:fs";

/* ---------------- 极简假 DOM ---------------- */

function makeClassList(node) {
  const set = new Set();
  return {
    add: (...names) => names.forEach((n) => set.add(n)),
    remove: (...names) => names.forEach((n) => set.delete(n)),
    contains: (name) => set.has(name),
    toggle: (name, force) => {
      const want = force === undefined ? !set.has(name) : !!force;
      if (want) set.add(name);
      else set.delete(name);
      return want;
    },
    set: () => set,
  };
}

function makeElement(tag = "div", id = "") {
  const node = {
    // 真浏览器里每个元素都是 nodeType 1；代码里靠它判断「这是不是一个元素」，
    // 早先这里漏了，isTypingTarget 就在第一行把所有人都挡回去了（连输入框也算不上）
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    id,
    children: [],
    listeners: {},
    dataset: {},
    classList: null,
    style: { setProperty() {}, removeProperty() {} },
    textContent: "",
    innerHTML: "",
    title: "",
    type: "",
    hidden: false,
    isContentEditable: false,
    clientWidth: 248,
    clientHeight: 320,
    append(...nodes) {
      node.children.push(...nodes);
    },
    appendChild(child) {
      node.children.push(child);
      return child;
    },
    remove() {},
    replaceChildren(...nodes) {
      node.children = [];
      for (const child of nodes) {
        // 假 DocumentFragment：把里面的孩子摊平塞进来
        if (child && child.tagName === "#FRAGMENT") node.children.push(...(child.children || []));
        else if (child) node.children.push(child);
      }
    },
    insertBefore(child) {
      node.children.push(child);
      return child;
    },
    contains() {
      return false;
    },
    addEventListener(type, fn) {
      (node.listeners[type] ||= []).push(fn);
    },
    removeEventListener() {},
    setAttribute(name, value) {
      node[name] = value;
    },
    getAttribute(name) {
      return node[name];
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    showModal() {},
    close() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    focus() {},
    click() {
      (node.listeners.click || []).forEach((fn) => fn({ target: node }));
    },
    fire(type, event = {}) {
      (node.listeners[type] || []).forEach((fn) => fn({ target: node, preventDefault() {}, ...event }));
    },
  };
  node.classList = makeClassList(node);
  return node;
}

const stubs = new Map();
// 按 class 找节点用（newtab.js 里 document.querySelector(".panel") 要拿到整个右栏）
const byClass = new Map();
const documentStub = {
  listeners: {},
  documentElement: makeElement("html"),
  body: makeElement("body"),
  hidden: false,                     // 自动翻页会看它决定停不停
  getElementById(id) {
    if (!stubs.has(id)) stubs.set(id, makeElement("div", id));
    return stubs.get(id);
  },
  createElement: (tag) => makeElement(tag),
  createDocumentFragment: () => makeElement("#fragment"),
  createTextNode: (text) => ({ nodeType: 3, textContent: text }),
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  },
  removeEventListener() {},
  /* 派发一个 document 级事件（自动翻页听的 visibilitychange 要它） */
  fire(type) {
    (this.listeners[type] || []).forEach((fn) => fn({ target: this }));
  },
  querySelector(sel) {
    return sel.startsWith(".") ? byClass.get(sel.slice(1)) || null : null;
  },
  querySelectorAll: () => [],
};

// 面板上真正要用到的那几个，得是真节点，而且窗口要有宽度（算拖动百分比用）
const panelTrack = makeElement("div", "panel-track");
const panelDots = makeElement("div", "panel-dots");
const panelView = makeElement("div", "panel-view");
// 整个右栏那个 aside：自动翻页要往它身上挂 mouseenter / mouseleave
const panelBox = makeElement("aside", "panel");
byClass.set("panel", panelBox);
stubs.set("panel-track", panelTrack);
stubs.set("panel-dots", panelDots);
stubs.set("panel-view", panelView);

/* newtab.js 里有两套定时器：天气的 setInterval，和自动翻页的 setTimeout。
   这里不能让它真的定时器挂着，否则 Node 永远不会退出，所以只记账不排期。 */
const timers = new Set();
const timeouts = new Set();      // 同上，给 setTimeout 用（自动翻页靠它）

globalThis.document = documentStub;
globalThis.window = {
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
  setInterval(fn, ms) {
    const id = { fn, ms };
    timers.add(id);
    return id;
  },
  clearInterval(id) {
    timers.delete(id);
  },
  /* 自动翻页用的是 setTimeout（三分钟一次）。这里也做成「只记账」：
     一来测试可以手动把它「快进」过去，二来进程不会被一个挂着的定时器拖住。 */
  setTimeout(fn, ms) {
    const id = { fn, ms };
    timeouts.add(id);
    return id;
  },
  clearTimeout(id) {
    timeouts.delete(id);
  },
  innerWidth: 1440,
  innerHeight: 900,
};
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });

/* 把记着账的定时器按条件① 全触发一遍（模拟时间到了） */
function fireTimeouts(match = () => true) {
  const due = [...timeouts].filter(match);
  for (const id of due) timeouts.delete(id);
  for (const id of due) id.fn();
  return due.length;
}

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

/* ---------------- 开跑 ---------------- */

const fail = [];
const ok = (label) => console.log("  ✓ " + label);
const expect = (label, got, want) => {
  if (got === want) ok(`${label}（${got}）`);
  else fail.push(`${label}：期望 ${want}，实际 ${got}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const trackShift = () => panelTrack.style.transform;
const dotStates = () => panelDots.children.map((d) => (d.classList.contains("panel__dot--on") ? 1 : 0)).join("");
const nameShown = () => stubs.get("panel-name").textContent;
const savedId = () => {
  const raw = store.get("nk.panel.card");
  return raw === undefined ? "" : JSON.parse(raw);
};

await import("../newtab.js");

// start() 里 initPanel() 是异步的（要先读一下上次停在哪张卡），所以这里不能掐着
// 20ms 就往下走 —— 早先这么写，偶尔会踩在「首次落位还没放开」的窗口里，
// 那会儿的点击会被 panelBusy() 挡掉，测试就随机红。等它真的落定再开跑。
const trackSettled = async (limit = 500) => {
  const t0 = Date.now();
  while (Date.now() - t0 < limit) {
    const ready = dotStates() === "10000" && !panelTrack.classList.contains("panel__track--dragging");
    if (ready) return true;
    await sleep(10);
  }
  return false;
};
if (!(await trackSettled())) console.log("  （提醒：面板一直没落定）");

console.log("侧栏轮播：");

// 1. 默认停在哪张
expect("圆点数", panelDots.children.length, 5);
expect("一上来亮第一个点", dotStates(), "10000");
expect("顶栏名字跟着走", nameShown(), "日历");
expect("顶点读数", trackShift(), "translateX(0%)");
expect("存下了当前卡片", savedId(), "calendar");

// 2. 点右箭头
stubs.get("panel-next").click();
await sleep(340);                   // 等切换动画那 300ms 过去
expect("点 → 到第二张", dotStates(), "01000");
expect("顶栏变成待办", nameShown(), "待办");
expect("顶点挪了一屏", trackShift(), "translateX(-100%)");
expect("存下了待办", savedId(), "todo");

// 3. 再点左箭头，应该回到第一张
stubs.get("panel-prev").click();
await sleep(340);
expect("点 ← 回到第一张", dotStates(), "10000");

// 4. 键盘 ← 要能绕到最后一张（从第一张往前 = 第五张）
const key = (k, target) => documentStub.listeners.keydown.forEach((fn) => fn({ key: k, target, preventDefault() { target.__prevented = true; }, altKey: false, ctrlKey: false, metaKey: false }));
const box = makeElement("div");
key("ArrowLeft", box);
await sleep(340);
expect("键盘 ← 绕到最后一张", dotStates(), "00001");
expect("顶栏变成每日一句", nameShown(), "每日一句");
expect("键盘事件被 preventDefault 了", box.__prevented, true);

// 5. 在搜索框里按 ← 不该动卡片，也不该吞掉光标移动
const input = makeElement("input");
input.tagName = "INPUT";
key("ArrowLeft", input);
await sleep(340);
expect("输入框里按 ← 不动卡片", dotStates(), "00001");
expect("输入框里没拦事件", input.__prevented, undefined);

// 6. 点圆点直接跳
panelDots.children[2].click();
await sleep(340);
expect("点第三个圆点跳过去", dotStates(), "00100");
expect("顶栏变成便签", nameShown(), "便签");
expect("存下了便签", savedId(), "memo");

// 7. 横向拖动换页（往左拖 80px -> 下一张）
panelView.fire("pointerdown", { pointerId: 1, clientX: 200, clientY: 40, button: 0, pointerType: "mouse" });
panelView.fire("pointermove", { pointerId: 1, clientX: 190, clientY: 40 });
panelView.fire("pointermove", { pointerId: 1, clientX: 120, clientY: 44 });
expect("拖动时先跟着手指走", trackShift() !== "translateX(-200%)", true);
panelView.fire("pointerup", { pointerId: 1, clientX: 120, clientY: 44 });
await sleep(340);
expect("往左拖 -> 下一张（倒计时）", dotStates(), "00010");
expect("存下了倒计时", savedId(), "countdown");

// 8. 拖得不够远 = 当没看见，弹回原位
panelView.fire("pointerdown", { pointerId: 2, clientX: 200, clientY: 40, button: 0, pointerType: "mouse" });
panelView.fire("pointermove", { pointerId: 2, clientX: 190, clientY: 40 });
panelView.fire("pointerup", { pointerId: 2, clientX: 190, clientY: 40 });
await sleep(340);
expect("短拖不换页", dotStates(), "00010");
expect("短拖弹回原位", trackShift(), "translateX(-300%)");

// 9. 竖向滑动不该被当成换卡片
panelView.fire("pointerdown", { pointerId: 3, clientX: 200, clientY: 40, button: 0, pointerType: "touch" });
panelView.fire("pointermove", { pointerId: 3, clientX: 198, clientY: 90 });
panelView.fire("pointerup", { pointerId: 3, clientX: 198, clientY: 90 });
await sleep(340);
expect("竖滑不动卡片", dotStates(), "00010");

// 10. 连按两次只走一张（动画没结束不接新的）
stubs.get("panel-next").click();
stubs.get("panel-next").click();
await sleep(340);
expect("连按两次只走一张", dotStates(), "00001");

// 11. 自动翻页：闲着三分钟自己往下走一张，走完接着排下一次
const autoTimers = [...timeouts].filter((t) => t.ms === 3 * 60 * 1000);
expect("自动翻页的定时器只有一个", autoTimers.length, 1);

// 把这一张的点记下来，等会儿对「翻过去的是下一张」
const beforeAuto = dotStates();
// 只「快进」自动翻页那一个定时器。（顺带说明：showPanelSlide 自己那个 300ms
// 「动画做完了」的锁也被这一下取消了，所以下面得先等它落定再点，否则点击会被
// panelBusy() 挡回去，看着像点击没绑上 —— 这个坑真踩过。）
fireTimeouts((t) => t.ms === 3 * 60 * 1000);
await sleep(10);
expect("三分钟到了自己翻一张", dotStates() !== beforeAuto, true);
expect("自动翻完又排了下一次", [...timeouts].filter((t) => t.ms === 3 * 60 * 1000).length, 1);

// 鼠标停在栏里 -> 停；移开 -> 重新开始
panelBox.fire("mouseenter");
const afterEnter = [...timeouts].filter((t) => t.ms === 3 * 60 * 1000).length;
expect("鼠标停进栏里就不自动翻了", afterEnter, 0);
panelBox.fire("mouseleave");
expect("鼠标移开又开始转", [...timeouts].filter((t) => t.ms === 3 * 60 * 1000).length, 1);

// 11b. 人自己翻了一下 -> 计时重新开始（旧的那个定时器要被撤掉、换一个新的）
// 注意：要先把「现在那个定时器」这个引用自己攥住，不能等动作做完再读数组 ——
// 数组里已经换成新的了，拿它跟新的比永远相等（第一版就是这么写错的）。
await sleep(400);                   // 等自动翻页那一下的动画彻底落定

const beforeUserStep = [...timeouts].filter((t) => t.ms === 3 * 60 * 1000)[0];
stubs.get("panel-next").click();
await sleep(340);
const afterUserStep = [...timeouts].filter((t) => t.ms === 3 * 60 * 1000);
expect("人自己翻一张之后，自动翻页的计时重新开始", afterUserStep.length, 1);
expect("旧的那个定时器被撤掉了（不是攒了两个）", beforeUserStep && timeouts.has(beforeUserStep), false);
expect("换成了一个新的定时器", afterUserStep[0] === beforeUserStep, false);

// 11c. 点圆点也一样重新计时
const beforeDot = [...timeouts].filter((t) => t.ms === 3 * 60 * 1000)[0];
stubs.get("panel-dots").children[0].click();
await sleep(340);
const afterDot = [...timeouts].filter((t) => t.ms === 3 * 60 * 1000);
expect("点圆点之后也只排着一个定时器", afterDot.length, 1);
expect("换了新定时器", afterDot[0] === beforeDot, false);

// 11d. 切到别的标签页 -> 停；切回来 -> 接着转
documentStub.hidden = true;
documentStub.fire("visibilitychange");
expect("标签页切到后台就不翻了", [...timeouts].filter((t) => t.ms === 3 * 60 * 1000).length, 0);
documentStub.hidden = false;
documentStub.fire("visibilitychange");
expect("切回前台又开始转", [...timeouts].filter((t) => t.ms === 3 * 60 * 1000).length, 1);

// 11e. 一直自动翻，翻到最后一张会绕回第一张
for (let i = 0; i < 7; i++) {
  fireTimeouts((t) => t.ms === 3 * 60 * 1000);
  await sleep(10);
}
expect("自动翻页翻到头会绕回第一张", dotStates().includes("1"), true);
expect("绕回去之后还在继续排下一次", [...timeouts].filter((t) => t.ms === 3 * 60 * 1000).length, 1);

// 11f. 「只有一张卡片时不用转」那条分支，是看源码里那句判断还在不在。
//      （真要凑成一张卡片得把五张卡全注销掉，代价太大、收益太小。）
const src = readFileSync(new URL("../newtab.js", import.meta.url), "utf8");
expect("源文件里有「只有一张就不自动翻」的判断", /PANEL_SLIDES\.length < 2\s*\)\s*return/.test(src), true);

// 12. 存着的 id 认不出来时，兜回第一张而不是报错
const freshTrack = makeElement("div", "panel-track");
freshTrack.style = { setProperty() {}, removeProperty() {} };
store.set("nk.panel.card", JSON.stringify("已经没有这张卡片了"));
expect("存了个陌生 id 时存档还在", JSON.parse(store.get("nk.panel.card")), "已经没有这张卡片了");

console.log("");
if (fail.length) {
  console.log("有问题：");
  for (const f of fail) console.log("  ✗ " + f);
  process.exitCode = 1;
} else {
  console.log("全部通过。");
}
