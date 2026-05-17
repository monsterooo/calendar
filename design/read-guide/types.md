# TypeScript 类型体系

## 核心应用类型

### ICalendarApp

应用的公开接口，所有交互都通过此接口进行。

```typescript
interface ICalendarApp {
  // ── 状态 ──────────────────────────────────────────
  state: CalendarAppState;
  readonly timeZone: string;

  // ── 订阅 ──────────────────────────────────────────
  subscribe(listener: (app: ICalendarApp) => void): () => void;
  subscribeVisibleRangeChange(
    listener: (payload: VisibleRangePayload) => void
  ): () => void;
  subscribeEventChanges(listener: (changes: EventChange[]) => void): () => void;
  subscribeThemeChange(listener: (theme: ThemeMode) => void): () => void;

  // ── 视图导航 ──────────────────────────────────────
  changeView(view: CalendarViewType): void;
  getCurrentView(): CalendarView;
  setCurrentDate(date: Date): void;
  goToToday(): void;
  goToPrevious(): void;
  goToNext(): void;

  // ── 事件管理 ──────────────────────────────────────
  addEvent(event: Event): void;
  updateEvent(id: string, updates: Partial<Event>): Promise<void>;
  deleteEvent(id: string): Promise<void>;
  applyEventsChanges(changes: {
    add?: Event[];
    update?: { id: string; event: Partial<Event> }[];
    delete?: string[];
  }): void;
  undo(): void;

  // ── 事件交互（UI 层调用） ──────────────────────────
  selectEvent(id: string | null): void;
  highlightEvent(id: string | null): void;
  onEventClick(event: Event): void;
  onEventDoubleClick(event: Event): void;
  dismissUI(): void;

  // ── 日历管理 ──────────────────────────────────────
  getCalendars(): CalendarType[];
  createCalendar(calendar: CalendarType): Promise<void>;
  updateCalendar(id: string, updates: Partial<CalendarType>): void;
  deleteCalendar(id: string): Promise<void>;
  setCalendarVisibility(id: string, visible: boolean): void;

  // ── 权限 ──────────────────────────────────────────
  canMutateFromUI(calendarId?: string): boolean;
  getReadOnlyConfig(calendarId?: string): ReadOnlyConfig;

  // ── 主题 ──────────────────────────────────────────
  setTheme(mode: ThemeMode): void;

  // ── 插件 ──────────────────────────────────────────
  installPlugin(plugin: CalendarPlugin): void;
  getPlugin<T>(name: string): T | undefined;
  updatePluginConfig(name: string, config: Record<string, unknown>): void;
}
```

### CalendarAppState

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
  overrides: string[];
  allDaySortComparator?: AllDaySortComparator;
  timeZone: string;
}
```

### CalendarAppConfig

```typescript
interface CalendarAppConfig {
  views: CalendarView[];
  events?: Event[];
  calendars?: CalendarType[];
  plugins?: CalendarPlugin[];
  locale?: LocaleCode | Locale;
  timeZone?: TimeZoneValue;
  theme?: ThemeMode;
  readOnly?: boolean | ReadOnlyConfig;
  defaultView?: ViewType;
  selectedDate?: Date;
  callbacks?: CalendarCallbacks;
}
```

### CalendarCallbacks

```typescript
interface CalendarCallbacks {
  onEventCreate?: (event: Event) => void | Promise<void>;
  onEventUpdate?: (event: Event) => void | Promise<void>;
  onEventDelete?: (event: Event) => void | Promise<void>;
  onEventClick?: (event: Event) => void;
  onEventDoubleClick?: (event: Event) => void;
  onViewChange?: (view: CalendarView) => void;
  onDateChange?: (date: Date) => void;
  onRender?: () => void;
  onDismissUI?: () => void;
  onMoreEventsClick?: (date: Date, events: Event[]) => void;
}
```

---

## 事件类型

### Event

```typescript
interface Event {
  id: string;
  title: string;
  description?: string;

  // 支持 Temporal API — 推荐使用
  start: Temporal.PlainDate | Temporal.PlainDateTime | Temporal.ZonedDateTime;
  end: Temporal.PlainDate | Temporal.PlainDateTime | Temporal.ZonedDateTime;

  allDay?: boolean;
  icon?: boolean | ComponentChildren; // 自定义图标
  calendarId?: string; // 所属日历
  calendarIds?: string[]; // 跨多日历（展示用）
  meta?: Record<string, unknown>; // 业务自定义数据

