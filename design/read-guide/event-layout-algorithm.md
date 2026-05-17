# 事件布局算法详解

> 源代码位置：`packages/core/src/components/eventLayout/`

---

## 一、算法要解决的问题

在日视图和周视图的时间列中，多个事件可能在时间上互相重叠。需要决定：

1. 哪些事件应该**并排显示**（side-by-side，平分列宽）
2. 哪些事件应该**缩进嵌套**（indented，一个在另一个内部显示）
3. 每个事件的**精确位置**（left、width 百分比）

最终输出是一张 `Map<eventId, EventLayout>` 表，渲染层用它定位每个事件卡片。

**效果目标**：

```
无重叠：                只有 A：
┌────────────────┐      ┌────────────────┐
│       A        │      │       A        │
│                │      │                │
└────────────────┘      └────────────────┘

A 和 B 同时开始（并排）：   A 长，B 从 A 中间开始（嵌套）：
┌───────┬────────┐        ┌────────────────┐
│   A   │   B   │        │ A              │
│       │       │        │    ┌───────────┐│
└───────┴────────┘        │    │  B        ││
                          └────┴───────────┘
```

---

## 二、整体管线（4 步）

```
Event[] (一天的普通事件)
        │
        │ 步骤 1：toLayoutEvent()
        ▼
LayoutWeekEvent[]   ← 附加 _startHour / _endHour 缓存
        │
        │ 步骤 2：groupOverlappingEvents()   [grouping.ts]
        ▼
LayoutWeekEvent[][]  ← 重叠连通分量，每个组内的事件互相影响布局
        │
        │ 对每个组（>1个事件）执行：
        │
        │ 步骤 3a：排序 + analyzeParallelGroups()   [grouping.ts]
        ▼
ParallelGroup[]      ← 将组内事件按"开始时间相近"聚类成平行小组
        │
        │ 步骤 3b：buildNestedStructure()   [structure.ts]
        ▼
LayoutNode[]         ← 父子树结构，决定哪些事件嵌套在哪些事件内
        │
        │ 步骤 4：calculateLayoutFromStructure()   [layout.ts]
        ▼
Map<string, EventLayout>  ← 最终位置：left / width / zIndex / level / importance
```

---

## 三、核心数据结构

### 3.1 LayoutWeekEvent（内部事件表示）

```typescript
interface LayoutWeekEvent extends Event {
  parentId?: string; // 父事件 ID（决定缩进）
  children: string[]; // 子事件 ID 列表
  _startHour?: number; // 当天起始小时（浮点，如 9.5 = 9:30）
  _endHour?: number; // 当天结束小时
  // 来自原始 Event：
  _originalStartHour?: number; // 跨天事件的原始起始时刻（布局稳定性用）
  _originalEndHour?: number;
}
```

**为什么需要 `_originalStartHour`？**

跨天事件（如周一 22:00 到周二 02:00）在周二的列中，`_startHour = 0`（从零点开始），但 `_originalStartHour = 22`（实际开始时间）。布局排序和关系判断使用原始时间，避免跨天时布局顺序突变。

---

### 3.2 ParallelGroup（平行小组）

```typescript
interface ParallelGroup {
  events: LayoutWeekEvent[]; // 开始时间相近的一组事件（将并排显示）
  startHour: number; // 组内最早开始时刻
  endHour: number; // 组内最晚结束时刻
  originalStartHour?: number; // 使用原始时刻的版本
  originalEndHour?: number;
}
```

---

### 3.3 LayoutNode（树节点）

```typescript
interface LayoutNode {
  event: LayoutWeekEvent;
  children: LayoutNode[];
  parent: LayoutNode | null;
  depth: number; // 树深度，0 = 根节点（无父），1 = 第一层子节点
  isProcessed: boolean; // 是否跨分支被复用（用于对齐修正）
}
```

---

### 3.4 EventLayout（最终输出）

```typescript
interface EventLayout {
  id: string;
  left: number; // 左边距（百分比，0–100）
  width: number; // 宽度（百分比）
  zIndex: number; // 层叠顺序（= depth）
  level: number; // 嵌套层级（= depth）
  isPrimary: boolean; // 是否为根节点（depth === 0）
  indentOffset: number; // 缩进量（像素，= depth * indentStep * containerWidth / 100）
  importance: number; // 重要性评分（0.1–1.0，基于时长）
}
```

