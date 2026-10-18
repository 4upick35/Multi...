import {uuidv4, isUuid} from '../../src/utils/uuid';
import {canAccept} from '../../src/domain/application-rules';

describe('uuid v4', () => {
  it('генерирует строку длиной 36 символов', () => {
    const id = uuidv4();
    expect(id).toHaveLength(36);
  });

  it('соответствует формату xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx', () => {
    const uuid = uuidv4();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('генерирует уникальные значения', () => {
    const ids = new Set(Array.from({length: 100}, () => uuidv4()));
    expect(ids.size).toBe(100);
  });

  it('всегда имеет версию 4 в позиции 13', () => {
    for (let i = 0; i < 50; i++) {
      const uuid = uuidv4();
      expect(uuid[14]).toBe('4');
    }
  });
});

describe('isUuid', () => {
  it('true для корректного UUID (любая версия)', () => {
    expect(isUuid('2d8f3a10-6b4e-4f2a-9c3d-1a2b3c4d5e6f')).toBe(true);
    expect(isUuid('01a0a547-0db6-7030-a66a-314287718d94')).toBe(true);
    expect(isUuid('877fac69-f4d9-4745-80fd-5c3dbfc8b8dd')).toBe(true);
  });

  it('false для выдуманных exit-ключей и не-UUID значений', () => {
    expect(isUuid('submit')).toBe(false);
    expect(isUuid('complete')).toBe(false);
    expect(isUuid('exit-1')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid('2d8f3a10-6b4e-4f2a-9c3d')).toBe(false);
    expect(isUuid('2d8f3a106b4e4f2a9c3d1a2b3c4d5e6f')).toBe(false);
  });
});

describe('canAccept', () => {
  it('возвращает true когда все условия выполнены', () => {
    expect(canAccept({
      show_button_get_application: true,
      executor: [],
      __status: {status: 1},
    })).toBe(true);
  });

  it('возвращает false когда show_button_get_application = false', () => {
    expect(canAccept({
      show_button_get_application: false,
      executor: [],
      __status: {status: 1},
    })).toBe(false);
  });

  it('возвращает false когда executor не пустой', () => {
    expect(canAccept({
      show_button_get_application: true,
      executor: ['some-id'],
      __status: {status: 1},
    })).toBe(false);
  });

  it('возвращает false когда status != 1', () => {
    expect(canAccept({
      show_button_get_application: true,
      executor: [],
      __status: {status: 2},
    })).toBe(false);
  });

  it('возвращает false когда show_button_get_application отсутствует', () => {
    expect(canAccept({
      executor: [],
      __status: {status: 1},
    })).toBe(false);
  });

  it('возвращает true когда executor = undefined/null', () => {
    expect(canAccept({
      show_button_get_application: true,
      __status: {status: 1},
    })).toBe(true);
  });

  it('возвращает true когда __status — строка (толерантность)', () => {
    expect(canAccept({
      show_button_get_application: true,
      executor: [],
    })).toBe(true);
  });

  it('возвращает true когда show_button = "true" (строка)', () => {
    expect(canAccept({
      show_button_get_application: 'true',
      executor: [],
      __status: {status: 1},
    })).toBe(true);
  });
});
