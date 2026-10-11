// Тесты вспомогательных функций коллекций: вывод полей карточки и сортировка
// общего списка заявок по номеру (applicationNumber / sortApplicationsByNumberDesc).
import {getExtraFields, getItemName, getItemStatus, getItemStatusColor, buildAddress, buildShortAddress, applicationNumber, sortApplicationsByNumberDesc} from '../../src/utils/collection-fields';
import {extractItemRef} from '../../src/domain/TaskService';

describe('getExtraFields', () => {
  it('подставляет русские подписи и разворачивает объектные значения', () => {
    const fields = getExtraFields({
      subject_of_request: 'Не включается',
      technic: {__name: 'Стиральная машина Bosch'},
    });
    expect(fields).toEqual([
      {label: 'Тема заявки', value: 'Не включается'},
      {label: 'Техника', value: 'Стиральная машина Bosch'},
    ]);
  });

  it('пропускает пустые значения и пустые массивы', () => {
    const fields = getExtraFields({
      subject_of_request: null,
      service: '',
      applications: [],
      technic: {__name: 'Bosch'},
    });
    expect(fields).toEqual([{label: 'Техника', value: 'Bosch'}]);
  });

  it('перечисляет имена из массива объектов', () => {
    const fields = getExtraFields({
      applications: [{__name: '3082'}, {__name: '3083'}],
    });
    expect(fields).toEqual([{label: 'Заявки', value: '3082, 3083'}]);
  });

  it('возвращает пустой массив, если полей нет', () => {
    expect(getExtraFields({})).toEqual([]);
  });

  it('разворачивает объектные значения с PascalCase Name', () => {
    const fields = getExtraFields({
      technic: {Id: 'id-1', Name: 'Стиральная машина'},
    });
    expect(fields).toEqual([{label: 'Техника', value: 'Стиральная машина'}]);
  });

  it('форматирует ISO-даты в читаемый вид', () => {
    const fields = getExtraFields({
      datetime_of_session: '2026-09-30T09:00:00.000Z',
    });
    expect(fields[0].label).toBe('Дата и время визита');
    // Дата должна быть отформатирована, а не показана как ISO
    expect(fields[0].value).not.toContain('T09:00:00');
  });

  it('оставляет обычные строки как есть', () => {
    const fields = getExtraFields({
      subject_of_request: 'Текст заявки',
    });
    expect(fields).toEqual([{label: 'Тема заявки', value: 'Текст заявки'}]);
  });
});

describe('getItemName / getItemStatus', () => {
  it('берёт номер из __name', () => {
    expect(getItemName({__name: '3082'})).toBe('3082');
  });

  it('разворачивает объектный __status', () => {
    expect(getItemStatus({__status: {name: 'В работе'}})).toBe('В работе');
  });

  it('разворачивает __status с PascalCase Name', () => {
    expect(getItemStatus({__status: {Id: 'abc', Name: 'Новая'}})).toBe('Новая');
  });

  it('поддерживает строковый статус', () => {
    expect(getItemStatus({__status: 'Новая'})).toBe('Новая');
  });
});

describe('extractItemRef', () => {
  it('извлекает ссылку на заявку из __item', () => {
    expect(
      extractItemRef({namespace: 'customer_service', code: 'applications', id: 'abc'}),
    ).toEqual({namespace: 'customer_service', code: 'applications', id: 'abc'});
  });

  it('возвращает undefined без id или code', () => {
    expect(extractItemRef({namespace: 'customer_service', code: 'applications'})).toBeUndefined();
    expect(extractItemRef(null)).toBeUndefined();
  });

  it('подставляет namespace по умолчанию', () => {
    expect(extractItemRef({code: 'applications', id: 'abc'})).toEqual({
      namespace: 'customer_service',
      code: 'applications',
      id: 'abc',
    });
  });
});