---

### 3.5 常量配置（constants.ts）

```
PARALLEL_THRESHOLD   = 0.25   → 15 分钟（小时）
NESTED_THRESHOLD     = 0.50   → 30 分钟（小时）
INDENT_STEP_PERCENT  = 2.5    → 每层缩进 2.5%（周视图）/ 0.5%（日视图）
MIN_WIDTH            = 25     → 事件最小宽度 25%
MARGIN_BETWEEN       = 1      → 平行事件间距 1%
EDGE_MARGIN_PERCENT  = 0.9    → 右侧边距 0.9%（周视图，日视图不留边距）
```

**时间阈值的意义**：

```
开始时间差 ≤ 15min  → 视为"同时开始"，并排显示
15min < 差 < 30min  → 接近但不完全同时，仍并排（为负载均衡考虑）
差 ≥ 30min          → 视为有先后顺序，判断是否嵌套
```

---

## 四、步骤 1：转换事件格式

**函数**：`toLayoutEvent(event)`
**文件**：`utils.ts`

```typescript
function toLayoutEvent(event: Event): LayoutWeekEvent {
  return {
    ...event,
    parentId: undefined,
    children: [],
    _startHour: event.allDay ? 0 : extractHourFromDate(event.start),
    _endHour: event.allDay ? 0 : getEventEndHour(event),
  };
}
```

全天事件被过滤掉（`regularEvents = layoutEvents.filter(e => !e.allDay)`），不参与时间列的布局计算。

---

## 五、步骤 2：重叠分组（groupOverlappingEvents）

**文件**：`calculate/grouping.ts`
**算法**：广度优先搜索（BFS）求无向图连通分量

### 5.1 重叠判断

```typescript
function eventsOverlap(event1, event2): boolean {
  if (event1.day !== event2.day || event1.allDay || event2.allDay) return false;
  return (
    startHour(event1) < endHour(event2) && startHour(event2) < endHour(event1)
  );
}
```

即两事件时间段有任何交集（不包括首尾相接：A 结束 == B 开始，不算重叠）。

### 5.2 BFS 过程

```
输入：[A, B, C, D, E]（D和E不与任何人重叠，A-B-C互相重叠但不成对）

1. 取 A，BFS 找到与 A 有重叠的 B
2. 以 B 为起点，找到与 B 有重叠的 C
3. C 无新邻居，BFS 结束
   → 组1 = [A, B, C]
4. ，D 无邻居取 D（未处理）
   → 组2 = [D]
5. 取 E（未处理），E 无邻居
   → 组3 = [E]
```

**关键性质**：通过 BFS 传播，A 和 C 即使不直接重叠，只要 B 与两者都重叠，A 和 C 也会进入同一组，它们的布局会互相影响。

---

## 六、步骤 3a：平行小组分析（analyzeParallelGroups）

**文件**：`calculate/grouping.ts`

在同一重叠组内，进一步按**开始时间相近**（≤ 15min）将事件聚合为 `ParallelGroup`。

### 6.1 过程

```
输入（已排序）：[A(8:00), B(8:10), C(8:40), D(10:00)]
PARALLEL_THRESHOLD = 0.25 小时

1. 取 A(8:00)，找与 A 在 15min 内的：B(8:10) 满足(|8:00-8:10|=0.17≤0.25)
   → PG1 = { events: [A, B], startHour: 8.0, endHour: max(endA, endB) }

2. 取 C(8:40)（未处理），找满足的：D(10:00) 不满足(|8:40-10:00|=1.33>0.25)
   → PG2 = { events: [C], startHour: 8.67, endHour: endC }

3. 取 D(10:00)（未处理）
   → PG3 = { events: [D], startHour: 10.0, endHour: endD }

结果：[PG1, PG2, PG3]（已按 originalStartHour 排序）
```

### 6.2 含义

同一 `ParallelGroup` 内的事件将**并排显示**，宽度平分。不同 `ParallelGroup` 的事件通过后续的嵌套结构确定是父子关系还是各自独立的根节点。

---

## 七、步骤 3b：构建嵌套结构（buildNestedStructure）

**文件**：`calculate/structure.ts`

这是算法最复杂的部分，负责建立 `ParallelGroup` 之间的父子树关系。

### 7.1 主流程

