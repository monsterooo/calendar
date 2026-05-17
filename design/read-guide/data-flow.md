# 数据流分析

## 核心数据流

所有 UI 更新都遵循同一条路径：

```
用户交互 / 外部 API 调用
        │
        ▼
CalendarApp（接收调用）
        │
        ▼
EventManager / NavigationController（业务处理）
        │
        ▼
CalendarStore（内存数据变更）
        │
        ▼
notify() → 通知所有订阅者
        │
        ▼
CalendarRenderer.requestRender()
        │  （下一个 requestAnimationFrame）
        ▼
CalendarRoot re-render（Preact）
        │
        ▼
视图组件 / 事件卡片 re-render
```

---

## 订阅机制

`CalendarApp` 提供三种订阅，粒度不同：

```typescript
// 1. 任意状态变化（最宽泛）
const unsub1 = app.subscribe(app => {
  // 视图切换、日期变化、事件变化等都会触发
});

// 2. 仅事件 CRUD（带来源标记）
const unsub2 = app.subscribeEventChanges((changes: EventChange[]) => {
  changes.forEach(change => {
    if (change.source === 'remote') return; // 跳过远程同步，避免写回死循环
    if (change.type === 'create') saveToDB(change.event);
    if (change.type === 'update') updateInDB(change.before, change.after);
    if (change.type === 'delete') deleteFromDB(change.event);
  });
});

// 3. 可见日期范围变化（视图切换/导航时触发）
const unsub3 = app.subscribeVisibleRangeChange(({ start, end, reason }) => {
  // reason: 'initial' | 'navigation' | 'viewChange' | 'scroll'
  fetchEventsFromServer(start, end);
});
```

---

## 事件创建流程

**场景**：用户点击 Add 按钮，在移动端抽屉中填写事件并保存。

```
用户点击 Add 按钮
        │
        ▼
useQuickCreateController.handleAddButtonClick()
        │  (isMobile = true)
        ▼
生成草稿事件（下一整点，1小时时长，calendarId = 默认可写日历）
setMobileDraftEvent(draft)
setIsMobileDrawerOpen(true)
        │
        ▼
CalendarRoot re-render → MobileEventDrawer 显示
        │
用户编辑标题、时间等字段
        │
        ▼
用户点击保存 → onSave(event)
        │
        ▼
app.addEvent(event)
        │
        ▼
EventManager.addEvent(event)
├─ normalizeEvent(event)           // 确保 calendarId 存在
├─ pushToUndo(snapshot)            // 保存撤销快照
├─ store.createEvent(event)        // 写入内存 Map
│       │
│       ▼
│   onEventChange({ type: 'create', event })
│       │
│       ▼
│   EventManager:
│   ├─ app.callbacks.onEventCreate?.(event)   // 通知外部回调
│   ├─ notifyEventChangeListeners([{ ...change, source: 'local' }])
│   └─ triggerRender()
│
└─ app.notify()                    // 触发所有 subscribe 订阅者
        │
        ▼
CalendarRenderer.requestRender()   // 调度下一帧渲染
        │
        ▼
CalendarRoot re-render
视图组件（WeekView/MonthView...）重新渲染，新事件出现在对应位置
```

---

## 事件修改流程

**场景**：用户在事件详情对话框中修改了标题并保存。

```
用户在详情对话框编辑事件
        │
        ▼
onEventUpdate(updatedEvent)          // 对话框的保存回调
        │
        ▼
app.updateEvent(id, updates)
        │
        ▼
EventManager.updateEvent(id, updates)
├─ pushToUndo(snapshot)
├─ store.updateEvent(id, updates)
│       │
│       ▼
│   before = store.getById(id)
│   store.set(id, merged)
│   onEventChange({ type: 'update', before, after })
│       │
│       ▼
│   EventManager:
│   ├─ app.callbacks.onEventUpdate?.(after)
│   ├─ notifyEventChangeListeners([{ ...change, source: 'local' }])
│   └─ triggerRender()
│
└─ app.notify()
        │
        ▼
CalendarRenderer re-render
        │
        ▼
useEventDialogController:
└─ useMemo(dialogProps) 因 tick 变化重新计算
   → 对话框显示最新标题

CalendarRoot re-render → 视图中的事件卡片标题更新
```

---

## 事件拖拽流程

**场景**：用户将事件拖动到新的时间位置。

