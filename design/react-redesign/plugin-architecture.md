# 插件系统设计

## 核心问题：消灭全局 Bridge

当前版本的问题：

```typescript
// packages/core/src/plugins/dragBridge.ts（当前版本）
let impl: DragImplementation | null = null; // ← 全局变量！

export function registerDragImplementation(dragImpl: DragImplementation) {
  impl = dragImpl; // 多个 Calendar 实例会互相覆盖
}
```

这在同一页面存在多个日历实例时会产生 bug（后注册的覆盖前者）。

---

## 新方案：插件即 React Provider

每个插件是一个 React Provider，生命周期由 React 管理：

```tsx
// 用法
<Calendar>
  <EventsPlugin events={myEvents} onEventChange={handleChange}>
    <DragPlugin onDragEnd={handleDragEnd}>
      <SidebarPlugin>
        <WeekView />
      </SidebarPlugin>
    </DragPlugin>
  </EventsPlugin>
</Calendar>
```

每个 `<Calendar>` 实例有自己独立的插件栈，互不干扰。

---

## EventsPlugin 设计

管理事件数据，替代当前的 `createEventsPlugin()`：

```tsx
// packages/react/src/plugins/EventsPlugin.tsx

interface EventsPluginProps {
  events: Event[];
  onEventChange?: (change: EventChange, source: EventMutationSource) => void;
  onEventCreate?: (range: TimeRange) => void;
  onEventDelete?: (eventId: string) => void;
  children: ReactNode;
}

export function EventsPlugin({
  events,
  onEventChange,
  onEventCreate,
  onEventDelete,
  children,
}: EventsPluginProps) {
  const { store } = useContext(CalendarContext);

  // 外部 events 变化时同步到 store（remote source，防写回）
  useEffect(() => {
    store.setEvents(events, 'remote');
  }, [events, store]);

  // 订阅 store 变化，回调给外部（只回传 local/drag/resize 来源）
  useEffect(() => {
    if (!onEventChange) return;
    return store.subscribeChanges((changes, source) => {
      if (source === 'remote') return; // 防止写回循环
      changes.forEach(change => onEventChange(change, source));
    });
  }, [store, onEventChange]);

  // 注入 onEventCreate 到 Context，供视图组件使用
  return (
    <EventsPluginContext.Provider value={{ onEventCreate, onEventDelete }}>
      {children}
    </EventsPluginContext.Provider>
  );
}
```

**修复当前版本的 bug**：当前 `eventsPlugin` 直接 mutate `app.state.events` 绕过 EventManager。新版本全部通过 `store.setEvents()` 走正规路径。

---

## DragPlugin 设计

替代当前的全局 `dragBridge`：

```tsx
// packages/react/src/plugins/DragPlugin.tsx

interface DragPluginProps {
  onDragEnd?: (event: Event, newTime: PlainDateTime) => void;
  onResizeEnd?: (event: Event, newDuration: Duration) => void;
  // 拖拽约束
  snapMinutes?: number; // 拖拽吸附间隔，默认 15
  disabled?: boolean;
  children: ReactNode;
}

interface DragContextValue {
  dragState: DragState | null;
  startDrag: (eventId: string, startPosition: Position) => void;
  updateDrag: (position: Position) => void;
  commitDrag: () => void;
  cancelDrag: () => void;
}

const DragContext = createContext<DragContextValue | null>(null);

export function DragPlugin({
  onDragEnd,
  onResizeEnd,
  snapMinutes = 15,
  disabled,
  children,
}: DragPluginProps) {
  const { store } = useContext(CalendarContext);
  const [dragState, setDragState] = useState<DragState | null>(null);

  const startDrag = useCallback(
    (eventId: string, startPosition: Position) => {
      if (disabled) return;
      const event = store.getEvent(eventId);
      if (!event) return;
      setDragState({
        eventId,
        event,
        startPosition,
        currentPosition: startPosition,
      });
    },
    [disabled, store]
  );

  const commitDrag = useCallback(() => {
    if (!dragState) return;
    const newTime = calculateNewTime(dragState);
    // 先乐观更新 store（drag source，防写回循环）
    store.updateEvent(dragState.eventId, { startTime: newTime }, 'drag');
    // 再回调给外部
    onDragEnd?.(dragState.event, newTime);
    setDragState(null);
  }, [dragState, store, onDragEnd]);

  return (
    <DragContext.Provider
      value={{ dragState, startDrag, updateDrag, commitDrag, cancelDrag }}
    >
      {children}
    </DragContext.Provider>
  );
}
```

