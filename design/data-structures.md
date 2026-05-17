# 底层数据结构

本文档基于源码中的实际类型定义，梳理核心数据结构及其关系。

---

## 总览：数据结构关系图

```
┌──────────────────────────────────────────────────────────────────┐
│                      CalendarAppState                            │
│                                                                  │
│  currentView: CalendarViewType                                   │
│  currentDate: Date                                               │
│  events: Event[]  ◄─────────────────── 核心业务数据               │
│  plugins: Map<string, CalendarPlugin>                            │
│  views: Map<CalendarViewType, CalendarView>                      │
│  readOnly: boolean | ReadOnlyConfig                              │
│  timeZone: string                                                │
└──────────────────────┬───────────────────────────────────────────┘
                       │ 包含
       ┌───────────────┼───────────────────┐
       ▼               ▼                   ▼
  ┌─────────┐    ┌──────────────┐    ┌──────────────┐
  │  Event  │    │ CalendarType │    │ CalendarView │
  └────┬────┘    └──────┬───────┘    └──────┬───────┘
       │                │                   │
       │ 运行时产生       │ 包含              │ 包含
       ▼                ▼                   ▼
  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐
  │ EventChange │  │ CalendarColors│  │  ViewFactoryConfig │
  │  (带 source)│  │ (4个颜色字段)│  │  (DayViewConfig 等)│
  └─────────────┘  └──────────────┘  └───────────────────┘
       │
       │ 布局计算
       ▼
  ┌─────────────┐    ┌──────────────┐    ┌──────────────┐
  │ EventLayout │    │  EventGroup  │    │  NestedLayer │
  │ (位置/宽度) │◄───│  (重叠分组)  │◄───│  (嵌套层级) │
  └─────────────┘    └──────────────┘    └──────────────┘
       │
       │ 拖拽交互
       ▼
  ┌──────────────┐    ┌─────────────────────┐
  │    DragRef   │    │   UnifiedDragRef     │
  │ (Week/Day 拖)│    │ (通用拖拽，含月视图) │
  └──────────────┘    └─────────────────────┘
```

---

## 一、核心实体

### 1.1 Event（日历事件）

> 源文件：`src/types/event.ts`

```typescript
interface Event {
  id: string; // 必填，全局唯一
  title: string; // 必填，事件标题
  description?: string;

  // 时间字段 — 使用 Temporal API
  start: Temporal.PlainDate | Temporal.PlainDateTime | Temporal.ZonedDateTime;
  end: Temporal.PlainDate | Temporal.PlainDateTime | Temporal.ZonedDateTime;

  allDay?: boolean; // 全天事件标记（可从 start 类型推断）
  icon?: boolean | ComponentChildren; // 事件图标（true=默认图标，ReactNode=自定义）

  calendarId?: string; // 所属日历 ID（单日历）
  calendarIds?: string[]; // 所属日历 ID 列表（多日历，优先于 calendarId）

  meta?: Record<string, unknown>; // 业务自定义数据（透明传递）

  // ── 内部字段（不建议外部设置）──
  day?: number; // 渲染用：所在列索引
  _originalStartHour?: number; // 跨天布局稳定性用
  _originalEndHour?: number;
}
```

**时间类型的选择逻辑**：

```
Event.start / Event.end 的类型
        │
        ├─ Temporal.PlainDate
        │    → 无时间，无时区
        │    → allDay = true（全天事件）
        │    → 示例：假期、生日
        │
        ├─ Temporal.PlainDateTime    ← 推荐默认
        │    → 有时间，无时区（跟随系统/全局 timeZone）
        │    → 示例：普通会议、提醒
        │
        └─ Temporal.ZonedDateTime
             → 有时间，有明确时区
             → 跨时区场景（出差、国际会议）
             → 示例：start = 2025-05-17T10:00[America/New_York]
```

---

### 1.2 CalendarType（日历分类）

> 源文件：`src/types/calendarTypes.ts`

