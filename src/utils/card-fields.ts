// ---------------------------------------------------------------------------
// card-fields.ts — Утилиты разбора полей карточки заявки.
// Телефон: client_phone_number — массив объектов [{tel, type}], а не строка.
// ФИО: client_applicant — объект {lastname, firstname, middlename}.
// ---------------------------------------------------------------------------

/** Тип элемента массива телефонов из ELMA */
interface PhoneItem {
  tel?: string;
  type?: string;
}

/** Тип объекта ФИО из ELMA */
interface ApplicantName {
  lastname?: string;
  firstname?: string;
  middlename?: string;
}

/**
 * Извлечь телефоны из client_phone_number (массив объектов или строка).
 * Возвращает отображаемую строку: «+10000000001, +10000000002».
 * Если телефонов нет — возвращает пустую строку.
 */
export function parsePhoneDisplay(value: unknown): string {
  if (!value) {
    return '';
  }

  // Если уже строка (обратная совместимость)
  if (typeof value === 'string') {
    return value.trim();
  }

  // Массив объектов [{tel, type}]
  if (Array.isArray(value)) {
    const phones = (value as PhoneItem[])
      .filter((item) => item && typeof item === 'object' && item.tel)
      .map((item) => String(item.tel).trim())
      .filter(Boolean);
    return phones.join(', ');
  }

  return '';
}

/**
 * Очистить телефон для tel:-ссылки.
 * Оставляет только цифры и ведущий +.
 */
export function parsePhoneTel(value: unknown): string {
  const display = parsePhoneDisplay(value);
  if (!display) {
    return '';
  }
  // Берём первый номер (если их несколько — первый для tel: ссылки)
  const firstPhone = display.split(',')[0].trim();
  // Очищаем: только + и цифры
  return firstPhone.replace(/[^+\d]/g, '');
}

/**
 * Собрать строку ФИО из client_applicant (объект {lastname, firstname, middlename}).
 * Пустые части пропускаются. Пример: «Имя» или «Фамилия Имя Отчество».
 */
export function parseApplicantName(value: unknown): string {
  if (!value) {
    return '';
  }

  // Если уже строка (обратная совместимость)
  if (typeof value === 'string') {
    return value.trim();
  }

  // Объект {lastname, firstname, middlename}
  if (typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as ApplicantName;
    const parts = [
      String(obj.lastname || '').trim(),
      String(obj.firstname || '').trim(),
      String(obj.middlename || '').trim(),
    ].filter(Boolean);
    return parts.join(' ');
  }

  return '';
}
