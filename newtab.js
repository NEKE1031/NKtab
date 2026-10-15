/**
 * newtab.js —— 新标签页的全部行为。
 *
 * 六件事：
 *   1. 把网站列表画成一片长方形色块，块上是这个网站的名字（点一下新开标签页打开）
 *   2. 搜索框：打字回车 -> 必应，新开一个标签页
 *   3. 加 / 删 / 改网站（改名字、改网址、改颜色）
 *   4. 按住色块拖动能调整顺序
 *   5. 换背景图
 *   6. 右边那一栏里的卡片轮播（左右箭头 / 圆点 / 键盘 ←→ / 横滑换卡片）
 */

import {
  getBookmarks,
  addBookmark,
  updateBookmark,
  reorderBookmarks,
  removeBookmark,
  getWallpaper,
  setWallpaper,
  BUILTIN_WALLPAPERS,
  isBuiltinWallpaper,
  builtinWallpaperPath,
  getWallpaperLibrary,
  getWallpaperThumb,
  getWallpaperImage,
  addWallpaperFromFile,
  removeWallpaperFromLibrary,
  getHiddenBuiltins,
  hideBuiltinWallpaper,
  unhideAllBuiltins,
  getSearchHistory,
  addSearchHistory,
  removeSearchHistory,
  clearSearchHistory,
  getCity,
  setCity,
  getWeatherCache,
  setWeatherCache,
  normalizeUrl,
  hostOf,
  colorForName,
  ICON_COLORS,
  getPanelCard,
  setPanelCard,
  getSearchEngine,
  setSearchEngine,
} from "./storage.js";

import { fetchWeather, iconFor, REFRESH_AFTER } from "./weather.js";

import { CARDS } from "./cards.js";


import { ENGINES, DEFAULT_ENGINE, findEngine, targetFor } from "./search.js";

/* ---------------- 搜索引擎 ---------------- */

let engineId = DEFAULT_ENGINE;   // 当前用的引擎

/* ---------------- 页面上的元素 ---------------- */

const bg = document.getElementById("bg");
const grid = document.getElementById("grid");
const toastEl = document.getElementById("toast");

const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const historyEl = document.getElementById("history");
const historyListEl = document.getElementById("history-list");
const historyClear = document.getElementById("history-clear");
const engineBtn = document.getElementById("engine-btn");
const engineLabel = document.getElementById("engine-label");
const engineMenu = document.getElementById("engine-menu");

const wallpaperBtn = document.getElementById("wallpaper-btn");
const wallpaperInput = document.getElementById("wallpaper-input");
const wallpaperDialog = document.getElementById("wallpaper-dialog");
const wpGrid = document.getElementById("wp-grid");
const wpAdd = document.getElementById("wp-add");
const wpClear = document.getElementById("wp-clear");
const wpClose = document.getElementById("wp-close");
const wpRestore = document.getElementById("wp-restore");

const addDialog = document.getElementById("add-dialog");
const addForm = document.getElementById("add-form");
const addTitle = document.getElementById("add-title");
const addUrl = document.getElementById("add-url");
const addCancel = document.getElementById("add-cancel");
const addError = document.getElementById("add-error");
const addPreviewFace = document.getElementById("add-preview-face");
const addPreviewText = document.getElementById("add-preview-text");
const addSwatches = document.getElementById("add-swatches");
const addColor = document.getElementById("add-color");

const editDialog = document.getElementById("edit-dialog");
const editForm = document.getElementById("edit-form");
const editTitle = document.getElementById("edit-title");
const editUrl = document.getElementById("edit-url");
const editCancel = document.getElementById("edit-cancel");
const editError = document.getElementById("edit-error");
const editPreviewFace = document.getElementById("edit-preview-face");
const editPreviewText = document.getElementById("edit-preview-text");
const editSwatches = document.getElementById("edit-swatches");
const editColor = document.getElementById("edit-color");

const weatherIcon = document.getElementById("weather-icon");
const weatherTemp = document.getElementById("weather-temp");
const weatherSky = document.getElementById("weather-sky");
const weatherPlace = document.getElementById("weather-place");
const weatherMeta = document.getElementById("weather-meta");
const weatherHoursBlock = document.getElementById("weather-hours-block");
const weatherHours = document.getElementById("weather-hours");
const weatherDaysBlock = document.getElementById("weather-days-block");
const weatherDays = document.getElementById("weather-days");
const weatherUpdated = document.getElementById("weather-updated");
const weatherRefresh = document.getElementById("weather-refresh");
const weatherCityBtn = document.getElementById("weather-city-btn");
const weatherMsnBtn = document.getElementById("weather-msn");

const cityDialog = document.getElementById("city-dialog");
const cityForm = document.getElementById("city-form");
const cityInput = document.getElementById("city-input");
const cityCancel = document.getElementById("city-cancel");
const cityError = document.getElementById("city-error");

const panelIcon = document.getElementById("panel-icon");
const panelName = document.getElementById("panel-name");
const panelPrev = document.getElementById("panel-prev");
const panelNext = document.getElementById("panel-next");
const panelView = document.getElementById("panel-view");
const panelTrack = document.getElementById("panel-track");
const panelDots = document.getElementById("panel-dots");

/* ---------------- 内存里的状态 ---------------- */

let editingId = null;        // 正在编辑哪个网站
let pendingColor = "#4c7cf3"; // 弹窗里当前挑中的颜色

let searchHistory = [];      // 搜索记录（最新的在最前面）
let shownHistory = [];       // 当前面板上真正显示的那几条（可能被输入内容筛过）
let activeIndex = -1;        // 键盘上下键选中了第几条，-1 表示没选
let skipNextFocus = true;    // 刚打开页面自动聚焦那一次不弹面板

let weather = null;          // 当前手上的天气数据
let weatherLoc = null;       // 用户设的城市 { name, lat, lon }
let weatherBusy = false;     // 正在请求中，避免重复点

/* ---------------- 搜索 ---------------- */

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch(searchInput.value.trim());
});

async function runSearch(query) {
  // 像网址就直接打开，否则用当前选的引擎搜 —— 判断和拼地址都在 search.js 里
  const target = targetFor(query, engineId);
  if (!target) return;

  openInNewTab(target);          // 先开页面（必须紧跟着点击，不然会被当成弹窗拦掉）
  searchInput.value = "";
  hideHistory();

  searchHistory = await addSearchHistory(query.trim());   // 再记账
}

