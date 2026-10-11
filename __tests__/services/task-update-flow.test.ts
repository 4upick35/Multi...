/**
 * Тесты updateTaskInstance и uploadPhotoAndGetHash.
 *
 * updateTaskInstance — PUT /api/bpm/tasks/{uuid}:
 *   - короткая форма ключа (как есть) + длинная форма с UUID из EXECUTION_FIELD_IDS;
 *   - __action / __exit никогда не добавляются;
 *   - instanceId прокидывается в тело верхнего уровня.
 *
 * uploadPhotoAndGetHash — полный цикл загрузки фото:
 *   getFileFormatInfo → checkFileFormat → getFilePutLink(size) → PUT S3.
 */

jest.mock('../../src/infrastructure/HttpTransport', () => ({
  HttpTransport: jest.fn().mockImplementation(() => ({
    request: jest.fn(),
    clearClient: jest.fn(),
  })),
}));

import {HttpTransport} from '../../src/infrastructure/HttpTransport';
import {
  updateTaskInstance,
  uploadPhotoAndGetHash,
  EXECUTION_FIELD_IDS,
} from '../../src/services/elma-api';
import type {ElmaAccount} from '../../src/types/account';

// Экземпляр транспорта, созданный при импорте elma-api.
const mockRequest = (HttpTransport as unknown as jest.Mock).mock.results[0].value
  .request as jest.Mock;

const account = {id: 'acc-1', baseUrl: 'https://elma.example'} as unknown as ElmaAccount;

// ---------------------------------------------------------------------------
// Подмена XMLHttpRequest для uploadFileToS3
// ---------------------------------------------------------------------------

class MockXhr {
  static instances: MockXhr[] = [];
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown = null;
  timeout = 0;
  status = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  send(body: unknown): void {
    this.body = body;
    MockXhr.instances.push(this);
  }

  finish(status: number): void {
    this.status = status;
    this.onload?.();
  }

  failWithError(): void {
    this.onerror?.();
  }
}

beforeEach(() => {
  mockRequest.mockReset();
  MockXhr.instances = [];
  (global as unknown as {XMLHttpRequest: unknown}).XMLHttpRequest = MockXhr;
});

// ===========================================================================
// updateTaskInstance
// ===========================================================================

