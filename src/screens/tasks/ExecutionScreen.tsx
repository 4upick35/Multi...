import React, {useState, useEffect, useMemo, useCallback, useRef} from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  TouchableOpacity,
  Image,
  Platform,
} from 'react-native';
import {Text, Button, TextInput, IconButton} from 'react-native-paper';
import DateTimePicker, {DateTimePickerEvent} from '@react-native-community/datetimepicker';
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';
import type {Asset} from 'react-native-image-picker';
import BackButton from '../../components/BackButton';
import {useAuthStore} from '../../store/auth-store';
import {useCustomerServiceStore} from '../../store/customer-service-store';
import {fetchTaskById, submitTaskWithData, uploadPhotoAndGetHash, needsVisitConfirmation, fetchTaskTemplateExits, isVisitExit} from '../../services/elma-api';
import type {TaskExitInfo} from '../../services/elma-api';
import {logDiag} from '../../diag/accept-log';
import {loadCollection} from '../../services/customer-service';
import {buildExecutionTaskBody, utcStartOfDayIso} from '../../utils/execution-form';
import type {ExecutionFileInput, SparePartRow} from '../../utils/execution-form';
import {readBlobBytes} from '../../utils/file-format';
import {useAppTheme} from '../../theme';
import {useSecureScreen} from '../../hooks/useSecureScreen';
import type {ElmaAccount} from '../../types/account';
import {VisitConfirmationBlock} from '../../components/VisitConfirmationBlock';
import SparePartPickerModal from '../../components/SparePartPickerModal';
import {taskNodeIdFromPath, isTaskClosed} from '../../domain/TaskService';
import {getRemainingPauseMs} from '../../infrastructure/AccountThrottle';
import {SUBMIT_MIN_GAP_MS} from '../../config/constants';
import {isUuid} from '../../utils/uuid';
import QuantumLoader from '../../components/QuantumLoader';

type Props = {taskId: string; accountId: string; taskUuid: string; onBack: () => void};
type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

/** Текст принадлежности строки ЗЧ (колонка таблицы). */
const AFFILIATION_LABELS: Record<SparePartRow['affiliation'], string> = {
  recovery: 'Восстановление',
  service_center: 'ЗЧ исполнителя',
};

/** Элемент строки ЗЧ, как он приходит с сервера. */
type SparePartServerRow = {
  name_of_spare_parts?: string;
  name?: unknown;
  affiliation?: unknown;
  count?: number;
  price?: number;
  planned_delivery_date?: unknown;
};

/** Прочитать принадлежность строки, пришедшую с сервера. */
function readAffiliation(raw: unknown): SparePartRow['affiliation'] {
  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0] as {code?: unknown} | null;
    if (first && (first.code === 'recovery' || first.code === 'service_center')) {
      return first.code;
    }
  }
  return 'service_center';
}

/** Локальное представление даты доставки в колонке таблицы. */
function formatDeliveryDate(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) {
    return '';
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toLocaleDateString('ru');
}

/**
 * id экземпляра процесса из ответа `GET /api/bpm/tasks/{uuid}`.
 * Сервер отдаёт его в `instance.__id` — как в `TaskService.mapTask`.
 */
function readInstanceId(task: Record<string, unknown>): string {
  const inst = task.instance;
  if (inst && typeof inst === 'object') {
    const obj = inst as Record<string, unknown>;
    const id = obj.__id || obj.id;
    if (id) {
      return String(id);
    }
  }
  return task.instanceId ? String(task.instanceId) : '';
}

/** Максимальная длина текста ошибки загрузки, которую показываем в списке. */
const FILE_ERROR_MAX_LENGTH = 200;

interface FilePreview {
  /** Стабильный ключ файла (Date.now() + счётчик). */
  uid: string;
  uri: string;
  name: string;
  size: number;
  type: string;
  /** Файл выгружается прямо сейчас (запускается сразу при добавлении). */
  status: 'uploading' | 'done' | 'error';
  /** hash, полученный от сервера после успешной выгрузки. */
  hash?: string;
  /** Текст ошибки выгрузки (только при status === 'error'). */
  error?: string;
}