```
用户 mousedown 在事件卡片上
        │
        ▼
useEventInteraction.onDragStart()
├─ 记录 startHour, dayIndex
├─ dragRef.active = true, mode = 'move'
└─ 更新 DragRef 状态（UI 展示拖拽指示器）
        │
用户移动鼠标 → onDragMove()
└─ 更新 dragRef 中的目标位置（实时更新指示器）
        │
用户 mouseup → onDragEnd()
        │
        ▼
dragBridge.onDrop(eventId, newStart, newEnd)
        │
        ▼
app.updateEvent(id, { start: newStart, end: newEnd })
source = 'drag'
        │
        ▼
notifyEventChangeListeners([{ ...change, source: 'drag' }])

// 外部代码可区分 drag 来源，例如先乐观更新再持久化
app.subscribeEventChanges(changes => {
  if (changes[0].source === 'drag') optimisticUpdate(changes[0]);
})
```

---

## 搜索流程

```
用户在搜索框输入关键词
        │
        ▼
useSearchController.setSearchKeyword(keyword)
        │
        ▼
useEffect 触发（防抖 300ms 后）
        │
        ▼
performSearch():
├─ 如果 searchConfig?.customSearch 存在
│     → 同步调用，返回过滤后的事件
├─ 如果 searchConfig?.onSearch 存在
│     → 异步调用（后端 API），setSearchLoading(true/false)
└─ 默认：在 app.state.events 中按标题/描述过滤
        │
        ▼
setSearchResults(results)
setIsSearchOpen(true)
        │
        ▼
SearchDrawer 显示结果列表
        │
用户点击某条结果
        │
        ▼
handleSearchResultClick(event)
├─ app.setCurrentDate(eventDate)   // 跳转到事件所在日期
├─ app.highlightEvent(event.id)    // 标记高亮
└─ 若有 searchConfig?.onResultClick → 调用自定义处理

        │
        ▼
app.state.highlightedEventId = event.id
        │
        ▼
useAppSubscription 感知 → tick++
        │
        ▼
useEffect in useSearchController:
└─ app.selectEvent(highlightedEventId)
   app.state.selectedEventId = id
        │
        ▼
CalendarRoot re-render
对应事件卡片高亮 + 选中样式
```

---

## 外部事件同步（远程 / CalDAV）

```
外部系统推送新事件数组
        │
        ▼
app.applyEventsChanges({
  add: [...],
  update: [...],
  delete: [...]
})
        │
        ▼
EventManager.applyChanges()
├─ store.beginTransaction()
├─ 遍历 add → store.createEvent()
├─ 遍历 update → store.updateEvent()
├─ 遍历 delete → store.deleteEvent()
└─ store.endTransaction()
         │
         ▼（事务合并变化，单次通知）
onEventBatchChange(normalizedChanges)
         │
         ▼
notifyEventChangeListeners(changes.map(c => ({ ...c, source: 'remote' })))

// 订阅者收到 source: 'remote'，不需要再写回外部系统
```

### 变化合并算法（normalizeChanges）

事务结束时，同一事件的多个操作会被合并：

| 操作序列        | 合并结果                                                 |
| --------------- | -------------------------------------------------------- |
| create → update | create（with updated data）                              |
| create → delete | （抵消，不通知）                                         |
| update → update | update（before = 第一个 before，after = 最后一个 after） |
| update → delete | delete                                                   |

---

## CalendarStore 事务机制

适用于批量操作（如导入 ICS、远程同步）：

```typescript
store.beginTransaction(); // 进入事务，后续操作暂缓通知

store.createEvent(e1); // 写入内存，不立即通知
store.updateEvent(id2, u);
store.deleteEvent(id3);

store.endTransaction(); // 合并所有变化 → 单次 onEventBatchChange
```

不使用事务时，每次操作都立即调用 `onEventChange`（逐条通知）。

---

## 撤销机制

```typescript
// 任何修改操作前，EventManager 自动保存快照
EventManager.addEvent()    → pushToUndo(currentEventsSnapshot)
EventManager.updateEvent() → pushToUndo(currentEventsSnapshot)
EventManager.deleteEvent() → pushToUndo(currentEventsSnapshot)

// 撤销
app.undo()
└─ EventManager.undo()
   ├─ pop lastSnapshot
   └─ store.replaceAll(snapshot)  // 恢复到快照状态
      → 触发 notify()
      → UI re-render
```

最多保存 50 个快照。
