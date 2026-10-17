import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {View, StyleSheet, ScrollView, TouchableOpacity, Modal, FlatList, PanResponder, Animated} from 'react-native';
import {Text, Chip} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import BackButton from '../../components/BackButton';
import {useAppTheme} from '../../theme';
import {useActiveAccount} from '../../hooks/useActiveAccount';
import {useCustomerServiceStore} from '../../store/customer-service-store';
import {CollectionItem} from '../../types/customer-service';
import {buildShortAddress} from '../../utils/collection-fields';
import {contrastText} from '../../utils/color';
import {computeSnap} from '../../utils/calendar-snap';

type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

type Props = {onBack: () => void; onSelectItem: (item: CollectionItem) => void};

type Account = {id: string; color: string};

type Entry = {item: CollectionItem; account: Account; date: Date};

type Slot = {title: string; items: Entry[]};

const HOUR_H = 56;
const TIME_W = 54;
const DAY_BUFFER = 10;
const PERIODS = [1, 3, 7] as const;
type Period = (typeof PERIODS)[number];
const PERIOD_LABELS: Record<Period, string> = {1: '1 день', 3: '3 дня', 7: '7 дней'};
const HOURS = Array.from({length: 24}, (_, i) => i);
const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

const pad2 = (n: number): string => String(n).padStart(2, '0');
const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayLabel = (d: Date): string => `${WEEKDAYS[d.getDay()]} ${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`;

const cityOf = (item: CollectionItem): string =>
  String((item.raw.locality as string) || '').trim() ||
  (buildShortAddress(item.raw).split(',')[0] || '').trim();

