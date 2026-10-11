import {Alert, Share} from 'react-native';
import {isDiagBuild, getCookies, shareTextFile} from '../native/KeepAlive';
import {errorText} from '../utils/error-text';

/** Максимум записей: лог не должен расти бесконечно. */
const MAX_ENTRIES = 2000;

/** Максимум символов, передаваемых в системный «Поделиться» (ограничение платформ). */
export const DIAG_SHARE_MAX_CHARS = 200000;

/** Максимум символов, который уходит в файл (после обрезки — последние символы). */
export const DIAG_FILE_MAX_CHARS = 2_000_000;

interface DiagEntry {
  t: number;
  tag: string;
  text: string;
  /** Число подряд идущих одинаковых записей (нет повторов — поле отсутствует). */
  repeat?: number;
}

const entries: DiagEntry[] = [];
const startedAt = Date.now();

/** Добавить запись в диагностический лог. Одинаковые подряд записи схлопываются. */
export function logDiag(tag: string, text: string): void {
  try {
    const value = String(text).slice(0, 2000);
    const last = entries[entries.length - 1];
    if (last !== undefined && last.tag === tag && last.text === value) {
      last.repeat = (last.repeat ?? 1) + 1;
      last.t = Date.now() - startedAt;
      return;
    }
    entries.push({t: Date.now() - startedAt, tag, text: value});
    if (entries.length > MAX_ENTRIES) {
      entries.splice(0, entries.length - MAX_ENTRIES);
    }
  } catch {
    // best-effort
  }
}

/** Полный текст лога. */
export function getDiagLog(): string {
  if (entries.length === 0) {
    return 'MultiElma diag: лог пуст';
  }
  const head = 'MultiElma diag, записей: ' + entries.length + '\n';
  return (
    head +
    entries
      .map(e => {
        const repeats = e.repeat !== undefined && e.repeat > 1 ? ' (x' + e.repeat + ')' : '';
        return '+' + e.t + 'ms [' + e.tag + '] ' + e.text + repeats;
      })
      .join('\n')
  );
}

export function hasDiagLog(): boolean {
  return entries.length > 0;
}

/** Обрезает лог до последних maxChars символов (с пометкой сверху), если он длиннее. */
function truncateDiagLog(full: string, maxChars: number): string {
  if (full.length <= maxChars) {
    return full;
  }
  return (
    'MultiElma diag: лог обрезан, показаны последние ' +
    maxChars +
    ' символов из ' +
    full.length +
    '\n' +
    full.slice(-maxChars)
  );
}

/** Имя файла лога с датой (локальное время): multielma-diag-YYYYMMDD-HHMMSS.txt. */
function diagFileName(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    'multielma-diag-' +
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    '-' +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds()) +
    '.txt'
  );
}

/**
 * Отдать лог через системный «Поделиться». В обычной сборке — ничего не делает.
 *
 * Основной путь — файлом (нативный shareTextFile, ACTION_SEND с content-Uri):
 * текст до DIAG_FILE_MAX_CHARS не уходит в Intent и не подвешивает приложение.
 * Если файлом не вышло (нет модуля/ошибка) — fallback на Share.share текстом
 * с обрезкой до DIAG_SHARE_MAX_CHARS. Сбой шаринга видим: запись в diag + Alert.
 */
export async function shareDiagLog(reason: string): Promise<void> {
  if (!isDiagBuild) {
    return;
  }
  const full = getDiagLog();
  const truncated = full.length > DIAG_SHARE_MAX_CHARS;
  const fileText = truncateDiagLog(full, DIAG_FILE_MAX_CHARS);
  logDiag(
    'share',
    `diag-share start entries=${entries.length} chars=${full.length} truncated=${
      truncated ? 'да' : 'нет'
    }`,
  );

  const title = 'MultiElma diag: ' + reason;
  let sharedAsFile = false;
  try {
    sharedAsFile = await shareTextFile(diagFileName(), fileText, title);
  } catch (error) {
    logDiag('share', 'diag-share file error=' + errorText(error));
  }
  if (sharedAsFile) {
    logDiag('share', 'diag-share file done');
    return;
  }

  const text = truncateDiagLog(full, DIAG_SHARE_MAX_CHARS);
  try {
    await Share.share({title, message: text});
  } catch (error) {
    const message = errorText(error);
    logDiag('share', 'diag-share error=' + message);
    Alert.alert('Диагностика', 'Не удалось поделиться логом:\n' + message);
    return;
  }
  logDiag('share', 'diag-share done');
}

/** Диагностика cookie-банка WebView: опрашивает CookieManager для ключевых URL. */
export async function shareCookieBank(portalBaseUrl?: string): Promise<void> {
  if (!isDiagBuild) {
    return;
  }
  const urls = [
    'https://www.google.com/recaptcha/',
    'https://www.google.com/recaptcha/api.js',
    'https://www.gstatic.com/recaptcha/',
    ...(portalBaseUrl ? [portalBaseUrl] : []),
  ];
  for (const url of urls) {
    const raw = await getCookies(url);
    const hasCookies = !!raw && raw.length > 0;
    logDiag('cookies', url + ' — есть cookies: ' + (hasCookies ? 'да' : 'нет'));

    const parts = raw ? raw.split(/;\s*/) : [];

    if (hasCookies) {
      const names = parts.map(p => p.split('=')[0]).join(', ');
      logDiag('cookies', 'Имена cookie (' + parts.length + '): ' + names.substring(0, 300));
    }

    const gre = parts.find(p => p.startsWith('_GRECAPTCHA='));
    if (gre) {
      // Только факт наличия и длина: само значение в лог не пишем (безопасность).
      logDiag('cookies', '_GRECAPTCHA: ЕСТЬ, длина=' + (gre.length - '_GRECAPTCHA='.length));
    } else {
      logDiag('cookies', '_GRECAPTCHA: НЕТ');
    }
  }
  await shareDiagLog('cookie-банк');
}
