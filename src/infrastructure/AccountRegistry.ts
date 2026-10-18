// ---------------------------------------------------------------------------
// Реестр аккаунтов: централизованное хранение и управление ElmaAccount.
// Инкапсулирует Map<string, ElmaAccount> и операции CRUD.
// НЕ зависит от AsyncStorage или zustand — персистентность на стороне вызывающего кода.
// ---------------------------------------------------------------------------

import {ElmaAccount} from '../types/account';

/**
 * AccountRegistry — потокобезопасный (на уровне одного JS-потока) реестр аккаунтов.
 *
 * Используется:
 *  - auth-store.ts для делегирования CRUD-операций
 *  - SessionManager-ом для обновления токенов/cookies после login/refresh
 *  - Domain-сервисами (через инъекцию) для получения данных аккаунта
 */
export class AccountRegistry {
  /** Внутреннее хранилище аккаунтов */
  private accounts = new Map<string, ElmaAccount>();

  // -----------------------------------------------------------------------
  // CRUD-операции
  // -----------------------------------------------------------------------

  /**
   * Добавить новый аккаунт.
   * @throws Error если аккаунт с таким ID уже существует.
   */
  add(account: ElmaAccount): void {
    if (this.accounts.has(account.id)) {
      throw new Error(`AccountRegistry: аккаунт с id="${account.id}" уже существует`);
    }
    this.accounts.set(account.id, account);
  }

  /**
   * Удалить аккаунт по ID.
   * @returns true если аккаунт был удалён, false если не найден.
   */
  remove(id: string): boolean {
    return this.accounts.delete(id);
  }

  /**
   * Обновить данные аккаунта (частичное обновление).
   * @returns Обновлённый аккаунт или undefined если не найден.
   */
  update(id: string, data: Partial<ElmaAccount>): ElmaAccount | undefined {
    const existing = this.accounts.get(id);
    if (!existing) {
      return undefined;
    }
    const updated = {...existing, ...data};
    this.accounts.set(id, updated);
    return updated;
  }

  /**
   * Получить аккаунт по ID.
   */
  get(id: string): ElmaAccount | undefined {
    return this.accounts.get(id);
  }

  /**
   * Изменить порядок аккаунтов. Неизвестные id игнорируются,
   * не перечисленные аккаунты остаются в конце в прежнем порядке.
   */
  reorder(orderedIds: string[]): void {
    const next = new Map<string, ElmaAccount>();
    for (const id of orderedIds) {
      const account = this.accounts.get(id);
      if (account) {
        next.set(id, account);
      }
    }
    for (const [id, account] of this.accounts) {
      if (!next.has(id)) {
        next.set(id, account);
      }
    }
    this.accounts = next;
  }

  /**
   * Получить все аккаунты (копия массива).
   */
  getAll(): ElmaAccount[] {
    return Array.from(this.accounts.values());
  }

  /**
   * Получить количество аккаунтов.
   */
  get size(): number {
    return this.accounts.size;
  }

  /**
   * Проверить существование аккаунта.
   */
  has(id: string): boolean {
    return this.accounts.has(id);
  }

  // -----------------------------------------------------------------------
  // Загрузка из внешнего источника (AsyncStorage)
  // -----------------------------------------------------------------------

  /**
   * Загрузить аккаунты из внешнего хранилища (например, AsyncStorage).
   * Заменяет текущее содержимое реестра.
   */
  loadAll(accounts: ElmaAccount[]): void {
    this.accounts.clear();
    for (const account of accounts) {
      this.accounts.set(account.id, account);
    }
  }

  // -----------------------------------------------------------------------
  // Вспомогательные методы
  // -----------------------------------------------------------------------

  /**
   * Найти дубликат по baseUrl + email (без учёта регистра).
   * Используется при добавлении нового аккаунта.
   */
  findDuplicate(baseUrl: string, email: string): ElmaAccount | undefined {
    const normalizedUrl = baseUrl.replace(/\/+$/, '');
    const normalizedEmail = email.toLowerCase();
    for (const account of this.accounts.values()) {
      if (
        account.baseUrl.replace(/\/+$/, '') === normalizedUrl &&
        (account.email || '').toLowerCase() === normalizedEmail
      ) {
        return account;
      }
    }
    return undefined;
  }

  /**
   * Выбрать уникальный цвет для нового аккаунта из заданного списка.
   */
  pickColor(availableColors: string[]): string {
    const usedColors = new Set(
      Array.from(this.accounts.values()).map(a => a.color),
    );
    // Сначала ищем неиспользованный цвет
    for (const color of availableColors) {
      if (!usedColors.has(color)) {
        return color;
      }
    }
    // Все цвета заняты — берём по кругу
    return availableColors[this.accounts.size % availableColors.length];
  }
}
