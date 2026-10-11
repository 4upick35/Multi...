/**
 * Окно «Добавить запчасть» — как на сайте (дескриптор формы
 * `form_d8f777cf…/19`, ViewContext).
 *
 * Сверху чекбокс «Не найдено в списке» (`not_found_in_list`): пока галка
 * снята — поиск + список из справочника `spare_parts` (EQL `like` по части
 * слова без масок + `actual = true`), выбор элемента заполняет «Название»
 * и запоминает id запчасти; при галке поиск и список скрыты, «Название»
 * вводится вручную. Ниже — принадлежность, цена, количество и планируемая
 * дата доставки. Кнопка «Сохранить» отдаёт готовую строку `SparePartRow`
 * (`affiliation_used.spare_part_restoration` → `recovery`).
 *
 * Антибан (правила проекта): запросы не уходят на каждое нажатие клавиши —
 * debounce 600 мс, серверный поиск только от 2 символов, limit 50,
 * догрузка только по явному нажатию «Показать ещё» (никаких автозагрузок
 * при прокрутке и авторетраев), кэш по запросу хранит `{items, total, at}`
 * с TTL 5 минут. Ошибка сети показывается текстом, повторов нет.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Button,
  Checkbox,
  Modal,
  Portal,
  Text,
  TextInput,
} from 'react-native-paper';
import QuantumLoader from '../components/QuantumLoader';
import DateTimePicker, {DateTimePickerEvent} from '@react-native-community/datetimepicker';
import {fetchCollectionItems} from '../services/elma-api';
import type {ElmaAccount} from '../types/account';
import type {SparePartRow} from '../utils/execution-form';
import {utcStartOfDayIso} from '../utils/execution-form';
import {useAppTheme} from '../theme';

type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

/** Значение поля `affiliation_used` формы добавления ЗЧ. */
type SiteAffiliation = 'service_center' | 'spare_part_restoration';

export type SparePartPickerModalProps = {
  visible: boolean;
  account: ElmaAccount;
  onCancel: () => void;
  onSubmit: (row: SparePartRow) => void;
};

type SpareOption = {id: string; name: string};

/** Кэш одного поискового запроса: список, total и момент загрузки. */
type CacheEntry = {items: SpareOption[]; total: number | null; at: number};

const DEBOUNCE_MS = 600;
const MIN_QUERY_LENGTH = 2;
const LIMIT = 50;
const CACHE_TTL_MS = 5 * 60 * 1000;

const NOT_FOUND_LABEL = 'Не найдено в списке';
const TITLE_LABEL = 'Добавить запчасть';
const SEARCH_LABEL = 'Поиск по названию';
const NAME_LABEL = 'Название';
const AFFILIATION_LABEL = 'Принадлежность';
const PRICE_LABEL = 'Цена за единицу';
const COUNT_LABEL = 'Количество';
const DELIVERY_LABEL = 'Планируемая дата доставки';
const SAVE_LABEL = 'Сохранить';
const CANCEL_LABEL = 'Отмена';
const MORE_LABEL = 'Показать ещё';
const ERROR_TEXT = 'Не удалось загрузить список запчастей';
const EMPTY_TEXT = 'Ничего не найдено';
const VALIDATION_TEXT = 'Заполнены не все данные для записи в таблицу';

/** Варианты «Принадлежность ЗЧ (Использованные)» из формы сайта. */
const AFFILIATION_OPTIONS: ReadonlyArray<{
  site: SiteAffiliation;
  label: string;
}> = [
  {site: 'service_center', label: 'ЗЧ исполнителя'},
  {site: 'spare_part_restoration', label: 'Восстановление запчасти'},
];

/** `affiliation_used` формы → принадлежность строки таблицы. */
function toRowAffiliation(site: SiteAffiliation): SparePartRow['affiliation'] {
  return site === 'spare_part_restoration' ? 'recovery' : 'service_center';
}

/** EQL-фильтр списка: подстрока по `__name` + только актуальные позиции. */
function buildNameFilter(text: string): unknown {
  const conditions: unknown[] = [{eq: [{field: 'actual'}, {const: true}]}];
  if (text) {
    conditions.unshift({like: [{field: '__name'}, {const: text}]});
  }
  return {and: conditions};
}

function toOption(raw: unknown, index: number): SpareOption | null {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = typeof obj.__name === 'string' ? obj.__name : '';
  if (!name.trim()) {
    return null;
  }
  const id = String(obj.__id ?? obj.id ?? '') || 'row-' + index;
  return {id, name};
}

