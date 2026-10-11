import {parsePhoneDisplay, parsePhoneTel, parseApplicantName} from '../../src/utils/card-fields';

describe('parsePhoneDisplay', () => {
  it('извлекает телефон из массива объектов [{tel, type}]', () => {
    const value = [{tel: '+10000000001', type: 'main'}];
    expect(parsePhoneDisplay(value)).toBe('+10000000001');
  });

  it('перечисляет несколько телефонов через запятую', () => {
    const value = [
      {tel: '+10000000001', type: 'main'},
      {tel: '+10000000002', type: 'additional'},
    ];
    expect(parsePhoneDisplay(value)).toBe('+10000000001, +10000000002');
  });

  it('фильтрует пустые элементы массива', () => {
    const value = [
      {tel: '+10000000001', type: 'main'},
      null,
      {type: 'additional'},
      undefined,
    ];
    expect(parsePhoneDisplay(value)).toBe('+10000000001');
  });

  it('возвращает строку как есть (обратная совместимость)', () => {
    expect(parsePhoneDisplay('+10000000001')).toBe('+10000000001');
  });

  it('возвращает пустую строку для null/undefined', () => {
    expect(parsePhoneDisplay(null)).toBe('');
    expect(parsePhoneDisplay(undefined)).toBe('');
    expect(parsePhoneDisplay('')).toBe('');
  });

  it('возвращает пустую строку для пустого массива', () => {
    expect(parsePhoneDisplay([])).toBe('');
  });
});

describe('parsePhoneTel', () => {
  it('очищает телефон для tel: ссылки — оставляет + и цифры', () => {
    const value = [{tel: '+1 (000) 000-00-01', type: 'main'}];
    expect(parsePhoneTel(value)).toBe('+10000000001');
  });

  it('берёт первый номер из нескольких', () => {
    const value = [
      {tel: '+10000000001', type: 'main'},
      {tel: '+10000000002', type: 'additional'},
    ];
    expect(parsePhoneTel(value)).toBe('+10000000001');
  });

  it('возвращает пустую строку если телефонов нет', () => {
    expect(parsePhoneTel(null)).toBe('');
    expect(parsePhoneTel([])).toBe('');
  });

  it('работает со строковым значением', () => {
    expect(parsePhoneTel('+10000000001')).toBe('+10000000001');
  });
});

describe('parseApplicantName', () => {
  it('собирает ФИО из объекта {lastname, firstname, middlename}', () => {
    const value = {lastname: 'Фамилия', firstname: 'Имя', middlename: 'Отчество'};
    expect(parseApplicantName(value)).toBe('Фамилия Имя Отчество');
  });

  it('пропускает пустые части', () => {
    const value = {lastname: '', firstname: 'Имя', middlename: ''};
    expect(parseApplicantName(value)).toBe('Имя');
  });

  it('собирает фамилию + имя без отчества', () => {
    const value = {lastname: 'Фамилия', firstname: 'Имя', middlename: ''};
    expect(parseApplicantName(value)).toBe('Фамилия Имя');
  });

  it('возвращает строку как есть (обратная совместимость)', () => {
    expect(parseApplicantName('Фамилия Имя')).toBe('Фамилия Имя');
  });

  it('возвращает пустую строку для null/undefined', () => {
    expect(parseApplicantName(null)).toBe('');
    expect(parseApplicantName(undefined)).toBe('');
  });

  it('возвращает пустую строку для пустого объекта', () => {
    expect(parseApplicantName({})).toBe('');
  });

  it('возвращает пустую строку для массива (неожиданный тип)', () => {
    expect(parseApplicantName([1, 2, 3])).toBe('');
  });
});
