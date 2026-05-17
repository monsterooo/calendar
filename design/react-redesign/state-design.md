# 状态管理设计

## 核心问题：外部 Store 与 React 的集成

当前 Preact 版本用自定义的 `subscribe` + tick 计数器（`++tick` → useMemo 失效）来触发重渲染。这个模式在 React 18 并发模式下不安全（tearing 问题）。

**解决方案**：用 `useSyncExternalStore`，这是 React 官方为外部 store 设计的 API，天然解决 tearing。

---

## CalendarStore 设计

CalendarStore 是核心数据容器，需要暴露 React 需要的两个接口：

```typescript
// packages/core-ts/src/store/CalendarStore.ts

type Listener = () => void;

class CalendarStore {
  private events: Map<string, Event> = new Map();
  private listeners: Set<Listener> = new Set();
  private snapshot: readonly Event[] = [];

  // React useSyncExternalStore 需要的接口
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): readonly Event[] {
    return this.snapshot; // 引用稳定，只有真正变化时才生成新数组
  }

  // 内部变更后更新 snapshot 并通知
  private emit(): void {
    this.snapshot = Array.from(this.events.values());
    this.listeners.forEach(fn => fn());
  }

  // --- 业务方法 ---
  addEvents(events: Event[]): void {
    events.forEach(e => this.events.set(e.id, e));
    this.emit();
  }

  updateEvent(id: string, patch: Partial<Event>): void {
    const existing = this.events.get(id);
    if (!existing) return;
    this.events.set(id, { ...existing, ...patch });
    this.emit();
  }

  removeEvent(id: string): void {
    this.events.delete(id);
    this.emit();
  }

  // 事务提交（批量变更，只 emit 一次）
  applyTransaction(changes: EventChange[]): void {
    changes.forEach(change => this.applyChange(change));
    this.emit(); // 批量后统一通知
  }
}
```

**关键设计点**：

- `snapshot` 引用只在 `emit()` 时更新 — React 可以安全比较 `prev === current`
- `applyTransaction` 批量操作后只调用一次 `emit()` — 避免中间状态触发多次渲染

---

## NavigationController 设计

```typescript
// packages/core-ts/src/navigation/NavigationController.ts

class NavigationController {
  private currentDate: PlainDate;
  private viewType: ViewType;
  private listeners: Set<Listener> = new Set();
  private snapshot: NavigationState;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): NavigationState {
    return this.snapshot;
  }

  navigate(date: PlainDate): void {
    this.currentDate = date;
    this.updateSnapshot();
    this.emit();
  }

  setViewType(view: ViewType): void {
    this.viewType = view;
    this.updateSnapshot();
    this.emit();
  }

  private updateSnapshot(): void {
    const range = this.calculateRange(this.currentDate, this.viewType);
    // 只在真正变化时生成新对象
    this.snapshot = {
      currentDate: this.currentDate,
      viewType: this.viewType,
      ...range,
    };
  }
}
```

---

## ConfigManager 设计（修复通知缺失问题）

当前版本 `ConfigManager.updateConfig` 只改值，不通知任何订阅者。这导致动态更新配置（如切换 readOnly 模式）不生效。

```typescript
// packages/core-ts/src/config/ConfigManager.ts

class ConfigManager {
  private config: CalendarConfig;
  private listeners: Set<Listener> = new Set();
  private snapshot: CalendarConfig;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): CalendarConfig {
    return this.snapshot;
  }

  // 修复：更新后立即通知
  updateConfig(patch: Partial<CalendarConfig>): void {
    this.config = { ...this.config, ...patch };
    this.snapshot = this.config; // 新引用触发重渲染
    this.listeners.forEach(fn => fn());
  }
}
```

---

## Hooks 层：useSyncExternalStore 封装

