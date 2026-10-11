/**
 * SparePartPickerModal — окно «Добавить запчасть» (как на сайте).
 *
 * Проверяем:
 * - рендер: заголовок «Добавить запчасть», поля формы («Не найдено в списке»,
 *   «Название», «Принадлежность», «Цена за единицу», «Количество»,
 *   «Планируемая дата доставки»), «Отмена»/«Сохранить»;
 * - пустой запрос → первая страница (limit 50, sortField `__name`, ascending)
 *   с фильтром `actual = true`;
 * - ввод текста: debounce 600 мс, серверный запрос только с 2 символов,
 *   фильтр EQL `like` по части слова + `actual = true`;
 * - один символ — запроса к серверу нет, показывается «Ничего не найдено»;
 * - выбор пункта заполняет «Название» и запоминает id запчасти (submit не вызывается);
 * - галка «Не найдено в списке» скрывает поиск и список, «Название» вводится вручную;
 * - валидация saveUsedSP: без запчасти/названия, принадлежности, цены,
 *   количества или даты доставки — текст «Заполнены не все данные для
 *   записи в таблицу» и submit не вызывается;
 * - преобразование принадлежности: «Восстановление запчасти» → `recovery`;
 * - счётчик «Показано N из TOTAL» и догрузка «Показать ещё»;
 * - кэш результатов: повторный тот же запрос без сети;
 * - ошибка сети → текст «Не удалось загрузить список запчастей» без повторов;
 * - закрытие сбрасывает состояние формы.
 *
 * fetchCollectionItems замокан — реальных запросов к ELMA нет.
 */

import React from 'react';
import renderer, {act, ReactTestRenderer} from 'react-test-renderer';
import {PaperProvider} from 'react-native-paper';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../src/services/elma-api', () => {
  const actual = jest.requireActual('../../src/services/elma-api');
  return {
    ...actual,
    fetchCollectionItems: jest.fn(),
  };
});

import SparePartPickerModal from '../../src/components/SparePartPickerModal';
import type {SparePartRow} from '../../src/utils/execution-form';
import {fetchCollectionItems} from '../../src/services/elma-api';
import type {ElmaAccount} from '../../src/types/account';

const mockedFetch = fetchCollectionItems as jest.MockedFunction<
  typeof fetchCollectionItems
>;

jest.useFakeTimers();

const account = {
  id: 'acc-1',
  name: 'Мастер',
  baseUrl: 'https://elma.test',
  portal: 'customer_service',
  email: 'user@example.com',
  color: '#4CAF50',
  userId: 'user-1',
  token: 'token-1',
  cookies: '',
  isActive: true,
  userKind: 'portal',
} as unknown as ElmaAccount;

const onCancel = jest.fn();
const onSubmit = jest.fn();

/** Фильтр списка без поискового текста: только `actual = true`. */
const ACTUAL_ONLY_FILTER = {and: [{eq: [{field: 'actual'}, {const: true}]}]};

/** Фильтр с поисковым текстом: `like` по `__name` + `actual = true`. */
function searchFilter(text: string) {
  return {
    and: [{like: [{field: '__name'}, {const: text}]}, {eq: [{field: 'actual'}, {const: true}]}],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedFetch.mockResolvedValue({items: []});
});

function modalProps(visible: boolean) {
  return (
    <SparePartPickerModal
      visible={visible}
      account={account}
      onCancel={onCancel}
      onSubmit={onSubmit}
    />
  );
}

async function renderModal(visible = true): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<PaperProvider>{modalProps(visible)}</PaperProvider>);
    await Promise.resolve();
    await Promise.resolve();
  });
  return tree;
}

function nodes(tree: ReactTestRenderer, testID: string) {
  return tree.root.findAll(n => n.props.testID === testID);
}

function firstWithPress(tree: ReactTestRenderer, testID: string) {
  const found = tree.root.findAll(
    n => n.props.testID === testID && typeof n.props.onPress === 'function',
  );
  expect(found.length).toBeGreaterThan(0);
  return found[0];
}

function findLabel(tree: ReactTestRenderer, label: string) {
  const found = tree.root.findAll(n => n.props.label === label);
  expect(found.length).toBeGreaterThan(0);
  return found[0];
}

function searchInput(tree: ReactTestRenderer) {
  const found = nodes(tree, 'spare-search');
  expect(found.length).toBeGreaterThan(0);
  return found[0];
}

