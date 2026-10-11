import {Alert, Share} from 'react-native';
import {
  logDiag,
  getDiagLog,
  hasDiagLog,
  shareDiagLog,
  DIAG_SHARE_MAX_CHARS,
} from '../../src/diag/accept-log';

// Нативный мост в тестах доступен: isDiagBuild=true, чтобы шаринг работал.
jest.mock('../../src/native/KeepAlive', () => ({
  isDiagBuild: true,
  getCookies: jest.fn(async () => null),
}));

/** Фактическое число записей из заголовка «записей: N» (пустой лог — 0). */
function entriesCount(): number {
  const text = getDiagLog();
  if (text === 'MultiElma diag: лог пуст') {
    return 0;
  }
  const match = /^MultiElma diag, записей: (\d+)/.exec(text);
  return match === null ? -1 : Number(match[1]);
}

/** Последняя строка лога (заголовок — первая строка, поэтому он не попадает). */
function lastLine(): string {
  const lines = getDiagLog().split('\n');
  return lines[lines.length - 1];
}

/** Время (в мс от старта) из строки вида `+123ms [tag] text`. */
function lineTime(line: string): number {
  const match = /^\+(\d+)ms /.exec(line);
  return match === null ? -1 : Number(match[1]);
}

describe('diag-лог: схлопывание одинаковых записей', () => {
  it('подряд идущие одинаковые записи не растят число записей и выводятся как (xN)', () => {
    const before = entriesCount();

    logDiag('accept-log-eq', 'повторяющаяся строка');
    logDiag('accept-log-eq', 'повторяющаяся строка');
    logDiag('accept-log-eq', 'повторяющаяся строка');

    const log = getDiagLog();
    expect(entriesCount()).toBe(before + 1);
    expect(log).toContain('[accept-log-eq] повторяющаяся строка (x3)');
  });

  it('разные подряд записи не схлопываются', () => {
    const before = entriesCount();

    logDiag('accept-log-diff', 'первая строка');
    logDiag('accept-log-diff', 'вторая строка');
    logDiag('accept-log-diff-tag', 'первая строка');

    const log = getDiagLog();
    expect(entriesCount()).toBe(before + 3);
    expect(log).toContain('[accept-log-diff] первая строка');
    expect(log).toContain('[accept-log-diff] вторая строка');
    expect(log).toContain('[accept-log-diff-tag] первая строка');
    expect(log).not.toContain('первая строка (x');
    expect(log).not.toContain('вторая строка (x');
  });

  it('после разной записи счётчик повторов начинается заново', () => {
    const before = entriesCount();

    logDiag('accept-log-reset', 'A');
    logDiag('accept-log-reset', 'B');
    logDiag('accept-log-reset', 'A');
    logDiag('accept-log-reset', 'A');

    expect(entriesCount()).toBe(before + 3);
    expect(getDiagLog()).toContain('[accept-log-reset] A (x2)');
    expect(getDiagLog()).toContain('[accept-log-reset] B\n');
  });

  it('обычная строка сохраняет формат +<ms>ms [tag] text без суффикса повторов', () => {
    logDiag('accept-log-plain', 'уникальная строка');

    expect(lastLine()).toMatch(/^\+\d+ms \[accept-log-plain\] уникальная строка$/);
    expect(hasDiagLog()).toBe(true);
  });

  it('при повторе обновляется время последней записи', () => {
    const nowSpy = jest.spyOn(Date, 'now');
    try {
      const base = nowSpy();

      nowSpy.mockReturnValue(base);
      logDiag('accept-log-time', 'строка со временем');
      nowSpy.mockReturnValue(base + 50);
      logDiag('accept-log-time', 'строка со временем');
      nowSpy.mockReturnValue(base + 90);
      logDiag('accept-log-time', 'строка со временем');
      const collapsed = lastLine();

      nowSpy.mockReturnValue(base + 90);
      logDiag('accept-log-time-ctrl', 'уникальная строка');
      const fresh = lastLine();

      expect(collapsed).toContain('[accept-log-time] строка со временем (x3)');
      expect(lineTime(collapsed)).toBe(lineTime(fresh));
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('лимит записей уменьшен до 2000 (шаринг лога оставался рабочим)', () => {
    for (let i = 0; i < 2100; i++) {
      logDiag('accept-log-limit', 'уникальная строка ' + i);
    }

    expect(entriesCount()).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// shareDiagLog: обрезка лога, видимая диагностика сбоя
// ---------------------------------------------------------------------------

describe('shareDiagLog', () => {
  beforeEach(() => {
    jest.spyOn(Share, 'share').mockResolvedValue({action: 'sharedAction'} as never);
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('getDiagLog() отдаёт полный текст — при логе в пределах лимита шаринг получает его целиком', async () => {
    const full = getDiagLog();
    expect(full).toMatch(/^MultiElma diag/);
    expect(full.length).toBeLessThanOrEqual(DIAG_SHARE_MAX_CHARS);

    await expect(shareDiagLog('тест')).resolves.toBeUndefined();

    expect(Share.share).toHaveBeenCalledTimes(1);
    const content = (Share.share as jest.Mock).mock.calls[0][0] as {title: string; message: string};
    expect(content.title).toBe('MultiElma diag: тест');
    expect(content.message).toBe(full);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('успешный шаринг пишет diag-share start (entries/chars/truncated) и diag-share done', async () => {
    await shareDiagLog('вручную');

    expect(Share.share).toHaveBeenCalledTimes(1);
    expect(getDiagLog()).toMatch(/diag-share start entries=\d+ chars=\d+ truncated=нет/);
    expect(getDiagLog()).toContain('diag-share done');
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('ошибка Share.share → запись diag-share error и видимый Alert.alert', async () => {
    (Share.share as jest.Mock).mockRejectedValueOnce(new Error('share failed'));

    await shareDiagLog('тест-ошибка');

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const args = (Alert.alert as jest.Mock).mock.calls[0] as [string, string];
    expect(args[0]).toBe('Диагностика');
    expect(args[1]).toContain('Не удалось поделиться логом');
    expect(args[1]).toContain('share failed');
    expect(getDiagLog()).toContain('diag-share error=share failed');
  });

  it('превышение DIAG_SHARE_MAX_CHARS → последние символы + пометка об обрезке', async () => {
    for (let i = 0; i < 150; i++) {
      logDiag('share-trunc', 'x'.repeat(1900) + '-' + i);
    }
    const before = getDiagLog();
    expect(before.length).toBeGreaterThan(DIAG_SHARE_MAX_CHARS);

    await shareDiagLog('тест-обрезка');

    const content = (Share.share as jest.Mock).mock.calls[0][0] as {message: string};
    const message = content.message;
    expect(
      message.startsWith(
        'MultiElma diag: лог обрезан, показаны последние ' +
          DIAG_SHARE_MAX_CHARS +
          ' символов из ' +
          before.length,
      ),
    ).toBe(true);
    expect(message).toContain('лог обрезан');
    expect(message.length).toBeLessThanOrEqual(DIAG_SHARE_MAX_CHARS + 500);
    expect(message.endsWith(before.slice(-DIAG_SHARE_MAX_CHARS))).toBe(true);
    expect(getDiagLog()).toContain('truncated=да');
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
