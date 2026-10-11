// ---------------------------------------------------------------------------
// Толерантное извлечение значимых полей из «сырого» элемента клиентского сервиса.
// Используется карточкой заявки (CollectionDetailScreen) и экраном задачи
// (TaskDetailScreen), чтобы не дублировать список полей и подписи.
// ---------------------------------------------------------------------------

/** Подписи полей в порядке отображения. */
const FIELD_LABELS: Record<string, string> = {
  subject_of_request: 'Тема заявки',
  datetime_of_session: 'Дата и время визита',
  technic: 'Техника',
  service: 'Услуга',
  work_order: 'Заказ-наряд',
  seria_unique_number: 'Серийный номер',
  date_of_sale: 'Дата продажи',
  customers_requirement_ref: 'Требование клиента',
  application: 'Заявка',
  request_type: 'Тип запроса',
  request_category: 'Категория запроса',
  applications: 'Заявки',
  applications_status: 'Статус заявки',
  result_of_agreement: 'Результат согласования',
  consent_to_repair: 'Согласие на ремонт',
  approved_by_client: 'Визит подтвержден',
  mileage: 'Километраж',
  reason_for_lack_of_confirrmation: 'Причина отсутствия подтверждения',
  date: 'Дата и время визита',
};

/**
 * Подписи полей для коллекции visits_by_masters в порядке отображения.
 * Переопределяет подпись 'applications' → 'Заявка' (вместо 'Заявки')
 * и задаёт специфичный порядок полей карточки визита.
 */
const VISIT_FIELD_LABELS: Record<string, string> = {
  applications: 'Заявка',
  approved_by_client: 'Визит подтвержден',
  datetime_of_session: 'Дата и время визита',
  mileage: 'Километраж',
  // Код 'route_order' — поле «Порядок на маршруте» не найдено
  // в метаданных приложения (AppFieldMeta.view.name) и HAR-выгрузках.
  // Если код будет известен, добавить сюда и в VISIT_FIELD_ORDER.
  reason_for_lack_of_confirrmation: 'Причина отсутствия подтверждения',
};

/** Порядок полей для карточки визита (ключ → подпись). */
const VISIT_FIELD_ORDER: string[] = [
  'applications',
  'approved_by_client',
  'datetime_of_session',
  'mileage',
  'reason_for_lack_of_confirrmation',
];

/** Строки, похожие на UUID v4 (для безопасного отображения). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Отобразить значение: UUID → резолв, объект → name, массив → join. */
export function displayFieldValue(val: unknown, resolvedRefs?: Map<string, string>, fieldKey?: string): string {
  if (val === undefined || val === null || val === '') { return ''; }
  if (Array.isArray(val)) {
    if (resolvedRefs && fieldKey && resolvedRefs.has(fieldKey)) {
      return resolvedRefs.get(fieldKey)!;
    }
    const items = val.map(v => displayFieldValue(v, resolvedRefs, fieldKey)).filter(Boolean);
    return items.join(', ');
  }
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    return String((obj.name as string) || (obj.__name as string) || (obj.Name as string) || '');
  }
  const str = String(val);
  if (UUID_RE.test(str)) {
    if (resolvedRefs && fieldKey && resolvedRefs.has(fieldKey)) {
      return resolvedRefs.get(fieldKey)!;
    }
    return '';
  }
  return str;
}

/** Показать значение поля в виде строки (объект → имя, массив → перечисление имён). */
function displayValue(val: unknown, resolvedRefs?: Map<string, string>, fieldKey?: string): string {
  if (typeof val === 'boolean') {
    return val ? 'Да' : 'Нет';
  }
  if (Array.isArray(val)) {
    // Если массив UUID и есть резолв — показываем имена
    if (resolvedRefs && fieldKey && resolvedRefs.has(fieldKey)) {
      return resolvedRefs.get(fieldKey)!;
    }
    // Если массив строк (не UUID) — перечисляем
    const items = val
      .map((v) => displayValue(v, resolvedRefs, fieldKey))
      .filter(Boolean);
    return items.join(', ');
  }
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    const name = (obj.name as string) || (obj.__name as string) || (obj.Name as string);
    if (name) {
      return name;
    }
    // Безопасное отображение: не выводим [object Object]
    return '';
  }
  const str = String(val);
  // Не показываем UUID как есть — это нечитаемо
  if (UUID_RE.test(str)) {
    // Если есть резолв для этого ключа — вернём его
    if (resolvedRefs && fieldKey && resolvedRefs.has(fieldKey)) {
      return resolvedRefs.get(fieldKey)!;
    }
    return '';
  }
  // Форматирование ISO-дат в читаемый вид (DD.MM.YYYY)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) {
    try {
      const d = new Date(str);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('ru');
      }
    } catch { /* fall through */ }
  }
  return str;
}

/**
 * Извлечь непустые поля элемента в порядке FIELD_LABELS.
 * Пустые значения (undefined, null, '', пустые массивы) пропускаются.
 * @param resolvedRefs — предварительно разрешённые имена ссылочных полей (UUID → имя).
 * @param collectionKey — ключ коллекции (опционально). Для 'visits_by_masters'
 *   используется специальный порядок и подписи полей (VISIT_FIELD_LABELS).
 */
