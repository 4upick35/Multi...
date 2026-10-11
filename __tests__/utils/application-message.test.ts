import {buildApplicationMessage} from '../../src/utils/application-message';

const fullRaw: Record<string, unknown> = {
  __name: ' 3089 ',
  contract: {__name: 'Договор-123'},
  service: {__name: 'Услуга ABC'},
  client_phone_number: [{tel: '+10000000001'}, {tel: '+10000000002'}],
  client_applicant: {lastname: 'Фамилия', firstname: 'Имя', middlename: 'Отчество'},
  client_address: 'Минск, ул. Ленина, 10',
  number_of_apartment: '25',
  customers_requirement_ref: {__name: 'Замена'},
  category_of_equipment: {__name: 'Стиральная машина'},
  brand_of_technology: {__name: 'Bosch'},
  technic: {__name: 'Bosch WAV28'},
};

describe('buildApplicationMessage', () => {
  it('все 12 полей заполнены — полное сообщение', () => {
    const msg = buildApplicationMessage(fullRaw);
    expect(msg).toBe(
      [
        '#: 3089',
        'Код услуги: Договор-123',
        'Название услуги: Услуга ABC',
        'Телефон клиента: +10000000001, +10000000002',
        'Фамилия клиента: Фамилия',
        'Имя клиента: Имя',
        'Адрес клиента логистика: Минск, ул. Ленина, 10',
        'Квартира клиента: 25',
        'Требование: Замена',
        'Категория: Стиральная машина',
        'Бренд: Bosch',
        `Модель техники\\услуги клиента: Bosch WAV28`,
      ].join('\n'),
    );
  });

  it('все поля пустые/отсутствуют — 12 строк с прочерками', () => {
    const msg = buildApplicationMessage({});
    const lines = msg.split('\n');
    expect(lines).toHaveLength(12);
    for (const line of lines) {
      expect(line).toMatch(/: —$/);
    }
  });

  it('__name со пробелами по краям обрезается', () => {
    const msg = buildApplicationMessage({...fullRaw, __name: '   5001  '});
    expect(msg.split('\n')[0]).toBe('#: 5001');
  });

  it('ссылочные UUID-поля резолвятся через resolvedRefs', () => {
    const refs = new Map([
      ['contract', 'Договор (УНУ)'],
      ['service', 'Услуга (ремонт)'],
      ['technic', 'Стиральная машина Siemens'],
    ]);
    const raw: Record<string, unknown> = {
      __name: '9999',
      contract: '019c5190-269a-7b01-9a58-120b2ccd953a',
      service: ['019c5190-269a-7b01-9a58-120b2ccd953b'],
      technic: '019c5190-269a-7b01-9a58-120b2ccd953c',
    };
    const msg = buildApplicationMessage(raw, refs);
    const lines = msg.split('\n');
    expect(lines[0]).toBe('#: 9999');
    expect(lines[1]).toBe('Код услуги: Договор (УНУ)');
    expect(lines[2]).toBe('Название услуги: Услуга (ремонт)');
    expect(lines[11]).toBe('Модель техники\\услуги клиента: Стиральная машина Siemens');
  });
});
