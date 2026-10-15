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
const documentStub = {
  listeners: {},
  documentElement: makeElement("html"),
  body: makeElement("body"),
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
  querySelector: () => null,
  querySelectorAll: () => [],
};

// 面板上真正要用到的那几个，得是真节点，而且窗口要有宽度（算拖动百分比用）
const panelTrack = makeElement("div", "panel-track");
const panelDots = makeElement("div", "panel-dots");
const panelView = makeElement("div", "panel-view");
stubs.set("panel-track", panelTrack);
stubs.set("panel-dots", panelDots);
stubs.set("panel-view", panelView);


const timers = new Set();

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
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  innerWidth: 1440,
  innerHeight: 900,
};
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });

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

// 11. 存着的 id 认不出来时，兜回第一张而不是报错
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