```
for i = 0 to parallelGroups.length - 1:
  currentGroup = parallelGroups[i]

  for j = i-1 downto 0:   ← 向前查找最近的潜在父组
    potentialParentGroup = parallelGroups[j]

    if canGroupContain(potentialParentGroup, currentGroup):
      optimizeChildAssignments(currentGroup.events, potentialParentGroup, allEvents)
      foundParent = true
      break   ← 找到第一个合适的父组即停止

最后：rootNodes = 所有 parent === null 的节点
```

### 7.2 判断"父组能否包含子组"（canGroupContain）

```typescript
function canGroupContain(parentGroup, childGroup): boolean {
  // 1. 时间差太小（< 30min）→ 不能包含，应该是平行关系
  const timeDiff = childGroup.originalStartHour - parentGroup.originalStartHour;
  if (timeDiff < NESTED_THRESHOLD) return false;

  // 2. 负载均衡检查：两组内若有任意两个事件时间差 < 30min → 不能包含
  if (checkLoadBalanceParallel(parentGroup, childGroup)) return false;

  // 3. 至少有一对父子事件满足包含关系
  for (parentEvent of parentGroup.events):
    for (childEvent of childGroup.events):
      if canEventContain(parentEvent, childEvent): return true

  return false;
}
```

**单事件的包含判断**（`canEventContain`）有两种形式：

```
严格包含（父完全覆盖子）：
  parent.start ≤ child.start  AND  parent.end ≥ child.end

  ├── parent ──────────────────────┤
       ├── child ───┤

重叠嵌套（子在父开始后启动，且有重叠）：
  parent.start ≤ child.start < parent.end  AND  overlap(parent, child)

  ├── parent ──────┤
       ├── child ──────────┤
```

### 7.3 并行关系判断（shouldBeParallel）

在决定两事件是否应该并排时，除了"开始时间差 ≤ 15min"之外，还有一个特殊情况：

**扩展事件规则**（`isExtendedEventParallel`）：

```
条件：
  - 事件 A 的时长 > 1.25 小时
  - 事件 B 在 A 的"后半段"开始（B.start ≥ A.start + A.duration × 0.4）
  - A 和 B 有时间重叠

→ A 和 B 视为平行关系

示例：
  A: 9:00–11:00（2小时）
  B: 10:05–11:00

  A 的 "后半段" 起点 = 9:00 + 2 × 0.4 = 9:48
  B.start(10:05) > 9:48 → 视为平行，并排显示

  (若 B.start = 9:20 < 9:48 → 视为嵌套，B 缩进显示在 A 内部)
```

**设计意图**：长事件（如全天会议）内部的后半段出现另一个事件，并排显示更直观；若放在较早的时段则嵌套显示更合适。

### 7.4 子事件最优分配（optimizeChildAssignments）

当一个子组需要挂到父组下，而父组有多个事件（都可能是父）时，需要决定哪个子事件挂到哪个父事件下。

```typescript
function optimizeChildAssignments(childEvents, parentGroup, allEvents):
  // 情况 1：只有一个子事件
  if childEvents.length === 1:
    return findBestParentInGroup(childEvents[0], parentGroup, allEvents)

  // 情况 2：所有父事件都能容纳所有子事件（可以均匀分配）
  validParents = parents that can contain ALL children
  if validParents.length > 0:
    if childCount % parentCount === 0:
      均匀分配（每个父平均 n/m 个子）
    else:
      每个子找负载最小的父（findParentWithMinLoad）

  // 情况 3：没有一个父能容纳所有子
  for each child:
    找最合适的父（findBestParentInGroup）
    if 找不到：
      找和已有兄弟事件重叠的子，挂到兄弟所在分支的替代根
```

**findBestParentInGroup 排序优先级**：

1. 子节点数量少的父（负载均衡）
2. 已有与当前子事件时间上并行的兄弟的父（聚合相关事件）
3. 开始时间与子事件最接近的父

### 7.5 示例：5 个事件的完整结构建立过程

