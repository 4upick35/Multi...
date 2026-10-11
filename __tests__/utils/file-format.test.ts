import {getFileExtension, getFileFormatInfo, readBlobBytes} from '../../src/utils/file-format';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('getFileExtension', () => {
  it('возвращает расширение в нижнем регистре', () => {
    expect(getFileExtension('photo_2026-09-20_19-44-13.JPG')).toBe('jpg');
  });

  it('берёт последнюю точку в имени', () => {
    expect(getFileExtension('archive.tar.gz')).toBe('gz');
  });

  it('возвращает пустую строку, если расширения нет', () => {
    expect(getFileExtension('photo')).toBe('');
  });

  it('возвращает пустую строку для имени, оканчивающегося точкой', () => {
    expect(getFileExtension('photo.')).toBe('');
  });
});

describe('getFileFormatInfo', () => {
  it('отдаёт hex первых 8 байт JPEG (как в трафике ELMA)', () => {
    const info = getFileFormatInfo('photo_2026-09-20_19-44-13.jpg', JPEG);
    expect(info.formatFile).toBe('jpg');
    expect(info.first8BytesHex).toBe('ffd8ffe000104a46');
  });

  it('корректно определяет PNG', () => {
    const info = getFileFormatInfo('image.png', PNG);
    expect(info.formatFile).toBe('png');
    expect(info.first8BytesHex).toBe('89504e470d0a1a0a');
  });

  it('добивает байты нулём слева (однобайтовые значения < 0x10)', () => {
    const info = getFileFormatInfo('tiny.bin', new Uint8Array([0x01, 0x02, 0x03]));
    expect(info.first8BytesHex).toBe('010203');
  });

  it('не падает, если байтов меньше восьми', () => {
    const info = getFileFormatInfo('few.png', new Uint8Array([0x89, 0x50]));
    expect(info.first8BytesHex).toBe('8950');
  });

  it('принимает ArrayBuffer, а не только Uint8Array', () => {
    const info = getFileFormatInfo('photo.jpg', JPEG.buffer as ArrayBuffer);
    expect(info.first8BytesHex).toBe('ffd8ffe000104a46');
  });
});

describe('readBlobBytes', () => {
  /** Заглушка FileReader: RN-реализация readAsArrayBuffer отдаёт ArrayBuffer. */
  class FakeFileReader {
    static mode: 'arraybuffer' | 'other' | 'error' = 'arraybuffer';
    result: unknown = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;

    readAsArrayBuffer(): void {
      if (FakeFileReader.mode === 'error') {
        this.onerror?.();
        return;
      }
      this.result = FakeFileReader.mode === 'arraybuffer' ? new ArrayBuffer(4) : 'text';
      this.onload?.();
    }
  }

  const blob = {} as Blob;

  beforeEach(() => {
    FakeFileReader.mode = 'arraybuffer';
    (global as unknown as {FileReader: unknown}).FileReader = FakeFileReader;
  });

  it('читает Blob через FileReader и отдаёт ArrayBuffer', async () => {
    const bytes = await readBlobBytes(blob);
    expect(bytes).toBeInstanceOf(ArrayBuffer);
    expect(bytes.byteLength).toBe(4);
  });

  it('отклоняет промис, если FileReader вернул не ArrayBuffer', async () => {
    FakeFileReader.mode = 'other';
    await expect(readBlobBytes(blob)).rejects.toThrow('Не удалось прочитать файл');
  });

  it('отклоняет промис при ошибке чтения', async () => {
    FakeFileReader.mode = 'error';
    await expect(readBlobBytes(blob)).rejects.toThrow('Не удалось прочитать файл');
  });
});
