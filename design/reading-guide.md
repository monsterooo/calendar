# 源码阅读指南

适合从零开始系统学习 `@dayflow/core` 的完整路径。每一阶段建立在前一阶段的基础上，按顺序阅读可以避免"看到代码却不知道它在做什么"的困惑。

---

## 阅读原则

- **先看类型，再看实现**：TypeScript 接口就是模块的契约，读懂接口就读懂了一半
- **先看最小单元，再看组合**：CalendarStore（纯存储）→ EventManager（业务）→ CalendarApp（组合）
- **先看数据流向，再看具体组件**：明白状态如何流动，每个组件的位置就自然清楚了

---

## 第一阶段：数据契约（1–2 小时）

> 目标：建立对"这个系统操作什么数据"的完整认知，后续一切代码都基于这些类型。

### 1. `src/types/event.ts`

系统中最核心的业务实体。重点理解：

- `start` / `end` 字段为什么是联合类型（`PlainDate | PlainDateTime | ZonedDateTime`）
- `calendarId` vs `calendarIds`（单日历和多日历归属的区别）
- `_originalStartHour` 等内部字段的注释（跨天事件布局稳定性）

### 2. `src/types/calendarTypes.ts`

理解日历（`CalendarType`）和颜色（`CalendarColors`）的数据结构，以及 `ThemeMode`。这两个文件很短，5 分钟读完。

### 3. `src/types/core.ts` ⭐ 最重要

这是全局契约文件，读懂它就掌握了系统的全貌。重点阅读：

- `ViewType` 枚举——5 种视图的标识
- `CalendarCallbacks`——系统向外部暴露的所有事件钩子
- `CalendarAppConfig`——初始化参数，理解系统支持什么能力
- `CalendarAppState`——运行时内部状态，理解系统跟踪什么
- `ICalendarApp`——**公共 API 接口**，包含所有方法签名。这是最重要的接口，花时间把每个方法都读一遍
- `EventMutationSource`、`RawEventChange`、`EventChange`——事件变化的数据结构

### 4. `src/types/factory.ts`

理解每种视图的配置结构（`WeekViewConfig`、`MonthViewConfig` 等），以及 `BaseViewProps`（所有视图组件的通用 props）。

---

## 第二阶段：状态核心（2–3 小时）

> 目标：理解应用状态是如何被管理的，数据如何进出系统。

### 5. `src/core/CalendarStore.ts` ⭐

**从这里开始理解状态管理**，这是最简单的一层：

- 内部结构：`Map<string, Event>` + 事务队列 `pendingChanges[]`
- 4 个核心方法：`createEvent`、`updateEvent`、`deleteEvent`、`getEvent`
- 事务机制：`beginTransaction / endTransaction` 和 `normalizeChanges` 的合并逻辑
- 两个回调：`onEventChange`（单条）和 `onEventBatchChange`（批量）

这个文件非常干净，~190 行，是理解整个状态管理的基础。

### 6. `src/core/events/EventManager.ts`

在 CalendarStore 之上加入业务逻辑：

- 如何包装 store 的 CRUD，加入来源标记（`EventMutationSource`）
- 撤销栈（`undoStack`）的实现——最多保存 50 个事件快照
- 外部事件（external events）的管理——订阅日历的事件单独存储
- 如何触发 `onEventCreate / onEventUpdate / onEventDelete` 回调

### 7. `src/core/navigation/NavigationController.ts`

理解导航状态的管理：

- `changeView`、`setCurrentDate`、`goToPrevious / goToNext` 的实现
- `emitVisibleRange`——视图范围变化时通知订阅者
- `RangeChangeReason` 的各种来源

### 8. `src/core/calendarRegistry.ts`

日历类型和颜色的管理中心：

- 日历的 CRUD 方法
- `getCalendarColorsForHex`——如何从 hex 颜色反查最接近的日历颜色
- 深色模式颜色的降级逻辑

### 9. `src/core/permissions/CalendarPermissions.ts`

很短，重点看 `canMutateFromUI` 的判断逻辑——如何结合全局 readOnly 和单日历 readOnly 计算最终权限。

### 10. `src/core/plugins/PluginManager.ts`

插件的注册、查找和配置更新，为后续理解插件系统做铺垫。

### 11. `src/core/CalendarApp.ts` ⭐

**核心整合器**。到这里，前面的所有模块都会出现在这里：

- 构造函数如何初始化所有子模块
- 每个 `ICalendarApp` 接口方法如何委托到具体的子模块
- `notify()`——如何通知所有订阅者
- `subscribe / subscribeEventChanges / subscribeVisibleRangeChange`——订阅机制

读这个文件时，边读边对照 `ICalendarApp` 接口，确认每个方法都能找到对应实现。

---

## 第三阶段：公开入口（30 分钟）

