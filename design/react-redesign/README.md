# @dayflow/react — React 重写架构设计

本目录记录从 Preact 版 `@dayflow/core` 迁移至纯 React 实现的架构决策与设计细节。

---

## 设计目标

| 目标         | 说明                                     |
| ------------ | ---------------------------------------- |
| **可维护性** | 每层职责单一，修改不跨层扩散             |
| **可扩展性** | 新增视图、插件、自定义渲染不修改核心代码 |
| **可测试性** | 纯 TS 核心层无框架依赖，可单独单测       |
| **类型安全** | 公开 API 全部有完整 TypeScript 类型      |
| **性能**     | React 重渲染严格可控，大数据量不卡顿     |

---

## 核心设计原则

1. **框架无关的核心层** — 业务逻辑与 React 完全解耦，理论上可接任何框架
2. **useSyncExternalStore 订阅模式** — 状态变更通过标准 React 并发模式安全消费
3. **Compound Component + Slots** — 公开 API 用组合方式而非 prop 透传
4. **Context 替代全局 Bridge** — 消灭 `dragBridge` 等全局变量，改用 React Context 注入
5. **插件即 Provider** — 插件以 React Provider 形式挂载，生命周期由 React 管理

---

## 包结构规划

```
packages/
├── core-ts/                  # 纯 TypeScript 核心（无框架依赖）
│   ├── src/
│   │   ├── store/            # CalendarStore, EventManager
│   │   ├── navigation/       # NavigationController
│   │   ├── config/           # ConfigManager (带通知)
│   │   ├── layout/           # 事件布局算法
│   │   ├── locale/           # 国际化
│   │   └── types/            # 所有 TypeScript 类型
│   └── package.json
│
├── react/                    # React 适配层（依赖 core-ts）
│   ├── src/
│   │   ├── hooks/            # useSyncExternalStore 封装 hooks
│   │   ├── context/          # CalendarContext, SlotContext 等
│   │   ├── components/       # 所有 UI 组件
│   │   ├── views/            # DayView, WeekView, MonthView ...
│   │   ├── plugins/          # 标准插件（events, drag, sidebar）
│   │   └── index.ts          # 公开 API 入口
│   └── package.json
│
└── react-ui/                 # （可选）纯展示组件，无业务逻辑
```

---

## 文档导航

| 文档                                               | 内容                   |
| -------------------------------------------------- | ---------------------- |
| [architecture.md](./architecture.md)               | 整体分层架构与模块边界 |
| [state-design.md](./state-design.md)               | 核心状态管理设计       |
| [component-api.md](./component-api.md)             | 公开组件 API 与用法    |
| [custom-rendering.md](./custom-rendering.md)       | Slots 自定义渲染机制   |
| [plugin-architecture.md](./plugin-architecture.md) | 插件系统设计           |
| [performance.md](./performance.md)                 | 性能优化策略           |

---

## 与当前版本的关键差异

| 问题（当前版本）                       | 解决方案（新版本）                         |
| -------------------------------------- | ------------------------------------------ |
| `dragBridge` 全局变量，多实例冲突      | React Context，每个 `<Calendar>` 实例独立  |
| `ConfigManager.updateConfig` 无通知    | config 纳入 store，变更触发订阅            |
| WeekView 20+ props 透传                | Compound Component + Context 消费          |
| `eventsPlugin` 直接 mutate `app.state` | 通过 EventManager 公开方法操作             |
| `ContentSlot` Preact Portal 跨框架     | React `children` / render prop / slot prop |
| tick 计数器驱动 useMemo                | 每个子状态独立 selector，最小化重算        |
