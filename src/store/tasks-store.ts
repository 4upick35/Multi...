import {create} from 'zustand';
import {ElmaTask, TaskFilter} from '../types/task';
import {ElmaRequestKind} from '../types/errors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function omitKey<T extends Record<string, unknown>>(obj: T, key: string): T {
  const entries = Object.entries(obj).filter(([k]) => k !== key);
  return Object.fromEntries(entries) as T;
}

function buildDeduplicationKey(task: ElmaTask): string {
  const baseUrl = task.baseUrl || '';
  const taskId = task.taskId || task.id;
  return `${baseUrl}::${taskId}`;
}

function buildFilteredTasks(
  tasksByAccount: Record<string, ElmaTask[]>,
  filter: TaskFilter,
  selectedAccountId: string | null,
): ElmaTask[] {
  let allTasks: ElmaTask[] = [];
  const accountIds = selectedAccountId
    ? [selectedAccountId]
    : Object.keys(tasksByAccount);

  for (const accountId of accountIds) {
    allTasks = allTasks.concat(tasksByAccount[accountId] || []);
  }

  // Deduplicate tasks from accounts sharing the same server+user (same baseUrl+taskId)
  if (!selectedAccountId) {
    const seen = new Set<string>();
    allTasks = allTasks.filter((task) => {
      const key = buildDeduplicationKey(task);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  switch (filter) {
    case 'active':
      return allTasks.filter(task => task.status !== 'Completed');
    case 'overdue':
      return allTasks.filter(task => task.isOverdue);
    case 'completed':
      return allTasks.filter(task => task.status === 'Completed');
    default:
      return allTasks;
  }
}

// ---------------------------------------------------------------------------
// Sync state
// ---------------------------------------------------------------------------

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'error' | 'auth';

export interface AccountSyncState {
  status: SyncStatus;
  error?: string;
  lastSyncAt?: number;
  consecutiveErrors: number;
}

const emptySyncState = (): AccountSyncState => ({
  status: 'idle',
  consecutiveErrors: 0,
});

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface TasksState {
  tasksByAccount: Record<string, ElmaTask[]>;
  filteredTasks: ElmaTask[];
  filter: TaskFilter;
  selectedAccountId: string | null;
  syncStates: Record<string, AccountSyncState>;

  setTasks: (accountId: string, tasks: ElmaTask[]) => void;
  addOrUpdateTask: (accountId: string, task: ElmaTask) => void;
  setFilter: (filter: TaskFilter) => void;
  setSelectedAccount: (id: string | null) => void;
  removeAccountTasks: (accountId: string) => void;
  setSyncState: (
    accountId: string,
    partial: Partial<AccountSyncState>,
  ) => void;
  markSyncSuccess: (accountId: string) => void;
  markSyncError: (
    accountId: string,
    kind: ElmaRequestKind,
    msg: string,
  ) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useTasksStore = create<TasksState>((set) => ({
  tasksByAccount: {},
  filteredTasks: [],
  filter: 'active',
  selectedAccountId: null,
  syncStates: {},

  setTasks: (accountId, tasks) =>
    set((state) => {
      const tasksByAccount = {...state.tasksByAccount, [accountId]: tasks};
      return {
        tasksByAccount,
        filteredTasks: buildFilteredTasks(
          tasksByAccount,
          state.filter,
          state.selectedAccountId,
        ),
      };
    }),

  addOrUpdateTask: (accountId, task) =>
    set((state) => {
      const existing = state.tasksByAccount[accountId] || [];
      const idx = existing.findIndex((t) => t.id === task.id);
      const updated =
        idx >= 0
          ? existing.map((t, i) => (i === idx ? task : t))
          : [...existing, task];
      const tasksByAccount = {...state.tasksByAccount, [accountId]: updated};
      return {
        tasksByAccount,
        filteredTasks: buildFilteredTasks(
          tasksByAccount,
          state.filter,
          state.selectedAccountId,
        ),
      };
    }),

  setFilter: (filter) =>
    set((state) => ({
      filter,
      filteredTasks: buildFilteredTasks(
        state.tasksByAccount,
        filter,
        state.selectedAccountId,
      ),
    })),

  setSelectedAccount: (id) =>
    set((state) => ({
      selectedAccountId: id,
      filteredTasks: buildFilteredTasks(
        state.tasksByAccount,
        state.filter,
        id,
      ),
    })),

  removeAccountTasks: (accountId) =>
    set((state) => {
      const tasksByAccount = omitKey(state.tasksByAccount, accountId);
      const syncStates = omitKey(state.syncStates, accountId);
      return {
        tasksByAccount,
        syncStates,
        filteredTasks: buildFilteredTasks(
          tasksByAccount,
          state.filter,
          state.selectedAccountId,
        ),
      };
    }),

  setSyncState: (accountId, partial) =>
    set((state) => ({
      syncStates: {
        ...state.syncStates,
        [accountId]: {
          ...(state.syncStates[accountId] || emptySyncState()),
          ...partial,
        },
      },
    })),

  markSyncSuccess: (accountId) =>
    set((state) => ({
      syncStates: {
        ...state.syncStates,
        [accountId]: {
          status: 'ok' as SyncStatus,
          consecutiveErrors: 0,
          lastSyncAt: Date.now(),
          error: undefined,
        },
      },
    })),

  markSyncError: (accountId, kind, msg) =>
    set((state) => {
      const prev = state.syncStates[accountId] || emptySyncState();
      const status: SyncStatus = kind === 'unauthorized' ? 'auth' : 'error';
      return {
        syncStates: {
          ...state.syncStates,
          [accountId]: {
            status,
            error: msg,
            consecutiveErrors: prev.consecutiveErrors + 1,
            // lastSyncAt трактуется как время последней попытки: по нему
            // планировщик считает backoff и интервал повторного входа (auth)
            lastSyncAt: Date.now(),
          },
        },
      };
    }),
}));
