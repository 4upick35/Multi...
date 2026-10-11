/**
 * ExecutionScreen — блок подтверждения визита рендерится ВСЕГДА.
 *
 * Регресс к багу: раньше блок показывался только когда
 * `needsVisitConfirmation(instance) && session_has_been_confirmed !== true`,
 * поэтому в форме «Выполнение работ» не было данных верификации визита
 * ни для уже подтверждённого визита, ни для процессов без фиксации визита.
 *
 * Проверяем:
 * - блок есть при подтверждённом визите (зелёный «Верифицирован»);
 * - блок есть когда процесс не требует фиксации визита;
 * - подтверждение визита не вызывает завершение задачи.
 *
 * Плюс блок «добавление запчасти»: «+ Добавить запчасть» открывает окно
 * «Добавить запчасть» с поиском по справочнику `spare_parts` (фильтр
 * `actual = true`), заполнение полей (название/принадлежность/цена/
 * количество/дата доставки) и «Сохранить» в этом окне добавляет строку
 * в таблицу; поле «Комментарий» в форме отсутствует.
 *
 * И блок «фото»: файл выгружается сразу при добавлении (uploadPhotoAndGetHash),
 * на сервер уходит только готовый hash, а ошибки/незавершённая выгрузка
 * блокируют отправку с Alert.
 *
 * Сетевые вызовы замоканы — реальных запросов к ELMA нет.
 *
 * Данные формы уходят ТОЛЬКО вместе с выходом
 * (`handleExitWithData` → `submitTaskWithData`) — отдельной кнопки
 * «Сохранить» на экране больше нет.
 *
 * И блок «instanceId»: запрос выхода передаёт id экземпляра,
 * прочитанный из `instance.__id` (без него сервер отвечает 400); если id нет
 * вообще — отправка блокируется Alert'ом.
 *
 * И список «Результат работ» (мультивыбор): выбор пункта сворачивает список,
 * выбранное значение остаётся в поле, список можно открыть снова.
 */

import React from 'react';
import {Alert} from 'react-native';
import renderer, {act, ReactTestRenderer} from 'react-test-renderer';
import type {TestInstance} from 'react-test-renderer';
import {PaperProvider, TextInput as PaperTextInput} from 'react-native-paper';
import {launchImageLibrary} from 'react-native-image-picker';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../src/native/KeepAlive', () => ({
  setSecureFlag: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../src/services/customer-service', () => ({
  loadCollection: jest.fn(() => Promise.resolve(undefined)),
}));
jest.mock('../../src/services/elma-api', () => {
  const actual = jest.requireActual('../../src/services/elma-api');
  return {
    ...actual,
    fetchTaskById: jest.fn(),
    submitTaskWithData: jest.fn(),
    uploadPhotoAndGetHash: jest.fn(),
    sendVisitConfirmationCode: jest.fn(),
    confirmVisit: jest.fn(),
    submitTask: jest.fn(),
    completeTaskByExit: jest.fn(),
    fetchCollectionItems: jest.fn(),
    fetchTaskTemplateExits: jest.fn(),
  };
});

import ExecutionScreen from '../../src/screens/tasks/ExecutionScreen';
import {useAuthStore} from '../../src/store/auth-store';
import {useCustomerServiceStore} from '../../src/store/customer-service-store';
import type {CollectionItem, CollectionKey} from '../../src/types/customer-service';
import {
  fetchTaskById,
  submitTaskWithData,
  uploadPhotoAndGetHash,
  sendVisitConfirmationCode,
  confirmVisit,
  submitTask,
  completeTaskByExit,
  fetchCollectionItems,
  fetchTaskTemplateExits,
} from '../../src/services/elma-api';

const mockedFetchTaskById = fetchTaskById as jest.Mock;
const mockedSubmitTaskWithData = submitTaskWithData as jest.Mock;
const mockedUploadPhoto = uploadPhotoAndGetHash as jest.Mock;
const mockedSend = sendVisitConfirmationCode as jest.Mock;
const mockedConfirm = confirmVisit as jest.Mock;
const mockedSubmit = submitTask as jest.Mock;
const mockedComplete = completeTaskByExit as jest.Mock;
const mockedFetchCollectionItems = fetchCollectionItems as jest.Mock;
const mockedFetchTemplateExits = fetchTaskTemplateExits as jest.Mock;

jest.useFakeTimers();
// Экран большой (форма + таблица ЗЧ + окно добавления), а каждый шаг прогоняется
// через act с прокруткой таймеров. При параллельном прогоне всего набора
// дефолтных 5 с не хватает — поднимаем лимит для этого файла.
jest.setTimeout(20000);

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
};

const instanceConfirmed = {
  do_need_to_record_session: true,
  session_has_been_confirmed: true,
};

const instanceNoVisit = {
  do_need_to_record_session: false,
  session_has_been_confirmed: false,
};