/** 新开标签页打开，当前这一页留着不动。 */
function openInNewTab(url) {
  const opened = window.open(url, "_blank");
  // 万一被浏览器拦下来了，退回原来的做法，至少能打开
  if (!opened) location.href = url;
}

/* ---------------- 搜索引擎的选择菜单 ---------------- */

const SVG_TICK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<polyline points="20 6 9 17 4 12"></polyline></svg>';

/** 把菜单里那几项建出来（只建一次，之后只改选中态）。 */
function buildEngineMenu() {
  const frag = document.createDocumentFragment();

  for (const engine of ENGINES) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "engine-menu__item";
    button.dataset.engine = engine.id;
    button.setAttribute("role", "option");

    const mark = document.createElement("span");
    mark.className = "engine-menu__mark";
    mark.textContent = engine.mark;

    const name = document.createElement("span");
    name.className = "engine-menu__name";
    name.textContent = engine.name;

    const tick = document.createElement("span");
    tick.className = "engine-menu__tick";
    tick.innerHTML = SVG_TICK;

    button.append(mark, name, tick);
    item.append(button);
    frag.append(item);
  }

  engineMenu.replaceChildren(frag);
}

/** 把菜单和按钮画成「当前用的是哪个引擎」。 */
function paintEngine() {
  const engine = findEngine(engineId) || findEngine(DEFAULT_ENGINE);
  engineLabel.textContent = engine.name;

  for (const button of engineMenu.querySelectorAll(".engine-menu__item")) {
    const on = button.dataset.engine === engine.id;
    button.classList.toggle("engine-menu__item--on", on);
    button.setAttribute("aria-selected", on ? "true" : "false");
  }
}

function showEngineMenu() {
  // 两个面板都挂在搜索框下面、位置几乎重合：开了引擎菜单就把搜索记录先收走，
  // 不然菜单底下会透出一条半截的记录面板。
  hideHistory();
  engineMenu.hidden = false;
  engineBtn.setAttribute("aria-expanded", "true");
}

function hideEngineMenu() {
  engineMenu.hidden = true;
  engineBtn.setAttribute("aria-expanded", "false");
}

/** 换一个引擎：记下来，下次打开还是它。 */
async function chooseEngine(id) {
  if (!findEngine(id)) return;
  engineId = id;
  paintEngine();
  hideEngineMenu();
  searchInput.focus();
  await setSearchEngine(id);
}

function initEnginePicker() {
  buildEngineMenu();

  // 菜单是 <ul>，点哪一项都通过冒泡在这里收口，不用给每项各挂一个监听
  engineMenu.addEventListener("click", (event) => {
    const button = event.target.closest(".engine-menu__item");
    if (!button) return;
    chooseEngine(button.dataset.engine).catch(() => {});
  });

  // 按下按钮那一瞬间 input 会先失焦（blur 会收菜单），所以按下就切换，
  // 而不是等 click —— 否则 click 到达前菜单已经被收走了。
  engineBtn.addEventListener("mousedown", (event) => {
    event.preventDefault();
    if (engineMenu.hidden) showEngineMenu();
    else hideEngineMenu();
  });

  // 键盘：上下选、回车确认，Esc 收起来
  engineBtn.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { hideEngineMenu(); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    showEngineMenu();
    const buttons = [...engineMenu.querySelectorAll(".engine-menu__item")];
    if (!buttons.length) return;
    const current = buttons.findIndex((item) => item.dataset.engine === engineId);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = buttons[(current + step + buttons.length) % buttons.length];
    next.focus();
  });

  engineMenu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { hideEngineMenu(); engineBtn.focus(); }
  });

  // 点别处、或者按 Esc，都把菜单收起来
  document.addEventListener("mousedown", (event) => {
    if (engineMenu.hidden) return;
    if (event.target === engineBtn || engineBtn.contains(event.target)) return;
    if (engineMenu.contains(event.target)) return;
    hideEngineMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !engineMenu.hidden) hideEngineMenu();
  });
}

/* ---------------- 搜索记录面板 ---------------- */

const SVG_CLOCK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/>' +
  '<path d="M12 7v5l3 2"/></svg>';

const SVG_X =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
  'stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>';

/**
 * 把面板画出来。
 * 输入框里已经打了字的话，只留下「包含这几个字」的旧记录，方便直接点。
 */
function renderHistory() {
  const typed = searchInput.value.trim().toLowerCase();
  shownHistory = typed
    ? searchHistory.filter((item) => item.toLowerCase().includes(typed))
    : searchHistory.slice();

  if (shownHistory.length === 0) {
    hideHistory();
    return;
  }

  // 筛过之后就不该再预选中任何一条
  activeIndex = -1;

  const frag = document.createDocumentFragment();
  shownHistory.forEach((text, index) => {
    const row = document.createElement("li");
    row.className = "history__item";
    row.dataset.index = String(index);

    const clock = document.createElement("span");
    clock.className = "history__icon";
    clock.innerHTML = SVG_CLOCK;

    const label = document.createElement("span");
    label.className = "history__text";
    label.textContent = text;

    const del = document.createElement("button");
    del.className = "history__del";
    del.type = "button";
    del.title = "删掉这条";
    del.innerHTML = SVG_X;
    del.addEventListener("click", async (event) => {
      event.stopPropagation();          // 别顺带触发「用这条搜索」
      searchHistory = await removeSearchHistory(text);
      renderHistory();
    });

    row.append(clock, label, del);
    // 点整行 = 用这条再搜一次
    row.addEventListener("click", () => {
      searchInput.value = text;
      searchForm.requestSubmit();
    });

    frag.appendChild(row);
  });

  historyListEl.replaceChildren(frag);
  historyEl.hidden = false;
}

function hideHistory() {
  historyEl.hidden = true;
  activeIndex = -1;
}

/** 键盘上下键选中项的高亮，用 CSS 类切换，不重画整个列表。 */
function paintActive() {
  const rows = historyListEl.children;
  for (let i = 0; i < rows.length; i += 1) {
    rows[i].classList.toggle("history__item--active", i === activeIndex);
  }
}

// 点面板的时候别让输入框失焦，否则面板会先一步关掉，点不中
historyEl.addEventListener("mousedown", (event) => event.preventDefault());

