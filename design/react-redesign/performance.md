# 性能优化策略

## 核心问题分析

当前 Preact 版本的性能挑战：

1. **WeekView 5 层级联 memoization** — 一个输入变化导致所有下游全部重算
2. **月/年视图无虚拟滚动** — 大量 DOM 节点（Year 视图 ~365 个格子）
3. **tick 计数器触发全局重渲染** — 粒度太粗，任何变更都触发整个日历重渲染
4. **EventBlock 无 memo** — 事件列表变化时所有事件块全量重渲染

---

## 策略 1：细粒度 Context 订阅

**问题**：一个大 Context 里任何字段变化，所有消费者全部重渲染。

**解决**：按关注点分离 Context，组件只订阅自己关心的数据。

```tsx
// ❌ 反例：一个大 Context
const CalendarContext = createContext({
  events: [],
  currentDate: today,
  config: {},
  dragState: null,
  searchResults: [],
  theme: 'light',
});

// ✅ 正例：分离的 Context
const CalendarCoreContext = createContext({ store, navigation, config }); // 不变
const CalendarNavContext = createContext<NavigationState>(...);           // 导航变化时更新
const DragContext = createContext<DragState | null>(null);                // 拖拽时高频更新

// TimeGrid 只订阅导航（拖拽状态变化时不重渲染 TimeGrid）
function TimeGrid() {
  const nav = useContext(CalendarNavContext);
  // ...
}

// DragGhost 只订阅拖拽状态（高频更新，但只有 DragGhost 重渲染）
const DragGhost = memo(function DragGhost() {
  const drag = useContext(DragContext);
  // ...
});
```

---

## 策略 2：EventBlock 的最小化重渲染

单个事件块应该只在该事件数据变化时重渲染：

```tsx
// ❌ 反例：每次 events 数组变化（引用变化）都重渲染所有 EventBlock
function WeekView() {
  const events = useCalendarEvents(); // 返回新数组引用
  return events.map(e => <EventBlock event={e} />); // 全量重渲染
}

// ✅ 正例：用 Map 缓存，只有事件自身变化时重渲染
function useEventMap(): Map<string, Event> {
  const events = useCalendarEvents();
  return useMemo(() => new Map(events.map(e => [e.id, e])), [events]);
}

// EventBlock 接受 eventId，内部自己订阅单个事件
const EventBlock = memo(function EventBlock({ eventId }: { eventId: string }) {
  const eventMap = useContext(EventMapContext);
  const event = eventMap.get(eventId);
  // 只有 eventMap.get(eventId) 返回新引用时才重渲染
  // ...
});
```

更进一步：`CalendarStore.getEventSnapshot(id)` 返回单事件快照，只在该事件变化时通知：

```typescript
// CalendarStore 支持按 id 订阅
subscribeEvent(id: string, listener: Listener): () => void {
  // 只在该 id 对应的事件变化时调用 listener
}

getEventSnapshot(id: string): Event | undefined {
  return this.events.get(id);
}
```

```tsx
function useEvent(id: string): Event | undefined {
  const { store } = useContext(CalendarCoreContext);
  return useSyncExternalStore(
    cb => store.subscribeEvent(id, cb),
    () => store.getEventSnapshot(id)
  );
}
```

---

## 策略 3：布局计算缓存

布局算法（BFS grouping → parallel → nested → position）代价较高（O(N log N)），需要精确缓存：

```tsx
// 布局只依赖可见事件 + 视图配置，与导航无关
function useWeekLayout(
  visibleEvents: Event[],
  startHour: number,
  hourHeight: number
): Map<string, EventLayout> {
  return useMemo(
    () => calculateLayouts(visibleEvents, { startHour, hourHeight }),
    // 精确依赖：只有可见事件或配置变化时才重算
    [visibleEvents, startHour, hourHeight]
  );
}
```

**注意**：当前版本的 tick 计数器导致每次 tick++ 都触发布局重算，即使可见事件没有变化。新版本通过精确的 useMemo 依赖避免这个问题。

---

## 策略 4：React.memo 使用规范

