import {ElmaAccount} from '../../types/account';
import {cacheGet, cacheSet, TTL_5MIN_MS, TTL_30MIN_MS} from '../elma-cache';
import {makeRequest} from './client';

// ---------------------------------------------------------------------------
// Public API: fetchWorkCalendar — GET /api/work-calendar/default
// ---------------------------------------------------------------------------

const CACHE_KEY_WORK_CALENDAR = 'workCalendar';

export async function fetchWorkCalendar(
  account: ElmaAccount,
): Promise<{calendar: Record<string, unknown> | null; updatedAccount?: Partial<ElmaAccount>}> {
  // #32: Кэш рабочего календаря (TTL 30 мин — календарь редко меняется)
  const cached = cacheGet<Record<string, unknown>>(account.id, CACHE_KEY_WORK_CALENDAR);
  if (cached !== undefined) {
    return {calendar: cached};
  }

  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      '/api/work-calendar/default',
    );
    const calendar = (data as Record<string, unknown>) || null;
    if (calendar) {
      cacheSet(account.id, CACHE_KEY_WORK_CALENDAR, calendar, TTL_30MIN_MS);
    }
    return {calendar, updatedAccount};
  } catch {
    return {calendar: null};
  }
}

// ---------------------------------------------------------------------------
// #16: GET /api/work-calendar/special/{calendarId}/days — special calendar days
// ---------------------------------------------------------------------------

export interface SpecialDay {
  date: string;
  name: string;
  isWorkingDay: boolean;
  raw: Record<string, unknown>;
}

function cacheKeySpecialDays(calendarId: string): string {
  return `specialDays::${calendarId}`;
}

export async function fetchSpecialDays(
  account: ElmaAccount,
  calendarId: string,
): Promise<{days: SpecialDay[]; updatedAccount?: Partial<ElmaAccount>}> {
  const cacheKey = cacheKeySpecialDays(calendarId);
  const cached = cacheGet<SpecialDay[]>(account.id, cacheKey);
  if (cached !== undefined) {
    return {days: cached};
  }

  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      `/api/work-calendar/special/${calendarId}/days`,
    );
    const items = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    const days: SpecialDay[] = items.map((d) => ({
      date: String(d.date || d.__name || ''),
      name: String(d.name || d.__name || ''),
      isWorkingDay: Boolean(d.isWorkingDay),
      raw: d,
    }));
    cacheSet(account.id, cacheKey, days, TTL_5MIN_MS);
    return {days, updatedAccount};
  } catch {
    return {days: []};
  }
}
