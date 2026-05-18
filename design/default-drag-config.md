# defaultDragConfig 各字段说明

文件位置：`packages/core/src/core/config.ts`

```typescript
export const defaultDragConfig = {
  HOUR_HEIGHT: 72,
  FIRST_HOUR: 0,
  LAST_HOUR: 24,
  MIN_DURATION: 0.25,
  TIME_COLUMN_WIDTH: 80,
  ALL_DAY_HEIGHT: 28,
  getLineColor: (color: string) => resolveLineColor(color),
  getDynamicPadding: (drag: { endHour: number; startHour: number }) => {
    const duration = drag.endHour - drag.startHour;
    return duration <= 0.25 ? 'df-p-compact' : 'df-p-standard';
  },
};
```

---

## 布局尺寸

### `HOUR_HEIGHT: 72`

时间网格中「一小时」的像素高度。这是拖拽计算的核心单位——所有像素坐标和时间的互换都依赖它：

```typescript
// 鼠标 Y 坐标 → 时间
floatHour = relativeY / HOUR_HEIGHT + FIRST_HOUR;

// 时间 → 像素 top 值
topPx = (hours - FIRST_HOUR) * HOUR_HEIGHT;
```

值越大，每小时格子越高，拖拽精度越高但视图越长。

---

### `FIRST_HOUR: 0`

时间网格的起始小时（0 = 午夜 0:00）。坐标计算时作为偏移量使用，决定了滚动区域从几点开始渲染。

### `LAST_HOUR: 24`

时间网格的结束小时（24 = 当天结束）。网格总高度 = `(LAST_HOUR - FIRST_HOUR) * HOUR_HEIGHT`。

---

### `TIME_COLUMN_WIDTH: 80`

时间标签列（显示「8 AM」「9 AM」等）的像素宽度。拖拽计算鼠标在日期列内的相对位置时需要减掉这个值。

### `ALL_DAY_HEIGHT: 28`

全天事件区域每行的像素高度。多行全天事件时动态扩展：

```typescript
totalAllDayHeight = (maxRow + 1) * ALL_DAY_HEIGHT;
```

---

## 行为约束

### `MIN_DURATION: 0.25`

事件可缩放到的最小时长，单位是**小时**（0.25 = 15 分钟）。用户拖拽缩放事件时，防止把事件压缩到 15 分钟以下。

---

## 函数

### `getLineColor: (color) => resolveLineColor(color)`

根据日历/事件颜色返回对应的边框线条颜色。委托给 `colorUtils` 处理，通常是将背景色处理成更深或更适合作为边框的颜色。

### `getDynamicPadding: (drag) => ...`

根据事件时长动态返回 CSS 类名，解决短事件空间不够的问题：

```typescript
// 时长 ≤ 15 分钟 → 超紧凑内边距
'df-p-compact'  →  padding: 2px 4px   // shared-foundation.css:427

// 时长 > 15 分钟 → 正常内边距
'df-p-standard' →  padding: 4px       // shared-foundation.css:431
```

这样 15 分钟内的短事件标题不会因为 padding 过大而被截断。

---

## 关系图

```
┌────────────────────────────────────┐
│  TIME_COLUMN_WIDTH (80px)          │
│  ┌────────────────────────────┐    │
│  │ FIRST_HOUR  0:00           │    │   ← 时间网格起点
│  │   ↕ HOUR_HEIGHT 72px       │    │
│  │ 1:00                       │    │
│  │   ↕ HOUR_HEIGHT 72px       │    │
│  │ 2:00  ...                  │    │
│  │                            │    │
│  │ LAST_HOUR  24:00           │    │   ← 时间网格终点
│  └────────────────────────────┘    │
│  ALL_DAY_HEIGHT (28px × 行数)      │   ← 全天事件区（动态高度）
└────────────────────────────────────┘
```

## 可覆盖的场景

| 需求                    | 修改字段                   | 示例值           |
| ----------------------- | -------------------------- | ---------------- |
| 工作时间视图（8am–6pm） | `FIRST_HOUR` / `LAST_HOUR` | `8` / `18`       |
| 更紧凑的时间网格        | `HOUR_HEIGHT`              | `48`             |
| 更宽的时间标签列        | `TIME_COLUMN_WIDTH`        | `64`             |
| 允许更短的事件          | `MIN_DURATION`             | `0.083`（5分钟） |
| 更高的全天事件行        | `ALL_DAY_HEIGHT`           | `32`             |
