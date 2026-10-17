import {formatUtcInstant, formatTimeHMS, toElmaTimeOnlyIso, toElmaDateOnlyIso} from '../../src/utils/datetime';

describe('formatUtcInstant', () => {
  it('возвращает реальный момент времени в UTC с обнулёнными секундами', () => {
    const date = new Date('2026-09-21T17:30:45.678Z');
    expect(formatUtcInstant(date)).toBe('2026-09-21T17:30:00.000Z');
  });

  it('не сдвигает время: выбранные локально 20:20 уходят как тот же момент в UTC', () => {
    // new Date(y, m, d, h, min, sec) — локальные компоненты; результат должен быть
    // тем же моментом времени, а не «настенным» временем с буквой Z.
    const date = new Date(2026, 8, 21, 20, 20, 30);
    const expected = new Date(date.getTime());
    expected.setSeconds(0, 0);
    expect(formatUtcInstant(date)).toBe(expected.toISOString());
  });

  it('обнуляет секунды и миллисекунды', () => {
    const date = new Date('2026-01-05T09:05:59.999Z');
    expect(formatUtcInstant(date)).toBe('2026-01-05T09:05:00.000Z');
  });
});

describe('formatTimeHMS', () => {
  it('форматирует время HH:MM:SS с ведущими нулями', () => {
    const date = new Date(2026, 8, 21, 9, 5, 3);
    expect(formatTimeHMS(date)).toBe('09:05:03');
  });

  it('форматирует полночь', () => {
    const date = new Date(2026, 0, 1, 0, 0, 0);
    expect(formatTimeHMS(date)).toBe('00:00:00');
  });

  it('форматирует конец дня', () => {
    const date = new Date(2026, 11, 31, 23, 59, 59);
    expect(formatTimeHMS(date)).toBe('23:59:59');
  });

  it('дополняет нулями однозначные часы/минуты/секунды', () => {
    const date = new Date(2026, 0, 1, 1, 2, 3);
    expect(formatTimeHMS(date)).toBe('01:02:03');
  });

  it('корректно форматирует 12:00:00', () => {
    const date = new Date(2026, 5, 15, 12, 0, 0);
    expect(formatTimeHMS(date)).toBe('12:00:00');
  });
});

describe('toElmaTimeOnlyIso', () => {
  it('берёт часы и минуты из локальных компонент (tz-независимо)', () => {
    // new Date(y, m, d, h, min) создаётся из локальных компонент — час/минуты
    // getters вернут ровно 19:30 в любом часовом поясе.
    const date = new Date(2026, 0, 5, 19, 30);
    expect(toElmaTimeOnlyIso(date)).toBe('1970-01-01T19:30:00.000Z');
  });

  it('формат строго 1970-01-01THH:MM:00.000Z с ведущими нулями', () => {
    expect(toElmaTimeOnlyIso(new Date(2026, 8, 21, 9, 5, 45))).toBe(
      '1970-01-01T09:05:00.000Z',
    );
  });

  it('форматирует полночь', () => {
    expect(toElmaTimeOnlyIso(new Date(2026, 0, 1, 0, 0, 59))).toBe(
      '1970-01-01T00:00:00.000Z',
    );
  });

  it('форматирует 23:59 (секунды и дата Date игнорируются)', () => {
    expect(toElmaTimeOnlyIso(new Date(2026, 11, 31, 23, 59, 30))).toBe(
      '1970-01-01T23:59:00.000Z',
    );
  });
});

describe('toElmaDateOnlyIso', () => {
  it('дата не сдвигается: строка равна UTC-полночи от локальных компонент', () => {
    const date = new Date(2026, 8, 21, 14, 45, 10);
    expect(toElmaDateOnlyIso(date)).toBe('2026-09-21T00:00:00.000Z');
  });

  it('tz-независимо: ожидание строится из тех же локальных компонент', () => {
    const date = new Date(2026, 0, 5, 23, 30);
    const y = date.getFullYear();
    const m = date.getMonth();
    const d = date.getDate();
    expect(toElmaDateOnlyIso(date)).toBe(new Date(Date.UTC(y, m, d)).toISOString());
  });

  it('время суток в Date отбрасывается', () => {
    expect(toElmaDateOnlyIso(new Date(2026, 11, 31, 0, 0, 1))).toBe(
      '2026-12-31T00:00:00.000Z',
    );
  });

  it('год/месяц/день с ведущими нулями в литерале', () => {
    expect(toElmaDateOnlyIso(new Date(2026, 0, 2, 12, 0, 0))).toBe(
      '2026-01-02T00:00:00.000Z',
    );
  });
});
