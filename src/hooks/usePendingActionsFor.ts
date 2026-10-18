import {useEffect, useState} from 'react';
import {getPendingActions, subscribePendingActions} from '../services/action-queue';
import type {PendingAction, PendingKind} from '../services/action-queue';

/** Отложенные действия для конкретного объекта (заявка/задача). */
export function usePendingActionsFor(
  accountId: string | null,
  entityId: string,
  kind: PendingKind | PendingKind[],
): PendingAction[] {
  const [items, setItems] = useState<PendingAction[]>([]);
  const kindKey = Array.isArray(kind) ? kind.join('|') : kind;

  useEffect(() => {
    const kinds = kindKey.split('|');
    let mounted = true;

    const load = async () => {
      const all = await getPendingActions();
      if (!mounted) {
        return;
      }
      setItems(
        all.filter(
          (action) =>
            action.accountId === accountId &&
            action.entityId === entityId &&
            kinds.includes(action.kind),
        ),
      );
    };

    load().catch(() => {});
    const unsubscribe = subscribePendingActions(() => {
      load().catch(() => {});
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [accountId, entityId, kindKey]);

  return items;
}