> 目标：理解外部使用者看到的是什么。

### 12. `src/index.ts`

快速扫描导出清单，建立对"哪些东西是对外公开的"的整体印象。不需要深读，知道导出了什么即可。

### 13. `src/core/useCalendarApp.ts`

如何将 `CalendarApp` 包装为框架可用的 Hook，理解生命周期绑定。

---

## 第四阶段：渲染系统（2–3 小时）

> 目标：理解状态如何变成 DOM，以及跨框架渲染插槽的机制。

### 14. `src/renderer/CustomRenderingStore.ts`

**先读这个，再读 ContentSlot**，否则 ContentSlot 的意义不清楚：

- 内部 `Map<id, CustomRendering>` 和 `Set<generatorName>` 结构
- `register / unregister`（ContentSlot 调用）
- `setOverrides`（框架适配器调用）
- `subscribe` vs `subscribeToOverrides`（两种订阅粒度，以及为什么要区分）

### 15. `src/renderer/ContentSlot.tsx`

读完 CustomRenderingStore 后，这个组件的逻辑会很清晰：

- `useLayoutEffect` 同步注册（避免一帧闪烁）
- 如何检测 `isOverridden` 并决定渲染默认内容还是空 div

### 16. `src/renderer/hooks/useAppSubscription.ts`

理解 `tick` 的设计——为什么不直接存 events，而是存一个递增计数器。这是 Preact 渲染优化的关键。

### 17. `src/renderer/CalendarRenderer.tsx`

挂载/卸载逻辑：

- `mount(container)` 如何用 `requestAnimationFrame` 确保同步首次渲染
- `render()` 的 RAF 节流——为什么不直接调用
- 如何将 `CustomRenderingStore` 注入组件树

### 18. `src/renderer/CalendarRoot.tsx` ⭐

**最复杂的渲染文件**，建议最后读：

- 先快速扫描整体结构（哪些 hook，哪些 UI 区域）
- 重点看 8 个 hook 的调用和返回值如何被组合
- 理解 `dismissUI` 的链式处理
- 理解桌面 vs 移动的分支逻辑

---

## 第五阶段：视图层（2–3 小时）

> 目标：理解各种视图是如何实现的，以及工厂模式的使用。

### 19. `src/factories/index.ts`（或任意一个 createXxxView.ts）

从最简单的开始，理解工厂函数做了什么——本质上就是 `{ type, component, config }` 的包装。

### 20. `src/views/WeekView.tsx` ⭐

**从周视图开始**，它最完整、最有代表性：

- 时间网格（TimeGrid）的构建
- 全天事件行（AllDayRow）的处理
- 拖拽集成（`useDragForView`）
- 移动端滑动（`useWeekViewSwipe`）
- 事件布局（`EventLayoutCalculator.calculateDayEventLayouts`）

### 21. `src/views/DayView.tsx`

周视图的简化版（单列），对比阅读，理解共性和差异。

### 22. `src/views/MonthView.tsx`

和前两个视图截然不同的布局范式：

- 虚拟滚动（`useVirtualMonthScroll`）
- 月份行的构建方式
- 跨天事件（MultiDayEvent）的处理

### 23. `src/views/AgendaView.tsx`（可选）

最简单的视图，线性列表，可快速阅读。

---

## 第六阶段：事件卡片与布局（2–3 小时）

> 目标：理解事件是如何被定位和渲染的。

### 24. `src/components/eventLayout/`（按顺序读）

按算法执行顺序：

1. `constants.ts`——先看常量，理解阈值含义
2. `types.ts`——`LayoutWeekEvent`、`LayoutNode`、`ParallelGroup`
3. `utils.ts`——`eventsOverlap`、`shouldBeParallel`、`canEventContain`（核心判断函数）
4. `calculate/grouping.ts`——BFS 分组 + 平行小组分析
5. `calculate/structure.ts`——建立嵌套树（最复杂）
6. `calculate/rebalance.ts`——负载重平衡
7. `calculate/layout.ts`——从树计算 left/width
8. `index.tsx`——整体入口，串联上面所有步骤

> 详细算法解析见 [event-layout-algorithm.md](./event-layout-algorithm.md)

### 25. `src/components/calendarEvent/CalendarEvent.tsx`

事件卡片主组件。关注：

- 如何接收 `EventLayout` 并转换为 CSS 定位
- 选中/高亮状态的样式切换

### 26. `src/components/calendarEvent/hooks/useEventActions.ts`

事件交互动作——点击、双击、右键菜单的处理链路。

### 27. `src/components/calendarEvent/hooks/useEventStyles.ts`

颜色、边框、阴影的计算逻辑，如何从 `CalendarRegistry` 获取颜色。

---

## 第七阶段：通用组件（1 小时，按需阅读）

> 可以按需查阅，不需要全部阅读。