**关键改进**：

- `dragState` 存在组件 state 中，而不是全局变量
- 多个 `<Calendar>` 实例各自有独立的 `DragPlugin`，互不干扰
- `disabled` prop 可以在运行时动态切换

---

## SidebarPlugin 设计

替代当前的 `sidebarBridge`：

```tsx
// packages/react/src/plugins/SidebarPlugin.tsx

interface SidebarPluginProps {
  calendars?: CalendarType[];
  onCalendarToggle?: (calendarId: string, visible: boolean) => void;
  onCalendarCreate?: () => void;
  children: ReactNode;
}

interface SidebarContextValue {
  visibleCalendars: Set<string>;
  toggleCalendar: (id: string) => void;
  calendars: CalendarType[];
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarPlugin({
  calendars = [],
  onCalendarToggle,
  children,
}: SidebarPluginProps) {
  const [visibleCalendars, setVisibleCalendars] = useState<Set<string>>(
    () => new Set(calendars.map(c => c.id))
  );

  const toggleCalendar = useCallback(
    (id: string) => {
      setVisibleCalendars(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        onCalendarToggle?.(id, next.has(id));
        return next;
      });
    },
    [onCalendarToggle]
  );

  return (
    <SidebarContext.Provider
      value={{ visibleCalendars, toggleCalendar, calendars }}
    >
      {children}
    </SidebarContext.Provider>
  );
}
```

---

## 插件间通信

插件之间通过 CalendarContext 的 core-ts 实例通信，不直接相互依赖：

```
DragPlugin ──(store.updateEvent)──→ CalendarStore
                                         ↓
                              EventsPlugin.subscribeChanges
                                         ↓
                                   onEventChange(user)
```

DragPlugin 不需要知道 EventsPlugin 的存在，只和 CalendarStore 打交道。

---

## 自定义插件 API

用户可以创建自己的插件：

```tsx
// 自定义插件示例：颜色标签插件
interface ColorTagPluginProps {
  getEventColor: (event: Event) => string;
  children: ReactNode;
}

const ColorTagContext = createContext<{
  getColor: (event: Event) => string;
} | null>(null);

export function ColorTagPlugin({
  getEventColor,
  children,
}: ColorTagPluginProps) {
  return (
    <ColorTagContext.Provider value={{ getColor: getEventColor }}>
      {children}
    </ColorTagContext.Provider>
  );
}

// 在自定义 eventContent slot 中使用
function MyEventContent({ event }: EventContentProps) {
  const colorTag = useContext(ColorTagContext);
  const color = colorTag?.getColor(event) ?? '#3b82f6';
  return <div style={{ backgroundColor: color }}>{event.title}</div>;
}
```

---

## 插件注册协议（高级）

如果插件需要向 core-ts 注册行为（如自定义事件布局规则），通过一个稳定的注册 API：

```typescript
// 高级插件通过 useCalendarPlugin hook 注册
function useCalendarPlugin(plugin: CalendarPlugin): void {
  const { store } = useContext(CalendarContext);

  useEffect(() => {
    const cleanup = plugin.install(store);
    return cleanup; // unmount 时自动清理
  }, [plugin, store]);
}

interface CalendarPlugin {
  install(store: CalendarStore): () => void; // 返回 cleanup
}
```

---

## 与当前版本对比

| 问题（当前）                         | 解决方案（新版）                     |
| ------------------------------------ | ------------------------------------ |
| `dragBridge` 全局 `let impl = null`  | `DragPlugin` Provider，每实例独立    |
| `sidebarBridge` 同样的全局问题       | `SidebarPlugin` Provider             |
| 插件 `install(app)` 生命周期手动管理 | React `useEffect` + cleanup 自动管理 |
| `eventsPlugin` 直接 mutate state     | 通过 `store.setEvents()` 正规路径    |
| 无法在运行时切换插件                 | Provider 可以有条件挂载/卸载         |
