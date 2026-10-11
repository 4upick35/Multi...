import {maskValue} from '../../src/utils/mask';

describe('maskValue', () => {
  it('маскирует email: сохраняет домен, скрывает локальную часть', () => {
    const masked = maskValue('login@example.com');
    expect(masked).toContain('@example.com');
    expect(masked).not.toContain('login');
  });

  it('усечает UUID до первых 8 символов', () => {
    expect(maskValue('01a0d011-b9a0-7af8-bb6e-4bac6568954f')).toBe('01a0d011…');
  });

  it('усечает длинную строку (40 символов) до 6 символов и …', () => {
    const long = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCd';
    expect(long.length).toBe(40);
    const masked = maskValue(long);
    expect(masked).toBe('AbCdEf…');
    expect(masked.length).toBe(7);
  });

  it('обычный текст без секретов не меняется', () => {
    expect(maskValue('обычный текст без секретов')).toBe('обычный текст без секретов');
    expect(maskValue('short token')).toBe('short token');
  });

  it('null и undefined -> пустая строка', () => {
    expect(maskValue(null)).toBe('');
    expect(maskValue(undefined)).toBe('');
  });
});
