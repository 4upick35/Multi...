import {displayFieldValue, buildAddress} from './collection-fields';
import {parsePhoneDisplay} from './card-fields';

const DASH = '\u2014';

function safe(val: unknown): string {
  const s = String(val ?? '').trim();
  return s || DASH;
}

function applicantPart(
  applicant: unknown,
  key: 'lastname' | 'firstname',
): string {
  if (!applicant || typeof applicant !== 'object') {
    return '';
  }
  const obj = applicant as Record<string, unknown>;
  return safe(obj[key]);
}

/**
 * Собрать текстовое сообщение с данными заявки для копирования в буфер обмена.
 * Ровно 12 строк, без пустой строки в конце.
 */
export function buildApplicationMessage(
  raw: Record<string, unknown>,
  resolvedRefs?: Map<string, string>,
): string {
  const applicant = raw.client_applicant;
  return [
    `#: ${safe((raw.__name as string) ?? '').trim()}`,
    `Код услуги: ${safe(displayFieldValue(raw.contract, resolvedRefs, 'contract'))}`,
    `Название услуги: ${safe(displayFieldValue(raw.service, resolvedRefs, 'service'))}`,
    `Телефон клиента: ${safe(parsePhoneDisplay(raw.client_phone_number))}`,
    `Фамилия клиента: ${applicantPart(applicant, 'lastname') || DASH}`,
    `Имя клиента: ${applicantPart(applicant, 'firstname') || DASH}`,
    `Адрес клиента логистика: ${safe(buildAddress(raw))}`,
    `Квартира клиента: ${safe(String((raw.number_of_apartment as string) ?? '').trim())}`,
    `Требование: ${safe(displayFieldValue(raw.customers_requirement_ref, resolvedRefs, 'customers_requirement_ref'))}`,
    `Категория: ${safe(displayFieldValue(raw.category_of_equipment, resolvedRefs, 'category_of_equipment'))}`,
    `Бренд: ${safe(displayFieldValue(raw.brand_of_technology, resolvedRefs, 'brand_of_technology'))}`,
    `Модель техники\\услуги клиента: ${safe(displayFieldValue(raw.technic, resolvedRefs, 'technic'))}`,
  ].join('\n');
}