```typescript
interface CalendarType {
  id: string; // 唯一标识，如 'work'、'personal'
  name: string; // 显示名称，如 'Work'、'个人'
  description?: string;
  colors: CalendarColors; // 浅色主题颜色（必填）
  darkColors?: CalendarColors; // 深色主题颜色（不填则自动计算）
  icon?: string; // emoji 或图标名称
  isDefault?: boolean; // 是否系统默认
  isVisible?: boolean; // 是否可见
  readOnly?: boolean; // 是否只读（禁止拖拽/编辑）
  source?: string; // 来源，如 'Google Calendar'、'iCloud'
  subscription?: {
    url: string;
    status: 'loading' | 'ready' | 'error';
    meta?: Record<string, unknown>;
  };
}

interface CalendarColors {
  eventColor: string; // 事件卡片背景色
  eventSelectedColor: string; // 事件选中时背景色
  lineColor: string; // 侧边线颜色
  textColor: string; // 文字颜色
}
```

**颜色在事件中的应用路径**：

```
CalendarType.colors.eventColor
        │
        ├─ 浅色主题：直接使用
        └─ 深色主题：优先 CalendarType.darkColors.eventColor
                    不存在 → calendarRegistry 自动计算深色版本
```

---

### 1.3 CalendarView（视图定义）

> 源文件：`src/types/core.ts`

```typescript
interface CalendarView {
  type: CalendarViewType; // 视图类型标识（如 'week'、'month'）
  label?: string; // 视图显示名称（视图切换器中显示）
  component: TComponent; // Preact 组件（视图的渲染实现）
  config?: Record<string, unknown>; // 视图配置（工厂函数传入的选项）
}

// ViewType 枚举
enum ViewType {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year',
  AGENDA = 'agenda',
  RESOURCE = 'resource',
}
```

---

## 二、应用状态

### 2.1 CalendarAppState（运行时状态）

> 源文件：`src/types/core.ts`

```typescript
interface CalendarAppState {
  // ── 当前视图/日期 ──
  currentView: CalendarViewType;
  currentDate: Date;

  // ── 数据 ──
  events: Event[]; // 当前可见事件列表
  plugins: Map<string, CalendarPlugin>; // 已安装插件
  views: Map<CalendarViewType, CalendarView>; // 可用视图

  // ── UI 状态 ──
  switcherMode?: ViewSwitcherMode; // 视图切换器形式（按钮/下拉）
  highlightedEventId?: string | null; // 搜索高亮事件 ID
  selectedEventId?: string | null; // 当前选中事件 ID（触发详情面板）
  overrides: string[]; // 框架适配器已声明的覆盖插槽名称

  // ── 配置 ──
  locale: string | Locale;
  readOnly: boolean | ReadOnlyConfig;
  allDaySortComparator?: AllDaySortComparator;
  timeZone: string; // IANA 时区字符串（已解析）
}
```

**highlightedEventId vs selectedEventId 的区别**：

| 字段                 | 触发方式     | 用途            | UI 效果                        |
| -------------------- | ------------ | --------------- | ------------------------------ |
| `highlightedEventId` | 搜索结果点击 | 视图跳转定位    | 事件卡片高亮样式               |
| `selectedEventId`    | 用户点击事件 | 详情面板/对话框 | 事件卡片选中样式 + 触发详情 UI |

---

### 2.2 CalendarAppConfig（初始化配置）

> 源文件：`src/types/core.ts`

```typescript
interface CalendarAppConfig {
  // ── 必填 ──
  views: CalendarView[]; // 视图列表（至少一个）

  // ── 数据 ──
  events?: Event[]; // 初始事件
  calendars?: CalendarType[]; // 日历列表
  plugins?: CalendarPlugin[]; // 插件

  // ── 回调 ──
  callbacks?: CalendarCallbacks;

  // ── 初始 UI 状态 ──
  defaultView?: CalendarViewType; // 初始视图类型
  initialDate?: Date; // 初始日期
  switcherMode?: ViewSwitcherMode;
  defaultCalendar?: string; // 默认日历 ID（新建事件归属）

  // ── 外观/行为 ──
  theme?: ThemeConfig; // { mode: 'light' | 'dark' | 'auto', colors?: ... }
  locale?: string | Locale;
  timeZone?: TimeZoneValue; // 默认系统时区
  readOnly?: boolean | ReadOnlyConfig;
  allDaySortComparator?: AllDaySortComparator;

  // ── UI 开关 ──
  useEventDetailDialog?: boolean; // 使用对话框模式详情
  useEventDetailPanel?: boolean; // 使用面板模式详情
  useCalendarHeader?: boolean; // 是否渲染顶部导航栏
}
```

