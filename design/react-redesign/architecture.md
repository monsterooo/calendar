# 整体分层架构

## 架构总图

```
┌─────────────────────────────────────────────────────────┐
│                     应用层 (App Layer)                    │
│   <Calendar>  <DayView>  <WeekView>  <MonthView> ...     │
└────────────────────────┬────────────────────────────────┘
                         │ React JSX / Compound Components
┌────────────────────────▼────────────────────────────────┐
│                   组件层 (Component Layer)                │
│   CalendarShell  TimeGrid  AllDayRow  EventBlock ...     │
│                 使用 Context 消费状态                      │
└────────────────────────┬────────────────────────────────┘
                         │ useContext
┌────────────────────────▼────────────────────────────────┐
│                  Context 层 (Context Layer)               │
│   CalendarContext  SlotContext  LocaleContext             │
│   PluginContext  DragContext  ThemeContext                │
└────────────────────────┬────────────────────────────────┘
                         │ useSyncExternalStore / useReducer
┌────────────────────────▼────────────────────────────────┐
│                    Hooks 层 (Hooks Layer)                 │
│   useCalendarState  useEvents  useNavigation             │
│   useLayout  useSearch  useDrag  useConfig               │
└────────────────────────┬────────────────────────────────┘
                         │ subscribe / getSnapshot
┌────────────────────────▼────────────────────────────────┐
│              纯 TS 核心层 (Pure TS Core Layer)            │
│   CalendarStore  EventManager  NavigationController      │
│   ConfigManager  LayoutEngine  LocaleManager             │
│   (零 React 依赖，可单独 Node.js 运行/测试)               │
└─────────────────────────────────────────────────────────┘
```

---

## 各层职责与边界

### 1. 纯 TS 核心层（`packages/core-ts`）

**职责**：所有业务逻辑，零框架依赖。

| 模块                   | 职责                                                             |
| ---------------------- | ---------------------------------------------------------------- |
| `CalendarStore`        | 事件存储，`Map<id, Event>`，事务提交，变更通知                   |
| `EventManager`         | 增删改查事件，apply/rollback 事务                                |
| `NavigationController` | 当前日期导航，范围计算                                           |
| `ConfigManager`        | 配置读写，**变更时触发 emit**                                    |
| `LayoutEngine`         | 事件布局算法（BFS grouping → ParallelGroup → nested → position） |
| `LocaleManager`        | 多语言字符串，日期格式化                                         |

**边界规则**：

- 不能 `import` 任何 React/Preact API
- 状态变更通过 EventEmitter/callback 通知，不依赖框架响应式
- 所有方法返回值是不可变快照（`Readonly<T>`）

---

### 2. Hooks 层（`packages/react/src/hooks`）

**职责**：将纯 TS 核心的 push 通知桥接到 React 的 pull 模型。

核心模式：

```typescript
// 每个 hook 包装一个 core-ts 的 subscribe + getSnapshot
function useCalendarEvents(store: CalendarStore): readonly Event[] {
  return useSyncExternalStore(
    callback => store.subscribe(callback),
    () => store.getSnapshot()
  );
}
```

**完整 hooks 列表**：

| Hook               | 消费来源             | 返回值              |
| ------------------ | -------------------- | ------------------- |
| `useCalendarState` | CalendarStore        | `CalendarAppState`  |
| `useEvents`        | CalendarStore        | `Event[]`           |
| `useVisibleRange`  | NavigationController | `{ start, end }`    |
| `useCurrentDate`   | NavigationController | `PlainDate`         |
| `useConfig`        | ConfigManager        | `CalendarConfig`    |
| `useLayout`        | LayoutEngine         | `EventLayout[]`     |
| `useLocale`        | LocaleManager        | `LocaleTokens`      |
| `useDragState`     | DragController       | `DragState \| null` |
| `useSearchResults` | SearchController     | `SearchResult[]`    |

**边界规则**：

- hooks 不含渲染逻辑，只返回数据和操作函数
- hooks 内部不互相 `useContext` — 纯粹消费 core-ts

---

### 3. Context 层（`packages/react/src/context`）

**职责**：向组件树分发 core-ts 实例和计算后的状态，避免 props drilling。

```
CalendarProvider（根）
├── 持有 CalendarStore 实例
├── 持有 NavigationController 实例
├── 提供 CalendarContext（核心实例）
├── 提供 CalendarStateContext（当前状态快照）
├── 提供 SlotContext（自定义渲染注册表）
├── 提供 LocaleContext（当前语言包）
├── 提供 ThemeContext（明/暗/系统）
└── 提供 DragContext（拖拽状态）
```

**Context 设计原则**：

- 每个 Context 只包含一类关注点（避免大 Context 触发全树重渲染）
- 高频变更的状态（如拖拽坐标）独立 Context，低频不变的（locale、theme）合并

---

### 4. 组件层（`packages/react/src/components`）

**职责**：UI 渲染，从 Context 消费数据，不直接持有状态。

设计模式：**Compound Components**

```tsx
// 组合使用，而非单一巨型组件
<Calendar>
  <Calendar.Sidebar />
  <Calendar.Content>
    <WeekView />
  </Calendar.Content>
</Calendar>

// 组件内部通过 useContext(CalendarContext) 获取数据
// 而非通过 props 逐层传递
```

**边界规则**：

- 组件不直接 `import` CalendarStore 类 — 通过 Context 获取实例
- 叶子组件（EventBlock、TimeSlot）用 `React.memo` 包裹
- 不在组件内做布局计算 — 调用 `useLayout` hook

---

### 5. 插件层（`packages/react/src/plugins`）

**职责**：以 React Provider 形式挂载，提供可选功能。

```tsx
<Calendar>
  <EventsPlugin events={events} onEventChange={handler}>
    <DragPlugin>
      <WeekView />
    </DragPlugin>
  </EventsPlugin>
</Calendar>
```

每个插件 Provider：

- 在 mount 时注册到 CalendarContext
- 在 unmount 时自动清理（React useEffect cleanup）
- 通过 Context 注入能力，不修改全局状态

---

## 模块依赖图

```
react (app layer)
  └── @dayflow/react
        ├── components/ ──→ context/
        ├── context/ ──────→ hooks/
        ├── hooks/ ────────→ @dayflow/core-ts
        ├── plugins/ ──────→ context/ + @dayflow/core-ts
        └── @dayflow/core-ts (zero deps)
```

单向依赖，无循环。

---

## 重写路线图

```
阶段 1: 提取 core-ts 层
  - 从当前 core 中剥离纯 TS 模块
  - 补全 ConfigManager 的 emit 机制
  - 为每个 store 添加 subscribe/getSnapshot 接口

阶段 2: 实现 hooks 层
  - 用 useSyncExternalStore 封装每个 store
  - 单测 hooks（React Testing Library）

阶段 3: 实现 Context + Provider
  - CalendarProvider 整合所有 store 实例
  - 完成 SlotContext 替代 ContentSlot

阶段 4: 实现视图组件
  - DayView → WeekView → MonthView（由简到繁）
  - 每个视图使用 React.memo + 细粒度 context

阶段 5: 插件迁移
  - EventsPlugin, DragPlugin, SidebarPlugin
  - 消灭 dragBridge 全局变量

阶段 6: 性能优化
  - 引入虚拟滚动（Month/Year 视图）
  - Profiler 验证重渲染范围
```
