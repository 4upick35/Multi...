export type TimelineStepKey =
  | 'created'
  | 'accepted'
  | 'visit'
  | 'confirmed'
  | 'completed'
  | 'closed';

export interface TimelineStep {
  key: TimelineStepKey;
  title: string;
  done: boolean;
  dateIso?: string;
}

function nonEmptyDate(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function textOf(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return String(obj.name ?? obj.__name ?? obj.Name ?? '');
  }
  return '';
}

function stageText(raw: Record<string, unknown>): string {
  return [
    textOf(raw.applications_status),
    textOf(raw.__status),
    textOf(raw.state),
    textOf(raw.result_of_agreement),
  ]
    .filter(Boolean)
    .join(' | ')
    .toLowerCase();
}

function isTrueFlag(value: unknown): boolean {
  if (value === true) {
    return true;
  }
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    return (
      text === 'да' ||
      text === 'true' ||
      text === '1' ||
      text === 'yes' ||
      text.includes('подтвержд')
    );
  }
  if (value && typeof value === 'object') {
    return textOf(value).toLowerCase().includes('подтвержд');
  }
  return false;
}

const COMPLETED_RE = /выполн|заверш|исполн|оказан/;
const CLOSED_RE = /закрыт|отмен|отклон/;

export function buildApplicationTimeline(raw: Record<string, unknown>): TimelineStep[] {
  const createdAt = nonEmptyDate(raw.__createdAt || raw.createdAt);
  const statusContainer = raw.__status as Record<string, unknown> | undefined;
  const status = Number(statusContainer?.status ?? 0);
  const executor = raw.executor;
  const accepted = status >= 2 || (Array.isArray(executor) && executor.length > 0);
  const visitDate = nonEmptyDate(raw.datetime_of_session);
  const confirmed = isTrueFlag(raw.approved_by_client);

  const stage = stageText(raw);
  const completed = COMPLETED_RE.test(stage);
  const closed = CLOSED_RE.test(stage);

  return [
    {
      key: 'created',
      title: 'Создана',
      done: createdAt.length > 0,
      ...(createdAt.length > 0 ? {dateIso: createdAt} : {}),
    },
    {
      key: 'accepted',
      title: 'Принята',
      done: accepted,
    },
    {
      key: 'visit',
      title: 'Согласован выезд',
      done: visitDate.length > 0,
      ...(visitDate.length > 0 ? {dateIso: visitDate} : {}),
    },
    {
      key: 'confirmed',
      title: 'Визит подтверждён',
      done: confirmed,
    },
    {
      key: 'completed',
      title: 'Выполнена',
      done: completed || closed,
    },
    {
      key: 'closed',
      title: 'Закрыта',
      done: closed,
    },
  ];
}
