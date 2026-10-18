import React, {useState, useRef, useMemo, useEffect} from 'react';
import {View, StyleSheet, ScrollView, Alert} from 'react-native';
import {Text, Button, Chip, Divider} from 'react-native-paper';
import BackButton from '../../components/BackButton';
import ExitFormModal from '../../components/ExitFormModal';
import {useTasksStore} from '../../store/tasks-store';
import {useAuthStore} from '../../store/auth-store';
import {submitTask, fetchTaskExitsNormalized, fetchTaskTemplateExits, fetchTaskById, EXIT_CONFIRM_VISIT} from '../../services/elma-api';
import type {TaskExit, TaskExitField} from '../../services/elma-api';
import {isVisitExit} from '../../domain/visit';
import type {ElmaTask} from '../../types/task';
import {stripHtml} from '../../utils/strip-html';
import {isUuid} from '../../utils/uuid';
import {taskNodeIdFromPath, isExecutionScreenSupported, isTaskClosed} from '../../domain/TaskService';
import {logDiag} from '../../diag/accept-log';
import {getStatusLabel, getStatusColor, getPriorityLabel, taskFromRaw} from '../../services/task-service';
import {useSecureScreen} from '../../hooks/useSecureScreen';
import {getRemainingPauseMs} from '../../services/throttle';
import {enqueuePendingAction, processPendingActions, removePendingAction} from '../../services/action-queue';
import {usePendingActionsFor} from '../../hooks/usePendingActionsFor';
import {isNetworkErrorText} from '../../utils/error-text';
import {hapticFeedback} from '../../native/KeepAlive';
import {useAppTheme} from '../../theme';
import {SUBMIT_MIN_GAP_MS} from '../../config/constants';
import QuantumLoader from '../../components/QuantumLoader';

type Props = {taskId: string; accountId: string; onBack: () => void; onExecution?: () => void};
type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