```typescript
// packages/react/src/hooks/useCalendarEvents.ts

export function useCalendarEvents(): readonly Event[] {
  const { store } = useContext(CalendarContext);
  return useSyncExternalStore(
    store.subscribe.bind(store),
    store.getSnapshot.bind(store)
  );
}

// packages/react/src/hooks/useNavigation.ts
export function useNavigation(): NavigationState {
  const { navigation } = useContext(CalendarContext);
  return useSyncExternalStore(
    navigation.subscribe.bind(navigation),
    navigation.getSnapshot.bind(navigation)
  );
}

// packages/react/src/hooks/useConfig.ts
export function useConfig(): CalendarConfig {
  const { config } = useContext(CalendarContext);
  return useSyncExternalStore(
    config.subscribe.bind(config),
    config.getSnapshot.bind(config)
  );
}
```

---

## Context 层：CalendarProvider 整合

```tsx
// packages/react/src/context/CalendarProvider.tsx

interface CalendarContextValue {
  store: CalendarStore;
  navigation: NavigationController;
  config: ConfigManager;
  layout: LayoutEngine;
  locale: LocaleManager;
}

const CalendarContext = createContext<CalendarContextValue | null>(null);

export function CalendarProvider({
  children,
  initialConfig,
}: {
  children: ReactNode;
  initialConfig?: Partial<CalendarConfig>;
}) {
  // 用 useRef 持有不变的核心实例，避免 re-render 重建
  const coreRef = useRef<CalendarContextValue | null>(null);
  if (!coreRef.current) {
    const config = new ConfigManager(initialConfig);
    const store = new CalendarStore();
    const navigation = new NavigationController(config);
    const layout = new LayoutEngine(config);
    const locale = new LocaleManager(config);
    coreRef.current = { store, navigation, config, layout, locale };
  }

  return (
    <CalendarContext.Provider value={coreRef.current}>
      {children}
    </CalendarContext.Provider>
  );
}
```

**关键点**：

- 用 `useRef` 而非 `useState` 持有 core 实例 — 实例引用永远不变，不触发重渲染
- `initialConfig` 只用于初始化，后续通过 `config.updateConfig()` 更新

---

## 状态分层与细粒度订阅

避免"一个大 Context 触发全树重渲染"的反模式：

```
❌ 反模式：
CalendarContext = { events, currentDate, config, dragState, searchResults, ... }
// 任何一个字段变化都触发整棵树重渲染

✅ 正确：分离关注点
CalendarContext         = { store, navigation, config }  // 核心实例（不变）
CalendarStateContext    = useCalendarEvents()             // 事件数据
CalendarNavContext      = useNavigation()                 // 导航状态
CalendarConfigContext   = useConfig()                     // 配置
DragContext             = useDragState()                  // 拖拽（高频）
SlotContext             = { slots }                       // 插槽注册（极少变）
```

使用方式：组件只订阅自己关心的 Context：

```tsx
// TimeGrid 只关心可见范围，不关心拖拽
function TimeGrid() {
  const { visibleStart, visibleEnd } = useContext(CalendarNavContext);
  // 导航变化时重渲染，拖拽状态变化时不重渲染
}

// EventBlock 只关心拖拽状态
function EventBlock({ event }) {
  const drag = useContext(DragContext);
  const isDragging = drag?.eventId === event.id;
  // 只有本事件被拖拽时重渲染
}
```

---

## 事务提交模式（防止中间状态闪烁）

外部数据源同步时（如 WebSocket 推送大量事件更新），需要批量提交：

```typescript
// 外部 hooks 使用事务确保原子更新
function useExternalSync(store: CalendarStore, socket: WebSocket) {
  useEffect(() => {
    socket.onmessage = e => {
      const changes: EventChange[] = JSON.parse(e.data);
      // 批量事务：所有变更合并后只触发一次 React 重渲染
      store.applyTransaction(changes);
    };
  }, [store]);
}
```

等价于 React 18 的 `flushSync` / `startTransition` 语义，但发生在 core-ts 层。

---

## EventMutationSource 保留（防写回循环）

与当前版本相同，保留 `EventMutationSource` 类型，双向同步时用于跳过写回：

```typescript
type EventMutationSource = 'local' | 'remote' | 'drag' | 'resize';

// 订阅变更时携带来源信息
store.subscribeChanges((changes, source) => {
  if (source === 'remote') return; // 来自服务端的变更不回传
  pushToServer(changes);
});
```