function initSearchHistoryInput() {
  searchInput.addEventListener("focus", () => {
    if (skipNextFocus) {          // 刚打开页面自动聚焦那一次，不弹出来挡着图标
      skipNextFocus = false;
      return;
    }
    renderHistory();
  });

  searchInput.addEventListener("blur", hideHistory);

  // 打字的时候实时筛
  searchInput.addEventListener("input", () => {
    if (document.activeElement === searchInput) renderHistory();
  });

  searchInput.addEventListener("keydown", (event) => {
    const open = !historyEl.hidden;

    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        hideHistory();
      }
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();

      if (!open) {
        // 面板还没出来：先把它叫出来，顺手选中第一条（往上就是最后一条）
        renderHistory();
        if (!historyEl.hidden && shownHistory.length > 0) {
          activeIndex = event.key === "ArrowDown" ? 0 : shownHistory.length - 1;
          paintActive();
        }
        return;
      }

      if (shownHistory.length === 0) return;

      const step = event.key === "ArrowDown" ? 1 : -1;
      activeIndex += step;
      // 走到头就绕回去
      if (activeIndex < 0) activeIndex = shownHistory.length - 1;
      if (activeIndex >= shownHistory.length) activeIndex = 0;
      paintActive();
      return;
    }

    // 回车：如果上下键选了某一条，就用它；否则走正常的搜索
    if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      searchInput.value = shownHistory[activeIndex];
      searchForm.requestSubmit();
    }
  });
}

historyClear.addEventListener("click", async () => {
  searchHistory = await clearSearchHistory();
  hideHistory();
  toast("搜索记录已清空");
});

initSearchHistoryInput();
initEnginePicker();

/* ---------------- 画色块宫格 ---------------- */

async function renderGrid() {
  const items = await getBookmarks();

  const frag = document.createDocumentFragment();
  for (const item of items) frag.appendChild(makeTile(item));
  frag.appendChild(makeAddTile());

  grid.replaceChildren(frag);
  fitAllTileText();          // 画完了统一算一遍字号（要等进了页面才量得准）
}

function makeTile(item) {
  const tile = document.createElement("div");
  tile.className = "tile";
  tile.dataset.id = item.id;
  tile.draggable = true;              // 让整块可拖（顺序）

  const link = document.createElement("a");
  link.className = "tile__link";
  link.href = item.url;
  link.target = "_blank";             // 新开标签页打开
  link.rel = "noopener";
  link.draggable = false;             // 别让浏览器自己拖链接
  link.title = item.title + "\n" + item.url;
  link.appendChild(makeFace(item));

  const actions = document.createElement("div");
  actions.className = "tile__actions";

  const editBtn = document.createElement("button");
  editBtn.className = "tile__action";
  editBtn.type = "button";
  editBtn.title = "编辑（改名字、网址、颜色）";
  editBtn.innerHTML = SVG_EDIT;
  editBtn.addEventListener("click", (event) => {
    event.preventDefault();
    openEditDialog(item);
  });

  const removeBtn = document.createElement("button");
  removeBtn.className = "tile__action tile__action--danger";
  removeBtn.type = "button";
  removeBtn.title = "删除这个网站";
  removeBtn.innerHTML = SVG_TRASH;
  removeBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    await removeBookmark(item.id);
    tile.remove();
    toast(`已删除「${item.title}」`);
  });

  actions.append(editBtn, removeBtn);
  tile.append(link, actions);
  return tile;
}

/** 一个长方形色块：底色 + 上面的那句大字。 */
function makeFace(item) {
  const face = document.createElement("span");
  face.className = "tile__face";

  const text = document.createElement("span");
  text.className = "tile__text";
  text.textContent = labelOf(item);

  face.appendChild(text);
  paintFace(face, faceColorOf(item));
  return face;
}

function makeAddTile() {
  const tile = document.createElement("div");
  tile.className = "tile tile--add";

  const button = document.createElement("button");
  button.className = "tile__link tile__link--button";
  button.type = "button";
  button.title = "添加网站";

  const face = document.createElement("span");
  face.className = "tile__face";

  const text = document.createElement("span");
  text.className = "tile__text";
  text.textContent = "＋";

  face.appendChild(text);
  button.appendChild(face);
  button.addEventListener("click", openAddDialog);
  tile.appendChild(button);
  return tile;
}

/* ---------------- 拖动图标调整顺序 ---------------- */

let draggingTile = null;

grid.addEventListener("dragstart", (event) => {
  const tile = event.target.closest && event.target.closest(".tile");
  if (!tile || tile.classList.contains("tile--add")) {
    event.preventDefault();
    return;
  }

  draggingTile = tile;
  tile.classList.add("tile--dragging");

  // 只放一个纯文字标记，故意不放图片 ——
  // 一旦拖的东西被浏览器认成「图片文件」，就会被换背景的拖放逻辑抢走。
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", tile.dataset.id || "");
});

grid.addEventListener("dragover", (event) => {
  if (!draggingTile) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";

  const target = event.target.closest && event.target.closest(".tile");
  if (!target || target === draggingTile) return;

  // 先算好「该插到哪个位置之前」，位置没变就什么都不做（dragover 触发非常频繁）
  let before;
  if (target.classList.contains("tile--add")) {
    before = target;                                  // 拖到「+」上，就是放到最后
  } else {
    const box = target.getBoundingClientRect();
    // 落在目标左半边插到它前面，右半边插到它后面
    before = event.clientX > box.left + box.width / 2 ? target.nextSibling : target;
  }

  if (before === draggingTile || before === draggingTile.nextSibling) return;
  grid.insertBefore(draggingTile, before);
});

grid.addEventListener("drop", (event) => {
  if (draggingTile) event.preventDefault();
});

grid.addEventListener("dragend", async () => {
  if (!draggingTile) return;
  draggingTile.classList.remove("tile--dragging");
  draggingTile = null;
  await saveOrderFromDom();
});

/** 把当前页面上图标的先后顺序存下来。 */
async function saveOrderFromDom() {
  const ids = Array.from(grid.querySelectorAll(".tile:not(.tile--add)"))
    .map((tile) => tile.dataset.id)
    .filter(Boolean);

  const items = await getBookmarks();
  const byId = new Map(items.map((item) => [item.id, item]));

  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
  // 保险：万一有哪个没出现在页面上，补到最后，别弄丢
  for (const item of items) {
    if (!ids.includes(item.id)) ordered.push(item);
  }

  try {
    await reorderBookmarks(ordered);
    toast("顺序已保存");
  } catch (error) {
    console.error(error);
    toast("顺序没存住");
  }
}

/* ---------------- 色块的颜色和字号 ---------------- */

const SVG_EDIT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/>' +
  '<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

const SVG_TRASH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/>' +
  '<path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>';

