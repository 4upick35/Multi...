import {ElmaAccount} from '../../types/account';
import {getFileFormatInfo} from '../../utils/file-format';
import {makeRequest} from './client';

// ---------------------------------------------------------------------------
// Public API: fileGetLink — GET /api/disk/files/{fileId}/getlink
// ---------------------------------------------------------------------------

export async function fileGetLink(
  account: ElmaAccount,
  fileId: string,
  filename?: string,
): Promise<{url: string | null; updatedAccount?: Partial<ElmaAccount>}> {
  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      `/api/disk/files/${fileId}/getlink`,
      undefined,
      filename ? {filename} : undefined,
    );
    const resp = data as {url?: string; link?: string} | undefined;
    return {url: resp?.url || resp?.link || null, updatedAccount};
  } catch {
    return {url: null};
  }
}

// ---------------------------------------------------------------------------
// Public API: загрузка файлов (фото результатов работ)
//
// Порядок шагов подтверждён трафиком HAR16:
//   1. checkFileFormat        — POST /api/disk/files/fileformatcheck
//   2. getFilePutLink         — GET  /api/disk/files/putlink?size=<bytes>
//   3. uploadFileToS3         — PUT  <подписанная ссылка> (бинарное тело)
//   4. fileGetLink            — GET  /api/disk/files/{hash}/getlink?filename=<имя>
// Сам файл к заявке/задаче привязывается позже — массивом в теле сохранения задачи.
// ---------------------------------------------------------------------------

/** Таймаут загрузки файла: фото с телефона по мобильной сети может идти долго. */
const FILE_UPLOAD_TIMEOUT_MS = 60_000;

/**
 * Шаг 1: проверка формата файла. Выполняется ДО запроса ссылки на загрузку.
 */
export async function checkFileFormat(
  account: ElmaAccount,
  formatFile: string,
  first8BytesHex: string,
): Promise<{ok: boolean; updatedAccount?: Partial<ElmaAccount>}> {
  try {
    const {updatedAccount} = await makeRequest(
      account,
      'post',
      '/api/disk/files/fileformatcheck',
      {FormatFile: formatFile, First8Byte: first8BytesHex},
    );
    return {ok: true, updatedAccount};
  } catch {
    return {ok: false};
  }
}

/**
 * Шаг 2: получить подписанную ссылку на загрузку и hash файла.
 * Ссылка живёт 2 часа, авторизация уже внутри неё.
 */
export async function getFilePutLink(
  account: ElmaAccount,
  size: number,
): Promise<{
  hash: string | null;
  link: string | null;
  updatedAccount?: Partial<ElmaAccount>;
}> {
  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      '/api/disk/files/putlink',
      undefined,
      {size: String(size)},
    );
    const resp = data as {hash?: string; link?: string} | undefined;
    return {hash: resp?.hash || null, link: resp?.link || null, updatedAccount};
  } catch {
    return {hash: null, link: null};
  }
}

/**
 * Шаг 3: загрузить бинарные данные по подписанной ссылке.
 *
 * Используем XMLHttpRequest, а не fetch: в React Native именно XHR корректно
 * передаёт бинарное тело (ArrayBuffer / typed array) в нативный сетевой слой.
 * Content-Length не выставляем руками — его подставляет сетевой слой;
 * Content-Type обязателен (сервер S3 проверяет его по подписи).
 */
export function uploadFileToS3(
  link: string,
  bytes: ArrayBuffer | Uint8Array,
  mimeType: string,
): Promise<{ok: boolean; status: number; error?: string}> {
  return new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', link);
      xhr.setRequestHeader('Content-Type', mimeType);
      xhr.timeout = FILE_UPLOAD_TIMEOUT_MS;
      xhr.onload = () => {
        resolve({ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status});
      };
      xhr.onerror = () => {
        resolve({ok: false, status: xhr.status || 0, error: 'network'});
      };
      xhr.ontimeout = () => {
        resolve({ok: false, status: 0, error: 'timeout'});
      };
      xhr.send(bytes as unknown as Parameters<XMLHttpRequest['send']>[0]);
    } catch (e: unknown) {
      resolve({ok: false, status: 0, error: e instanceof Error ? e.message : String(e)});
    }
  });
}

// ---------------------------------------------------------------------------
// Public API: uploadPhotoAndGetHash — полный цикл загрузки одного фото
// ---------------------------------------------------------------------------

export async function uploadPhotoAndGetHash(
  account: ElmaAccount,
  filename: string,
  bytes: ArrayBuffer | Uint8Array,
  mimeType: string,
): Promise<{ok: boolean; hash?: string; error?: string}> {
  const {formatFile, first8BytesHex} = getFileFormatInfo(filename, bytes);

  const checkResult = await checkFileFormat(account, formatFile, first8BytesHex);
  if (!checkResult.ok) {
    return {ok: false, error: 'checkFileFormat failed'};
  }

  const size = bytes.byteLength;
  const linkResult = await getFilePutLink(account, size);
  if (!linkResult.hash || !linkResult.link) {
    return {ok: false, error: 'getFilePutLink failed'};
  }

  const uploadResult = await uploadFileToS3(linkResult.link, bytes, mimeType);
  if (!uploadResult.ok) {
    return {ok: false, error: uploadResult.error || 'uploadFileToS3 failed'};
  }

  return {ok: true, hash: linkResult.hash};
}

// ---------------------------------------------------------------------------
// Public API: fileDownloadLink — GET /api/worker/file/link
// ---------------------------------------------------------------------------

export async function fileDownloadLink(
  account: ElmaAccount,
  hash: string,
): Promise<{url: string | null; updatedAccount?: Partial<ElmaAccount>}> {
  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      '/api/worker/file/link',
      undefined,
      {hash},
    );
    const resp = data as {url?: string; link?: string} | undefined;
    return {url: resp?.url || resp?.link || null, updatedAccount};
  } catch {
    return {url: null};
  }
}