---

### 2.3 ReadOnlyConfig（权限控制）

> 源文件：`src/types/core.ts`

```typescript
interface ReadOnlyConfig {
  draggable?: boolean; // true = 允许拖拽（即使是只读模式）
  viewable?: boolean; // true = 允许查看详情
}
```

**语义说明**：

| `readOnly` 值         | draggable | viewable | 含义                     |
| --------------------- | --------- | -------- | ------------------------ |
| `false`               | 允许      | 允许     | 完全可编辑               |
| `true`                | 禁止      | 禁止     | 完全只读                 |
| `{ draggable: true }` | 允许      | 禁止     | 只读但可拖拽（看板场景） |
| `{ viewable: true }`  | 禁止      | 允许     | 不可改但可查看详情       |

---

## 三、变更与事务

### 3.1 EventChange（事件变化记录）

> 源文件：`src/types/core.ts`

```typescript
// 原始变化（不含来源信息）
type RawEventChange =
  | { type: 'create'; event: Event }
  | { type: 'update'; before: Event; after: Event }
  | { type: 'delete'; event: Event };

// 带来源标记的变化（对外暴露）
type EventChange = RawEventChange & { source: EventMutationSource };

type EventMutationSource =
  | 'local' // 用户通过 UI 操作（点击保存、键盘删除等）
  | 'remote' // 外部同步写入（CalDAV、Google Sync 等）— 不应触发写回
  | 'drag' // 拖拽操作
  | 'resize'; // 调整大小操作
```

**来源标记的处理策略**：

```typescript
app.subscribeEventChanges(changes => {
  for (const change of changes) {
    switch (change.source) {
      case 'local':
      case 'drag':
      case 'resize':
        // 用户发起的修改 → 持久化到数据库
        persistToDB(change);
        break;
      case 'remote':
        // 外部同步写入 → 跳过，避免写回死循环
        break;
    }
  }
});
```

---

### 3.2 CalendarStore（内存存储结构）

> 源文件：`src/core/CalendarStore.ts`

**内部数据结构**：

```
CalendarStore {
  events: Map<string, Event>   // key = event.id，O(1) CRUD
  isInTransaction: boolean
  pendingChanges: RawEventChange[]   // 事务期间的缓冲队列
  onEventChange?:      (change: RawEventChange) => void   // 单条回调
  onEventBatchChange?: (changes: RawEventChange[]) => void // 批量回调
}
```

**事务期间的变化合并规则**（CalendarStore.normalizeChanges）：

```
同一事件 ID 的多次操作会被合并为一条有效变化：

前序操作          + 当前操作       = 合并结果
─────────────────────────────────────────────
create(A)         + update(A→B)   = create(B)
create(A)         + delete(A)     = （抵消，不通知）
update(A→B)       + update(B→C)   = update(A→C)
update(A→B)       + delete(B)     = delete(A)
delete(A)         + create(B)     = update(A→B)
```

---

### 3.3 CalendarCallbacks（全量回调）

> 源文件：`src/types/core.ts`

