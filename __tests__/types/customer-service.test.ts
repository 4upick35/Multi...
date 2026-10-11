import {
  COLLECTIONS,
  MASTER_SERVICE_COLLECTIONS,
  MASTER_SERVICE_BUTTONS,
  WORKER_QUERY_COLLECTIONS,
  LARGE_COLLECTIONS,
} from '../../src/types/customer-service';

describe('customer-service constants', () => {
  it('MASTER_SERVICE_COLLECTIONS содержит заявки и задачи мастера (по HAR9/HAR10)', () => {
    expect(MASTER_SERVICE_COLLECTIONS).toContain('applications');
    expect(MASTER_SERVICE_COLLECTIONS).toContain('appeal_tasks');
    expect(MASTER_SERVICE_COLLECTIONS).toContain('job_requests');
    expect(MASTER_SERVICE_COLLECTIONS).toContain('sp_requests');
    expect(MASTER_SERVICE_COLLECTIONS).toContain('visits_by_masters');
    expect(MASTER_SERVICE_COLLECTIONS).toContain('acts_of_completed_works');
    expect(MASTER_SERVICE_COLLECTIONS).toHaveLength(6);
  });

  it('MASTER_SERVICE_COLLECTIONS не содержит spare_parts и results_of_work', () => {
    expect(MASTER_SERVICE_COLLECTIONS).not.toContain('spare_parts');
    expect(MASTER_SERVICE_COLLECTIONS).not.toContain('results_of_work');
  });

  it('MASTER_SERVICE_COLLECTIONS: порядок — заявки, затем визиты, акты', () => {
    const keys = MASTER_SERVICE_COLLECTIONS;
    expect(keys.indexOf('visits_by_masters')).toBeLessThan(keys.indexOf('acts_of_completed_works'));
  });

  it('MASTER_SERVICE_BUTTONS: feed=true, остальные false', () => {
    expect(MASTER_SERVICE_BUTTONS.feed).toBe(true);
    expect(MASTER_SERVICE_BUTTONS.workCalendar).toBe(false);
    expect(MASTER_SERVICE_BUTTONS.appealsDirectories).toBe(false);
    expect(MASTER_SERVICE_BUTTONS.docflow).toBe(false);
  });

  it('все ключи MASTER_SERVICE_COLLECTIONS присутствуют в COLLECTIONS', () => {
    const allKeys = new Set(COLLECTIONS.map(c => c.key));
    for (const key of MASTER_SERVICE_COLLECTIONS) {
      expect(allKeys.has(key)).toBe(true);
    }
  });

  it('appeals не в WORKER_QUERY_COLLECTIONS (загружается через items/list)', () => {
    expect(WORKER_QUERY_COLLECTIONS.has('appeals')).toBe(false);
  });

  it('applications не в WORKER_QUERY_COLLECTIONS (загружается через items/list)', () => {
    expect(WORKER_QUERY_COLLECTIONS.has('applications')).toBe(false);
  });

  it('visits_by_masters не в WORKER_QUERY_COLLECTIONS (загружается через items/list)', () => {
    expect(WORKER_QUERY_COLLECTIONS.has('visits_by_masters')).toBe(false);
  });

  it('spare_parts не в WORKER_QUERY_COLLECTIONS (загружается через items/list)', () => {
    expect(WORKER_QUERY_COLLECTIONS.has('spare_parts')).toBe(false);
  });

  it('results_of_work не в WORKER_QUERY_COLLECTIONS (загружается через items/list)', () => {
    expect(WORKER_QUERY_COLLECTIONS.has('results_of_work')).toBe(false);
  });

  it('acts_of_completed_works не в WORKER_QUERY_COLLECTIONS (загружается через items/list)', () => {
    expect(WORKER_QUERY_COLLECTIONS.has('acts_of_completed_works')).toBe(false);
  });

  it('visits_by_masters и spare_parts в LARGE_COLLECTIONS (нужна пагинация)', () => {
    expect(LARGE_COLLECTIONS.visits_by_masters).toBeDefined();
    expect(LARGE_COLLECTIONS.spare_parts).toBeDefined();
  });
});
