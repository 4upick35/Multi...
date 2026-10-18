import React from 'react';
import renderer, {act, ReactTestRenderer} from 'react-test-renderer';
import {PaperProvider} from 'react-native-paper';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

import {SyncBanners} from '../../src/components/SyncBanners';
import type {PendingAction} from '../../src/services/action-queue';

function makeAction(kind: PendingAction['kind'], id: string): PendingAction {
  return {
    id,
    kind,
    accountId: 'acc-1',
    entityId: 'entity-1',
    payload: {},
    createdAt: 1,
    attempts: 0,
    state: 'pending',
  };
}

function renderBanners(
  online: boolean | null,
  actions: PendingAction[],
  onRetry: () => void,
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <PaperProvider>
        <SyncBanners online={online} actions={actions} onRetry={onRetry} />
      </PaperProvider>,
    );
  });
  return tree;
}

function textContains(tree: ReactTestRenderer, substring: string): boolean {
  return tree.root
    .findAll(n => n.props.children !== undefined && n.props.children !== null)
    .some(n => {
      const children = n.props.children;
      const joined = Array.isArray(children) ? children.join('') : children;
      return typeof joined === 'string' && joined.includes(substring);
    });
}

function findRetryButton(tree: ReactTestRenderer) {
  return tree.root.findAll(
    n => n.props.mode === 'text' && typeof n.props.onPress === 'function',
  )[0];
}

describe('SyncBanners', () => {
  it('offline: красная плашка про подключения, без отложенных действий', () => {
    const tree = renderBanners(false, [], jest.fn());

    expect(textContains(tree, 'Нет подключения')).toBe(true);
    expect(textContains(tree, 'Показаны сохранённые данные')).toBe(true);
    expect(textContains(tree, 'Отложенные действия')).toBe(false);
    expect(findRetryButton(tree)).toBeUndefined();
  });

  it('online без отложенных действий: баннеров нет', () => {
    const tree = renderBanners(true, [], jest.fn());

    expect(textContains(tree, 'Нет подключения')).toBe(false);
    expect(textContains(tree, 'Отложенные действия')).toBe(false);
  });

  it('есть отложенные действия: счётчик и кнопка «Повторить»', () => {
    const onRetry = jest.fn();
    const tree = renderBanners(
      true,
      [makeAction('schedule-visit', 'a1'), makeAction('submit-exit', 'a2')],
      onRetry,
    );

    expect(textContains(tree, 'Отложенные действия: 2')).toBe(true);
    expect(textContains(tree, 'Нет подключения')).toBe(false);

    const button = findRetryButton(tree);
    expect(button).toBeTruthy();
    expect(textContains(tree, 'Повторить')).toBe(true);
    act(() => {
      button.props.onPress();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('среди действий есть accept-application — подсказка про карточку', () => {
    const tree = renderBanners(
      true,
      [makeAction('accept-application', 'a1'), makeAction('schedule-visit', 'a2')],
      jest.fn(),
    );

    expect(textContains(tree, 'Принятие заявки нужно повторить в её карточке')).toBe(true);
  });

  it('offline + отложенные действия: обе плашки одновременно', () => {
    const tree = renderBanners(false, [makeAction('submit-exit', 'a1')], jest.fn());

    expect(textContains(tree, 'Нет подключения')).toBe(true);
    expect(textContains(tree, 'Отложенные действия: 1')).toBe(true);
    expect(findRetryButton(tree)).toBeTruthy();
  });
});
