import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {useAppTheme} from '../../theme';
import {View, StyleSheet, ScrollView, RefreshControl, TouchableOpacity} from 'react-native';
import {Text, Button, Card} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import BackButton from '../../components/BackButton';
import AccountSelector from '../../components/AccountSelector';
import {getWorkCalendar} from '../../services/customer-service';
import {fetchSpecialDays, SpecialDay} from '../../services/elma-api';
import {useActiveAccount} from '../../hooks/useActiveAccount';
import {useRefresh} from '../../hooks/useRefresh';

type Props = {
  onBack: () => void;
};

type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

const DAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const DAY_NAMES_FULL = [
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
  'Воскресенье',
];
const MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

function secondsToTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

interface CycleDay {
  workTime?: {startAt?: number; endAt?: number};
  breaks?: Array<{breaksTime?: {startAt?: number; endAt?: number}; description?: string}>;
  isWorkingDay?: boolean;
  isHolidayDay?: boolean;
  description?: string;
}

interface ScheduleData {
  type?: string;
  cycle?: CycleDay[];
  defaultDaySettings?: CycleDay;
}

function getCycleDay(cycle: CycleDay[], dayOfWeek: number): CycleDay | undefined {
  return cycle[dayOfWeek];
}

function isWorking(cycleDay: CycleDay | undefined): boolean {
  if (!cycleDay) {
    return false;
  }
  return cycleDay.isWorkingDay === true && cycleDay.isHolidayDay !== true;
}

function isHoliday(cycleDay: CycleDay | undefined): boolean {
  return !!cycleDay?.isHolidayDay;
}

function formatDayTime(cycleDay: CycleDay | undefined): string {
  if (!cycleDay || !cycleDay.isWorkingDay) {
    return '';
  }
  const wt = cycleDay.workTime;
  if (wt && wt.startAt != null && wt.endAt != null) {
    return `${secondsToTime(wt.startAt)} – ${secondsToTime(wt.endAt)}`;
  }
  return '';
}

function formatBreaks(cycleDay: CycleDay | undefined): string {
  if (!cycleDay?.breaks || cycleDay.breaks.length === 0) {
    return '';
  }
  return cycleDay.breaks
    .map((b) => {
      const bt = b.breaksTime;
      if (bt && bt.startAt != null && bt.endAt != null) {
        return `${secondsToTime(bt.startAt)} – ${secondsToTime(bt.endAt)}`;
      }
      return b.description || '';
    })
    .filter(Boolean)
    .join(', ');
}

