/**
 * Чистые функции для сборки тела PUT /api/bpm/tasks/{uuid}
 * при выполнении работ мастером.
 *
 * Порядок ключей и структура тела подтверждены HAR16 (entry 1361),
 * строка «Использованные запчасти/материалы» — HAR23 (байт в байт).
 * Функции НЕ делают сетевых запросов и НЕ добавляют __action / __exit.
 */

import {uuidv4} from './uuid';

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------

export interface ExecutionFileInput {
  id: string;
  name: string;
  hash: string;
  size: number;
  /** ISO-строка даты создания файла. Если не передана — текущее время. */
  createdAt?: string;
}

export interface SparePartRow {
  nameOfSpareParts: string;
  /** id выбранной запчасти из справочника; пусто для «Не найдено в списке». */
  sparePartId?: string;
  /** Принадлежность строки: recovery | service_center. */
  affiliation: 'recovery' | 'service_center';
  count: number;
  price: number;
  /** Планируемая дата доставки (ISO, начало дня UTC). */
  plannedDeliveryDate?: string;
}

export interface ExecutionFormInput {
  serialNumber?: string;
  technicalConclusion?: string;
  plannedCompletionDate?: string;
  totalCostForExecutor?: number | null;
  totalCostOfRepair?: number | null;
  resultOfWorkIds?: string[];
  decisionIds?: string[];
  sparePartRows?: SparePartRow[];
  files?: ExecutionFileInput[];
}

// ---------------------------------------------------------------------------
// Справочники
// ---------------------------------------------------------------------------

/** Принадлежность ЗЧ в строке таблицы (enum шаблона процесса v30). */
const AFFILIATION_BY_CODE: Record<
  'recovery' | 'service_center',
  {code: string; name: string; checked: boolean}
> = {
  recovery: {code: 'recovery', name: 'Восстановление', checked: false},
  service_center: {code: 'service_center', name: 'ЗЧ исполнителя', checked: false},
};

// ---------------------------------------------------------------------------
// Вспомогательные функции
// ---------------------------------------------------------------------------

/** Проверить, что значение «пустое» и не должно попадать в тело запроса */
function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === '') {
    return true;
  }
  if (Array.isArray(value) && value.length === 0) {
    return true;
  }
  return false;
}

/** Округлить до 2 знаков после запятой */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Текущее время в ISO-строкой с 'Z' (для __createdAt/__updatedAt) */
function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Начало дня в UTC для календарной даты (локальные компоненты даты),
 * например `2026-09-26T00:00:00.000Z`. Используется и для
 * `planned_completion_date`, и для `planned_delivery_date`.
 */
export function utcStartOfDayIso(date: Date): string {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString();
}

/**
 * Привести ISO-строку к началу дня в UTC (как шлёт сайт).
 * Неразбираемая строка и `undefined` → `null`.
 */
function toUtcStartOfDayIso(iso: string | undefined): string | null {
  if (!iso) {
    return null;
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  ).toISOString();
}

// ---------------------------------------------------------------------------
// Основная функция
// ---------------------------------------------------------------------------

/**
 * Собрать тело запроса для сохранения данных выполнения работ.
 *
 * Правила:
 *  - Пустые значения НЕ включаются (undefined, null, '', []);
 *  - поля «Комментарий» в форме нет — `comment_on_request` не отправляется;
 *  - used_spare_parts_materials в форме {rows, result: {__count}};
 *  - строка ЗЧ — ровно формат HAR23 (ключи и порядок как на сайте);
 *  - files_to_request — полная структура по HAR16;
 *  - __action и __exit НЕ добавляются.
 */
export function buildExecutionTaskBody(
  input: ExecutionFormInput,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  // --- Простые поля ---

  if (!isEmpty(input.serialNumber)) {
    body['sn_of_technology'] = input.serialNumber;
  }

  if (!isEmpty(input.technicalConclusion)) {
    body['technical_conclusion'] = input.technicalConclusion;
  }

  if (!isEmpty(input.plannedCompletionDate)) {
    body['planned_completion_date'] = input.plannedCompletionDate;
  }

  if (input.totalCostForExecutor != null) {
    body['total_cost_for_executor'] = input.totalCostForExecutor;
  }

  if (input.totalCostOfRepair != null) {
    body['total_cost_of_repair_number'] = input.totalCostOfRepair;
  }

  if (!isEmpty(input.resultOfWorkIds)) {
    body['result_of_work'] = input.resultOfWorkIds;
  }

  if (!isEmpty(input.decisionIds)) {
    body['decision_of_application'] = input.decisionIds;
  }

  // --- Запчасти ---

  if (!isEmpty(input.sparePartRows) && input.sparePartRows!.length > 0) {
    const rows = input.sparePartRows!.map((row, idx) => ({
      name_of_spare_parts: row.nameOfSpareParts,
      name: row.sparePartId ? [row.sparePartId] : [],
      affiliation: [{...AFFILIATION_BY_CODE[row.affiliation]}],
      type_of_repair: null,
      count: row.count,
      price: row.price,
      amount: round2(row.count * row.price),
      files: [],
      planned_delivery_date: toUtcStartOfDayIso(row.plannedDeliveryDate),
      agreed_price: null,
      __index: idx + 1,
      __id: uuidv4(),
    }));

    body['used_spare_parts_materials'] = {
      rows,
      result: {__count: rows.length},
    };
  }

  // --- Файлы ---

  if (!isEmpty(input.files) && input.files!.length > 0) {
    const ts = nowIso();
    body['files_to_request'] = input.files!.map((f) => ({
      id: f.id,
      name: f.name,
      hash: f.hash,
      size: f.size,
      file: {
        __id: f.id,
        __createdAt: f.createdAt || ts,
        __updatedAt: f.createdAt || ts,
        __deletedAt: null,
        __name: f.name,
        originalName: f.name,
        __currentUserPermissions: [],
        size: f.size,
        hash: f.hash,
        version: 1,
        __subscribers: [],
      },
    }));
  }

  return body;
}