export default function ApplicationsCalendarScreen({onBack, onSelectItem}: Props) {
  const {colors} = useAppTheme();
  const {accounts} = useActiveAccount();
  const itemsByAccount = useCustomerServiceStore(s => s.itemsByAccount);

  const [period, setPeriod] = useState<Period>(1);
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
  const [bodyW, setBodyW] = useState(0);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [nowMinutes, setNowMinutes] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });

  useEffect(() => {
    const id = setInterval(() => {
      const n = new Date();
      setNowMinutes(n.getHours() * 60 + n.getMinutes());
    }, 30000);
    return () => clearInterval(id);
  }, []);

  const scrollRef = useRef<ScrollView>(null);
  const slideX = useRef(new Animated.Value(0)).current;
  const slideRef = useRef(0);
  const dragStartRef = useRef(0);
  const animatingRef = useRef(false);

  // Полоса дней с буфером: индекс DAY_BUFFER в stripDays — левая видимая колонка в базе.
  const stripDays = useMemo(() => {
    const arr: Date[] = [];
    for (let i = -DAY_BUFFER; i < period + DAY_BUFFER; i += 1) {
      arr.push(addDays(anchor, i));
    }
    return arr;
  }, [anchor, period]);

  const entries = useMemo(() => {
    const out: Entry[] = [];
    accounts.forEach(acc => {
      const items = itemsByAccount[acc.id]?.applications || [];
      items.forEach(item => {
        const status = String(item.status || '').toLowerCase();
        if (status.includes('новая') || status.includes('завершен')) {
          return;
        }
        if (!status.includes('согласован') && !status.includes('работ')) {
          return;
        }
        const iso = String(item.raw.datetime_of_session || '');
        const parsed = new Date(iso);
        if (Number.isNaN(parsed.getTime())) {
          return;
        }
        const account =
          (item.accountId ? accounts.find(a => a.id === item.accountId) : undefined) || acc;
        out.push({item, account, date: parsed});
      });
    });
    return out;
  }, [itemsByAccount, accounts]);

  const slots = useMemo(() => {
    const map = new Map<string, Entry[]>();
    if (stripDays.length === 0) {
      return map;
    }
    const base = startOfDay(stripDays[0]).getTime();
    const last = startOfDay(stripDays[stripDays.length - 1]).getTime();
    entries.forEach(entry => {
      const dayTime = startOfDay(entry.date).getTime();
      if (dayTime < base || dayTime > last) {
        return;
      }
      const dayIndex = Math.round((dayTime - base) / 86400000);
      const key = `${dayIndex}:${entry.date.getHours()}`;
      const list = map.get(key);
      if (list) {
        list.push(entry);
      } else {
        map.set(key, [entry]);
      }
    });
    return map;
  }, [entries, stripDays]);

  const dayW = bodyW > 0 ? (bodyW - TIME_W) / period : 0;
  const isEmpty = slots.size === 0;
  const todayKey = startOfDay(new Date()).getTime();

  // При смене ширины колонки (период/раскладка) без анимации возвращаемся в базу.
  // Идущую анимацию останавливаем: её callback замкнут на старый dayW и иначе
  // вернёт slideRef/anchor со старым смещением (рассинхрон и двойной сдвиг).
  useEffect(() => {
    if (dayW <= 0) {
      return;
    }
    slideX.stopAnimation(() => {});
    animatingRef.current = false;
    slideRef.current = -(DAY_BUFFER * dayW);
    slideX.setValue(slideRef.current);
  }, [dayW, slideX]);

  /** Сдвиг на delta дней с плавной анимацией и сбросом в базу полосы. */
  const goDays = useCallback(
    (delta: number) => {
      if (delta === 0 || animatingRef.current) {
        return;
      }
      if (dayW <= 0) {
        setAnchor(prev => addDays(prev, delta));
        return;
      }
      animatingRef.current = true;
      Animated.timing(slideX, {
        toValue: -(DAY_BUFFER + delta) * dayW,
        duration: 200,
        useNativeDriver: true,
      }).start(({finished}) => {
        // Прерванную анимацию (resetToday/смена dayW) не применяем: её callback
        // замкнут на старый dayW и сдвинул бы anchor поверх сброса.
        if (!finished) {
          animatingRef.current = false;
          return;
        }
        setAnchor(prev => addDays(prev, delta));
        slideRef.current = -(DAY_BUFFER * dayW);
        slideX.setValue(slideRef.current);
        animatingRef.current = false;
      });
    },
    [dayW, slideX],
  );

  const resetToday = useCallback(() => {
    // Сначала гасим идущую анимацию — иначе её callback позже выполнит
    // setAnchor поверх сброса на «сегодня».
    slideX.stopAnimation(() => {});
    animatingRef.current = false;
    setAnchor(startOfDay(new Date()));
    if (dayW > 0) {
      slideRef.current = -(DAY_BUFFER * dayW);
      slideX.setValue(slideRef.current);
    }
  }, [dayW, slideX]);

  const closeSlot = useCallback(() => setSlot(null), []);

  const selectFromSlot = useCallback(
    (entry: Entry) => {
      onSelectItem(entry.item);
      setSlot(null);
    },
    [onSelectItem],
  );

  const openSlot = useCallback((title: string, items: Entry[]) => {
    setSlot({title, items});
  }, []);

  const styles = useMemo(() => createStyles(colors), [colors]);

  useEffect(() => {
    const y = Math.max(0, (new Date().getHours() - 1) * HOUR_H);
    const t = setTimeout(() => scrollRef.current?.scrollTo({y, animated: false}), 0);
    return () => clearTimeout(t);
  }, []);

  /** Snap к ближайшему дню и сброс полосы в базу — общий для Release/Terminate. */
  const settleToSnap = useCallback(() => {
    if (dayW <= 0 || animatingRef.current) {
      return;
    }
    const {daysMoved, targetX} = computeSnap(slideRef.current, dayW, period, DAY_BUFFER);
    animatingRef.current = true;
    Animated.timing(slideX, {
      toValue: targetX,
      duration: 200,
      useNativeDriver: true,
    }).start(({finished}) => {
      if (!finished) {
        animatingRef.current = false;
        return;
      }
      setAnchor(prev => addDays(prev, daysMoved));
      slideRef.current = -(DAY_BUFFER * dayW);
      slideX.setValue(slideRef.current);
      animatingRef.current = false;
    });
  }, [dayW, period, slideX]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          !animatingRef.current &&
          Math.abs(g.dx) > 12 &&
          Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderGrant: () => {
          dragStartRef.current = slideRef.current;
        },
        onPanResponderMove: (_e, g) => {
          if (dayW <= 0) {
            return;
          }
          const stripLen = period + 2 * DAY_BUFFER;
          const next = Math.max(
            -(stripLen - period) * dayW,
            Math.min(0, dragStartRef.current + g.dx),
          );
          slideX.setValue(next);
          slideRef.current = next;
        },
        onPanResponderRelease: settleToSnap,
        onPanResponderTerminate: settleToSnap,
      }),
    [dayW, period, slideX, settleToSnap],
  );

  const renderSlot = (dayIndex: number, hour: number, list: Entry[]) => {
    const title = `${dayLabel(stripDays[dayIndex])} · ${pad2(hour)}:00`;
    if (list.length > 3) {
      const color = list[0].account.color;
      return (
        <TouchableOpacity
          key={`slot-${dayIndex}-${hour}`}
          activeOpacity={0.8}
          onPress={() => openSlot(title, list)}
          style={[styles.slot, {top: hour * HOUR_H, height: HOUR_H}, styles.block, {backgroundColor: color}]}>
          <Text style={[styles.blockText, {color: contrastText(color)}]}>{list.length} заявок</Text>
        </TouchableOpacity>
      );
    }
    return (
      <View
        key={`slot-${dayIndex}-${hour}`}
        style={[styles.slot, {top: hour * HOUR_H, height: HOUR_H}]}>
        {list.map((entry, index) => {
          const city = cityOf(entry.item);
          return (
            <TouchableOpacity
              key={`${entry.item.id}-${index}`}
              activeOpacity={0.8}
              onPress={() => onSelectItem(entry.item)}
              style={[
                styles.block,
                {
                  backgroundColor: entry.account.color,
                  marginLeft: index === 0 ? 0 : 2,
                },
              ]}>
              <Text
                style={[styles.blockText, {color: contrastText(entry.account.color)}]}
                numberOfLines={1}>
                {entry.item.name}
              </Text>
              {city ? (
                <Text
                  style={[styles.blockSub, {color: contrastText(entry.account.color)}]}
                  numberOfLines={1}>
                  {city}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  // Линия текущего времени привязана к колонке «сегодня» внутри полосы дней,
  // поэтому двигается вместе с ней; если «сегодня» вне буфера — не рисуем.
  const todayIndex = stripDays.findIndex(d => startOfDay(d).getTime() === todayKey);
  const nowTop = (nowMinutes / 60) * HOUR_H;

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <BackButton onBack={onBack} />
        <Text style={styles.title}>Календарь заявок</Text>
      </View>

      <View style={styles.controls}>
        <View style={styles.chips}>
          {PERIODS.map(p => {
            const selected = period === p;
            return (
              <Chip
                key={p}
                selected={selected}
                onPress={() => setPeriod(p)}
                style={[
                  styles.chip,
                  {backgroundColor: selected ? colors.primary : colors.chipDefault},
                ]}>
                <Text
                  style={{
                    fontSize: 12,
                    color: selected ? contrastText(colors.primary) : colors.textPrimary,
                  }}>
                  {PERIOD_LABELS[p]}
                </Text>
              </Chip>
            );
          })}
        </View>

        <View style={styles.navRow}>
          <TouchableOpacity style={styles.navBtn} onPress={() => goDays(-1)}>
            <Icon name="chevron-left" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.todayBtn} onPress={resetToday}>
            <Text style={styles.todayText}>Сегодня</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navBtn} onPress={() => goDays(1)}>
            <Icon name="chevron-right" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      <View
        style={styles.body}
        onLayout={e => setBodyW(e.nativeEvent.layout.width)}
        {...pan.panHandlers}>
        <View style={styles.headerRow}>
          <View style={styles.timeHead} />
          <View style={styles.daysClip}>
            <Animated.View style={[styles.daysStrip, {transform: [{translateX: slideX}]}]}>
              {stripDays.map((day, index) => {
                const active = startOfDay(day).getTime() === todayKey;
                return (
                  <View key={index} style={[styles.dayHead, {width: dayW}]}>
                    <Text style={[styles.dayHeadText, active && styles.dayHeadTextActive]}>
                      {dayLabel(day)}
                    </Text>
                  </View>
                );
              })}
            </Animated.View>
          </View>
        </View>

        {isEmpty ? <Text style={styles.empty}>Нет заявок на выбранный период</Text> : null}

        <ScrollView ref={scrollRef} style={styles.scroll} bounces={false} overScrollMode="never" showsVerticalScrollIndicator={false}>
          <View style={styles.gridRow}>
            <View style={styles.timeCol}>
              {HOURS.map(h => (
                <View key={h} style={styles.timeCell}>
                  <Text style={styles.timeText}>{pad2(h)}:00</Text>
                </View>
              ))}
            </View>

            <View style={styles.daysClip}>
              <Animated.View style={[styles.daysStrip, {transform: [{translateX: slideX}]}]}>
                {stripDays.map((_, dayIndex) => (
                  <View key={dayIndex} style={[styles.dayCol, {width: dayW}]}>
                    {HOURS.map(h => (
                      <View key={h} style={styles.hourCell} />
                    ))}
                    {HOURS.map(h => {
                      const list = slots.get(`${dayIndex}:${h}`);
                      if (!list || list.length === 0) {
                        return null;
                      }
                      return renderSlot(dayIndex, h, list);
                    })}
                  </View>
                ))}
                {todayIndex >= 0 ? (
                  <View
                    pointerEvents="none"
                    style={[styles.nowLine, {top: nowTop, left: todayIndex * dayW, width: dayW}]}
                  />
                ) : null}
              </Animated.View>
            </View>
          </View>
        </ScrollView>
      </View>

      <Modal
        visible={slot !== null}
        transparent
        animationType="fade"
        onRequestClose={closeSlot}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{slot ? slot.title : ''}</Text>
              <TouchableOpacity onPress={closeSlot}>
                <Icon name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <FlatList
              style={styles.modalList}
              data={slot ? slot.items : []}
              keyExtractor={(entry, index) => `${entry.item.id}-${index}`}
              renderItem={({item: entry}) => (
                <TouchableOpacity
                  style={styles.modalRow}
                  onPress={() => selectFromSlot(entry)}>
                  <View style={[styles.dot, {backgroundColor: entry.account.color}]} />
                  <View style={styles.rowBody}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {entry.item.name}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {cityOf(entry.item)}
                    </Text>
                  </View>
                  <Text style={styles.rowTime}>
                    {pad2(entry.date.getHours())}:{pad2(entry.date.getMinutes())}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.background,
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingTop: 8,
      gap: 8,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: c.textPrimary,
    },
    controls: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 8,
    },
    chips: {
      flexDirection: 'row',
      flexShrink: 1,
      gap: 6,
    },
    chip: {
      height: 30,
    },
    navRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    navBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.chipDefault,
    },
    todayBtn: {
      paddingHorizontal: 10,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.primaryLight10,
    },
    todayText: {
      fontSize: 12,
      fontWeight: '600',
      color: c.primary,
    },
    body: {
      flex: 1,
      paddingHorizontal: 8,
    },
    headerRow: {
      flexDirection: 'row',
      height: 44,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.separator,
    },
    timeHead: {
      width: TIME_W,
      justifyContent: 'center',
    },
    daysClip: {
      flex: 1,
      overflow: 'hidden',
    },
    daysStrip: {
      flexDirection: 'row',
    },
    dayHead: {
      justifyContent: 'center',
      alignItems: 'center',
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: c.separator,
    },
    dayHeadText: {
      fontSize: 12,
      fontWeight: '600',
      color: c.textSecondary,
    },
    dayHeadTextActive: {
      color: c.primary,
    },
    empty: {
      textAlign: 'center',
      color: c.textTertiary,
      fontSize: 13,
      paddingVertical: 16,
    },
    scroll: {
      flex: 1,
    },
    gridRow: {
      flexDirection: 'row',
    },
    timeCol: {
      width: TIME_W,
    },
    timeCell: {
      height: HOUR_H,
      justifyContent: 'flex-start',
      alignItems: 'flex-end',
      paddingRight: 6,
      paddingTop: 2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.separator,
    },
    timeText: {
      fontSize: 10,
      color: c.textTertiary,
    },
    dayCol: {
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: c.separator,
    },
    nowLine: {
      position: 'absolute',
      height: 2,
      backgroundColor: '#E53935',
    },
    hourCell: {
      height: HOUR_H,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.separator,
    },
    slot: {
      position: 'absolute',
      left: 0,
      right: 0,
      flexDirection: 'row',
      paddingHorizontal: 2,
      paddingVertical: 2,
    },
    block: {
      flex: 1,
      borderRadius: 6,
      paddingHorizontal: 4,
      paddingVertical: 2,
      justifyContent: 'center',
      overflow: 'hidden',
    },
    blockText: {
      fontSize: 11,
      fontWeight: '700',
    },
    blockSub: {
      fontSize: 9,
      opacity: 0.9,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      paddingHorizontal: 24,
    },
    modalCard: {
      backgroundColor: c.surface,
      borderRadius: 12,
      padding: 16,
      maxHeight: '75%',
      overflow: 'hidden',
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    modalTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: c.textPrimary,
    },
    modalList: {
      maxHeight: 400,
      marginTop: 4,
    },
    modalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.separator,
      gap: 8,
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    rowBody: {
      flex: 1,
    },
    rowName: {
      fontSize: 13,
      fontWeight: '600',
      color: c.textPrimary,
    },
    rowMeta: {
      fontSize: 11,
      color: c.textTertiary,
    },
    rowTime: {
      fontSize: 11,
      color: c.textSecondary,
    },
  });
