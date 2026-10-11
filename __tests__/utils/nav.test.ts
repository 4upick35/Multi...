import {isAllowedNavTarget, sanitizeNavAccountId} from '../../src/utils/nav';

describe('isAllowedNavTarget', () => {
  it('allows applications', () => {
    expect(isAllowedNavTarget('applications')).toBe(true);
  });

  it('rejects tasks', () => {
    expect(isAllowedNavTarget('tasks')).toBe(false);
  });

  it('rejects null', () => {
    expect(isAllowedNavTarget(null)).toBe(false);
  });
});

describe('sanitizeNavAccountId', () => {
  it('returns known id', () => {
    expect(sanitizeNavAccountId('acc-1', ['acc-1'])).toBe('acc-1');
  });

  it('returns null for unknown id', () => {
    expect(sanitizeNavAccountId('acc-2', ['acc-1'])).toBeNull();
  });

  it('returns null for id longer than 64 chars', () => {
    expect(sanitizeNavAccountId('a'.repeat(100), ['a'.repeat(100)])).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(sanitizeNavAccountId(123 as unknown, ['acc-1'])).toBeNull();
  });
});
