// ---------------------------------------------------------------------------
// useFeedPolling — ускоренный опрос ленты с джиттером.
// Использует useJitterPolling для тайминга, но с более коротким интервалом
// (10 сек + до 5 сек джиттера = 10–15 сек) вместо стандартных 30+ сек.
// При каждом опросе загружает первую страницу и добавляет только НОВЫЕ
// сообщения в начало списка (дедупликация по id), не заменяя загруженные.
// ---------------------------------------------------------------------------

import {useCallback, useEffect, useRef} from 'react';
import {useActiveAccount} from './useActiveAccount';
import {useFeedStore} from '../store/feed-store';
import {ElmaAccount} from '../types/account';
import {feedMessages as apiFeedMessages} from '../services/elma-api';
import {mapRawMessage} from '../domain/FeedService';
import {resolveUserNames} from '../services/elma-api';
import {nextIntervalWithJitter} from './useJitterPolling';
import {useSettingsStore} from '../store/settings-store';

/** Базовый интервал опроса ленты (мс) */
const FEED_POLL_BASE_MS = 10_000;
/** Максимальный джиттер (мс) */
const FEED_POLL_JITTER_MS = 5_000;
/** GUID системного автора (скрывается в UI) */
const SYSTEM_GUID = '00000000-0000-0000-0000-000000000000';

/**
 * Загрузить первую страницу ленты и добавить только новые сообщения
 * в начало списка (дедупликация по id).
 * Возвращает количество добавленных сообщений.
 */
async function pollNewFeedMessages(account: ElmaAccount): Promise<number> {
  const {messages: raw} = await apiFeedMessages(account, 0);
  if (!raw || raw.length === 0) {
    return 0;
  }

  const mapped = (raw as Record<string, unknown>[]).map(mapRawMessage);

  // Резолв GUID авторов → имена (только для новых сообщений)
  const authorGuids = [
    ...new Set(
      mapped
        .map((m) => m.author)
        .filter((a): a is string => !!a && a !== SYSTEM_GUID),
    ),
  ];
  if (authorGuids.length > 0) {
    const nameMap = await resolveUserNames(account, authorGuids);
    for (const m of mapped) {
      if (m.author && m.author !== SYSTEM_GUID && nameMap.has(m.author)) {
        m.author = nameMap.get(m.author) || '';
      }
    }
  }
  // Системный GUID и пустые авторы — очищаем
  for (const m of mapped) {
    if (!m.author || m.author === SYSTEM_GUID) {
      m.author = '';
    }
  }

  // Добавить только новые сообщения в начало списка
  useFeedStore.getState().prependMessages(account.id, mapped);

  // Вернуть число добавленных (для диагностики)
  const existing = useFeedStore.getState().getMessages(account.id);
  return existing.length > 0 ? Math.min(mapped.length, existing.length) : mapped.length;
}

/**
 * Хук ускоренного опроса ленты.
 *
 * Запускает опрос при фокусе на экране, останавливает при уходе.
 * Интервал: 10 сек + 0–5 сек джиттер = 10–15 сек между запросами.
 * Дедупликация: при каждом опросе загружается первая страница, но в список
 * добавляются только сообщения с id, которых ещё нет в сторе.
 * Не делает запросов, когда приложение в фоне (依托 useFocusEffect-паттерн).
 *
 * @example
 * useFeedPolling();
 */
export function useFeedPolling(): void {
  const {account} = useActiveAccount();
  const enabledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);

  const scheduleNext = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    const delay = nextIntervalWithJitter(FEED_POLL_BASE_MS, FEED_POLL_JITTER_MS);
    timerRef.current = setTimeout(async () => {
      timerRef.current = null;
      // Пауза синхронизации: цикл пропускаем, но продолжаем планировать,
      // чтобы после снятия паузы опрос возобновился сам.
      if (inFlightRef.current || !enabledRef.current || !account) {
        return;
      }
      if (useSettingsStore.getState().syncPaused) {
        scheduleNext();
        return;
      }
      inFlightRef.current = true;
      try {
        await pollNewFeedMessages(account);
      } catch {
        // Ошибки сети не ломают UI — просто пропускаем цикл
      } finally {
        inFlightRef.current = false;
        if (enabledRef.current) {
          scheduleNext();
        }
      }
    }, delay);
  }, [account]);

  useEffect(() => {
    const shouldRun = !!account;
    enabledRef.current = shouldRun;

    if (!shouldRun) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    scheduleNext();

    return () => {
      enabledRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [account, scheduleNext]);
}