| 文件                                            | 阅读时机               |
| ----------------------------------------------- | ---------------------- |
| `components/common/CalendarHeader.tsx`          | 想了解顶部导航栏实现时 |
| `components/common/MiniCalendar.tsx`            | 想了解侧边小日历时     |
| `components/common/DefaultEventDetailPanel.tsx` | 想了解事件详情面板时   |
| `components/common/QuickCreateEventPopup.tsx`   | 想了解快速创建事件时   |
| `components/contextMenu/`                       | 想了解右键菜单时       |
| `components/mobileEventDrawer/`                 | 想了解移动端事件编辑时 |
| `components/search/`                            | 想了解搜索功能时       |

---

## 第八阶段：Hooks（1 小时）

> 理解跨视图复用的交互逻辑。

### 28. `src/hooks/useCalendarDrop.ts`

从侧边栏日历拖放到视图创建事件的完整流程，包括对订阅日历的只读保护。

### 29. `src/hooks/useWeekViewSwipe.ts`

移动端水平滑动翻页的实现，关注 `setPointerCapture` 的使用和 CSS transform 动画。

### 30. `src/hooks/virtualScroll/useVirtualMonthScroll.ts`（可选）

月视图的虚拟滚动实现，关注滚动事件的节流和 OVERSCAN 缓冲区逻辑。

---

## 第九阶段：支撑系统（1–2 小时，按需）

### 31. `src/locale/`

按顺序：`types.ts` → `translator.ts` → `LocaleContext.tsx` → `LocaleProvider.tsx` → `useLocale.ts`

### 32. `src/plugins/eventsPlugin.ts`

了解如何通过插件暴露 `EventsService` API（`getByDate`、`getByDateRange` 等）。

### 33. `src/plugins/dragBridge.ts` + `src/plugins/sidebarBridge.ts`

理解桥接模式——core 包如何不直接依赖拖拽/侧边栏的具体实现。

### 34. `src/utils/`（按需查阅）

不需要全读，按需查阅。优先级：

1. `temporal.ts` + `temporalTypeGuards.ts`——Temporal API 的工具函数
2. `eventHelpers.ts`——创建事件的工厂函数
3. `dateTimeUtils.ts`——日期计算
4. `timeZoneUtils.ts`——时区处理

---

## 第十阶段：样式系统（30 分钟）

### 35. `src/styles/classNames.ts`

导出的样式类名，用于外部覆盖时的精确定位。

### 36. `src/styles/core/`（扫描）

扫一遍各 CSS 文件的结构，了解样式的组织方式（events/views/overlays/common）。

---

## 学习路径总结

```
第一阶段：数据契约
  event.ts → calendarTypes.ts → core.ts ★ → factory.ts

第二阶段：状态核心
  CalendarStore → EventManager → NavigationController
  → calendarRegistry → Permissions → PluginManager → CalendarApp ★

第三阶段：公开入口
  index.ts → useCalendarApp.ts

第四阶段：渲染系统
  CustomRenderingStore → ContentSlot → useAppSubscription
  → CalendarRenderer → CalendarRoot ★

第五阶段：视图层
  factories → WeekView ★ → DayView → MonthView

第六阶段：事件卡片与布局
  eventLayout/（按内部顺序）★ → CalendarEvent → hooks

第七阶段：通用组件（按需）

第八阶段：Hooks
  useCalendarDrop → useWeekViewSwipe

第九阶段：支撑系统（按需）
  locale → plugins → utils

第十阶段：样式
  classNames.ts → styles/core/
```

**★ 标记的文件是必读核心，其余文件可按需深入。**

---

## 调试技巧

读代码时结合以下方式会更有效：

**1. 追踪一次事件创建**

从 `app.addEvent(event)` 开始，在 IDE 中跳转：

```
CalendarApp.addEvent
  → EventManager.addEvent
    → CalendarStore.createEvent
      → onEventChange(change)
    → callbacks.onEventCreate?.(event)
    → notifyEventChangeListeners
    → triggerRender()
      → notify()
        → CalendarRenderer.requestRender()
          → render()
```

**2. 追踪一次视图渲染**

从 `CalendarRenderer.render()` 开始，找到 `CalendarRoot` 如何读取 `app.state` 并选择要渲染的视图组件。

**3. 追踪一次拖拽操作**

从 `DragRef` 开始，找 `handleMoveStart` → `handleDragMove` → `handleDragEnd` → `app.updateEvent`。

**4. 查阅文档辅助**

阅读对应模块时，同步参考 `design/` 下的文档：

- 不确定数据结构时 → [data-structures.md](./data-structures.md)
- 不理解布局算法时 → [event-layout-algorithm.md](./event-layout-algorithm.md)
- 想了解完整数据流时 → [data-flow.md](./data-flow.md)
- 查阅某个方法时 → [api.md](./api.md)
