import {isNewApplicationMessage, extractApplicationNumber} from '../../src/utils/feed-helpers';

describe('isNewApplicationMessage', () => {
  it('возвращает true для текста с «Появилась новая заявка»', () => {
    expect(isNewApplicationMessage('Появилась новая заявка 3303')).toBe(true);
  });

  it('регистронезависимо', () => {
    expect(isNewApplicationMessage('появилась новая заявка 3303')).toBe(true);
    expect(isNewApplicationMessage('ПОЯВИЛАСЬ НОВАЯ ЗАЯВКА 3303')).toBe(true);
    expect(isNewApplicationMessage('Появилась Новая Заявка 3303')).toBe(true);
  });

  it('возвращает false для других сообщений', () => {
    expect(isNewApplicationMessage('Заявка 3303 обновлена')).toBe(false);
    expect(isNewApplicationMessage('Новая заявка создана')).toBe(false);
    expect(isNewApplicationMessage('')).toBe(false);
  });

  it('рабатывает с HTML-сущностями в тексте', () => {
    expect(isNewApplicationMessage('Появилась новая заявка&nbsp;3303')).toBe(true);
  });
});

describe('extractApplicationNumber', () => {
  it('извлекает номер заявки из текста', () => {
    expect(extractApplicationNumber('Появилась новая заявка 3303')).toBe('3303');
  });

  it('извлекает 4-значный номер', () => {
    expect(extractApplicationNumber('Появилась новая заявка 1234')).toBe('1234');
  });

  it('извлекает 5-значный номер', () => {
    expect(extractApplicationNumber('Появилась новая заявка 12345')).toBe('12345');
  });

  it('извлекает 3-значный номер', () => {
    expect(extractApplicationNumber('Появилась новая заявка 100')).toBe('100');
  });

  it('игнорирует короткие числа (менее 3 цифр)', () => {
    expect(extractApplicationNumber('Появилась новая заявка 42')).toBeNull();
  });

  it('не путает с другими числами в тексте', () => {
    expect(extractApplicationNumber('Появилась новая заявка 3303 от 01.01.2025')).toBe('3303');
  });

  it('возвращает null для текста без номера заявки', () => {
    expect(extractApplicationNumber('Появилась новая заявка')).toBeNull();
    expect(extractApplicationNumber('Заявка обновлена')).toBeNull();
    expect(extractApplicationNumber('')).toBeNull();
  });

  it('регистронезависимо', () => {
    expect(extractApplicationNumber('появилась новая заявка 3303')).toBe('3303');
  });

  it('извлекает первый подходящий номер (3-5 цифр)', () => {
    expect(extractApplicationNumber('Появилась новая заявка 3303, 2025 год')).toBe('3303');
  });
});