describe('updateTaskInstance', () => {
  const taskUuid = 'aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee';

  it('отправляет PUT на /api/bpm/tasks/{uuid}', async () => {
    mockRequest.mockResolvedValue({data: {id: taskUuid}});

    const result = await updateTaskInstance(account, taskUuid, {sn_of_technology: 'SN-123'});

    expect(result.ok).toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(1);
    const [, method, url] = mockRequest.mock.calls[0];
    expect(method).toBe('put');
    expect(url).toBe(`/api/bpm/tasks/${taskUuid}`);
  });

  it('для sn_of_technology создаёт короткий И длинный ключ', async () => {
    mockRequest.mockResolvedValue({data: {}});

    await updateTaskInstance(account, taskUuid, {sn_of_technology: 'SN-456'});

    const body = mockRequest.mock.calls[0][3] as Record<string, unknown>;
    const data = body.data as Record<string, unknown>;

    // Короткая форма
    expect(data['sn_of_technology']).toBe('SN-456');

    // Длинная форма с UUID из таблицы
    const expectedUuid = EXECUTION_FIELD_IDS['sn_of_technology'];
    const expectedLongKey =
      `customer_service.applications._process_execution_of_field_applications.${expectedUuid}.sn_of_technology`;
    expect(data[expectedLongKey]).toBe('SN-456');
  });

  it('значение совпадает в короткой и длинной формах', async () => {
    mockRequest.mockResolvedValue({data: {}});

    await updateTaskInstance(account, taskUuid, {sn_of_technology: 'VALUE-789'});

    const data = mockRequest.mock.calls[0][3].data as Record<string, unknown>;
    const shortVal = data['sn_of_technology'];
    const longKey = `customer_service.applications._process_execution_of_field_applications.${EXECUTION_FIELD_IDS['sn_of_technology']}.sn_of_technology`;
    const longVal = data[longKey];

    expect(shortVal).toBe(longVal);
  });

  it('в теле ОТСУТСТВУЕТ ключ, содержащий uuid задачи как сегмент', async () => {
    mockRequest.mockResolvedValue({data: {}});

    await updateTaskInstance(account, taskUuid, {sn_of_technology: 'X'});

    const data = mockRequest.mock.calls[0][3].data as Record<string, unknown>;
    const keys = Object.keys(data);

    // Ни один ключ не должен содержать taskUuid
    const badKey = keys.find((k) => k.includes(taskUuid));
    expect(badKey).toBeUndefined();
  });

  it('в теле ОТСУТСТВУЮТ ключи __exit и __action', async () => {
    mockRequest.mockResolvedValue({data: {}});

    await updateTaskInstance(account, taskUuid, {
      sn_of_technology: 'X',
      __action: 'complete',
      __exit: true,
    });

    const data = mockRequest.mock.calls[0][3].data as Record<string, unknown>;
    expect(data['__action']).toBeUndefined();
    expect(data['__exit']).toBeUndefined();
  });

  it('files_to_request прокидывается в обе формы', async () => {
    mockRequest.mockResolvedValue({data: {}});

    await updateTaskInstance(account, taskUuid, {files_to_request: ['file1.jpg']});

    const data = mockRequest.mock.calls[0][3].data as Record<string, unknown>;
    const expectedUuid = EXECUTION_FIELD_IDS['files_to_request'];
    const expectedLongKey =
      `customer_service.applications._process_execution_of_field_applications.${expectedUuid}.files_to_request`;

    expect(data['files_to_request']).toEqual(['file1.jpg']);
    expect(data[expectedLongKey]).toEqual(['file1.jpg']);
  });

  it('неизвестный field_code даёт только короткую форму', async () => {
    mockRequest.mockResolvedValue({data: {}});

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await updateTaskInstance(account, taskUuid, {unknown_field: 'val'});

    const data = mockRequest.mock.calls[0][3].data as Record<string, unknown>;
    expect(data['unknown_field']).toBe('val');

    // Длинной формы быть не должно
    const longKeys = Object.keys(data).filter((k) => k.startsWith('customer_service.'));
    expect(longKeys).toHaveLength(0);

    // Должно быть предупреждение в консоль
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown_field'),
    );

    consoleSpy.mockRestore();
  });

  it('instanceId прокидывается в тело верхнего уровня', async () => {
    mockRequest.mockResolvedValue({data: {}});

    const iid = 'inst-123';
    await updateTaskInstance(account, taskUuid, {
      instanceId: iid,
      sn_of_technology: 'SN',
    });

    const requestBody = mockRequest.mock.calls[0][3] as Record<string, unknown>;
    expect(requestBody.instanceId).toBe(iid);

    // instanceId не попадает в data
    const data = requestBody.data as Record<string, unknown>;
    expect(data['instanceId']).toBeUndefined();
  });

  it('ошибка транспорта возвращает {ok:false} без проброса исключения', async () => {
    mockRequest.mockRejectedValue(new Error('network timeout'));

    const result = await updateTaskInstance(account, taskUuid, {sn_of_technology: 'X'});

    expect(result.ok).toBe(false);
    expect(result.error).toContain('network timeout');
  });

  it('несколько полей — все короткие и длинные ключи на месте', async () => {
    mockRequest.mockResolvedValue({data: {}});

    await updateTaskInstance(account, taskUuid, {
      sn_of_technology: 'SN-1',
      comment_on_request: 'text',
      type_of_work: 1,
    });

    const data = mockRequest.mock.calls[0][3].data as Record<string, unknown>;

    // sn_of_technology
    expect(data['sn_of_technology']).toBe('SN-1');
    expect(data[
      `customer_service.applications._process_execution_of_field_applications.${EXECUTION_FIELD_IDS['sn_of_technology']}.sn_of_technology`
    ]).toBe('SN-1');

    // comment_on_request
    expect(data['comment_on_request']).toBe('text');
    expect(data[
      `customer_service.applications._process_execution_of_field_applications.${EXECUTION_FIELD_IDS['comment_on_request']}.comment_on_request`
    ]).toBe('text');

    // type_of_work
    expect(data['type_of_work']).toBe(1);
    expect(data[
      `customer_service.applications._process_execution_of_field_applications.${EXECUTION_FIELD_IDS['type_of_work']}.type_of_work`
    ]).toBe(1);
  });
});