/** 色块上写什么字：优先用名字，没名字就用网址。 */
function labelOf(item) {
  return (item.title || "").trim() || hostOf(item.url) || "新网站";
}

/** 这个网站用哪个颜色：自己挑过就用挑的，没挑过按名字算一个（每次都一样）。 */
function faceColorOf(item) {
  return item.color || colorForName(labelOf(item));
}

/** 把颜色刷到色块上，顺便决定字用黑色还是白色。 */
function paintFace(face, color) {
  face.style.setProperty("--face", color);
  face.style.setProperty("--face-text", textColorOn(color));
  fitTileText(face);
}

/**
 * 底色太亮的时候，白字会看不清，那就换成深色字。
 * 用的是标准的「相对亮度」算法，跟着人眼对红绿蓝的敏感度加权。
 */
function textColorOn(hex) {
  const raw = String(hex || "").replace("#", "");
  if (raw.length !== 6) return "#ffffff";

  const channel = (pair) => {
    const v = parseInt(pair, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };

  const lum =
    0.2126 * channel(raw.slice(0, 2)) +
    0.7152 * channel(raw.slice(2, 4)) +
    0.0722 * channel(raw.slice(4, 6));

  return lum > 0.55 ? "#1a1d24" : "#ffffff";
}

/**
 * 字号自适应。
 *
 * 名字 2 个字就用最大的 30px；名字越长字越小，保证不出框。
 * 之所以是「量出来再缩」而不是按字数硬算，是因为中英文宽度差很多
 * （"GitHub" 和 "哔哩哔哩" 同样是 6 个字符，宽度却不一样）。
 */
const TEXT_MAX = 30;
const TEXT_MIN = 11;

function fitTileText(face) {
  const text = face.querySelector(".tile__text");
  if (!text) return;

  // 元素还没进页面（比如弹窗还没打开）时量不准，直接不动
  if (!face.clientWidth) return;

  text.style.fontSize = TEXT_MAX + "px";
  const natural = text.getBoundingClientRect().width;
  const avail = face.clientWidth - 24;      // 左右各留 12 像素的边

  if (natural > avail && natural > 0) {
    const shrunk = Math.floor((TEXT_MAX * avail) / natural);
    text.style.fontSize = Math.max(TEXT_MIN, shrunk) + "px";
  }
}

/** 页面上所有色块统一重算一遍字号。 */
function fitAllTileText() {
  for (const face of grid.querySelectorAll(".tile__face")) fitTileText(face);
}

// 窗口大小变了（或页面刚从后台切回来）再算一遍，防止第一次量的时候是 0
window.addEventListener("resize", fitAllTileText);

/* ---------------- 挑颜色的那一排小方块 ---------------- */

/** 把 12 个预设颜色画进容器里。onPick 是点一下要干什么。 */
function buildSwatches(container, onPick) {
  const frag = document.createDocumentFragment();
  for (const color of ICON_COLORS) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "swatch";
    swatch.style.background = color;
    swatch.dataset.color = color;
    swatch.title = color;
    swatch.addEventListener("click", () => onPick(color));
    frag.appendChild(swatch);
  }
  container.replaceChildren(frag);
}

/** 把「哪个被选中」和旁边的取色器都同步成 pendingColor。 */
function paintSwatches(container, colorInput) {
  colorInput.value = pendingColor;
  for (const swatch of container.children) {
    swatch.classList.toggle("swatch--on", swatch.dataset.color === pendingColor);
  }
}

/* ---------------- 添加网站 ---------------- */

function openAddDialog() {
  addForm.reset();
  addError.hidden = true;

  // 随机给一个颜色，不满意可以自己点别的
  pendingColor = ICON_COLORS[Math.floor(Math.random() * ICON_COLORS.length)];
  paintSwatches(addSwatches, addColor);

  addDialog.showModal();
  syncAddPreview();
  addTitle.focus();
}

/** 「添加」弹窗里的预览：名字和颜色跟着输入实时变。 */
function syncAddPreview() {
  addPreviewText.textContent = addTitle.value.trim() || "预览";
  paintFace(addPreviewFace, pendingColor);
}

addTitle.addEventListener("input", syncAddPreview);

buildSwatches(addSwatches, (color) => {
  pendingColor = color;
  paintSwatches(addSwatches, addColor);
  syncAddPreview();
});

addColor.addEventListener("input", () => {
  pendingColor = addColor.value;
  paintSwatches(addSwatches, addColor);
  syncAddPreview();
});

addCancel.addEventListener("click", () => addDialog.close());

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const title = addTitle.value.trim();
  const url = addUrl.value.trim();

  if (!title) {
    showAddError("给这个网站起个名字吧");
    return;
  }
  if (!url || !hostOf(url)) {
    showAddError("网址看着不对，试试写成这样：baidu.com");
    return;
  }

  try {
    await addBookmark(title, url, pendingColor);
    addDialog.close();
    await renderGrid();
    toast(`已添加「${title}」`);
  } catch (error) {
    console.error(error);
    showAddError("保存失败，可能是存东西的地方满了");
  }
});

function showAddError(message) {
  addError.textContent = message;
  addError.hidden = false;
}

/* ---------------- 编辑网站 ---------------- */

function openEditDialog(item) {
  editingId = item.id;
  pendingColor = faceColorOf(item);

  editTitle.value = item.title;
  editUrl.value = item.url;
  editError.hidden = true;

  paintSwatches(editSwatches, editColor);
  editDialog.showModal();
  syncEditPreview();
  editTitle.focus();
  editTitle.select();
}

/** 「编辑」弹窗里的预览：名字和颜色跟着输入实时变。 */
function syncEditPreview() {
  editPreviewText.textContent = editTitle.value.trim() || "预览";
  paintFace(editPreviewFace, pendingColor);
}

// 一边打字一边看预览，改错了马上能看出来
editTitle.addEventListener("input", syncEditPreview);

buildSwatches(editSwatches, (color) => {
  pendingColor = color;
  paintSwatches(editSwatches, editColor);
  syncEditPreview();
});

editColor.addEventListener("input", () => {
  pendingColor = editColor.value;
  paintSwatches(editSwatches, editColor);
  syncEditPreview();
});

