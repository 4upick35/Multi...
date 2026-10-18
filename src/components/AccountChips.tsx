import React, {useCallback, useMemo, useRef, useState} from 'react';
import {StyleSheet, TouchableOpacity, View} from 'react-native';
import {Text} from 'react-native-paper';
import DraggableChip from './DraggableChip';
import {useAppTheme} from '../theme';
import type {ElmaAccount} from '../types/account';
import {contrastText, mixWithBlack, mixWithWhite} from '../utils/color';
import {formatTimeHMS} from '../utils/datetime';

type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

const CHIP_GAP = 6;

type Props = {
  accounts: ElmaAccount[];
  activeId: string | null;
  lastRefreshAt: Record<string, number>;
  onSelect: (id: string | null) => void;
  onReorder: (ids: string[]) => void;
};

export default function AccountChips({accounts, activeId, lastRefreshAt, onSelect, onReorder}: Props) {
  const {colors, mode} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragShift, setDragShift] = useState<{from: number; to: number; shiftPx: number} | null>(null);
  const chipLayouts = useRef<Record<number, {x: number; width: number}>>({});
  const dragRef = useRef<{
    id: string;
    fromIndex: number;
    startCx: number;
    width: number;
    centers: Array<{id: string; cx: number}>;
    targetIndex: number;
  } | null>(null);

  const registerChipLayout = useCallback((index: number, layout: {x: number; width: number}) => {
    chipLayouts.current[index] = layout;
  }, []);

  const handleDragStart = useCallback(
    (index: number) => {
      const dragged = accounts[index];
      const own = chipLayouts.current[index];
      if (!dragged || !own) {
        return;
      }
      const centers: Array<{id: string; cx: number}> = [];
      accounts.forEach((account, i) => {
        const layout = chipLayouts.current[i];
        if (layout) {
          centers.push({id: account.id, cx: layout.x + layout.width / 2});
        }
      });
      dragRef.current = {id: dragged.id, fromIndex: index, startCx: own.x + own.width / 2, width: own.width, centers, targetIndex: index};
      setDraggingId(dragged.id);
      setDragShift({from: index, to: index, shiftPx: own.width + CHIP_GAP});
    },
    [accounts],
  );

  const handleDragMove = useCallback((index: number, dx: number) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    const draggedCx = drag.startCx + dx;
    let to = 0;
    drag.centers.forEach(center => {
      if (center.id !== drag.id && center.cx < draggedCx) {
        to += 1;
      }
    });
    if (to !== drag.targetIndex) {
      drag.targetIndex = to;
      setDragShift({from: drag.fromIndex, to, shiftPx: drag.width + CHIP_GAP});
    }
  }, []);

  const finishDrag = useCallback(() => {
    dragRef.current = null;
    setDraggingId(null);
    setDragShift(null);
  }, []);

  const handleDragEnd = useCallback(
    (_index: number) => {
      const drag = dragRef.current;
      finishDrag();
      if (!drag || drag.targetIndex === drag.fromIndex) {
        return;
      }
      const ids = accounts.map(account => account.id);
      const [moved] = ids.splice(drag.fromIndex, 1);
      ids.splice(drag.targetIndex, 0, moved);
      onReorder(ids);
    },
    [accounts, finishDrag, onReorder],
  );

  const chipShift = useCallback(
    (index: number): number => {
      if (!dragShift || index === dragShift.from) {
        return 0;
      }
      if (dragShift.to > dragShift.from && index > dragShift.from && index <= dragShift.to) {
        return -dragShift.shiftPx;
      }
      if (dragShift.to < dragShift.from && index >= dragShift.to && index < dragShift.from) {
        return dragShift.shiftPx;
      }
      return 0;
    },
    [dragShift],
  );

  if (accounts.length <= 1) {
    return null;
  }

  return (
    <View style={styles.accountChipsWrap}>
      <View style={styles.accountChipsRow}>
        <TouchableOpacity
          style={[styles.accountFilterChip, !activeId && styles.accountFilterChipAll]}
          onPress={() => onSelect(null)}>
          <Text style={[styles.accountFilterChipText, !activeId && styles.accountFilterChipTextActive]}>Все</Text>
        </TouchableOpacity>
        {accounts.map((acc, index) => {
          const active = activeId === acc.id;
          const accTs = lastRefreshAt[acc.id];
          const chipBg = active ? acc.color : (mode === 'dark' ? mixWithBlack(acc.color, 0.55) : mixWithWhite(acc.color, 0.7));
          return (
            <DraggableChip
              key={acc.id}
              index={index}
              active={draggingId === acc.id}
              disabled={draggingId !== null && draggingId !== acc.id}
              shiftPx={chipShift(index)}
              style={[styles.accountFilterChip, {backgroundColor: chipBg}]}
              onPress={() => onSelect(active ? null : acc.id)}
              onDragStart={handleDragStart}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
              onDragCancel={finishDrag}
              registerLayout={registerChipLayout}>
              <Text numberOfLines={1} style={[styles.accountFilterChipText, {color: contrastText(chipBg)}]}>
                {acc.name}
              </Text>
              {accTs ? (
                <Text style={[styles.accountFilterChipTime, {color: contrastText(chipBg)}]}>
                  {formatTimeHMS(new Date(accTs))}
                </Text>
              ) : null}
            </DraggableChip>
          );
        })}
      </View>
    </View>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  accountChipsWrap: {height: 56, overflow: 'hidden', flexShrink: 0},
  accountChipsRow: {flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 6, gap: 6, alignItems: 'center'},
  accountFilterChip: {flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, backgroundColor: c.chipDefault, minHeight: 32},
  accountFilterChipAll: {backgroundColor: c.primary},
  accountFilterChipText: {fontSize: 12, color: c.textPrimary},
  accountFilterChipTextActive: {color: c.onBackground},
  accountFilterChipTime: {fontSize: 10, fontWeight: '600', marginTop: 1},
});