```
事件：
  A: 9:00–12:00  （3小时，长事件）
  B: 9:05–11:00  （接近 A 的开始时间，与 A 平行）
  C: 10:30–11:30 （在 A/B 的中段开始）
  D: 10:35–11:30 （接近 C 的开始时间，与 C 平行）
  E: 11:00–12:00 （在 A/B/C/D 的后段开始）

步骤 3a 结果（analyzeParallelGroups）：
  PG1 = [A, B]   (开始差 5min ≤ 15min)
  PG2 = [C, D]   (开始差 5min ≤ 15min)
  PG3 = [E]

步骤 3b（buildNestedStructure）：
  处理 PG2 = [C, D]：
    查找前面的 PG1 = [A, B]：
    timeDiff = 10:30 - 9:00 = 1.5h > 0.5h（NESTED_THRESHOLD），通过
    checkLoadBalanceParallel(PG1, PG2)：
      A(9:00) vs C(10:30): 差1.5h > 0.5h
      A(9:00) vs D(10:35): 差1.58h > 0.5h
      B(9:05) vs C(10:30): 差1.42h > 0.5h
      B(9:05) vs D(10:35): 差1.5h > 0.5h → 均不在阈值内
    canEventContain(A, C)? A(9–12) 包含 C(10:30–11:30) → 是
    → PG2 挂到 PG1 下，[C, D] 分别挂到 [A, B]

  处理 PG3 = [E]：
    查找前面的 PG2 = [C, D]：
    canGroupContain(PG2, PG3)：
      timeDiff = 11:00 - 10:30 = 0.5h，等于 NESTED_THRESHOLD → false（严格 <）
    查找 PG1 = [A, B]：
    timeDiff = 11:00 - 9:00 = 2h > 0.5h，通过
    canEventContain(A, E)? A(9–12) 包含 E(11–12) → 是
    → E 挂到 PG1 下（挂到 A 或 B，取决于负载均衡）

最终树结构（假设 A 更空闲）：
  A (根, depth=0)
  ├── C (depth=1)
  └── E (depth=1)
  B (根, depth=0)
  └── D (depth=1)
```

---

## 八、步骤 3c：负载重平衡（rebalanceLoadByGroups）

**文件**：`calculate/rebalance.ts`

结构建立完成后，可能出现某个根节点的子树远比另一个根节点大的情况，导致视觉上一边很拥挤、一边很空旷。

### 8.1 触发条件

```typescript
function needsRebalancing(parentLoads): boolean {
  if (parentLoads.length < 2) return false;
  return max_load - min_load >= 2; // 差值 ≥ 2 才重平衡
}
```

### 8.2 重平衡过程（rebalanceGroupLoad）

```
最多执行 5 次迭代：
  1. 找到后代数量最多的父（heaviest）
  2. 找到后代数量最少的父（lightest）
  3. 如果 heaviest.load - lightest.load < 2 → 停止
  4. 在 heaviest 的叶子节点中，找一个能挂到 lightest 下的叶子
  5. 将该叶子从 heaviest 的子树中删除，挂到 lightest 下
  6. heaviest.load--, lightest.load++
```

**转移节点时的细节**（transferNode）：

```
转移叶节点 L 到新父 newParent：
  1. 从旧父的 children 中移除 L
  2. 检查 newParent 的现有子节点中是否有能容纳 L 的（shouldNestUnder）
     如果有 → 挂到该子节点下（继续嵌套，而非平铺）
     如果没有 → 直接挂到 newParent 下
  3. 更新 L.depth 和 parent 指针
```

### 8.3 示例

```
重平衡前：
  A (root)          B (root)
  ├── C             └── D
  ├── E
  └── F

load(A) = 3, load(B) = 1，差值 = 2 ≥ 2 → 需要重平衡

找 A 的叶子节点：C, E, F（都没有子节点）
找能挂到 B 下的叶子（canEventContain(B, leaf)）：
  假设 B 能包含 F → 转移 F 到 B

重平衡后：
  A (root)          B (root)
  ├── C             ├── D
  └── E             └── F

load(A) = 2, load(B) = 2，差值 = 0 < 2 → 停止
```

---

## 九、步骤 4：从树结构计算布局（calculateLayoutFromStructure）

**文件**：`calculate/layout.ts`

### 9.1 根节点的处理

