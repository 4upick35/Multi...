/**
 * Определение формата файла для загрузки в ELMA.
 *
 * Сервер перед выдачей ссылки на загрузку требует два значения:
 * расширение файла и первые 8 байт содержимого в hex (подтверждено трафиком HAR16:
 * тело запроса `POST /api/disk/files/fileformatcheck` = `{"FormatFile":"jpg","First8Byte":"ffd8ffe000104a46"}`).
 */

export interface FileFormatInfo {
  /** Расширение без точки, в нижнем регистре (например `jpg`). */
  formatFile: string;
  /** Первые 8 байт в hex, в нижнем регистре (например `ffd8ffe000104a46`). */
  first8BytesHex: string;
}

/** Сколько байт требуется серверу для проверки формата. */
const FORMAT_PROBE_BYTES = 8;

/** Извлечь расширение из имени файла (без точки, в нижнем регистре). */
export function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) {
    return '';
  }
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * Собрать данные для проверки формата: расширение из имени и первые 8 байт в hex.
 * Работает с уже прочитанными байтами (файловая система здесь не затрагивается).
 * Если байтов меньше 8 — вернёт то, что есть, без ошибки.
 */
export function getFileFormatInfo(
  filename: string,
  bytes: ArrayBuffer | Uint8Array,
): FileFormatInfo {
  const formatFile = getFileExtension(filename);
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const take = Math.min(FORMAT_PROBE_BYTES, view.length);

  let first8BytesHex = '';
  for (let i = 0; i < take; i++) {
    first8BytesHex += view[i].toString(16).padStart(2, '0');
  }

  return {formatFile, first8BytesHex};
}

/**
 * Прочитать Blob в ArrayBuffer.
 *
 * В React Native у Blob НЕТ метода `arrayBuffer()` (в отличие от браузера),
 * поэтому читаем через FileReader — RN реализует `readAsArrayBuffer` нативно.
 */
export function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) {
        resolve(result);
      } else {
        reject(new Error('Не удалось прочитать файл'));
      }
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.onabort = () => reject(new Error('Чтение файла прервано'));
    reader.readAsArrayBuffer(blob);
  });
}