async function typeQuery(tree: ReactTestRenderer, text: string) {
  await act(async () => {
    searchInput(tree).props.onChangeText(text);
  });
}

async function typeInto(tree: ReactTestRenderer, testID: string, text: string) {
  await act(async () => {
    const found = nodes(tree, testID).find(
      n => typeof n.props.onChangeText === 'function',
    );
    expect(found).toBeTruthy();
    found!.props.onChangeText(text);
  });
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function press(node: {props: {onPress: () => void | Promise<void>}}) {
  await act(async () => {
    await node.props.onPress();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Открыть календарь и выбрать дату. */
async function pickDate(tree: ReactTestRenderer, date: Date) {
  await press(firstWithPress(tree, 'spare-delivery-date'));
  const pickers = tree.root.findAll(n => n.type === 'DateTimePicker');
  expect(pickers.length).toBeGreaterThan(0);
  await act(async () => {
    pickers[0].props.onChange({type: 'set'}, date);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderedStrings(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAll(n => typeof n.props.children === 'string')
    .map(n => n.props.children as string);
}

function optionIds(tree: ReactTestRenderer): string[] {
  const found = tree.root
    .findAll(n => typeof n.props.testID === 'string' && n.props.testID.startsWith('spare-option-'))
    .map(n => n.props.testID as string);
  return Array.from(new Set(found));
}

function submitNode(tree: ReactTestRenderer) {
  const found = nodes(tree, 'spare-submit').find(
    n => typeof n.props.onPress === 'function',
  );
  expect(found).toBeTruthy();
  return found!;
}

function validationError(tree: ReactTestRenderer): string[] {
  return Array.from(
    new Set(
      nodes(tree, 'spare-validation-error').map(n => String(n.props.children)),
    ),
  );
}

/** Заполнить всё, кроме принадлежности, и нажать «Сохранить». */
async function fillWithoutAffiliation(tree: ReactTestRenderer) {
  await typeInto(tree, 'spare-price', '4.46');
  await typeInto(tree, 'spare-quantity', '1');
  await pickDate(tree, new Date(2026, 8, 26));
}

// ---------------------------------------------------------------------------
// Рендер
// ---------------------------------------------------------------------------

describe('SparePartPickerModal — рендер', () => {
  it('заголовок, поля формы, «Отмена» и «Сохранить»', async () => {
    const tree = await renderModal();

    const texts = renderedStrings(tree);
    expect(texts).toContain('Добавить запчасть');
    expect(texts).toContain('Отмена');
    expect(texts).toContain('Сохранить');
    expect(texts).toContain('Не найдено в списке');
    expect(texts).toContain('Принадлежность');
    expect(texts).toContain('Планируемая дата доставки');

    findLabel(tree, 'Поиск по названию');
    findLabel(tree, 'Название');
    findLabel(tree, 'Цена за единицу');
    findLabel(tree, 'Количество');

    const checkbox = nodes(tree, 'spare-not-found-checkbox').find(
      n => n.props.status === 'checked' || n.props.status === 'unchecked',
    );
    expect(checkbox).toBeTruthy();
    expect(checkbox!.props.status).toBe('unchecked');

    await press(firstWithPress(tree, 'spare-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('пустой запрос: первая страница limit 50, sortField __name, ascending, фильтр actual = true', async () => {
    await renderModal();

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledWith(account, 'spare_parts', {
      filter: ACTUAL_ONLY_FILTER,
      limit: 50,
      offset: 0,
      sortField: '__name',
      ascending: true,
    });
  });

  it('пока запрос в полёте — индикатор загрузки', async () => {
    mockedFetch.mockImplementation(() => new Promise(() => {}));
    const tree = await renderModal();

    expect(nodes(tree, 'spare-loading').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Поиск
// ---------------------------------------------------------------------------

describe('SparePartPickerModal — поиск', () => {
  it('debounce 600 мс: раньше времени запрос не уходит', async () => {
    const tree = await renderModal();
    mockedFetch.mockClear();

    await typeQuery(tree, 'Под');
    await advance(300);
    expect(mockedFetch).not.toHaveBeenCalled();

    await typeQuery(tree, 'Подш');
    await advance(300);
    expect(mockedFetch).not.toHaveBeenCalled();

    await advance(300);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('фильтр like по части слова (без масок) + actual = true и параметры limit/offset/sort', async () => {
    const tree = await renderModal();
    mockedFetch.mockClear();

    await typeQuery(tree, 'Под');
    await advance(600);

    expect(mockedFetch).toHaveBeenCalledWith(account, 'spare_parts', {
      filter: searchFilter('Под'),
      limit: 50,
      offset: 0,
      sortField: '__name',
      ascending: true,
    });
  });

  it('один символ: к серверу не обращаемся, показываем «Ничего не найдено»', async () => {
    const tree = await renderModal();
    mockedFetch.mockClear();

    await typeQuery(tree, 'А');
    await advance(600);

    expect(mockedFetch).not.toHaveBeenCalled();
    expect(renderedStrings(tree)).toContain('Ничего не найдено');
  });

  it('повторный тот же запрос берётся из кэша (без сети)', async () => {
    const tree = await renderModal();
    mockedFetch.mockClear();

    await typeQuery(tree, 'Под');
    await advance(600);
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    await typeQuery(tree, 'Подш');
    await advance(600);
    expect(mockedFetch).toHaveBeenCalledTimes(2);

    await typeQuery(tree, 'Под');
    await advance(600);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('ошибка сети: текст без автоматических повторов', async () => {
    mockedFetch.mockRejectedValue(new Error('network down'));
    const tree = await renderModal();

    expect(renderedStrings(tree)).toContain('Не удалось загрузить список запчастей');
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    await advance(5000);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Пагинация
// ---------------------------------------------------------------------------

describe('SparePartPickerModal — пагинация', () => {
  const firstPage = Array.from({length: 50}, (_, i) => ({
    __id: 'sp-' + i,
    __name: 'Запчасть ' + i,
  }));
  const secondPage = Array.from({length: 30}, (_, i) => ({
    __id: 'sp-' + (50 + i),
    __name: 'Запчасть ' + (50 + i),
  }));

  it('счётчик «Показано N из TOTAL»', async () => {
    mockedFetch.mockResolvedValue({items: firstPage, total: 8700});
    const tree = await renderModal();

    expect(renderedStrings(tree)).toContain('Показано 50 из 8700');
    expect(nodes(tree, 'spare-count').length).toBeGreaterThan(0);
  });

  it('total неизвестен: счётчик и «Показать ещё» не показываются', async () => {
    mockedFetch.mockResolvedValue({items: firstPage});
    const tree = await renderModal();

    expect(nodes(tree, 'spare-count')).toHaveLength(0);
    expect(nodes(tree, 'spare-more')).toHaveLength(0);
  });

  it('«Показать ещё»: offset = загружено, элементы добавляются, а не заменяются', async () => {
    mockedFetch
      .mockResolvedValueOnce({items: firstPage, total: 80})
      .mockResolvedValueOnce({items: secondPage, total: 80});
    const tree = await renderModal();

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(renderedStrings(tree)).toContain('Показано 50 из 80');
    expect(optionIds(tree)).toHaveLength(50);

    await press(firstWithPress(tree, 'spare-more'));

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(mockedFetch.mock.calls[1][2]).toEqual({
      filter: ACTUAL_ONLY_FILTER,
      limit: 50,
      offset: 50,
      sortField: '__name',
      ascending: true,
    });

    const ids = optionIds(tree);
    expect(ids).toHaveLength(80);
    expect(ids).toContain('spare-option-sp-0');
    expect(ids).toContain('spare-option-sp-79');
    expect(renderedStrings(tree)).toContain('Показано 80 из 80');

    // Всё загружено — кнопки «Показать ещё» больше нет.
    expect(nodes(tree, 'spare-more')).toHaveLength(0);
  });

  it('догрузка сохраняется в кэш: возврат к запросу без сети', async () => {
    mockedFetch.mockResolvedValue({items: firstPage, total: 80});
    const tree = await renderModal();
    mockedFetch.mockClear();

    await typeQuery(tree, 'Под');
    await advance(600);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    mockedFetch.mockResolvedValue({items: secondPage, total: 80});

    await press(firstWithPress(tree, 'spare-more'));
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(optionIds(tree)).toHaveLength(80);

    // Уходим на другой запрос (идёт в сеть) и возвращаемся к «Под» —
    // кэш должен отдать уже догруженные 80 позиций без обращений к серверу.
    mockedFetch.mockClear();
    await typeQuery(tree, 'Подшипник');
    await advance(600);
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    mockedFetch.mockClear();
    await typeQuery(tree, 'Под');
    await advance(600);

    expect(mockedFetch).not.toHaveBeenCalled();
    expect(optionIds(tree)).toHaveLength(80);
    expect(renderedStrings(tree)).toContain('Показано 80 из 80');
  });
});

// ---------------------------------------------------------------------------
// Выбор запчасти и «Не найдено в списке»
// ---------------------------------------------------------------------------

describe('SparePartPickerModal — выбор запчасти', () => {
  it('пункт списка заполняет «Название» и запоминает id (submit не вызывается)', async () => {
    mockedFetch.mockResolvedValue({
      items: [
        {__id: 'sp-1', __name: 'Подшипник 6205'},
        {__id: 'sp-2', __name: 'Сальник'},
      ],
    });
    const tree = await renderModal();

    await press(firstWithPress(tree, 'spare-option-sp-1'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(findLabel(tree, 'Название').props.value).toBe('Подшипник 6205');
    // Название не редактируется вручную, пока галка снята
    expect(findLabel(tree, 'Название').props.editable).toBe(false);
  });

  it('галка скрывает поиск и список, «Название» становится ручным', async () => {
    mockedFetch.mockResolvedValue({
      items: [{__id: 'sp-1', __name: 'Подшипник 6205'}],
    });
    const tree = await renderModal();

    expect(nodes(tree, 'spare-search').length).toBeGreaterThan(0);
    expect(optionIds(tree)).toContain('spare-option-sp-1');

    await press(firstWithPress(tree, 'spare-not-found-checkbox'));

    expect(nodes(tree, 'spare-search')).toHaveLength(0);
    expect(optionIds(tree)).toHaveLength(0);
    expect(findLabel(tree, 'Название').props.editable).toBe(true);
  });

  it('закрытие/открытие модалки сбрасывает галку и все поля формы', async () => {
    const tree = await renderModal();
    await press(firstWithPress(tree, 'spare-not-found-checkbox'));
    await typeInto(tree, 'spare-name', 'Тест');
    await typeInto(tree, 'spare-price', '9.99');
    expect(findLabel(tree, 'Название').props.value).toBe('Тест');

    await act(async () => {
      tree.update(<PaperProvider>{modalProps(false)}</PaperProvider>);
      await Promise.resolve();
    });
    await act(async () => {
      tree.update(<PaperProvider>{modalProps(true)}</PaperProvider>);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(nodes(tree, 'spare-search').length).toBeGreaterThan(0);
    expect(optionIds(tree)).toHaveLength(0);

    const checkbox = nodes(tree, 'spare-not-found-checkbox').find(n => n.props.status);
    expect(checkbox).toBeTruthy();
    expect(checkbox!.props.status).toBe('unchecked');

    expect(findLabel(tree, 'Название').props.value).toBe('');
    expect(findLabel(tree, 'Цена за единицу').props.value).toBe('');
    expect(findLabel(tree, 'Количество').props.value).toBe('');
    expect(validationError(tree)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Валидация saveUsedSP и отправка строки
// ---------------------------------------------------------------------------

describe('SparePartPickerModal — валидация и submit', () => {
  it('пустая форма: ошибка «Заполнены не все данные для записи в таблицу», submit не вызван', async () => {
    const tree = await renderModal();

    await press(submitNode(tree));

    const [message] = validationError(tree);
    expect(message).toContain('Заполнены не все данные для записи в таблицу');
    expect(message).toContain('принадлежность');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('нет принадлежности — ошибка; выбрали принадлежность — строка уходит', async () => {
    mockedFetch.mockResolvedValue({
      items: [{__id: 'sp-1', __name: 'Подшипник 6205'}],
    });
    const tree = await renderModal();

    await press(firstWithPress(tree, 'spare-option-sp-1'));
    await fillWithoutAffiliation(tree);
    await press(submitNode(tree));

    const [message] = validationError(tree);
    expect(message).toContain('Заполнены не все данные для записи в таблицу');
    expect(message).toContain('принадлежность');
    expect(onSubmit).not.toHaveBeenCalled();

    await press(firstWithPress(tree, 'spare-affiliation-service_center'));
    expect(validationError(tree)).toHaveLength(0);

    await press(submitNode(tree));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      nameOfSpareParts: 'Подшипник 6205',
      sparePartId: 'sp-1',
      affiliation: 'service_center',
      count: 1,
      price: 4.46,
      plannedDeliveryDate: '2026-09-26T00:00:00.000Z',
    });
  });

  it('нет названия/запчасти — ошибка', async () => {
    const tree = await renderModal();

    await press(firstWithPress(tree, 'spare-affiliation-service_center'));
    await fillWithoutAffiliation(tree);
    await press(submitNode(tree));

    expect(validationError(tree)).toHaveLength(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('нет цены, количества или даты доставки — ошибка', async () => {
    mockedFetch.mockResolvedValue({
      items: [{__id: 'sp-1', __name: 'Подшипник 6205'}],
    });

    // Нет цены
    let tree = await renderModal();
    await press(firstWithPress(tree, 'spare-option-sp-1'));
    await press(firstWithPress(tree, 'spare-affiliation-service_center'));
    await typeInto(tree, 'spare-quantity', '1');
    await pickDate(tree, new Date(2026, 8, 26));
    await press(submitNode(tree));
    expect(validationError(tree)).toHaveLength(1);
    expect(onSubmit).not.toHaveBeenCalled();

    // Нет количества
    tree = await renderModal();
    await press(firstWithPress(tree, 'spare-option-sp-1'));
    await press(firstWithPress(tree, 'spare-affiliation-service_center'));
    await typeInto(tree, 'spare-price', '4.46');
    await pickDate(tree, new Date(2026, 8, 26));
    await press(submitNode(tree));
    expect(validationError(tree)).toHaveLength(1);
    expect(onSubmit).not.toHaveBeenCalled();

    // Нет даты доставки
    tree = await renderModal();
    await press(firstWithPress(tree, 'spare-option-sp-1'));
    await press(firstWithPress(tree, 'spare-affiliation-service_center'));
    await typeInto(tree, 'spare-price', '4.46');
    await typeInto(tree, 'spare-quantity', '1');
    await press(submitNode(tree));
    expect(validationError(tree)).toHaveLength(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('«Восстановление запчасти» → affiliation: recovery', async () => {
    mockedFetch.mockResolvedValue({
      items: [{__id: 'sp-1', __name: 'Сальник'}],
    });
    const tree = await renderModal();

    await press(firstWithPress(tree, 'spare-option-sp-1'));
    await press(firstWithPress(tree, 'spare-affiliation-spare_part_restoration'));
    await typeInto(tree, 'spare-price', '2.50');
    await typeInto(tree, 'spare-quantity', '3');
    await pickDate(tree, new Date(2026, 9, 1));

    await press(submitNode(tree));

    expect(onSubmit).toHaveBeenCalledWith({
      nameOfSpareParts: 'Сальник',
      sparePartId: 'sp-1',
      affiliation: 'recovery',
      count: 3,
      price: 2.5,
      plannedDeliveryDate: '2026-10-01T00:00:00.000Z',
    });
  });

  it('галка «Не найдено в списке»: ручное название, без sparePartId', async () => {
    const tree = await renderModal();

    await press(firstWithPress(tree, 'spare-not-found-checkbox'));
    await typeInto(tree, 'spare-name', '  Ремкомплект  ');
    await press(firstWithPress(tree, 'spare-affiliation-service_center'));
    await typeInto(tree, 'spare-price', '12.345');
    await typeInto(tree, 'spare-quantity', '2');
    await pickDate(tree, new Date(2026, 8, 26));

    await press(submitNode(tree));

    expect(validationError(tree)).toHaveLength(0);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const row = onSubmit.mock.calls[0][0] as SparePartRow;
    expect(row.nameOfSpareParts).toBe('Ремкомплект');
    expect(row.sparePartId).toBeUndefined();
    expect(row.affiliation).toBe('service_center');
    expect(row.count).toBe(2);
    // цена округляется до 2 знаков
    expect(row.price).toBe(12.35);
    expect(row.plannedDeliveryDate).toBe('2026-09-26T00:00:00.000Z');
  });

  it('цена и количество с запятой принимаются (русская раскладка)', async () => {
    const tree = await renderModal();

    await press(firstWithPress(tree, 'spare-not-found-checkbox'));
    await typeInto(tree, 'spare-name', 'Уплотнитель');
    await press(firstWithPress(tree, 'spare-affiliation-service_center'));
    await typeInto(tree, 'spare-price', '4,46');
    await typeInto(tree, 'spare-quantity', '2');
    await pickDate(tree, new Date(2026, 8, 26));

    await press(submitNode(tree));

    expect(validationError(tree)).toHaveLength(0);
    const row = onSubmit.mock.calls[0][0] as SparePartRow;
    expect(row.price).toBe(4.46);
    expect(row.count).toBe(2);
  });
});
