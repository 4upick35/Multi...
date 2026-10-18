/** Путь websocket-эндпоинта портала (relative to baseUrl). */
export const WS_PATH = '/ws/v2/websocket';

/** Сервисы portal-frontend: для каждого — свой пользовательский канал. */
export const REALTIME_SERVICES: readonly string[] = ['', 'feed', 'crm', 'events', 'chat'];

/**
 * Построение websocket-URL из baseUrl учётки:
 * http -> ws, https -> wss, путь `/ws/v2/websocket`.
 */
export function buildRealtimeUrl(baseUrl: string): string {
  const raw = baseUrl === undefined || baseUrl === null ? '' : String(baseUrl);
  const trimmed = raw.trim().replace(/\/+$/, '');
  const withWsScheme = trimmed.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
  return withWsScheme + WS_PATH;
}

/**
 * Имя пользовательского канала: `<service>:private.<company>#<userID>`.
 * Для базового сервиса service='' имя начинается с ':'.
 */
export function buildPrivateChannel(service: string, company: string, userID: string): string {
  return service + ':private.' + company + '#' + userID;
}

/** Все пользовательские каналы для company/userID (по одному на сервис). */
export function buildRealtimeChannels(company: string, userID: string): string[] {
  return REALTIME_SERVICES.map(service => buildPrivateChannel(service, company, userID));
}
