# 公开 API 参考

所有 API 均从 `@dayflow/core` 导出。

---

## ICalendarApp 方法

### 导航

| 方法                                 | 说明                            |
| ------------------------------------ | ------------------------------- |
| `changeView(view: CalendarViewType)` | 切换当前视图                    |
| `getCurrentView(): CalendarView`     | 获取当前视图对象                |
| `setCurrentDate(date: Date)`         | 跳转到指定日期                  |
| `goToToday()`                        | 跳转到今天                      |
| `goToPrevious()`                     | 导航到上一个（上一周/上一月等） |
| `goToNext()`                         | 导航到下一个                    |

### 事件管理

| 方法                                          | 说明                         |
| --------------------------------------------- | ---------------------------- |
| `addEvent(event: Event)`                      | 添加单个事件                 |
| `updateEvent(id, updates)`                    | 更新事件（合并 updates）     |
| `deleteEvent(id)`                             | 删除事件                     |
| `applyEventsChanges({ add, update, delete })` | 批量变更（内部使用事务）     |
| `undo()`                                      | 撤销上一次修改（最多 50 步） |

### 事件交互

| 方法                         | 说明                                 |
| ---------------------------- | ------------------------------------ |
| `selectEvent(id \| null)`    | 编程式选中事件（触发详情面板）       |
| `highlightEvent(id \| null)` | 高亮事件（搜索结果跳转用）           |
| `onEventClick(event)`        | 模拟用户点击事件                     |
| `onEventDoubleClick(event)`  | 模拟用户双击事件                     |
| `dismissUI()`                | 关闭所有打开的浮层（对话框、面板等） |

### 日历管理

| 方法                                 | 说明                   |
| ------------------------------------ | ---------------------- |
| `getCalendars(): CalendarType[]`     | 获取所有日历           |
| `createCalendar(calendar)`           | 创建新日历             |
| `updateCalendar(id, updates)`        | 更新日历属性           |
| `deleteCalendar(id)`                 | 删除日历（不删除事件） |
| `setCalendarVisibility(id, visible)` | 切换日历可见性         |

### 订阅

| 方法                                    | 说明                            |
| --------------------------------------- | ------------------------------- |
| `subscribe(listener)`                   | 订阅任意状态变化，返回取消函数  |
| `subscribeEventChanges(listener)`       | 订阅事件 CRUD，带 `source` 标记 |
| `subscribeVisibleRangeChange(listener)` | 订阅可见日期范围变化            |
| `subscribeThemeChange(listener)`        | 订阅主题变化                    |

### 主题与插件

| 方法                               | 说明                                  |
| ---------------------------------- | ------------------------------------- |
| `setTheme(mode: ThemeMode)`        | 设置主题（'light' / 'dark' / 'auto'） |
| `installPlugin(plugin)`            | 安装插件                              |
| `getPlugin<T>(name)`               | 获取已安装插件的 API                  |
| `updatePluginConfig(name, config)` | 更新插件配置                          |

### 权限

| 方法                             | 说明                                       |
| -------------------------------- | ------------------------------------------ |
| `canMutateFromUI(calendarId?)`   | 检查是否可从 UI 修改（综合 readOnly 配置） |
| `getReadOnlyConfig(calendarId?)` | 获取只读配置对象                           |

---

## 视图工厂函数

### createDayView

```typescript
import { createDayView } from '@dayflow/core';

createDayView(config?: DayViewConfig): CalendarView

// 配置项
interface DayViewConfig {
  showAllDay?: boolean;             // 是否显示全天事件行（默认 true）
  scrollToCurrentTime?: boolean;    // 是否自动滚动到当前时间（默认 true）
  secondaryTimeZone?: TimeZoneValue; // 第二时区（显示双时区）
  showEventDots?: boolean;          // 以点代替卡片显示事件
}
```

### createWeekView

```typescript
import { createWeekView } from '@dayflow/core';

createWeekView(config?: WeekViewConfig): CalendarView

// 配置项
interface WeekViewConfig {
  showWeekends?: boolean;            // 显示周末（默认 true）
  startOfWeek?: number;              // 0=周日，1=周一（默认 1）
  scrollToCurrentTime?: boolean;     // 滚动到当前时间（默认 true）
  showAllDay?: boolean;              // 显示全天行（默认 true）
  gridDateClick?: 'day-view' | 'none' | ((date, events) => void);
  gridDateDoubleClick?: 'create-event' | 'day-view' | 'none' | ((date, events) => void);
}
```

### createMonthView

