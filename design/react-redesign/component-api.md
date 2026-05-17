# 公开组件 API 设计

## 设计原则

1. **Compound Component 模式** — 用户通过组合子组件控制布局，而非一堆 boolean props
2. **最小化必填 props** — 能推断的不要求传，能有默认值的给默认值
3. **受控 / 非受控双模式** — 视图类型、当前日期可受控，也可内部管理
4. **TypeScript 优先** — 所有 props 有完整类型，泛型在有意义的地方使用

---

## 根组件 `<Calendar>`

```tsx
interface CalendarProps {
  // 初始配置（非受控初始值）
  defaultDate?: PlainDate;
  defaultView?: ViewType;

  // 受控模式
  currentDate?: PlainDate;
  currentView?: ViewType;
  onDateChange?: (date: PlainDate) => void;
  onViewChange?: (view: ViewType) => void;

  // 主题
  theme?: 'light' | 'dark' | 'system';

  // 国际化
  locale?: string; // 'zh-CN' | 'en-US' | ...

  // 只读
  readOnly?: boolean;

  // 自定义类名
  className?: string;

  // 子组件
  children: ReactNode;
}

// 用法
<Calendar defaultView='week' locale='zh-CN'>
  <Calendar.Sidebar />
  <Calendar.Content>
    <WeekView />
  </Calendar.Content>
</Calendar>;
```

`Calendar` 是 `CalendarProvider` 的语法糖，内部创建所有 core-ts 实例并通过 Context 提供。

---

## 复合子组件

### `<Calendar.Sidebar>`

```tsx
interface CalendarSidebarProps {
  // 是否显示（非受控）
  defaultCollapsed?: boolean;
  // 受控
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  // 自定义渲染
  renderMiniCalendar?: (props: MiniCalendarProps) => ReactNode;
  renderCalendarList?: (props: CalendarListProps) => ReactNode;
  children?: ReactNode;
}
```

### `<Calendar.Content>`

```tsx
interface CalendarContentProps {
  children: ReactNode; // 放置视图组件
  className?: string;
}
```

### `<Calendar.Toolbar>`

```tsx
interface CalendarToolbarProps {
  // 内置导航按钮（可按需关闭）
  showNavigation?: boolean;
  showViewSwitcher?: boolean;
  showToday?: boolean;
  // 扩展区域
  renderStart?: () => ReactNode; // 工具栏左侧
  renderEnd?: () => ReactNode; // 工具栏右侧
}
```

---

## 视图组件

所有视图组件通过 Context 消费数据，props 只接受**视图级别的配置**：

### `<DayView>`

```tsx
interface DayViewProps {
  // 时间范围
  startHour?: number; // 默认 0
  endHour?: number; // 默认 24
  // 高度
  hourHeight?: number; // px，默认 72
  // 显示时间刻度
  timeFormat?: '12h' | '24h';
  // 插槽（自定义渲染，见 custom-rendering.md）
  slots?: DayViewSlots;
}
```

### `<WeekView>`

```tsx
interface WeekViewProps extends DayViewProps {
  // 一周从哪天开始
  weekStartsOn?: 0 | 1 | 6; // 0=周日, 1=周一, 6=周六
  // 隐藏周末
  hideWeekend?: boolean;
  slots?: WeekViewSlots;
}
```

### `<MonthView>`

```tsx
interface MonthViewProps {
  // 一周从哪天开始
  weekStartsOn?: 0 | 1 | 6;
  // 每格最多显示几个事件（超出显示 "+N more"）
  maxEventsPerCell?: number;
  slots?: MonthViewSlots;
}
```

### `<YearView>`

```tsx
interface YearViewProps {
  weekStartsOn?: 0 | 1 | 6;
  slots?: YearViewSlots;
}
```

### `<AgendaView>`

```tsx
interface AgendaViewProps {
  // 向前看多少天
  daysToShow?: number; // 默认 30
  // 是否显示空日期
  showEmptyDays?: boolean;
  slots?: AgendaViewSlots;
}
```

---

## 受控 vs 非受控模式

视图导航遵循 React 的受控/非受控约定：

```tsx
// 非受控（内部管理状态）
<Calendar defaultDate={today} defaultView='week'>
  <WeekView />
</Calendar>;

// 受控（外部管理状态）
const [date, setDate] = useState(today);
const [view, setView] = useState<ViewType>('week');

<Calendar
  currentDate={date}
  currentView={view}
  onDateChange={setDate}
  onViewChange={setView}
>
  <WeekView />
</Calendar>;
```

---

## 事件回调 API

```tsx
<Calendar
  onEventClick={(event: Event) => {}}
  onEventCreate={(range: TimeRange) => {}}
  onEventUpdate={(change: EventChange) => {}}
  onEventDelete={(eventId: string) => {}}
  onDateClick={(date: PlainDate) => {}}
  onRangeChange={(range: { start: PlainDate; end: PlainDate }) => {}}
>
```

这些回调通过 `CalendarProvider` 注入，内部任何组件都可以触发，不需要 props 透传。

---

## 命令式 API（useCalendarActions）

需要从外部调用日历操作时，使用 hook 获取命令式接口：

```tsx
function MyToolbar() {
  const actions = useCalendarActions();

  return (
    <div>
      <button onClick={() => actions.navigate('today')}>今天</button>
      <button onClick={() => actions.navigate('prev')}>上一周</button>
      <button onClick={() => actions.navigate('next')}>下一周</button>
      <button onClick={() => actions.setView('month')}>月视图</button>
      <button onClick={() => actions.addEvent(newEvent)}>添加事件</button>
    </div>
  );
}

// useCalendarActions 的完整类型
interface CalendarActions {
  navigate(target: 'today' | 'prev' | 'next' | PlainDate): void;
  setView(view: ViewType): void;
  addEvent(event: Omit<Event, 'id'> & { id?: string }): string; // 返回 id
  updateEvent(
    id: string,
    patch: Partial<Event>,
    source?: EventMutationSource
  ): void;
  removeEvent(id: string, source?: EventMutationSource): void;
  setEvents(events: Event[]): void; // 全量替换
  applyChanges(changes: EventChange[]): void; // 事务批量应用
  setTheme(theme: 'light' | 'dark' | 'system'): void;
  setLocale(locale: string): void;
  setReadOnly(readOnly: boolean): void;
}
```

---

## 状态读取（useCalendarState）

```tsx
function MyComponent() {
  const state = useCalendarState();
  // state.currentDate — 当前日期
  // state.currentView — 当前视图
  // state.visibleRange — 可见日期范围
  // state.theme — 当前主题
  // state.readOnly — 是否只读
}

function useEventsInRange(start: PlainDate, end: PlainDate) {
  const events = useCalendarEvents(); // 全量事件
  return useMemo(
    () => events.filter(e => /* 日期范围过滤 */),
    [events, start, end]
  );
}
```

---

## 与当前版本 API 对比

| 当前（Preact）                      | 新版（React）                | 变化说明           |
| ----------------------------------- | ---------------------------- | ------------------ |
| `createCalendar(config)` 命令式创建 | `<Calendar>` JSX 声明式      | 更 React 化        |
| `app.navigate('prev')`              | `actions.navigate('prev')`   | 通过 hook 获取     |
| `app.setEvents(events)`             | `actions.setEvents(events)`  | 同上               |
| `app.subscribe(callback)`           | `useSyncExternalStore`       | 框架原生，无需手动 |
| `createWeekView(config)` 工厂函数   | `<WeekView startHour={8} />` | 更直观             |
| `eventsPlugin.setEvents(events)`    | `actions.setEvents(events)`  | 统一接口           |
