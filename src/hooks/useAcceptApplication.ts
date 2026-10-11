import {isCaptchaRequired} from '../utils/captcha';
import {useCallback, useRef, useState} from 'react';
import {Alert} from 'react-native';
import {
  getAcceptTemplate,
  getCaptchaFormFields,
  getCaptchaKeys,
  verifyCaptchaToken,
  acceptApplication,
} from '../services/elma-api';
import {ElmaRequestError} from '../types/errors';
import type {AcceptTemplate, CaptchaKeys} from '../services/elma-api';
import type {ElmaAccount} from '../types/account';
import {logDiag, shareDiagLog} from '../diag/accept-log';
import {clearAcceptTemplates} from '../services/accept-template-cache';

export type AcceptFlowState =
  | 'idle'
  | 'gettingTemplate'
  | 'gettingKeys'
  | 'captcha'
  | 'verifying'
  | 'running'
  | 'done'
  | 'error';

interface UseAcceptApplicationResult {
  flowState: AcceptFlowState;
  captchaVisible: boolean;
  captchaSiteKey: string;
  error: string | null;
  accept: (applicationId: string, account: ElmaAccount) => Promise<void>;
  showCaptcha: () => void;
  hideCaptcha: () => void;
  onCaptchaSuccess: (token: string) => Promise<void>;
  onCaptchaExpired: () => void;
  onCaptchaError: (msg: string) => void;
  onCaptchaCancel: () => void;
}

/**
 * Хук для принятия заявки с капчей reCAPTCHA v2.
 *
 * Флоу:
 *   idle → gettingTemplate → gettingKeys → captcha → verifying → running → done/error
 *
 * После успеха вызывает onDone() для перезагрузки списка.
 */