```typescript
import { createMonthView } from '@dayflow/core';

createMonthView(config?: MonthViewConfig): CalendarView

// 配置项
interface MonthViewConfig {
  showWeekNumbers?: boolean;         // 显示周序号（默认 false）
  showMonthIndicator?: boolean;      // 显示月份标识（默认 false）
  startOfWeek?: number;              // 0=周日，1=周一（默认 1）
  snapToMonth?: boolean;             // 滚动时是否吸附到月份（默认 true）
  eventHeight?: number;              // 事件卡片高度（px）
  scroll?: {
    disabled?: boolean;              // 禁用虚拟滚动
    transition?: boolean;            // 启用滚动动画
  };
}
```

### createYearView

```typescript
import { createYearView } from '@dayflow/core';

createYearView(config?: YearViewConfig): CalendarView

// 配置项
interface YearViewConfig {
  mode?: 'year-canvas' | 'fixed-week' | 'grid';  // 视图模式（默认 'year-canvas'）
  showTimedEventsInYearView?: boolean;             // 显示有时间的事件（默认 false，仅全天）
  gridHeatmapLevels?: number;                      // 热力图色阶数（grid 模式）
}
```

### createAgendaView

```typescript
import { createAgendaView } from '@dayflow/core';

createAgendaView(config?: AgendaViewConfig): CalendarView

// 配置项
interface AgendaViewConfig {
  daysToShow?: number;    // 显示的天数（默认 365）
  showEmptyDays?: boolean; // 显示没有事件的天（默认 false）
}
```

---

## 工具函数

### 事件创建

```typescript
import {
  createEvent,
  createAllDayEvent,
  createTimezoneEvent,
} from '@dayflow/core';

// 创建普通事件（PlainDateTime）
createEvent({
  id: 'e1',
  title: '会议',
  start: { year: 2025, month: 5, day: 17, hour: 10 },
  end: { year: 2025, month: 5, day: 17, hour: 11 },
  calendarId: 'cal1',
});

// 创建全天事件（PlainDate）
createAllDayEvent({
  id: 'e2',
  title: '假期',
  start: { year: 2025, month: 5, day: 20 },
  end: { year: 2025, month: 5, day: 22 },
});

// 创建带时区事件（ZonedDateTime）
createTimezoneEvent({
  id: 'e3',
  title: '国际会议',
  start: {
    year: 2025,
    month: 5,
    day: 17,
    hour: 9,
    timeZone: 'America/New_York',
  },
  end: {
    year: 2025,
    month: 5,
    day: 17,
    hour: 10,
    timeZone: 'America/New_York',
  },
});
```

### Temporal 类型检查

```typescript
import { isPlainDate, isPlainDateTime, isZonedDateTime } from '@dayflow/core';

isPlainDate(event.start); // Temporal.PlainDate → boolean
isPlainDateTime(event.start); // Temporal.PlainDateTime → boolean
isZonedDateTime(event.start); // Temporal.ZonedDateTime → boolean
```

### Temporal 转换

```typescript
import { temporalToDate, dateToZonedDateTime, now, today } from '@dayflow/core';

temporalToDate(temporal); // Temporal.* → Date
dateToZonedDateTime(date, 'Asia/Shanghai'); // Date → ZonedDateTime
dateToPlainDateTime(date); // Date → PlainDateTime
dateToPlainDate(date); // Date → PlainDate
now(); // 当前 ZonedDateTime（系统时区）
today(); // 当前 PlainDate
```

### 日期计算

```typescript
import {
  addDays,
  isSameDay,
  getWeekRange,
  daysDifference,
  getWeekNumber,
  generateDayData,
  generateWeekData,
} from '@dayflow/core';

addDays(date, 7); // 加 7 天
isSameDay(date1, date2); // 是否同一天
getWeekRange(date, 1); // 获取该周的 [start, end]（startOfWeek=1=周一）
daysDifference(date1, date2); // 两个日期相差天数
getWeekNumber(date); // ISO 周序号
generateDayData(date); // → DayData
generateWeekData(date, startOfWeek); // → DayData[]（7天）
```

### 时区工具

```typescript
import {
  getNowInTimeZone,
  getTodayInTimeZone,
  getNextHourRangeInTimeZone,
  normalizeTimeZoneValue,
} from '@dayflow/core';

getNowInTimeZone('Asia/Tokyo'); // → Date（当前时刻在东京时区的表示）
getTodayInTimeZone('Asia/Tokyo'); // → Date（今天零点）
getNextHourRangeInTimeZone('Asia/Tokyo'); // → { start, end }（下一整点，+1小时）
normalizeTimeZoneValue('Asia/Shanghai'); // → IANA 时区字符串
```