  // 内部字段（库内部使用，不建议外部设置）
  day?: number;
  _originalStartHour?: number;
  _originalEndHour?: number;
}
```

**Temporal 类型选择指引**：

| 类型                     | 适用场景                                     |
| ------------------------ | -------------------------------------------- |
| `Temporal.PlainDate`     | 全天事件（无时间，无时区）                   |
| `Temporal.PlainDateTime` | 本地时间事件（有时间，无时区概念，跟随系统） |
| `Temporal.ZonedDateTime` | 跨时区事件（有明确时区，推荐全局时区场景）   |

### EventChange

```typescript
type EventMutationSource = 'local' | 'remote' | 'drag' | 'resize' | 'api';

type RawEventChange =
  | { type: 'create'; event: Event }
  | { type: 'update'; before: Event; after: Event }
  | { type: 'delete'; event: Event };

type EventChange = RawEventChange & { source: EventMutationSource };
```

### VisibleRangePayload

```typescript
interface VisibleRangePayload {
  start: Date;
  end: Date;
  reason: 'initial' | 'navigation' | 'viewChange' | 'scroll';
}
```

---

## 视图类型

### ViewType

```typescript
type ViewType = 'day' | 'week' | 'month' | 'year' | 'agenda' | 'resource';
```

### CalendarView

```typescript
interface CalendarView {
  type: ViewType;
  component: TComponent;
  config?: Record<string, unknown>;
}
```

### 视图配置类型

```typescript
// 所有视图共享基础配置
interface ViewFactoryConfig {
  defaultView?: boolean;
}

interface DayViewConfig extends ViewFactoryConfig {
  showAllDay?: boolean;
  scrollToCurrentTime?: boolean;
  secondaryTimeZone?: TimeZoneValue;
  showEventDots?: boolean;
}

interface WeekViewConfig extends ViewFactoryConfig {
  showWeekends?: boolean;
  startOfWeek?: number; // 0=周日，1=周一（默认）
  scrollToCurrentTime?: boolean;
  showAllDay?: boolean;
  gridDateClick?: 'day-view' | 'none' | ((date: Date, events: Event[]) => void);
  gridDateDoubleClick?:
    | 'create-event'
    | 'day-view'
    | 'none'
    | ((date: Date, events: Event[]) => void);
}

interface MonthViewConfig extends ViewFactoryConfig {
  showWeekNumbers?: boolean;
  showMonthIndicator?: boolean;
  startOfWeek?: number;
  snapToMonth?: boolean;
  eventHeight?: number;
  scroll?: {
    disabled?: boolean;
    transition?: boolean;
  };
}

interface YearViewConfig extends ViewFactoryConfig {
  mode?: 'year-canvas' | 'fixed-week' | 'grid';
  showTimedEventsInYearView?: boolean;
  gridHeatmapLevels?: number;
}

interface AgendaViewConfig extends ViewFactoryConfig {
  daysToShow?: number;
  showEmptyDays?: boolean;
}
```

---

## 日历类型

### CalendarType

```typescript
interface CalendarType {
  id: string;
  name: string;
  description?: string;
  colors: CalendarColors;
  darkColors?: CalendarColors; // 深色模式颜色（可选，未设置时自动计算）
  icon?: string;
  isDefault?: boolean;
  isVisible?: boolean;
  readOnly?: boolean; // 此日历只读
  source?: string;
  subscription?: {
    url: string;
    status: 'loading' | 'ready' | 'error';
    meta?: Record<string, unknown>;
  };
}