**规则**：所有叶子组件必须用 `React.memo` 包裹。中间组件视情况。

```tsx
// 叶子组件：EventBlock
const EventBlock = memo(function EventBlock(props: EventBlockProps) { ... });

// 叶子组件：TimeLabel
const TimeLabel = memo(function TimeLabel({ hour }: { hour: number }) { ... });

// 中间组件：TimeColumn（包含多个 TimeLabel）
// 因为内部使用了 Context，频繁重渲染，建议也加 memo
const TimeColumn = memo(function TimeColumn() { ... });
```

**何时不用 memo**：

- 极简组件（渲染代价 < memo 比较代价），如纯文本节点
- 父组件自身很少重渲染的组件

---

## 策略 5：月/年视图虚拟滚动

月视图格子数：`5-6 weeks × 7 days = 35-42` 个格子，每格可能有多个事件 — DOM 节点总数可能达数百。

年视图：`12 months × ~35 cells = ~420` 个格子。

```tsx
// 使用 @tanstack/react-virtual 或自实现
import { useVirtualizer } from '@tanstack/react-virtual';

function MonthGrid() {
  const weeks = useMonthWeeks(); // 计算当月所有周

  const rowVirtualizer = useVirtualizer({
    count: weeks.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 120, // 每行预估高度
  });

  return (
    <div ref={scrollContainerRef} style={{ overflow: 'auto', height: '100%' }}>
      <div style={{ height: rowVirtualizer.getTotalSize() }}>
        {rowVirtualizer.getVirtualItems().map(virtualRow => (
          <WeekRow
            key={virtualRow.index}
            style={{ transform: `translateY(${virtualRow.start}px)` }}
            week={weeks[virtualRow.index]}
          />
        ))}
      </div>
    </div>
  );
}
```

---

## 策略 6：拖拽时的性能保障

拖拽期间 `mousemove` 触发频率可达 100+fps，必须避免布局重算：

```tsx
// 拖拽幽灵元素：只用 CSS transform，不触发 React 重渲染
function DragGhost() {
  const positionRef = useRef({ x: 0, y: 0 });
  const ghostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // 直接操作 DOM，绕过 React 渲染
      if (ghostRef.current) {
        ghostRef.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      }
    };
    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return <div ref={ghostRef} className='drag-ghost' />;
}

// 拖拽结束后才调用 store.updateEvent，触发一次 React 重渲染
```

**规则**：拖拽过程中只操作 CSS transform，不更新 state。`commitDrag()` 时才触发 store 更新。

---

## 策略 7：startTransition 降优先级

搜索、视图切换等非紧急更新用 `startTransition` 降优先级，保证交互响应：

```tsx
function SearchInput() {
  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value); // 紧急：输入框立即响应
    startTransition(() => {
      setSearchQuery(e.target.value); // 非紧急：搜索结果可以等
    });
  };

  return <input value={query} onChange={handleChange} />;
}
```

---

## 性能基准目标

| 指标                       | 目标值             |
| -------------------------- | ------------------ |
| 周视图初始渲染（100 事件） | < 50ms             |
| 导航（切换到下一周）       | < 16ms（单帧）     |
| 事件拖拽帧率               | 60fps（不卡顿）    |
| 月视图滚动（1年数据）      | 60fps              |
| 添加单个事件后重渲染范围   | 只有受影响的事件块 |

---

## React DevTools Profiler 使用指南

重写完成后用 Profiler 验证：

```tsx
import { Profiler } from 'react';

<Profiler
  id='WeekView'
  onRender={(id, phase, actualDuration) => {
    if (actualDuration > 16) {
      console.warn(
        `[Profiler] ${id} took ${actualDuration}ms in ${phase} phase`
      );
    }
  }}
>
  <WeekView />
</Profiler>;
```

重点检查：

1. 拖拽期间 `WeekView` 是否重渲染
2. 导航切换时 `EventBlock` 是否全量重渲染（应该只渲染新出现的事件）
3. 单个事件更新时影响范围（应该只重渲染该 EventBlock）
