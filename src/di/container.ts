import type {ElmaAccount} from '../types/account';
import type {CollectionKey, CollectionItem} from '../types/customer-service';
import type {ElmaTask} from '../types/task';
import type {ElmaRequestKind} from '../types/errors';
import type {
  AccountPersistence,
  CustomerServicePersistence,
  TaskPersistence,
} from '../interfaces/persistence';
import {CustomerService} from '../domain/CustomerService';
import {TaskService} from '../domain/TaskService';
import {recordBanSignal} from '../infrastructure/AccountThrottle';
import {useAuthStore} from '../store/auth-store';
import {useCustomerServiceStore} from '../store/customer-service-store';
import {useTasksStore} from '../store/tasks-store';

const accountPersistence: AccountPersistence = {
  updateAccount: (accountId: string, data: Partial<ElmaAccount>) =>
    useAuthStore.getState().updateAccount(accountId, data),
};

const customerServicePersistence: CustomerServicePersistence = {
  setItems: (accountId: string, collection: CollectionKey, items: CollectionItem[]) =>
    useCustomerServiceStore.getState().setItems(accountId, collection, items),
  appendItems: (accountId: string, collection: CollectionKey, items: CollectionItem[]) =>
    useCustomerServiceStore.getState().appendItems(accountId, collection, items),
  getItems: (accountId: string, collection: CollectionKey): CollectionItem[] =>
    useCustomerServiceStore.getState().getItems(accountId, collection),
  setCollectionStatus: (accountId, collection, status) =>
    useCustomerServiceStore.getState().setCollectionStatus(accountId, collection, status),
};

const taskPersistence: TaskPersistence = {
  setTasks: (accountId: string, tasks: ElmaTask[]) =>
    useTasksStore.getState().setTasks(accountId, tasks),
  addOrUpdateTask: (accountId: string, task: ElmaTask) =>
    useTasksStore.getState().addOrUpdateTask(accountId, task),
  markSyncSuccess: (accountId: string) =>
    useTasksStore.getState().markSyncSuccess(accountId),
  markSyncError: (accountId: string, kind: ElmaRequestKind, msg: string) =>
    useTasksStore.getState().markSyncError(accountId, kind, msg),
};

export const customerService = new CustomerService(
  customerServicePersistence,
  accountPersistence,
  {recordBanSignal},
);

export const taskService = new TaskService(taskPersistence, accountPersistence);
