import {parseTemplateExits, buildExitFieldValues, EXIT_FIELD_TARGETS, fetchTaskTemplateExits} from '../../src/services/elma-api';
import {taskNodeIdFromPath} from '../../src/domain/TaskService';
import {HttpTransport} from '../../src/infrastructure/HttpTransport';
import type {ElmaAccount} from '../../src/types/account';

jest.mock('../../src/infrastructure/HttpTransport', () => ({
  HttpTransport: jest.fn().mockImplementation(() => ({
    request: jest.fn(),
    clearClient: jest.fn(),
  })),
  LARGE_RESPONSE_TIMEOUT_MS: 30_000,
}));

const mockRequest = (HttpTransport as unknown as jest.Mock).mock.results[0].value
  .request as jest.Mock;

const account = {id: 'acc-template', baseUrl: 'https://elma.example'} as unknown as ElmaAccount;

describe('task-template-exits', () => {
  describe('parseTemplateExits', () => {
    const template = {
      process: {
        items: {
          'bfccc1f7-3994-46fc-8c4f-020eb6f0f434': {
            id: 'bfccc1f7-3994-46fc-8c4f-020eb6f0f434',
            name: 'Связаться с клиентом по заявке',
            type: 'user',
            exits: ['exit-1', 'exit-2']
          }
        },
        transitions: {
          'exit-1': {
            id: 'exit-1',
            name: 'Выезд согласован',
            source: 'bfccc1f7-3994-46fc-8c4f-020eb6f0f434',
            settings: {
              exit: {
                confirm: 'form',
                formFields: [{
                  code: 'time_of_visit',
                  required: true
                }],
                buttonClass: 'primary'
              }
            }
          },
          'exit-2': {
            id: 'exit-2',
            name: 'Отказ клиента',
            source: 'bfccc1f7-3994-46fc-8c4f-020eb6f0f434',
            settings: {
              exit: {
                confirm: 'none',
                formFields: []
              }
            }
          }
        }
      }
    };

    it('должен вернуть правильные выходы для существующего узла', () => {
      const exits = parseTemplateExits(template, 'bfccc1f7-3994-46fc-8c4f-020eb6f0f434');
      expect(exits).toHaveLength(2);
      expect(exits[0].id).toBe('exit-1');
      expect(exits[0].name).toBe('Выезд согласован');
      expect(exits[0].confirm).toBe('form');
      expect(exits[0].formFields).toEqual([{
        code: 'time_of_visit',
        required: true,
        label: 'time_of_visit',
        type: ''
      }]);
      expect(exits[1].id).toBe('exit-2');
      expect(exits[1].name).toBe('Отказ клиента');
      expect(exits[1].formFields).toEqual([]);
    });

    it('без context: подпись = display || code, тип пустой', () => {
      const withDisplay = {
        process: {
          items: {node: {id: 'node', name: 'N', type: 'user', exits: ['e1']}},
          transitions: {
            e1: {
              id: 'e1',
              name: 'Выход',
              source: 'node',
              settings: {
                exit: {
                  formFields: [
                    {code: 'comment', required: false, display: 'Комментарий'},
                    {code: 'unknown', required: false},
                  ],
                },
              },
            },
          },
        },
      };
      const exits = parseTemplateExits(withDisplay, 'node');
      expect(exits[0].formFields).toEqual([
        {code: 'comment', required: false, label: 'Комментарий', type: ''},
        {code: 'unknown', required: false, label: 'unknown', type: ''},
      ]);
    });

    it('должен вернуть пустой массив для несуществующего узла', () => {
      const exits = parseTemplateExits(template, 'нет-такого-узла');
      expect(exits).toEqual([]);
    });

    it('должен вернуть пустой массив для пустых или неполных шаблонов', () => {
      expect(parseTemplateExits({}, 'x')).toEqual([]);
      expect(parseTemplateExits(null, 'x')).toEqual([]);
      expect(parseTemplateExits({process: {}}, 'x')).toEqual([]);
    });
  });

  describe('parseTemplateExits — типы и подписи из template.context', () => {
    const template = {
      context: [
        {
          code: 'reason_of_refuse',
          type: 'SYS_COLLECTION',
          array: true,
          single: true,
          data: {
            code: 'results_of_work',
            namespace: 'customer_service',
            filter: {
              enabled: true,
              value: {tf: {type: {const: ['refusal_of_work']}}},
            },
          },
          view: {name: 'Причина отказа', input: true, output: true},
        },
        {
          code: 'comment_for_refuse',
          type: 'STRING',
          array: false,
          data: {},
          view: {name: 'Комментарий к отказу', data: {additionalType: 'text'}},
        },
        {
          code: 'applications.datetime_of_session',
          type: 'DATETIME',
          array: false,
          data: {},
          view: {name: 'Дата и время визита'},
        },
        {
          code: 'refusal_of_execution_is_impossible',
          type: 'BOOLEAN',
          data: {},
          view: {name: 'Отказ от выполнения невозможен'},
        },
      ],
      process: {
        items: {
          '2df706a0-c078-4a96-82f3-782c1aa9120d': {
            id: '2df706a0-c078-4a96-82f3-782c1aa9120d',
            name: 'Исполнение заявок',
            type: 'user',
            exits: ['b40cd460-f96e-4117-a0e9-343dd7abe482'],
          },
        },
        transitions: {
          'b40cd460-f96e-4117-a0e9-343dd7abe482': {
            id: 'b40cd460-f96e-4117-a0e9-343dd7abe482',
            name: 'Отказ от выполнения',
            source: '2df706a0-c078-4a96-82f3-782c1aa9120d',
            settings: {
              exit: {
                confirm: 'form',
                formFields: [
                  {code: 'reason_of_refuse', required: true, readonly: false},
                  {code: 'comment_for_refuse', required: false, readonly: false},
                  {code: 'datetime_of_session', required: false},
                  {code: 'refusal_of_execution_is_impossible', required: false},
                ],
              },
            },
          },
        },
      },
    };

    it('поле-коллекция: label из context.view.name, type SYS_COLLECTION, collection с фильтром', () => {
      const exits = parseTemplateExits(template, '2df706a0-c078-4a96-82f3-782c1aa9120d');
      expect(exits).toHaveLength(1);

      const collectionField = exits[0].formFields.find(f => f.code === 'reason_of_refuse');
      expect(collectionField).toBeDefined();
      expect(collectionField!.label).toBe('Причина отказа');
      expect(collectionField!.type).toBe('SYS_COLLECTION');
      expect(collectionField!.required).toBe(true);
      expect(collectionField!.collection).toEqual({
        namespace: 'customer_service',
        code: 'results_of_work',
        filter: {tf: {type: {const: ['refusal_of_work']}}},
      });
    });

    it('строковое поле: type STRING и подпись из context.view.name', () => {
      const exits = parseTemplateExits(template, '2df706a0-c078-4a96-82f3-782c1aa9120d');
      const textField = exits[0].formFields.find(f => f.code === 'comment_for_refuse');
      expect(textField).toBeDefined();
      expect(textField!.type).toBe('STRING');
      expect(textField!.label).toBe('Комментарий к отказу');
      expect(textField!.collection).toBeUndefined();
      expect(textField!.required).toBe(false);
    });

    it('code с точками в context ищется по последнему сегменту', () => {
      const exits = parseTemplateExits(template, '2df706a0-c078-4a96-82f3-782c1aa9120d');
      const dateField = exits[0].formFields.find(f => f.code === 'datetime_of_session');
      expect(dateField).toBeDefined();
      expect(dateField!.type).toBe('DATETIME');
      expect(dateField!.label).toBe('Дата и время визита');
    });

    it('логическое поле забирает тип и подпись из context', () => {
      const exits = parseTemplateExits(template, '2df706a0-c078-4a96-82f3-782c1aa9120d');
      const boolField = exits[0].formFields.find(
        f => f.code === 'refusal_of_execution_is_impossible',
      );
      expect(boolField).toBeDefined();
      expect(boolField!.type).toBe('BOOLEAN');
      expect(boolField!.label).toBe('Отказ от выполнения невозможен');
    });
  });

  describe('parseTemplateExits — ENUM и поле «только время»', () => {
    const template = {
      context: [
        {
          code: 'rescheduling_reason',
          type: 'ENUM',
          array: true,
          single: false,
          data: {
            enumItems: [
              {code: 'rescheduling_date_by_performer', name: 'Перенос даты исполнителем'},
              {code: 'postponement_of_date_by_client', name: 'Перенос даты клиентом'},
              {name: 'элемент без кода'},
            ],
          },
          view: {name: 'Причина переноса визита'},
        },
        {
          code: 'time_of_visit',
          type: 'DATETIME',
          array: false,
          data: {},
          view: {name: 'Время визита', data: {additionalType: 'time'}},
        },
        {
          code: 'visits_new_datetime',
          type: 'DATETIME',
          array: false,
          data: {},
          view: {name: 'Новая дата визита', data: {}},
        },
      ],
      process: {
        items: {
          'bfccc1f7-3994-46fc-8c4f-020eb6f0f434': {
            id: 'bfccc1f7-3994-46fc-8c4f-020eb6f0f434',
            name: 'Связаться с клиентом по заявке',
            type: 'user',
            exits: [
              '9f13e2b5-aac4-484f-8dd8-1056f66bcb53',
              '9aad0e33-cb23-4518-af10-352ae7217d89',
            ],
          },
        },
        transitions: {
          '9f13e2b5-aac4-484f-8dd8-1056f66bcb53': {
            id: '9f13e2b5-aac4-484f-8dd8-1056f66bcb53',
            name: 'Изменить дату визита',
            source: 'bfccc1f7-3994-46fc-8c4f-020eb6f0f434',
            settings: {
              exit: {
                confirm: 'form',
                formFields: [
                  {code: 'rescheduling_reason', required: true},
                  {code: 'visits_new_datetime', required: true},
                ],
              },
            },
          },
          '9aad0e33-cb23-4518-af10-352ae7217d89': {
            id: '9aad0e33-cb23-4518-af10-352ae7217d89',
            name: 'Выезд согласован',
            source: 'bfccc1f7-3994-46fc-8c4f-020eb6f0f434',
            settings: {
              exit: {
                confirm: 'form',
                formFields: [{code: 'time_of_visit', required: true}],
              },
            },
          },
        },
      },
    };

    const node = 'bfccc1f7-3994-46fc-8c4f-020eb6f0f434';

    it('поле ENUM: enumItems из data.enumItems — только непустые коды, name с fallback на code', () => {
      const exits = parseTemplateExits(template, node);
      const enumField = exits[0].formFields.find(f => f.code === 'rescheduling_reason');
      expect(enumField).toBeDefined();
      expect(enumField!.type).toBe('ENUM');
      expect(enumField!.enumItems).toEqual([
        {code: 'rescheduling_date_by_performer', name: 'Перенос даты исполнителем'},
        {code: 'postponement_of_date_by_client', name: 'Перенос даты клиентом'},
      ]);
      expect(enumField!.additionalType).toBeUndefined();
    });

    it('DATETIME с view.data.additionalType = time → additionalType «time», у обычной даты его нет', () => {
      const exits = parseTemplateExits(template, node);

      const timeField = exits[1].formFields.find(f => f.code === 'time_of_visit');
      expect(timeField).toBeDefined();
      expect(timeField!.type).toBe('DATETIME');
      expect(timeField!.additionalType).toBe('time');

      const dateField = exits[0].formFields.find(f => f.code === 'visits_new_datetime');
      expect(dateField).toBeDefined();
      expect(dateField!.additionalType).toBeUndefined();
    });
  });

  describe('parseTemplateExits — fallback на обязательные поля узла при пустом formFields выхода', () => {
    const nodeId = 'b6a22833-5588-41a8-ad04-79181de7c147';
    const exitId = 'da74da17-a56f-4cb8-ae67-8fb18bd4e408';

    const template = {
      context: [
        {
          code: 'result',
          type: 'STRING',
          array: false,
          data: {additionalType: 'text'},
          view: {name: 'Результат работ', data: {additionalType: 'text'}},
        },
      ],
      process: {
        items: {
          [nodeId]: {
            id: nodeId,
            name: 'Обработка задачи по обращению',
            type: 'user',
            exits: [exitId],
            settings: {
              formFields: [
                {code: 'appeal_tasks', readonly: true, required: false},
                {code: 'comment', readonly: true, required: false, hideEmpty: true},
                {code: 'result', readonly: false, required: true},
              ],
            },
          },
        },
        transitions: {
          [exitId]: {
            id: exitId,
            name: 'Готово',
            source: nodeId,
            settings: {
              exit: {
                confirm: 'form',
                formFields: [],
              },
            },
          },
        },
      },
    };

    it('пустой formFields у выхода → берём редактируемые обязательные поля узла', () => {
      const exits = parseTemplateExits(template, nodeId);
      expect(exits).toHaveLength(1);
      expect(exits[0].id).toBe(exitId);
      expect(exits[0].formFields).toEqual([
        {
          code: 'result',
          required: true,
          label: 'Результат работ',
          type: 'STRING',
          additionalType: 'text',
        },
      ]);
    });

    it('непустой formFields у выхода → fallback НЕ срабатывает', () => {
      const withExitFields = {
        process: {
          items: {
            node: {
              id: 'node',
              name: 'N',
              type: 'user',
              exits: ['e1'],
              settings: {
                formFields: [
                  {code: 'result', readonly: false, required: true},
                ],
              },
            },
          },
          transitions: {
            e1: {
              id: 'e1',
              name: 'Готово',
              source: 'node',
              settings: {
                exit: {
                  formFields: [{code: 'comment', readonly: false, required: true}],
                },
              },
            },
          },
        },
      };
      const exits = parseTemplateExits(withExitFields, 'node');
      expect(exits[0].formFields).toEqual([
        {code: 'comment', required: true, label: 'comment', type: ''},
      ]);
    });

    it('пустой formFields у выхода и нет обязательных полей узла → пустой список', () => {
      const withoutNodeFields = {
        process: {
          items: {
            node: {id: 'node', name: 'N', type: 'user', exits: ['e1']},
          },
          transitions: {
            e1: {
              id: 'e1',
              name: 'Отказ клиента',
              source: 'node',
              settings: {exit: {formFields: []}},
            },
          },
        },
      };
      const exits = parseTemplateExits(withoutNodeFields, 'node');
      expect(exits[0].formFields).toEqual([]);
    });
  });

  describe('buildExitFieldValues', () => {
    it('должен правильно преобразовать значения полей', () => {
      const fieldValues = buildExitFieldValues([{
        code: 'time_of_visit',
        required: true
      }], {
        time_of_visit: '2026-09-24T16:30:00.000Z'
      });
      expect(fieldValues).toEqual({
        'applications.datetime_of_session': '2026-09-24T16:30:00.000Z'
      });
      expect(EXIT_FIELD_TARGETS.time_of_visit).toBe('applications.datetime_of_session');
    });

    it('должен правильно обрабатывать необязательные поля', () => {
      const fieldValues = buildExitFieldValues([{
        code: 'foo',
        required: false
      }], {
        foo: 'bar'
      });
      expect(fieldValues).toEqual({
        foo: 'bar'
      });
    });

    it('должен игнорировать пустые необязательные поля', () => {
      const fieldValues = buildExitFieldValues([{
        code: 'foo',
        required: false
      }], {
        foo: ''
      });
      expect(fieldValues).toEqual({});
    });
  });

  describe('taskNodeIdFromPath', () => {
    it('должен правильно извлекать ID узла из пути', () => {
      expect(taskNodeIdFromPath('/items/bfccc1f7-3994-46fc-8c4f-020eb6f0f434')).toBe('bfccc1f7-3994-46fc-8c4f-020eb6f0f434');
      expect(taskNodeIdFromPath('/items/')).toBe('');
expect(taskNodeIdFromPath('/items/bfccc1f7-3994-46fc-8c4f-020eb6f0f434')).toBe('bfccc1f7-3994-46fc-8c4f-020eb6f0f434');
      expect(taskNodeIdFromPath('/items/')).toBe('');
      expect(taskNodeIdFromPath('')).toBe('');
    });
  });

  describe('fetchTaskTemplateExits — fail closed', () => {
    beforeEach(() => {
      mockRequest.mockReset();
    });

    it('возвращает null, когда шаблон не загрузился (сеть/таймаут/бан)', async () => {
      mockRequest.mockRejectedValue(new Error('timeout'));

      const result = await fetchTaskTemplateExits(
        account,
        'customer_service:check_object',
        '7f1c0d2e-9a4b-4c31-8d5e-2b6a4f9c1e77',
      );

      expect(result).toBeNull();
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('возвращает [], когда шаблон загружен, но выходов у узла нет', async () => {
      mockRequest.mockResolvedValue({data: {process: {items: {}, transitions: {}}}});

      const result = await fetchTaskTemplateExits(
        account,
        'customer_service:check_object',
        '7f1c0d2e-9a4b-4c31-8d5e-2b6a4f9c1e77',
      );

      expect(result).toEqual([]);
    });
  });
});