import {parseBpmTemplate, buildScheduleVisitBody, parseMasterIdsFromFilter} from '../../src/services/elma-api';

describe('parseBpmTemplate', () => {
  const mockTemplateRaw = {
    __id: 'b26cab93-e4ff-432f-b577-7d8a2ca02e0c',
    version: 6,
    forms: [
      {
        code: 'form_f0fd9dd9-0ef3-49c6-a338-ef8cef013516',
        widget: {version: 5},
      },
    ],
    context: [
      {code: 'visit_date', type: 'DATETIME', array: false, single: true},
      {code: 'master', type: 'SYS_USER', array: true, single: false},
    ],
  };

  it('извлекает templateId, templateVersion, formCode, formVersion, contextFields', () => {
    const result = parseBpmTemplate(mockTemplateRaw);
    expect(result).not.toBeNull();
    expect(result!.templateId).toBe('b26cab93-e4ff-432f-b577-7d8a2ca02e0c');
    expect(result!.templateVersion).toBe(6);
    expect(result!.formCode).toBe('form_f0fd9dd9-0ef3-49c6-a338-ef8cef013516');
    expect(result!.formVersion).toBe(5);
    expect(result!.contextFields).toHaveLength(2);
  });

  it('возвращает null при отсутствии __id', () => {
    const raw = {version: 6, forms: [{code: 'form_1', widget: {version: 1}}]};
    expect(parseBpmTemplate(raw)).toBeNull();
  });

  it('возвращает null при отсутствии formCode', () => {
    const raw = {__id: 'abc', version: 6, forms: [], context: []};
    expect(parseBpmTemplate(raw)).toBeNull();
  });

  it('извлекает formCode из process.items fallback', () => {
    const raw = {
      __id: 'abc',
      version: 3,
      forms: [
        {code: 'form_from_process', widget: {version: 4}},
      ],
      process: {
        items: {
          'node-1': {type: 'other', settings: {}},
          'node-2': {type: 'start', settings: {formCode: 'form_from_process'}},
        },
      },
      context: [],
    };
    const result = parseBpmTemplate(raw);
    expect(result).not.toBeNull();
    expect(result!.formCode).toBe('form_from_process');
  });

  it('возвращает пустой contextFields если context отсутствует', () => {
    const raw = {__id: 'abc', version: 3, forms: [{code: 'f1', widget: {version: 1}}]};
    const result = parseBpmTemplate(raw);
    expect(result).not.toBeNull();
    expect(result!.contextFields).toEqual([]);
  });
});

describe('buildScheduleVisitBody', () => {
  const baseParams = {
    applicationId: '01a0a547-0db6-7030-a66a-314287718d94',
    visitDateIso: '2026-09-21T17:30:00.000Z',
    masterId: '01a04842-a3b2-7147-af4f-91a551332b56',
    templateId: 'b26cab93-e4ff-432f-b577-7d8a2ca02e0c',
    templateVersion: 6,
    formCode: 'form_f0fd9dd9-0ef3-49c6-a338-ef8cef013516',
  };

  it('содержает обязательные ключи', () => {
    const body = buildScheduleVisitBody(baseParams);
    expect(body.__item).toEqual({namespace: 'customer_service', code: 'applications', id: baseParams.applicationId});
    expect(body.applications).toEqual([baseParams.applicationId]);
    expect(body.visit_date).toBe('2026-09-21T17:30:00.000Z');
    expect(body.master).toEqual(['01a04842-a3b2-7147-af4f-91a551332b56']);
    expect(body.__validateResult).toEqual({kind: 'BlobObject'});
    expect(body.type_of_event).toEqual([]);
    expect(typeof body.__runHash).toBe('string');
    expect((body.__runHash as string)).toHaveLength(36);
  });

  it('содержит popover ключи для form_f0fd9dd9-... v5', () => {
    const body = buildScheduleVisitBody(baseParams);
    expect(body['customer_service.applications.form_f0fd9dd9-0ef3-49c6-a338-ef8cef013516/popover.__readOnly']).toBe(false);
    expect(body['customer_service.applications.form_f0fd9dd9-0ef3-49c6-a338-ef8cef013516/popover.__renderContentAsync']).toBe(false);
  });

  it('содержит два UUID-ключа полей формы для form_f0fd9dd9-... v5', () => {
    const body = buildScheduleVisitBody(baseParams);
    const ns = 'customer_service.applications';
    const key1 = `${ns}._process_date_and_wizard_approval.c988f01a-30b0-4b1a-981d-fa9bc6aa5a5c.visit_date`;
    const key2 = `${ns}._process_date_and_wizard_approval.81578d3e-4201-4cfb-9827-68040eb238bc.master`;
    expect(body[key1]).toBe('2026-09-21T17:30:00.000Z');
    expect(body[key2]).toEqual(['01a04842-a3b2-7147-af4f-91a551332b56']);
  });

  it('НЕ содержит UUID-ключи для другого formCode', () => {
    const params = {...baseParams, formCode: 'form_other'};
    const body = buildScheduleVisitBody(params);
    const ns = 'customer_service.applications';
    const key1 = `${ns}._process_date_and_wizard_approval.c988f01a-30b0-4b1a-981d-fa9bc6aa5a5c.visit_date`;
    const key2 = `${ns}._process_date_and_wizard_approval.81578d3e-4201-4cfb-9827-68040eb238bc.master`;
    expect(body[key1]).toBeUndefined();
    expect(body[key2]).toBeUndefined();
  });
});

describe('parseMasterIdsFromFilter', () => {
  it('извлекает id из простого фильтра with in операцией', () => {
    const filter = {
      and: [
        {eq: [{field: '__deletedAt'}, null]},
        {eq: [{field: '__user_status'}, {const: {code: 'active', name: 'Активен', checked: false}}]},
        {in: [{field: '__id'}, {list: ['01a04842-a3b2-7147-af4f-91a551332b56', '01a0a009-565a-7555-a51e-66a862e6e81c']}]},
      ],
    };
    const ids = parseMasterIdsFromFilter(filter);
    expect(ids).toEqual(['01a04842-a3b2-7147-af4f-91a551332b56', '01a0a009-565a-7555-a51e-66a862e6e81c']);
  });

  it('возвращает пустой массив при отсутствии in операции', () => {
    const filter = {and: [{eq: [{field: '__deletedAt'}, null]}]};
    expect(parseMasterIdsFromFilter(filter)).toEqual([]);
  });

  it('возвращает пустой массив для null/undefined', () => {
    expect(parseMasterIdsFromFilter(null)).toEqual([]);
    expect(parseMasterIdsFromFilter(undefined)).toEqual([]);
  });

  it('находит в операцию во вложенной структуре', () => {
    const filter = {
      and: [
        {or: [
          {eq: [{field: '__deletedAt'}, null]},
          {in: [{field: '__id'}, {list: ['id-1']}]},
        ]},
      ],
    };
    expect(parseMasterIdsFromFilter(filter)).toEqual(['id-1']);
  });
});
