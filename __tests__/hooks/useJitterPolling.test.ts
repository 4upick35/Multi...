import {nextIntervalWithJitter} from '../../src/hooks/useJitterPolling';

describe('nextIntervalWithJitter', () => {
  it('returns value >= baseMs', () => {
    for (let i = 0; i < 50; i++) {
      const result = nextIntervalWithJitter(30_000, 15_000);
      expect(result).toBeGreaterThanOrEqual(30_000);
    }
  });

  it('returns value < baseMs + jitterMs', () => {
    for (let i = 0; i < 50; i++) {
      const result = nextIntervalWithJitter(30_000, 15_000);
      expect(result).toBeLessThan(45_000);
    }
  });

  it('produces varied values (not all the same)', () => {
    const values = new Set<number>();
    for (let i = 0; i < 100; i++) {
      values.add(nextIntervalWithJitter(30_000, 15_000));
    }
    expect(values.size).toBeGreaterThan(1);
  });

  it('works with zero jitter', () => {
    for (let i = 0; i < 10; i++) {
      expect(nextIntervalWithJitter(30_000, 0)).toBe(30_000);
    }
  });
});