const instanceNeedsVisit = {
  do_need_to_record_session: true,
  session_has_been_confirmed: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({accounts: [account]});
  mockedSend.mockResolvedValue({ok: true, sendSmsLogs: 'SUCCESS: ', context: {}});
  mockedConfirm.mockResolvedValue({confirmed: true, instance: instanceConfirmed});
  mockedFetchCollectionItems.mockResolvedValue({items: []});
  // По умолчанию выходов нет — конкретные списки задаются в тестах действий.
  mockedFetchTemplateExits.mockResolvedValue([]);
  mockedSubmitTaskWithData.mockResolvedValue({ok: true});
});

/** id экземпляра в ответе `GET /api/bpm/tasks/{uuid}` — лежит в `instance.__id`. */
const TASK_INSTANCE_UUID = 'b7c9f1d2-3a4e-4f6b-8c0d-1e2f3a4b5c6d';

async function renderScreen(
  instance: Record<string, unknown>,
  taskOverrides: Record<string, unknown> = {},
): Promise<ReactTestRenderer> {
  mockedFetchTaskById.mockResolvedValue({
    task: {
      id: 'task-1',
      instanceId: 'inst-1',
      instance: {...instance, __id: TASK_INSTANCE_UUID},
      ...taskOverrides,
    },
  });

  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <PaperProvider>
        <ExecutionScreen
          taskId="task-1"
          accountId={account.id}
          taskUuid="task-uuid-1"
          onBack={jest.fn()}
        />
      </PaperProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  // Догрузка выходов задачи идёт асинхронно — доводим её до конца внутри act,
  // иначе состояние обновляется вне act и тесты становятся нестабильными.
  await flush(tree);
  return tree;
}

function findButton(tree: ReactTestRenderer, label: string) {
  return tree.root.findAll(
    n => n.props.children === label && typeof n.props.disabled === 'boolean',
  )[0];
}

function findLabel(tree: ReactTestRenderer, label: string) {
  return tree.root.findAll(n => n.props.label === label)[0];
}

function renderedStrings(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAll(n => typeof n.props.children === 'string')
    .map(n => n.props.children as string);
}

