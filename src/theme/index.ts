// ---------------------------------------------------------------------------
// Central theme module for light/dark colour palettes and theme hook
// ---------------------------------------------------------------------------

import {useColorScheme} from 'react-native';
import {useSettingsStore} from '../store/settings-store';

export type ThemeMode = 'light' | 'dark' | 'system';

// ---------- Light theme ----------
export const LIGHT_THEME = {
  colors: {
    primary: '#6200EE',
    error: '#E53935',
    success: '#4CAF50',
    warning: '#FF9800',
    muted: '#9E9E9E',
    background: '#F5F5F5',
    surface: '#fff',
    separator: '#E8E8E8',
    chipDefault: '#E8E8E8',
    onBackground: '#fff',
    textPrimary: '#333',
    textSecondary: '#666',
    textTertiary: '#999',
    primaryLight15: '#6200EE15',
    primaryLight10: '#6200EE10',
    primaryBorder30: '#6200EE30',
    primaryMuted60: '#6200EE99',
    calendarWorkBg: '#E8F5E9',
    calendarWorkText: '#2E7D32',
    calendarHolidayBg: '#FFF3E0',
    calendarHolidayText: '#E65100',
    calendarOverdueBg: '#FFEBEE',
    priorityDefault: '#9E9E9E',
    acceptedBg: '#4CAF50',
    textSubtle: '#444',
    primary30: '#2196F3',
    successLight15: '#4CAF5015',
    cellBackground: '#F8F8F8',
  },
  isDark: false,
  mode: 'light',
} as const;

// ---------- Dark theme ----------
export const DARK_THEME = {
  colors: {
    primary: '#BB86FC',
    error: '#E53935',
    success: '#4CAF50',
    warning: '#FF9800',
    muted: '#9E9E9E',
    background: '#121212',
    surface: '#1E1E1E',
    separator: '#2C2C2C',
    chipDefault: '#2A2A2A',
    onBackground: '#EAEAEA',
    textPrimary: '#E0E0E0',
    textSecondary: '#CCCCCC',
    textTertiary: '#EEEEEE',
    primaryLight15: '#BB86FC15',
    primaryLight10: '#BB86FC10',
    primaryBorder30: '#BB86FC30',
    primaryMuted60: '#BB86FC99',
    calendarWorkBg: '#1B5E20',
    calendarWorkText: '#CCFFCC',
    calendarHolidayBg: '#3E2723',
    calendarHolidayText: '#FFCC80',
    calendarOverdueBg: '#3B0F0F',
    priorityDefault: '#9E9E9E',
    acceptedBg: '#4CAF50',
    textSubtle: '#B0B0B0',
    primary30: '#1976D2',
    successLight15: '#4CAF5033',
    cellBackground: '#2A2A2A',
  },
  isDark: true,
  mode: 'dark',
} as const;

// ---------- Hook ----------
export function useAppTheme() {
  const storedMode = useSettingsStore((s) => s.themeMode);
  const systemScheme = useColorScheme();
  const mode: 'light' | 'dark' = storedMode === 'system'
    ? (systemScheme ?? 'light')
    : storedMode;

  const theme = mode === 'dark' ? DARK_THEME : LIGHT_THEME;

  return {colors: theme.colors, isDark: theme.isDark, mode: theme.mode};
}