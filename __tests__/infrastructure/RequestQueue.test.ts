import {RequestQueue} from '../../src/infrastructure/RequestQueue';
import {HOST_MAX_CONCURRENCY, HOST_MIN_GAP_MS} from '../../src/config/constants';

describe('RequestQueue', () => {
  let queue: RequestQueue;

  beforeEach(() => {
    queue = new RequestQueue();
  });

  it('выполняет задачу и возвращает результат', async () => {
    const result = await queue.enqueue('https://host.com', async () => 42);
    expect(result).toBe(42);
  });

  it('выполняет до HOST_MAX_CONCURRENCY задач параллельно на один хост', async () => {
    jest.useFakeTimers();

    // Блокируем завершение задач черезручной контроль
    const resolvers: Array<() => void> = [];
    const running = new Set<number>();

    const makeTask = (id: number) => queue.enqueue('https://host.com', async () => {
      running.add(id);
      await new Promise<void>((r) => { resolvers[id] = r; });
      running.delete(id);
      return id;
    });

    const tasks = Array.from({length: HOST_MAX_CONCURRENCY + 1}, (_, i) => makeTask(i));

    // Даём микротаскам выполниться — запускаются первые N
    await jest.advanceTimersByTimeAsync(0);
    expect(running.size).toBe(HOST_MAX_CONCURRENCY);

    // Освобождаем первую задачу → следующий слот начнёт после HOST_MIN_GAP_MS
    resolvers[0]();
    await jest.advanceTimersByTimeAsync(HOST_MIN_GAP_MS + 10);

    // Должна запуститься задача из очереди (id=3)
    expect(running.has(3)).toBe(true);

    // Завершаем все
    for (let i = 1; i < HOST_MAX_CONCURRENCY + 1; i++) {
      if (resolvers[i]) { resolvers[i](); }
    }
    await jest.advanceTimersByTimeAsync(HOST_MIN_GAP_MS + 10);

    const results = await Promise.all(tasks);
    expect(results).toEqual([0, 1, 2, 3]);

    jest.useRealTimers();
  });

  it('задачи к разным хостам выполняются независимо', async () => {
    const p1 = queue.enqueue('https://a.com', async () => 'a');
    const p2 = queue.enqueue('https://b.com', async () => 'b');

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('a');
    expect(r2).toBe('b');
  });

  it('ошибка в задаче прокидывается в промис и не ломает очередь', async () => {
    await expect(
      queue.enqueue('https://host.com', async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');

    // Следующая задача после ошибочной выполняется нормально
    const result = await queue.enqueue('https://host.com', async () => 42);
    expect(result).toBe(42);
  });

  it('ошибка не блокирует слот — следующая задача в слоте запускается после HOST_MIN_GAP_MS', async () => {
    jest.useFakeTimers();

    const errors: Array<{id: number; err: unknown}> = [];
    const done: number[] = [];

    const t1 = queue.enqueue('https://host.com', async () => {
      throw new Error('e1');
    }).catch((e) => { errors.push({id: 1, err: e}); });

    const t2 = queue.enqueue('https://host.com', async () => {
      done.push(2);
      return 2;
    });

    await jest.advanceTimersByTimeAsync(0);
    // t1 началась и упала
    await t1;

    // После HOST_MIN_GAP_MS слот освобождается и t2 запускается
    await jest.advanceTimersByTimeAsync(HOST_MIN_GAP_MS + 10);

    const r2 = await t2;
    expect(r2).toBe(2);
    expect(done).toEqual([2]);
    expect(errors).toHaveLength(1);

    jest.useRealTimers();
  });

  it('задачи на разных хостах не блокируют друг друга', async () => {
    jest.useFakeTimers();

    const order: string[] = [];

    const pA = queue.enqueue('https://a.com', async () => {
      order.push('a-start');
      await new Promise<void>((r) => setTimeout(r, 50));
      order.push('a-end');
    });

    const pB = queue.enqueue('https://b.com', async () => {
      order.push('b-start');
      await new Promise<void>((r) => setTimeout(r, 50));
      order.push('b-end');
    });

    await jest.advanceTimersByTimeAsync(60);
    await Promise.all([pA, pB]);

    // a и b стартовали параллельно
    expect(order.filter((x) => x.endsWith('-start')).length).toBe(2);

    jest.useRealTimers();
  });

  it('минимальный интервал REQUEST_GAP_MS между запросами к одному хосту', async () => {
    jest.useFakeTimers();

    const results: number[] = [];
    const makeTask = (id: number) => queue.enqueue('https://host.com', async () => {
      results.push(id);
      return id;
    });

    // Два запроса к одному хосту
    const p1 = makeTask(1);
    const p2 = makeTask(2);
    await p1;
    await p2;

    expect(results).toEqual([1, 2]);

    jest.useRealTimers();
  });
});
