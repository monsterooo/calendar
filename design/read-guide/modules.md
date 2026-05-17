# 模块详解

## 模块一览

| 模块                                          | 目录                          | 核心职责                   |
| --------------------------------------------- | ----------------------------- | -------------------------- |
| [Core](#1-core-模块)                          | `src/core/`                   | 应用状态管理、业务逻辑核心 |
| [Renderer](#2-renderer-模块)                  | `src/renderer/`               | DOM 渲染、插槽系统、响应式 |
| [Components](#3-components-模块)              | `src/components/`             | 可复用 UI 组件库           |
| [Views + Factories](#4-views--factories-模块) | `src/views/` `src/factories/` | 视图实现与创建工厂         |
| [Hooks](#5-hooks-模块)                        | `src/hooks/`                  | 可复用逻辑 hooks           |
| [Types](#6-types-模块)                        | `src/types/`                  | TypeScript 类型定义        |
| [Utils](#7-utils-模块)                        | `src/utils/`                  | 工具函数库                 |
| [Locale](#8-locale-模块)                      | `src/locale/`                 | 国际化系统                 |
| [Plugins](#9-plugins-模块)                    | `src/plugins/`                | 扩展点                     |

---

## 1. Core 模块

**目录**：`src/core/`

**职责**：应用的唯一状态来源，包含所有业务逻辑。

### 关键文件

| 文件                                 | 职责                                                           |
| ------------------------------------ | -------------------------------------------------------------- |
| `CalendarApp.ts`                     | 主应用类，实现 `ICalendarApp` 接口，管理所有状态和 API         |
| `CalendarStore.ts`                   | 内存事件存储（`Map<string, Event>`），支持事务和变化通知       |
| `calendarRegistry.ts`                | 日历类型、颜色、主题管理；`getCalendarColorsForHex()` 颜色解析 |
| `config.ts`                          | 拖拽配置、视图配置的管理和合并                                 |
| `useCalendarApp.ts`                  | Hook 封装，管理 `CalendarApp` 实例生命周期                     |
| `events/EventManager.ts`             | 事件 CRUD 业务层，撤销栈，事件来源标记                         |
| `navigation/NavigationController.ts` | 视图切换、日期导航、可见范围变化事件分发                       |
| `permissions/CalendarPermissions.ts` | 只读控制（全局/按日历），`canMutateFromUI()` 检查              |
| `plugins/PluginManager.ts`           | 插件安装、查询、配置更新                                       |

### 核心状态

```typescript
interface CalendarAppState {
  currentView: ViewType;
  currentDate: Date;
  events: Event[];
  plugins: Map<string, unknown>;
  views: Map<ViewType, CalendarView>;
  locale: LocaleCode | Locale;
  highlightedEventId: string | null;
  selectedEventId: string | null;
  readOnly: ReadOnlyConfig;
  timeZone: string;
}
```

### 依赖关系

`CalendarApp` 内部委托：

- `EventManager` → 事件操作
- `NavigationController` → 导航
- `CalendarRegistry` → 日历管理
- `PluginManager` → 插件管理

被 `CalendarRenderer` 订阅，驱动 UI 重新渲染。

---

## 2. Renderer 模块

**目录**：`src/renderer/`

**职责**：将 `CalendarApp` 状态渲染到 DOM，并管理跨框架渲染插槽。

### 关键文件

| 文件                                | 职责                                                            |
| ----------------------------------- | --------------------------------------------------------------- |
| `CalendarRenderer.tsx`              | 挂载/卸载入口，通过 `requestAnimationFrame` 节流渲染            |
| `CalendarRoot.tsx`                  | UI 组件树根节点，组合 Header、视图、对话框、搜索等              |
| `ContentSlot.tsx`                   | 渲染占位符，`useLayoutEffect` 同步注册到 `CustomRenderingStore` |
| `CustomRenderingStore.ts`           | 插槽注册表，跟踪框架适配器的覆盖声明                            |
| `CustomRenderingContext.ts`         | Preact Context，在组件树中传递 `CustomRenderingStore`           |
| `hooks/useAppSubscription.ts`       | 订阅 app 状态，返回 `tick`（驱动重渲染）和 `selectedEventId`    |
| `hooks/useEventDialogController.ts` | 事件详情对话框/面板的状态和 props 管理                          |
| `hooks/useQuickCreateController.ts` | 快速创建事件的流程（桌面弹出框 / 移动抽屉）                     |
| `hooks/useSearchController.ts`      | 搜索状态、防抖、结果处理                                        |
| `hooks/useResponsive.ts`            | 响应式断点检测（`isMobile`：视口宽度 ≤ 1024px）                 |

### ContentSlot 工作原理

```
ContentSlot mount
  └─ useLayoutEffect → store.register({ id, containerEl, generatorName, generatorArgs })

框架适配器（React/Vue）
  └─ store.setOverrides(['eventDetailDialog'])  // 声明覆盖
  └─ store.subscribe(listener)                  // 监听插槽注册
  └─ ReactDOM.createPortal(component, containerEl) // 渲染到占位符 div

ContentSlot unmount
  └─ store.unregister(id)
```

### CalendarRoot 组合的 UI 区域

```
CalendarRoot
├─ ThemeProvider + LocaleProvider
├─ ContentSlot['titleBar']          ← 标题栏（可自定义）
├─ Sidebar（sidebarBridge 插件提供）
├─ [CurrentViewComponent]           ← DayView / WeekView / ...
├─ ContentSlot['eventDetailDialog'] ← 事件详情（可自定义）
├─ ContentSlot['eventDetailPanel']  ← 详情面板（可自定义）
├─ QuickCreateEventPopup（桌面）
├─ ContentSlot['mobileEventDrawer'] ← 移动抽屉（可自定义）
├─ ContentSlot['searchDrawer']      ← 搜索（可自定义）
└─ MobileSearchDialog（移动）
```

---

## 3. Components 模块

**目录**：`src/components/`

**职责**：提供可复用的 UI 组件，涵盖事件卡片、通用控件、视图专用组件等。

### 子模块

#### 3.1 `calendarEvent/` — 事件卡片

| 文件                              | 职责                                           |
| --------------------------------- | ---------------------------------------------- |
| `CalendarEvent.tsx`               | 事件卡片主组件，统一处理点击/拖拽/选中         |
| `hooks/useEventActions.ts`        | 事件交互动作（点击、双击、右键菜单、拖拽启动） |
| `hooks/useEventStyles.ts`         | 位置、大小、颜色等样式计算                     |
| `hooks/useEventInteraction.ts`    | 拖拽和 Resize 的鼠标/触控事件处理              |
| `hooks/useDetailPanelPosition.ts` | 详情面板的定位计算（避免超出视口）             |
| `components/EventContent.tsx`     | 事件内容路由（全天 / 普通 / 月视图 / 年视图）  |

#### 3.2 `common/` — 通用控件

| 组件                           | 说明                                      |
| ------------------------------ | ----------------------------------------- |
| `CalendarHeader.tsx`           | 导航栏：上一个/下一个、日期标题、视图切换 |
| `ViewSwitcher.tsx`             | 视图切换器（按钮 or 下拉）                |
| `MiniCalendar.tsx`             | 月份导航小日历                            |
| `DefaultEventDetailDialog.tsx` | 默认事件详情对话框                        |
| `DefaultEventDetailPanel.tsx`  | 默认事件详情浮动面板                      |
| `QuickCreateEventPopup.tsx`    | 桌面快速创建事件弹出框                    |
| `CreateCalendarDialog.tsx`     | 创建日历对话框                            |
| `BlossomColorPicker.tsx`       | 颜色选择器（Blossom 风格）                |
| `DefaultColorPicker.tsx`       | 默认颜色选择器                            |
| `Icons.tsx`                    | 内置图标（基于 Lucide）                   |

#### 3.3 视图专用组件

| 目录         | 关键组件                                                                               |
| ------------ | -------------------------------------------------------------------------------------- |
| `dayView/`   | `DayContent.tsx`（时间网格内容）、`RightPanel.tsx`                                     |
| `weekView/`  | `TimeGrid.tsx`（时间列）、`AllDayRow.tsx`（全天行）、`CompactHeader.tsx`               |
| `monthView/` | `WeekComponent.tsx`（周行）、`WeekDayCell.tsx`（日格子）、`MultiDayEvent.tsx`          |
| `yearView/`  | `DefaultYearView.tsx`、`GridYearView.tsx`、`FixedWeekYearView.tsx`、`GridDayPopup.tsx` |

#### 3.4 `eventLayout/` — 布局计算引擎

计算重叠事件的位置和宽度，输出每个事件的 `EventLayout`（left、width、zIndex）。

| 文件                     | 算法                       |
| ------------------------ | -------------------------- |
| `calculate/grouping.ts`  | 找出时间重叠的事件组       |
| `calculate/structure.ts` | 构建事件嵌套树（父子关系） |
| `calculate/layout.ts`    | 为每个事件分配列位置和宽度 |
| `calculate/rebalance.ts` | 平衡算法，优化列宽分配     |

整体复杂度 O(n log n)（分组+排序+布局）。

#### 3.5 其他组件

- `contextMenu/` — 右键菜单（事件上的菜单 + 网格空白区菜单）
- `mobileEventDrawer/` — 移动端事件编辑抽屉（含 `TimePickerWheel.tsx`）
- `search/` — 搜索抽屉（桌面 `SearchDrawer.tsx`、移动 `MobileSearchDialog.tsx`）

---

## 4. Views + Factories 模块

**目录**：`src/views/` + `src/factories/`

**职责**：视图组件实现（顶层组件），以及通过工厂函数封装配置。

### 视图一览

| 视图       | 文件                   | 特性                                            |
| ---------- | ---------------------- | ----------------------------------------------- |
| DayView    | `views/DayView.tsx`    | 时间网格、全天事件区域                          |
| WeekView   | `views/WeekView.tsx`   | 7 列时间网格、虚拟滚动、移动滑动手势            |
| MonthView  | `views/MonthView.tsx`  | 日格子、虚拟月份滚动                            |
| YearView   | `views/YearView.tsx`   | 三种模式：`grid` / `fixed-week` / `year-canvas` |
| AgendaView | `views/AgendaView.tsx` | 垂直时间线列表                                  |

### 工厂函数

```typescript
// src/factories/index.ts
createDayView(config?: DayViewConfig): CalendarView
createWeekView(config?: WeekViewConfig): CalendarView
createMonthView(config?: MonthViewConfig): CalendarView
createYearView(config?: YearViewConfig): CalendarView
createAgendaView(config?: AgendaViewConfig): CalendarView
```

工厂函数返回 `{ type, component, config }`，由 `CalendarApp` 管理。

---

## 5. Hooks 模块

**目录**：`src/hooks/`

**职责**：视图层可复用的通用 hooks。

| Hook                    | 文件                                     | 功能                                              |
| ----------------------- | ---------------------------------------- | ------------------------------------------------- |
| `useCalendarDrop`       | `useCalendarDrop.ts`                     | 从侧边栏日历拖放到视图中创建事件                  |
| `useWeekViewSwipe`      | `useWeekViewSwipe.ts`                    | 移动端周视图水平滑动翻页（含动画）                |
| `useDebouncedValue`     | `useDebouncedValue.ts`                   | 防抖值                                            |
| `useVirtualScroll`      | `virtualScroll/useVirtualScroll.ts`      | 年视图虚拟滚动                                    |
| `useVirtualMonthScroll` | `virtualScroll/useVirtualMonthScroll.ts` | 月视图虚拟滚动（OVERSCAN=6，SCROLL_THROTTLE=8ms） |

---

## 6. Types 模块

**目录**：`src/types/`

**职责**：所有 TypeScript 类型定义，通过 `src/types/index.ts` 统一导出。

| 文件               | 包含类型                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `core.ts`          | `ICalendarApp`、`CalendarAppState`、`CalendarAppConfig`、`ViewType`、`CalendarCallbacks`、`EventMutationSource` |
| `event.ts`         | `Event`（支持 Temporal API）                                                                                    |
| `calendar.ts`      | `DayData`、`WeeksData`                                                                                          |
| `layout.ts`        | `EventLayout`、`EventGroup`、`NestedLayer`、`LAYOUT_CONFIG`                                                     |
| `config.ts`        | `DragConfig`、`CalendarConfig`                                                                                  |
| `factory.ts`       | `BaseViewProps`、`DayViewConfig`、`WeekViewConfig`、`MonthViewConfig`、`YearViewConfig`、`AgendaViewConfig`     |
| `calendarTypes.ts` | `CalendarType`、`CalendarColors`、`ThemeMode`、`ThemeConfig`                                                    |
| `plugin.ts`        | `CalendarPlugin`、`EventsService`、`DragService`、`DragPluginConfig`                                            |
| `timezone.ts`      | `TimeZone`（枚举）、`TimeZoneValue`                                                                             |
| `dragIndicator.ts` | `DragRef`、`MonthDragState`、`WeekDayDragState`                                                                 |
| `eventDetail.ts`   | 事件详情对话框相关类型                                                                                          |
| `mobileEvent.ts`   | 移动端事件抽屉类型                                                                                              |
| `search.ts`        | `CalendarSearchEvent`、`CalendarSearchProps`                                                                    |
| `monthView.ts`     | 月视图虚拟滚动配置类型                                                                                          |
| `hook.ts`          | Hook 返回类型                                                                                                   |

详细类型参考见 [types.md](./types.md)。

---

## 7. Utils 模块

**目录**：`src/utils/`

**职责**：纯函数工具库，无副作用。

### 工具分类

| 分类          | 文件                    | 主要函数                                                        |
| ------------- | ----------------------- | --------------------------------------------------------------- |
| 事件创建      | `eventHelpers.ts`       | `createEvent()`、`createAllDayEvent()`、`createTimezoneEvent()` |
| 事件查询      | `eventUtils.ts`         | `getEventsForDay()`、`isMultiDayEvent()`、`getEventBgColor()`   |
| Temporal 检查 | `temporalTypeGuards.ts` | `isPlainDate()`、`isPlainDateTime()`、`isZonedDateTime()`       |
| Temporal 转换 | `temporal.ts`           | `temporalToDate()`、`dateToZonedDateTime()`、`now()`            |
| 日期计算      | `dateTimeUtils.ts`      | `addDays()`、`isSameDay()`、`getWeekRange()`                    |
| 时间格式化    | `dateFormat.ts`         | `formatDate()`、`formatTime()`、`formatEventTimeRange()`        |
| 时区处理      | `timeZoneUtils.ts`      | `getNowInTimeZone()`、`normalizeTimeZoneValue()`                |
| 颜色处理      | `colorUtils.ts`         | `buildColorBarGradient()`、`buildDiagonalPatternBackground()`   |
| 排序          | `allDaySort.ts`         | `sortAllDayByTitle()`、`createAllDayDisplayComparator()`        |
| ICS 导入导出  | `ics/`                  | `icsParser.ts`、`icsGenerator.ts`                               |
| 订阅          | `subscriptionUtils.ts`  | `subscribeCalendar()`                                           |
| 样式          | `styleUtils.ts`         | CSS 类名合并                                                    |
| 剪贴板        | `clipboardStore.ts`     | 事件剪贴板                                                      |

详细函数列表参考见 [api.md](./api.md)。

---

## 8. Locale 模块

**目录**：`src/locale/`

**职责**：国际化（i18n）系统，提供翻译、日期本地化、周/月标签。

### 文件说明

| 文件                 | 说明                                                      |
| -------------------- | --------------------------------------------------------- |
| `LocaleProvider.tsx` | Context 提供者，包裹应用根节点                            |
| `LocaleContext.tsx`  | Preact Context 定义                                       |
| `useLocale.ts`       | 消费 Locale 的 hook，返回 `t()`、`getWeekDaysLabels()` 等 |
| `translator.ts`      | 翻译函数实现，支持变量插值                                |
| `intl.ts`            | `Intl` API 封装（日期格式、周标签、月标签）               |
| `locales/en.ts`      | 英文翻译表                                                |

### 用法

```typescript
const { t, getWeekDaysLabels, getMonthLabels } = useLocale();

t('event.allDay'); // → 'All day'
getWeekDaysLabels('en', 'short', 1); // → ['Mon', 'Tue', ...]
getMonthLabels('en', 'long'); // → ['January', 'February', ...]
```

---

## 9. Plugins 模块

**目录**：`src/plugins/`

**职责**：内置扩展点，为拖拽和侧边栏等功能提供接入桥接。

| 文件               | 说明                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `eventsPlugin.ts`  | 事件服务插件，提供 `getAll()`、`getByDate()` 等查询 API，支持验证和自动重新计算          |
| `dragBridge.ts`    | 拖拽实现桥接：`registerDragImplementation()` 注册拖拽库，`useDragForView()` 在视图中使用 |
| `sidebarBridge.ts` | 侧边栏桥接：`registerSidebarImplementation()` 注册侧边栏组件，`useSidebarBridge()` 消费  |

### 插件使用示例

```typescript
import { createEventsPlugin, registerDragImplementation } from '@dayflow/core';
import { DayflowDrag } from '@dayflow/plugin-drag';

// 注册拖拽实现
registerDragImplementation(DayflowDrag);

// 创建应用时使用插件
const app = new CalendarApp({
  plugins: [createEventsPlugin({ enableValidation: true })],
});
```
