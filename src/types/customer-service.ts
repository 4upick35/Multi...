export type CollectionKey =
  | 'applications'
  | 'job_requests'
  | 'sp_requests'
  | 'acts_of_completed_works'
  | 'executors'
  | 'visits_by_masters'
  | 'appeal_tasks'
  | 'articles'
  | 'news'
  | 'services'
  | 'clients'
  | 'shops'
  | 'results_of_work'
  | 'types_of_work'
  | 'client_requirements'
  | 'contragents'
  | 'contracts_of_counterparties'
  | 'categories_of_equipment'
  | 'brands_of_equipment'
  | 'directory_of_nomenclature'
  | 'appeal_type'
  | 'spare_parts'
  | 'spare_parts_categories'
  | 'decisions_by_applications'
  | 'action_with_product'
  | 'service_catalogs'
  | 'appeals';

export interface CollectionMeta {
  key: CollectionKey;
  label: string;
  icon: string;
  section?: 'requests' | 'directories';
}

// --- Заявки / работы (существующие 7 + appeal_tasks, services) ---
// --- Справочники (новые из HAR4) ---

export const COLLECTIONS: CollectionMeta[] = [
  {key: 'applications', label: 'Заявки', icon: 'file-document', section: 'requests'},
  {key: 'job_requests', label: 'Запросы на проведение работ', icon: 'hammer-wrench', section: 'requests'},
  {key: 'sp_requests', label: 'Запросы запасных частей', icon: 'cog', section: 'requests'},
  {key: 'acts_of_completed_works', label: 'Акты выполненных работ', icon: 'clipboard-check', section: 'requests'},
  {key: 'executors', label: 'Сотрудники СЦ', icon: 'account-group', section: 'requests'},
  {key: 'visits_by_masters', label: 'Визиты мастера', icon: 'home-account', section: 'requests'},
  {key: 'appeal_tasks', label: 'Задачи по обращениям', icon: 'message-alert', section: 'requests'},
  {key: 'appeals', label: 'Обращения', icon: 'message-alert-outline', section: 'requests'},
  {key: 'services', label: 'Услуги', icon: 'briefcase-outline', section: 'requests'},
  {key: 'results_of_work', label: 'Результаты работ', icon: 'check-circle-outline', section: 'requests'},
  {key: 'types_of_work', label: 'Виды работ', icon: 'Format-list-bulleted', section: 'directories'},
  {key: 'clients', label: 'Клиенты', icon: 'account-outline', section: 'directories'},
  {key: 'shops', label: 'Магазины', icon: 'store-outline', section: 'directories'},
  {key: 'client_requirements', label: 'Требования клиентов', icon: 'clipboard-text-outline', section: 'directories'},
  {key: 'contragents', label: 'Контрагенты', icon: 'office-building', section: 'directories'},
  {key: 'contracts_of_counterparties', label: 'Договоры контрагентов', icon: 'file-document-outline', section: 'directories'},
  {key: 'categories_of_equipment', label: 'Категории техники', icon: 'tag-outline', section: 'directories'},
  {key: 'brands_of_equipment', label: 'Бренды техники', icon: 'trademark', section: 'directories'},
  {key: 'directory_of_nomenclature', label: 'Номенклатура', icon: 'format-list-bulleted-type', section: 'directories'},
  {key: 'appeal_type', label: 'Типы обращений', icon: 'label-outline', section: 'directories'},
  {key: 'service_catalogs', label: 'Каталоги сервисов', icon: 'library-shelves', section: 'directories'},
  {key: 'spare_parts', label: 'Запасные части', icon: 'cog-outline', section: 'directories'},
  {key: 'spare_parts_categories', label: 'Категории запасных частей', icon: 'tag-multiple-outline', section: 'directories'},
  {key: 'decisions_by_applications', label: 'Решения по заявкам', icon: 'lightbulb-outline', section: 'directories'},
  {key: 'action_with_product', label: 'Действия с товаром', icon: 'package-variant', section: 'directories'},
  {key: 'articles', label: 'Статьи', icon: 'book-open-page-variant', section: 'directories'},
  {key: 'news', label: 'Новости', icon: 'newspaper-variant-outline', section: 'directories'},
];

export interface CollectionItem {
  id: string;
  name: string;
  status: string;
  statusColor?: string;
  createdAt: string;
  accountId?: string;
  raw: Record<string, unknown>;
}

/** Коллекции с большим количеством записей (>50K) — нужна пагинация */
export const LARGE_COLLECTIONS: Partial<Record<CollectionKey, number>> = {
  clients: 3_800_000,
  contracts_of_counterparties: 874_000,
  directory_of_nomenclature: 388_000,
  spare_parts: 8_700,
  brands_of_equipment: 6_400,
  categories_of_equipment: 1_600,
  shops: 150,
  executors: 500,
  visits_by_masters: 5_000,
};

/** Размер страницы для пагинации больших коллекций */
export const DEFAULT_PAGE_SIZE = 50;

/**
 * Множество коллекций, загружаемых через worker/query (PUT /api/worker/query/...).
 * Используется CustomerService для определения маршрута запроса.
 */
export const WORKER_QUERY_COLLECTIONS: Set<string> = new Set([
  'services', 'clients', 'shops',
  'types_of_work', 'client_requirements', 'contragents',
  'contracts_of_counterparties', 'categories_of_equipment',
  'brands_of_equipment', 'directory_of_nomenclature', 'appeal_type',
  'executors',
  'spare_parts_categories', 'decisions_by_applications',
  'action_with_product', 'service_catalogs',
]);

/**
 * Проверить, относится ли коллекция к типу worker/query.
 */
export function isWorkerQueryCollection(key: string): boolean {
  return WORKER_QUERY_COLLECTIONS.has(key);
}

// ---------------------------------------------------------------------------
// Наборы коллекций и кнопок
// ---------------------------------------------------------------------------

/** Коллекции, доступные в приложении (по HAR9/HAR10) */
export const MASTER_SERVICE_COLLECTIONS: CollectionKey[] = [
  'applications', 'appeal_tasks', 'job_requests', 'sp_requests',
  'visits_by_masters', 'acts_of_completed_works',
];

/** Флаги верхних кнопок */
export interface ServiceButtons {
  feed: boolean;
  workCalendar: boolean;
  appealsDirectories: boolean;
  docflow: boolean;
}

export const MASTER_SERVICE_BUTTONS: ServiceButtons = {
  feed: true,
  workCalendar: false,
  appealsDirectories: false,
  docflow: false,
};
