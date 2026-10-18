import {buildApplicationTimeline} from '../../src/utils/application-timeline';

describe('buildApplicationTimeline', () => {
  it('новая заявка: created done, остальные шаги не выполнены', () => {
    const steps = buildApplicationTimeline({
      __createdAt: '2026-10-01T10:00:00Z',
      __status: {status: 1, name: 'Новая'},
    });
    expect(steps).toHaveLength(6);
    expect(steps[0]).toMatchObject({key: 'created', title: 'Создана', done: true, dateIso: '2026-10-01T10:00:00Z'});
    expect(steps[1]).toMatchObject({key: 'accepted', title: 'Принята', done: false});
    expect(steps[1].dateIso).toBeUndefined();
    expect(steps[2]).toMatchObject({key: 'visit', title: 'Согласован выезд', done: false});
    expect(steps[2].dateIso).toBeUndefined();
    expect(steps[3]).toMatchObject({key: 'confirmed', done: false});
    expect(steps[4]).toMatchObject({key: 'completed', done: false});
    expect(steps[5]).toMatchObject({key: 'closed', done: false});
  });

  it('принятая заявка: accepted done без dateIso', () => {
    const steps = buildApplicationTimeline({
      __createdAt: '2026-10-01T10:00:00Z',
      __status: {status: 2, name: 'Принято'},
    });
    expect(steps[1].done).toBe(true);
    expect(steps[1].dateIso).toBeUndefined();
  });

  it('принята по наличию executor, даже если status < 2', () => {
    const steps = buildApplicationTimeline({
      __status: {status: 1},
      executor: [{__name: 'Иванов'}],
    });
    expect(steps[1].done).toBe(true);
    expect(steps[1].dateIso).toBeUndefined();
  });

  it('пустой executor — не принята', () => {
    const steps = buildApplicationTimeline({__status: {status: 1}, executor: []});
    expect(steps[1].done).toBe(false);
  });

  it('визит: visit done с датой', () => {
    const steps = buildApplicationTimeline({
      datetime_of_session: '2026-10-05T12:30:00Z',
    });
    expect(steps[2]).toMatchObject({key: 'visit', done: true, dateIso: '2026-10-05T12:30:00Z'});
  });

  it('визит подтверждён: confirmed done по флагу Да', () => {
    const steps = buildApplicationTimeline({approved_by_client: 'Да'});
    expect(steps[3]).toMatchObject({key: 'confirmed', done: true});
  });

  it('визит подтверждён флагом true', () => {
    const steps = buildApplicationTimeline({approved_by_client: true});
    expect(steps[3].done).toBe(true);
  });

  it('выполненная заявка: completed done по названию статуса', () => {
    const steps = buildApplicationTimeline({applications_status: {name: 'Выполнена'}});
    expect(steps[4].done).toBe(true);
    expect(steps[5].done).toBe(false);
  });

  it('закрытая заявка: completed и closed done', () => {
    const steps = buildApplicationTimeline({__status: {status: 5, name: 'Закрыта'}});
    expect(steps[4].done).toBe(true);
    expect(steps[5].done).toBe(true);
  });

  it('согласование не считается выполнением', () => {
    const steps = buildApplicationTimeline({result_of_agreement: 'Согласовано'});
    expect(steps[4].done).toBe(false);
    expect(steps[5].done).toBe(false);
  });

  it('пустой raw: всё false, без падений', () => {
    const steps = buildApplicationTimeline({});
    expect(steps).toHaveLength(6);
    for (const step of steps) {
      expect(step.done).toBe(false);
      expect(step.dateIso).toBeUndefined();
    }
  });

  it('createdAt используется как fallback для created', () => {
    const steps = buildApplicationTimeline({createdAt: '2026-09-01T08:00:00Z'});
    expect(steps[0].done).toBe(true);
    expect(steps[0].dateIso).toBe('2026-09-01T08:00:00Z');
  });

  it('нечисловой status не вызывает ошибок', () => {
    const steps = buildApplicationTimeline({__status: {status: 'abc'}});
    expect(steps[1].done).toBe(false);
  });
});