export default function ExecutionScreen({taskId: _taskId, accountId, taskUuid, onBack}: Props) {
  useSecureScreen();
  const accountFromStore = useAuthStore(s => s.accounts.find(a => a.id === accountId));
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [account] = useState<ElmaAccount | null>(accountFromStore ?? null);

  // Поля формы
  const [serialNumber, setSerialNumber] = useState('');
  const [technicalConclusion, setTechnicalConclusion] = useState('');
  const [plannedDate, setPlannedDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [totalCostForExecutor, setTotalCostForExecutor] = useState('');
  const [totalCostOfRepair, setTotalCostOfRepair] = useState('');
  const [resultOfWorkIds, setResultOfWorkIds] = useState<string[]>([]);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [sparePartRows, setSparePartRows] = useState<SparePartRow[]>([]);
  const [files, setFiles] = useState<FilePreview[]>([]);

  // Состояние
  const [loading, setLoading] = useState(false);
  const [loadingTask, setLoadingTask] = useState(true);
  const [resultsOfWork, setResultsOfWork] = useState<Array<{id: string; name: string}>>([]);
  const [decisions, setDecisions] = useState<Array<{id: string; name: string}>>([]);
  const [instance, setInstance] = useState<Record<string, unknown>>({});
  const [instanceId, setInstanceId] = useState('');
  const [_instanceLoading, setInstanceLoading] = useState(false);

  // Загруженная задача целиком: отсюда берём координаты шаблона
  // (templateNsAndCode, path) для кнопок-выходов.
  const [task, setTask] = useState<Record<string, unknown> | null>(null);
  // Выходы ТОЛЬКО из шаблона процесса: серверный getexits отдаёт только
  // выходы, доступные в текущем состоянии задачи, и для этой задачи пуст,
  // поэтому «Готово» там не видно. Кнопки скрываются, пока шаблон
  // не проверен (fail closed) — иначе незаполнимый выход сервер считает
  // странным запросом и банит сессию.
  const [exits, setExits] = useState<TaskExitInfo[]>([]);
  const [exitsLoading, setExitsLoading] = useState(true);
  const [exitsCheckFailed, setExitsCheckFailed] = useState(false);
  // Отметка времени последней отправки — защита от серии быстрых нажатий.
  const lastSubmitAtRef = useRef(0);
  // Выходы запрашиваем строго один раз на жизненный цикл экрана.
  const exitsRequestedRef = useRef(false);

  // Выбранные результаты работ (для мультивыбора)
  const [selectedResults, setSelectedResults] = useState<Array<{id: string; name: string}>>([]);
  const [showResultsPicker, setShowResultsPicker] = useState(false);
  const [showDecisionsPicker, setShowDecisionsPicker] = useState(false);
  const [showSparePicker, setShowSparePicker] = useState(false);

  /**
   * Один раз после загрузки задачи: кнопки-выходы ИЗ ШАБЛОНА ПРОЦЕССА
   * (выходы узла) — так же, как их рисует веб-клиент ELMA. Показываем только
   * выходы без формы (formFields пусты) и кроме «Подтвердить визит» —
   * он выполняется через VisitConfirmationBlock (нужен код из СМС).
   * Шаблон не кэшируется при ошибке, поэтому повторный запрос уйдёт заново.
   */
  const loadAvailableExits = useCallback(
    async (loadedTask: Record<string, unknown>) => {
      if (!account) {
        setExitsLoading(false);
        setExitsCheckFailed(true);
        return;
      }
      setExitsLoading(true);
      setExitsCheckFailed(false);
      try {
        const templateNsAndCode =
          typeof loadedTask.templateNsAndCode === 'string' ? loadedTask.templateNsAndCode : '';
        const nodeId = taskNodeIdFromPath(
          typeof loadedTask.path === 'string' ? loadedTask.path : '',
        );
        if (!templateNsAndCode || !nodeId) {
          // Координат шаблона нет — кнопки не показываем (fail closed).
          setExitsCheckFailed(true);
          logDiag('exits', 'execution-coords-missing task=' + taskUuid);
          return;
        }

        const templateExits = await fetchTaskTemplateExits(account, templateNsAndCode, nodeId);
        if (templateExits === null) {
          // Шаблон не загрузился — кнопки не показываем (fail closed).
          setExitsCheckFailed(true);
          logDiag('exits', 'execution-template-unavailable task=' + taskUuid);
          return;
        }

        const visible = templateExits.filter(
          e => !isVisitExit({id: e.id, title: e.name}) && (e.formFields || []).length === 0,
        );
        setExits(visible);
        logDiag(
          'exits',
          'execution-exits node=' + nodeId + ' total=' + templateExits.length + ' visible=' + visible.length,
        );
      } catch {
        setExits([]);
        setExitsCheckFailed(true);
      } finally {
        setExitsLoading(false);
      }
    },
    [account, taskUuid],
  );

  // Выходы загружаются ОДИН раз — сразу после загрузки задачи.
  // Кнопки выходов показываются только после успешной проверки шаблона.
  useEffect(() => {
    if (!task || !account || exitsRequestedRef.current) {
      return;
    }
    exitsRequestedRef.current = true;
    loadAvailableExits(task);
  }, [task, account, loadAvailableExits]);

  // Загрузка текущих значений задачи
  useEffect(() => {
    if (!account || !taskUuid) {
      return;
    }
    let cancelled = false;
    setLoadingTask(true);
    setInstanceLoading(true);

    fetchTaskById(account, taskUuid).then(result => {
      if (cancelled || !result.task) {
        setLoadingTask(false);
        setInstanceLoading(false);
        // Задача не загрузилась — координат шаблона нет, кнопок выходов нет.
        setExitsLoading(false);
        setExitsCheckFailed(true);
        return;
      }
      const t = result.task;
      setTask(t);
      const inst = (t.instance && typeof t.instance === 'object') ? t.instance as Record<string, unknown> : {};
      setInstance(inst);
      const iid = readInstanceId(t);
      if (iid) setInstanceId(iid);

      const sn = (t['sn_of_technology'] as string) || '';
      const tech = (t['technical_conclusion'] as string) || '';
      const dateStr = (t['planned_completion_date'] as string) || '';
      const costExec = t['total_cost_for_executor'];
      const costRepair = t['total_cost_of_repair_number'];
      const results = Array.isArray(t['result_of_work']) ? (t['result_of_work'] as string[]) : [];
      const decisions = Array.isArray(t['decision_of_application']) ? (t['decision_of_application'] as string[]) : [];

      setSerialNumber(sn);
      setTechnicalConclusion(tech);
      if (dateStr) {
        try {
          setPlannedDate(new Date(dateStr));
        } catch {
          // ignore
        }
      }
      if (typeof costExec === 'number') {
        setTotalCostForExecutor(String(costExec));
      }
      if (typeof costRepair === 'number') {
        setTotalCostOfRepair(String(costRepair));
      }
      setResultOfWorkIds(results);
      if (decisions.length > 0) {
        setDecisionId(decisions[0]);
      }

      // Запчасти из задачи
      const spareRaw = t['used_spare_parts_materials'] as {rows?: SparePartServerRow[]} | undefined;
      if (spareRaw?.rows && spareRaw.rows.length > 0) {
        setSparePartRows(
          spareRaw.rows.map(r => ({
            nameOfSpareParts: r.name_of_spare_parts ?? '',
            sparePartId:
              Array.isArray(r.name) && r.name.length > 0 ? String(r.name[0]) : undefined,
            affiliation: readAffiliation(r.affiliation),
            count: typeof r.count === 'number' ? r.count : 0,
            price: typeof r.price === 'number' ? r.price : 0,
            plannedDeliveryDate:
              typeof r.planned_delivery_date === 'string' && r.planned_delivery_date
                ? r.planned_delivery_date
                : undefined,
          })),
        );
      }

      setLoadingTask(false);
      setInstanceLoading(false);
      // Выходы грузит отдельный эффект по `task` — см. loadAvailableExits.
    }).catch(() => {
      setLoadingTask(false);
      setInstanceLoading(false);
      // Задача не загрузилась — координат шаблона нет, кнопок выходов нет.
      setExitsLoading(false);
      setExitsCheckFailed(true);
    });

    return () => { cancelled = true; };
  }, [account, taskUuid, loadAvailableExits]);

  // Загрузка справочников
  useEffect(() => {
    if (!account) {
      return;
    }
    const store = useCustomerServiceStore.getState();

    // Результаты работ
    const resultsItems = store.getItems(accountId, 'results_of_work');
    if (resultsItems.length > 0) {
      setResultsOfWork(resultsItems.map(i => ({id: i.id, name: i.name})));
    } else {
      loadCollection(account, 'results_of_work').then(() => {
        const items = useCustomerServiceStore.getState().getItems(accountId, 'results_of_work');
        setResultsOfWork(items.map(i => ({id: i.id, name: i.name})));
      });
    }

    // Решения по заявкам
    const decisionsItems = store.getItems(accountId, 'decisions_by_applications');
    if (decisionsItems.length > 0) {
      setDecisions(decisionsItems.map(i => ({id: i.id, name: i.name})));
    } else {
      loadCollection(account, 'decisions_by_applications').then(() => {
        const items = useCustomerServiceStore.getState().getItems(accountId, 'decisions_by_applications');
        setDecisions(items.map(i => ({id: i.id, name: i.name})));
    });
    }
  }, [account, accountId]);

  // Синхронизировать selectedResults с resultOfWorkIds
  useEffect(() => {
    if (resultsOfWork.length > 0 && resultOfWorkIds.length > 0) {
      setSelectedResults(
        resultsOfWork.filter(r => resultOfWorkIds.includes(r.id)),
      );
    }
  }, [resultsOfWork, resultOfWorkIds]);

  /** Генератор стабильных ключей для файлов. */
  const uidCounter = useRef(0);
  /** Очередь выгрузки: файлы уходят на сервер строго по одному. */
  const uploadChainRef = useRef<Promise<void>>(Promise.resolve());

  const patchFile = useCallback((uid: string, patch: Partial<FilePreview>) => {
    setFiles(prev => prev.map(f => (f.uid === uid ? {...f, ...patch} : f)));
  }, []);

  /** Выгрузить один файл и обновить его статус в списке (без Alert). */
  const uploadSingleFile = useCallback(
    async (file: FilePreview) => {
      const fail = (message: string) =>
        patchFile(file.uid, {status: 'error', error: message.slice(0, FILE_ERROR_MAX_LENGTH)});

      try {
        if (!account) {
          fail('Нет активного аккаунта');
          return;
        }

        const response = await fetch(file.uri);
        const blob = await response.blob();
        const bytes = await readBlobBytes(blob);

        const result = await uploadPhotoAndGetHash(
          account,
          file.name,
          new Uint8Array(bytes),
          file.type,
        );

        if (result.ok && result.hash) {
          patchFile(file.uid, {status: 'done', hash: result.hash});
        } else {
          fail(result.error || 'неизвестная ошибка');
        }
      } catch (e: unknown) {
        fail(e instanceof Error ? e.message : String(e));
      }
    },
    [account, patchFile],
  );

  /** Поставить выгрузку файла в общую последовательную очередь. */
  const enqueueUpload = useCallback(
    (file: FilePreview) => {
      uploadChainRef.current = uploadChainRef.current
        .then(() => uploadSingleFile(file))
        .catch(() => undefined);
    },
    [uploadSingleFile],
  );

  /** Добавить выбранные файлы в список и сразу начать их выгрузку. */
  const addFilesAndUpload = useCallback(
    (assets: Asset[]) => {
      const created: FilePreview[] = assets.map(a => ({
        uid: `${Date.now()}-${uidCounter.current++}`,
        uri: a.uri || '',
        name: a.fileName || `photo_${Date.now()}.jpg`,
        size: a.fileSize || 0,
        type: a.type || 'image/jpeg',
        status: 'uploading',
      }));

      setFiles(prev => [...prev, ...created]);
      created.forEach(file => enqueueUpload(file));
    },
    [enqueueUpload],
  );

  const handlePickImage = useCallback(async () => {
    Alert.alert('Добавить фото', 'Выберите источник', [
      {
        text: 'Камера',
        onPress: async () => {
          const result = await launchCamera({mediaType: 'photo', quality: 0.8});
          if (result.assets && result.assets.length > 0) {
            addFilesAndUpload(result.assets);
          }
        },
      },
      {
        text: 'Галерея',
        onPress: async () => {
          const result = await launchImageLibrary({mediaType: 'photo', quality: 0.8, selectionLimit: 5});
          if (result.assets && result.assets.length > 0) {
            addFilesAndUpload(result.assets);
          }
        },
      },
      {text: 'Отмена', style: 'cancel'},
    ]);
  }, [addFilesAndUpload]);

  const handleRemoveFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleAddSparePart = useCallback(() => {
    setShowSparePicker(true);
  }, []);

  const handleSparePartSubmit = useCallback((row: SparePartRow) => {
    setShowSparePicker(false);
    setSparePartRows(prev => [...prev, row]);
  }, []);

  const handleRemoveSparePart = useCallback((index: number) => {
    setSparePartRows(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleSparePartChange = useCallback(
    (index: number, field: 'count' | 'price', value: number) => {
      setSparePartRows(prev => {
        const next = [...prev];
        next[index] = {...next[index], [field]: value};
        return next;
      });
    },
    [],
  );

  const handleToggleResult = useCallback(
    (item: {id: string; name: string}) => {
      setSelectedResults(prev => {
        const exists = prev.find(r => r.id === item.id);
        const next = exists ? prev.filter(r => r.id !== item.id) : [...prev, item];
        setResultOfWorkIds(next.map(r => r.id));
        return next;
      });
    },
    [],
  );

  const handleDateChange = useCallback((_event: DateTimePickerEvent, date?: Date) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (date) {
      setPlannedDate(date);
    }
  }, []);

  /**
   * Сборщик тела запроса для выхода с данными формы.
   * Возвращает либо `{ok: true, body}`, либо `{ok: false}` — в этом случае
   * причина уже показана Alert'ом и запрос отправлять нельзя.
   * Пустое тело допустимо: сайт позволяет нажать кнопку-выход и без
   * заполненных полей.
   */
  const collectBody = useCallback((): {ok: true; body: Record<string, unknown>} | {ok: false} => {
    // Фото выгружаются сразу при добавлении — ждём только готовые.
    if (files.some(f => f.status === 'uploading')) {
      Alert.alert('Подождите', 'Фото ещё загружаются');
      return {ok: false};
    }

    const failedFile = files.find(f => f.status === 'error');
    if (failedFile) {
      Alert.alert(
        'Ошибка',
        `Не удалось загрузить фото «${failedFile.name}». Удалите его и добавьте заново.`,
      );
      return {ok: false};
    }

    if (!instanceId) {
      Alert.alert('Ошибка', 'Не удалось определить заявку. Вернитесь к списку задач и откройте задачу заново.');
      return {ok: false};
    }

    // Файлы уже выгружены при добавлении — собираем только готовые hash
    const uploadedFiles: ExecutionFileInput[] = [];
    for (const file of files) {
      if (file.status === 'done' && file.hash) {
        uploadedFiles.push({
          id: file.hash,
          name: file.name,
          hash: file.hash,
          size: file.size,
        });
      }
    }

    const body = buildExecutionTaskBody({
      serialNumber: serialNumber || undefined,
      technicalConclusion: technicalConclusion || undefined,
      plannedCompletionDate: plannedDate
        ? utcStartOfDayIso(plannedDate)
        : undefined,
      totalCostForExecutor: totalCostForExecutor
        ? parseFloat(totalCostForExecutor)
        : undefined,
      totalCostOfRepair: totalCostOfRepair
        ? parseFloat(totalCostOfRepair)
        : undefined,
      resultOfWorkIds: resultOfWorkIds.length > 0 ? resultOfWorkIds : undefined,
      decisionIds: decisionId ? [decisionId] : undefined,
      sparePartRows: sparePartRows.length > 0 ? sparePartRows : undefined,
      files: uploadedFiles.length > 0 ? uploadedFiles : undefined,
    });

    return {ok: true, body};
  }, [
    files,
    instanceId,
    serialNumber,
    technicalConclusion,
    plannedDate,
    totalCostForExecutor,
    totalCostOfRepair,
    resultOfWorkIds,
    decisionId,
    sparePartRows,
  ]);

  const taskState = task && typeof task.state === 'string' ? task.state : '';
  const taskClosed = isTaskClosed(taskState);

  /**
   * Выход с данными формы ОДНИМ запросом — как кнопка-выход в веб-клиенте ELMA
   * (HAR23: «Готово» + данные экрана, статус 200). Повторных отправок нет:
   * после отказа список выходов скрывается (fail closed).
   */
  const handleExitWithData = useCallback(
    async (exit: TaskExitInfo) => {
      if (!account) {
        Alert.alert('Ошибка', 'Нет активного аккаунта');
        return;
      }
      if (taskClosed) {
        Alert.alert('Задача уже закрыта', 'Действия недоступны: задача уже закрыта (выполнена ранее).');
        return;
      }

      const collected = collectBody();
      if (!collected.ok) {
        return;
      }

      // Пауза бана: ELMA временно ограничила запросы — «дожимать» нельзя.
      const pauseLeft = getRemainingPauseMs(accountId);
      if (pauseLeft > 0) {
        Alert.alert(
          'Сервер ограничил запросы',
          'ELMA временно ограничила запросы для этого аккаунта. Подождите ~' +
            Math.ceil(pauseLeft / 60000) +
            ' мин — частые нажатия продлевают ограничение.',
        );
        return;
      }

      // Несколько отправок подряд — для сервера поток странных запросов (был бан).
      const sinceLastSubmit = Date.now() - lastSubmitAtRef.current;
      if (lastSubmitAtRef.current > 0 && sinceLastSubmit < SUBMIT_MIN_GAP_MS) {
        Alert.alert('Слишком часто', 'Подождите пару секунд перед следующим действием.');
        return;
      }

      // На сервер уходит только UUID-выход, реально пришедший от ELMA.
      if (!isUuid(exit.id)) {
        Alert.alert('Ошибка', 'Действие недоступно. Нажмите «Действия», чтобы обновить список.');
        return;
      }

      lastSubmitAtRef.current = Date.now();
      setLoading(true);
      try {
        const result = await submitTaskWithData(account, {
          taskUuid,
          instanceId,
          exitId: exit.id,
          body: collected.body,
          instance,
        });
        if (result.ok) {
          Alert.alert('Готово', 'Действие выполнено');
          onBack();
        } else {
          // Состояние задачи на сервере могло измениться — «дожимать»
          // остальные кнопки вслепую нельзя: скрываем список выходов.
          setExits([]);
          setExitsCheckFailed(true);
          Alert.alert('Ошибка', result.error || 'Не удалось выполнить действие');
        }
      } finally {
        setLoading(false);
      }
    },
    [account, accountId, taskUuid, instanceId, instance, collectBody, onBack, taskClosed],
  );

  if (!account) {
    return (
      <View style={styles.center}>
        <Text>Аккаунт не найден</Text>
        <BackButton onBack={onBack} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <BackButton onBack={onBack} />
      <Text variant="headlineSmall" style={styles.title}>Выполнение работ</Text>

      {loadingTask ? (
        <Text style={styles.loadingText}>Загрузка данных задачи...</Text>
      ) : (
        <>
          {/* Серийный номер */}
          <TextInput
            label="Серийный номер"
            value={serialNumber}
            onChangeText={setSerialNumber}
            mode="outlined"
            style={styles.input}
          />

          {/* Техническое заключение */}
          <TextInput
            label="Техническое заключение"
            value={technicalConclusion}
            onChangeText={setTechnicalConclusion}
            mode="outlined"
            multiline
            numberOfLines={3}
            style={styles.input}
          />

          {/* Планируемая дата */}
          <TouchableOpacity onPress={() => setShowDatePicker(true)}>
            <TextInput
              label="Планируемая дата"
              value={plannedDate ? plannedDate.toLocaleDateString('ru') : ''}
              mode="outlined"
              editable={false}
              right={<TextInput.Icon icon="calendar" onPress={() => setShowDatePicker(true)} />}
              style={styles.input}
            />
          </TouchableOpacity>
          {showDatePicker && (
            <DateTimePicker
              value={plannedDate || new Date()}
              mode="date"
              display="default"
              onChange={handleDateChange}
            />
          )}

          {/* Суммы */}
          <View style={styles.row}>
            <TextInput
              label="Стоимость для исполнителя"
              value={totalCostForExecutor}
              onChangeText={setTotalCostForExecutor}
              mode="outlined"
              keyboardType="numeric"
              style={[styles.input, styles.halfInput]}
            />
            <TextInput
              label="Стоимость ремонта"
              value={totalCostOfRepair}
              onChangeText={setTotalCostOfRepair}
              mode="outlined"
              keyboardType="numeric"
              style={[styles.input, styles.halfInput]}
            />
          </View>

          {/* Результат работ — мультивыбор */}
          <Text variant="titleSmall" style={styles.sectionTitle}>Результат работ</Text>
          <TouchableOpacity onPress={() => setShowResultsPicker(!showResultsPicker)}>
            <TextInput
              label="Выбрать результаты"
              value={selectedResults.map(r => r.name).join(', ')}
              mode="outlined"
              editable={false}
              right={<TextInput.Icon icon="menu-down" />}
              style={styles.input}
            />
          </TouchableOpacity>
          {showResultsPicker && (
            <View style={styles.pickerList}>
              {resultsOfWork.map(item => {
                const selected = selectedResults.some(r => r.id === item.id);
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.pickerItem, selected && styles.pickerItemSelected]}
                    onPress={() => {
                      handleToggleResult(item);
                      setShowResultsPicker(false);
                    }}>
                    <Text style={selected ? styles.pickerTextSelected : undefined}>
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {resultsOfWork.length === 0 && (
                <Text style={styles.muted}>Нет доступных вариантов</Text>
              )}
            </View>
          )}

          {/* Решение по заявке — одиночный выбор */}
          <Text variant="titleSmall" style={styles.sectionTitle}>Решение по заявке</Text>
          <TouchableOpacity onPress={() => setShowDecisionsPicker(!showDecisionsPicker)}>
            <TextInput
              label="Выбрать решение"
              value={decisions.find(d => d.id === decisionId)?.name || ''}
              mode="outlined"
              editable={false}
              right={<TextInput.Icon icon="menu-down" />}
              style={styles.input}
            />
          </TouchableOpacity>
          {showDecisionsPicker && (
            <View style={styles.pickerList}>
              {decisions.map(item => (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.pickerItem, decisionId === item.id && styles.pickerItemSelected]}
                  onPress={() => {
                    setDecisionId(decisionId === item.id ? null : item.id);
                    setShowDecisionsPicker(false);
                  }}>
                  <Text style={decisionId === item.id ? styles.pickerTextSelected : undefined}>
                    {item.name}
                  </Text>
                </TouchableOpacity>
              ))}
              {decisions.length === 0 && (
                <Text style={styles.muted}>Нет доступных вариантов</Text>
              )}
            </View>
          )}

          {/* Запчасти */}
          <Text variant="titleSmall" style={styles.sectionTitle}>Запчасти</Text>
          {sparePartRows.map((row, idx) => (
            <View key={idx} style={styles.spareCard}>
              <TextInput
                label="Название"
                value={row.nameOfSpareParts}
                editable={false}
                mode="outlined"
                style={styles.input}
              />
              <View style={styles.spareMetaRow}>
                <Text style={styles.spareMetaText}>
                  {`Принадлежность: ${AFFILIATION_LABELS[row.affiliation]}`}
                </Text>
                <Text style={styles.spareMetaText}>
                  {`Сумма: ${(row.count * row.price).toFixed(2)}`}
                </Text>
                <IconButton
                  icon="delete"
                  size={20}
                  onPress={() => handleRemoveSparePart(idx)}
                />
              </View>
              <View style={styles.spareNumRow}>
                <TextInput
                  label="Кол-во"
                  value={String(row.count)}
                  onChangeText={v => handleSparePartChange(idx, 'count', parseInt(v, 10) || 0)}
                  mode="outlined"
                  keyboardType="numeric"
                  style={[styles.input, styles.spareNumInput]}
                />
                <TextInput
                  label="Цена"
                  value={String(row.price)}
                  onChangeText={v => handleSparePartChange(idx, 'price', parseFloat(v) || 0)}
                  mode="outlined"
                  keyboardType="numeric"
                  style={[styles.input, styles.spareNumInput]}
                />
              </View>
              <TextInput
                label="Планируемая дата доставки"
                value={formatDeliveryDate(row.plannedDeliveryDate)}
                editable={false}
                mode="outlined"
                style={styles.input}
              />
            </View>
          ))}
          <Button mode="outlined" onPress={handleAddSparePart} style={styles.addButton}>
            + Добавить запчасть
          </Button>
          <SparePartPickerModal
            visible={showSparePicker}
            account={account}
            onCancel={() => setShowSparePicker(false)}
            onSubmit={handleSparePartSubmit}
          />

          {/* Фото */}
          <Text variant="titleSmall" style={styles.sectionTitle}>Фото</Text>
          <View style={styles.filesContainer}>
            {files.map((file, idx) => (
              <View key={file.uid} style={styles.fileRow}>
                {file.type.startsWith('image/') && (
                  <Image source={{uri: file.uri}} style={styles.fileThumb} />
                )}
                <View style={styles.fileInfo}>
                  <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
                  {file.status === 'uploading' && (
                    <View style={styles.fileStatusRow} testID={`file-uploading-${file.uid}`}>
                      <QuantumLoader size={20} color={colors.muted} />
                      <Text style={styles.fileStatusText}>Загрузка…</Text>
                    </View>
                  )}
                  {file.status === 'error' && (
                    <Text style={styles.fileErrorText} testID={`file-error-${file.uid}`}>
                      {`Ошибка загрузки: ${file.error}`}
                    </Text>
                  )}
                </View>
                <IconButton icon="close" size={18} onPress={() => handleRemoveFile(idx)} />
              </View>
            ))}
          </View>
          <Button mode="outlined" onPress={handlePickImage} style={styles.addButton}>
            + Добавить фото
          </Button>

          {/* Действия по заявке: кнопки-выходы ИЗ ШАБЛОНА ПРОЦЕССА (выходы
              узла) — как в веб-клиенте ELMA. Данные формы и выход уходят
              ОДНИМ запросом. Кнопки показываются ТОЛЬКО после успешной
              проверки шаблона (fail closed). */}
          <Text variant="titleSmall" style={styles.sectionTitle}>Действия по заявке</Text>
          {exitsLoading ? (
            <QuantumLoader testID="exits-indicator" />
          ) : taskClosed ? (
            <Text testID="task-closed" style={styles.muted}>Задача уже закрыта</Text>
          ) : exitsCheckFailed ? (
            <>
              <Text testID="exits-check-failed" style={styles.muted}>
                {'Не удалось проверить действия. Нажмите «Проверить ещё раз».'}
              </Text>
              <Button
                mode="text"
                testID="exits-retry"
                style={styles.exitRetryButton}
                onPress={() => {
                  if (task) {
                    loadAvailableExits(task);
                  }
                }}>
                Проверить ещё раз
              </Button>
            </>
          ) : exits.length > 0 ? (
            exits.map(exit => (
              <Button
                key={exit.id}
                mode="outlined"
                testID={'exit-' + exit.id}
                style={styles.exitButton}
                onPress={() => handleExitWithData(exit)}
                loading={loading}
                disabled={
                  loading ||
                  (needsVisitConfirmation(instance) && instance.session_has_been_confirmed !== true)
                }>
                {exit.name}
              </Button>
            ))
          ) : (
            <Text testID="no-exits" style={styles.muted}>Нет доступных действий</Text>
          )}

          <VisitConfirmationBlock
            account={account}
            taskUuid={taskUuid}
            instanceId={instanceId}
            instance={instance}
            onConfirmed={() => {
              if (!account) return;
              fetchTaskById(account, taskUuid).then(r => {
                if (r.task) {
                  const inst = (r.task.instance && typeof r.task.instance === 'object') ? r.task.instance as Record<string, unknown> : {};
                  setInstance(inst);
                  const tid = readInstanceId(r.task);
                  if (tid) setInstanceId(tid);
                }
              });
            }}
          />
        </>
      )}
    </ScrollView>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.surface},
  content: {paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40},
  center: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  title: {fontWeight: 'bold', marginBottom: 16},
  input: {marginBottom: 12},
  row: {flexDirection: 'row', gap: 12},
  halfInput: {flex: 1},
  sectionTitle: {fontWeight: '600', marginBottom: 8, marginTop: 8, color: c.textSubtle},
  loadingText: {color: c.muted, marginTop: 20},
  pickerList: {
    backgroundColor: c.cellBackground,
    borderRadius: 8,
    padding: 8,
    marginBottom: 12,
  },
  pickerItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginBottom: 4,
  },
  pickerItemSelected: {backgroundColor: c.primaryLight15},
  pickerTextSelected: {color: c.primary, fontWeight: '600'},
  spareCard: {
    borderWidth: 1,
    borderColor: c.cellBackground,
    borderRadius: 8,
    padding: 8,
    marginBottom: 10,
  },
  spareMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  spareMetaText: {flex: 1, color: c.textSecondary, fontSize: 13},
  spareNumRow: {flexDirection: 'row', gap: 12},
  spareNumInput: {flex: 1},
  addButton: {marginBottom: 12, borderColor: c.primary},
  filesContainer: {marginBottom: 8},
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
    backgroundColor: c.cellBackground,
    borderRadius: 8,
    padding: 8,
  },
  fileThumb: {width: 48, height: 48, borderRadius: 6},
  fileInfo: {flex: 1},
  fileName: {flexShrink: 1},
  fileStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  fileStatusText: {fontSize: 12, color: c.muted},
  fileErrorText: {fontSize: 12, color: c.error, marginTop: 2},
  exitButton: {marginBottom: 8, borderRadius: 12},
  exitRetryButton: {alignSelf: 'flex-start', marginTop: -4, marginBottom: 8},
  muted: {color: c.muted, padding: 8},
});
