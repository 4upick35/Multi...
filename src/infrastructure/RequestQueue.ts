// ---------------------------------------------------------------------------
// Ограниченность-параллельная очередь запросов к хостам.
// До HOST_MAX_CONCURRENCY одновременных задач на один origin;
// между задачами в каждом слоте — пауза HOST_MIN_GAP_MS (антибан).
// Минимальный интервал между запросами к одному хосту: REQUEST_GAP_MS (200 мс).
// Новые задачи ставятся в общий pending-список хоста и занимают первый
// освободившийся слот.
// Интерфейс enqueue<T>(origin, fn): Promise<T> сохранён.
// ---------------------------------------------------------------------------

import {HOST_MIN_GAP_MS, HOST_MAX_CONCURRENCY} from '../config/constants';
import {delay} from '../native/KeepAlive';

/** Минимальный интервал между любыми двумя запросами к одному origin (мс). */
const REQUEST_GAP_MS = 200;

interface QueueEntry {
  run: () => Promise<void>;
}

interface Slot {
  busy: boolean;
}

interface HostState {
  slots: Slot[];
  pending: QueueEntry[];
  lastRequestAt: number;
}

/**
 * Очередь с ограниченной параллельностью для запросов к одному хосту.
 * Максимум HOST_MAX_CONCURRENCY одновременных задач на origin,
 * остальные ждут в очереди. Между задачами в каждом слоте — пауза HOST_MIN_GAP_MS.
 */
export class RequestQueue {
  private hosts = new Map<string, HostState>();

  /**
   * Поставить задачу в очередь для указанного хоста и вернуть промис результата.
   *
   * @param origin Origin сервера (например "https://example.com").
   * @param fn Асинхронная функция, которую нужно выполнить.
   * @returns Промис с результатом выполнения fn.
   */
  enqueue<T>(origin: string, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry = {
        run: async () => {
          try {
            resolve(await fn());
          } catch (err) {
            reject(err);
          }
        },
      };

      const state = this.getHostState(origin);

      // Обеспечиваем минимальный интервал REQUEST_GAP_MS между запросами к одному origin
      const now = Date.now();
      const elapsed = now - state.lastRequestAt;
      if (elapsed < REQUEST_GAP_MS && state.slots.every(s => s.busy)) {
        // Если все слоты заняты и прошло меньше REQUEST_GAP_MS, ждём до конца интервала
        const waitMs = REQUEST_GAP_MS - elapsed;
        entry.run = async () => {
          await delay(waitMs);
          try {
            resolve(await fn());
          } catch (err) {
            reject(err);
          }
        };
      }

      // Ищем свободный слот
      const freeSlot = state.slots.find((s) => !s.busy);
      if (freeSlot) {
        this.runInSlot(state, freeSlot, entry, origin);
      } else {
        state.pending.push(entry);
      }
    });
  }

  // --- Приватные методы ---

  private getHostState(origin: string): HostState {
    if (!this.hosts.has(origin)) {
      const slots: Slot[] = [];
      for (let i = 0; i < HOST_MAX_CONCURRENCY; i++) {
        slots.push({busy: false});
      }
      this.hosts.set(origin, {slots, pending: [], lastRequestAt: 0});
    }
    return this.hosts.get(origin)!;
  }

  private runInSlot(state: HostState, slot: Slot, entry: QueueEntry, origin: string): void {
    slot.busy = true;
    entry.run().finally(() => {
      state.lastRequestAt = Date.now();
      // Пауза между задачами в слоте — нативным таймером: JS-setTimeout в свёрнутом
      // приложении не срабатывает, из-за чего слот не освобождался, и после
      // HOST_MAX_CONCURRENCY запросов вся синхронизация вставала навсегда.
      void delay(HOST_MIN_GAP_MS).then(() => {
        const next = state.pending.shift();
        if (next) {
          this.runInSlot(state, slot, next, origin);
        } else {
          slot.busy = false;
        }
      });
    });
  }
}
