/**
 * 假DOM.mjs —— 给浏览器专用模块搭一套最小的假 DOM / 假 localStorage。
 *
 * tools\测试侧栏轮播.mjs 和 tools\测试搜索.mjs 都用它；早些时候每个脚本各自内联
 * 过一份，这个文件是把那份抽出来复用：newtab.js import 进来就会自己跑 start()，
 * 所以要在 import **之前**先把 document / window / localStorage 顶掉。
 *
 * 用法：
 *   import { mountFakePage, sleep } from "./假DOM.mjs";
 *   const page = mountFakePage();      // 顶好全局
 *   await import("../newtab.js");
 *   await sleep(60);                   // 等 start() 落定
 *
 * 注意：newtab.js 顶层会自己调 start()。要换一个环境再跑一遍（比如换一份
 * 存储内容），必须 `await import("../newtab.js?again=" + 计数)` 换一个 URL 重新
 * 加载 —— 否则模块命中缓存、start() 不会再跑，而旧那一份的节点也已经不在了。
 * 这就是下面 moduleCounter 的用途。
 */

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let moduleCounter = 0;

/** 换一个 URL 重新加载 newtab.js，让它整个再跑一遍 start()。 */
export function reloadNewtab() {
  moduleCounter += 1;
  return import(`../newtab.js?again=${moduleCounter}`);
}

function makeClassList() {
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
    all: () => [...set],
  };
}

export function makeElement(tag = "div", id = "") {
  const node = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    id,
    parentNode: null,
    children: [],
    listeners: {},
    dataset: {},
    classList: makeClassList(),
    style: { setProperty() {}, removeProperty() {} },
    textContent: "",
    innerHTML: "",
    value: "",
    hidden: false,
    focused: false,
    type: "",
    // 侧栏轮播会读这个
    clientWidth: 248,
    clientHeight: 320,
    append(...nodes) {
      for (const child of nodes) {
        if (child == null) continue;
        if (child.tagName === "#FRAGMENT") {
          // DocumentFragment：塞进来的时候要把孩子摊平
          node.append(...(child.children || []));
          continue;
        }
        child.parentNode = node;
        node.children.push(child);
      }
    },
    appendChild(child) {
      node.append(child);
      return child;
    },
    remove() {},
    replaceChildren(...nodes) {
      node.children = [];
      node.append(...nodes);
    },
    insertBefore(child) {
      node.append(child);
      return child;
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
    focus() {
      // 真浏览器里 focus() 会派发一个 focus 事件，页面靠它弹面板 / 让守卫位失效，
      // 所以这里也得派发，不然测试里的状态机会比真环境停早一步。
      node.focused = true;
      globalThis.__focused = node;
      if (globalThis.document) globalThis.document.activeElement = node;
      node.fire("focus", {});
    },
    blur() {
      node.focused = false;
      node.fire("blur", {});
    },
    // 色块那套字宽自适应会量尺寸；假环境给个稳定值就行
    getBoundingClientRect() {
      return { width: 60, height: 18, top: 0, left: 0, right: 60, bottom: 18 };
    },
    /** 自己 + 所有后代里第一个满足条件的 */
    find(test) {
      if (test(node)) return node;
      for (const child of node.children) {
        if (!child || child.nodeType !== 1) continue;
        const hit = child.find(test);
        if (hit) return hit;
      }
      return null;
    },
    flatten(out = []) {
      out.push(node);
      for (const child of node.children) {
        if (child && child.nodeType === 1) child.flatten(out);
      }
      return out;
    },
    matches(selector) {
      if (selector.startsWith(".")) return node.classes().has(selector.slice(1));
      if (selector.startsWith("#")) return node.id === selector.slice(1);
      return false;
    },
    closest(selector) {
      let cur = node;
      while (cur) {
        if (cur.matches && cur.matches(selector)) return cur;
        cur = cur.parentNode;
      }
      return null;
    },
    contains(target) {
      return target == null ? false : node.flatten().includes(target);
    },
    querySelector(selector) {
      return node.find((el) => el.matches(selector));
    },
    querySelectorAll(selector) {
      return node.flatten().filter((el) => el !== node && el.matches(selector));
    },
    classes() {
      const named = String(node.className || "").split(/\s+/).filter(Boolean);
      return new Set([...named, ...node.classList.all()]);
    },
    /** 事件往上冒到 document；返回有没有被 preventDefault 拦下 */
    fire(type, event = {}) {
      const ev = {
        type,
        target: node,
        defaultPrevented: false,
        preventDefault() {
          ev.defaultPrevented = true;
        },
        stopPropagation() {},
        ...event,
      };
      let cur = node;
      while (cur) {
        for (const fn of cur.listeners[type] || []) fn(ev);
        cur = cur.parentNode;
      }
      for (const fn of (globalThis.document.listeners[type] || [])) fn(ev);
      return ev.defaultPrevented;
    },
    click() {
      return node.fire("click", {});
    },
  };
  // 点搜索记录里的一条会调 form.requestSubmit()，当提交处理一遍
  if (String(tag).toLowerCase() === "form") {
    node.requestSubmit = () => node.fire("submit", {});
  }
  node.className = "";
  return node;
}

/** 把整个页面环境顶好：document / window / localStorage / rAF 全套。 */
export function mountFakePage() {
  const documentStub = { listeners: {}, activeElement: null };
  documentStub.addEventListener = (type, fn) => {
    (documentStub.listeners[type] ||= []).push(fn);
  };
  documentStub.removeEventListener = () => {};

  const stubs = new Map();
  documentStub.getElementById = (id) => {
    if (!stubs.has(id)) stubs.set(id, makeElement("div", id));
    return stubs.get(id);
  };
  documentStub.createElement = (tag) => makeElement(tag);
  documentStub.createDocumentFragment = () => makeElement("#fragment");
  documentStub.createTextNode = (text) => ({ nodeType: 3, textContent: text });

  // 按 class 找：newtab.js 里 document.querySelector(".panel") 要拿到整个右侧栏
  // （自动翻页往它身上挂 mouseenter / mouseleave）
  const byClass = new Map();
  documentStub.querySelector = (selector) =>
    selector.startsWith(".") ? byClass.get(selector.slice(1)) || null : null;
  documentStub.querySelectorAll = () => [];

  // newtab.js 一开始就会找这几块并挂监听，先造出来
  for (const [id, tag] of [
    ["history", "div"],
    ["history-list", "ul"],
    ["history-clear", "button"],
    ["search-input", "input"],
    ["search-form", "form"],
  ]) {
    stubs.set(id, makeElement(tag, id));
  }

  byClass.set("panel", makeElement("aside", "panel"));

  globalThis.document = documentStub;
  globalThis.__focused = null;

  // 假 localStorage：storage.js 在没有 chrome.storage 时退回这里，
  // 存的是 JSON.stringify 过的值（跟 Chrome 的 storage 一样）
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };

  globalThis.window = {
    open: () => ({}),
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    setInterval: () => 1,
    clearInterval() {},
    // 只记账不真排期：真排了的话，一个三分钟的定时器会让 Node 一直不退出
    setTimeout: (fn, ms) => ({ fn, ms }),
    clearTimeout() {},
    innerWidth: 1440,
    innerHeight: 900,
  };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.matchMedia = globalThis.window.matchMedia;
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });

  return { documentStub, stubs, store };
}
