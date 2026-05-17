# DayFlow Core 架构文档

本目录包含 `@dayflow/core` 包的完整架构分析文档，适合新成员快速了解代码结构，也作为开发时的参考指引。

## 文档列表

| 文档                                 | 说明                                                    |
| ------------------------------------ | ------------------------------------------------------- |
| [architecture.md](./architecture.md) | 整体架构概览、分层设计、技术选型、设计模式              |
| [modules.md](./modules.md)           | 9 大模块的详细职责、关键文件、核心接口说明              |
| [data-flow.md](./data-flow.md)       | 数据流图、事件创建/修改/搜索的完整调用链                |
| [types.md](./types.md)               | TypeScript 类型体系完整参考                             |
| [api.md](./api.md)                   | 公开 API 参考（ICalendarApp、工厂函数、工具函数、插件） |

## 快速上手

### 包概览

`@dayflow/core` 是 DayFlow 日历库的引擎层，基于 **Preact** 构建，提供：

- 5 种视图：日 / 周 / 月 / 年 / 议程
- 事件拖拽、调整大小、快速创建
- 多日历、颜色、主题、时区
- 插件系统和自定义渲染（支持 React / Vue / Svelte / Angular 适配器）
- 完整的 TypeScript 类型支持

### 关键入口文件

```
packages/core/
├── src/index.ts                       # 公开 API 入口
├── src/core/CalendarApp.ts            # 应用状态核心
├── src/renderer/CalendarRenderer.tsx  # 渲染器
├── src/renderer/CalendarRoot.tsx      # UI 组件树根节点
└── src/types/core.ts                  # 核心类型定义
```

### 最小用法示例

```typescript
import { CalendarApp, CalendarRenderer, createWeekView } from '@dayflow/core';
import '@dayflow/core/dist/styles.css';

// 1. 创建应用
const app = new CalendarApp({
  views: [createWeekView({ showWeekends: true })],
  events: [],
  callbacks: {
    onEventCreate: event => console.log('Created', event),
    onEventUpdate: event => console.log('Updated', event),
  },
});

// 2. 挂载到 DOM
const renderer = new CalendarRenderer(app);
renderer.mount(document.getElementById('calendar'));
```

## 阅读建议

1. 先读 [architecture.md](./architecture.md) 建立整体认知
2. 再读 [modules.md](./modules.md) 了解各模块职责
3. 需要理解交互逻辑时参考 [data-flow.md](./data-flow.md)
4. 开发时查阅 [types.md](./types.md) 和 [api.md](./api.md)
