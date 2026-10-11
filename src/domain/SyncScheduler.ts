// ---------------------------------------------------------------------------
// SyncScheduler — доменный планировщик синхронизации задач.
// Инкапсулирует логику поллинга: jitter, backoff, debounce, подписки.
// Зависит от инжектированных интерфейсов — НЕ от zustand-сторов напрямую.
// ---------------------------------------------------------------------------

import {ElmaAccount} from '../types/account';
import {
  MAX_CONSECUTIVE_ERRORS,
  BACKOFF_CAP_MS,
  POLL_JITTER_MIN,
  POLL_JITTER_MAX,
} from '../config/constants';
import {nextAccountGapMs} from '../utils/poll-interval';

// ---------------------------------------------------------------------------
// Локальный тип результата (без импорта task-service)
// ---------------------------------------------------------------------------

export interface SyncRefreshResult {
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Интерфейс зависимостей (инжекция через конструктор)
// ---------------------------------------------------------------------------

export interface SyncSchedulerDeps {
  /** Функция обновления задач аккаунта (делегируется в task-service) */
  refreshAccountTasks: (account: ElmaAccount) => Promise<SyncRefreshResult>;
  /** Получить текущий список аккаунтов (из auth-store) */
  getAccounts: () => ElmaAccount[];
  /** Получить интервал поллинга в мс (из settings-store, с учётом hydrated) */
  getPollIntervalMs: () => number;
  /** Проверить, на паузе ли синхронизация */
  isSyncPaused: () => boolean;
  /** Получить состояния синхронизации аккаунтов (из tasks-store) */
  getTasksSyncStates: () => Record<string, {status: string; lastSyncAt?: number; consecutiveErrors: number}>;
  /** Подписка на изменения auth-store (возвращает отписку) */
  subscribeAuth: (callback: (accounts: ElmaAccount[]) => void) => () => void;
  /** Подписка на изменения settings-store (возвращает отписку) */
  subscribeSettings: (callback: () => void) => () => void;
}

// ---------------------------------------------------------------------------
// SyncScheduler
// ---------------------------------------------------------------------------

/**
 * Доменный планировщик синхронизации задач.
 *
 * Периодически опрашивает ELMA-сервер для обновления задач.
 * Поддерживает: jitter, exponential backoff, debounce при смене аккаунтов,
 * пропуск аккаунтов в auth-error состоянии (~10 мин), debounce 800мс.
 *
 * Все зависимости инжектируются через конструктор — прямых импортов
 * zustand-сторов или task-service в классе НЕТ.
 */
export class SyncScheduler {
  // Приватные поля для таймеров и подписок
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private unsubAuth: (() => void) | null = null;
  private unsubSettings: (() => void) | null = null;
  private debounceId: ReturnType<typeof setTimeout> | null = null;
  private accountsSnapshot: ElmaAccount[] = [];

  constructor(private deps: SyncSchedulerDeps) {}

  // -----------------------------------------------------------------------
  // Публичные методы
  // -----------------------------------------------------------------------

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;

    // Подписка на список аккаунтов
    this.accountsSnapshot = [...this.deps.getAccounts()];
    this.unsubAuth = this.deps.subscribeAuth((accounts) => {
      const prev = this.accountsSnapshot;
      this.accountsSnapshot = [...accounts];
      this.onAccountsChanged(this.accountsSnapshot, prev);
    });

    // Подписка на изменения настроек (перезапуск цикла с новым интервалом)
    this.unsubSettings = this.deps.subscribeSettings(() => {
      if (this.running && this.timerId) {
        clearTimeout(this.timerId);
        this.timerId = null;
        this.debouncedTrigger();
      }
    });

    // Немедленный поллинг (пропускаем при паузе)
    if (this.deps.isSyncPaused()) {
      this.scheduleNext();
      return;
    }
    const accounts = this.deps.getAccounts();
    if (accounts.length > 0) {
      this.pollOnce(accounts).finally(() => {
        if (this.running) {
          this.scheduleNext();
        }
      });
    } else {
      this.scheduleNext();
    }
  }

