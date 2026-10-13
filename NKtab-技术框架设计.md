# NKtab 技术框架设计（Edge 新标签页扩展）

> 状态：**仅框架设计，尚未开工**。本文用于确认范围、技术选型与模块边界，确认后再进入编码阶段。

---

## 一、WeTab 是什么：功能拆解

WeTab 是「Infinity / 扩展迷 / 狐猴浏览器」同一团队推出的新标签页产品，覆盖 Chrome / Edge / Safari 及移动端。它的本质是**把浏览器新标签页改造成一个可自定义的「个人仪表盘 OS」**。

拆成功能模块看，一共 8 块：

| # | 模块 | 具体能力 | 实现重量 |
|---|------|---------|---------|
| 1 | **图标宫格** | 分类站点图标库（最受欢迎 / 新闻 / 影音 / 图片 / 购物 / 社交 / 出行 / 生活 / 游戏）、自定义添加站点、在线图标提取 / 纯色图标 / 本地上传 | 轻（纯前端） |
| 2 | **多主页仪表盘** | 主页 / 设计 / 程序 / 购物 等多个分组页，触控板手势或点击快速切换 | 轻 |
| 3 | **Dock 栏** | 底部常驻常用站点，拖拽添加、自动隐藏 / 弹出 | 轻 |
| 4 | **搜索框** | 内置百度 / 必应 / 谷歌 / 雅虎 / Yandex / DuckDuckGo / 360 / 搜狗，支持自定义引擎、聚合搜索 | 轻 |
| 5 | **壁纸系统** | 分类高清壁纸库、本地自定义上传、模糊 / 遮罩调节、（规划的）动态壁纸 | 中（需要图源，可换成本地 + Bing 每日一图） |
| 6 | **小组件库（核心）** | 30+ 组件：AI 工具、日历、待办、天气、时钟、节日、倒计时、纪念日、电影日历、换算器、每日一言、游戏、习惯养成、历史上的今天、汇率、股票、NBA 赛事、书签 | **重**（这是真正的护城河） |
| 7 | **AI 组件** | 内嵌对话式 AI 助手 | 重（= 后端 + 模型成本 + 合规） |
| 8 | **账号与云同步** | 登录后布局 / 壁纸 / 待办跨设备同步（会员体系） | 重（= 服务端） |

