import {useEffect} from 'react';
import {setSecureFlag} from '../native/KeepAlive';

/**
 * Включает FLAG_SECURE на текущей Activity (best-effort).
 *
 * Защита от скриншотов включена постоянно и не регулируется настройками.
 * Нативный слой (MainActivity) ставит флаг сам и никогда его не снимает,
 * поэтому cleanup ничего не делает — снять запрет скриншотов невозможно.
 * Ошибки нативного слоя гасятся.
 */
export function useSecureScreen(): void {
  useEffect(() => {
    setSecureFlag(true).catch(() => {});
  }, []);
}