```typescript
interface CalendarCallbacks {
  // 事件 CRUD（逐条通知）
  onEventCreate?: (event: Event) => void | Promise<void>;
  onEventUpdate?: (event: Event) => void | Promise<void>;
  onEventDelete?: (eventId: string) => void | Promise<void>;

  // 批量变化通知（推荐用于批量同步）
  onEventBatchChange?: (changes: EventChange[]) => void | Promise<void>;

  // 视图/日期变化
  onViewChange?: (view: CalendarViewType) => void | Promise<void>;
  onDateChange?: (date: Date) => void | Promise<void>;
  onVisibleRangeChange?: (
    start: Date,
    end: Date,
    reason: RangeChangeReason
  ) => void | Promise<void>;

  // 用户交互
  onEventClick?: (event: Event) => void | Promise<void>;
  onEventDoubleClick?: (
    event: Event,
    e: MouseEvent
  ) => boolean | undefined | Promise<boolean | undefined>;
  onMoreEventsClick?: (date: Date) => void | Promise<void>;
  onDismissUI?: () => void | Promise<void>;

  // 日历 CRUD
  onCalendarCreate?: (calendar: CalendarType) => void | Promise<void>;
  onCalendarUpdate?: (calendar: CalendarType) => void | Promise<void>;
  onCalendarDelete?: (calendarId: string) => void | Promise<void>;
  onCalendarMerge?: (
    sourceId: string,
    targetId: string
  ) => void | Promise<void>;
  onCalendarReorder?: (
    fromIndex: number,
    toIndex: number
  ) => void | Promise<void>;

  // UI 状态同步（与框架适配器配合）
  onEventDetailToggle?: (eventId: string | null) => void;
  onMobileEventDetailToggle?: (event: Event | null) => void;

  // 生命周期
  onRender?: () => void | Promise<void>;
}
```

---

## 四、布局计算数据结构

> 源文件：`src/types/layout.ts`

布局计算将 `Event[]` 转换为 `Map<string, EventLayout>`，决定每个事件卡片的位置和大小。

### 4.1 EventLayout（事件布局结果）

```typescript
interface EventLayout {
  id: string; // 对应 Event.id
  left: number; // 左偏移（百分比，0–100）
  width: number; // 宽度（百分比）
  zIndex: number; // 层叠顺序
  level: number; // 嵌套层级（0 = 顶层）
  isPrimary: boolean; // 是否为该时段的"主"事件（布局优先）
  indentOffset: number; // 视觉缩进（px）
  importance: number; // 重要性评分（影响宽度分配）
}
```

**布局计算管线**：

```
Event[]
  │
  ▼ 1. grouping.ts
EventGroup[]          ← 按时间重叠分组，同组事件相互影响布局
  │  events[]
  │  startHour, endHour
  │  nestedStructure: NestedLayer[]
  │
  ▼ 2. structure.ts
NestedLayer[]         ← 构建嵌套树（父子关系）
  │  events[]
  │  level
  │  parentEvent?
  │  timeSlot?: { start, end }
  │
  ▼ 3. layout.ts
EventLayout[]         ← 计算 left / width / zIndex
  │
  ▼ 4. rebalance.ts（可选）
EventLayout[]         ← 平衡优化，避免过于不均匀的列宽
```

### 4.2 EventGroup（重叠事件组）

```typescript
interface EventGroup {
  events: Event[];
  startHour: number; // 组的开始时间（小时）
  endHour: number; // 组的结束时间（小时）
  primaryEvent?: Event; // 时长最长的主事件
  nestedStructure: NestedLayer[];
  specialLayoutRules?: SpecialLayoutRule[]; // 特殊约束规则
  originalBranchMap?: Map<string, Event>; // 分支追踪（用于跨组事件）
}
```

### 4.3 SpecialLayoutRule（特殊约束）

```typescript
interface SpecialLayoutRule {
  eventId: string;
  layoutType:
    | 'align_with_ancestor' // 与祖先对齐（继承祖先的 left）
    | 'full_width' // 占满整列宽度
    | 'full_width_from_level' // 从某层级开始占满
    | 'align_with_sibling'; // 与兄弟节点对齐
  referenceEvent?: Event; // 对齐参考事件
  targetLevel?: number;
  reason?: string;
}
```

### 4.4 LAYOUT_CONFIG（布局常量）

```typescript
const LAYOUT_CONFIG = {
  INDENT_STEP: 2, // 嵌套缩进步长（px）
  MIN_WIDTH: 25, // 事件最小宽度（%）
  MARGIN_BETWEEN: 2, // 相邻事件间距（px）
  CONTAINER_WIDTH: 320, // 布局参考容器宽度（px）
  OVERLAP_THRESHOLD: 0.25, // 判定重叠的最小时间重叠比例
  EDGE_MARGIN: 3, // 容器边距（px）
  MAX_LOAD_IMBALANCE: 0, // 允许的最大负载不平衡值
  REBALANCE_THRESHOLD: 2, // 触发重平衡算法的最小事件数
} as const;
```