// ===========================================================================
// uploadPhotoAndGetHash
// ===========================================================================

describe('uploadPhotoAndGetHash', () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

  /** Прогоняем микротаски, чтобы mockRequest промисы разрешились и XHR создался. */
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  it('порядок: fileformatcheck → putlink → PUT S3, точный size', async () => {
    mockRequest.mockResolvedValueOnce({data: null});
    mockRequest.mockResolvedValueOnce({
      data: {hash: 'h-abc', link: 'https://s3/put'},
    });

    const promise = uploadPhotoAndGetHash(account, 'photo.jpg', bytes, 'image/jpeg');

    // Даём промисам mockRequest разрешиться и дойти до XHR
    await flush();
    await flush();

    expect(MockXhr.instances).toHaveLength(1);
    const xhr = MockXhr.instances[0];
    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe('https://s3/put');
    expect(xhr.headers['Content-Type']).toBe('image/jpeg');

    xhr.finish(200);
    const result = await promise;

    expect(result.ok).toBe(true);
    expect(result.hash).toBe('h-abc');

    // Порядок вызовов
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockRequest.mock.calls[0][2]).toBe('/api/disk/files/fileformatcheck');
    expect(mockRequest.mock.calls[1][2]).toBe('/api/disk/files/putlink');

    // putlink получает точный размер
    const putlinkParams = mockRequest.mock.calls[1][4];
    expect(putlinkParams).toEqual({size: String(bytes.byteLength)});
  });

  it('при ошибке checkFileFormat — putlink НЕ вызывается', async () => {
    // checkFileFormat ловит исключения и возвращает {ok:false}
    mockRequest.mockRejectedValueOnce(new Error('format denied'));

    const result = await uploadPhotoAndGetHash(account, 'photo.jpg', bytes, 'image/jpeg');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('checkFileFormat failed');

    // putlink НЕ вызывался — только 1 запрос
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('ошибка загрузки в S3 → {ok:false}', async () => {
    mockRequest.mockResolvedValueOnce({data: null});
    mockRequest.mockResolvedValueOnce({
      data: {hash: 'h-xyz', link: 'https://s3/put'},
    });

    const promise = uploadPhotoAndGetHash(account, 'photo.jpg', bytes, 'image/jpeg');

    await flush();
    await flush();

    expect(MockXhr.instances).toHaveLength(1);
    MockXhr.instances[0].finish(500);
    const result = await promise;

    expect(result.ok).toBe(false);
  });

  it('сеть отвалилась на uploadFileToS3 → {ok:false} без исключения', async () => {
    mockRequest.mockResolvedValueOnce({data: null});
    mockRequest.mockResolvedValueOnce({
      data: {hash: 'h-net', link: 'https://s3/put'},
    });

    const promise = uploadPhotoAndGetHash(account, 'photo.jpg', bytes, 'image/jpeg');

    await flush();
    await flush();

    expect(MockXhr.instances).toHaveLength(1);
    MockXhr.instances[0].failWithError();
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ===========================================================================
// EXECUTION_FIELD_IDS
// ===========================================================================

describe('EXECUTION_FIELD_IDS', () => {
  it('содержит все ожидаемые ключи (44 записи)', () => {
    const keys = Object.keys(EXECUTION_FIELD_IDS);
    expect(keys.length).toBe(44);
  });

  it('sn_of_technology указывает на cb443c40-51fb-44dd-b2c0-e79321e9dfdd', () => {
    expect(EXECUTION_FIELD_IDS['sn_of_technology']).toBe(
      'cb443c40-51fb-44dd-b2c0-e79321e9dfdd',
    );
  });

  it('files_to_request указывает на bc9d8d34-1455-4fab-9555-a401aab16f85', () => {
    expect(EXECUTION_FIELD_IDS['files_to_request']).toBe(
      'bc9d8d34-1455-4fab-9555-a401aab16f85',
    );
  });
});
