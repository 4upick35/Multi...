/** Порт сигнала о бане/пустых ответах — домен не зависит от инфраструктуры. */
export interface ThrottlePort {
  recordBanSignal(accountId: string, reason: string): void;
}