```typescript
function calculateLayoutFromStructure(rootNodes, layoutMap, params):
  edgeMargin = (viewType === 'day') ? 0 : 0.9  // 周视图右侧留 0.9% 边距
  totalWidth = 100 - edgeMargin

  if rootNodes.length === 1:
    // 只有一棵树，根节点占满总宽
    calculateNodeLayout(rootNodes[0], left=0, width=totalWidth)

  else:
    // 多棵根树并排，平分总宽
    margin = 1  // MARGIN_BETWEEN
    nodeWidth = (totalWidth - margin * (n-1)) / n
    for each root at index i:
      left = i * (nodeWidth + margin)
      calculateNodeLayout(root, left, max(nodeWidth, 25))
```

### 9.2 单节点布局计算（calculateNodeLayoutWithVirtualParallel）

这是递归核心函数，处理一个节点及其所有子节点。

```
function calculateNodeLayout(node, baseLeft, availableWidth):
  // 1. 计算当前节点的缩进
  indentStep = (viewType === 'day') ? 0.5 : 2.5
  indentOffset = node.depth * indentStep

  // 特殊处理：跨分支复用节点（isProcessed），使用分支根节点的缩进
  if node.isProcessed:
    branchRootIndent = depth_of_level_1_ancestor * indentStep
    indentOffset = branchRootIndent  // 对齐到同层

  // 2. 计算位置
  nodeLeft  = baseLeft + indentOffset
  nodeWidth = availableWidth - indentOffset   // 剩余可用宽度

  // 3. 写入布局
  layoutMap.set(node.event.id, {
    left:         nodeLeft,
    width:        nodeWidth,
    zIndex:       node.depth,
    level:        node.depth,
    isPrimary:    (node.depth === 0),
    indentOffset: (indentOffset * containerWidth) / 100,
    importance:   clamp(duration / 4, 0.1, 1.0),
  })

  // 4. 递归处理子节点
  sortedChildren = children 按时长降序排列（最长的先处理）

  if children.length === 0:
    return

  if children.length === 1:
    // 单个子节点：在当前节点范围内嵌套
    calculateNodeLayout(child, baseLeft=nodeLeft, width=nodeWidth)

  else if shouldChildrenBeParallel(children):
    // 多个应该并排的子节点
    calculateParallelChildrenLayout(children, nodeLeft, nodeWidth)

  else:
    // 多个不需要并排的子节点：各自递归（它们使用同一父范围）
    for each child:
      calculateNodeLayout(child, baseLeft=nodeLeft, width=nodeWidth)
```

### 9.3 并排子节点布局（calculateParallelChildrenLayout）

```
function calculateParallelChildrenLayout(children, parentLeft, parentWidth):
  n = children.length
  indentOffset = children[0].depth * indentStep

  childrenStartLeft = parentLeft + indentOffset
  availableWidth    = parentWidth - indentOffset

  childWidth = (availableWidth - 1% * (n-1)) / n   // 均分，1% 间距

  for child at index i:
    childLeft = childrenStartLeft + i * (childWidth + 1%)
    layoutMap.set(child.event.id, {
      left:  childLeft,
      width: childWidth,
      ...
    })

    // 递归处理该子节点的子节点
    if child.children.length > 0:
      // 与上面相同的逻辑：单子/并排/各自嵌套
```

### 9.4 重要性评分（importance）

```typescript
importance = clamp(duration / 4, 0.1, 1.0)

duration(h)  →  importance
   0.25      →  0.1   (最低)
   0.50      →  0.125
   1.00      →  0.25
   2.00      →  0.5
   4.00      →  1.0   (最高)
   8.00      →  1.0   (上限)
```

这个分值供渲染层使用，例如：importance 低时可省略事件描述文字，避免拥挤。

---

## 十、完整的数字示例

### 场景：4 个事件在同一天

```
A: 09:00–12:00（3h）
B: 09:10–11:00（1.83h）
C: 10:30–11:30（1h）
D: 10:40–11:30（0.83h）

视图：周视图（EDGE_MARGIN = 0.9%，totalWidth = 99.1%）
```

**步骤 2 — 重叠分组**：

```
A-B: 重叠 ✓
A-C: 重叠 ✓
A-D: 重叠 ✓
B-C: 重叠 ✓
B-D: 重叠 ✓
C-D: 重叠 ✓
→ 一个组：[A, B, C, D]
```

**步骤 3a — 平行小组**（按开始时间排序后）：

