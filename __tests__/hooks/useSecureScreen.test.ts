/**
 * Тесты хука useSecureScreen (FLAG_SECURE включён постоянно, без настроек).
 * Нативный модуль KeepAlive замокан, AsyncStorage — через moduleNameMapper.
 */

import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {useSecureScreen} from '../../src/hooks/useSecureScreen';
import {setSecureFlag} from '../../src/native/KeepAlive';

jest.mock('../../src/native/KeepAlive', () => ({
  setSecureFlag: jest.fn(() => Promise.resolve(true)),
}));

const mockSetSecureFlag = setSecureFlag as jest.MockedFunction<typeof setSecureFlag>;

function Probe() {
  useSecureScreen();
  return null;
}

let root: renderer.ReactTestRenderer | null = null;

function mount() {
  act(() => {
    root = renderer.create(React.createElement(Probe));
  });
}

function unmount() {
  if (root) {
    act(() => {
      root!.unmount();
    });
    root = null;
  }
}

beforeEach(() => {
  unmount();
  mockSetSecureFlag.mockClear();
  mockSetSecureFlag.mockResolvedValue(true);
});

describe('useSecureScreen', () => {
  it('при монтировании всегда вызывает setSecureFlag(true)', () => {
    mount();

    expect(mockSetSecureFlag).toHaveBeenCalledWith(true);
  });

  it('при повторном монтировании снова вызывает setSecureFlag(true)', () => {
    mount();
    unmount();
    mockSetSecureFlag.mockClear();

    mount();

    expect(mockSetSecureFlag).toHaveBeenCalledWith(true);
  });

  it('при размонтировании флаг НЕ снимается', () => {
    mount();
    expect(mockSetSecureFlag).toHaveBeenCalledWith(true);
    mockSetSecureFlag.mockClear();

    unmount();

    expect(mockSetSecureFlag).not.toHaveBeenCalledWith(false);
  });

  it('флаг не выставляется повторно без пересоздания экрана', () => {
    mount();

    expect(mockSetSecureFlag).toHaveBeenCalledTimes(1);
  });

  it('ошибка нативного слоя не приводит к исключению', () => {
    mockSetSecureFlag.mockRejectedValue(new Error('native boom'));

    expect(() => mount()).not.toThrow();
    expect(mockSetSecureFlag).toHaveBeenCalledWith(true);
  });
});