// ---------------------------------------------------------------------------
// getExtraFields — resolvedRefs
// ---------------------------------------------------------------------------
describe('getExtraFields — resolvedRefs', () => {
  it('использует резолв для UUID-массива', () => {
    const refs = new Map([['technic', 'Стиральная машина Bosch']]);
    const fields = getExtraFields({
      technic: ['019c5190-269a-7b01-9a58-120b2ccd953a'],
    }, refs);
    expect(fields).toEqual([{label: 'Техника', value: 'Стиральная машина Bosch'}]);
  });

  it('не показывает нечитаемые UUID если резолва нет', () => {
    const fields = getExtraFields({
      technic: ['019c5190-269a-7b01-9a58-120b2ccd953a'],
    });
    expect(fields).toEqual([]);
  });

  it('не показывает [object Object] для объектов без name', () => {
    const fields = getExtraFields({
      technic: {__id: 'abc'},
    });
    expect(fields).toEqual([]);
  });

  it('не показывает UUID-строку как есть', () => {
    const fields = getExtraFields({
      technic: '019c5190-269a-7b01-9a58-120b2ccd953a',
    });
    expect(fields).toEqual([]);
  });

  it('показывает обычные строки', () => {
    const fields = getExtraFields({
      subject_of_request: 'Не включается',
    });
    expect(fields).toEqual([{label: 'Тема заявки', value: 'Не включается'}]);
  });
});

