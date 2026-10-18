import {isQuietHours} from '../../src/utils/quiet-hours';

/** Date с заданными часами/минутами (секунды не влияют на результат). */
function at(hours: number, minutes: number, seconds = 0): Date {
  return new Date(2025, 0, 15, hours, minutes, seconds);
}

describe('isQuietHours — обычный интервал', () => {
  it('внутри интервала — true', () => {
    expect(isQuietHours(at(12, 30), '09:00', '13:00')).toBe(true);
    expect(isQuietHours(at(9, 0), '09:00', '13:00')).toBe(true);
    expect(isQuietHours(at(12, 59), '09:00', '13:00')).toBe(true);
  });

  it('вне интервала — false', () => {
    expect(isQuietHours(at(8, 59), '09:00', '13:00')).toBe(false);
    expect(isQuietHours(at(13, 0), '09:00', '13:00')).toBe(false);
    expect(isQuietHours(at(0, 0), '09:00', '13:00')).toBe(false);
  });
});

describe('isQuietHours — переход через полночь', () => {
  it('вечерняя часть (после from) — true', () => {
    expect(isQuietHours(at(22, 30), '22:00', '07:00')).toBe(true);
    expect(isQuietHours(at(23, 59), '22:00', '07:00')).toBe(true);
  });

  it('утренняя часть (до to) — true', () => {
    expect(isQuietHours(at(0, 0), '22:00', '07:00')).toBe(true);
    expect(isQuietHours(at(6, 59), '22:00', '07:00')).toBe(true);
  });

  it('днём (между to и from) — false', () => {
    expect(isQuietHours(at(7, 0), '22:00', '07:00')).toBe(false);
    expect(isQuietHours(at(12, 0), '22:00', '07:00')).toBe(false);
    expect(isQuietHours(at(21, 59), '22:00', '07:00')).toBe(false);
  });
});

describe('isQuietHours — границы', () => {
  it('from включается, to исключается', () => {
    expect(isQuietHours(at(10, 0), '10:00', '11:00')).toBe(true);
    expect(isQuietHours(at(11, 0), '10:00', '11:00')).toBe(false);
  });

  it('границы через полночь', () => {
    expect(isQuietHours(at(22, 0), '22:00', '07:00')).toBe(true);
    expect(isQuietHours(at(7, 0), '22:00', '07:00')).toBe(false);
  });

  it('from === to — пустой интервал (всегда false)', () => {
    expect(isQuietHours(at(22, 0), '22:00', '22:00')).toBe(false);
    expect(isQuietHours(at(10, 0), '10:00', '10:00')).toBe(false);
    expect(isQuietHours(at(0, 0), '00:00', '00:00')).toBe(false);
  });
});

describe('isQuietHours — некорректное время', () => {
  it('некорректные from/to → false', () => {
    expect(isQuietHours(at(12, 0), '25:00', '13:00')).toBe(false);
    expect(isQuietHours(at(12, 0), '09:60', '13:00')).toBe(false);
    expect(isQuietHours(at(12, 0), '9:00', '13:00')).toBe(false);
    expect(isQuietHours(at(12, 0), 'abc', '13:00')).toBe(false);
    expect(isQuietHours(at(12, 0), '09:00', '')).toBe(false);
    expect(isQuietHours(at(12, 0), '09:00', '24:00')).toBe(false);
  });
});
