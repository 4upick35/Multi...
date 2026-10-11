import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getCachedAcceptTemplate,
  setCachedAcceptTemplate,
  clearAcceptTemplates,
  clearAcceptTemplatesForAccount,
} from '../../src/services/accept-template-cache';
import {STORAGE_KEYS} from '../../src/config/constants';
import type {AcceptTemplate} from '../../src/services/elma-api';

const ACCOUNT_1 = 'acc-1';
const ACCOUNT_2 = 'acc-2';

const makeTemplate = (id: string, version: number): AcceptTemplate => ({
  templateId: id,
  templateVersion: version,
  formCode: `form_${id}`,
  formVersion: version,
  contextFields: [{code: 'field1', type: 'STRING'}],
});

async function readStoredCache(): Promise<Record<string, AcceptTemplate>> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.acceptTemplates);
  return raw ? JSON.parse(raw) : {};
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await clearAcceptTemplates();
});

describe('accept-template-cache', () => {
  it('сохранение + чтение в рамках сессии', async () => {
    const tmpl = makeTemplate('tmpl-1', 5);
    await setCachedAcceptTemplate(ACCOUNT_1, tmpl);

    const result = await getCachedAcceptTemplate(ACCOUNT_1);
    expect(result).toEqual(tmpl);
  });

  it('чтение из пустого storage → null', async () => {
    const result = await getCachedAcceptTemplate(ACCOUNT_1);
    expect(result).toBeNull();
  });

  it('clearAcceptTemplates очищает кэш полностью', async () => {
    await setCachedAcceptTemplate(ACCOUNT_1, makeTemplate('a', 1));
    await setCachedAcceptTemplate(ACCOUNT_2, makeTemplate('b', 2));

    await clearAcceptTemplates();

    expect(await getCachedAcceptTemplate(ACCOUNT_1)).toBeNull();
    expect(await getCachedAcceptTemplate(ACCOUNT_2)).toBeNull();
  });

  it('(а) два аккаунта изолированы: чтение/запись по accountId не мешают друг другу', async () => {
    const t1 = makeTemplate('id-1', 1);
    const t2 = makeTemplate('id-2', 2);

    await setCachedAcceptTemplate(ACCOUNT_1, t1);
    await setCachedAcceptTemplate(ACCOUNT_2, t2);

    expect(await getCachedAcceptTemplate(ACCOUNT_1)).toEqual(t1);
    expect(await getCachedAcceptTemplate(ACCOUNT_2)).toEqual(t2);

    // Перезапись одного аккаунта не меняет второй
    const t1b = makeTemplate('id-1', 9);
    await setCachedAcceptTemplate(ACCOUNT_1, t1b);
    expect(await getCachedAcceptTemplate(ACCOUNT_1)).toEqual(t1b);
    expect(await getCachedAcceptTemplate(ACCOUNT_2)).toEqual(t2);
  });

  it('(б) clearAcceptTemplatesForAccount удаляет только свой аккаунт', async () => {
    const t1 = makeTemplate('id-1', 1);
    const t2 = makeTemplate('id-2', 2);
    await setCachedAcceptTemplate(ACCOUNT_1, t1);
    await setCachedAcceptTemplate(ACCOUNT_2, t2);

    await clearAcceptTemplatesForAccount(ACCOUNT_1);

    expect(await getCachedAcceptTemplate(ACCOUNT_1)).toBeNull();
    expect(await getCachedAcceptTemplate(ACCOUNT_2)).toEqual(t2);

    const stored = await readStoredCache();
    expect(Object.keys(stored)).toEqual([ACCOUNT_2]);
  });

  it('(б) удаление несуществующего аккаунта не трогает остальные', async () => {
    const t2 = makeTemplate('id-2', 2);
    await setCachedAcceptTemplate(ACCOUNT_2, t2);

    await clearAcceptTemplatesForAccount('acc-missing');

    expect(await getCachedAcceptTemplate(ACCOUNT_2)).toEqual(t2);
  });

  it('(в) легаси-записи с ключом-URL отбрасываются при загрузке, хранилище перезаписано', async () => {
    const legacy = makeTemplate('legacy', 1);
    const modern = makeTemplate('modern', 2);
    await AsyncStorage.setItem(
      STORAGE_KEYS.acceptTemplates,
      JSON.stringify({
        'https://elma1.example.com': legacy,
        'http://elma2.example.com': legacy,
        [ACCOUNT_1]: modern,
      }),
    );

    expect(await getCachedAcceptTemplate(ACCOUNT_1)).toEqual(modern);
    expect(await getCachedAcceptTemplate('https://elma1.example.com')).toBeNull();
    expect(await getCachedAcceptTemplate('http://elma2.example.com')).toBeNull();

    const stored = await readStoredCache();
    expect(Object.keys(stored)).toEqual([ACCOUNT_1]);
    expect(stored[ACCOUNT_1]).toEqual(modern);
  });
});
