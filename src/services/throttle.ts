import {getRemainingPauseMs as getRemaining} from '../infrastructure/AccountThrottle';

export function getRemainingPauseMs(accountId: string): number {
  return getRemaining(accountId);
}
