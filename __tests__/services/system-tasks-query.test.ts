import {buildSystemTasksQuery} from '../../src/services/elma-api';

test('buildSystemTasksQuery returns correct JSON string', () => {
  const userId = 'u-1';
  const expected = '{"and":[{"in":[{"const":"u-1"},{"field":"performers"}]},{"not_in":[{"field":"templateNsAndCode"},{"list":[]}]},{"in":[{"field":"state"},{"list":["assignment","in_progress"]}]}]}';
  const result = buildSystemTasksQuery(userId);
  expect(result).toBe(expected);
});

test('buildSystemTasksQuery parses correctly', () => {
  const userId = 'u-1';
  const result = buildSystemTasksQuery(userId);
  const parsed = JSON.parse(result);
  expect(parsed).toEqual({
    and: [
      {in: [{const: userId}, {field: 'performers'}]},
      {not_in: [{field: 'templateNsAndCode'}, {list: []}]},
      {in: [{field: 'state'}, {list: ['assignment', 'in_progress']}]},
    ]
  });
});

test('buildSystemTasksQuery handles special characters in userId', () => {
  const userId = 'u-"\\1';
  const result = buildSystemTasksQuery(userId);
  expect(() => JSON.parse(result)).not.toThrow();
});