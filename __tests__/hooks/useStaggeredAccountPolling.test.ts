import React from 'react';
import {create} from 'react-test-renderer';
import {useStaggeredAccountPolling} from '../../src/hooks/useStaggeredAccountPolling';
import {
  nextAccountIntervalMs,
  nextAccountGapMs,
} from '../../src/utils/poll-interval';
import {ACCOUNT_SYNC_MIN_GAP_MS, ACCOUNT_SYNC_GAP_JITTER_MS} from '../../src/config/constants';

jest.mock('../../src/config/constants', () => {
  const actual = jest.requireActual('../../src/config/constants');
  return {
    ...actual,
    ACCOUNT_SYNC_MIN_GAP_MS: 120,
    ACCOUNT_SYNC_GAP_JITTER_MS: 10,
  };
});

async function waitFor(
  condition: () => boolean,
  timeoutMs: number = 2000,
  intervalMs: number = 10,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

// ---------------------------------------------------------------------------
// Тесты чистых функций
// ---------------------------------------------------------------------------

describe('nextAccountIntervalMs', () => {
  it('returns value >= baseIntervalMs', () => {
    for (let i = 0; i < 50; i++) {
      const result = nextAccountIntervalMs(30_000, 15_000);
      expect(result).toBeGreaterThanOrEqual(30_000);
    }
  });

  it('returns value < baseIntervalMs + jitterMs', () => {
    for (let i = 0; i < 50; i++) {
      const result = nextAccountIntervalMs(30_000, 15_000);
      expect(result).toBeLessThan(30_000 + 15_000);
    }
  });

  it('produces varied values', () => {
    const values = new Set<number>();
    for (let i = 0; i < 100; i++) {
      values.add(nextAccountIntervalMs(30_000, 15_000));
    }
    expect(values.size).toBeGreaterThan(1);
  });

  it('works with zero jitter', () => {
    for (let i = 0; i < 10; i++) {
      expect(nextAccountIntervalMs(30_000, 0)).toBe(30_000);
    }
  });
});

describe('nextAccountGapMs', () => {
  it('returns value >= ACCOUNT_SYNC_MIN_GAP_MS', () => {
    for (let i = 0; i < 50; i++) {
      const result = nextAccountGapMs();
      expect(result).toBeGreaterThanOrEqual(ACCOUNT_SYNC_MIN_GAP_MS);
    }
  });

  it('returns value <= ACCOUNT_SYNC_MIN_GAP_MS + ACCOUNT_SYNC_GAP_JITTER_MS', () => {
    for (let i = 0; i < 50; i++) {
      const result = nextAccountGapMs();
      expect(result).toBeLessThanOrEqual(
        ACCOUNT_SYNC_MIN_GAP_MS + ACCOUNT_SYNC_GAP_JITTER_MS,
      );
    }
  });

  it('produces varied values', () => {
    const values = new Set<number>();
    for (let i = 0; i < 100; i++) {
      values.add(nextAccountGapMs());
    }
    expect(values.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Тесты поведения хука (реальные таймеры, маленькие замоканные константы)
// ---------------------------------------------------------------------------

describe('useStaggeredAccountPolling — hook behavior', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stagger gate: two accounts start at least ACCOUNT_SYNC_MIN_GAP_MS apart', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);

    const log: string[] = [];
    const timestamps: Record<string, number> = {};
    const callback = jest.fn().mockResolvedValue(undefined);

    const TestComponent = () => {
      const {refreshAllNow} = useStaggeredAccountPolling({
        enabled: true,
        accountIds: ['A', 'B'],
        baseIntervalMs: 60_000,
        jitterMs: 0,
        callback,
        onAccountStart: (id: string) => {
          timestamps[`start:${id}`] = Date.now();
          log.push(`start:${id}`);
        },
        onAccountEnd: (id: string) => log.push(`end:${id}`),
      });

      React.useEffect(() => {
        (global as any).__refreshAllNow = refreshAllNow;
      });

      return null;
    };

    const instance = create(React.createElement(TestComponent));

    await waitFor(() => log.includes('start:A'));
    expect(log).toContain('start:A');

    const timeOfA = timestamps['start:A'];
    await waitFor(() => log.includes('start:B'), 3000);
    const timeOfB = timestamps['start:B'];

    expect(timeOfB - timeOfA).toBeGreaterThanOrEqual(ACCOUNT_SYNC_MIN_GAP_MS);
    expect(log).toContain('start:B');

    instance.unmount();
  });

  it('refreshAllNow() awaits completion of all account updates', async () => {
    const log: string[] = [];
    const callback = jest.fn().mockImplementation(async (id: string) => {
      log.push(`callback:${id}`);
    });

    const TestComponent = () => {
      const {refreshAllNow} = useStaggeredAccountPolling({
        enabled: true,
        accountIds: ['X', 'Y'],
        baseIntervalMs: 60_000,
        jitterMs: 0,
        callback,
        onAccountStart: (id: string) => log.push(`start:${id}`),
        onAccountEnd: (id: string) => log.push(`end:${id}`),
      });

      React.useEffect(() => {
        (global as any).__refreshAllNow = refreshAllNow;
      });

      return null;
    };

    const instance = create(React.createElement(TestComponent));

    await waitFor(() => log.filter(l => l.startsWith('end:')).length === 2);
    log.length = 0;

    await (global as any).__refreshAllNow();

    expect(log).toContain('callback:X');
    expect(log).toContain('callback:Y');
    expect(log).toContain('end:X');
    expect(log).toContain('end:Y');

    instance.unmount();
  });
});