---

## 五、拖拽状态数据结构

> 源文件：`src/types/dragIndicator.ts`

### 5.1 DragRef（Week/Day 视图拖拽状态）

拖拽过程中存储在 `useRef` 中，避免触发 re-render。

```typescript
interface DragRef {
  active: boolean;
  mode: 'create' | 'move' | 'resize' | null;
  eventId: string | null; // 被拖拽/调整的事件 ID（create 模式为 null）
  dayIndex: number; // 当前所在列（0=周起始日）
  startX: number; // 鼠标/触摸起始坐标
  startY: number;
  startHour: number; // 当前起始小时（实时更新）
  endHour: number; // 当前结束小时（实时更新）
  originalDay: number; // 拖拽开始时的原始列
  originalStartHour: number; // 拖拽开始时的原始起始小时
  originalEndHour: number; // 拖拽开始时的原始结束小时
  resizeDirection: string | null; // 调整方向：'top' | 'bottom' | null
  hourOffset: number | null; // move 模式：鼠标在事件内的偏移小时
  duration: number; // 事件时长（小时）
  lastRawMouseHour: number | null;
  lastUpdateTime: number;
  initialMouseY: number;
  lastClientY: number;
  allDay: boolean; // 是否为全天拖拽
  eventDate?: Date;
  calendarIds?: string[];
}
```

### 5.2 UnifiedDragRef（通用拖拽状态，含月视图）

继承自 `DragRef`，增加月视图特有字段：

```typescript
interface UnifiedDragRef extends DragRef {
  // 月视图特有
  targetDate?: Date | null; // 拖拽目标日期
  originalDate?: Date | null; // 拖拽起始日期
  originalEvent?: Event | null; // 原始事件快照
  dragOffset?: number; // 水平拖拽偏移（天数）
  dragOffsetY?: number; // 垂直拖拽偏移
  originalStartDate?: Date | null;
  originalEndDate?: Date | null;
  originalStartTime?: { hour: number; minute: number; second: number } | null;
  originalEndTime?: { hour: number; minute: number; second: number } | null;

  // 拖拽指示器管理
  sourceElement?: HTMLElement | null; // 原始 DOM 节点（复制为指示器）
  indicatorVisible?: boolean;
  indicatorContainer?: HTMLElement | null;
  initialIndicatorLeft?: number;
  initialIndicatorTop?: number;
  initialIndicatorWidth?: number;
  initialIndicatorHeight?: number;

  // 跨天事件特有
  eventDurationDays?: number; // 事件跨天总数
  currentSegmentDays?: number; // 当前片段占天数
  startDragDayIndex?: number; // 拖拽起始列索引

  // 事件属性（延迟创建指示器时用）
  calendarId?: string;
  calendarIds?: string[];
  title?: string;
}
```

### 5.3 视图专用拖拽状态（React state，触发 re-render）

```typescript
// Month 视图：只保存渲染 UI 所需的最小状态
type MonthDragState = {
  active: boolean;
  mode: 'create' | 'move' | 'resize' | null;
  eventId: string | null;
  targetDate: Date | null; // 当前悬浮目标日期
  startDate: Date | null; // create 模式的起始日期
  endDate: Date | null; // create 模式的结束日期
};

// Week/Day 视图：保存时间列信息
type WeekDayDragState = {
  active: boolean;
  mode: 'create' | 'move' | 'resize' | null;
  eventId: string | null;
  dayIndex: number; // 当前悬浮列
  startHour: number; // 实时起始小时
  endHour: number; // 实时结束小时
  allDay: boolean;
};
```

**DragRef vs DragState 的设计意图**：

```
DragRef（useRef）              DragState（useState）
─────────────────────          ───────────────────────
存储完整拖拽信息               只存渲染 UI 所需的最少字段
鼠标移动时同步更新             通过节流/防抖更新（减少 re-render）
不触发 re-render               触发 re-render，更新拖拽指示器位置
```

---

## 六、视图配置数据结构

> 源文件：`src/types/factory.ts`

### 6.1 共享基础配置（ViewFactoryConfig）

