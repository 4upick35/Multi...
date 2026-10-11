/**
 * Тесты слоя загрузки файла в ELMA.
 * Порядок шагов и параметры подтверждены трафиком HAR16:
 *   fileformatcheck → putlink?size=… → PUT в S3 → getlink?filename=…
 */

jest.mock('../../src/infrastructure/HttpTransport', () => ({
  HttpTransport: jest.fn().mockImplementation(() => ({
    request: jest.fn(),
    clearClient: jest.fn(),
  })),
}));

import {HttpTransport} from '../../src/infrastructure/HttpTransport';
import {
  checkFileFormat,
  getFilePutLink,
  uploadFileToS3,
  fileGetLink,
} from '../../src/services/elma-api';
import type {ElmaAccount} from '../../src/types/account';

// elma-api создаёт транспорт один раз при импорте — берём именно его экземпляр.
const mockRequest = (HttpTransport as unknown as jest.Mock).mock.results[0].value
  .request as jest.Mock;

const account = {id: 'acc-1', baseUrl: 'https://elma.example'} as unknown as ElmaAccount;

/** Простейшая подмена XMLHttpRequest: фиксируем запрос и вручную завершаем его. */
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

describe('проверка формата файла', () => {
  it('отправляет расширение и первые 8 байт на fileformatcheck', async () => {
    mockRequest.mockResolvedValue({data: null});

    const result = await checkFileFormat(account, 'jpg', 'ffd8ffe000104a46');

    expect(result.ok).toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(1);
    const [, method, url, data] = mockRequest.mock.calls[0];
    expect(method).toBe('post');
    expect(url).toBe('/api/disk/files/fileformatcheck');
    expect(data).toEqual({FormatFile: 'jpg', First8Byte: 'ffd8ffe000104a46'});
  });

  it('возвращает ok=false при ошибке сети, не бросая исключение', async () => {
    mockRequest.mockRejectedValue(new Error('network'));

    await expect(checkFileFormat(account, 'jpg', 'ffd8ffe000104a46')).resolves.toEqual({
      ok: false,
    });
  });
});

describe('получение ссылки на загрузку', () => {
  it('передаёт точный размер файла в query и возвращает hash и ссылку', async () => {
    mockRequest.mockResolvedValue({
      data: {hash: 'd1429663-dc64-47f2-becd-ae7f7f05fd53', link: 'https://s3/put'},
    });

    const result = await getFilePutLink(account, 239151);

    expect(result.hash).toBe('d1429663-dc64-47f2-becd-ae7f7f05fd53');
    expect(result.link).toBe('https://s3/put');
    const [, method, url, data, params] = mockRequest.mock.calls[0];
    expect(method).toBe('get');
    expect(url).toBe('/api/disk/files/putlink');
    expect(data).toBeUndefined();
    expect(params).toEqual({size: '239151'});
  });

  it('возвращает пустые значения при ошибке, не бросая исключение', async () => {
    mockRequest.mockRejectedValue(new Error('network'));

    await expect(getFilePutLink(account, 10)).resolves.toMatchObject({
      hash: null,
      link: null,
    });
  });
});

describe('порядок шагов загрузки', () => {
  it('проверка формата идёт ДО запроса ссылки на загрузку', async () => {
    mockRequest
      .mockResolvedValueOnce({data: null})
      .mockResolvedValueOnce({data: {hash: 'h1', link: 'https://s3/put'}});

    await checkFileFormat(account, 'jpg', 'ffd8ffe000104a46');
    await getFilePutLink(account, 239151);

    expect(mockRequest.mock.calls[0][2]).toBe('/api/disk/files/fileformatcheck');
    expect(mockRequest.mock.calls[1][2]).toBe('/api/disk/files/putlink');
  });
});

describe('загрузка бинарных данных в S3', () => {
  const link = 'https://elma.example/s3elma365-prod/d1429663?X-Amz-Signature=abc';
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

  it('делает PUT на подписанную ссылку с нужным Content-Type', async () => {
    const promise = uploadFileToS3(link, bytes, 'image/jpeg');

    expect(MockXhr.instances).toHaveLength(1);
    const xhr = MockXhr.instances[0];
    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe(link);
    expect(xhr.headers['Content-Type']).toBe('image/jpeg');
    expect(xhr.body).toBe(bytes);

    xhr.finish(200);
    await expect(promise).resolves.toEqual({ok: true, status: 200});
  });

  it('сообщает об ошибке, если сеть отвалилась', async () => {
    const promise = uploadFileToS3(link, bytes, 'image/jpeg');
    MockXhr.instances[0].failWithError();

    await expect(promise).resolves.toMatchObject({ok: false, error: 'network'});
  });

  it('считает ошибкой не-2xx ответ', async () => {
    const promise = uploadFileToS3(link, bytes, 'image/jpeg');
    MockXhr.instances[0].finish(403);

    await expect(promise).resolves.toEqual({ok: false, status: 403});
  });
});

describe('ссылка на скачивание файла', () => {
  it('передаёт имя файла в query, если оно передано', async () => {
    mockRequest.mockResolvedValue({data: {link: 'https://s3/get'}});

    const result = await fileGetLink(account, 'hash-1', 'photo.jpg');

    expect(result.url).toBe('https://s3/get');
    const [, method, url, , params] = mockRequest.mock.calls[0];
    expect(method).toBe('get');
    expect(url).toBe('/api/disk/files/hash-1/getlink');
    expect(params).toEqual({filename: 'photo.jpg'});
  });

  it('работает без имени файла (обратная совместимость)', async () => {
    mockRequest.mockResolvedValue({data: {link: 'https://s3/get'}});

    await fileGetLink(account, 'hash-1');

    expect(mockRequest.mock.calls[0][4]).toBeUndefined();
  });
});
