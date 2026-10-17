export const API_ENDPOINTS = {
  publicBase: '/pub/v1',
  taskList: '/tasks',
  taskById: (id: string) => `/tasks/${id}`,
  acceptTask: (id: string) => `/tasks/${id}/perform`,
  startTask: (id: string) => `/tasks/${id}/start`,
  completeTask: (id: string) => `/tasks/${id}/complete`,
};

export const DEFAULT_POLL_INTERVAL_SEC = 30;
export const MIN_POLL_INTERVAL_SEC = 15;
export const MAX_POLL_INTERVAL_SEC = 120;
export const HOST_MIN_GAP_MS = 400;
// Макс. число одновременных запросов к одному origin (антибан: не заваливать сервер)
export const HOST_MAX_CONCURRENCY = 3;
export const MAX_CONSECUTIVE_ERRORS = 6;
export const BACKOFF_CAP_MS = 10 * 60 * 1000;

export const POLL_JITTER_MIN = 0.7;
export const POLL_JITTER_MAX = 1.5;

export const ACCOUNT_COLORS = [
  '#6200EE', '#03DAC6', '#FF5722', '#4CAF50',
  '#2196F3', '#FF9800', '#E91E63', '#00BCD4',
];

// Минимальный разнос между стартами обновлений разных учёток (антиобнаружение)
export const ACCOUNT_SYNC_MIN_GAP_MS = 10_000;
// Рандомайзер к разносу: 0..5000 мс
export const ACCOUNT_SYNC_GAP_JITTER_MS = 5_000;
// Страховочный минимум разноса между стартами учёток очереди в applications-sync.
export const QUEUE_MIN_GAP_MS = 1_000;

// Максимум приоритетных учёток (опрашиваются каждые 5 с)
export const PRIORITY_MAX_ACCOUNTS = 3;

// Ускоренный режим: учётки на экране заявок и приоритетные из настроек
export const FAST_POLL_INTERVAL_SEC = 5;
// Отклонение ускоренного опроса: 5 с ± 1 с (приоритетные учётки)
export const FAST_POLL_JITTER_MS = 1_000;
// Минимальный разнос между стартами для foreground-учёток (видимые на экране
// заявок). Приоритетные учётки из настроек этот разнос НЕ используют.
export const FAST_MIN_GAP_MS = 4_000;
// Случайная добавка к разносу foreground-учёток (приоритетные не используют)
export const FAST_GAP_JITTER_MS = 2_000;

// Минимальная пауза между отправками выходов задачи (антибан: серия быстрых
// переходов задачи воспринимается сервером как странный поток запросов).
export const SUBMIT_MIN_GAP_MS = 3_000;

// Пуш-режим: сколько realtime учётки должен быть НЕ в состоянии `subscribed`,
// прежде чем включится страховочный опрос списка (защита от потери заявок
// при отвале/обрыве пуша). После восстановления подписки опрос снова гаснет.
export const PUSH_FALLBACK_DELAY_MS = 15_000;

export const DEEP_LINK_PREFIX = 'elma://';

// Звуки уведомлений. Идентификатор понимает нативный слой (KeepAliveModule.createAlertPlayer):
// raw:<имя> — встроенный ресурс res/raw, system — системный звук, uri:<uri> — внешний.
export const ALERT_SOUND_GENERAL = 'raw:notification_general';
export const ALERT_SOUND_ALERT = 'raw:notification_alert';
export const ALERT_SOUND_SYSTEM = 'system';

export const ALERT_SOUND_OPTIONS: {id: string; label: string}[] = [
  {id: ALERT_SOUND_GENERAL, label: 'Обычный'},
  {id: ALERT_SOUND_ALERT, label: 'Тревожный'},
  {id: ALERT_SOUND_SYSTEM, label: 'Системный'},
];

export const ALERT_VOLUME_OPTIONS = [1, 3, 5, 7, 10];

export const DEFAULT_NEW_APPLICATION_SOUND = ALERT_SOUND_ALERT;
export const DEFAULT_OTHER_SOUND = ALERT_SOUND_GENERAL;
export const DEFAULT_ALERT_VOLUME = 10;

export const STORAGE_KEYS = {
  accounts: '@multi_elma_accounts',
  settings: '@multi_elma_settings',
  seenApplicationAlerts: '@multi_elma_seen_application_alerts',
  acceptTemplates: '@multi_elma_accept_templates',
};
