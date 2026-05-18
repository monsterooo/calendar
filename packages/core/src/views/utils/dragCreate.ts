/**
 * Shared drag-to-create utilities for Day/Week view time-grid cells.
 *
 * Interaction contract:
 *   - Single click  → no event created
 *   - Mousedown + drag (≥ THRESHOLD px) → activates create drag
 *   - Double-click  → creates a 1-hour event immediately (no resize mode)
 */

type CreateStartFn = (
  e: MouseEvent | TouchEvent,
  dayIndex: number,
  hour: number
) => void;

const DRAG_CREATE_THRESHOLD = 5;

/**
 * Starts a pending drag-create interaction on mousedown.
 *
 * Attaches temporary document-level listeners and only calls
 * `handleCreateStart` after the cursor moves ≥ DRAG_CREATE_THRESHOLD pixels,
 * so a plain click never creates an event.
 *
 * In sliding-view mode (week view on narrow desktop windows), a predominantly
 * horizontal drag cancels the pending create without triggering it, letting
 * the swipe-navigation handler take over instead.
 *
 * Also dispatches a synthetic mousemove immediately after activation to sync
 * the drag indicator to the actual cursor position, eliminating the brief
 * 1-hour flash that would otherwise appear on the first frame.
 */
/**
 * 在鼠标按下时启动一个待处理的拖拽创建交互。
 *
 * 附加临时的文档级监听器，仅在光标移动距离 ≥ DRAG_CREATE_THRESHOLD 像素后
 * 才调用 `handleCreateStart`，因此单纯的点击操作不会创建事件。
 *
 * 在滑动视图模式下（窄桌面窗口中的周视图），以水平方向为主的拖拽会取消
 * 待处理的创建操作而不触发它，转由滑动导航处理器接管。
 *
 * 此外，在激活后立即派发一个合成的 mousemove 事件，以将拖拽指示器同步到
 * 实际光标位置，消除原本在第一帧出现的短暂 1 小时闪烁问题。
 */
export function startPendingCreate(
  e: MouseEvent,
  dayIndex: number,
  hour: number,
  isTouch: boolean,
  handleCreateStart: CreateStartFn | undefined,
  isSlidingView?: boolean
): void {
  if (isTouch || e.button !== 0) return;

  let active = true;

  // Store handlers on an object so each handler can reference the other via
  // property lookup at call-time, avoiding circular forward-reference errors.
  // 将处理函数存储在一个对象上，这样每个处理函数都可以在调用时通过属性查找
  // 来引用其他处理函数，从而避免循环前向引用错误。
  const handlers = {
    move(moveEvent: MouseEvent) {
      if (!active) return;
      const dx = moveEvent.clientX - e.clientX;
      const dy = moveEvent.clientY - e.clientY;
      const dist = Math.hypot(dx, dy);

      if (dist < DRAG_CREATE_THRESHOLD) return;

      active = false;
      document.removeEventListener('mousemove', handlers.move);
      document.removeEventListener('mouseup', handlers.up);

      // In sliding-view mode, once we have enough movement to determine intent,
      // check direction: horizontal dominance means swipe-to-navigate, not create.
      if (isSlidingView && Math.abs(dx) >= Math.abs(dy)) return;

      handleCreateStart?.(e, dayIndex, hour);
      // Sync indicator to current cursor before the first render frame.
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          clientX: moveEvent.clientX,
          clientY: moveEvent.clientY,
          bubbles: true,
          cancelable: false,
        })
      );
    },
    up() {
      active = false;
      document.removeEventListener('mousemove', handlers.move);
      document.removeEventListener('mouseup', handlers.up);
    },
  };

  document.addEventListener('mousemove', handlers.move);
  document.addEventListener('mouseup', handlers.up);
}

/**
 * Dispatches a synthetic mouseup to immediately finalize a just-created event.
 *
 * Call this right after `handleCreateStart` in an onDblClick handler to
 * prevent the interactive drag-resize mode from activating — the event is
 * committed at the default 1-hour duration without any further mouse input.
 */
export function finalizeCreateOnDblClick(): void {
  document.dispatchEvent(
    new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: false,
    })
  );
}