function toOptions(rawItems: unknown[], startIndex = 0): SpareOption[] {
  const list: SpareOption[] = [];
  rawItems.forEach((raw, index) => {
    const option = toOption(raw, startIndex + index);
    if (option) {
      list.push(option);
    }
  });
  return list;
}

function toTotal(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Число из поля: пустая строка → null; запятая как разделитель дробной части принимается. */
function toNumber(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (!trimmed) {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function formatDate(date: Date | null): string {
  if (!date) {
    return '';
  }
  return date.toLocaleDateString('ru');
}

export default function SparePartPickerModal({
  visible,
  account,
  onCancel,
  onSubmit,
}: SparePartPickerModalProps) {
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SpareOption[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  // Поля формы добавления ЗЧ
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState('');
  const [sparePartId, setSparePartId] = useState<string | undefined>(undefined);
  const [affiliation, setAffiliation] = useState<SiteAffiliation | null>(null);
  const [priceText, setPriceText] = useState('');
  const [countText, setCountText] = useState('');
  const [deliveryDate, setDeliveryDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [validationError, setValidationError] = useState(false);

  const cacheRef = useRef(new Map<string, CacheEntry>());
  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedRef = useRef(false);

  const runSearch = useCallback(
    (raw: string) => {
      const text = raw.trim();
      // Слишком короткий запрос — запрос на сервер НЕ уходит.
      if (text.length > 0 && text.length < MIN_QUERY_LENGTH) {
        seqRef.current += 1;
        setItems([]);
        setTotal(null);
        setError(false);
        setLoading(false);
        return;
      }

      const key = text.toLowerCase();
      const cached = cacheRef.current.get(key);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        seqRef.current += 1;
        setItems(cached.items);
        setTotal(cached.total);
        setError(false);
        setLoading(false);
        return;
      }

      const seq = ++seqRef.current;
      setLoading(true);
      setError(false);
      fetchCollectionItems(account, 'spare_parts', {
        filter: buildNameFilter(text),
        limit: LIMIT,
        offset: 0,
        sortField: '__name',
        ascending: true,
      })
        .then(result => {
          if (seq !== seqRef.current) {
            return;
          }
          const list = toOptions(result.items);
          const nextTotal = toTotal(result.total);
          cacheRef.current.set(key, {items: list, total: nextTotal, at: Date.now()});
          setItems(list);
          setTotal(nextTotal);
          setError(false);
          setLoading(false);
        })
        .catch(() => {
          if (seq !== seqRef.current) {
            return;
          }
          setItems([]);
          setTotal(null);
          setError(true);
          setLoading(false);
        });
    },
    [account],
  );

  /** Догрузка следующей страницы: только по кнопке «Показать ещё». */
  const loadMore = useCallback(() => {
    if (loading || loadingMore) {
      return;
    }
    const text = query.trim();
    const key = text.toLowerCase();
    const offset = items.length;
    const seq = seqRef.current;

    setLoadingMore(true);
    setError(false);
    fetchCollectionItems(account, 'spare_parts', {
      filter: buildNameFilter(text),
      limit: LIMIT,
      offset,
      sortField: '__name',
      ascending: true,
    })
      .then(result => {
        if (seq === seqRef.current) {
          const more = toOptions(result.items, offset);
          const nextItems = [...items, ...more];
          const nextTotal = toTotal(result.total) ?? total;
          const cached = cacheRef.current.get(key);
          if (cached) {
            cacheRef.current.set(key, {...cached, items: nextItems, total: nextTotal});
          }
          setItems(nextItems);
          setTotal(nextTotal);
          setError(false);
        }
        setLoadingMore(false);
      })
      .catch(() => {
        if (seq === seqRef.current) {
          setError(true);
        }
        setLoadingMore(false);
      });
  }, [account, query, items, total, loading, loadingMore]);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!visible) {
      openedRef.current = false;
      return;
    }

    // Открытие модалки — сразу первая страница (или результат из кэша).
    if (!openedRef.current) {
      openedRef.current = true;
      runSearch(query);
      return;
    }

    // Ввод текста — debounce, чтобы не заваливать сервер.
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      runSearch(query);
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [visible, query, runSearch]);

  // Закрытие модалки — сбрасываем все поля формы и поиск.
  useEffect(() => {
    if (visible) {
      return;
    }
    setQuery('');
    setNotFound(false);
    setName('');
    setSparePartId(undefined);
    setAffiliation(null);
    setPriceText('');
    setCountText('');
    setDeliveryDate(null);
    setShowDatePicker(false);
    setValidationError(false);
  }, [visible]);

  const trimmed = query.trim();
  const showEmpty = !loading && !error && items.length === 0 && trimmed.length > 0;
  const showCount = total !== null;
  const showMore = !loading && !error && total !== null && items.length < total;

  const handleToggleNotFound = useCallback(() => {
    const next = !notFound;
    setNotFound(next);
    // При галке «Не найдено в списке» ссылка на справочник снимается.
    if (next) {
      setSparePartId(undefined);
    }
    setValidationError(false);
  }, [notFound]);

  const handlePickOption = useCallback((option: SpareOption) => {
    setName(option.name);
    setSparePartId(option.id);
    setValidationError(false);
  }, []);

  const handlePickDate = useCallback(
    (event: DateTimePickerEvent, date?: Date) => {
      const dismissed = Platform.OS === 'android' && event.type === 'dismissed';
      setShowDatePicker(false);
      if (date && !dismissed) {
        setDeliveryDate(date);
        setValidationError(false);
      }
    },
    [],
  );

  /** Чего не хватает в форме — показываем причину, иначе кажется, что кнопка не работает. */
  const missingFields = useCallback((): string[] => {
    const missing: string[] = [];
    const nameFilled = notFound ? !!name.trim() : !!sparePartId;
    if (!nameFilled) {
      missing.push(notFound ? 'название' : 'запчасть из списка');
    }
    const price = toNumber(priceText);
    if (price === null || price < 0) {
      missing.push('цену за единицу');
    }
    const count = toNumber(countText);
    if (count === null || count <= 0) {
      missing.push('количество');
    }
    if (affiliation === null) {
      missing.push('принадлежность');
    }
    if (deliveryDate === null) {
      missing.push('планируемую дату доставки');
    }
    return missing;
  }, [notFound, name, sparePartId, affiliation, priceText, countText, deliveryDate]);

  const handleSubmit = useCallback(() => {
    const missing = missingFields();
    if (missing.length > 0) {
      setValidationError(true);
      return;
    }
    const price = Math.round((toNumber(priceText) as number) * 100) / 100;
    const count = toNumber(countText) as number;
    setValidationError(false);
    onSubmit({
      nameOfSpareParts: name.trim(),
      sparePartId: notFound ? undefined : sparePartId,
      affiliation: toRowAffiliation(affiliation as SiteAffiliation),
      count,
      price,
      plannedDeliveryDate: utcStartOfDayIso(deliveryDate as Date),
    });
  }, [
    missingFields,
    name,
    notFound,
    sparePartId,
    affiliation,
    priceText,
    countText,
    deliveryDate,
    onSubmit,
  ]);

  const missing = validationError ? missingFields() : [];
  const validationMessage =
    missing.length > 0
      ? `${VALIDATION_TEXT}: укажите ${missing.join(', ')}.`
      : VALIDATION_TEXT;

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onCancel} contentContainerStyle={styles.modal}>
        <View style={styles.header}>
          <Text variant="titleMedium" style={styles.title}>
            {TITLE_LABEL}
          </Text>
        </View>

        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
          <Checkbox.Item
            testID="spare-not-found-checkbox"
            label={NOT_FOUND_LABEL}
            status={notFound ? 'checked' : 'unchecked'}
            onPress={handleToggleNotFound}
            position="leading"
            style={styles.checkboxRow}
            labelStyle={styles.checkboxLabel}
          />

          {!notFound ? (
            <>
              <TextInput
                testID="spare-search"
                mode="outlined"
                label={SEARCH_LABEL}
                placeholder={SEARCH_LABEL}
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
                style={styles.field}
              />

              {loading ? (
                <View style={styles.loader}>
                  <QuantumLoader size={20} color={colors.textSubtle} testID="spare-loading" />
                </View>
              ) : null}
              {error ? (
                <Text testID="spare-error" style={styles.error}>
                  {ERROR_TEXT}
                </Text>
              ) : null}
              {showEmpty ? (
                <Text testID="spare-empty" style={styles.empty}>
                  {EMPTY_TEXT}
                </Text>
              ) : null}
              {showCount ? (
                <Text testID="spare-count" style={styles.count}>
                  {`Показано ${items.length} из ${total}`}
                </Text>
              ) : null}

              <View style={styles.list}>
                {items.map(item => (
                  <TouchableOpacity
                    key={item.id}
                    testID={'spare-option-' + item.id}
                    style={styles.option}
                    onPress={() => handlePickOption(item)}>
                    <Text style={styles.optionText}>{item.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {showMore ? (
                <Button
                  mode="outlined"
                  compact
                  testID="spare-more"
                  onPress={loadMore}
                  loading={loadingMore}
                  disabled={loadingMore}
                  style={styles.moreButton}>
                  {MORE_LABEL}
                </Button>
              ) : null}
            </>
          ) : null}

          <TextInput
            testID="spare-name"
            mode="outlined"
            label={NAME_LABEL}
            placeholder={NAME_LABEL}
            value={name}
            editable={notFound}
            onChangeText={value => {
              setName(value);
              setValidationError(false);
            }}
            autoCorrect={false}
            style={styles.field}
          />

          <Text style={styles.sectionLabel}>{AFFILIATION_LABEL}</Text>
          <View style={styles.affiliationRow}>
            {AFFILIATION_OPTIONS.map(option => (
              <Button
                key={option.site}
                mode={affiliation === option.site ? 'contained' : 'outlined'}
                compact
                testID={'spare-affiliation-' + option.site}
                style={styles.affiliationButton}
                onPress={() => {
                  setAffiliation(option.site);
                  setValidationError(false);
                }}>
                {option.label}
              </Button>
            ))}
          </View>

          <TextInput
            testID="spare-price"
            mode="outlined"
            label={PRICE_LABEL}
            placeholder={PRICE_LABEL}
            value={priceText}
            onChangeText={value => {
              setPriceText(value);
              setValidationError(false);
            }}
            keyboardType="numeric"
            style={styles.field}
          />

          <TextInput
            testID="spare-quantity"
            mode="outlined"
            label={COUNT_LABEL}
            placeholder={COUNT_LABEL}
            value={countText}
            onChangeText={value => {
              setCountText(value);
              setValidationError(false);
            }}
            keyboardType="numeric"
            style={styles.field}
          />

          <TouchableOpacity
            testID="spare-delivery-date"
            onPress={() => setShowDatePicker(true)}>
            <TextInput
              mode="outlined"
              label={DELIVERY_LABEL}
              placeholder={DELIVERY_LABEL}
              value={formatDate(deliveryDate)}
              editable={false}
              right={
                <TextInput.Icon
                  icon="calendar"
                  onPress={() => setShowDatePicker(true)}
                />
              }
              style={styles.field}
            />
          </TouchableOpacity>
          {showDatePicker ? (
            <DateTimePicker
              value={deliveryDate || new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={handlePickDate}
            />
          ) : null}
        </ScrollView>

        {validationError ? (
          <Text testID="spare-validation-error" style={styles.validation}>
            {validationMessage}
          </Text>
        ) : null}

        <View style={styles.buttons}>
          <Button mode="outlined" onPress={onCancel} testID="spare-cancel">
            {CANCEL_LABEL}
          </Button>
          <Button mode="contained" onPress={handleSubmit} testID="spare-submit">
            {SAVE_LABEL}
          </Button>
        </View>
      </Modal>
    </Portal>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    modal: {
      backgroundColor: c.surface,
      margin: 16,
      padding: 16,
      borderRadius: 12,
      maxHeight: '85%',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginBottom: 12,
    },
    title: {fontWeight: '600', color: c.textPrimary},
    scroll: {maxHeight: 460},
    checkboxRow: {paddingHorizontal: 0, paddingVertical: 4, marginBottom: 8},
    checkboxLabel: {color: c.textPrimary, fontSize: 14},
    field: {marginBottom: 10},
    loader: {alignSelf: 'center', marginVertical: 8},
    error: {color: c.error, textAlign: 'center', marginVertical: 8},
    empty: {color: c.muted, fontStyle: 'italic', textAlign: 'center', marginVertical: 8},
    count: {color: c.muted, fontSize: 12, textAlign: 'center', marginBottom: 6},
    list: {marginBottom: 8},
    option: {
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 6,
      backgroundColor: c.cellBackground,
      marginBottom: 6,
    },
    optionText: {color: c.textPrimary},
    moreButton: {alignSelf: 'center', marginTop: 2, marginBottom: 8},
    sectionLabel: {
      fontWeight: '600',
      color: c.textPrimary,
      marginBottom: 6,
      marginTop: 4,
    },
    affiliationRow: {flexDirection: 'row', gap: 8, marginBottom: 10},
    affiliationButton: {flex: 1},
    validation: {color: c.error, textAlign: 'center', marginBottom: 8},
    buttons: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 12,
    },
  });