### 事件查询

```typescript
import {
  getEventsForDay,
  getEventsForWeek,
  getAllDayEventsForDay,
  isMultiDayEvent,
  getEventBgColor,
} from '@dayflow/core';

getEventsForDay(dayIndex, events); // 某天的所有事件
getAllDayEventsForDay(dayIndex, events); // 某天的全天事件
getEventsForWeek(events, weekStart); // 某周的所有事件
isMultiDayEvent(event); // 是否跨多天
getEventBgColor(event, calendarRegistry, isSelected); // 事件背景色
```

### 全天事件排序

```typescript
import {
  sortAllDayByTitle,
  createAllDayDisplayComparator,
} from '@dayflow/core';

// 按标题字母排序
events.sort(sortAllDayByTitle);

// 自定义排序（先按日历，再按时长）
const comparator = createAllDayDisplayComparator(['calendar', 'duration']);
events.sort(comparator);
```

### 日历订阅（CalDAV）

```typescript
import { subscribeCalendar } from '@dayflow/core';

subscribeCalendar(app, {
  url: 'https://example.com/calendar.ics',
  calendarId: 'my-cal',
  pollInterval: 60_000, // 每分钟刷新
});
```

---

## 插件 API

### createEventsPlugin

```typescript
import { createEventsPlugin } from '@dayflow/core';

const plugin = createEventsPlugin({
  enableAutoRecalculate?: boolean;  // 事件变化时自动重新计算布局（默认 true）
  enableValidation?: boolean;       // 启用事件验证（默认 false）
  maxEventsPerDay?: number;         // 每天最大事件数限制
});

// 安装后通过 getPlugin 访问 API
app.installPlugin(plugin);
const eventsService = app.getPlugin<EventsService>('events');
eventsService.getByDateRange(start, end);
```

### registerDragImplementation

```typescript
import { registerDragImplementation, useDragForView } from '@dayflow/core';
import { DayflowDrag } from '@dayflow/plugin-drag';

// 全局注册一次（通常在应用启动时）
registerDragImplementation(DayflowDrag);

// 在视图组件中使用
const { handlers, dragState } = useDragForView(app, {
  enableDrag: true,
  enableResize: true,
  enableCreate: true,
});
```

### registerSidebarImplementation

```typescript
import { registerSidebarImplementation, useSidebarBridge } from '@dayflow/core';
import { DayflowSidebar } from '@dayflow/plugin-sidebar';

// 全局注册
registerSidebarImplementation(DayflowSidebar);

// 在 CalendarRoot 内部使用（库内部调用）
const { SidebarComponent, sidebarProps } = useSidebarBridge(app);
```

---

## 可导出组件

```typescript
import {
  CalendarEvent,
  MiniCalendar,
  DefaultEventDetailPanel,
  DefaultEventDetailDialog,
  CreateCalendarDialog,
  BlossomColorPicker,
  DefaultColorPicker,
  ContentSlot,
  EventLayoutCalculator,
  LoadingButton,
  // 上下文菜单
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
  ContextMenuColorPicker,
  GridContextMenu,
  EventContextMenu,
  // 日期范围选择器
  DayflowRangePicker,
  // 图标
  PanelRightClose,
  PanelRightOpen,
  ChevronRight,
  ChevronDown,
  Check,
  ChevronsUpDown,
  Plus,
  AudioLines,
  Loader2,
  AlertCircle,
} from '@dayflow/core';
```

---

## 样式

```typescript
// 完整样式（包含 Tailwind utilities + 组件样式）
import '@dayflow/core/dist/styles.css';

// 仅组件专用样式（不含 Tailwind utilities，适合已有 Tailwind 的项目）
import '@dayflow/core/dist/styles.components.css';
```

导出的样式类名（可用于宿主项目覆盖）：

```typescript
import {
  sidebarContainer,
  sidebarHeader,
  sidebarHeaderToggle,
  sidebarHeaderTitle,
  cancelButton,
  calendarPickerDropdown,
} from '@dayflow/core';
```

---

## 年视图工具函数

```typescript
import {
  buildFixedWeekMonthsData,
  getFixedWeekTotalColumns,
  groupDaysIntoRows,
  analyzeMultiDayEventsForRow,
} from '@dayflow/core';

// 用于自定义年视图渲染时的数据构建
buildFixedWeekMonthsData(year, startOfWeek); // 构建 fixed-week 年视图数据
getFixedWeekTotalColumns(months); // 计算总列数
groupDaysIntoRows(days, columns); // 将天分组为行
analyzeMultiDayEventsForRow(events, row); // 分析某行的多日事件
```