```typescript
interface ViewFactoryConfig {
  hourHeight?: number; // 每小时高度（px），决定时间网格密度
  firstHour?: number; // 时间网格起始小时（默认 0）
  lastHour?: number; // 时间网格结束小时（默认 24）
  allDayHeight?: number; // 全天行高度（px）
  timeFormat?: '12h' | '24h'; // 时间格式
}
```

### 6.2 各视图配置字段差异对比

| 字段                   | Day | Week | Month | Year | Agenda |
| ---------------------- | :-: | :--: | :---: | :--: | :----: |
| `hourHeight`           |  ✓  |  ✓   |   —   |  —   |   —    |
| `firstHour / lastHour` |  ✓  |  ✓   |   —   |  —   |   —    |
| `showAllDay`           |  ✓  |  ✓   |   —   |  —   |   —    |
| `scrollToCurrentTime`  |  ✓  |  ✓   |   —   |  —   |   —    |
| `secondaryTimeZone`    |  ✓  |  ✓   |   —   |  —   |   —    |
| `showEventDots`        |  ✓  |  ✓   |   ✓   |  ✓   |   —    |
| `showWeekends`         |  —  |  ✓   |   —   |  —   |   —    |
| `startOfWeek`          |  —  |  ✓   |   ✓   |  ✓   |   —    |
| `showWeekNumbers`      |  —  |  —   |   ✓   |  —   |   —    |
| `snapToMonth`          |  —  |  —   |   ✓   |  —   |   —    |
| `eventHeight`          |  —  |  —   |   ✓   |  —   |   —    |
| `scroll` (禁用/动画)   |  —  |  —   |   ✓   |  ✓   |   —    |
| `mode` (视图模式)      |  —  |  —   |   —   |  ✓   |   —    |
| `gridHeatmapLevels`    |  —  |  —   |   —   |  ✓   |   —    |
| `daysToShow`           |  —  |  —   |   —   |  —   |   ✓    |
| `showEmptyDays`        |  —  |  —   |   —   |  —   |   ✓    |
| `gridDateClick`        |  —  |  ✓   |   ✓   |  ✓   |   ✓    |
| `gridDateDoubleClick`  |  —  |  ✓   |   ✓   |  ✓   |   ✓    |

### 6.3 MonthScrollConfig（月/年视图滚动配置）

```typescript
interface MonthScrollConfig {
  disabled?: boolean; // 禁用连续滚动（只允许 Prev/Next 按钮切换）
  transition?: 'slide' | 'fade'; // 切换动画（slide=纵向滑动，fade=横向渐入）
}
```

---

## 七、渲染系统数据结构

> 源文件：`src/renderer/CustomRenderingStore.ts`

### 7.1 CustomRendering（渲染插槽注册项）

```typescript
interface CustomRendering {
  id: string; // 自动生成，格式 'df-slot-{guid}'
  containerEl: HTMLElement; // Preact 创建的占位符 <div>，框架适配器 portal 到此节点
  generatorName: string; // 插槽类型，如 'eventContent'、'titleBar'
  generatorArgs: unknown; // 传递给框架适配器的参数（类型由插槽决定）
}
```

### 7.2 CustomRenderingStore（插槽注册表）

**内部数据结构**：

```
CustomRenderingStore {
  renderings: Map<string, CustomRendering>  // key = id，全量已挂载插槽
  overrides: Set<string>                    // 框架适配器已声明的覆盖插槽名称集合
  listeners: Set<Function>                  // 订阅所有注册/注销变化
  overrideListeners: Set<Function>          // 仅订阅覆盖声明变化
}
```

**读写接口**：

```
写（Preact 侧）                  写（框架适配器侧）
register(rendering)              setOverrides(['eventContent', ...])
unregister(id)

读（框架适配器侧）
subscribe(listener)              → 收到 Map<string, CustomRendering>
subscribeToOverrides(listener)   → 仅在 setOverrides 调用时触发
isOverridden(generatorName)      → boolean
```

**已知 generatorName 及其 generatorArgs 类型**：