```
排序：[A(9:00), B(9:10), C(10:30), D(10:40)]

PG1：取 A，找时间差 ≤ 0.25h 的：B(差0.17h) → PG1 = [A, B]
PG2：取 C，找时间差 ≤ 0.25h 的：D(差0.17h) → PG2 = [C, D]

结果：[PG1=[A,B], PG2=[C,D]]
```

**步骤 3b — 建立嵌套结构**：

```
创建节点：nodeA, nodeB, nodeC, nodeD（均 parent=null, depth=0）

处理 PG2（i=1），向前查找父组：
  查看 PG1（j=0）：
    timeDiff = 10:30 - 9:00 = 1.5h > 0.5h ✓
    checkLoadBalanceParallel(PG1, PG2)：
      所有配对的时间差均 > 0.5h → false ✓
    canEventContain(A, C)：A(9–12) 包含 C(10:30–11:30) → true ✓
    → PG2 挂到 PG1 下

  optimizeChildAssignments([C, D], PG1=[A,B], allEvents):
    validParents（能同时容纳 C 和 D 的）：
      canEventContain(A, C)? ✓  canEventContain(A, D)? ✓ → A 有效
      canEventContain(B, C)? B(9:10–11:00), C(10:30–11:30): B 结束 11:00, C 结束 11:30 → 不完全包含
        重叠嵌套？B.start(9.17) ≤ C.start(10.5) < B.end(11.0) ✓ + overlap ✓ → 有效
      validParents = [A, B]
    childCount(2) % parentCount(2) === 0 → 均匀分配
    sortedChildren by duration（降序）：[C(1h), D(0.83h)]
    A 分得索引 0：C    →  setRelation(A, C)
    B 分得索引 1：D    →  setRelation(B, D)

树结构：
  A(depth=0) → 子：[C(depth=1)]
  B(depth=0) → 子：[D(depth=1)]
  rootNodes = [nodeA, nodeB]
```

**步骤 3c — 负载重平衡**：

```
PG2 的父节点：A(load=1), B(load=1)
差值 = 0 < 2 → 不需要重平衡
```

**步骤 4 — 计算布局**：

```
rootNodes = [A, B]，两个根 → 并排
totalWidth = 99.1%
nodeWidth = (99.1% - 1%) / 2 = 49.05%

A：left = 0%，width = 49.05%
B：left = 0 + 49.05 + 1 = 50.05%，width = 49.05%

处理 A 的子节点 [C]（单个子节点）：
  indentStep = 2.5（周视图）
  C 的 depth = 1
  indentOffset = 1 * 2.5 = 2.5%
  nodeLeft  = 0 + 2.5 = 2.5%
  nodeWidth = 49.05 - 2.5 = 46.55%
  → C：left = 2.5%，width = 46.55%

处理 B 的子节点 [D]（单个子节点）：
  D 的 depth = 1
  indentOffset = 1 * 2.5 = 2.5%
  nodeLeft  = 50.05 + 2.5 = 52.55%
  nodeWidth = 49.05 - 2.5 = 46.55%
  → D：left = 52.55%，width = 46.55%
```

**最终布局**：

```
0%                  50%                 100%
│                    │                    │
├── A ───────────────┤├─── B ─────────────┤
│   (49.05%)         ││    (49.05%)        │
│   ╔═══ C ══════╗  ││    ╔═══ D ══════╗  │
│   ║  (46.55%)  ║  ││    ║  (46.55%)  ║  │
│   ╚════════════╝  ││    ╚════════════╝  │
│                   ││                    │
└───────────────────┘└────────────────────┘

可视效果（渲染时）：
  ┌────────────┬──────────────┐
  │     A      │      B       │
  │  09:00     │   09:10      │
  │   ┌────────┤   ┌──────────┤
  │   │   C    │   │    D     │
  │   │ 10:30  │   │ 10:40   │
  │   └────────┤   └──────────┤
  │  12:00     │  11:00       │
  └────────────┴──────────────┘
```

---

## 十一、周视图 vs 日视图的差异

| 项目                  | 周视图           | 日视图               |
| --------------------- | ---------------- | -------------------- |
| `INDENT_STEP_PERCENT` | 2.5%             | 0.5%                 |
| `EDGE_MARGIN_PERCENT` | 0.9%             | 0%（不留边距）       |
| 列宽                  | 较窄（7 列分摊） | 较宽（1 列）         |
| 缩进效果              | 明显             | 极小（避免浪费空间） |

