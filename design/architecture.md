# 整体架构

## 包依赖关系

```
框架适配器层
  @dayflow/react
  @dayflow/vue
  @dayflow/svelte
  @dayflow/angular
        │
        │  依赖
        ▼
  @dayflow/core  ◄──── 本文档关注点
        │
        │  依赖
        ▼
  @dayflow/ui-context-menu
  @dayflow/ui-range-picker
  @dayflow/blossom-color-picker
  preact
  temporal-polyfill
  tailwindcss

独立插件包（不被 core 依赖，但与 core 配合使用）
  @dayflow/plugin-drag
  @dayflow/plugin-sidebar
  @dayflow/plugin-localization
  @dayflow/plugin-keyboard-shortcuts

日历同步包
  @dayflow/caldav
  @dayflow/google-sync
  @dayflow/outlook-sync
```

---

## 分层架构

```
┌──────────────────────────────────────────────────┐
│  外部（框架适配器 / 应用代码）                      │
│  React / Vue / Svelte / Angular 组件              │
└──────────────────────┬───────────────────────────┘
                       │ new CalendarApp() / mount()
                       ▼
┌──────────────────────────────────────────────────┐
│  状态核心层  src/core/                             │
│                                                  │
│  CalendarApp          ← 唯一状态来源              │
│  ├─ EventManager      ← 事件 CRUD + 撤销          │
│  ├─ CalendarStore     ← 内存存储 + 事务            │
│  ├─ NavigationController ← 视图/日期导航           │
│  ├─ CalendarRegistry  ← 日历类型/颜色管理          │
│  ├─ PluginManager     ← 插件生命周期              │
│  └─ CalendarPermissions ← 权限控制               │
└──────────────────────┬───────────────────────────┘
                       │ subscribe / notify
                       ▼
┌──────────────────────────────────────────────────┐
│  渲染层  src/renderer/                            │
│                                                  │
│  CalendarRenderer     ← 挂载点 + RAF 批量渲染      │
│  CalendarRoot         ← UI 组件树根节点            │
│  CustomRenderingStore ← 插槽注册表                 │
│  ContentSlot          ← 跨框架渲染占位符           │
└──────────────────────┬───────────────────────────┘
                       │ render()
                       ▼
┌──────────────────────────────────────────────────┐
│  UI 层  src/components/ + src/views/              │
│                                                  │
│  CalendarHeader       ← 导航栏                    │
│  DayView / WeekView / MonthView / YearView / Agenda │
│  CalendarEvent        ← 事件卡片                  │
│  EventLayoutCalculator ← 重叠事件布局计算          │
│  通用组件（对话框、搜索、颜色选择器等）               │
└──────────────────────┬───────────────────────────┘
                       │ createXxxView() / plugin
                       ▼
┌──────────────────────────────────────────────────┐
│  扩展层  src/factories/ + src/plugins/            │
│                                                  │
│  createDayView / createWeekView / ...            │
│  eventsPlugin / dragBridge / sidebarBridge       │
└──────────────────────────────────────────────────┘
```

---

## 核心设计模式

### 1. 观察者模式（Observer）

所有 UI 更新由 `CalendarApp` 的订阅机制驱动，组件无需直接访问 store。

```typescript
// 应用订阅 — 任何状态变化时触发
const unsubscribe = app.subscribe(app => {
  /* re-render */
});

// 事件变化订阅 — 仅事件 CRUD 时触发，带变化来源
app.subscribeEventChanges((changes: EventChange[]) => {
  changes.filter(c => c.source !== 'remote').forEach(persist);
});

// 可见范围订阅 — 视图范围切换时触发
app.subscribeVisibleRangeChange(({ start, end, reason }) => {
  fetchRemoteEvents(start, end);
});
```

### 2. 工厂模式（Factory）

视图通过工厂函数创建，隐藏内部实现，对外只暴露配置接口。

```typescript
const weekView = createWeekView({
  showWeekends: true,
  startOfWeek: 1, // Monday
  scrollToCurrentTime: true,
});
// 返回 { type: 'week', component: WeekView, config: {...} }
```

### 3. 插件模式（Plugin）

功能通过插件扩展，插件可访问完整的 `ICalendarApp` 接口。

```typescript
const plugin: CalendarPlugin = {
  name: 'my-plugin',
  install(app: ICalendarApp) {
    app.subscribe(() => {
      /* 响应状态变化 */
    });
  },
  api: {
    /* 导出给外部调用 */
  },
};
app.installPlugin(plugin);
```

### 4. 适配器/门户模式（ContentSlot）

`ContentSlot` 是 Preact 组件树中的占位符，允许 React/Vue 等外部框架通过 `CustomRenderingStore` 渲染自己的组件到 Preact 树中。

```
Preact 树                     框架适配器（React）
─────────────────             ────────────────────
CalendarRoot                  ReactCalendarAdapter
  └─ ContentSlot              subscribe(store)
       (containerEl)    ◄─── portal(ReactComponent, containerEl)
```

### 5. 事务模式（Transaction）

`CalendarStore` 支持事务，将多个事件操作合并为一次原子通知。

```typescript
store.beginTransaction();
store.createEvent(e1);
store.updateEvent(id, updates);
store.deleteEvent(id2);
store.endTransaction(); // 一次性分发合并后的变化
```

### 6. 策略模式（EventMutationSource）

每次事件变化都携带来源标记，调用方根据来源决定处理策略。

| 来源     | 含义         | 典型处理             |
| -------- | ------------ | -------------------- |
| `local`  | 用户 UI 操作 | 持久化到后端         |
| `remote` | 远程同步写入 | 跳过写回，避免死循环 |
| `drag`   | 拖拽操作     | 可显示确认 UI        |
| `resize` | 调整大小     | 可显示确认 UI        |
| `api`    | 编程调用     | 按业务决定           |

---

## 技术选型

| 技术                  | 用途          | 选择原因                                                               |
| --------------------- | ------------- | ---------------------------------------------------------------------- |
| **Preact**            | UI 渲染       | 体积小（3KB gzip），与 React API 兼容，适合作为库的内部渲染引擎        |
| **Temporal API**      | 日期时间      | 原生解决时区歧义问题，`PlainDate/PlainDateTime/ZonedDateTime` 语义清晰 |
| **TailwindCSS**       | 样式          | 原子类减少样式冲突，利于在宿主应用中集成                               |
| **TypeScript**        | 类型安全      | 完整的类型导出，提升使用方的开发体验                                   |
| **temporal-polyfill** | Temporal 兼容 | 在旧浏览器中支持 Temporal API                                          |

---

## 构建输出

```
dist/
├── index.esm.js          # ESM 主出口（Preact 组件 + 工具函数）
├── index.d.ts            # TypeScript 类型声明
├── styles.css            # 完整样式（Tailwind Utilities + 组件样式）
└── styles.components.css # 仅组件专用样式
```

使用时需手动引入样式：

```typescript
import '@dayflow/core/dist/styles.css';
```
