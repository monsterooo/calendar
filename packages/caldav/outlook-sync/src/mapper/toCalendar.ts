import type { CalendarType } from '@dayflow/core';
import { getCalendarColorsForHex } from '@dayflow/core';
import type {
  OutlookCalendar,
  OutlookCalendarColor,
} from '@outlook-sync/types/api';

// Outlook named colors → hex approximations
const OUTLOOK_COLOR_HEX: Record<OutlookCalendarColor, string> = {
  auto: '#0078d4',
  lightBlue: '#4a90d9',
  lightGreen: '#6ab187',
  lightOrange: '#e79423',
  lightGray: '#8e8e8e',
  lightYellow: '#ebb723',
  lightTeal: '#4a9d9c',
  lightPink: '#e872a9',
  lightBrown: '#b36b35',
  lightRed: '#e35151',
  maxColor: '#e86262',
  darkBlue: '#1550a6',
  darkGreen: '#2b7b30',
  darkOrange: '#bf4610',
  darkGray: '#5a5a5a',
  darkYellow: '#b38600',
  darkTeal: '#007b79',
  darkPink: '#9c3674',
  darkBrown: '#7a3800',
  darkRed: '#a30808',
};

/**
 * Map an Outlook Calendar to a DayFlow CalendarType.
 */
export function mapOutlookCalendarToDayFlow(
  calendar: OutlookCalendar
): CalendarType {
  const hex = OUTLOOK_COLOR_HEX[calendar.color] ?? OUTLOOK_COLOR_HEX['auto'];
  const { colors, darkColors } = getCalendarColorsForHex(hex);

  return {
    id: calendar.id,
    name: calendar.name,
    source: 'Outlook',
    readOnly: !calendar.canEdit,
    colors,
    ...(darkColors ? { darkColors } : {}),
    subscription: {
      url: `outlook:${calendar.id}`,
      status: 'ready',
      meta: {
        outlook: {
          calendarId: calendar.id,
          isDefault: calendar.isDefaultCalendar,
          ownerAddress: calendar.owner?.address,
        },
      },
    },
  };
}
