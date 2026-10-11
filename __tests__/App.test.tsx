/**
 * @format
 */

import 'react-native';
import React from 'react';
import App from '../App';

// Note: import explicitly to use the types shipped with jest.
import {beforeEach, expect, it, jest} from '@jest/globals';

// Note: test renderer must be required after react-native.
import renderer from 'react-test-renderer';
import {useTasksStore} from '../src/store/tasks-store';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

function TasksSelectorProbe() {
  useTasksStore((state) => state.filteredTasks);
  return null;
}

beforeEach(() => {
  useTasksStore.setState({
    tasksByAccount: {},
    filteredTasks: [],
    filter: 'active',
    selectedAccountId: null,
  });
});

it('renders correctly', () => {
  const tree = renderer.create(<App />);
  tree.unmount();
});

it('renders tasks selector without infinite re-render', () => {
  const tree = renderer.create(<TasksSelectorProbe />);
  expect(() => tree).not.toThrow();
  tree.unmount();
});