  stop(): void {
    this.running = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.debounceId) {
      clearTimeout(this.debounceId);
      this.debounceId = null;
    }
    if (this.unsubAuth) {
      this.unsubAuth();
      this.unsubAuth = null;
    }
    if (this.unsubSettings) {
      this.unsubSettings();
      this.unsubSettings = null;
    }
    this.accountsSnapshot = [];
  }

  triggerNow(): void {
    if (!this.running) {
      return;
    }
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    const accounts = this.deps.getAccounts();
    if (accounts.length > 0) {
      this.pollOnce(accounts, true).finally(() => {
        if (this.running) {
          this.scheduleNext();
        }
      });
    }
  }

  // -----------------------------------------------------------------------
  // Приватные методы
  // -----------------------------------------------------------------------

  /**
   * Jitter — случайное число 0–10_000 мс (идентично оригиналу).
   */
  private jitter(): number {
    return Math.floor(Math.random() * 10_000);
  }

  /**
   * Exponential backoff с jitter и cap.
   */
  private backoffDelayMs(intervalMs: number, consecutiveErrors: number): number {
    const exp = Math.min(consecutiveErrors, MAX_CONSECUTIVE_ERRORS);
    const raw = intervalMs * Math.pow(2, exp) + this.jitter();
    return Math.min(raw, BACKOFF_CAP_MS);
  }

  /**
   * Случайный интервал с jitter-коэффициентом.
   */
  private randomIntervalMs(): number {
    const base = this.deps.getPollIntervalMs();
    const coeff = POLL_JITTER_MIN + Math.random() * (POLL_JITTER_MAX - POLL_JITTER_MIN);
    return Math.max(Math.round(base * coeff / 1000) * 1000, 10_000);
  }

  /**
   * Обновить учётку, если пришло время (проверки auth-status, backoff).
   */
  private async refreshAccountIfDue(
    account: ElmaAccount,
    intervalMs: number,
    syncStates: ReturnType<SyncSchedulerDeps['getTasksSyncStates']>,
  ): Promise<void> {
    const syncState = syncStates[account.id];

    // Если аккаунт в auth-error — повторяем реже (~каждые 10 мин)
    if (syncState?.status === 'auth') {
      const lastSync = syncState.lastSyncAt || 0;
      const tenMin = 10 * 60 * 1000;
      if (Date.now() - lastSync < tenMin) {
        return;
      }
    }

    // Если много последовательных ошибок — exponential backoff
    if (
      syncState?.consecutiveErrors &&
      syncState.consecutiveErrors > 0 &&
      syncState.status !== 'auth'
    ) {
      const lastSync = syncState.lastSyncAt || 0;
      const delay = this.backoffDelayMs(intervalMs, syncState.consecutiveErrors);
      if (Date.now() - lastSync < delay) {
        return;
      }
    }

    await this.deps.refreshAccountTasks(account);
  }

  /**
   * Один цикл поллинга для всех аккаунтов.
   * При immediate=true — все учётки параллельно без разноса.
   */
  private async pollOnce(accounts: ElmaAccount[], immediate = false): Promise<void> {
    const intervalMs = this.deps.getPollIntervalMs();
    const syncStates = this.deps.getTasksSyncStates();

    if (immediate) {
      await Promise.all(
        accounts.map((account) => this.refreshAccountIfDue(account, intervalMs, syncStates)),
      );
      return;
    }

    for (let i = 0; i < accounts.length; i++) {
      if (i > 0) {
        // Разнос между стартами обновления разных учёток
        const gap = nextAccountGapMs();
        await new Promise<void>((resolve) => setTimeout(resolve, gap));
      }

      await this.refreshAccountIfDue(accounts[i], intervalMs, syncStates);
    }
  }

  /**
   * Планирование следующего цикла поллинга.
   */
  private scheduleNext(): void {
    if (!this.running) {
      return;
    }
    if (this.deps.isSyncPaused()) {
      // При паузе — проверяем каждые 5 сек, не сняли ли паузу
      this.timerId = setTimeout(() => {
        this.timerId = null;
        if (this.running) {
          this.scheduleNext();
        }
      }, 5_000);
      return;
    }
    const intervalMs = this.randomIntervalMs();
    this.timerId = setTimeout(async () => {
      if (!this.running) {
        return;
      }
      const accounts = this.deps.getAccounts();
      if (accounts.length > 0) {
        await this.pollOnce(accounts);
      }
      this.scheduleNext();
    }, intervalMs);
  }

  /**
   * Debounce-триггер (при смене списка аккаунтов, 800мс).
   */
  private debouncedTrigger(): void {
    if (this.debounceId) {
      clearTimeout(this.debounceId);
    }
    this.debounceId = setTimeout(() => {
      this.debounceId = null;
      if (!this.running) {
        return;
      }
      if (this.timerId) {
        clearTimeout(this.timerId);
        this.timerId = null;
      }
      const accounts = this.deps.getAccounts();
      if (accounts.length > 0) {
        this.pollOnce(accounts).finally(() => {
          if (this.running) {
            this.scheduleNext();
          }
        });
      }
    }, 800);
  }

  /**
   * Обработка изменения списка аккаунтов.
   */
  private onAccountsChanged(
    current: ElmaAccount[],
    previous: ElmaAccount[],
  ): void {
    const currIds = current.map((a) => a.id).sort();
    const prevIds = previous.map((a) => a.id).sort();
    const changed =
      currIds.length !== prevIds.length ||
      currIds.some((id, i) => id !== prevIds[i]);
    if (changed) {
      this.debouncedTrigger();
    }
  }
}