interface CalendarColors {
  eventColor: string; // 事件背景色
  eventSelectedColor: string; // 事件选中背景色
  lineColor: string; // 侧边线颜色
  textColor: string; // 文字颜色
}
```

### ThemeMode

```typescript
type ThemeMode = 'light' | 'dark' | 'auto';
```

---

## 布局类型

### EventLayout

事件布局计算的输出，供渲染器定位事件卡片。

```typescript
interface EventLayout {
  id: string;
  left: number; // 百分比，相对于列容器
  width: number; // 百分比
  zIndex: number;
  level: number; // 嵌套层级（0 = 顶层）
  isPrimary: boolean; // 是否为该时间段的主事件
  indentOffset: number; // 视觉缩进偏移
  importance: number; // 优先级分数
}
```

### LAYOUT_CONFIG

```typescript
const LAYOUT_CONFIG = {
  INDENT_STEP: 2, // 嵌套缩进步长（px）
  MIN_WIDTH: 25, // 最小宽度（%）
  MARGIN_BETWEEN: 2, // 事件间距（px）
  CONTAINER_WIDTH: 320, // 参考容器宽度
  OVERLAP_THRESHOLD: 0.25, // 判定重叠的最小时间比例
  EDGE_MARGIN: 3, // 容器边距
  MAX_LOAD_IMBALANCE: 0, // 最大负载不平衡（用于 rebalance）
  REBALANCE_THRESHOLD: 2, // 触发重平衡的最小事件数
};
```

---

## 配置类型

### ReadOnlyConfig

```typescript
interface ReadOnlyConfig {
  draggable?: boolean; // true = 允许拖拽（即使只读）
  viewable?: boolean; // true = 允许查看详情
}
```

传入 `readOnly: true` 等同于 `readOnly: { draggable: false, viewable: true }`。

### DragConfig

```typescript
interface DragConfig {
  enableDrag?: boolean;
  enableResize?: boolean;
  enableCreate?: boolean; // 在时间网格上拖拽创建事件
  enableAllDayCreate?: boolean; // 在全天行拖拽创建
  supportedViews?: ViewType[];
}
```

---

## 时区类型

```typescript
// IANA 时区字符串的枚举（部分）
enum TimeZone {
  UTC = 'UTC',
  NEW_YORK = 'America/New_York',
  LONDON = 'Europe/London',
  PARIS = 'Europe/Paris',
  TOKYO = 'Asia/Tokyo',
  SHANGHAI = 'Asia/Shanghai',
  SYDNEY = 'Australia/Sydney',
  // ... 等数十个时区
}

type TimeZoneValue = TimeZone | string; // 也可直接传 IANA 字符串
```

---

## 搜索类型

```typescript
type CalendarSearchEvent = Event & {
  color?: string; // 所属日历颜色（用于搜索结果展示）
};

interface CalendarSearchProps {
  debounceDelay?: number; // 搜索防抖延迟（默认 300ms）

  // 方式1：同步自定义过滤
  customSearch?: (params: {
    keyword: string;
    events: CalendarSearchEvent[];
  }) => CalendarSearchEvent[];

  // 方式2：异步搜索（后端 API）
  onSearch?: (keyword: string) => Promise<CalendarSearchEvent[]>;

  // 点击搜索结果的自定义处理
  onResultClick?: (params: {
    event: CalendarSearchEvent;
    app: ICalendarApp;
    source?: 'desktop' | 'mobile';
    defaultAction: () => void; // 执行默认行为（跳转+高亮）
    closeSearch: () => void;
  }) => void;
}
```

---

## 插槽类型

```typescript
interface CustomRendering {
  id: string; // 自动生成的唯一 ID
  containerEl: HTMLElement; // Preact 渲染的占位符 div
  generatorName: string | null; // 插槽名称，如 'eventContent'
  generatorArgs: unknown; // 传递给框架适配器的参数
}
```

### 已知插槽名称

| generatorName         | 说明             | generatorArgs 类型         |
| --------------------- | ---------------- | -------------------------- |
| `'titleBar'`          | 标题栏           | `{ app }`                  |
| `'eventContent'`      | 事件卡片内容     | `EventContentSlotArgs`     |
| `'eventContextMenu'`  | 事件右键菜单     | `EventContextMenuSlotArgs` |
| `'gridContextMenu'`   | 网格空白右键菜单 | `GridContextMenuSlotArgs`  |
| `'eventDetailDialog'` | 事件详情对话框   | 对话框 props               |
| `'eventDetailPanel'`  | 事件详情浮动面板 | 面板 props                 |
| `'mobileEventDrawer'` | 移动端事件抽屉   | 抽屉 props                 |
| `'searchDrawer'`      | 搜索抽屉         | 搜索 props                 |

---

## 插件类型

```typescript
interface CalendarPlugin {
  name: string;
  install(app: ICalendarApp): void;
  config?: Record<string, unknown>;
  api?: unknown;
}

interface EventsService {
  getAll(): Event[];
  getById(id: string): Event | undefined;
  add(event: Event): void;
  update(id: string, updates: Partial<Event>): void | Promise<void>;
  getByDate(date: Date): Event[];
  getByDateRange(startDate: Date, endDate: Date): Event[];
  validateEvent(event: Partial<Event>): string[];
}
```

---

## 日期数据类型

```typescript
interface DayData {
  date: Date;
  day: number; // 日（1-31）
  month: number; // 月（0-11）
  year: number;
  monthName: string;
  isToday: boolean;
}

interface WeeksData {
  days: DayData[];
  startDate: Date;
  monthYear: {
    month: string;
    monthIndex: number;
    year: number;
  };
}
```