editCancel.addEventListener("click", () => editDialog.close());

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const title = editTitle.value.trim();
  const url = editUrl.value.trim();

  if (!title) {
    showEditError("名字不能空着");
    return;
  }
  if (!url || !hostOf(url)) {
    showEditError("网址看着不对，试试写成这样：baidu.com");
    return;
  }

  try {
    await updateBookmark(editingId, {
      title,
      url: normalizeUrl(url),
      color: pendingColor,
    });

    editDialog.close();
    await renderGrid();
    toast("已保存");
  } catch (error) {
    console.error(error);
    showEditError("保存失败，可能是存东西的地方满了");
  }
});

function showEditError(message) {
  editError.textContent = message;
  editError.hidden = false;
}

/* ---------------- 背景图 ---------------- */

// 现在用的是哪一个（"" / "builtin:xxx" / "data:image/..."），弹窗要靠它标出「正在用」
let currentWallpaper = "";

/**
 * 把存着的值变成真正能塞进 CSS 的地址。
 * 内置的那张要转成 chrome-extension://... 开头，自己加的本来就是一句话很长的那种文本。
 */
function resolveWallpaperUrl(value) {
  if (!isBuiltinWallpaper(value)) return value;

  const path = builtinWallpaperPath(value);
  if (!path) return "";
  if (typeof chrome === "undefined" || !chrome.runtime) return "";
  return chrome.runtime.getURL(path);
}

async function applyWallpaper() {
  const value = await getWallpaper();
  const url = value ? resolveWallpaperUrl(value) : "";
  bg.style.backgroundImage = url ? `url("${url}")` : "";
}

wallpaperBtn.addEventListener("click", openWallpaperDialog);

wallpaperInput.addEventListener("change", async () => {
  const files = Array.from(wallpaperInput.files || []);
  wallpaperInput.value = "";                 // 清掉，这样同一张还能再选一次
  if (files.length) await importWallpapers(files);
});

wpAdd.addEventListener("click", () => wallpaperInput.click());
wpClose.addEventListener("click", () => wallpaperDialog.close());

wpRestore.addEventListener("click", async () => {
  await unhideAllBuiltins();
  await renderWallpaperLibrary();
  toast("都还回来了");
});

wpClear.addEventListener("click", async () => {
  await setWallpaper("");
  await applyWallpaper();
  currentWallpaper = "";
  await renderWallpaperLibrary();
  toast("不用背景图了");
});

async function openWallpaperDialog() {
  currentWallpaper = await getWallpaper();
  await renderWallpaperLibrary();
  if (!wallpaperDialog.open) wallpaperDialog.showModal();
}

/** 把整面墙重新铺一遍：最前面是扩展自带的那张，后面是自己加的。 */
async function renderWallpaperLibrary() {
  wpGrid.innerHTML = "";

  // 被拿掉过的自带壁纸就不再摆出来（图片文件还在，随时能还回来）
  const hidden = await getHiddenBuiltins();

  for (const item of BUILTIN_WALLPAPERS) {
    if (hidden.includes(item.id)) continue;
    const url = resolveWallpaperUrl(item.id);
    wpGrid.append(makeWallpaperCard(item.id, item.name, url));
  }

  for (const item of await getWallpaperLibrary()) {
    wpGrid.append(makeWallpaperCard(item.id, item.name, await getWallpaperThumb(item.id)));
  }

  // 有被收起来的才显示「还回来」那个按钮
  wpRestore.hidden = hidden.length === 0;

  if (!wpGrid.children.length) {
    const empty = document.createElement("p");
    empty.className = "wp__empty";
    empty.textContent = "库里还没有壁纸，点右上角「＋ 添加图片」吧";
    wpGrid.append(empty);
  }
}

/** 铺格里的一张。thumbUrl 是缩略图地址，自带的那张直接用原图（它就在本地硬盘上）。 */
function makeWallpaperCard(id, name, thumbUrl) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "wp__card";
  card.style.backgroundImage = thumbUrl ? `url("${thumbUrl}")` : "";
  card.title = `用「${name}」当背景`;
  if (id === currentWallpaper) card.classList.add("wp__card--on");

  const label = document.createElement("span");
  label.className = "wp__name";
  label.textContent = name;
  card.append(label);

  const del = document.createElement("span");
  del.className = "wp__del";
  del.textContent = "×";
  if (isBuiltinWallpaper(id)) {
    // 自带的不能真删（图片是扩展的一部分），但可以从库里收起来
    del.title = "从库里收起来（图片还在，想找回来去使用说明里看）";
    del.addEventListener("click", async (event) => {
      event.stopPropagation();
      await hideBuiltinWallpaper(id);
      if (currentWallpaper === id) {
        await setWallpaper("");
        await applyWallpaper();
        currentWallpaper = "";
      }
      await renderWallpaperLibrary();
      toast("已经收起来了");
    });
  } else {
    del.title = "从库里删掉";
    del.addEventListener("click", async (event) => {
      event.stopPropagation();               // 别顺手把「换成这张」也触发了
      await removeWallpaperFromLibrary(id);
      if (currentWallpaper === id) {
        await setWallpaper("");
        await applyWallpaper();
        currentWallpaper = "";
      }
      await renderWallpaperLibrary();
      toast("已经从库里删掉了");
    });
  }
  card.append(del);

  card.addEventListener("click", () => useWallpaper(id));
  return card;
}

/** 换成这一张。自己加的图要先把它那张原图读出来。 */
async function useWallpaper(id) {
  let value = id;

  if (!isBuiltinWallpaper(id)) {
    const image = await getWallpaperImage(id);
    if (!image) {
      toast("这张图找不到了，重新加一张吧");
      return;
    }
    value = image;
  }

  await setWallpaper(value);
  await applyWallpaper();
  currentWallpaper = value;
  await renderWallpaperLibrary();
  toast("背景已换好");
}

/** 把选中的（或拖进来的）图片文件收进库。多张就只入库，一张就顺手换上。 */
async function importWallpapers(files) {
  const images = files.filter((file) => file.type.startsWith("image/"));
  if (!images.length) {
    toast("这些不是图片文件");
    return;
  }

  if (images.length > 1) toast(`正在处理 ${images.length} 张图片…`);

  const newIds = [];
  for (const file of images) {
    try {
      newIds.push(await addWallpaperFromFile(file));
    } catch (error) {
      console.error(error);
    }
  }

  if (!newIds.length) {
    toast("这些图都没能存下来，换几张试试");
    return;
  }

  // 只加了一张，那就直接换上，省得再点一下
  if (newIds.length === 1) {
    await useWallpaper(newIds[0]);
    return;
  }

  await renderWallpaperLibrary();
  const failed = images.length - newIds.length;
  toast(
    failed
      ? `加了 ${newIds.length} 张，有 ${failed} 张没成功`
      : `加好了 ${newIds.length} 张，点哪张就换哪张`
  );
}