export default function WorkCalendarScreen({onBack}: Props) {
  const {account: activeAccount} = useActiveAccount();
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [loading, setLoading] = useState(false);
  const [calendar, setCalendar] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<{
    year: number;
    month: number;
    day: number;
  } | null>(null);
  const [specialDays, setSpecialDays] = useState<SpecialDay[]>([]);

  const fetchCalendar = useCallback(async () => {
    if (!activeAccount) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getWorkCalendar(activeAccount);
      setCalendar(data);
      if (!data) {
        setError('Нет данных');
      }
      // #16: Загружаем особые дни календаря, если есть specialCalendarId
      const specialId = (data as Record<string, unknown>)?.specialCalendarId as string | undefined;
      if (specialId) {
        try {
          const {days} = await fetchSpecialDays(activeAccount, specialId);
          setSpecialDays(days);
        } catch {
          // Особые дни не критичны — просто не показываем
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [activeAccount]);

  useEffect(() => {
    fetchCalendar();
  }, [fetchCalendar]);

  const {refreshing, onRefresh} = useRefresh(fetchCalendar);

  const goToPrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
    setSelectedDate(null);
  };

  const goToNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
    setSelectedDate(null);
  };

  const goToToday = () => {
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
    setSelectedDate({year: today.getFullYear(), month: today.getMonth(), day: today.getDate()});
  };

  const schedule = calendar?.schedule as ScheduleData | undefined;
  const cycle = schedule?.cycle;
  const hasCycle = Array.isArray(cycle) && cycle.length > 0;

  // #16: Lookup special day by date string (YYYY-MM-DD)
  const findSpecialDay = useCallback(
    (year: number, month: number, day: number): SpecialDay | undefined => {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return specialDays.find((sd) => sd.date === dateStr);
    },
    [specialDays],
  );

  // Build calendar grid
  const firstDay = new Date(currentYear, currentMonth, 1);
  const lastDay = new Date(currentYear, currentMonth + 1, 0);
  const daysInMonth = lastDay.getDate();
  // JS getDay(): 0=Sun,1=Mon,...6=Sat → convert to Mon=0...Sun=6
  const startDow = (firstDay.getDay() + 6) % 7;

  const cells: Array<{day: number | null; dow: number}> = [];
  for (let i = 0; i < startDow; i++) {
    cells.push({day: null, dow: -1});
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = (startDow + d - 1) % 7; // 0=Mon...6=Sun
    cells.push({day: d, dow});
  }

  const selectedCycleDay =
    selectedDate && hasCycle
      ? getCycleDay(cycle!, (selectedDate.day + (startDow) - 1) % 7)
      : undefined;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
      }>
      <BackButton onBack={onBack} />

      <View style={styles.headerRow}>
        <Icon name="calendar-clock" size={22} color={colors.primary} />
        <Text variant="titleMedium" style={styles.headerTitle}>
          Рабочий календарь
        </Text>
      </View>

      <AccountSelector />

      {loading && !calendar ? (
        <View style={styles.center}>
          <Text style={styles.loadingText}>Загрузка…</Text>
        </View>
      ) : error && !calendar ? (
        <View style={styles.center}>
          <Icon name="alert-circle-outline" size={48} color={colors.textTertiary} />
          <Text style={styles.emptyText}>{error}</Text>
          <Button mode="outlined" onPress={fetchCalendar} compact style={styles.retryBtn}>
            Повторить
          </Button>
        </View>
      ) : calendar ? (
        <View>
          {/* Month navigation */}
          <View style={styles.monthNav}>
            <TouchableOpacity onPress={goToPrevMonth} style={styles.navBtn}>
              <Icon name="chevron-left" size={24} color={colors.primary} />
            </TouchableOpacity>
            <View style={styles.monthTitleWrap}>
              <Text style={styles.monthTitle}>
                {MONTH_NAMES[currentMonth]} {currentYear}
              </Text>
            </View>
            <TouchableOpacity onPress={goToNextMonth} style={styles.navBtn}>
              <Icon name="chevron-right" size={24} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={goToToday} style={styles.todayBtn}>
              <Text style={styles.todayBtnText}>Сегодня</Text>
            </TouchableOpacity>
          </View>

          {/* Day-of-week headers */}
          <View style={styles.dowRow}>
            {DAY_LABELS.map((label, idx) => (
              <View
                key={label}
                style={[
                  styles.dowCell,
                  idx >= 5 && styles.dowCellWeekend,
                ]}>
                <Text style={[styles.dowText, idx >= 5 && styles.dowTextWeekend]}>
                  {label}
                </Text>
              </View>
            ))}
          </View>

          {/* Calendar grid */}
          <View style={styles.grid}>
            {cells.map((cell, idx) => {
              if (cell.day === null) {
                return <View key={`empty-${idx}`} style={styles.dayCell} />;
              }
              const cycleDay = hasCycle ? getCycleDay(cycle!, cell.dow) : undefined;
              const working = isWorking(cycleDay);
              const holiday = isHoliday(cycleDay);
              const weekend = cell.dow >= 5;
              const isSelected =
                selectedDate &&
                selectedDate.day === cell.day &&
                selectedDate.month === currentMonth &&
                selectedDate.year === currentYear;
              const isToday =
                today.getDate() === cell.day &&
                today.getMonth() === currentMonth &&
                today.getFullYear() === currentYear;

              let cellBg;
              let dayColor;
              if (holiday) {
                cellBg = colors.calendarHolidayBg;
                dayColor = colors.calendarHolidayText;
              } else if (!working && weekend) {
                cellBg = colors.background;
                dayColor = colors.textTertiary;
              }
              // #16: Special days override — highlight with distinct color
              const specialDay = findSpecialDay(currentYear, currentMonth, cell.day);
              if (specialDay) {
                if (specialDay.isWorkingDay) {
                  cellBg = colors.calendarWorkBg;
                  dayColor = colors.calendarWorkText;
                } else {
                  cellBg = colors.calendarHolidayBg;
                  dayColor = colors.calendarHolidayText;
                }
              } else {
                cellBg = colors.surface;
                dayColor = colors.textPrimary;
              }

              return (
                <TouchableOpacity
                  key={cell.day}
                  style={[
                    styles.dayCell,
                    {backgroundColor: cellBg},
                    isSelected && styles.dayCellSelected,
                    isToday && !isSelected && styles.dayCellToday,
                  ]}
                  onPress={() =>
                    setSelectedDate({
                      year: currentYear,
                      month: currentMonth,
                      day: cell.day!,
                    })
                  }>
                  <Text
                    style={[
                      styles.dayNumber,
                      {color: dayColor},
                      isSelected && styles.dayNumberSelected,
                      isToday && !isSelected && styles.dayNumberToday,
                    ]}>
                    {cell.day}
                  </Text>
                  {holiday && (
                    <Icon name="flag" size={8} color={colors.calendarHolidayText} style={styles.dayFlag} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Selected day details */}
          {selectedDate && (
            <Card style={styles.detailCard}>
              <Card.Content>
                <Text style={styles.detailTitle}>
                  {DAY_NAMES_FULL[
                    (selectedDate.day + startDow - 1) % 7
                  ]}{' '}
                  {selectedDate.day} {MONTH_NAMES[currentMonth]}
                </Text>
                {selectedCycleDay ? (
                  <>
{selectedCycleDay.isHolidayDay ? (
                      <View style={styles.detailRow}>
                        <Icon name="flag" size={16} color={colors.error} />
                        <Text style={styles.detailHoliday}>Праздничный день</Text>
                      </View>
                    ) : null}
                    {selectedCycleDay.isWorkingDay ? (
                      <>
                        {formatDayTime(selectedCycleDay) ? (
                          <View style={styles.detailRow}>
                            <Icon name="clock-outline" size={16} color={colors.primary} />
                            <Text style={styles.detailText}>
                              Рабочее время: {formatDayTime(selectedCycleDay)}
                            </Text>
                          </View>
                        ) : null}
                        {formatBreaks(selectedCycleDay) ? (
                          <View style={styles.detailRow}>
                            <Icon name="coffee" size={16} color={colors.warning} />
                            <Text style={styles.detailText}>
                              Перерыв: {formatBreaks(selectedCycleDay)}
                            </Text>
                          </View>
                        ) : null}
                      </>
                    ) : (
                      <View style={styles.detailRow}>
                        <Icon name="close-circle-outline" size={16} color={colors.textTertiary} />
                        <Text style={styles.detailOff}>Выходной</Text>
                      </View>
                    )}
                    {selectedCycleDay.description ? (
                      <Text style={styles.detailDesc}>{selectedCycleDay.description}</Text>
                    ) : null}
                    {/* #16: Special day info */}
                    {(() => {
                      const specialDay = findSpecialDay(
                        selectedDate.year,
                        selectedDate.month,
                        selectedDate.day,
                      );
                      if (!specialDay) {
                        return null;
                      }
                      return (
                        <View style={[styles.detailRow, {marginTop: 8}]}>
                          <Icon
                            name={specialDay.isWorkingDay ? 'briefcase-clock' : 'beach'}
                            size={16}
                            color={specialDay.isWorkingDay ? colors.calendarWorkText : colors.calendarHolidayText}
                          />
                          <Text
                            style={[
                              styles.detailText,
                              {
                                color: specialDay.isWorkingDay ? colors.calendarWorkText : colors.calendarHolidayText,
                                fontWeight: '600',
                              },
                            ]}>
                            {specialDay.isWorkingDay
                              ? 'Рабочий день по графику'
                              : 'Выходной/праздничный'}
                            {specialDay.name ? ` — ${specialDay.name}` : ''}
                          </Text>
                        </View>
                      );
                    })()}
                  </>
                ) : (
                  <Text style={styles.detailOff}>Нет данных</Text>
                )}
              </Card.Content>
            </Card>
          )}
        </View>
      ) : (
        <View style={styles.center}>
          <Icon name="calendar-blank-outline" size={48} color={colors.muted} />
          <Text style={styles.emptyText}>Нет данных</Text>
        </View>
      )}
    </ScrollView>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.background},
  content: {paddingHorizontal: 16, paddingTop: 4, paddingBottom: 80},
  headerRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4},
  headerTitle: {fontWeight: '600'},
  center: {alignItems: 'center', marginTop: 60},
  emptyText: {fontSize: 16, color: c.textTertiary, marginTop: 8},
  loadingText: {fontSize: 14, color: c.textTertiary},
  retryBtn: {marginTop: 12, borderRadius: 8},

  // Month navigation
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  navBtn: {
    padding: 4,
  },
  monthTitleWrap: {flex: 1, alignItems: 'center'},
  monthTitle: {fontSize: 16, fontWeight: '700', color: c.textPrimary},
  todayBtn: {
    backgroundColor: c.primary,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginLeft: 8,
  },
  todayBtnText: {color: c.onBackground, fontSize: 12, fontWeight: '600'},

  // Day-of-week headers
  dowRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  dowCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
  },
  dowCellWeekend: {},
  dowText: {fontSize: 12, fontWeight: '600', color: c.textSecondary},
  dowTextWeekend: {color: c.error},

  // Calendar grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.separator,
  },
  dayCellSelected: {
    backgroundColor: c.primary + '22',
    borderColor: c.primary,
    borderWidth: 2,
  },
  dayCellToday: {
    borderColor: c.primary,
    borderWidth: 1.5,
  },
  dayNumber: {fontSize: 14, fontWeight: '500'},
  dayNumberSelected: {color: c.primary, fontWeight: '700'},
  dayNumberToday: {color: c.primary, fontWeight: '700'},
  dayFlag: {position: 'absolute', top: 2, right: 2},

  // Detail card
  detailCard: {
    marginTop: 12,
    backgroundColor: c.surface,
    borderRadius: 12,
    elevation: 2,
  },
  detailTitle: {fontSize: 15, fontWeight: '700', color: c.textPrimary, marginBottom: 8},
  detailRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4},
  detailText: {fontSize: 14, color: c.textSecondary},
  detailHoliday: {fontSize: 14, color: c.error, fontWeight: '600'},
  detailOff: {fontSize: 14, color: c.muted},
  detailDesc: {fontSize: 13, color: c.textTertiary, marginTop: 4},
});