export function getExtraFields(
  raw: Record<string, unknown>,
  resolvedRefs?: Map<string, string>,
  collectionKey?: string,
): Array<{label: string; value: string}> {
  const fields: Array<{label: string; value: string}> = [];
  const useVisitMode = collectionKey === 'visits_by_masters';
  const fieldOrder = useVisitMode ? VISIT_FIELD_ORDER : Object.keys(FIELD_LABELS);
  const labels = useVisitMode ? VISIT_FIELD_LABELS : FIELD_LABELS;
  for (const key of fieldOrder) {
    const val = raw[key];
    if (val === undefined || val === null || val === '') {
      continue;
    }
    if (Array.isArray(val) && val.length === 0) {
      continue;
    }
    const value = displayValue(val, resolvedRefs, key);
    if (!value) {
      continue;
    }
    fields.push({label: labels[key] ?? FIELD_LABELS[key], value});
  }
  return fields;
}

/** Номер заявки из названия: в applications `name` — это номер (« 3089»). */
export function applicationNumber(item: {name?: string}): number {
  const m = String(item?.name ?? '').match(/\d+/);
  return m ? Number(m[0]) : NaN;
}

/** Заявки по номеру по убыванию; без номера — в конце, порядок сохраняется. */
export function sortApplicationsByNumberDesc<T extends {name?: string}>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const na = applicationNumber(a);
    const nb = applicationNumber(b);
    const aNaN = Number.isNaN(na);
    const bNaN = Number.isNaN(nb);
    if (aNaN && bNaN) { return 0; }
    if (aNaN) { return 1; }
    if (bNaN) { return -1; }
    return nb - na;
  });
}

/** Название/номер элемента: __name → name. */
export function getItemName(raw: Record<string, unknown>): string {
  return (raw.__name as string) || (raw.name as string) || '';
}

/** Статус элемента: __status.name → __status.Name → __status → status. */
export function getItemStatus(raw: Record<string, unknown>): string {
  const status = raw.__status;
  if (status && typeof status === 'object') {
    const obj = status as Record<string, unknown>;
    return (obj.name as string) || (obj.Name as string) || '';
  }
  return (status as string) || (raw.status as string) || '';
}

/** Цвет статуса элемента (если есть). */
export function getItemStatusColor(raw: Record<string, unknown>): string | undefined {
  const status = raw.__status;
  if (status && typeof status === 'object') {
    const obj = status as Record<string, unknown>;
    if (typeof obj.color === 'string' && obj.color) {
      return obj.color;
    }
  }
  return undefined;
}

/** Собрать строку адреса из частей raw-объекта заявки. */
export function buildAddress(raw: Record<string, unknown>): string {
  const clientAddress = String(raw.client_address || '').trim();
  if (clientAddress) {
    return clientAddress;
  }
  const parts = [
    String(raw.locality || '').trim(),
    String(raw.street || '').trim(),
    String(raw.number_of_house || '').trim(),
    String(raw.number_of_apartment || '').trim(),
    String(raw.area || '').trim(),
    String(raw.province || '').trim(),
  ].filter(Boolean);
  return parts.join(', ');
}

/** Сегменты адреса, которые не являются городом/населённым пунктом. */
const ADDRESS_COUNTRY = /^(беларусь|belarus|белоруссия|россия|russia|казахстан)$/i;
const ADDRESS_REGION = /(область|обл\.|край|республика|округ)\s*$/i;
const ADDRESS_DISTRICT = /(район|р-н|сельсовет|сельский совет|поссовет|сельисполком)\s*$/i;

/**
 * Короткий адрес для строки списка: город/населённый пункт всегда в начале,
 * без страны и области («агрогородок Зубки, Коммунистическая улица, 24»).
 */
export function buildShortAddress(raw: Record<string, unknown>): string {
  const full = String(raw.client_address || '').trim();
  const locality = String(raw.locality || '').trim();
  const street = String(raw.street || '').trim();
  const house = String(raw.number_of_house || '').trim();

  // Город: сначала явное поле, иначе — первый неслужебный сегмент адреса.
  let city = locality;
  if (!city && full) {
    const segments = full.split(',').map(s => s.trim()).filter(Boolean);
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (i === 0 && ADDRESS_COUNTRY.test(seg)) {
        continue;
      }
      if (ADDRESS_REGION.test(seg) || ADDRESS_DISTRICT.test(seg)) {
        continue;
      }
      city = seg;
      break;
    }
  }

  // Улица и дом: из отдельных полей, иначе — хвост адреса после города.
  let rest = [street, house].filter(Boolean).join(', ');
  if (!rest && full && city) {
    const idx = full.indexOf(city);
    if (idx >= 0) {
      rest = full.slice(idx + city.length).replace(/^[,\s]+/, '');
    }
  }

  return [city, rest].filter(Boolean).join(', ');
}
