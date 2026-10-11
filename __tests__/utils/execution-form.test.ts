import {buildExecutionTaskBody, utcStartOfDayIso} from '../../src/utils/execution-form';
import type {ExecutionFormInput, SparePartRow} from '../../src/utils/execution-form';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Строка ЗЧ из эталона HAR23 (без __id — генерируется клиентом). */
function referenceRow(overrides: Partial<SparePartRow> = {}) {
  return {
    nameOfSpareParts: 'Средство для чистки стиральных машин 4816145100842',
    sparePartId: '01a0c2ea-2cc9-716d-9083-cb49159b7d64',
    affiliation: 'service_center' as const,
    count: 1,
    price: 4.46,
    plannedDeliveryDate: '2026-09-26T00:00:00.000Z',
    ...overrides,
  };
}

type ServerSpareRow = {
  name_of_spare_parts: string;
  name: string[];
  affiliation: Array<{code: string; name: string; checked: boolean}>;
  type_of_repair: null;
  count: number;
  price: number;
  amount: number;
  files: unknown[];
  planned_delivery_date: string | null;
  agreed_price: null;
  __index: number;
  __id: string;
};

function spareRows(body: Record<string, unknown>): ServerSpareRow[] {
  const spare = body['used_spare_parts_materials'] as {rows: ServerSpareRow[]};
  return spare.rows;
}

