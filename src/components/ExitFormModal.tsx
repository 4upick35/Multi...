import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {View, StyleSheet, ScrollView, Alert, Platform} from 'react-native';
import {Portal, Modal, Text, Button, TextInput, Switch, Divider} from 'react-native-paper';
import QuantumLoader from '../components/QuantumLoader';
import DateTimePicker, {DateTimePickerEvent} from '@react-native-community/datetimepicker';
import type {TaskExitField} from '../services/elma-api';
import {searchWorkerQuery} from '../services/elma-api';
import type {ElmaAccount} from '../types/account';
import {getItemName} from '../utils/collection-fields';
import {useAppTheme} from '../theme';

type ThemeColors = ReturnType<typeof useAppTheme>['colors'];
type RowStyles = ReturnType<typeof createRowStyles>;

/** Элемент списка коллекции: id — для значения поля, name — для показа. */
type CollectionOption = {id: string; name: string};

/** Состояние одного поля формы выхода. */
type FieldState = {
  text: string;
  bool: boolean;
  iso: string;
  picked: CollectionOption | null;
  list: CollectionOption[] | null;
  listLoading: boolean;
  listError: string;
  listOpen: boolean;
  showPicker: boolean;
  pickerMode: 'date' | 'time';
};

const EMPTY_FIELD: FieldState = {
  text: '',
  bool: false,
  iso: '',
  picked: null,
  list: null,
  listLoading: false,
  listError: '',
  listOpen: false,
  showPicker: false,
  pickerMode: 'date',
};

export type ExitFormModalProps = {
  visible: boolean;
  exit: {id: string; title: string; formFields: TaskExitField[]};
  account: ElmaAccount;
  /** instance задачи — значения полей для предзаполнения (как на сайте). */
  instance?: Record<string, unknown>;
  submitting?: boolean;
  onCancel: () => void;
  onSubmit: (values: Record<string, unknown>) => void;
};

/** Выбор из справочника доступен только для коллекций customer_service. */
function isCollectionField(field: TaskExitField): boolean {
  return (
    field.type === 'SYS_COLLECTION' &&
    !!field.collection &&
    field.collection.namespace === 'customer_service' &&
    !!field.collection.code
  );
}

/** Понимает ли форма тип поля; остальное заполняется в веб-клиенте ELMA. */
function isSupportedField(field: TaskExitField): boolean {
  if (isCollectionField(field)) {
    return true;
  }
  if (field.type === 'ENUM') {
    // Список вариантов ENUM живёт в шаблоне; без него заполнить нечем.
    return !!field.enumItems && field.enumItems.length > 0;
  }
  return (
    field.type === 'STRING' ||
    field.type === 'NUMBER' ||
    field.type === 'BOOLEAN' ||
    field.type === 'DATETIME' ||
    field.type === 'DATE'
  );
}

/** Поле «только время» (DATETIME с additionalType 'time', напр. «Время визита»). */
function isTimeOnlyField(field: TaskExitField): boolean {
  return field.type === 'DATETIME' && field.additionalType === 'time';
}

function fieldIsEmpty(field: TaskExitField, state: FieldState): boolean {
  if (isCollectionField(field)) {
    return !state.picked;
  }
  switch (field.type) {
    case 'ENUM':
      return !state.picked;
    case 'BOOLEAN':
      return false;
    case 'DATETIME':
    case 'DATE':
      return !state.iso;
    case 'NUMBER':
    case 'STRING':
      return !state.text.trim();
    default:
      return true;
  }
}