export function useAcceptApplication(
  onDone?: (account: ElmaAccount) => void,
): UseAcceptApplicationResult {
  const [flowState, setFlowState] = useState<AcceptFlowState>('idle');
  const [captchaVisible, setCaptchaVisible] = useState(false);
  const [captchaSiteKey, setCaptchaSiteKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const templateRef = useRef<AcceptTemplate | null>(null);
  const keysRef = useRef<CaptchaKeys | null>(null);
  const accountRef = useRef<ElmaAccount | null>(null);
  const contextFieldsRef = useRef<unknown[]>([]);
  const viewContextFieldsRef = useRef<unknown[]>([]);
  const applicationIdRef = useRef('');
  const tokenRef = useRef('');
  const sharedRef = useRef(false);

  const resetState = useCallback(() => {
    setFlowState('idle');
    setCaptchaVisible(false);
    setCaptchaSiteKey('');
    setError(null);
    templateRef.current = null;
    keysRef.current = null;
    contextFieldsRef.current = [];
    viewContextFieldsRef.current = [];
    applicationIdRef.current = '';
    tokenRef.current = '';
    sharedRef.current = false;
  }, []);

  const shareOnce = useCallback((reason: string) => {
    if (sharedRef.current) { return; }
    sharedRef.current = true;
    void shareDiagLog(reason);
  }, []);

  const showError = useCallback((msg: string) => {
    logDiag('error', 'сообщение пользователю: ' + msg);
    setError(msg);
    setFlowState('error');
    setCaptchaVisible(false);
    Alert.alert('Ошибка', msg);
    shareOnce('ошибка флоу');
  }, [shareOnce]);

  const runAcceptProcess = useCallback(
    async (params: {token: string; siteKey: string; secretKey: string}) => {
      const account = accountRef.current;
      const template = templateRef.current;
      const applicationId = applicationIdRef.current;

      if (!template || !account) {
        showError('Внутренняя ошибка: отсутствуют данные шаблона.');
        return;
      }

      const token = params.token;
      const hasToken = token.trim() !== '';

      try {
        let verifyDebug = '';

        if (hasToken) {
          setFlowState('verifying');
          logDiag('accept', 'captcha: токен получен, длина ' + token.length);
          const verifyResult = await verifyCaptchaToken(
            account,
            template.formCode,
            template.formVersion,
            token,
            params.siteKey,
            params.secretKey,
            template.contextFields,
            viewContextFieldsRef.current,
            applicationId,
          );
          logDiag('verify', 'verify=' + (verifyResult.verify ? ('result=' + verifyResult.verify.result + ' debug=' + verifyResult.verify.debug) : 'null (ЗАПРОС НЕ ДОШЁЛ / исключение)'));
          if (!verifyResult.verify?.result) {
            const debugMsg = verifyResult.verify?.debug || 'reCAPTCHA не пройдена';
            showError(`Проверка не пройдена: ${debugMsg}`);
            return;
          }
          verifyDebug = verifyResult.verify.debug || '';
          setFlowState('running');
        } else {
          setFlowState('running');
        }

        logDiag('run', 'PUT run, templateId=' + template.templateId);
        const runResult = await acceptApplication(account, {
          templateId: template.templateId,
          templateVersion: template.templateVersion,
          applicationId,
          formCode: template.formCode,
          token,
          siteKey: params.siteKey,
          secretKey: params.secretKey,
          debug: verifyDebug,
        });

        logDiag('run', 'ok=' + runResult.ok + (runResult.error ? ' err=' + runResult.error : ''));
        if (runResult.ok) {
          setFlowState('done');
          Alert.alert('Готово', 'Заявка принята.');
          shareOnce('заявка принята');
          onDone?.(account);
        } else {
          clearAcceptTemplates().catch(() => {});
          showError(`Ошибка запуска: ${runResult.error || 'Неизвестная ошибка'}`);
        }
      } catch (e: unknown) {
        logDiag('exception', e instanceof Error ? (e.name + ': ' + e.message) : String(e));
        clearAcceptTemplates().catch(() => {});
        if (e instanceof ElmaRequestError) {
          showError(`Ошибка: ${e.message}`);
        } else {
          showError('Неизвестная ошибка при проверке капчи.');
        }
      }
    },
    [onDone, showError, shareOnce],
  );

  /** Шаг 1-3: Получить шаблон → ViewContext поля → ключи капчи */
  const accept = useCallback(
    async (applicationId: string, account: ElmaAccount) => {
      resetState();
      accountRef.current = account;
      applicationIdRef.current = applicationId;
      setFlowState('gettingTemplate');
      logDiag('accept', 'start app=' + applicationId + ' acc=' + account.name);
      const t0 = Date.now();
      let tPrev = t0;

      try {
        // Шаг 1: Получаем шаблон.
        // Всегда пробуем взять актуальную версию формы с сервера: кэш без срока
        // жизни не даёт заметить, что форму на сервере изменили (например, убрали
        // капчу). Кэш — только запасной вариант при сбое сети.
        let templateResult = await getAcceptTemplate(account, {forceRefresh: true});
        if (!templateResult.template) {
          templateResult = await getAcceptTemplate(account);
        }
        if (!templateResult.template) {
          showError('Не удалось получить шаблон процесса. Попробуйте позже.');
          return;
        }
        templateRef.current = templateResult.template;
        contextFieldsRef.current = templateResult.template.contextFields;
        const fromCacheLabel = templateResult.fromCache ? ' (из кэша)' : ' (сеть)';
        logDiag('accept', 'template=' + templateResult.template.formCode + '/' + templateResult.template.formVersion + fromCacheLabel + ' за ' + String(Date.now() - t0) + ' мс');
        tPrev = Date.now();

        // Шаг 2+3: Получаем поля формы и ключи капчи (с возможным повтором при устаревшем кэше)
        let viewCtxResult;
        let keysResult;
        let retriedFromCache = false;

        const fetchKeys = async (tmpl: AcceptTemplate) => {
          const vCtx = await getCaptchaFormFields(account, tmpl.formCode, tmpl.formVersion);
          viewContextFieldsRef.current = vCtx.fields;
          logDiag('accept', 'formFields: ' + String(vCtx.fields.length) + ' полей за ' + String(Date.now() - tPrev) + ' мс');
          tPrev = Date.now();

          setFlowState('gettingKeys');
          const kRes = await getCaptchaKeys(account, tmpl.formCode, tmpl.formVersion, tmpl.contextFields, vCtx.fields, applicationId);
          return {vCtx, kRes};
        };

        try {
          const res = await fetchKeys(templateResult.template);
          viewCtxResult = res.vCtx;
          keysResult = res.kRes;
        } catch (stepsErr: unknown) {
          // Шаг 2-3 упал с ошибкой — если шаблон был из кэша, пробуем обновить
          if (templateResult.fromCache) {
            logDiag('accept', 'кэш шаблона устарел, повтор с сервера');
            await clearAcceptTemplates();
            const freshResult = await getAcceptTemplate(account, {forceRefresh: true});
            if (!freshResult.template) {
              showError('Не удалось получить шаблон процесса. Попробуйте позже.');
              return;
            }
            templateRef.current = freshResult.template;
            contextFieldsRef.current = freshResult.template.contextFields;
            logDiag('accept', 'template=' + freshResult.template.formCode + '/' + freshResult.template.formVersion + ' (с сервера повтор) за ' + String(Date.now() - t0) + ' мс');
            tPrev = Date.now();

            try {
              const retryRes = await fetchKeys(freshResult.template);
              viewCtxResult = retryRes.vCtx;
              keysResult = retryRes.kRes;
            } catch {
              // Повтор тоже не удался — пробрасываем оригинальную ошибку
              throw stepsErr;
            }
            retriedFromCache = true;
          } else {
            throw stepsErr;
          }
        }

        // Если keys пустые и шаблон был из кэша — повтор с сервера
        if ((!keysResult?.keys || (viewCtxResult && viewCtxResult.fields.length === 0)) && templateResult.fromCache && !retriedFromCache) {
          logDiag('accept', 'кэш шаблона устарел, повтор с сервера');
          await clearAcceptTemplates();
          const freshResult = await getAcceptTemplate(account, {forceRefresh: true});
          if (!freshResult.template) {
            showError('Не удалось получить шаблон процесса. Попробуйте позже.');
            return;
          }
          templateRef.current = freshResult.template;
          contextFieldsRef.current = freshResult.template.contextFields;
          logDiag('accept', 'template=' + freshResult.template.formCode + '/' + freshResult.template.formVersion + ' (с сервера повтор) за ' + String(Date.now() - t0) + ' мс');
          tPrev = Date.now();

          try {
            const retryRes = await fetchKeys(freshResult.template);
            viewCtxResult = retryRes.vCtx;
            keysResult = retryRes.kRes;
          } catch {
            // Повтор не удался — пробрасываем
            showError('Не удалось получить ключи reCAPTCHA. Попробуйте позже.');
            return;
          }
        }

        const captchaKeys = keysResult?.keys ?? null;
        keysRef.current = captchaKeys;
        logDiag('getKey', 'siteKey=' + (captchaKeys?.siteKey ? captchaKeys.siteKey.slice(0, 14) + '…' : 'НЕТ') + ' secretKeyLen=' + String(captchaKeys?.secretKey || '').length + ' за ' + String(Date.now() - tPrev) + ' мс');
        tPrev = Date.now();
        const siteKey = captchaKeys?.siteKey ? String(captchaKeys.siteKey) : '';
        // Капча не требуется, если её нет в форме ИЛИ сервер не отдал ключи.
        const noCaptchaInForm = viewCtxResult?.hasCaptcha === false;
        if (noCaptchaInForm || !isCaptchaRequired(captchaKeys)) {
          logDiag(
            'accept',
            (noCaptchaInForm ? 'в форме нет виджета капчи' : 'site_key пустой') +
              ' — капча не требуется, запуск без капчи',
          );
          await runAcceptProcess({token: '', siteKey: '', secretKey: ''});
          return;
        }
        setCaptchaSiteKey(siteKey);
        setCaptchaVisible(true);
        setFlowState('captcha');
        logDiag('accept', 'captcha: показ виджета, готово к показу капчи: ' + String(Date.now() - t0) + ' мс от старта');
      } catch (e: unknown) {
        logDiag('exception', e instanceof Error ? (e.name + ': ' + e.message) : String(e));
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
    [resetState, showError, runAcceptProcess],
  );

  /** Шаг 4-5: Капча пройдена — скрыть модалку и запустить процесс */
  const onCaptchaSuccess = useCallback(
    async (token: string) => {
      setCaptchaVisible(false);
      tokenRef.current = token;
      const keys = keysRef.current;
      if (!keys) {
        showError('Внутренняя ошибка: отсутствуют данные шаблона.');
        return;
      }
      await runAcceptProcess({token, siteKey: keys.siteKey, secretKey: keys.secretKey});
    },
    [runAcceptProcess, showError],
  );

  const onCaptchaExpired = useCallback(() => {
    Alert.alert('Внимание', 'reCAPTCHA истекла. Пройдите проверку снова.');
  }, []);

  const onCaptchaError = useCallback(
    (msg: string) => {
      showError(`reCAPTCHA: ${msg}`);
    },
    [showError],
  );

  const onCaptchaCancel = useCallback(() => {
    resetState();
  }, [resetState]);

  const showCaptchaModal = useCallback(() => {
    if (flowState === 'captcha') {
      setCaptchaVisible(true);
    }
  }, [flowState]);

  const hideCaptchaModal = useCallback(() => {
    setCaptchaVisible(false);
  }, []);

  return {
    flowState,
    captchaVisible,
    captchaSiteKey,
    error,
    accept,
    showCaptcha: showCaptchaModal,
    hideCaptcha: hideCaptchaModal,
    onCaptchaSuccess,
    onCaptchaExpired,
    onCaptchaError,
    onCaptchaCancel,
  };
}

/** Проверить, можно ли показать кнопку «Принять» для заявки */
export function canAccept(raw: Record<string, unknown>): boolean {
  // show_button_get_application === true
  const showBtn = raw.show_button_get_application;
  if (showBtn !== true && showBtn !== 'true') {
    return false;
  }

  // executor пустой (пустой массив или отсутствует)
  const executor = raw.executor;
  if (Array.isArray(executor) && executor.length > 0) {
    return false;
  }

  // __status.status === 1 (Новая)
  const status = raw.__status;
  if (status && typeof status === 'object') {
    const statusObj = status as Record<string, unknown>;
    if (statusObj.status !== 1 && statusObj.status !== '1') {
      return false;
    }
  }

  return true;
}
