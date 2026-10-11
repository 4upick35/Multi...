describe('accept template parsing', () => {
  it('извлекает templateId, formCode, formVersion из ответа шаблона (process.items — объект)', () => {
    const mockResponse = {
      __id: '5317b718-42e4-4c3b-8e0b-da819799e8a2',
      code: 'accept_application',
      version: 8,
      process: {
        items: {
          'node-1': {type: 'other', settings: {}},
          'node-2': {
            type: 'start',
            settings: {formCode: 'form_17f238fa-e693-4068-9f2c-a469005a29d4'},
          },
        },
      },
      forms: [
        {
          code: 'form_17f238fa-e693-4068-9f2c-a469005a29d4',
          widget: {version: 2},
        },
      ],
      context: [],
    };

    const templateId = mockResponse.__id;
    const templateVersion = mockResponse.version;

    // Primary: forms[0].code
    let formCode = '';
    if (Array.isArray(mockResponse.forms) && mockResponse.forms.length > 0) {
      formCode = String(mockResponse.forms[0].code || '');
    }

    // Fallback: Object.values(process.items)
    if (!formCode) {
      const processItems = mockResponse.process.items;
      if (processItems && typeof processItems === 'object' && !Array.isArray(processItems)) {
        for (const node of Object.values(processItems)) {
          const n = node as Record<string, unknown>;
          if (n.type === 'start' && n.settings) {
            const settings = n.settings as Record<string, unknown>;
            formCode = String(settings.formCode || '');
            break;
          }
        }
      }
    }

    const formVersion = mockResponse.forms[0].widget.version;

    expect(templateId).toBe('5317b718-42e4-4c3b-8e0b-da819799e8a2');
    expect(templateVersion).toBe(8);
    expect(formCode).toBe('form_17f238fa-e693-4068-9f2c-a469005a29d4');
    expect(formVersion).toBe(2);
  });

  it(' popover.prefix формируется из formCode', () => {
    const formCode = 'form_17f238fa-e693-4068-9f2c-a469005a29d4';
    const prefix = `customer_service.applications.${formCode}/popover`;

    expect(prefix).toBe(
      'customer_service.applications.form_17f238fa-e693-4068-9f2c-a469005a29d4/popover',
    );
  });

  it('body PUT .../run содержит все обязательные ключи', () => {
    const applicationId = '01a0a547-0db6-7030-a66a-314287718d94';
    const formCode = 'form_17f238fa-e693-4068-9f2c-a469005a29d4';
    const prefix = `customer_service.applications.${formCode}/popover`;
    const token = 'test-token';
    const siteKey = 'site-key';
    const secretKey = 'secret-key';
    const debug = 'success: true, message: reCAPTCHA пройдена успешно!';
    const runHash = '5d5978fb-c047-45ae-a395-cedc4fd9f544';

    const body: Record<string, unknown> = {
      is_auto: false,
      __item: {namespace: 'customer_service', code: 'applications', id: applicationId},
      applications: [applicationId],
      debug,
      type_of_event: [],
      __validateResult: {kind: 'BlobObject'},
      [`${prefix}.token`]: token,
      [`${prefix}.result`]: true,
      [`${prefix}.site_key`]: siteKey,
      [`${prefix}.secret_key`]: secretKey,
      [`${prefix}.__readOnly`]: false,
      [`${prefix}.__renderContentAsync`]: false,
      __runHash: runHash,
    };

    expect(body.is_auto).toBe(false);
    expect(body.__item).toEqual({namespace: 'customer_service', code: 'applications', id: applicationId});
    expect(body.applications).toEqual([applicationId]);
    expect(body.__runHash).toBe(runHash);
    expect(body[`${prefix}.token`]).toBe(token);
    expect(body[`${prefix}.result`]).toBe(true);
    expect(body[`${prefix}.site_key`]).toBe(siteKey);
    expect(body[`${prefix}.secret_key`]).toBe(secretKey);
    expect(body[`${prefix}.__readOnly`]).toBe(false);
    expect(body[`${prefix}.__renderContentAsync`]).toBe(false);
    expect(body.__validateResult).toEqual({kind: 'BlobObject'});
  });
});