/** ELMA отдаёт часть значений массивом — берём первый элемент. */
function firstValue(raw: unknown): unknown {
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Предзаполнение формы значениями instance задачи: мастеру достаточно
 * подтвердить действие. Сетевых запросов здесь нет (в частности,
 * SYS_COLLECTION не трогаем — для него нужна выборка из справочника).
 */
function buildInitialStates(
  fields: TaskExitField[],
  instance?: Record<string, unknown>,
): Record<string, FieldState> {
  const states: Record<string, FieldState> = {};
  if (!instance) {
    return states;
  }
  fields.forEach(field => {
    if (field.type === 'SYS_COLLECTION') {
      return;
    }
    const value = firstValue(instance[field.code]);
    if (value === undefined || value === null) {
      return;
    }
    switch (field.type) {
      case 'STRING':
      case 'NUMBER':
        states[field.code] = {...EMPTY_FIELD, text: String(value)};
        return;
      case 'BOOLEAN':
        states[field.code] = {...EMPTY_FIELD, bool: value === true};
        return;
      case 'DATETIME':
      case 'DATE': {
        if (typeof value !== 'string' || !value) {
          return;
        }
        const iso = value;
        states[field.code] = {...EMPTY_FIELD, iso};
        return;
      }
      case 'ENUM': {
        if (typeof value !== 'string' && typeof value !== 'number') {
          return;
        }
        const code = String(value);
        if (!code) {
          return;
        }
        const option = (field.enumItems || []).find(item => item.code === code);
        states[field.code] = {
          ...EMPTY_FIELD,
          picked: {id: code, name: option ? option.name : code},
        };
        return;
      }
      default:
        return;
    }
  });
  return states;
}

function buildValues(fields: TaskExitField[], states: Record<string, FieldState>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  fields.forEach(field => {
    if (!isSupportedField(field)) {
      return;
    }
    const state = states[field.code] || EMPTY_FIELD;
    switch (field.type) {
      case 'ENUM':
        if (state.picked) {
          // Контекстное поле ENUM объявлено как array — уходит массив кодов.
          result[field.code] = [state.picked.id];
        }
        return;
      case 'BOOLEAN':
        result[field.code] = state.bool;
        return;
      case 'NUMBER': {
        const raw = state.text.trim();
        if (!raw) {
          return;
        }
        result[field.code] = Number(raw);
        return;
      }
      case 'DATETIME':
      case 'DATE':
        if (state.iso) {
          if (isTimeOnlyField(field)) {
            // «Только время» — это реальный момент времени (как его выбрал мастер),
            // приведённый к дате эпохи: 1970-01-01T<UTC-время>:00.000Z.
            // Локальные ЧЧ:ММ конвертируются в UTC один раз — без двойного сдвига.
            const picked = new Date(state.iso);
            result[field.code] = new Date(
              1970, 0, 1, picked.getHours(), picked.getMinutes(),
            ).toISOString();
            return;
          }
          result[field.code] = state.iso;
        }
        return;
      default:
        break;
    }
    if (isCollectionField(field)) {
      if (state.picked) {
        result[field.code] = [state.picked.id];
      }
      return;
    }
    const text = state.text;
    if (text.trim()) {
      result[field.code] = text;
    }
  });
  return result;
}

type RowProps = {
  field: TaskExitField;
  state: FieldState;
  styles: RowStyles;
  submitting: boolean;
  color: string;
  onChange: (patch: Partial<FieldState>) => void;
  onLoadList: () => void;
  onPick: (option: CollectionOption) => void;
};

/** Строка одной поля формы: контрол зависит от типа поля ELMA. */
function ExitFieldRow({field, state, styles, submitting, color, onChange, onLoadList, onPick}: RowProps) {
  const label = field.label || field.code;
  const labelText = field.required ? label + ' *' : label;

  if (!isSupportedField(field)) {
    return (
      <View style={styles.row}>
        <Text style={styles.label}>{labelText}</Text>
        <Text testID={'exit-unsupported-' + field.code} style={styles.unsupported}>
          {`Поле «${label}» нужно заполнить в веб-клиенте ELMA`}
        </Text>
      </View>
    );
  }

  if (field.type === 'ENUM') {
    // Варианты ENUM лежат в шаблоне: показываем их сразу, без сети и без
    // кнопки «Выбрать» — как список справочника.
    const options = field.enumItems || [];
    return (
      <View testID={'exit-field-' + field.code} style={styles.row}>
        <Text style={styles.label}>{labelText}</Text>
        <View style={styles.list}>
          {options.map(option => (
            <Button
              key={option.code}
              mode={state.picked && state.picked.id === option.code ? 'contained' : 'text'}
              compact
              disabled={submitting}
              testID={'exit-option-' + option.code}
              style={styles.listItem}
              contentStyle={styles.listItemContent}
              onPress={() => onPick({id: option.code, name: option.name})}>
              {option.name}
            </Button>
          ))}
        </View>
      </View>
    );
  }

  if (field.type === 'BOOLEAN') {
    return (
      <View style={styles.rowInline}>
        <Switch
          testID={'exit-field-' + field.code}
          value={state.bool}
          disabled={submitting}
          onValueChange={value => onChange({bool: value})}
        />
        <Text style={styles.label}>{labelText}</Text>
      </View>
    );
  }

  if (field.type === 'DATETIME' || field.type === 'DATE') {
    const timeOnly = isTimeOnlyField(field);
    return (
      <View style={styles.row}>
        <Text style={styles.label}>{labelText}</Text>
        <Button
          mode="outlined"
          compact
          disabled={submitting}
          testID={'exit-field-' + field.code}
          style={styles.control}
          onPress={() => onChange({showPicker: true, pickerMode: timeOnly ? 'time' : 'date'})}>
          {state.iso
            ? timeOnly
              ? new Date(state.iso).toLocaleTimeString('ru')
              : new Date(state.iso).toLocaleString('ru')
            : timeOnly
              ? 'Выбрать время'
              : 'Выбрать дату'}
        </Button>
        {state.showPicker ? (
          <DateTimePicker
            value={state.iso ? new Date(state.iso) : new Date()}
            mode={state.pickerMode}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(event: DateTimePickerEvent, date?: Date) => {
              const android = Platform.OS === 'android';
              if (!date || (android && event.type === 'dismissed')) {
                onChange({showPicker: false, pickerMode: 'date'});
                return;
              }
              const iso = date.toISOString();
              if (state.pickerMode === 'time') {
                onChange({iso, showPicker: false, pickerMode: 'date'});
              } else {
                onChange({iso, pickerMode: 'time', showPicker: true});
              }
            }}
          />
        ) : null}
      </View>
    );
  }

  if (isCollectionField(field)) {
    return (
      <View style={styles.row}>
        <Text style={styles.label}>{labelText}</Text>
        <View style={styles.pickerRow}>
          <Button
            mode="outlined"
            compact
            disabled={submitting || state.listLoading}
            testID={'exit-pick-' + field.code}
            style={styles.control}
            onPress={onLoadList}>
            {state.listLoading ? 'Загрузка…' : 'Выбрать'}
          </Button>
          <Text style={styles.picked} numberOfLines={2}>
            {state.picked ? state.picked.name : 'не выбрано'}
          </Text>
        </View>
        {state.listError ? <Text style={styles.error}>{state.listError}</Text> : null}
        {state.listOpen && state.list !== null ? (
          state.list.length === 0 && !state.listError ? (
            <Text style={styles.empty}>Нет элементов</Text>
          ) : (
            <View style={styles.list}>
              {state.list.map(option => (
                <Button
                  key={option.id}
                  mode={state.picked && state.picked.id === option.id ? 'contained' : 'text'}
                  compact
                  disabled={submitting}
                  testID={'exit-option-' + option.id}
                  style={styles.listItem}
                  contentStyle={styles.listItemContent}
                  onPress={() => onPick(option)}>
                  {option.name}
                </Button>
              ))}
            </View>
          )
        ) : null}
        {state.listLoading ? (
          <View style={styles.loader}>
            <QuantumLoader size={20} color={color} />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Text style={styles.label}>{labelText}</Text>
      <TextInput
        testID={'exit-field-' + field.code}
        mode="outlined"
        label={label}
        value={state.text}
        editable={!submitting}
        keyboardType={field.type === 'NUMBER' ? 'numeric' : 'default'}
        onChangeText={value => onChange({text: value})}
        style={styles.control}
      />
    </View>
  );
}

/**
 * Форма выхода задачи: поля из `settings.exit.formFields` + типы/подписи из
 * `template.context[]`. Значения уходят тем же официальным PUT, которым
 * `submitTask` закрывает задачу (см. TaskDetailScreen.submitExitWithValues).
 */
export default function ExitFormModal({
  visible,
  exit,
  account,
  instance,
  submitting = false,
  onCancel,
  onSubmit,
}: ExitFormModalProps) {
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const rowStyles = useMemo(() => createRowStyles(colors), [colors]);
  const [states, setStates] = useState<Record<string, FieldState>>({});

  // Данные для предзаполнения держим в ref: иначе useEffect зависел бы от
  // идентичности пропов и сбрасывал бы поля мастера на каждом рендере.
  const prefillRef = useRef({instance, fields: exit.formFields});
  prefillRef.current = {instance, fields: exit.formFields};

  // Новый выход — новая форма: значения предыдущего выхода не тащим,
  // а поля, заполненные в задаче, предзаполняем — как открывает их сайт.
  useEffect(() => {
    if (visible) {
      const {instance: data, fields} = prefillRef.current;
      setStates(buildInitialStates(fields, data));
    }
  }, [visible, exit.id]);

  const setField = useCallback((code: string, patch: Partial<FieldState>) => {
    setStates(prev => ({...prev, [code]: {...(prev[code] || EMPTY_FIELD), ...patch}}));
  }, []);

  /**
   * Список справочника грузится ТОЛЬКО по нажатию «Выбрать»: лишние запросы к
   * ELMA (тем более при открытии модалки) провоцируют временный бан.
   */
  const loadList = useCallback(
    async (field: TaskExitField) => {
      if (!field.collection) {
        return;
      }
      const code = field.code;
      const current = states[code] || EMPTY_FIELD;
      setField(code, {listOpen: true});
      if (current.list || current.listLoading) {
        return;
      }
      setField(code, {listLoading: true, listError: ''});
      try {
        const result = await searchWorkerQuery(account, field.collection.code, {
          filter: field.collection.filter,
          offset: 0,
          limit: 50,
          order: [],
        });
        const items: CollectionOption[] = [];
        result.items.forEach(raw => {
          const obj = (raw || {}) as Record<string, unknown>;
          const id = String(obj.__id || obj.id || '');
          if (id) {
            items.push({id, name: getItemName(obj) || id});
          }
        });
        setField(code, {listLoading: false, list: items});
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        setField(code, {listLoading: false, listError: message.slice(0, 200)});
      }
    },
    [account, states, setField],
  );

  const unsupported = exit.formFields.filter(field => !isSupportedField(field));
  const missingRequired = exit.formFields.filter(
    field => field.required && fieldIsEmpty(field, states[field.code] || EMPTY_FIELD),
  );
  const canSubmit = !submitting && unsupported.length === 0 && missingRequired.length === 0;

  const handleSubmit = useCallback(() => {
    if (submitting) {
      return;
    }
    if (unsupported.length > 0) {
      Alert.alert(
        'Заполните в веб-клиенте ELMA',
        unsupported.map(field => 'Поле «' + (field.label || field.code) + '»').join(', ') +
          ' нужно заполнить в веб-клиенте ELMA.',
      );
      return;
    }
    if (missingRequired.length > 0) {
      Alert.alert(
        'Заполните обязательные поля',
        missingRequired.map(field => field.label || field.code).join(', '),
      );
      return;
    }
    onSubmit(buildValues(exit.formFields, states));
  }, [submitting, unsupported, missingRequired, exit.formFields, states, onSubmit]);

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onCancel}
        dismissable={!submitting}
        contentContainerStyle={styles.modal}>
        <View testID="exit-form" style={styles.form}>
          <Text variant="titleMedium" style={styles.title}>
            {exit.title}
          </Text>
          <Divider style={styles.divider} />
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            {exit.formFields.length === 0 ? (
              <Text style={styles.empty}>У этого действия нет полей для заполнения</Text>
            ) : (
              exit.formFields.map(field => (
                <ExitFieldRow
                  key={field.code}
                  field={field}
                  state={states[field.code] || EMPTY_FIELD}
                  styles={rowStyles}
                  submitting={submitting}
                  color={field.enumItems ? (field.collection?.code === 'customers' ? colors.primary : colors.textSubtle) : colors.muted}
                  onChange={patch => setField(field.code, patch)}
                  onLoadList={() => loadList(field)}
                  onPick={option => setField(field.code, {picked: option, listOpen: false})}
                />
              ))
            )}
          </ScrollView>
          <Divider style={styles.divider} />
          <View style={styles.buttons}>
            <Button mode="text" onPress={onCancel} disabled={submitting}>
              Отмена
            </Button>
            <Button mode="contained" onPress={handleSubmit} disabled={!canSubmit} testID="exit-form-submit">
              Отправить
            </Button>
          </View>
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
    form: {flexShrink: 1},
    title: {fontWeight: '600', color: c.textPrimary},
    divider: {marginVertical: 12},
    scroll: {maxHeight: 420},
    scrollContent: {gap: 16},
    buttons: {flexDirection: 'row', justifyContent: 'flex-end', gap: 8},
    empty: {color: c.muted, fontStyle: 'italic', textAlign: 'center'},
  });

const createRowStyles = (c: ThemeColors) =>
  StyleSheet.create({
    row: {gap: 6},
    rowInline: {flexDirection: 'row', alignItems: 'center', gap: 10},
    label: {fontWeight: '600', color: c.textPrimary},
    control: {alignSelf: 'flex-start'},
    pickerRow: {flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap'},
    picked: {flex: 1, color: c.textSecondary, minWidth: 120},
    list: {borderRadius: 8, backgroundColor: c.cellBackground, paddingVertical: 4},
    listItem: {alignSelf: 'stretch', borderRadius: 0},
    listItemContent: {justifyContent: 'flex-start'},
    loader: {alignSelf: 'flex-start'},
    error: {color: c.error, fontSize: 12},
    unsupported: {color: c.warning, fontSize: 13},
    empty: {color: c.muted, fontStyle: 'italic'},
  });