describe('ExecutionScreen — блок подтверждения визита рендерится всегда', () => {
  it('визит уже подтверждён: блок есть, показан «Верифицирован»', async () => {
    const tree = await renderScreen(instanceConfirmed);

    const texts = renderedStrings(tree);
    expect(texts).toContain('Подтверждение визита');
    expect(texts).toContain('Верифицирован');

    const sendBtn = findButton(tree, 'Отправить код клиенту');
    expect(sendBtn).toBeTruthy();
    expect(sendBtn.props.disabled).toBe(true);

    expect(findLabel(tree, 'Введите код из СМС')).toBeUndefined();
    expect(texts).not.toContain('Продолжить');
  });

  it('процесс не требует фиксации визита: блок всё равно рендерится с формой', async () => {
    const tree = await renderScreen(instanceNoVisit);

    const texts = renderedStrings(tree);
    expect(texts).toContain('Подтверждение визита');
    expect(findButton(tree, 'Отправить код клиенту')).toBeTruthy();
    expect(findLabel(tree, 'Введите код из СМС')).toBeTruthy();
    expect(texts).not.toContain('Верифицирован');
  });

  it('визит не подтверждён: блок с формой без «Верифицирован»', async () => {
    const tree = await renderScreen(instanceNeedsVisit);

    const texts = renderedStrings(tree);
    expect(texts).toContain('Подтверждение визита');
    expect(findLabel(tree, 'Введите код из СМС')).toBeTruthy();
    expect(texts).not.toContain('Верифицирован');
  });

  it('подтверждение визита не завершает задачу и вызывает только перечитку', async () => {
    const tree = await renderScreen(instanceNeedsVisit);

    const codeInput = findLabel(tree, 'Введите код из СМС');
    await act(async () => {
      codeInput.props.onChangeText('1234');
    });

    const confirmBtn = findButton(tree, 'Подтвердить визит');
    await act(async () => {
      await confirmBtn.props.onPress();
    });

    expect(mockedConfirm).toHaveBeenCalledTimes(1);
    expect(renderedStrings(tree)).toContain('Верифицирован');
    expect(renderedStrings(tree)).not.toContain('Продолжить');

    expect(mockedSubmit).not.toHaveBeenCalled();
    expect(mockedComplete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Запчасти: добавление через модалку выбора из справочника `spare_parts`
// ---------------------------------------------------------------------------

function findPressable(tree: ReactTestRenderer, label: string) {
  const found = tree.root.findAll(
    n => n.props.children === label && typeof n.props.onPress === 'function',
  )[0];
  expect(found).toBeTruthy();
  return found;
}

/** Инпуты paper-TextInput с нужной подписью (ровно один экземпляр на строку). */
function findLabels(tree: ReactTestRenderer, label: string) {
  return tree.root
    .findAllByType(PaperTextInput)
    .filter(n => n.props.label === label);
}

function findTestId(tree: ReactTestRenderer, testID: string) {
  return tree.root.findAll(n => n.props.testID === testID);
}

async function flush(_tree: ReactTestRenderer) {
  await act(async () => {
    for (let i = 0; i < 50; i++) {
      await Promise.resolve();
    }
  });
}

/** Фильтр списка запчастей: только актуальные позиции. */
const ACTUAL_ONLY_FILTER = {and: [{eq: [{field: 'actual'}, {const: true}]}]};

/** Нажать элемент по testID с onPress. */
async function pressTestId(tree: ReactTestRenderer, testID: string) {
  const node = findTestId(tree, testID).find(
    n => typeof n.props.onPress === 'function',
  );
  expect(node).toBeTruthy();
  await act(async () => {
    await node!.props.onPress();
    await Promise.resolve();
  });
  await flush(tree);
}

/** Ввести текст в paper-TextInput с нужным testID. */
async function typeInto(tree: ReactTestRenderer, testID: string, text: string) {
  const node = findTestId(tree, testID).find(
    n => typeof n.props.onChangeText === 'function',
  );
  expect(node).toBeTruthy();
  await act(async () => {
    node!.props.onChangeText(text);
  });
  await flush(tree);
}

/** Выбрать «Планируемую дату доставки» в окне добавления ЗЧ. */
async function pickDeliveryDate(tree: ReactTestRenderer, date: Date) {
  await pressTestId(tree, 'spare-delivery-date');
  const pickers = tree.root.findAll(n => n.type === 'DateTimePicker');
  expect(pickers.length).toBeGreaterThan(0);
  await act(async () => {
    pickers[0].props.onChange({type: 'set'}, date);
    await Promise.resolve();
    await Promise.resolve();
  });
  await flush(tree);
}

/** Прокрутить таймеры, чтобы доигралась анимация скрытия модального окна. */
async function settle(tree: ReactTestRenderer) {
  await act(async () => {
    for (let i = 0; i < 20; i++) {
      jest.advanceTimersByTime(100);
      await Promise.resolve();
    }
  });
  await flush(tree);
}

/** Открыть окно добавления ЗЧ. */
async function openSpareModal(tree: ReactTestRenderer) {
  await act(async () => {
    await findPressable(tree, '+ Добавить запчасть').props.onPress();
  });
  await flush(tree);
}

/** Заполнить обязательные поля (кроме названия) и сохранить строку. */
async function submitSpareRow(tree: ReactTestRenderer, deliveryDate: Date) {
  await pressTestId(tree, 'spare-affiliation-service_center');
  await typeInto(tree, 'spare-price', '4.46');
  await typeInto(tree, 'spare-quantity', '2');
  await pickDeliveryDate(tree, deliveryDate);
  await pressTestId(tree, 'spare-submit');
  await settle(tree);
}

describe('ExecutionScreen — добавление запчасти из справочника', () => {
  it('«+ Добавить запчасть» открывает окно (пустой запрос → первая страница c actual = true)', async () => {
    const tree = await renderScreen(instanceNoVisit);
    expect(findTestId(tree, 'spare-search')).toHaveLength(0);

    await openSpareModal(tree);

    expect(findTestId(tree, 'spare-search').length).toBeGreaterThan(0);
    // Пустая строка НЕ добавляется — только открылось окно,
    // в таблице строк запчастей пока нет
    expect(findLabels(tree, 'Кол-во')).toHaveLength(0);

    expect(mockedFetchCollectionItems).toHaveBeenCalledTimes(1);
    const [, collection, params] = mockedFetchCollectionItems.mock.calls[0];
    expect(collection).toBe('spare_parts');
    expect(params).toEqual({
      filter: ACTUAL_ONLY_FILTER,
      limit: 50,
      offset: 0,
      sortField: '__name',
      ascending: true,
    });
  });

  it('выбор запчасти + заполнение формы добавляет строку в таблицу', async () => {
    mockedFetchCollectionItems.mockResolvedValue({
      items: [{__id: 'sp-1', __name: 'Подшипник 6205'}],
    });
    const tree = await renderScreen(instanceNoVisit);

    await openSpareModal(tree);

    // Выбор пункта заполняет «Название» и запоминает id — строка ещё не добавлена
    await pressTestId(tree, 'spare-option-sp-1');
    expect(findLabels(tree, 'Название')[0].props.value).toBe('Подшипник 6205');

    await submitSpareRow(tree, new Date(2026, 8, 26));

    // Окно закрылось, строка появилась в таблице
    expect(findTestId(tree, 'spare-search')).toHaveLength(0);

    const nameInputs = findLabels(tree, 'Название');
    expect(nameInputs).toHaveLength(1);
    expect(nameInputs[0].props.value).toBe('Подшипник 6205');
    expect(nameInputs[0].props.editable).toBe(false);

    const texts = renderedStrings(tree);
    expect(texts).toContain('Принадлежность: ЗЧ исполнителя');
    expect(texts).toContain('Сумма: 8.92');

    const countInputs = findLabels(tree, 'Кол-во');
    expect(countInputs).toHaveLength(1);
    expect(countInputs[0].props.value).toBe('2');
    expect(countInputs[0].props.editable).not.toBe(false);

    const priceInputs = findLabels(tree, 'Цена');
    expect(priceInputs).toHaveLength(1);
    expect(priceInputs[0].props.value).toBe('4.46');

    const dateInputs = findLabels(tree, 'Планируемая дата доставки');
    expect(dateInputs).toHaveLength(1);
    expect(dateInputs[0].props.editable).toBe(false);
    expect(dateInputs[0].props.value).toBe(
      new Date('2026-09-26T00:00:00.000Z').toLocaleDateString('ru'),
    );
  });

  it('галка «Не найдено в списке»: ручное название попадает в строку', async () => {
    const tree = await renderScreen(instanceNoVisit);

    await openSpareModal(tree);
    await pressTestId(tree, 'spare-not-found-checkbox');

    // Список и поиск скрыты, показан ручной ввод
    expect(findTestId(tree, 'spare-search')).toHaveLength(0);
    await typeInto(tree, 'spare-name', 'Ремкомплект');

    await submitSpareRow(tree, new Date(2026, 8, 26));

    const nameInputs = findLabels(tree, 'Название');
    expect(nameInputs).toHaveLength(1);
    expect(nameInputs[0].props.value).toBe('Ремкомплект');
    // Название не редактируется в таблице — оно вводится в окне
    expect(nameInputs[0].props.editable).toBe(false);
    expect(renderedStrings(tree)).toContain('Принадлежность: ЗЧ исполнителя');
  });

  it('выход «Готово» отправляет строку ЗЧ в новом формате и без comment_on_request', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockedFetchCollectionItems.mockResolvedValue({
      items: [{__id: 'sp-1', __name: 'Подшипник 6205'}],
    });

    try {
      const tree = await renderWithDoneExit(instanceNoVisit);

      await openSpareModal(tree);
      await pressTestId(tree, 'spare-option-sp-1');
      await submitSpareRow(tree, new Date(2026, 8, 26));

      await pressExitDone(tree);

      expect(mockedSubmitTaskWithData).toHaveBeenCalledTimes(1);
      const [passedAccount, params] = mockedSubmitTaskWithData.mock.calls[0] as [
        unknown,
        {
          taskUuid: string;
          instanceId: string;
          exitId: string;
          body: Record<string, unknown>;
          instance: Record<string, unknown>;
        },
      ];
      expect(passedAccount).toBe(account);
      expect(params.taskUuid).toBe('task-uuid-1');
      expect(params.exitId).toBe(EXIT_DONE);
      expect(params.instanceId).toBe(TASK_INSTANCE_UUID);

      const body = params.body;

      expect(body['comment_on_request']).toBeUndefined();
      expect(Object.keys(body)).not.toContain('comment_on_request');

      const spare = body['used_spare_parts_materials'] as {
        rows: Array<Record<string, unknown>>;
        result: {__count: number};
      };
      expect(spare.result.__count).toBe(1);
      const row = spare.rows[0];
      expect(Object.keys(row)).toEqual([
        'name_of_spare_parts',
        'name',
        'affiliation',
        'type_of_repair',
        'count',
        'price',
        'amount',
        'files',
        'planned_delivery_date',
        'agreed_price',
        '__index',
        '__id',
      ]);
      expect(row['name_of_spare_parts']).toBe('Подшипник 6205');
      expect(row['name']).toEqual(['sp-1']);
      expect(row['affiliation']).toEqual([
        {code: 'service_center', name: 'ЗЧ исполнителя', checked: false},
      ]);
      expect(row['type_of_repair']).toBeNull();
      expect(row['count']).toBe(2);
      expect(row['price']).toBe(4.46);
      expect(row['amount']).toBe(8.92);
      expect(row['files']).toEqual([]);
      expect(row['planned_delivery_date']).toBe('2026-09-26T00:00:00.000Z');
      expect(row['agreed_price']).toBeNull();
      expect(row['__index']).toBe(1);
      expect(row['__id']).toEqual(expect.any(String));
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('в форме нет поля «Комментарий»', async () => {
    const tree = await renderScreen(instanceNoVisit);

    expect(findLabel(tree, 'Комментарий')).toBeUndefined();
    expect(renderedStrings(tree)).not.toContain('Комментарий');
  });
});

// ---------------------------------------------------------------------------
// Фото: выгрузка сразу при добавлении, выход отправляет готовые hash
// ---------------------------------------------------------------------------

/** Заглушка FileReader: в RN нет `blob.arrayBuffer()`, readBlobBytes читает через FileReader. */
class FakeFileReader {
  result: unknown = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  readAsArrayBuffer(): void {
    this.result = new ArrayBuffer(8);
    this.onload?.();
  }
}

const mockedLaunchImageLibrary = launchImageLibrary as unknown as jest.Mock;
const originalFetch = global.fetch;

/** Найти host-элементы статуса файла по префиксу (`file-uploading-` / `file-error-`). */
function findStatusNodes(tree: ReactTestRenderer, prefix: string) {
  return tree.root.findAll(
    n =>
      typeof n.type === 'string' &&
      typeof n.props.testID === 'string' &&
      n.props.testID.startsWith(prefix),
  );
}

/** Нажать «+ Добавить фото» и выбрать снимок из галереи. */
async function addPhotoFromGallery(tree: ReactTestRenderer) {
  await act(async () => {
    await findPressable(tree, '+ Добавить фото').props.onPress();
  });

  await act(async () => {
    const alertMock = Alert.alert as unknown as jest.Mock;
    const call = alertMock.mock.calls.find(c => c[0] === 'Добавить фото');
    expect(call).toBeTruthy();
    const buttons = call![2] as Array<{text: string; onPress?: () => Promise<void>}>;
    const gallery = buttons.find(b => b.text === 'Галерея');
    expect(gallery).toBeTruthy();
    await gallery!.onPress!();
  });

  await flush(tree);
}

describe('ExecutionScreen — фото выгружаются сразу при добавлении', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    (global as unknown as {fetch: unknown}).fetch = jest
      .fn()
      .mockResolvedValue({blob: () => Promise.resolve({})});
    (global as unknown as {FileReader: unknown}).FileReader = FakeFileReader;
    mockedLaunchImageLibrary.mockResolvedValue({
      assets: [
        {uri: 'file:///photo.jpg', fileName: 'photo.jpg', fileSize: 123, type: 'image/jpeg'},
      ],
    });
  });

  afterEach(() => {
    alertSpy.mockRestore();
    (global as unknown as {fetch: unknown}).fetch = originalFetch;
    delete (global as unknown as {FileReader?: unknown}).FileReader;
  });

  it('добавление фото сразу вызывает uploadPhotoAndGetHash и переводит файл в статус «загружен»', async () => {
    mockedUploadPhoto.mockResolvedValue({ok: true, hash: 'hash-1'});
    const tree = await renderScreen(instanceNoVisit);

    await addPhotoFromGallery(tree);

    expect(mockedUploadPhoto).toHaveBeenCalledTimes(1);
    expect(mockedUploadPhoto).toHaveBeenCalledWith(
      account,
      'photo.jpg',
      expect.any(Uint8Array),
      'image/jpeg',
    );

    // статус «загружен»: индикаторов загрузки и ошибок нет, файл виден в списке
    expect(findStatusNodes(tree, 'file-uploading-')).toHaveLength(0);
    expect(findStatusNodes(tree, 'file-error-')).toHaveLength(0);
    expect(renderedStrings(tree)).toContain('photo.jpg');
  });

  it('выход «Готово» НЕ выгружает фото повторно и отправляет hash в теле', async () => {
    mockedUploadPhoto.mockResolvedValue({ok: true, hash: 'hash-42'});
    const tree = await renderWithDoneExit(instanceNoVisit);

    await addPhotoFromGallery(tree);
    expect(mockedUploadPhoto).toHaveBeenCalledTimes(1);

    await pressExitDone(tree);

    // повторной выгрузки нет
    expect(mockedUploadPhoto).toHaveBeenCalledTimes(1);

    expect(mockedSubmitTaskWithData).toHaveBeenCalledTimes(1);
    const params = mockedSubmitTaskWithData.mock.calls[0][1] as {
      body: {files_to_request?: Array<{id: string; name: string; hash: string; size: number}>};
    };
    expect(params.body.files_to_request).toHaveLength(1);
    expect(params.body.files_to_request![0]).toMatchObject({
      id: 'hash-42',
      name: 'photo.jpg',
      hash: 'hash-42',
      size: 123,
    });
  });

  it('фото в статусе ошибки — отправка с выходом блокируется с Alert', async () => {
    mockedUploadPhoto.mockResolvedValue({ok: false, error: 'server said no'});
    const tree = await renderWithDoneExit(instanceNoVisit);

    await addPhotoFromGallery(tree);

    const errorNodes = findStatusNodes(tree, 'file-error-');
    expect(errorNodes).toHaveLength(1);
    expect(renderedStrings(tree)).toContain('Ошибка загрузки: server said no');

    await pressExitDone(tree);

    expect(mockedSubmitTaskWithData).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      'Ошибка',
      'Не удалось загрузить фото «photo.jpg». Удалите его и добавьте заново.',
    );
  });

  it('фото ещё грузится — отправка с выходом блокируется с Alert', async () => {
    mockedUploadPhoto.mockImplementation(() => new Promise(() => undefined));
    const tree = await renderWithDoneExit(instanceNoVisit);

    await addPhotoFromGallery(tree);

    expect(findStatusNodes(tree, 'file-uploading-')).toHaveLength(1);
    expect(renderedStrings(tree)).toContain('Загрузка…');

    await pressExitDone(tree);

    expect(mockedSubmitTaskWithData).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Подождите', 'Фото ещё загружаются');
  });
});

// ---------------------------------------------------------------------------
// instanceId: в запрос выхода уходит id экземпляра из instance.__id
// (иначе сервер даёт 400)
// ---------------------------------------------------------------------------

describe('ExecutionScreen — instanceId запроса выхода', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('выход «Готово» вызывает submitTaskWithData с instanceId из instance.__id задачи', async () => {
    const tree = await renderWithDoneExit(instanceNoVisit);

    await act(async () => {
      findLabel(tree, 'Серийный номер').props.onChangeText('SN-123');
    });
    await flush(tree);

    await pressExitDone(tree);

    expect(mockedSubmitTaskWithData).toHaveBeenCalledTimes(1);
    const [passedAccount, params] = mockedSubmitTaskWithData.mock.calls[0] as [
      unknown,
      {
        taskUuid: string;
        instanceId: string;
        exitId: string;
        body: Record<string, unknown>;
        instance: Record<string, unknown>;
      },
    ];
    expect(passedAccount).toBe(account);
    expect(params.taskUuid).toBe('task-uuid-1');
    expect(params.exitId).toBe(EXIT_DONE);

    // id экземпляра идёт ОТДЕЛЬНЫМ полем params рядом с телом формы.
    expect(params.instanceId).toBe(TASK_INSTANCE_UUID);
    expect(params.instance).toMatchObject({__id: TASK_INSTANCE_UUID});
    expect(params.body['sn_of_technology']).toBe('SN-123');
  });

  it('в задаче нет ни instance.__id, ни instanceId: отправка блокируется с Alert', async () => {
    const tree = await renderWithDoneExit(instanceNoVisit, {
      instance: instanceNoVisit,
      instanceId: undefined,
    });

    await act(async () => {
      findLabel(tree, 'Серийный номер').props.onChangeText('SN-123');
    });
    await flush(tree);

    await pressExitDone(tree);

    expect(mockedSubmitTaskWithData).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      'Ошибка',
      'Не удалось определить заявку. Вернитесь к списку задач и откройте задачу заново.',
    );
  });
});

// ---------------------------------------------------------------------------
// Действия по заявке: кнопки выходов берутся ТОЛЬКО из шаблона процесса
// (fetchTaskTemplateExits) и отправляют данные ОДНИМ PUT — как кнопка-выход
// в веб-клиенте ELMA (HAR23). Серверный getexits в этот блок не используется.
// ---------------------------------------------------------------------------

/** Выход «Готово» (шаблон v30, узел 2df706a0) — обязательных полей нет. */
const EXIT_DONE = 'eb83ef3d-0526-487f-9c50-17e00d162c82';
/** Выход «Отказ от выполнения» — обязательные поля формы. */
const EXIT_REFUSE = 'b40cd460-f96e-4117-a0e9-343dd7abe482';
/** Выход «Подтвердить визит» — выполняется через VisitConfirmationBlock. */
const EXIT_CONFIRM = '877fac69-f4d9-4745-80fd-5c3dbfc8b8dd';

/** Координаты шаблона и узла: без них проверка выходов идёт fail closed. */
const TASK_TEMPLATE = {
  templateNsAndCode: 'customer_service.applications:execution_of_field_applications',
  path: '/items/2df706a0-c078-4a96-82f3-782c1aa9120d',
};

/**
 * Отрендерить экран с доступным выходом «Готово»: данные формы уходят
 * ТОЛЬКО вместе с выходом (`handleExitWithData` → `submitTaskWithData`).
 */
async function renderWithDoneExit(
  instance: Record<string, unknown>,
  taskOverrides: Record<string, unknown> = {},
): Promise<ReactTestRenderer> {
  mockedFetchTemplateExits.mockResolvedValue([
    {id: EXIT_DONE, name: 'Готово', formFields: []},
  ]);
  return renderScreen(instance, {...TASK_TEMPLATE, ...taskOverrides});
}

/** Нажать кнопку выхода «Готово» и доиграть асинхронные обновления. */
async function pressExitDone(tree: ReactTestRenderer) {
  const exitBtn = findTestId(tree, 'exit-' + EXIT_DONE).find(
    n => typeof n.props.onPress === 'function',
  );
  expect(exitBtn).toBeTruthy();
  await act(async () => {
    await exitBtn!.props.onPress();
  });
  await flush(tree);
}

describe('ExecutionScreen — кнопки выходов отправляют данные формы', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    (global as unknown as {fetch: unknown}).fetch = jest
      .fn()
      .mockResolvedValue({blob: () => Promise.resolve({})});
    (global as unknown as {FileReader: unknown}).FileReader = FakeFileReader;
    mockedLaunchImageLibrary.mockResolvedValue({
      assets: [
        {uri: 'file:///photo.jpg', fileName: 'photo.jpg', fileSize: 123, type: 'image/jpeg'},
      ],
    });
    mockedUploadPhoto.mockResolvedValue({ok: true, hash: 'hash-77'});
    mockedFetchTemplateExits.mockResolvedValue([
      {id: EXIT_DONE, name: 'Готово', formFields: []},
      {
        id: EXIT_REFUSE,
        name: 'Отказ от выполнения',
        formFields: [{code: 'reason_of_refuse', title: 'Причина отказа', required: true}],
      },
      {id: EXIT_CONFIRM, name: 'Подтвердить визит', formFields: []},
    ]);
    mockedSubmitTaskWithData.mockResolvedValue({ok: true});
  });

  afterEach(() => {
    alertSpy.mockRestore();
    (global as unknown as {fetch: unknown}).fetch = originalFetch;
    delete (global as unknown as {FileReader?: unknown}).FileReader;
  });

  it('кнопка «Готово» отрисована и отправляет данные формы + выход ОДНИМ запросом', async () => {
    const tree = await renderScreen(instanceNoVisit, TASK_TEMPLATE);
    await flush(tree);

    expect(findTestId(tree, 'exit-' + EXIT_DONE).length).toBeGreaterThan(0);

    // Данные формы: поле + фото (files_to_request)
    await act(async () => {
      findLabel(tree, 'Серийный номер').props.onChangeText('SN-777');
    });
    await flush(tree);
    await addPhotoFromGallery(tree);

    // Кнопку ищем ПОСЛЕ обновления состояния — колбэк иначе возьмёт старые данные.
    const exitBtn = findTestId(tree, 'exit-' + EXIT_DONE).find(
      n => typeof n.props.onPress === 'function',
    );
    expect(exitBtn).toBeTruthy();

    await act(async () => {
      await exitBtn!.props.onPress();
    });
    await flush(tree);

    expect(mockedSubmitTaskWithData).toHaveBeenCalledTimes(1);
    const [passedAccount, params] = mockedSubmitTaskWithData.mock.calls[0] as [
      unknown,
      {taskUuid: string; instanceId: string; exitId: string; body: Record<string, unknown>},
    ];
    expect(passedAccount).toBe(account);
    expect(params.taskUuid).toBe('task-uuid-1');
    expect(params.instanceId).toBe(TASK_INSTANCE_UUID);
    expect(params.exitId).toBe(EXIT_DONE);

    expect(params.body['sn_of_technology']).toBe('SN-777');
    const filesToRequest = params.body['files_to_request'] as Array<Record<string, unknown>>;
    expect(filesToRequest).toHaveLength(1);
    expect(filesToRequest[0]).toMatchObject({
      id: 'hash-77',
      name: 'photo.jpg',
      hash: 'hash-77',
      size: 123,
    });

    // Данные формы ушли только вместе с выходом — отдельной отправки нет.
    expect(alertSpy).toHaveBeenCalledWith('Готово', 'Действие выполнено');
  });

  it('«Без подтверждения визита» на сервере (HAR24): выход «Готово» доступен, причина предзаполнена', async () => {
    const tree = await renderScreen(
      {
        do_need_to_record_session: true,
        session_has_been_confirmed: false,
        without_session_confirmation: true,
        reason_for_lack_of_confirmation: 'Клиента нет дома',
      },
      TASK_TEMPLATE,
    );
    await flush(tree);

    // Кнопка выхода «Готово» не заблокирована — код из СМС не нужен.
    const exitNodes = findTestId(tree, 'exit-' + EXIT_DONE);
    expect(exitNodes.length).toBeGreaterThan(0);
    const exitBtn = exitNodes.find(
      n => typeof n.props.onPress === 'function' && typeof n.props.disabled === 'boolean',
    );
    expect(exitBtn).toBeTruthy();
    expect(exitBtn!.props.disabled).toBe(false);

    // Причина мастера предзаполнена в блоке подтверждения визита.
    const reason = findLabel(tree, 'Причина отсутствия подтверждения');
    expect(reason).toBeTruthy();
    expect(reason.props.value).toBe('Клиента нет дома');
  });

  it('шаблон не загрузился (null): кнопок выходов нет — fail closed, есть повторная проверка', async () => {
    mockedFetchTemplateExits.mockResolvedValue(null);
    const tree = await renderScreen(instanceNoVisit, TASK_TEMPLATE);
    await flush(tree);

    expect(findTestId(tree, 'exit-' + EXIT_DONE)).toHaveLength(0);
    expect(findTestId(tree, 'exit-' + EXIT_REFUSE)).toHaveLength(0);
    expect(findTestId(tree, 'exits-check-failed').length).toBeGreaterThan(0);
    expect(renderedStrings(tree)).toContain(
      'Не удалось проверить действия. Нажмите «Проверить ещё раз».',
    );

    // Выход не отправляется вслепую
    const exitBtn = findTestId(tree, 'exit-' + EXIT_DONE).find(
      n => typeof n.props.onPress === 'function',
    );
    expect(exitBtn).toBeUndefined();
    expect(mockedSubmitTaskWithData).not.toHaveBeenCalled();

    // Шаблон при ошибке не кэшируется — повторная проверка уходит заново.
    expect(mockedFetchTemplateExits).toHaveBeenCalledTimes(1);
    expect(findTestId(tree, 'exits-retry').length).toBeGreaterThan(0);
    await pressTestId(tree, 'exits-retry');
    expect(mockedFetchTemplateExits).toHaveBeenCalledTimes(2);
    expect(findTestId(tree, 'exits-check-failed').length).toBeGreaterThan(0);
    expect(findTestId(tree, 'exit-' + EXIT_DONE)).toHaveLength(0);
  });

  it('выход с обязательными полями и выход подтверждения визита кнопками не показываются', async () => {
    const tree = await renderScreen(instanceNoVisit, TASK_TEMPLATE);
    await flush(tree);

    expect(findTestId(tree, 'exit-' + EXIT_DONE).length).toBeGreaterThan(0);
    expect(findTestId(tree, 'exit-' + EXIT_REFUSE)).toHaveLength(0);
    expect(findTestId(tree, 'exit-' + EXIT_CONFIRM)).toHaveLength(0);

    const texts = renderedStrings(tree);
    expect(texts).not.toContain('Нет доступных действий');
    expect(texts).not.toContain('Отказ от выполнения');
    expect(mockedSubmitTaskWithData).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// «Результат работ» — мультивыбор: выбор пункта СВОРАЧИВАЕТ список,
// выбранное значение остаётся в поле, список можно открыть снова.
// ---------------------------------------------------------------------------

const RESULT_ONE: CollectionItem = {
  id: 'res-1',
  name: 'Ремонт выполнен',
  status: 'actual',
  createdAt: '2026-01-01',
  raw: {},
};

const RESULT_TWO: CollectionItem = {
  id: 'res-2',
  name: 'Замена узла',
  status: 'actual',
  createdAt: '2026-01-01',
  raw: {},
};

/** Ближайший предок узла с onPress — обёртка поля или пункт списка. */
function findPressableAncestor(node: TestInstance | null): TestInstance | null {
  let current = node ? node.parent : null;
  while (current && typeof current.props.onPress !== 'function') {
    current = current.parent;
  }
  return current;
}

/** Поле-триггер списка «Результат работ». */
function findResultsTrigger(tree: ReactTestRenderer): TestInstance {
  const trigger = findPressableAncestor(findLabel(tree, 'Выбрать результаты'));
  expect(trigger).toBeTruthy();
  return trigger!;
}

/** Открыть/закрыть список «Результат работ». */
async function toggleResultsPicker(tree: ReactTestRenderer) {
  const trigger = findResultsTrigger(tree);
  await act(async () => {
    await trigger.props.onPress();
  });
  await flush(tree);
}

/** Пункт списка по тексту — есть ТОЛЬКО пока список развёрнут. */
function findResultOption(tree: ReactTestRenderer, name: string): TestInstance | null {
  const trigger = findResultsTrigger(tree);
  const textNodes = tree.root.findAll(
    n => typeof n.props.children === 'string' && n.props.children === name,
  );
  for (const node of textNodes) {
    const pressable = findPressableAncestor(node);
    if (pressable && pressable !== trigger) {
      return pressable;
    }
  }
  return null;
}

describe('ExecutionScreen — «Результат работ»: выбор пункта сворачивает список', () => {
  beforeEach(() => {
    useCustomerServiceStore.setState({
      itemsByAccount: {
        [account.id]: {
          results_of_work: [RESULT_ONE, RESULT_TWO],
        } as Record<CollectionKey, CollectionItem>,
      },
    });
  });

  afterEach(() => {
    useCustomerServiceStore.setState({itemsByAccount: {}});
  });

  it('после выбора пункта список закрыт, значение остаётся в поле, можно выбрать ещё', async () => {
    const tree = await renderScreen(instanceNoVisit);

    // Список закрыт — пунктов в дереве нет
    expect(findLabel(tree, 'Выбрать результаты').props.value).toBe('');
    expect(findResultOption(tree, RESULT_ONE.name)).toBeNull();

    await toggleResultsPicker(tree);
    expect(findResultOption(tree, RESULT_ONE.name)).toBeTruthy();
    expect(findResultOption(tree, RESULT_TWO.name)).toBeTruthy();

    await act(async () => {
      await findResultOption(tree, RESULT_ONE.name)!.props.onPress();
    });
    await flush(tree);

    // Список свёрнут, выбранное значение осталось в поле
    expect(findResultOption(tree, RESULT_ONE.name)).toBeNull();
    expect(findResultOption(tree, RESULT_TWO.name)).toBeNull();
    expect(findLabel(tree, 'Выбрать результаты').props.value).toBe(RESULT_ONE.name);

    // Список открывается снова — мультивыбор работает
    await toggleResultsPicker(tree);
    expect(findResultOption(tree, RESULT_TWO.name)).toBeTruthy();

    await act(async () => {
      await findResultOption(tree, RESULT_TWO.name)!.props.onPress();
    });
    await flush(tree);

    expect(findResultOption(tree, RESULT_TWO.name)).toBeNull();
    expect(findLabel(tree, 'Выбрать результаты').props.value).toBe(
      RESULT_ONE.name + ', ' + RESULT_TWO.name,
    );
  });
});