describe('buildExecutionTaskBody', () => {
  // =========================================================================
  // Пустые значения не попадают в тело
  // =========================================================================

  describe('пустые значения НЕ попадают в тело', () => {
    it('пустой ввод возвращает пустой объект', () => {
      expect(buildExecutionTaskBody({})).toEqual({});
    });

    it('undefined не попадает в тело', () => {
      const body = buildExecutionTaskBody({
        serialNumber: undefined,
        technicalConclusion: undefined,
        plannedCompletionDate: undefined,
        totalCostForExecutor: undefined,
        totalCostOfRepair: undefined,
      });
      expect(Object.keys(body)).toHaveLength(0);
    });

    it('null для totalCostForExecutor не попадает', () => {
      const body = buildExecutionTaskBody({totalCostForExecutor: null});
      expect(body['total_cost_for_executor']).toBeUndefined();
    });

    it('пустая строка не попадает', () => {
      const body = buildExecutionTaskBody({serialNumber: ''});
      expect(body['sn_of_technology']).toBeUndefined();
    });

    it('пустой массив resultOfWorkIds не попадает', () => {
      const body = buildExecutionTaskBody({resultOfWorkIds: []});
      expect(body['result_of_work']).toBeUndefined();
    });

    it('пустой массив decisionIds не попадает', () => {
      const body = buildExecutionTaskBody({decisionIds: []});
      expect(body['decision_of_application']).toBeUndefined();
    });

    it('пустой массив sparePartRows не попадает', () => {
      const body = buildExecutionTaskBody({sparePartRows: []});
      expect(body['used_spare_parts_materials']).toBeUndefined();
    });

    it('пустой массив files не попадает', () => {
      const body = buildExecutionTaskBody({files: []});
      expect(body['files_to_request']).toBeUndefined();
    });
  });

  // =========================================================================
  // Простые поля попадают как есть
  // =========================================================================

  describe('простые поля попадают как есть', () => {
    it('sn_of_technology попадает как есть', () => {
      const body = buildExecutionTaskBody({serialNumber: 'SN-123'});
      expect(body['sn_of_technology']).toBe('SN-123');
    });

    it('technical_conclusion попадает как есть', () => {
      const body = buildExecutionTaskBody({
        technicalConclusion: 'ТО, чистка фильтров',
      });
      expect(body['technical_conclusion']).toBe('ТО, чистка фильтров');
    });

    it('planned_completion_date — ISO-строка', () => {
      const body = buildExecutionTaskBody({
        plannedCompletionDate: '2026-09-20T00:00:00.000Z',
      });
      expect(body['planned_completion_date']).toBe(
        '2026-09-20T00:00:00.000Z',
      );
    });

    it('result_of_work — массив ID', () => {
      const body = buildExecutionTaskBody({
        resultOfWorkIds: ['id-1', 'id-2'],
      });
      expect(body['result_of_work']).toEqual(['id-1', 'id-2']);
    });

    it('decision_of_application — массив ID', () => {
      const body = buildExecutionTaskBody({
        decisionIds: ['dec-1'],
      });
      expect(body['decision_of_application']).toEqual(['dec-1']);
    });
  });

  // =========================================================================
  // Поля «Комментарий» в форме нет — comment_on_request НЕ отправляется
  // =========================================================================

  describe('comment_on_request НЕ отправляется', () => {
    it('в теле нет ключа comment_on_request', () => {
      const body = buildExecutionTaskBody({
        serialNumber: 'SN-1',
        technicalConclusion: 'Заключение',
        plannedCompletionDate: '2026-09-20T00:00:00.000Z',
      });
      expect(Object.keys(body)).not.toContain('comment_on_request');
      expect(body['comment_on_request']).toBeUndefined();
    });

    it('даже если передать comment через широкий тип — он не попадает в тело', () => {
      const input = {
        serialNumber: 'SN-1',
        comment: 'Комментарий',
      } as unknown as ExecutionFormInput;
      const body = buildExecutionTaskBody(input);
      expect(body['comment_on_request']).toBeUndefined();
      expect(Object.keys(body)).toEqual(['sn_of_technology']);
    });
  });

  // =========================================================================
  // Строка ЗЧ — ровно эталон HAR23
  // =========================================================================

  describe('used_spare_parts_materials — эталон HAR23', () => {
    it('строка байт в байт совпадает с запросом сайта', () => {
      const body = buildExecutionTaskBody({
        sparePartRows: [referenceRow()],
      });

      const rows = spareRows(body);
      expect(rows).toHaveLength(1);

      // Порядок ключей — как в запросе сайта
      expect(Object.keys(rows[0])).toEqual([
        'name_of_spare_parts',
        'name',
        'affiliation',
        'type_of_repair',
        'count',
        'price',
        'amount',
        'files',
        'planned_delivery_date',
        'agreed_price',
        '__index',
        '__id',
      ]);

      const {__id, ...rest} = rows[0];
      expect(__id).toMatch(UUID_RE);
      expect(rest).toEqual({
        name_of_spare_parts: 'Средство для чистки стиральных машин 4816145100842',
        name: ['01a0c2ea-2cc9-716d-9083-cb49159b7d64'],
        affiliation: [
          {code: 'service_center', name: 'ЗЧ исполнителя', checked: false},
        ],
        type_of_repair: null,
        count: 1,
        price: 4.46,
        amount: 4.46,
        files: [],
        planned_delivery_date: '2026-09-26T00:00:00.000Z',
        agreed_price: null,
        __index: 1,
      });
    });

    it('name: [] когда sparePartId не передан («Не найдено в списке»)', () => {
      const body = buildExecutionTaskBody({
        sparePartRows: [referenceRow({sparePartId: undefined})],
      });

      expect(spareRows(body)[0].name).toEqual([]);
    });

    it('affiliation recovery → «Восстановление», checked: false', () => {
      const body = buildExecutionTaskBody({
        sparePartRows: [referenceRow({affiliation: 'recovery'})],
      });

      expect(spareRows(body)[0].affiliation).toEqual([
        {code: 'recovery', name: 'Восстановление', checked: false},
      ]);
    });

    it('каждая строка получает свой новый __id', () => {
      const body = buildExecutionTaskBody({
        sparePartRows: [referenceRow(), referenceRow({affiliation: 'recovery'})],
      });

      const rows = spareRows(body);
      expect(rows[0].__id).not.toBe(rows[1].__id);
      expect(rows[0].__id).toMatch(UUID_RE);
      expect(rows[1].__id).toMatch(UUID_RE);
    });

    it('planned_delivery_date нормализуется к началу дня в UTC', () => {
      const body = buildExecutionTaskBody({
        sparePartRows: [referenceRow({plannedDeliveryDate: '2026-09-26T14:37:51.482Z'})],
      });

      expect(spareRows(body)[0].planned_delivery_date).toBe(
        '2026-09-26T00:00:00.000Z',
      );
    });

    it('без даты доставки planned_delivery_date = null', () => {
      const body = buildExecutionTaskBody({
        sparePartRows: [referenceRow({plannedDeliveryDate: undefined})],
      });

      expect(spareRows(body)[0].planned_delivery_date).toBeNull();
    });

    it('amount = count * price, __index начинается с 1', () => {
      const body = buildExecutionTaskBody({
        sparePartRows: [
          referenceRow({nameOfSpareParts: 'Фильтр', count: 2, price: 4.46}),
          referenceRow({nameOfSpareParts: 'Смазка', count: 1, price: 12.5, affiliation: 'recovery'}),
        ],
      });

      const rows = spareRows(body);
      const spare = body['used_spare_parts_materials'] as {
        result: {__count: number};
      };

      expect(rows).toHaveLength(2);
      expect(spare.result.__count).toBe(2);

      expect(rows[0].amount).toBe(8.92);
      expect(rows[0].__index).toBe(1);
      expect(rows[0].name_of_spare_parts).toBe('Фильтр');
      expect(rows[0].count).toBe(2);
      expect(rows[0].price).toBe(4.46);

      expect(rows[1].amount).toBe(12.5);
      expect(rows[1].__index).toBe(2);
    });

    it('amount округляется до 2 знаков', () => {
      const body = buildExecutionTaskBody({
        sparePartRows: [referenceRow({nameOfSpareParts: 'Товар', count: 3, price: 1.005})],
      });

      // 3 * 1.005 = 3.015 → round2 = 3.01 (Math.round)
      expect(spareRows(body)[0].amount).toBe(3.01);
    });
  });

  // =========================================================================
  // Файлы: структура соответствует HAR16
  // =========================================================================

  describe('files_to_request', () => {
    it('структура файла соответствует HAR (name, hash, size, file.*)', () => {
      const body = buildExecutionTaskBody({
        files: [
          {
            id: 'd1429663-dc64-47f2-becd-ae7f7f05fd53',
            name: 'photo_2026-09-20_19-44-13.jpg',
            hash: 'd1429663-dc64-47f2-becd-ae7f7f05fd53',
            size: 239151,
          },
        ],
      });

      const files = body['files_to_request'] as Array<{
        id: string;
        name: string;
        hash: string;
        size: number;
        file: {
          __id: string;
          __createdAt: string;
          __updatedAt: string;
          __deletedAt: null;
          __name: string;
          originalName: string;
          __currentUserPermissions: unknown[];
          size: number;
          hash: string;
          version: number;
          __subscribers: unknown[];
        };
      }>;

      expect(files).toHaveLength(1);
      const f = files[0];

      expect(f.id).toBe('d1429663-dc64-47f2-becd-ae7f7f05fd53');
      expect(f.name).toBe('photo_2026-09-20_19-44-13.jpg');
      expect(f.hash).toBe('d1429663-dc64-47f2-becd-ae7f7f05fd53');
      expect(f.size).toBe(239151);

      // Вложенный объект file
      expect(f.file.__id).toBe('d1429663-dc64-47f2-becd-ae7f7f05fd53');
      expect(f.file.__name).toBe('photo_2026-09-20_19-44-13.jpg');
      expect(f.file.originalName).toBe('photo_2026-09-20_19-44-13.jpg');
      expect(f.file.size).toBe(239151);
      expect(f.file.hash).toBe('d1429663-dc64-47f2-becd-ae7f7f05fd53');
      expect(f.file.version).toBe(1);
      expect(f.file.__deletedAt).toBeNull();
      expect(f.file.__currentUserPermissions).toEqual([]);
      expect(f.file.__subscribers).toEqual([]);
    });

    it('если createdAt не передан — используется текущее время', () => {
      const beforeSec = Math.floor(Date.now() / 1000);
      const body = buildExecutionTaskBody({
        files: [
          {
            id: 'file-1',
            name: 'test.jpg',
            hash: 'hash-1',
            size: 100,
          },
        ],
      });
      const afterSec = Math.floor(Date.now() / 1000);

      const files = body['files_to_request'] as Array<{
        file: {__createdAt: string; __updatedAt: string};
      }>;

      // __createdAt может терять миллисекунды (strip в nowIso), поэтому
      // сравниваем по секундам
      const createdAtSec = Math.floor(
        new Date(files[0].file.__createdAt).getTime() / 1000,
      );
      expect(createdAtSec).toBeGreaterThanOrEqual(beforeSec);
      expect(createdAtSec).toBeLessThanOrEqual(afterSec);
      expect(files[0].file.__createdAt).toBe(files[0].file.__updatedAt);
    });

    it('если createdAt передан — используется переданное значение', () => {
      const body = buildExecutionTaskBody({
        files: [
          {
            id: 'file-2',
            name: 'photo.png',
            hash: 'hash-2',
            size: 200,
            createdAt: '2026-09-20T16:44:31Z',
          },
        ],
      });

      const files = body['files_to_request'] as Array<{
        file: {__createdAt: string; __updatedAt: string};
      }>;

      expect(files[0].file.__createdAt).toBe('2026-09-20T16:44:31Z');
      expect(files[0].file.__updatedAt).toBe('2026-09-20T16:44:31Z');
    });

    it('два файла — оба присутствуют в массиве', () => {
      const body = buildExecutionTaskBody({
        files: [
          {id: 'id-1', name: 'a.jpg', hash: 'h-1', size: 100},
          {id: 'id-2', name: 'b.jpg', hash: 'h-2', size: 200},
        ],
      });

      const files = body['files_to_request'] as Array<{id: string}>;
      expect(files).toHaveLength(2);
      expect(files[0].id).toBe('id-1');
      expect(files[1].id).toBe('id-2');
    });
  });

  // =========================================================================
  // В теле НЕТ ключей __action и __exit
  // =========================================================================

  describe('в теле НЕТ __action и __exit', () => {
    it('явная проверка отсутствия __action и __exit', () => {
      const body = buildExecutionTaskBody({
        serialNumber: 'SN-1',
        technicalConclusion: 'Заключение',
        plannedCompletionDate: '2026-09-20T00:00:00.000Z',
        totalCostForExecutor: 44.28,
        totalCostOfRepair: 44.28,
        resultOfWorkIds: ['r1'],
        decisionIds: ['d1'],
        sparePartRows: [referenceRow({nameOfSpareParts: 'ЗЧ'})],
        files: [
          {id: 'f1', name: 'a.jpg', hash: 'h1', size: 100},
        ],
      });

      const keys = Object.keys(body);
      expect(keys).not.toContain('__action');
      expect(keys).not.toContain('__exit');
      expect(keys).not.toContain('__skipSave');
      expect(keys).not.toContain('comment_on_request');
    });

    it('даже если передать __action/__exit в input — они НЕ попадают в тело', () => {
      const input: ExecutionFormInput & Record<string, unknown> = {
        serialNumber: 'SN-1',
        __action: true,
        __exit: 'some-uuid',
      };
      const body = buildExecutionTaskBody(input);

      expect(body['__action']).toBeUndefined();
      expect(body['__exit']).toBeUndefined();
    });
  });

  // =========================================================================
  // utcStartOfDayIso
  // =========================================================================

  describe('utcStartOfDayIso', () => {
    it('обрезает время до начала дня в UTC', () => {
      expect(utcStartOfDayIso(new Date(2026, 8, 26, 15, 42, 13, 481))).toBe(
        '2026-09-26T00:00:00.000Z',
      );
    });

    it('работает для первого дня года', () => {
      expect(utcStartOfDayIso(new Date(2026, 0, 1, 0, 0, 0, 0))).toBe(
        '2026-01-01T00:00:00.000Z',
      );
    });

    it('работает для последнего дня года', () => {
      expect(utcStartOfDayIso(new Date(2026, 11, 31, 23, 59, 59, 999))).toBe(
        '2026-12-31T00:00:00.000Z',
      );
    });

    it('результат можно применить повторно (идемпотентно)', () => {
      const once = utcStartOfDayIso(new Date(2026, 8, 26, 9, 15));
      expect(utcStartOfDayIso(new Date(once))).toBe(once);
    });
  });

  // =========================================================================
  // Полный сценарий из HAR
  // =========================================================================

  describe('полный сценарий из HAR', () => {
    it('собирает все поля по HAR23', () => {
      const body = buildExecutionTaskBody({
        serialNumber: 'SN-TECH',
        technicalConclusion:
          'ТО, чистка фильтров, проверка установки, консультация по уходу',
        plannedCompletionDate: '2026-09-20T00:00:00.000Z',
        totalCostForExecutor: 44.28,
        totalCostOfRepair: 44.28,
        resultOfWorkIds: ['01a0045a-f324-7ca7-b206-6c803e79b7df'],
        decisionIds: ['01a00415-0ac0-73c8-97ae-68a4b57e1582'],
        sparePartRows: [referenceRow()],
        files: [
          {
            id: 'd1429663-dc64-47f2-becd-ae7f7f05fd53',
            name: 'photo_2026-09-20_19-44-13.jpg',
            hash: 'd1429663-dc64-47f2-becd-ae7f7f05fd53',
            size: 239151,
            createdAt: '2026-09-20T16:44:31Z',
          },
          {
            id: 'b16ff00a-d485-4b63-9dd6-44a3d6b35bda',
            name: 'photo_2026-09-20_19-43-58.jpg',
            hash: 'b16ff00a-d485-4b63-9dd6-44a3d6b35bda',
            size: 323624,
            createdAt: '2026-09-20T16:44:32Z',
          },
        ],
      });

      // Проверяем ключевые поля
      expect(body['sn_of_technology']).toBe('SN-TECH');
      expect(body['technical_conclusion']).toContain('ТО, чистка');
      expect(body['planned_completion_date']).toBe('2026-09-20T00:00:00.000Z');
      expect(body['total_cost_for_executor']).toBe(44.28);
      expect(body['total_cost_of_repair_number']).toBe(44.28);
      expect(body['result_of_work']).toEqual([
        '01a0045a-f324-7ca7-b206-6c803e79b7df',
      ]);
      expect(body['decision_of_application']).toEqual([
        '01a00415-0ac0-73c8-97ae-68a4b57e1582',
      ]);

      // Пункта «Комментарий» в форме нет
      expect(body['comment_on_request']).toBeUndefined();

      // Запчасти
      const spare = body['used_spare_parts_materials'] as {
        rows: Array<{amount: number; __index: number; planned_delivery_date: string}>;
        result: {__count: number};
      };
      expect(spare.rows).toHaveLength(1);
      expect(spare.result.__count).toBe(1);
      expect(spare.rows[0].amount).toBe(4.46);
      expect(spare.rows[0].planned_delivery_date).toBe(
        '2026-09-26T00:00:00.000Z',
      );

      // Файлы
      const files = body['files_to_request'] as Array<{id: string; file: {originalName: string}}>;
      expect(files).toHaveLength(2);
      expect(files[0].id).toBe('d1429663-dc64-47f2-becd-ae7f7f05fd53');
      expect(files[0].file.originalName).toBe(
        'photo_2026-09-20_19-44-13.jpg',
      );
      expect(files[1].id).toBe('b16ff00a-d485-4b63-9dd6-44a3d6b35bda');
      expect(files[1].file.originalName).toBe(
        'photo_2026-09-20_19-43-58.jpg',
      );

      // __action / __exit отсутствуют
      expect(body['__action']).toBeUndefined();
      expect(body['__exit']).toBeUndefined();
    });
  });
});
