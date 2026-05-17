# 自定义渲染（Slots）设计

## 问题背景

当前版本用 `ContentSlot` + Preact Portal 实现跨框架渲染，本质是：

1. Preact 渲染一个占位 `<div>` 并注册到 `CustomRenderingStore`
2. React/Vue 适配层监听 store 变化，把框架组件 Portal 进那个 `<div>`

这个方案解决了"Preact 内嵌 React 组件"的问题，但代价是复杂的跨框架 Portal 机制和 generatorName 覆盖系统。

**React 重写后**：纯 React 栈，不再需要 Portal 跨框架渲染，可以用更自然的方式。

---

## 新方案：Slots Prop 模式（MUI 风格）

每个视图组件接受一个 `slots` prop，用于覆盖内部子组件：

```typescript
// 类型定义
interface WeekViewSlots {
  // 事件块渲染
  eventContent?: ComponentType<EventContentProps>;
  // 全天事件行
  allDayEventContent?: ComponentType<AllDayEventContentProps>;
  // 时间刻度标签
  timeLabel?: ComponentType<TimeLabelProps>;
  // 时间格子背景
  timeSlot?: ComponentType<TimeSlotProps>;
  // 头部日期列
  dayHeader?: ComponentType<DayHeaderProps>;
  // 弹出框
  eventPopover?: ComponentType<EventPopoverProps>;
  // 拖拽创建时的占位块
  createPlaceholder?: ComponentType<CreatePlaceholderProps>;
}

// 使用
<WeekView
  slots={{
    eventContent: ({ event }) => (
      <div className="my-event">
        <span>{event.title}</span>
        <span className="tag">{event.category}</span>
      </div>
    ),
    dayHeader: ({ date, isToday }) => (
      <div className={isToday ? 'today-header' : ''}>
        {formatDate(date, 'EEE d')}
      </div>
    ),
  }}
/>
```

---

## Slot Props 类型定义

### EventContentProps

```typescript
interface EventContentProps {
  event: Event;
  layout: EventLayout; // 位置信息 { left, width, top, height }
  isDragging: boolean;
  isSelected: boolean;
  isReadOnly: boolean;
  // 内置行为触发器（可选使用）
  onClick: (e: MouseEvent) => void;
  onMouseDown: (e: MouseEvent) => void; // 拖拽起点
}
```

### TimeSlotProps

```typescript
interface TimeSlotProps {
  date: PlainDate;
  hour: number; // 0-23
  minute: 0 | 30; // 只有整点和半点
  isCurrentHour: boolean;
  // 点击时间格创建事件
  onClick: (time: PlainDateTime) => void;
}
```

### DayHeaderProps

```typescript
interface DayHeaderProps {
  date: PlainDate;
  isToday: boolean;
  isWeekend: boolean;
  events: Event[]; // 当天的全天事件（用于月视图头部）
}
```

### EventPopoverProps

```typescript
interface EventPopoverProps {
  event: Event;
  anchorEl: HTMLElement;
  onClose: () => void;
  onEdit: (event: Event) => void;
  onDelete: (eventId: string) => void;
}
```

---

## 内部实现：SlotContext

```tsx
// packages/react/src/context/SlotContext.tsx

interface SlotContextValue {
  slots: Record<string, ComponentType<any>>;
}

const SlotContext = createContext<SlotContextValue>({ slots: {} });

// 内部使用 slot 的组件
function EventBlock({ event, layout }: { event: Event; layout: EventLayout }) {
  const { slots } = useContext(SlotContext);
  const EventContent = slots.eventContent;

  const commonProps: EventContentProps = {
    event,
    layout,
    isDragging: false,
    isSelected: false,
    isReadOnly: false,
    onClick: handleClick,
    onMouseDown: handleDragStart,
  };

  if (EventContent) {
    return (
      <div style={layoutToStyle(layout)} onMouseDown={handleDragStart}>
        <EventContent {...commonProps} />
      </div>
    );
  }

  // 默认渲染
  return (
    <div style={layoutToStyle(layout)} onClick={handleClick}>
      <div className='event-title'>{event.title}</div>
      <div className='event-time'>{formatEventTime(event)}</div>
    </div>
  );
}
```

**关键点**：外层容器（位置、拖拽监听）始终由 Calendar 控制，只有内容区域开放给 slot，防止用户的自定义覆盖核心布局行为。

---

## Render Props 模式（备选方案）

对于需要更细粒度控制的场景，提供 render props：

```tsx
<WeekView
  renderEvent={props => <MyEventBlock {...props} />}
  renderTimeLabel={hour => <span>{hour}:00</span>}
/>
```

这两种方式可共存：`slots` 用于替换整个子组件，`render*` prop 用于简单的局部渲染定制。

---

## 全局 Slots（Calendar 级别）

某些 slot 全局生效，不区分视图：

```tsx
<Calendar
  slots={{
    // 所有视图都用这个事件渲染
    eventContent: MyEventContent,
    // 弹出框（所有视图共用）
    eventPopover: MyEventPopover,
    // 加载状态
    loading: () => <Spinner />,
  }}
>
  <WeekView
    // 视图级别的 slots 覆盖 Calendar 级别的
    slots={{ eventContent: WeekSpecificEvent }}
  />
  <MonthView /> {/* 使用 Calendar 级别的 eventContent */}
</Calendar>
```

合并优先级：`视图级 slots > Calendar 级 slots > 内置默认`

---

## 与当前版本对比

| 当前版本                                       | 新版本                                  |
| ---------------------------------------------- | --------------------------------------- |
| `customRenderingStore.register(id, rendering)` | `slots={{ eventContent: MyComponent }}` |
| `ContentSlot` Preact Portal 跨框架             | 纯 React 条件渲染                       |
| 按 `generatorName` 覆盖某类 slot               | `slots` prop 直接传组件                 |
| 注册/注销生命周期手动管理                      | React 组件生命周期自动管理              |
| 需要 `@dayflow/react` 适配层的 Portal 机制     | 直接在 `<WeekView>` 上传 `slots`        |

---

## 实现清单

- [ ] `SlotContext` — 存储 slot 注册表
- [ ] `SlotProvider` — 合并 Calendar 级和视图级 slots 后注入
- [ ] 每个视图的 `*Slots` 类型定义
- [ ] 每个可替换子组件检查 `SlotContext` 是否有覆盖
- [ ] 文档中为每个 slot 写明传入 props 和预期行为
