import { useRef, useState } from 'preact/hooks';

import { MultiDayEventSegment } from '@/components/monthView/util';
import { Event, ICalendarApp } from '@/types';

interface UseEventInteractionProps {
  event: Event;
  isTouchEnabled: boolean;
  onMoveStart?: (e: MouseEvent | TouchEvent, event: Event) => void;
  onEventLongPress?: (eventId: string) => void;
  onEventSelect?: (eventId: string | null) => void;
  onDetailPanelToggle?: (key: string | null) => void;
  canOpenDetail: boolean;
  useEventDetailPanel?: boolean;
  app?: ICalendarApp;
  multiDaySegmentInfo?: {
    startHour?: number;
    endHour?: number;
    isFirst: boolean;
    isLast: boolean;
    dayIndex?: number;
  };
  isMultiDay?: boolean;
  segment?: MultiDayEventSegment;
  detailPanelKey: string;
}

export const useEventInteraction = ({
  event,
  isTouchEnabled,
  onMoveStart,
  onEventLongPress,
  onEventSelect,
  onDetailPanelToggle,
  canOpenDetail,
  useEventDetailPanel,
  app,
  multiDaySegmentInfo,
  isMultiDay,
  segment,
}: UseEventInteractionProps) => {
  const [isSelected, setIsSelected] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const latestTouchPosRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);
  const suppressClickUntilRef = useRef(0);
  const LONG_PRESS_DELAY_MS = 500;
  const LONG_PRESS_MOVE_TOLERANCE_PX = 14;

  const handleTouchStart = (e: TouchEvent) => {
    if (!onMoveStart || !isTouchEnabled) return;
    e.stopPropagation();
    e.preventDefault();
    setIsPressed(true);

    const touch = e.touches[0];
    const clientX = touch.clientX;
    const clientY = touch.clientY;
    const currentTarget = e.currentTarget as HTMLElement;

    touchStartPosRef.current = { x: clientX, y: clientY };
    latestTouchPosRef.current = { x: clientX, y: clientY };
    longPressTriggeredRef.current = false;

    longPressTimerRef.current = setTimeout(() => {
      const latestTouch = latestTouchPosRef.current ?? {
        x: clientX,
        y: clientY,
      };

      if (onEventLongPress) {
        onEventLongPress(event.id);
      } else {
        setIsSelected(true);
      }

      const syntheticEvent = {
        preventDefault: () => {
          /* noop */
        },
        stopPropagation: () => {
          /* noop */
        },
        currentTarget: currentTarget,
        touches: [{ clientX: latestTouch.x, clientY: latestTouch.y }],
        cancelable: false,
      } as unknown as MouseEvent | TouchEvent;

      longPressTriggeredRef.current = true;

      if (multiDaySegmentInfo) {
        const adjustedEvent = {
          ...event,
          day: multiDaySegmentInfo.dayIndex ?? event.day,
          _segmentInfo: multiDaySegmentInfo,
        };
        onMoveStart(syntheticEvent, adjustedEvent as Event);
      } else if (isMultiDay && segment) {
        const adjustedEvent = {
          ...event,
          day: segment.startDayIndex,
          _segmentInfo: {
            dayIndex: segment.startDayIndex,
            isFirst: segment.isFirstSegment,
            isLast: segment.isLastSegment,
          },
        };
        onMoveStart(syntheticEvent, adjustedEvent as Event);
      } else {
        onMoveStart(syntheticEvent, event);
      }
      longPressTimerRef.current = null;
      touchStartPosRef.current = null;

      if (navigator.vibrate) {
        navigator.vibrate(50);
      }

      suppressClickUntilRef.current = Date.now() + 400;
    }, LONG_PRESS_DELAY_MS);
  };

  const handleTouchMove = (e: TouchEvent) => {
    const touch = e.touches[0];
    if (touch) {
      latestTouchPosRef.current = {
        x: touch.clientX,
        y: touch.clientY,
      };
    }

    if (longPressTriggeredRef.current) {
      if (e.cancelable) {
        e.preventDefault();
      }
      e.stopPropagation();
      return;
    }

    if (isTouchEnabled) {
      e.stopPropagation();
    }
    if (longPressTimerRef.current && touchStartPosRef.current) {
      const dx = Math.abs((touch?.clientX ?? 0) - touchStartPosRef.current.x);
      const dy = Math.abs((touch?.clientY ?? 0) - touchStartPosRef.current.y);
      if (
        dx > LONG_PRESS_MOVE_TOLERANCE_PX ||
        dy > LONG_PRESS_MOVE_TOLERANCE_PX
      ) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
        touchStartPosRef.current = null;
        latestTouchPosRef.current = null;
        setIsPressed(false);
      }
    }
  };

  const handleTouchEnd = (e: TouchEvent) => {
    setIsPressed(false);
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      touchStartPosRef.current = null;
      latestTouchPosRef.current = null;
      return;
    }

    if (isTouchEnabled && touchStartPosRef.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressClickUntilRef.current = Date.now() + 400;

      if (app) {
        app.onEventClick(event);
      }

      if (canOpenDetail) {
        if (onEventSelect) {
          onEventSelect(event.id);
        } else {
          setIsSelected(true);
        }

        if (useEventDetailPanel !== false) {
          onDetailPanelToggle?.(null);
        }
      } else {
        onEventSelect?.(null);
        if (useEventDetailPanel !== false) {
          onDetailPanelToggle?.(null);
        }
      }
    }

    touchStartPosRef.current = null;
    latestTouchPosRef.current = null;
  };

  const handleTouchCancel = () => {
    setIsPressed(false);
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartPosRef.current = null;
    latestTouchPosRef.current = null;
    longPressTriggeredRef.current = false;
  };

  return {
    isSelected,
    setIsSelected,
    isPressed,
    setIsPressed,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
    shouldSuppressClick: () => Date.now() < suppressClickUntilRef.current,
  };
};