参考：[WeTab 新标签页 Chrome 商店](https://chromewebstore.google.com/detail/wetab-%E6%96%B0%E6%A0%87%E7%AD%BE%E9%A1%B5/aikflfpejipbpjdlfabpgclhblkpaafo)、[Edge 加载项页面](https://microsoftedge.microsoft.com/addons/detail/wetab-%e6%96%b0%e6%a0%87%e7%ad%be%e9%a1%b5/bpelnogcookhocnaokfpoeinibimbeff)、[功能评测文章](https://cloud.tencent.cn/developer/article/2307115)

### 关键判断

第 6、7、8 块是 WeTab 的成本中心。**我们的 V1 不应该碰 7 和 8**（AI 和账号体系），第 6 块只做「框架」不做「军备竞赛」。

---

## 二、NKtab 的定位与范围

**定位：离线优先（local-first）、零后端、零账号的极简新标签页。**

核心洞察：`chrome.storage.sync` 天然跨设备同步（跟着 Edge 账号走），配额 100KB / 单条 8KB——一份图标布局配置完全塞得下。**WeTab 花大力气做的「云同步」，我们在 V1 可以直接白嫖浏览器自带的同步能力，不需要任何服务端。**

### V1 范围（做）

- 图标宫格 + 多分组切换 + 拖拽排序/调整
- 底部 Dock
- 搜索框（多引擎 + 自定义引擎）
- 壁纸（内置纯色/渐变 + 本地上传 + Bing 每日一图，可选）
- 小组件系统（**注册表机制** + 4 个纯本地/轻 API 组件：时钟、倒数日、待办、天气）
- 设置面板 + 配置导入导出（JSON）

### V1 明确不做（后续里程碑再说）

- 账号 / 登录 / 云同步服务端
- AI 对话组件
- 云端壁纸库（图源、CDN、版权都是坑）
- 小组件市场 / 第三方插件

---

## 三、技术选型

| 层 | 选择 | 理由 |
|---|------|------|
| 扩展规范 | **Manifest V3** | Edge 与 Chrome 同为 Chromium 内核，MV3 是当前唯一可选；Edge 同样支持 `chrome_url_overrides.newtab` |
| 构建 | **Vite + `@crxjs/vite-plugin`**（备选 **WXT**） | CRXJS 透明、社区大；WXT 更省心（自动生成 manifest、多浏览器、文件式路由），但多一层抽象 |
| 语言 | **TypeScript** | 数据模型复杂（布局/组件/壁纸），必须靠类型约束 |
| UI | **React 18 + Tailwind CSS** | 生态最全，拖拽库 `@dnd-kit` 成熟；若你更熟 Vue 3 可等价替换（`vue-draggable-plus` + `pinia`） |
| 图标网格 | **CSS Grid 12 列**（V1）→ 后续可换 `react-grid-layout` 做自由拖拽缩放 | WeTab 是自由画布，但 V1 用网格能砍掉 70% 复杂度 |
| 状态管理 | **Zustand + 自研 `chrome.storage` 持久化中间件** | 轻，且方便统一走存储适配层 |
| 大文件存储 | **IndexedDB**（`idb` 这个库） | 壁纸原图、用户上传图标必须放这，`chrome.storage` 放不下 |
| 包管理 | pnpm | 快、省磁盘 |

**备选构建方案对比**

| 方案 | 优点 | 缺点 |
|------|------|------|
| Vite + CRXJS | 直观、manifest 配置写在 TS 里、HMR 好 | MV3 的 service worker HMR 偶有抽风 |
| WXT | 开箱即用、多浏览器一键打包、约定优于配置 | 抽象层，出问题要读它的源码 |
| Plasmo | 曾经流行 | 近两年维护节奏慢，不建议新项目用 |

---

## 四、整体架构

```
┌──────────────────────────────────────────────────────────────┐
│  浏览器宿主 (Edge / Chromium)                                  │
├──────────────────────────────────────────────────────────────┤
│  Manifest V3                                                  │
│   ├─ chrome_url_overrides.newtab → src/newtab/index.html ★主界面│
│   ├─ background.service_worker   → src/background/index.ts    │
│   ├─ options_ui                  → src/options/index.html     │
│   └─ action (popup, 可选)                                     │
├──────────────────────────────────────────────────────────────┤
│  入口层 (Views)                                                │
│   newtab 主界面 · options 设置页 · popup 快捷面板                │
├──────────────────────────────────────────────────────────────┤
│  领域层 (core/, 无 UI 依赖, 可单测)                             │
│   shortcuts · groups · search · favicon · widgets · wallpaper  │
├──────────────────────────────────────────────────────────────┤
│  存储适配层 (core/storage)                                      │
│   schema + version  |  syncPrefs  |  idb  |  migrate           │
├──────────────────────────────────────────────────────────────┤
│  浏览器物理存储                                                 │
│   chrome.storage.sync  chrome.storage.local  IndexedDB         │
└──────────────────────────────────────────────────────────────┘
```

### 四条铁律

1. **MV3 的 Service Worker 随时会被杀**——任何状态都不能放在 SW 的内存里，必须落盘。定时任务一律用 `chrome.alarms`，不能用 `setTimeout`。
2. **MV3 禁止远程代码**——所有 JS 必须打包进扩展。小组件绝不允许「从服务器动态加载脚本」；真要做云端组件，只能 iframe 远程页面，但商店审核风险高、主题不一致、性能差，V1 不碰。
3. **`newtab` 页面每次新开标签都重新加载**——首屏性能是体验生死线。壁纸必须最先绘制（避免白屏闪烁），数据读取必须缓存 + 异步补齐。
4. **领域层不 import 任何 React**——保证可以脱离 UI 单测，也方便以后换 UI 框架。

---

## 五、目录结构

```
NKtab/
├─ package.json
├─ vite.config.ts
├─ manifest.config.ts          # 由构建工具生成 manifest.json
├─ tsconfig.json
├─ tailwind.config.ts
├─ public/
│  ├─ icons/                   # 16 / 32 / 48 / 128 扩展图标
│  └─ assets/                  # 内置默认壁纸、兜底图标、字体
├─ src/
│  ├─ newtab/                  # ★ 新标签页主界面
│  │  ├─ index.html
│  │  ├─ main.tsx
│  │  ├─ App.tsx
│  │  ├─ views/
│  │  │  ├─ WallpaperLayer.tsx     # 背景层（最先渲染）
│  │  │  ├─ SearchBar.tsx          # 搜索框 + 引擎切换
│  │  │  ├─ ShortcutGrid.tsx       # 图标宫格（dnd-kit 拖拽）
│  │  │  ├─ GroupSwitcher.tsx      # 左侧分组 / 手势切页
│  │  │  ├─ Dock.tsx               # 底部常驻 Dock
│  │  │  └─ SettingsDrawer.tsx     # 齿轮设置抽屉
│  │  ├─ widgets/                  # ★ 小组件（可插拔）
│  │  │  ├─ registry.ts            # 组件注册表
│  │  │  ├─ WidgetHost.tsx         # 统一渲染/尺寸/缩放容器
│  │  │  ├─ clock/
│  │  │  ├─ countdown/
│  │  │  ├─ todo/
│  │  │  └─ weather/
│  │  └─ components/               # 通用原子 UI
│  ├─ background/
│  │  ├─ index.ts                  # SW 入口，只做事件路由
│  │  ├─ alarms.ts                 # 定时刷新天气/每日一图
│  │  └─ messages.ts               # 消息协议定义
│  ├─ options/                     # 独立设置页（复杂设置放这）
│  │  ├─ index.html
│  │  └─ main.tsx
│  ├─ core/                        # ★ 领域层（零 UI 依赖）
│  │  ├─ model/
│  │  │  ├─ types.ts               # 所有实体接口
│  │  │  └─ defaults.ts
│  │  ├─ storage/
│  │  │  ├─ schema.ts              # 当前 schema 版本号 + 结构
│  │  │  ├─ prefs.ts               # storage.sync 读写（带 debounce）
│  │  │  ├─ local.ts               # storage.local 缓存
│  │  │  ├─ idb.ts                 # IndexedDB：壁纸 blob、上传图标
│  │  │  └─ migrate.ts             # 版本迁移链
│  │  ├─ shortcuts.ts              # 图标增删改查/排序/校验
│  │  ├─ groups.ts                 # 分组管理
│  │  ├─ search.ts                 # 搜索引擎表 + URL 模板拼装
│  │  ├─ favicon.ts                # _favicon / 在线抓取 / 首字母兜底
│  │  ├─ wallpaper.ts              # 壁纸源管理 + 缓存
│  │  └─ net/                      # 外部 API 封装（天气等）
│  ├─ shared/
│  │  ├─ constants.ts
│  │  ├─ i18n/                     # zh-CN / en
│  │  └─ utils/
│  └─ types/
├─ tests/                          # vitest 单测（主要覆盖 core/）
└─ docs/
```

---

## 六、数据模型（草案）

```ts
// ---- 顶层配置：放 chrome.storage.sync，跟着账号走 ----
interface Prefs {
  schemaVersion: number;
  settings: Settings;
  groups: Group[];
  dock: DockItem[];
  engines: SearchEngine[];
  activeGroupId: string;
}

interface Settings {
  wallpaper: WallpaperRef;          // 只存引用，不存图
  searchEngineId: string;
  openInNewTab: boolean;
  gridColumns: 4 | 5 | 6 | 8;
  dockAutoHide: boolean;
  theme: 'auto' | 'light' | 'dark';
  locale: 'zh-CN' | 'en';
}

interface Group {
  id: string;
  name: string;
  icon?: string;
  shortcuts: Shortcut[];
}

interface Shortcut {
  id: string;
  title: string;
  url: string;
  iconRef: IconRef;                 // ← 关键：只存引用
  size: 1 | 2;                      // 占 1×1 或 2×2 格
}

type IconRef =
  | { kind: 'favicon'; url: string }        // 用浏览器 _favicon API 现取
  | { kind: 'builtin'; name: string }       // 内置图标名
  | { kind: 'color'; bg: string; text: string }  // 纯色 + 首字母
  | { kind: 'idb'; key: string };           // 用户上传，二进制在 IndexedDB

interface DockItem { id: string; title: string; url: string; iconRef: IconRef; }

interface SearchEngine { id: string; name: string; urlTemplate: string; keyword?: string; }

// ---- 大文件与缓存：放 IndexedDB / storage.local，不同步 ----
interface WallpaperRef {
  kind: 'builtin' | 'solid' | 'gradient' | 'idb' | 'remote';
  value: string;                    // idb 的 key / 远程 URL / CSS 值
  blur: number;                     // 0-20
  mask: number;                     // 0-1 遮罩透明度
}

interface WidgetInstance {
  id: string;
  widgetId: string;                 // 对应 registry 里的定义
  groupId: string;
  rect: { x: number; y: number; w: number; h: number };  // 12 列网格坐标
  config: Record<string, unknown>;  // 由各组件自己声明 schema
}
```

**存储分配表**

| 数据 | 位置 | 理由 |
|------|------|------|
| `Prefs`（布局、分组、Dock、引擎、设置） | `chrome.storage.sync` | 100KB 总量 / 8KB 单条足够，白嫖跨设备同步 |
| 用户上传的图标、壁纸原图（Blob） | **IndexedDB** | 二进制塞进 sync 必然炸单条 8KB 限制 |
| 天气 JSON、favicon 缓存、Bing 每日一图 URL | `chrome.storage.local` | 缓存类，不需要同步，10MB 够用 |
| 当前拖拽临时态、面板开合 | React state / `storage.session` | 会话级，不必持久化 |

> ⚠️ **最容易踩的坑**：把 base64 图片直接写进配置对象。base64 体积膨胀 33%，一条 8KB 上限，几张图就写失败，而且 `set()` 整体 reject（无部分写入）。**布局里永远只放引用 ID。**

---

## 七、小组件框架（核心设计）

小组件是 WeTab 的灵魂，也是最容易写成一坨的地方。用**注册表 + 统一宿主容器**解耦：

```ts
interface WidgetDefinition<P = unknown> {
  id: string;                                  // 'clock'
  name: string;                                // 显示名（i18n key）
  category: 'time' | 'productivity' | 'info' | 'fun';
  defaultSize: { w: number; h: number };       // 12 列网格
  minSize?: { w: number; h: number };
  maxSize?: { w: number; h: number };
  /** 是否需要网络/额外权限，用于设置页提示与按需授权 */
  permissionHint?: string[];
  /** 组件的配置表单 schema，设置面板据此自动生成 UI */
  configSchema?: FieldSchema[];
  /** 刷新策略：交给 background 的 alarms */
  refresh?: { intervalMinutes: number };
  Component: React.ComponentType<WidgetProps<P>>;
}

interface WidgetProps<P> {
  instanceId: string;
  config: P;
  size: { w: number; h: number };
  updateConfig: (patch: Partial<P>) => void;
}
```

`registry.ts` 导出 `registerWidget()` / `getWidget(id)` / `listWidgets()`，`WidgetHost.tsx` 负责尺寸、拖拽把手、右键菜单、错误边界、加载骨架屏。**新增一个组件 = 新建一个目录 + 在 registry 里注册一行**，不改任何其他文件。

V1 落地 4 个：
- `clock` — 纯本地，0 网络
- `countdown` — 纯本地（生日/纪念日/到期日）
- `todo` — 纯本地，存 `storage.local`，可选同步到 `sync`
- `weather` — 唯一需要 `host_permissions` 的，正好用来跑通「网络 + 缓存 + alarms 定时刷新」链路

---

## 八、manifest 与权限（草案）

```jsonc
{
  "manifest_version": 3,
  "name": "NKtab",
  "version": "0.1.0",
  "chrome_url_overrides": { "newtab": "src/newtab/index.html" },
  "background": { "service_worker": "src/background/index.ts", "type": "module" },
  "options_ui": { "page": "src/options/index.html", "open_in_tab": true },
  "permissions": [
    "storage",        // 必需
    "favicon",        // ★ MV3 取网站图标的官方方式
    "alarms",         // ★ SW 里唯一的定时手段
    "unlimitedStorage" // 可选：壁纸多时需要
  ],
  "optional_permissions": ["bookmarks"],
  "host_permissions": ["https://api.example-weather.com/*"],
  "icons": { "16": "public/icons/16.png", "128": "public/icons/128.png" }
}
```

**关于网站图标**：MV3 里 `chrome://favicon` 已废弃。正确做法是申请 `"favicon"` 权限，然后请求
`chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=32')`。
这条链路在实际开发中要**第一件事就验证**（见风险清单）。

---

## 九、风险与坑（提前记账）

| # | 风险 | 影响 | 对策 |
|---|------|------|------|
| 1 | **MV3 禁止远程代码** | 云组件方案直接死路 | 组件全部打包内置；架构上不给"动态脚本"留口子 |
| 2 | **`_favicon` API 在 Edge 的兼容性未实测** | 图标不显示，主界面直接废 | M0 阶段第一个打样验证；兜底方案：Google `s2/favicons` 或首字母纯色块 |
| 3 | `newtab` 每次重新加载 | 白屏闪烁、首屏慢 | 壁纸走 `public/assets` 内联或 IndexedDB 预热；先渲染外壳再补数据 |
| 4 | `storage.sync` 限流 1800 写/小时、单条 8KB | 拖拽时高频写入会报错 | 写操作统一走 debounce（300~500ms）+ 批量合并；超大对象切割分片 |
| 5 | 用户上传大图塞满 IndexedDB | 配额耗尽 | 上传即压缩（最长边 2560px，转 WebP）+ 保留策略 |
| 6 | Service Worker 被回收导致定时失效 | 天气不更新 | `chrome.alarms` + 打开页面时惰性补刷（双保险） |
| 7 | **新标签页扩展的审核敏感度** | 上架被拒 | 绝不篡改默认搜索、不劫持首页、不注入广告；商店描述与实际行为严格一致 |
| 8 | Edge 加载项上架流程 | 流程不熟容易卡 | Edge 走 Partner Center，需先注册开发者账号；打包产物要同时满足 Chrome / Edge |
| 9 | 数据版本升级把老用户配置搞坏 | 用户丢失全部图标 | `schemaVersion` + 迁移链 + **升级前自动导出备份到 local** |

---

## 十、里程碑（建议顺序）

| 阶段 | 目标 | 验收标准 |
|------|------|---------|
| **M0 骨架** | 能加载、能覆盖新标签页、白底 + 时钟 | Edge 里 `edge://extensions` 加载已解压扩展，新开标签显示 NKtab |
| **M1 图标宫格** | 分组 + 图标 + 拖拽 + 持久化 | 重启浏览器后布局不丢；`_favicon` 链路跑通 |
| **M2 搜索** | 搜索框 + 引擎切换 + 图标管理（增删改 / 图标来源选择） | 能换引擎并记住；能删能改 |
| **M3 Dock + 壁纸** | 底部 Dock、自动隐藏、壁纸（内置 + 本地上传 + 模糊遮罩） | 上传大图后刷新仍在，无白屏闪烁 |
| **M4 组件框架** | `registry` + `WidgetHost` + clock/countdown/todo/weather | 新增一个组件只需新建目录 + 注册一行 |
| **M5 设置与同步** | 独立设置页、配置导入导出、`storage.sync` 打通 | 两台设备（或两个浏览器 profile）登录同一账号后布局自动同步 |
| **M6 上架** | 打包 + 图标 + 商店素材 + 隐私说明 | 提交 Edge Add-ons 并通过审核 |

---

## 十一、待你确认的决策点

1. **UI 框架**：React 还是 Vue？（我默认按 React + Tailwind 写）
2. **构建方案**：Vite + CRXJS（透明可控）还是 WXT（省心）？
3. **V1 范围**：是否同意砍掉 AI 组件、账号体系、云端壁纸库？
4. **壁纸源**：只做「本地 + 纯色/渐变」，还是加上 Bing 每日一图（需要 `host_permissions`）？
5. **小组件优先级**：V1 的 4 个（时钟 / 倒数日 / 待办 / 天气）是否合适？
6. **界面语言**：只做中文，还是中英双语？

确认后我就按 M0 → M1 的顺序动手搭骨架。