export default function TaskDetailScreen({taskId, accountId, onBack, onExecution}: Props) {
  useSecureScreen();
  const taskFromStore = useTasksStore(s =>
    s.tasksByAccount[accountId]?.find(t => t.id === taskId),
  );
  const accountFromStore = useAuthStore(s => s.accounts.find(a => a.id === accountId));

  const account = accountFromStore ?? null;
  const [fetchedTask, setFetchedTask] = useState<ElmaTask | null>(null);
  const [fetchDone, setFetchDone] = useState(false);
  const loadAttemptedRef = useRef(false);
  const exitsRequestRef = useRef(false);

  // Открытие из уведомления: задача может ещё не быть в сторе — догружаем её.
  useEffect(() => {
    if (taskFromStore || fetchedTask || !accountFromStore || loadAttemptedRef.current) {
      setFetchDone(true);
      return;
    }
    loadAttemptedRef.current = true;
    let mounted = true;
    fetchTaskById(accountFromStore, taskId)
      .then(result => {
        if (mounted && result.task) {
          setFetchedTask(taskFromRaw(result.task, accountFromStore));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) {
          setFetchDone(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, [taskFromStore, fetchedTask, accountFromStore, taskId]);

  const task = taskFromStore ?? fetchedTask ?? null;
  const pendingExit = usePendingActionsFor(accountId, taskId, 'submit-exit');
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [loading, setLoading] = useState(false);
  const [exits, setExits] = useState<TaskExit[]>([]);
  const [exitsLoading, setExitsLoading] = useState(false);
  const [exitsLoaded, setExitsLoaded] = useState(false);
  // Обязательные поля формы выхода: exitId -> список кодов полей (required).
  // Заполняется ТОЛЬКО при нажатии «Действия» (грузить шаблон при монтировании
  // нельзя — это даёт всплеск запросов и бан ELMA).
  const [exitRequiredFields, setExitRequiredFields] = useState<Record<string, string[]>>({});
  // Полные описания полей формы выхода (label/type/collection из template.context):
  // exitId -> поля. Заполняется там же, где и exitRequiredFields.
  const [exitFieldsById, setExitFieldsById] = useState<Record<string, TaskExitField[]>>({});
  // Выход, для которого открыта форма заполнения полей.
  const [exitForm, setExitForm] = useState<TaskExit | null>(null);
  // instance задачи для предзаполнения формы выхода: грузится ОДИН раз — только
  // по нажатию выхода с обязательными полями (см. performExit).
  const [exitInstance, setExitInstance] = useState<Record<string, unknown> | undefined>(undefined);
  // Кнопки выходов показываем ТОЛЬКО когда карта обязательных полей загружена:
  // иначе пользователь успевает нажать выход, который требует форму, и запрос
  // уходит «пустым» — сервер отвечает ошибкой и временным баном (пустые списки).
  const [exitsFieldsReady, setExitsFieldsReady] = useState(false);
  // Проверка обязательных полей НЕ прошла (нет координат шаблона, шаблон не
  // загрузился или исключение) — кнопки выходов показывать нельзя (fail closed).
  const [exitsCheckFailed, setExitsCheckFailed] = useState(false);
  // Сервер отдал выход подтверждения визита — подсказываем про СМС.
  const [hasVisitExit, setHasVisitExit] = useState(false);
  // Отметка времени последней отправки — защита от серии быстрых нажатий.
  const lastSubmitAtRef = useRef(0);

  // Выходы загружаются ЛЕНИВО — только по нажатию кнопки «Действия».
  // Повторная загрузка разрешена (после ошибки или пустого списка).
  const loadExits = async () => {
    const pauseLeft = getRemainingPauseMs(accountId);
    if (pauseLeft > 0) {
      Alert.alert('Сервер ограничил запросы', 'ELMA временно ограничила запросы для этого аккаунта. Подождите ~' + Math.ceil(pauseLeft / 60000) + ' мин — частые нажатия продлевают ограничение.');
      return;
    }
    if (!account || !taskId || exitsRequestRef.current) return;
    exitsRequestRef.current = true;
    setExitsLoading(true);
    setExitsFieldsReady(false);
    setExitsCheckFailed(false);
    try {
      const result = await fetchTaskExitsNormalized(account, taskId);
      const serverExits = result.filter(e => !isVisitExit(e));
      const serverVisit = result.some(e => isVisitExit(e));

      // Обязательные поля формы выхода берём из шаблона процесса, но только
      // здесь (по кнопке «Действия») и с паузой — чтобы не слить два запроса
      // в один всплеск. Шаблон кэшируется на 10 минут в API-слое.
      const templateNsAndCode = task?.templateNsAndCode || '';
      const nodeId = taskNodeIdFromPath(task?.path || '');
      if (!templateNsAndCode || !nodeId) {
        // Координат шаблона нет — проверить обязательные поля нельзя.
        // Кнопки не показываем: незаполнимый выход сервер считает странным
        // запросом, отвечает 403 и банит сессию (было на практике).
        setExitRequiredFields({});
        setExitFieldsById({});
        setExitsCheckFailed(true);
        setHasVisitExit(serverVisit);
        setExits(serverExits);
        setExitsLoaded(true);
        logDiag('exits', 'template-coords-missing task=' + taskId);
        return;
      }
      await new Promise<void>(resolve => setTimeout(resolve, 700));
      const templateExits = await fetchTaskTemplateExits(account, templateNsAndCode, nodeId);
      if (templateExits === null) {
        // Шаблон не загрузился (сеть/бан/таймаут) — обязательные поля неизвестны.
        // Кнопки НЕ показываем: иначе нажатие уйдёт «пустым» и сервер ответит 403.
        setExitRequiredFields({});
        setExitFieldsById({});
        setExitsCheckFailed(true);
        setHasVisitExit(serverVisit);
        setExits(serverExits);
        setExitsLoaded(true);
        logDiag('exits', 'template-exits-unavailable task=' + taskId);
        return;
      }
      const map: Record<string, string[]> = {};
      const fieldsMap: Record<string, TaskExitField[]> = {};
      templateExits.forEach(info => {
        const formFields = info.formFields || [];
        fieldsMap[info.id] = formFields;
        const required = formFields
          .filter(f => f.required)
          .map(f => f.code)
          .filter(Boolean);
        if (required.length > 0) {
          map[info.id] = required;
        }
      });
      setExitRequiredFields(map);
      setExitFieldsById(fieldsMap);
      setExitsFieldsReady(true);

      // Кнопки-выходы берём из шаблона процесса: серверный getexits отдаёт только
      // выходы, доступные в текущем состоянии задачи, и часто пуст. Выходы узла —
      // то же множество, что рисует веб-клиент ELMA. Если сервер всё же вернул
      // непустой список — используем его (учитывает условия на выходах).
      const templateList: TaskExit[] = templateExits
        .filter(info => !isVisitExit({id: info.id, title: info.name}))
        .map(info => ({id: info.id, key: info.id, title: info.name || info.id}));
      const templateVisit = templateExits.some(info => isVisitExit({id: info.id, title: info.name}));
      setHasVisitExit(serverVisit || templateVisit);
      setExits(serverExits.length > 0 ? serverExits : templateList);
      setExitsLoaded(true);
    } catch {
      setExits([]);
      setExitsLoaded(true);
      setExitFieldsById({});
      setExitsCheckFailed(true);
    } finally {
      exitsRequestRef.current = false;
      setExitsLoading(false);
    }
  };

  const performExit = async (exitId: string) => {
    const pauseLeft = getRemainingPauseMs(accountId);
    if (pauseLeft > 0) {
      Alert.alert('Сервер ограничил запросы', 'ELMA временно ограничила запросы для этого аккаунта. Подождите ~' + Math.ceil(pauseLeft / 60000) + ' мин — частые нажатия продлевают ограничение.');
      return;
    }
    if (!account || !task) {
      Alert.alert('Ошибка', 'Невозможно выполнить действие');
      return;
    }
    if (isTaskClosed(task.status)) {
      Alert.alert('Задача уже закрыта', 'Действия недоступны: задача уже закрыта (выполнена ранее).');
      return;
    }
    if (!task.instanceId) {
      Alert.alert('Ошибка', 'Невозможно выполнить действие: отсутствует идентификатор экземпляра');
      return;
    }
    if (exitId === EXIT_CONFIRM_VISIT) {
      Alert.alert('Визит', 'Для подтверждения визита используйте блок подтверждения на экране выполнения');
      return;
    }
    // Пока не загружена карта обязательных полей, отправлять нельзя: выход может
    // требовать форму, а «пустой» запрос сервер считает странным и банит сессию.
    if (!exitsFieldsReady) {
      Alert.alert('Подождите', 'Проверка действий ещё не завершена. Нажмите «Действия» и повторите.');
      return;
    }
    if (exitsCheckFailed) {
      Alert.alert('Не удалось проверить действия', 'Повторите нажатие «Действия» — без проверки действие не отправляется (сервер отвечает ошибкой и ограничивает доступ).');
      return;
    }
    // Несколько выходов подряд — для сервера поток странных запросов (был бан).
    // Держим паузу между отправками.
    const sinceLastSubmit = Date.now() - lastSubmitAtRef.current;
    if (lastSubmitAtRef.current > 0 && sinceLastSubmit < SUBMIT_MIN_GAP_MS) {
      Alert.alert('Слишком часто', 'Подождите пару секунд перед следующим действием.');
      return;
    }
    // Защита от «странных запросов»: отправляем только реально загруженный выход
    // (есть в списке и его id — корректный UUID от сервера). Иначе — ошибка
    // без сетевого запроса: ELMA отвечает 403 на неизвестные exit-ключи и банит сессию.
    const knownExit = exits.find(e => e.id === exitId);
    if (!knownExit || !isUuid(exitId)) {
      Alert.alert('Ошибка', 'Действие недоступно. Нажмите «Действия», чтобы обновить список.');
      return;
    }
    // Выход подтверждения визита требует код из СМС — отправлять его «пустым» нельзя.
    if (isVisitExit(knownExit)) {
      logDiag('exits', 'blocked visit exit without sms code');
      Alert.alert(
        'Нужен код из СМС',
        'Действие «' + knownExit.title + '» выполняется через блок подтверждения визита (код из СМС) на экране «Выполнение работ».',
      );
      return;
    }
    // Выход с полями формы открываем в приложении: значения уходят тем же
    // официальным PUT, что и обычный выход (submitExitWithValues).
    const requiredCodes = exitRequiredFields[knownExit.id] || [];
    if (requiredCodes.length > 0) {
      logDiag('exits', 'open exit form id=' + knownExit.id + ' count=' + requiredCodes.length);
      // instance задачи нужен, чтобы открыть форму УЖЕ заполненной — как её
      // открывает сайт: мастер только подтверждает действие. Запрос строго по
      // нажатию выхода; неудача не блокирует действие — форма откроется пустой.
      setLoading(true);
      let instance: Record<string, unknown> | undefined;
      try {
        const result = await fetchTaskById(account, taskId);
        const raw = result.task ? result.task.instance : undefined;
        if (raw && typeof raw === 'object') {
          instance = raw as Record<string, unknown>;
        }
      } catch {
        // предзаполнение необязательно
      } finally {
        setLoading(false);
      }
      setExitInstance(instance);
      setExitForm(knownExit);
      return;
    }
    lastSubmitAtRef.current = Date.now();
    logDiag('exits', 'submit exit id=' + knownExit.id + ' task=' + taskId);
    setLoading(true);
    try {
      const result = await submitTask(account, task.instanceId, task.taskId || taskId, knownExit.id);
      if (result.ok) {
        hapticFeedback('success');
        Alert.alert('Успех', 'Действие выполнено');
        onBack();
      } else if (isNetworkErrorText(result.error)) {
        // Сеть недоступна: откладываем и повторим автоматически, когда связь
        // вернётся. Выходы не прячем и обычную ошибку не показываем.
        await enqueuePendingAction({
          kind: 'submit-exit',
          accountId,
          entityId: task.taskId || taskId,
          payload: {
            taskUuid: task.taskId || taskId,
            instanceId: task.instanceId,
            exitId: knownExit.id,
          },
        });
        Alert.alert(
          'Отложено',
          'Сеть недоступна. Действие будет отправлено автоматически при восстановлении связи.',
        );
      } else {
        // Сбрасываем список выходов: после отказа состояние задачи на сервере
        // могло измениться, и «дожимать» остальные кнопки вслепую нельзя.
        setExits([]);
        setExitsLoaded(false);
        setExitsFieldsReady(false);
        logDiag('exits', 'submit-failed id=' + knownExit.id + ' err=' + String(result.error || ''));
        hapticFeedback('error');
        Alert.alert('Ошибка', result.error || 'Не удалось выполнить действие');
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * Отправка выхода с заполненной формой. Значения полей передаются пятым
   * аргументом submitTask и уходят в `data` того же официального
   * `PUT /api/bpm/tasks/{uuid}`, что и обычный выход.
   */
  const submitExitWithValues = async (exit: TaskExit, values: Record<string, unknown>) => {
    const pauseLeft = getRemainingPauseMs(accountId);
    if (pauseLeft > 0) {
      Alert.alert('Сервер ограничил запросы', 'ELMA временно ограничила запросы для этого аккаунта. Подождите ~' + Math.ceil(pauseLeft / 60000) + ' мин — частые нажатия продлевают ограничение.');
      return;
    }
    if (!account || !task || !task.instanceId) {
      Alert.alert('Ошибка', 'Невозможно выполнить действие');
      return;
    }
    // Несколько отправок подряд — для сервера поток странных запросов (был бан).
    const sinceLastSubmit = Date.now() - lastSubmitAtRef.current;
    if (lastSubmitAtRef.current > 0 && sinceLastSubmit < SUBMIT_MIN_GAP_MS) {
      Alert.alert('Слишком часто', 'Подождите пару секунд перед следующим действием.');
      return;
    }
    if (!isUuid(exit.id)) {
      Alert.alert('Ошибка', 'Действие недоступно. Нажмите «Действия», чтобы обновить список.');
      return;
    }
    lastSubmitAtRef.current = Date.now();
    logDiag('exits', 'submit exit with values id=' + exit.id + ' count=' + Object.keys(values).length);
    setLoading(true);
    try {
      const result = await submitTask(account, task.instanceId, task.taskId || taskId, exit.id, values);
      setExitForm(null);
      if (result.ok) {
        hapticFeedback('success');
        Alert.alert('Успех', 'Действие выполнено');
        onBack();
      } else if (isNetworkErrorText(result.error)) {
        // Сеть недоступна: откладываем с заполненными значениями полей и
        // повторим автоматически, когда связь вернётся.
        await enqueuePendingAction({
          kind: 'submit-exit',
          accountId,
          entityId: task.taskId || taskId,
          payload: {
            taskUuid: task.taskId || taskId,
            instanceId: task.instanceId,
            exitId: exit.id,
            values,
          },
        });
        Alert.alert(
          'Отложено',
          'Сеть недоступна. Действие будет отправлено автоматически при восстановлении связи.',
        );
      } else {
        // Сбрасываем список выходов: после отказа состояние задачи на сервере
        // могло измениться, и «дожимать» остальные кнопки вслепую нельзя.
        setExits([]);
        setExitsLoaded(false);
        setExitsFieldsReady(false);
        logDiag('exits', 'submit-failed id=' + exit.id + ' err=' + String(result.error || ''));
        hapticFeedback('error');
        Alert.alert('Ошибка', result.error || 'Не удалось выполнить действие');
      }
    } finally {
      setLoading(false);
    }
  };

  if (!task || !account) {
    if (!fetchDone) {
      return (
        <View style={styles.center}>
          <QuantumLoader />
          <BackButton onBack={onBack} />
        </View>
      );
    }
    return (
      <View style={styles.center}>
        <Text>Задача не найдена</Text>
        <BackButton onBack={onBack} />
      </View>
    );
  }

  // Кнопки выходов показываем только когда проверка обязательных полей прошла.
  const taskClosed = isTaskClosed(task.status);
  const visibleExits = exitsCheckFailed || taskClosed ? [] : exits;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <BackButton onBack={onBack} />

      <View style={styles.header}>
        <Chip style={[styles.accountChip, {backgroundColor: account.color + '20'}]} textStyle={{color: account.color}}>
          {account.name}
        </Chip>
        {task.isOverdue && <Chip style={styles.overdueChip} textStyle={{color: colors.onBackground}}>ПРОСРОЧЕНО</Chip>}
      </View>

      <Text variant="headlineSmall" style={styles.subject}>{task.subject}</Text>

      {pendingExit.length > 0 ? (
        <View style={styles.pendingCard}>
          <Text style={styles.pendingText}>
            Выход из задачи отложен и отправится автоматически при появлении сети.
          </Text>
          <View style={styles.pendingRow}>
            <Button compact mode="text" onPress={() => processPendingActions().catch(() => {})}>
              Повторить
            </Button>
            <Button
              compact
              mode="text"
              onPress={() => removePendingAction(pendingExit[0].id).catch(() => {})}>
              Отменить
            </Button>
          </View>
        </View>
      ) : null}

      <View style={styles.meta}>
        <Text style={styles.label}>Статус:</Text>
        <Chip compact style={{backgroundColor: getStatusColor(task.rawState || task.status) + '20'}} textStyle={{color: getStatusColor(task.rawState || task.status)}}>
          {getStatusLabel(task.rawState || task.status)}
        </Chip>
      </View>
      <View style={styles.meta}>
        <Text style={styles.label}>Приоритет:</Text>
        <Chip compact style={{backgroundColor: (task.priorityColor || '#9E9E9E') + '20'}} textStyle={{color: task.priorityColor || '#9E9E9E'}}>
          {task.priorityLabel || getPriorityLabel(task.priority)}
        </Chip>
      </View>
      {task.authorName ? (
        <View style={styles.meta}>
          <Text style={styles.label}>Автор:</Text>
          <Text>{task.authorName}</Text>
        </View>
      ) : null}
      {task.createdAt ? (
        <View style={styles.meta}>
          <Text style={styles.label}>Создано:</Text>
          <Text>{new Date(task.createdAt).toLocaleDateString('ru')}</Text>
        </View>
      ) : null}
      {task.dueDate ? (
        <View style={styles.meta}>
          <Text style={styles.label}>Срок:</Text>
          <Text style={task.isOverdue ? styles.overdue : undefined}>
            {new Date(task.dueDate).toLocaleDateString('ru')}
          </Text>
        </View>
      ) : null}
      {task.description ? (
        <>
          <Divider style={styles.divider} />
          <Text variant="bodyMedium" style={styles.desc}>{stripHtml(task.description)}</Text>
        </>
      ) : null}

      {/* Выход подтверждения визита требует код из СМС: он выполняется только
          через блок подтверждения на экране «Выполнение работ». */}
      {hasVisitExit ? (
        <>
          <Divider style={styles.divider} />
          <Text testID="visit-hint" style={styles.noExits}>
            Требуется подтверждение визита по СМС
          </Text>
          {onExecution ? (
            <Button
              mode="outlined"
              style={styles.relatedBtn}
              testID="open-visit-confirm"
              onPress={onExecution}>
              Подтвердить визит по СМС
            </Button>
          ) : null}
        </>
      ) : null}

      <View style={styles.actions}>
        {onExecution && isExecutionScreenSupported(task) && !taskClosed ? (
          <Button mode="contained" buttonColor={colors.primary30} style={styles.executionBtn} onPress={onExecution}>
            Выполнение работ
          </Button>
        ) : null}
        {exitsLoading || (visibleExits.length > 0 && !exitsFieldsReady) ? (
          <QuantumLoader testID="exits-indicator" />
        ) : visibleExits.length > 0 ? (
          visibleExits.map((exit, i) => (
            <Button
              key={exit.key + String(i)}
              mode={i === 0 ? 'contained' : 'outlined'}
              style={i === 0 ? styles.primaryExitBtn : styles.secondaryExitBtn}
              testID={`exit-btn-${exit.id}`}
              onPress={() => performExit(exit.id)}
              loading={loading}
              disabled={loading}>
              {exit.title}
            </Button>
          ))
        ) : taskClosed ? (
          <Text testID="task-closed" style={styles.noExits}>Задача уже закрыта</Text>
        ) : (
          <>
            <Button
              mode="outlined"
              style={styles.relatedBtn}
              testID="load-exits-btn"
              onPress={loadExits}>
              Действия
            </Button>
            {exitsLoaded && (
              <Text testID={exitsCheckFailed ? 'exits-check-failed' : 'no-exits'} style={styles.noExits}>
                {exitsCheckFailed
                  ? 'Не удалось проверить действия задачи. Нажмите «Действия» ещё раз.'
                  : 'Нет доступных действий'}
              </Text>
            )}
          </>
        )}
      </View>

      {/* Форма выхода с обязательными полями: значения уходят тем же PUT. */}
      {exitForm ? (
        <ExitFormModal
          visible
          exit={{
            id: exitForm.id,
            title: exitForm.title,
            formFields: exitFieldsById[exitForm.id] || [],
          }}
          account={account}
          instance={exitInstance}
          submitting={loading}
          onCancel={() => setExitForm(null)}
          onSubmit={values => submitExitWithValues(exitForm, values)}
        />
      ) : null}
    </ScrollView>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.surface},
  content: {paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40},
  center: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  header: {flexDirection: 'row', gap: 8, marginBottom: 12},
  accountChip: {},
  overdueChip: {backgroundColor: c.error},
  subject: {fontWeight: 'bold', marginBottom: 16},
  pendingCard: {
    backgroundColor: c.warning + '18',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  pendingText: {fontSize: 13, color: c.textPrimary},
  pendingRow: {flexDirection: 'row', justifyContent: 'flex-end', gap: 4},
  meta: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8},
  label: {fontWeight: '600', minWidth: 80},
  overdue: {color: c.error, fontWeight: 'bold'},
  divider: {marginVertical: 16},
  desc: {lineHeight: 22, color: c.textSubtle},
  actions: {marginTop: 24, gap: 12},
  exitLoader: {marginVertical: 8},
  executionBtn: {borderRadius: 12},
  relatedBtn: {borderRadius: 12},
  noExits: {textAlign: 'center', color: c.textSubtle, fontSize: 13},
  primaryExitBtn: {borderRadius: 12},
  secondaryExitBtn: {borderRadius: 12},
});