日视图使用 0.5% 缩进，在宽列中几乎不可察觉，但仍通过 `zIndex` 层叠关系体现嵌套视觉层次。

---

## 十二、跨天事件的特殊处理

跨天事件（如周一 22:00 → 周二 03:00）在周视图的不同列中会被切割：

- 周一列：`_startHour = 22`，`_endHour = 24`
- 周二列：`_startHour = 0`，`_endHour = 3`

布局计算时，排序和关系判断使用 `_originalStartHour / _originalEndHour`（保持原始时间），位置计算使用 `_startHour / _endHour`（当天实际显示范围）。

这确保了：

- 跨天事件在不同列中保持一致的相对排序
- 不会因为"今天的开始时间"突然变成 0，导致布局突变或与其他事件错误地形成父子关系

---

## 十三、算法的设计权衡

### 13.1 BFS 分组 vs 区间树

选择 BFS 连通分量而非区间树或扫描线，原因：

- 输入规模小（一天通常 < 50 个事件），O(n²) 的 BFS 完全可接受
- 连通分量语义清晰：A-B-C 链式重叠自然归为同组
- 区间树实现复杂，收益不明显

### 13.2 "并排"和"嵌套"的两阶段判断

将"找重叠组"和"建父子树"分开：

- 阶段 1 只关心"谁影响谁的宽度"（用于分配计算资源）
- 阶段 2 关心"谁在谁的时间范围内"（用于决定缩进）

若合并为一步，会使判断逻辑变得极为复杂，且难以在两种显示策略间切换。

### 13.3 15min / 30min 阈值的来源

- **15min（PARALLEL_THRESHOLD）**：类似 Google Calendar 的处理，相差 1 格（15min 为最小刻度）内的事件视为"同时开始"
- **30min（NESTED_THRESHOLD）**：超过 2 格差距才视为有明确的先后关系，适合判断包含关系

### 13.4 扩展事件规则（40% 后半段）

规则：duration > 1.25h 的事件，如果另一事件在其"40% 之后"开始，两者并排。

直觉：

- 0–40% 区间（前半段）：另一个事件与当前事件的"起点"太近，视为同时发生，应嵌套
- 40–100% 区间（后半段）：另一个事件明显在当前事件进行中才开始，应并排，表示"这是同一时段的另一件事"

### 13.5 负载均衡的最大迭代次数 = 5

- 避免在极端情况下陷入无限循环
- 5 次转移操作对于实际日历数据已经足够
- 转移失败（找不到可转移的叶子）时立即停止

### 13.6 importance 分数

使用"时长/4"而不是固定值，因为：

- 短事件（15min）卡片高度很小，渲染时应简化显示（隐藏描述、使用点状图标）
- 长事件（4h+）有充足空间展示所有信息
- 渲染层可以根据此分数动态决定展示什么内容，而不需要硬编码高度阈值

---

## 十四、文件职责速查

| 文件                     | 职责                          | 关键函数                                                                                                          |
| ------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `index.tsx`              | 对外入口，串联 4 个步骤       | `EventLayoutCalculator.calculateDayEventLayouts()`                                                                |
| `utils.ts`               | 基础判断工具                  | `eventsOverlap()`, `shouldBeParallel()`, `canEventContain()`, `isExtendedEventParallel()`                         |
| `constants.ts`           | 阈值常量                      | `LAYOUT_CONFIG`                                                                                                   |
| `types.ts`               | 内部数据类型                  | `LayoutWeekEvent`, `LayoutNode`, `ParallelGroup`                                                                  |
| `calculate/grouping.ts`  | 步骤 2+3a：分组和平行小组分析 | `groupOverlappingEvents()`, `analyzeParallelGroups()`                                                             |
| `calculate/structure.ts` | 步骤 3b：建立嵌套树           | `buildNestedStructure()`, `optimizeChildAssignments()`, `canGroupContain()`                                       |
| `calculate/rebalance.ts` | 步骤 3c：树的负载重平衡       | `rebalanceLoadByGroups()`, `rebalanceGroupLoad()`, `transferNode()`                                               |
| `calculate/layout.ts`    | 步骤 4：从树计算 left/width   | `calculateLayoutFromStructure()`, `calculateNodeLayoutWithVirtualParallel()`, `calculateParallelChildrenLayout()` |