// 直接把图片文件拖到页面上，也会收进壁纸库并换上
let dragDepth = 0;

document.addEventListener("dragenter", (event) => {
  if (!hasImageFile(event)) return;
  event.preventDefault();
  dragDepth += 1;
  document.body.classList.add("dragging");
});

document.addEventListener("dragover", (event) => {
  if (!hasImageFile(event)) return;
  event.preventDefault();
});

document.addEventListener("dragleave", (event) => {
  if (!hasImageFile(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.body.classList.remove("dragging");
});

document.addEventListener("drop", async (event) => {
  event.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");

  const files = Array.from(event.dataTransfer.files || [])
    .filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;

  await importWallpapers(files);
  if (wallpaperDialog.open) await renderWallpaperLibrary();
});

function hasImageFile(event) {
  const types = event.dataTransfer && event.dataTransfer.types;
  return !!types && Array.from(types).includes("Files");
}

/* ---------------- 天气 ---------------- */

weatherRefresh.addEventListener("click", () => {
  loadWeather(weatherLoc, { force: true });
});

weatherCityBtn.addEventListener("click", openCityDialog);

/* 点「MSN」直接跳到 MSN 天气网站上这个城市的页面 */
weatherMsnBtn.addEventListener("click", () => openInNewTab(msnWeatherUrl()));

/**
 * 拼出这个城市在 MSN 天气网站上的地址。
 * 实测过的形状：https://www.msn.com/zh-cn/weather/forecast/in-上海市
 * 打开后页面标题就是「上海市 天气预报 | MSN 天气」。
 * 万一还没有城市，就退到 MSN 天气首页，至少点得动。
 */
function msnWeatherUrl() {
  const base = "https://www.msn.com/zh-cn/weather";
  const name = (weatherLoc && weatherLoc.name) || (weather && shortCity(weather.city)) || "";
  return name ? `${base}/forecast/in-${encodeURIComponent(name)}` : base;
}

/* 换城市的小弹窗 */
cityForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = cityInput.value.trim();
  if (!name) return;

  cityError.hidden = true;
  weatherLoc = await setCity(name);   // 先只存名字，经纬度等拿到数据再补上
  cityDialog.close();
  weather = null;                      // 换城市了，旧数据不能再用
  await loadWeather(weatherLoc, { force: true });
});

cityCancel.addEventListener("click", () => cityDialog.close());

function openCityDialog() {
  cityInput.value = weatherLoc ? weatherLoc.name : "";
  cityError.hidden = true;
  cityDialog.showModal();
  cityInput.focus();
  cityInput.select();
}

/** 打开新标签页时把天气准备好：先显示上次的，再决定要不要去拿新的。 */
async function initWeather() {
  weatherLoc = await getCity();

  const cache = await getWeatherCache();
  if (cache && cache.data) {
    weather = cache.data;
    renderWeather();
  }

  if (!weatherLoc) {
    renderWeatherIdle("还没设城市，点下面「换城市」");
    return;
  }

  const hasCache = !!(cache && cache.data);
  const stillFresh = hasCache && Date.now() - (cache.savedAt || 0) < REFRESH_AFTER;
  if (stillFresh) return;

  // 手上有旧数据就悄悄换，没有就让用户看到"正在获取"
  await loadWeather(weatherLoc, { quiet: hasCache });
}

/**
 * 去 MSN 拿一次天气。
 *   quiet=true  后台悄悄拿，界面上不显示"正在获取"
 *   force=true  用户手动点的，成功失败都给个提示
 */
async function loadWeather(loc, { quiet = false, force = false } = {}) {
  if (!loc || !loc.name || weatherBusy) return;
  weatherBusy = true;

  if (!quiet) {
    weatherIcon.textContent = "🌤️";
    weatherTemp.textContent = "--°";
    weatherSky.textContent = "正在获取…";
    weatherPlace.textContent = "";
  }

  try {
    const data = await fetchWeather(loc);
    weather = data;

    // 头一次拿到经纬度就补存回去，以后就不用再多问一趟城市接口了
    if (data.lat && data.lon && (data.lat !== loc.lat || data.lon !== loc.lon)) {
      weatherLoc = await setCity({ name: loc.name, lat: data.lat, lon: data.lon });
    }

    await setWeatherCache(data);
    renderWeather();
    if (force) toast(data.hourly ? "天气已更新" : "已更新（这个城市没有逐小时数据）");
  } catch (error) {
    console.error(error);

    if (weather) {
      renderWeather();                 // 拿不到就继续显示上次的，别空着
      toast(error.message);
    } else {
      renderWeatherIdle(error.message);
    }
  } finally {
    weatherBusy = false;
  }
}

/** 把天气画上去。 */
function renderWeather() {
  if (!weather) return;

  weatherIcon.textContent = iconFor(weather.sky, weather.code, weather.night);
  weatherTemp.textContent = weather.temp === null ? "--°" : `${weather.temp}°`;
  weatherSky.textContent = weather.sky || "天气";
  weatherPlace.textContent = shortCity(weather.city);

  const bits = [];
  if (weather.feelsLike !== null) bits.push(`体感 ${weather.feelsLike}°`);
  if (weather.humidity !== null) bits.push(`湿度 ${weather.humidity}%`);
  if (weather.wind) bits.push(weather.wind);
  if (weather.aqi !== null) bits.push(`空气 ${Math.round(weather.aqi)}`);
  weatherMeta.textContent = bits.join(" · ");

  /* ---- 接下来 3 小时 ---- */
  const hours = Array.isArray(weather.hours) ? weather.hours : [];
  weatherHoursBlock.hidden = hours.length === 0;
  weatherHours.replaceChildren(
    ...hours.map((hour) => {
      const li = document.createElement("li");
      li.className = "weather__hour";

      const time = document.createElement("span");
      time.className = "weather__hour-time";
      time.textContent = hour.label || "";

      const icon = document.createElement("span");
      icon.className = "weather__hour-icon";
      icon.textContent = iconFor(hour.text, hour.code, hour.night);

      const temp = document.createElement("span");
      temp.className = "weather__hour-temp";
      temp.textContent = hour.temp === null ? "--°" : `${Math.round(hour.temp)}°`;

      li.append(time, icon, temp);
      return li;
    })
  );

  /* ---- 未来 3 天 ---- */
  const days = Array.isArray(weather.days) ? weather.days : [];
  weatherDaysBlock.hidden = days.length === 0;
  weatherDays.replaceChildren(
    ...days.slice(0, 3).map((day) => {
      const li = document.createElement("li");
      li.className = "weather__day";

      const name = document.createElement("span");
      name.className = "weather__day-name";
      name.textContent = day.label || "";

      const icon = document.createElement("span");
      icon.className = "weather__day-icon";
      icon.textContent = iconFor(day.text, day.code);

      const sky = document.createElement("span");
      sky.className = "weather__day-sky";
      sky.textContent = day.text || "";

      const temp = document.createElement("span");
      temp.className = "weather__day-temp";
      const hi = document.createElement("b");
      hi.textContent = day.high === null ? "--°" : `${Math.round(day.high)}°`;
      const lo = document.createElement("i");
      lo.textContent = day.low === null ? "--°" : `${Math.round(day.low)}°`;
      temp.append(hi, lo);

      li.append(name, icon, sky, temp);
      return li;
    })
  );

  weatherUpdated.textContent = weather.updated ? `${weather.updated} 更新` : "";
}