| generatorName              | generatorArgs 类型         | 说明             |
| -------------------------- | -------------------------- | ---------------- |
| `'titleBar'`               | `{ app: ICalendarApp }`    | 顶部标题栏       |
| `'eventContent'`           | `EventContentSlotArgs`     | 事件卡片内容     |
| `'eventContextMenu'`       | `EventContextMenuSlotArgs` | 事件右键菜单     |
| `'gridContextMenu'`        | `GridContextMenuSlotArgs`  | 网格右键菜单     |
| `'monthDateNumberContent'` | `MonthDateNumberSlotArgs`  | 月视图日期数字   |
| `'eventDetailDialog'`      | 对话框 props               | 事件详情对话框   |
| `'eventDetailPanel'`       | 面板 props                 | 事件详情浮动面板 |
| `'mobileEventDrawer'`      | 抽屉 props                 | 移动端事件抽屉   |
| `'searchDrawer'`           | 搜索 props                 | 搜索抽屉         |

---

## 八、日期数据结构

> 源文件：`src/types/calendar.ts`

```typescript
// 单天数据（视图渲染时使用）
interface DayData {
  date: Date;
  day: number; // 日（1–31）
  month: number; // 月（0–11）
  year: number;
  monthName: string; // 完整月名，如 'January'
  shortMonthName: string; // 简短月名，如 'Jan'
  isToday: boolean;
}

// 周数据（月视图/年视图网格渲染）
interface WeeksData {
  days: DayData[]; // 7 个 DayData（一周）
  startDate: Date; // 本周起始日期
  monthYear: {
    month: string; // 月名
    monthIndex: number; // 月索引（0–11）
    year: number;
  };
}
```

---

## 九、插槽 Args 数据结构

> 源文件：`src/types/core.ts`

```typescript
// 事件卡片内容插槽
interface EventContentSlotArgs {
  event: Event;
  viewType: ViewType;
  isAllDay: boolean;
  isMobile: boolean;
  isSelected: boolean;
  isDragging: boolean;
  layout?: EventLayout; // 仅 Week/Day 视图有值（月视图为 undefined）
}

// 事件右键菜单插槽
interface EventContextMenuSlotArgs {
  event: Event;
  onClose: () => void;
}

// 网格空白区域右键菜单插槽
interface GridContextMenuSlotArgs {
  date: Date;
  viewType?: ViewType;
  onClose: () => void;
}

// 月视图日期数字插槽
interface MonthDateNumberSlotArgs {
  date: Date;
  day: number;
  isToday: boolean;
  belongsToCurrentMonth: boolean;
  locale: string;
  viewType: ViewType.MONTH;
}
```

---

## 十、数据结构关系速查表

| 数据结构           | 层级             | 来源/创建时机            | 消费方                           |
| ------------------ | ---------------- | ------------------------ | -------------------------------- |
| `Event`            | 业务实体         | 外部传入 / CRUD 操作     | 所有视图、布局计算、搜索         |
| `CalendarType`     | 业务实体         | 外部传入 / 日历 CRUD     | 颜色渲染、权限控制               |
| `CalendarView`     | 视图定义         | 工厂函数创建             | CalendarApp、CalendarRoot        |
| `CalendarAppState` | 运行时状态       | CalendarApp 内部维护     | CalendarRenderer（订阅触发渲染） |
| `EventChange`      | 变更记录         | CalendarStore 生成       | subscribeEventChanges 监听者     |
| `RawEventChange`   | 变更记录（内部） | CalendarStore 内部       | EventManager                     |
| `EventLayout`      | 布局计算结果     | EventLayoutCalculator    | 事件卡片（定位/层叠）            |
| `EventGroup`       | 中间计算结果     | grouping.ts              | structure.ts → layout.ts         |
| `DragRef`          | 拖拽实时状态     | useDragState（useRef）   | 拖拽处理函数（不触发渲染）       |
| `MonthDragState`   | 拖拽渲染状态     | useDragState（useState） | 拖拽指示器组件                   |
| `CustomRendering`  | 渲染插槽注册     | ContentSlot mount        | 框架适配器（React portal）       |
| `DayData`          | 日期渲染数据     | generateDayData()        | 月/年视图网格                    |
| `WeeksData`        | 周渲染数据       | generateWeekData()       | 月/年视图行                      |
