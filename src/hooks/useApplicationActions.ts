import {useCallback, useState} from 'react';
import {Alert} from 'react-native';
import {
  getScheduleVisitTemplate,
  getScheduleVisitInitData,
  getMasterProfiles,
  runScheduleVisit,
  getDocumentPackageTemplate,
  runDocumentPackage,
} from '../services/elma-api';
import {ElmaRequestError} from '../types/errors';
import type {MasterProfile} from '../services/elma-api';
import type {ElmaAccount} from '../types/account';
import {loadCollection} from '../services/customer-service';

export type ActionsState = 'idle' | 'loadingForm' | 'readyToSchedule' | 'sending' | 'done' | 'error';

interface UseApplicationActionsResult {
  actionState: ActionsState;
  masters: MasterProfile[];
  minDate: Date | null;
  error: string | null;
  defaultMasterId: string | null;
  scheduleVisit: (applicationId: string) => Promise<void>;
  submitVisit: (applicationId: string, visitDateIso: string, masterId: string) => Promise<boolean>;
  createDocumentPackage: (applicationId: string) => Promise<boolean>;
  cancelSchedule: () => void;
}

/**
 * Хук для действий по заявке: «Назначить визит» и «Сформировать пакет документов».
 */
export function useApplicationActions(
  account: ElmaAccount | null,
  onDone?: () => void,
): UseApplicationActionsResult {
  const [actionState, setActionState] = useState<ActionsState>('idle');
  const [masters, setMasters] = useState<MasterProfile[]>([]);
  const [minDate, setMinDate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [defaultMasterId, setDefaultMasterId] = useState<string | null>(null);

  const showError = useCallback((msg: string) => {
    setError(msg);
    setActionState('error');
    Alert.alert('Ошибка', msg);
  }, []);

  /** Назначить визит: получить шаблон → init → мастеров → показать модалку */
  const scheduleVisit = useCallback(
    async (applicationId: string) => {
      if (!account) {
        return;
      }
      setActionState('loadingForm');
      setError(null);
      setDefaultMasterId(null);

      try {
        const templateResult = await getScheduleVisitTemplate(account);
        if (!templateResult.template) {
          showError('Не удалось получить шаблон процесса. Попробуйте позже.');
          return;
        }
        const {template} = templateResult;

        const initResult = await getScheduleVisitInitData(
          account,
          template.formCode,
          template.formVersion,
          template.contextFields,
          applicationId,
        );
        if (!initResult.init) {
          showError('Не удалось загрузить данные формы. Попробуйте позже.');
          return;
        }

        const {masterIds, minDate: minDateStr} = initResult.init;

        if (masterIds.length === 0) {
          showError('Нет доступных мастеров для назначения.');
          return;
        }

        const profilesResult = await getMasterProfiles(account, masterIds);
        setMasters(profilesResult.masters);

        if (minDateStr) {
          setMinDate(new Date(minDateStr));
        } else {
          setMinDate(new Date());
        }

        setDefaultMasterId(initResult.init.preselectedMasterId ?? null);

        setActionState('readyToSchedule');
      } catch (e: unknown) {
        if (e instanceof ElmaRequestError) {
          if (e.kind === 'unauthorized' || e.status === 403) {
            showError('Нет доступа. Проверьте права.');
          } else if (e.kind === 'network') {
            showError('Ошибка сети. Проверьте подключение.');
          } else {
            showError(`Ошибка: ${e.message}`);
          }
        } else {
          showError('Неизвестная ошибка');
        }
      }
    },
    [account, showError],
  );

  /** Отправить выбранные дату и мастера */
  const submitVisit = useCallback(
    async (applicationId: string, visitDateIso: string, masterId: string): Promise<boolean> => {
      if (!account) {
        return false;
      }
      setActionState('sending');

      try {
        const templateResult = await getScheduleVisitTemplate(account);
        if (!templateResult.template) {
          showError('Не удалось получить шаблон процесса.');
          return false;
        }
        const {template} = templateResult;

        const runResult = await runScheduleVisit(account, {
          templateId: template.templateId,
          templateVersion: template.templateVersion,
          applicationId,
          formCode: template.formCode,
          visitDateIso,
          masterId,
        });

        if (runResult.ok) {
          setDefaultMasterId(null);
          setActionState('done');
          Alert.alert('Готово', 'Визит назначен.');
          await loadCollection(account, 'applications');
          onDone?.();
          return true;
        }
        showError(`Ошибка запуска: ${runResult.error || 'Неизвестная ошибка'}`);
        return false;
      } catch (e: unknown) {
        if (e instanceof ElmaRequestError) {
          showError(`Ошибка: ${e.message}`);
        } else {
          showError('Неизвестная ошибка при запуске процесса.');
        }
        return false;
      }
    },
    [account, onDone, showError],
  );

  /** Сформировать пакет документов */
  const createDocumentPackage = useCallback(
    async (applicationId: string): Promise<boolean> => {
      if (!account) {
        return false;
      }
      setActionState('sending');

      try {
        const templateResult = await getDocumentPackageTemplate(account);
        if (!templateResult.template) {
          showError('Не удалось получить шаблон процесса.');
          return false;
        }
        const {template} = templateResult;

        const runResult = await runDocumentPackage(account, {
          templateId: template.templateId,
          templateVersion: template.templateVersion,
          applicationId,
        });

        if (runResult.ok) {
          setActionState('done');
          Alert.alert('Готово', 'Пакет документов сформирован.');
          await loadCollection(account, 'applications');
          onDone?.();
          return true;
        }
        showError(`Ошибка запуска: ${runResult.error || 'Неизвестная ошибка'}`);
        return false;
      } catch (e: unknown) {
        if (e instanceof ElmaRequestError) {
          showError(`Ошибка: ${e.message}`);
        } else {
          showError('Неизвестная ошибка при запуске процесса.');
        }
        return false;
      }
    },
    [account, onDone, showError],
  );

  /** Отмена назначения визита */
  const cancelSchedule = useCallback(() => {
    setActionState('idle');
  }, []);

  return {
    actionState,
    masters,
    minDate,
    error,
    defaultMasterId,
    scheduleVisit,
    submitVisit,
    createDocumentPackage,
    cancelSchedule,
  };
}