// ---------------------------------------------------------------------------
// getItemStatusColor
// ---------------------------------------------------------------------------
describe('getItemStatusColor', () => {
  it('извлекает цвет из __status.color', () => {
    expect(getItemStatusColor({__status: {color: '#FF0000'}})).toBe('#FF0000');
  });

  it('возвращает undefined если цвета нет', () => {
    expect(getItemStatusColor({__status: {name: 'Новая'}})).toBeUndefined();
  });

  it('возвращает undefined если __status — строка', () => {
    expect(getItemStatusColor({__status: 'Новая'})).toBeUndefined();
  });

  it('возвращает undefined если __status отсутствует', () => {
    expect(getItemStatusColor({})).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildAddress
// ---------------------------------------------------------------------------
describe('buildShortAddress', () => {
  it('город из locality ставится в начало, улица и дом добавляются', () => {
    expect(buildShortAddress({
      locality: 'Волковыск',
      street: 'улица Горбатова',
      number_of_house: '14',
    })).toBe('Волковыск, улица Горбатова, 14');
  });

  it('если locality нет, город берётся из client_address с пропуском страны и области', () => {
    const result = buildShortAddress({
      client_address: 'Беларусь, Гродненская область, Дятлово, Новогрудская улица, 18Л',
    });
    expect(result).toMatch(/^Дятлово/);
    expect(result).not.toContain('Беларусь');
    expect(result).not.toContain('область');
  });

  it('сельский случай: пропускает страну, район и сельсовет, берёт агрогородок', () => {
    const result = buildShortAddress({
      client_address: 'Беларусь, Минская область, Клецкий район, Зубковский сельсовет, агрогородок Зубки, Коммунистическая улица, 24',
    });
    expect(result).toMatch(/^агрогородок Зубки/);
  });

  it('пустой raw → пустая строка', () => {
    expect(buildShortAddress({})).toBe('');
  });
});

describe('buildAddress', () => {
  it('возвращает client_address если задан, остальные части игнорируются', () => {
    expect(buildAddress({
      client_address: 'Москва, ул. Ленина, 1',
      locality: 'Питер',
      street: 'Невский',
    })).toBe('Москва, ул. Ленина, 1');
  });

  it('склеивает locality, street, number_of_house, area через запятую если client_address пуст', () => {
    expect(buildAddress({
      client_address: '',
      locality: 'Казань',
      street: 'ул. Баумана',
      number_of_house: '10',
      area: 'Татарстан',
      province: '',
    })).toBe('Казань, ул. Баумана, 10, Татарстан');
  });

  it('пропускает пустые части и возвращает пустую строку если ничего нет', () => {
    expect(buildAddress({})).toBe('');
  });
});

// ---------------------------------------------------------------------------
// getExtraFields — boolean → Да/Нет
// ---------------------------------------------------------------------------
describe('getExtraFields — boolean → Да/Нет', () => {
  it('boolean true отображается как «Да»', () => {
    const fields = getExtraFields({approved_by_client: true});
    expect(fields).toEqual([{label: 'Визит подтвержден', value: 'Да'}]);
  });

  it('boolean false отображается как «Нет»', () => {
    const fields = getExtraFields({approved_by_client: false});
    expect(fields).toEqual([{label: 'Визит подтвержден', value: 'Нет'}]);
  });
});

// ---------------------------------------------------------------------------
// getExtraFields — visits_by_masters
// ---------------------------------------------------------------------------
describe('getExtraFields — визит мастера', () => {
  it('approved_by_client даёт подпись «Визит подтвержден»', () => {
    const fields = getExtraFields({approved_by_client: true}, undefined, 'visits_by_masters');
    expect(fields).toEqual([{label: 'Визит подтвержден', value: 'Да'}]);
  });

  it('mileage отображается с подписью «Километраж»', () => {
    const fields = getExtraFields({mileage: 150}, undefined, 'visits_by_masters');
    expect(fields).toEqual([{label: 'Километраж', value: '150'}]);
  });

  it('reason_for_lack_of_confirrmation (с опечаткой) даёт подпись без опечатки', () => {
    const fields = getExtraFields(
      {reason_for_lack_of_confirrmation: 'Клиент недоступен'},
      undefined,
      'visits_by_masters',
    );
    expect(fields).toEqual([{label: 'Причина отсутствия подтверждения', value: 'Клиент недоступен'}]);
  });

  it('applications в режиме визита отображается как «Заявка» (не «Заявки»)', () => {
    const fields = getExtraFields({applications: [{__name: '3082'}]}, undefined, 'visits_by_masters');
    expect(fields).toEqual([{label: 'Заявка', value: '3082'}]);
  });

  it('applications в обычном режиме остаётся «Заявки»', () => {
    const fields = getExtraFields({applications: [{__name: '3082'}]});
    expect(fields).toEqual([{label: 'Заявки', value: '3082'}]);
  });

  it('порядок полей карточки визита: заявка, подтверждение, дата, километраж, причина', () => {
    const fields = getExtraFields({
      reason_for_lack_of_confirrmation: 'Причина',
      mileage: 10,
      applications: [{__name: '100'}],
      approved_by_client: true,
      datetime_of_session: '2026-09-21T10:00:00.000Z',
    }, undefined, 'visits_by_masters');
    expect(fields.map(f => f.label)).toEqual([
      'Заявка',
      'Визит подтвержден',
      'Дата и время визита',
      'Километраж',
      'Причина отсутствия подтверждения',
    ]);
  });

  it('null / "" / [] по-прежнему пропускаются', () => {
    const fields = getExtraFields({
      approved_by_client: null,
      mileage: '',
      reason_for_lack_of_confirrmation: [],
      applications: null,
    }, undefined, 'visits_by_masters');
    expect(fields).toEqual([]);
  });

  it('массив ["applications"] не ломает вывод', () => {
    const fields = getExtraFields({applications: ['019c5190-269a-7b01-9a58-120b2ccd953a']});
    expect(fields).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Номер заявки и сортировка общего списка заявок по номеру (по убыванию)
// ---------------------------------------------------------------------------
describe('applicationNumber', () => {
  it('берёт номер из названия с ведущими пробелами', () => {
    expect(applicationNumber({name: ' 3089'})).toBe(3089);
  });

  it('берёт номер из вида «Исполнение заявок ( 9335)»', () => {
    expect(applicationNumber({name: 'Исполнение заявок ( 9335)'})).toBe(9335);
  });

  it('возвращает NaN для строки без номера', () => {
    expect(applicationNumber({name: 'без номера'})).toBeNaN();
  });

  it('возвращает NaN для пустой строки и отсутствующего name', () => {
    expect(applicationNumber({name: ''})).toBeNaN();
    expect(applicationNumber({})).toBeNaN();
  });
});

describe('sortApplicationsByNumberDesc', () => {
  it('сортирует по номеру заявки по убыванию', () => {
    const items = [{name: ' 3082'}, {name: ' 3090'}, {name: ' 3085'}];
    expect(sortApplicationsByNumberDesc(items).map(i => i.name)).toEqual([' 3090', ' 3085', ' 3082']);
  });

  it('элементы без номера уходят в конец, их порядок сохраняется', () => {
    const items = [
      {name: 'без номера'},
      {name: ' 3082'},
      {name: ''},
      {name: 'Исполнение заявок ( 9335)'},
      {name: 'нет номера'},
    ];
    expect(sortApplicationsByNumberDesc(items).map(i => i.name)).toEqual([
      'Исполнение заявок ( 9335)',
      ' 3082',
      'без номера',
      '',
      'нет номера',
    ]);
  });

  it('не мутирует исходный массив', () => {
    const items = [{name: ' 3082'}, {name: ' 3090'}, {name: ' 3085'}];
    const sorted = sortApplicationsByNumberDesc(items);
    expect(items.map(i => i.name)).toEqual([' 3082', ' 3090', ' 3085']);
    expect(sorted).not.toBe(items);
  });

  it('возвращает пустой массив без изменений', () => {
    expect(sortApplicationsByNumberDesc([])).toEqual([]);
  });
});