/** 没有数据时卡片上显示一句话。 */
function renderWeatherIdle(message) {
  weatherIcon.textContent = "🌤️";
  weatherTemp.textContent = "--°";
  weatherSky.textContent = message;
  weatherPlace.textContent = "";
  weatherMeta.textContent = "";
  weatherHoursBlock.hidden = true;
  weatherHours.replaceChildren();
  weatherDaysBlock.hidden = true;
  weatherDays.replaceChildren();
  weatherUpdated.textContent = "";
}

/** "中华人民共和国上海市" 这种太长，掐掉前缀。 */
function shortCity(name) {
  return String(name || "").replace(/^中华人民共和国/, "").replace(/^中国/, "");
}

/* ---------------- 底部小提示 ---------------- */

let toastTimer = 0;

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 2200);
}

/* ---------------- 右边那一栏：卡片轮播 ---------------- */

/**
 * 这一栏里有哪些卡片。
 *
 * 每张卡片就是一条：
 *   id        认人的名字，也是存进存储里的值。改了就相当于换了张新卡片
 *   name      顶栏上显示的名字
 *   icon      顶栏上那个小图标
 *   hint      还没做的卡片，占位框里那两行字
 *   get        去 cards.js 里取真正的卡片实现（有 mount / unmount）
 *
 * 为什么用 get 而不是直接写 mount：cards.js 里那五张卡片会用到 lunar.js、
 * storage.js 一堆东西，而这个文件只该管「轮播怎么转」。用 get 的好处是
 * 卡片实现是**第一次真的切到它**才去拿的，也不用在这儿 import 一堆具体函数。
 *
 * box 是挂载时现发的，卡片自己不用管、也别存；写 mount 的时候直接拿参数。
 *
 * ⚠️ id 一改，用户之前停在哪张就认不出来了，会被兜回第一张（不报错）。
 */
const PANEL_SLIDES = [
  { id: "calendar", name: "日历", icon: "🗓", get: () => CARDS.calendar },
  { id: "todo", name: "待办", icon: "✅", get: () => CARDS.todo },
  { id: "memo", name: "便签", icon: "📝", get: () => CARDS.memo },
  { id: "countdown", name: "倒计时", icon: "⏳", get: () => CARDS.countdown },
  { id: "quote", name: "每日一句", icon: "💬", get: () => CARDS.quote },
];

let panelIndex = 0;        // 现在露的是第几张（0 起）
let panelMounted = null;   // 已经挂上的那张卡片
let panelSwitching = false; // 正在做切换动画，这期间不再接新的切换

/** 不管传进来什么，都折回 0 ~ 总数-1 的范围里（负数、超界都行）。 */
function wrapIndex(index) {
  const total = PANEL_SLIDES.length;
  return ((index % total) + total) % total;
}

/** 除了键盘，别的操作都在滑动中再按也没意义，先挡掉。 */
function panelBusy() {
  return panelSwitching || panelTrack.classList.contains("panel__track--dragging");
}

/** 把整条栏杆挪到第 index 张。 */
function paintPanel(index) {
  panelTrack.style.transform = `translateX(${-index * 100}%)`;
}

/** 顶栏的图标 / 名字、圆点的亮暗，跟着当前这张走。 */
function paintPanelHead() {
  const slide = PANEL_SLIDES[panelIndex];
  panelIcon.textContent = slide.icon || "";
  panelName.textContent = slide.name;

  [...panelDots.children].forEach((dot, i) => {
    dot.classList.toggle("panel__dot--on", i === panelIndex);
    dot.setAttribute("aria-selected", i === panelIndex ? "true" : "false");
  });
}

/**
 * 换到第 index 张。
 *
 * 卡片数据各归各的，所以这里只做三件事：把上一张收尾、把这一张挂上、
 * 记住看到哪儿了。setPanelCard 是异步的（可能走 chrome.storage），
 * 但界面不等它 —— 存丢了顶多下次回到第一张，不至于卡住。
 */
function showPanelSlide(index, { animate = true } = {}) {
  const total = PANEL_SLIDES.length;
  if (!total) return;

  const next = wrapIndex(index);
  if (next === panelIndex && animate) return;

  const previous = panelMounted;
  const slide = PANEL_SLIDES[next];
  const box = slide.box;

  panelIndex = next;

  if (!box) {
    console.error("[NKtab] 卡片还没建出节点：", slide.id);
    return;
  }

  // 卡片实现第一次切到它的时候才去拿，拿不到（id 写错之类）就当没有
  if (!slide.impl) {
    try {
      slide.impl = (slide.get && slide.get()) || null;
    } catch (error) {
      console.error("[NKtab] 卡片实现取不到：", slide.id, error);
      slide.impl = null;
    }
  }
  const impl = slide.impl;

  // 该收尾的先把定时器 / 请求收干净，再挂新的
  if (previous && previous !== slide && previous.impl && previous.impl.unmount && previous.box) {
    try {
      previous.impl.unmount(previous.box);
    } catch (error) {
      console.error("[NKtab] 卡片收尾出错：", previous.id, error);
    }
  }

  // 卡片自己画的画，只在第一次挂上去时画一遍；之后切回来就复用它
  if (impl && impl.mount && !slide.mounted) {
    try {
      slide.filled = true;
      impl.mount(box, { toast });
      slide.mounted = true;
    } catch (error) {
      console.error("[NKtab] 卡片挂载出错：", slide.id, error);
    }
  }

  // 还没写的卡片：空壳里放一块虚线框，免得一片空白让人以为坏了
  if (!impl && !slide.filled) {
    box.replaceChildren();
    const holder = document.createElement("div");
    holder.className = "slide-holder";

    const plus = document.createElement("span");
    plus.className = "slide-holder__plus";
    plus.textContent = "＋";

    const hint = document.createElement("span");
    hint.className = "slide-holder__hint";
    hint.innerHTML = slide.hint || "还没做";

    holder.append(plus, hint);
    box.append(holder);
    slide.filled = true;
  }

  panelMounted = slide;
  panelSwitching = animate && total > 1;

  if (!animate) {
    // 从头打开页面时不要「从第一张滑过来」那一下
    panelTrack.classList.add("panel__track--dragging");
    paintPanel(panelIndex);
    // 下一帧再放开动画，否则这次位移会被一起动画掉
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        panelTrack.classList.remove("panel__track--dragging");
        panelSwitching = false;
      });
    });
  } else {
    paintPanel(panelIndex);
    clearTimeout(showPanelSlide.timer);
    showPanelSlide.timer = setTimeout(() => {
      panelSwitching = false;
    }, 300);            // 跟 CSS 里的 .28s 对齐，稍微宽一点点
  }

  paintPanelHead();
  setPanelCard(slide.id).catch((error) => console.error("[NKtab] 记卡片位置失败：", error));
}

