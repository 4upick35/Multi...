import {parseHex, luminance, contrastText, mixWithWhite} from '../../src/utils/color';

describe('parseHex', () => {
  it('парсит #RRGGBB', () => {
    expect(parseHex('#FF5722')).toEqual({r: 255, g: 87, b: 34});
  });

  it('парсит #RGB', () => {
    expect(parseHex('#F00')).toEqual({r: 255, g: 0, b: 0});
  });

  it('парсит без решётки', () => {
    expect(parseHex('00BCD4')).toEqual({r: 0, g: 188, b: 212});
  });

  it('возвращает null для невалидного формата', () => {
    expect(parseHex('xyz')).toBeNull();
    expect(parseHex('#GGG')).toBeNull();
    expect(parseHex('#1234')).toBeNull();
    expect(parseHex('')).toBeNull();
  });
});

describe('luminance', () => {
  it('чёрный → 0', () => {
    expect(luminance('#000000')).toBeCloseTo(0, 2);
  });

  it('белый → 1', () => {
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 2);
  });

  it('возвращает 0.5 для невалидного hex', () => {
    expect(luminance('invalid')).toBe(0.5);
  });
});

describe('contrastText', () => {
  it('для белого фона → чёрный текст', () => {
    expect(contrastText('#FFFFFF')).toBe('#000000');
  });

  it('для чёрного фона → белый текст', () => {
    expect(contrastText('#000000')).toBe('#FFFFFF');
  });

  it('для тёмного фона → белый текст', () => {
    expect(contrastText('#6200EE')).toBe('#FFFFFF');
  });

  it('для светлого фона → чёрный текст', () => {
    expect(contrastText('#03DAC6')).toBe('#000000');
  });
});

describe('mixWithWhite', () => {
  it('amount=0 → исходный цвет', () => {
    expect(mixWithWhite('#FF5722', 0).toLowerCase()).toBe('#ff5722');
  });

  it('amount=1 → белый', () => {
    const result = mixWithWhite('#FF5722', 1).toLowerCase();
    expect(result).toBe('#ffffff');
  });

  it('нормализует регистр hex', () => {
    const result = mixWithWhite('#ff5722', 0);
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('возвращает исходный hex для невалидного значения', () => {
    expect(mixWithWhite('invalid', 0.5)).toBe('invalid');
  });
});
