import {useState, useCallback, useEffect, useRef} from 'react';
import {generateVisitCode, validateVisitCode} from '../utils/visit-code';
import {sendVisitConfirmationCode, confirmVisit} from '../services/elma-api';
import type {ElmaAccount} from '../types/account';

type Step = 'idle' | 'sending' | 'sent' | 'confirming' | 'error' | 'confirmed';

interface UseVisitConfirmationState {
  step: Step;
  code: string;
  generatedCode: string;
  sendSmsLogs: string;
  cooldownLeft: number;
  withoutConfirmation: boolean;
  reason: string;
  error: string;
}

interface UseVisitConfirmationReturn extends UseVisitConfirmationState {
  setCode: (code: string) => void;
  setWithoutConfirmation: (v: boolean) => void;
  setReason: (reason: string) => void;
  sendCode: () => Promise<void>;
  confirm: () => Promise<void>;
  reset: () => void;
}

const COOLDOWN_SECONDS = 60;

export function useVisitConfirmation(
  account: ElmaAccount | null,
  taskUuid: string,
  instanceId: string,
  instance: Record<string, unknown>,
  onConfirmed: () => void,
): UseVisitConfirmationReturn {
  const [state, setState] = useState<UseVisitConfirmationState>(() => ({
    step: 'idle',
    code: '',
    generatedCode: '',
    sendSmsLogs: '',
    cooldownLeft: 0,
    withoutConfirmation: instance?.without_session_confirmation === true,
    reason: typeof instance?.reason_for_lack_of_confirmation === 'string'
      ? (instance.reason_for_lack_of_confirmation as string)
      : '',
    error: '',
  }));

  const deadlineRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearIntervalRef = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startInterval = useCallback(() => {
    clearIntervalRef();
    intervalRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setState(prev => ({...prev, cooldownLeft: remaining}));
      if (remaining <= 0 && deadlineRef.current > 0) {
        clearIntervalRef();
        setState(prev => ({...prev, cooldownLeft: 0, step: 'sent'}));
      }
    }, 200);
  }, [clearIntervalRef]);

  useEffect(() => {
    startInterval();
    return () => { clearIntervalRef(); };
  }, [startInterval, clearIntervalRef]);

  useEffect(() => {
    return () => { clearIntervalRef(); };
  }, [clearIntervalRef]);

  const setCode = useCallback((code: string) => {
    setState(prev => ({...prev, code, error: ''}));
  }, []);

  const setWithoutConfirmation = useCallback((v: boolean) => {
    setState(prev => ({...prev, withoutConfirmation: v, error: ''}));
  }, []);

  const setReason = useCallback((reason: string) => {
    setState(prev => ({...prev, reason, error: ''}));
  }, []);

  const reset = useCallback(() => {
    deadlineRef.current = 0;
    clearIntervalRef();
    setState({
      step: 'idle',
      code: '',
      generatedCode: '',
      sendSmsLogs: '',
      cooldownLeft: 0,
      withoutConfirmation: false,
      reason: '',
      error: '',
    });
    startInterval();
  }, [clearIntervalRef, startInterval]);

  const sendCode = useCallback(async () => {
    const isOnCooldown = deadlineRef.current > 0 && Date.now() < deadlineRef.current;
    if (!account || isOnCooldown) return;
    const code = generateVisitCode();
    setState(prev => ({...prev, generatedCode: code, step: 'sending', error: ''}));
    try {
      const result = await sendVisitConfirmationCode(account, {
        taskUuid,
        code,
        instance,
      });
      if (result.ok) {
        deadlineRef.current = Date.now() + COOLDOWN_SECONDS * 1000;
        setState(prev => ({
          ...prev,
          step: 'sent',
          sendSmsLogs: result.sendSmsLogs,
          cooldownLeft: COOLDOWN_SECONDS,
        }));
      } else {
        const serverText = (result.sendSmsLogs || '').trim();
        const errorText = serverText !== '' ? serverText : 'Ошибка отправки СМС';
        setState(prev => ({...prev, step: 'error', error: errorText, sendSmsLogs: result.sendSmsLogs}));
      }
    } catch {
      setState(prev => ({...prev, step: 'error', error: 'Ошибка сети'}));
    }
  }, [account, taskUuid, instance]);

  const confirm = useCallback(async () => {
    if (!account) return;
    if (!state.withoutConfirmation && !validateVisitCode(state.code)) {
      setState(prev => ({...prev, error: 'Код должен содержать 4 цифры'}));
      return;
    }
    if (state.withoutConfirmation && !state.reason.trim()) {
      setState(prev => ({...prev, error: 'Укажите причину отсутствия подтверждения'}));
      return;
    }
    setState(prev => ({...prev, step: 'confirming', error: ''}));
    try {
      const result = await confirmVisit(account, {
        taskUuid,
        instanceId,
        code: state.code,
        withoutConfirmation: state.withoutConfirmation,
        reason: state.withoutConfirmation ? state.reason : undefined,
        sendSmsLogs: state.sendSmsLogs || undefined,
      });
      if (result.confirmed) {
        setState(prev => ({...prev, step: 'confirmed'}));
        onConfirmed();
      } else {
        setState(prev => ({...prev, step: 'error', error: 'Неверный код подтверждения'}));
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setState(prev => ({...prev, step: 'error', error: msg}));
    }
  }, [account, taskUuid, instanceId, state.code, state.withoutConfirmation, state.reason, state.sendSmsLogs, onConfirmed]);

  return {
    ...state,
    setCode,
    setWithoutConfirmation,
    setReason,
    sendCode,
    confirm,
    reset,
  };
}