/** 下一张 / 上一张。skip 是「连续按」时的连跳张数。 */
function stepPanel(delta) {
  if (panelBusy()) return;
  showPanelSlide(wrapIndex(panelIndex + delta));
}

/** 底下那排圆点，几张卡片就几个点。 */
function buildPanelDots() {
  panelDots.innerHTML = "";
  PANEL_SLIDES.forEach((slide, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "panel__dot";
    dot.title = slide.name;
    dot.setAttribute("role", "tab");
    dot.setAttribute("aria-label", slide.name);
    dot.addEventListener("click", () => {
      if (panelBusy()) return;
      showPanelSlide(i);
    });
    panelDots.append(dot);
  });
}

/**
 * 键盘 ←→ 换卡片。
 *
 * 加这个判断是因为搜索框里用左右键挪光标是很正常的操作，
 * 那时候不该顺手把侧栏翻一页。
 */
function isTypingTarget(target) {
  if (!target || target.nodeType !== 1) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * 鼠标按住横拖 / 手机上手势横滑。
 *
 * 用 Pointer Events 一套代码同时管鼠标和触摸，省得写两份。
 * 拖动时先只动画面、不动状态，等松手够了 40px 才真的翻页 ——
 * 不够就当没发生，弹回去。
 */
function initPanelDrag() {
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let moved = 0;
  let locked = null;       // 认定是「横着拖」还是「竖着滚」

  panelView.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (panelBusy() || pointerId !== null) return;

    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    moved = 0;
    locked = null;
  });

  panelView.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;

    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    // 第一次挪动时看哪个方向大：竖向的就让页面自己滚，不抢
    if (!locked) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      locked = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (locked === "x") {
        panelTrack.classList.add("panel__track--dragging");
        panelView.setPointerCapture(pointerId);
      } else {
        pointerId = null;      // 这轮不归我们管了
        return;
      }
    }

    moved = dx;
    const percent = (dx / panelView.clientWidth) * 100;
    panelTrack.style.transform = `translateX(${-panelIndex * 100 + percent}%)`;
  });

  const finish = (event) => {
    if (event.pointerId !== pointerId) return;

    const dx = moved;
    pointerId = null;
    panelTrack.classList.remove("panel__track--dragging");

    // 拖得够远才算数；短拖就是「我刚才按了一下」，弹回原位
    if (Math.abs(dx) >= 40) {
      // 往左拖 = 看下一张，往右拖 = 看上一张
      showPanelSlide(wrapIndex(panelIndex + (dx < 0 ? 1 : -1)));
    } else {
      paintPanel(panelIndex);
    }
  };

  panelView.addEventListener("pointerup", finish);
  panelView.addEventListener("pointercancel", finish);
}

/** 把轮播搭起来。start() 里叫一次。 */
async function initPanel() {
  buildPanelDots();
  initPanelDrag();

  // 五张卡片的壳先一次性建好排成一条：切换只是整体左右挪，
  // 不用临时插节点，也就不会在动画中途改 DOM 造成跳一下。
  panelTrack.innerHTML = "";
  PANEL_SLIDES.forEach((slide, i) => {
    const box = document.createElement("section");
    box.className = "panel__slide";
    box.dataset.slide = slide.id;
    box.setAttribute("role", "tabpanel");
    box.setAttribute("aria-label", slide.name);
    panelTrack.append(box);
    slide.box = box;
    slide.filled = false;
    slide.mounted = false;
    slide.index = i;
  });

  panelPrev.addEventListener("click", () => stepPanel(-1));
  panelNext.addEventListener("click", () => stepPanel(1));

  document.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;   // 别抢浏览器的快捷键
    if (isTypingTarget(event.target)) return;
    event.preventDefault();      // 不然页面会左右滚
    stepPanel(event.key === "ArrowRight" ? 1 : -1);
  });

  // 存着的那个 id 还认识哪张就停哪张；认不出来（比如卡片改过 id）就从第一张开始
  const saved = await getPanelCard();
  const index = PANEL_SLIDES.findIndex((slide) => slide.id === saved);

  panelIndex = 0;                 // showPanelSlide 里要靠它判断「是不是同一张」
  showPanelSlide(index < 0 ? 0 : index, { animate: false });
}

/* ---------------- 启动 ---------------- */

async function start() {
  await applyWallpaper();
  await Promise.all([renderGrid(), refreshHistory()]);
  initPanel().catch((error) => console.error(error));    // 侧栏卡片，读一下存的位置，很快
  initWeather().catch((error) => console.error(error));  // 天气自己在后台拿，不挡着页面能用
  await restoreSearchEngine();                           // 上次选的搜索引擎
  searchInput.focus();     // 打开新标签页就能直接打字
}

/** 把搜索记录从存储里读进内存。 */
async function refreshHistory() {
  searchHistory = await getSearchHistory();
}

/** 把上次选的搜索引擎读回来画上；没存过就保持默认的必应。 */
async function restoreSearchEngine() {
  const saved = await getSearchEngine();
  if (findEngine(saved)) engineId = saved;
  paintEngine();
}

start();
