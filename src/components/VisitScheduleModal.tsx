import React, {useMemo, useState, useEffect, useCallback} from 'react';
import {View, StyleSheet, ScrollView, Platform} from 'react-native';
import {Modal, Portal, Text, Button, RadioButton, Divider} from 'react-native-paper';
import QuantumLoader from '../components/QuantumLoader';
import DateTimePicker, {DateTimePickerEvent} from '@react-native-community/datetimepicker';
import {formatUtcInstant} from '../utils/datetime';
import {useAppTheme} from '../theme';

type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

export interface Master {
  id: string;
  name: string;
}

interface Props {
  visible: boolean;
  applicationId: string;
  title?: string;
  loading: boolean;
  masters: Master[];
  minDate?: Date | null;
  defaultMasterId?: string | null;
  onCancel: () => void;
  onSubmit: (visitDateIso: string, masterId: string) => void;
}

export default function VisitScheduleModal({
  visible,
  title = 'Назначить визит',
  loading,
  masters,
  minDate,
  defaultMasterId,
  onCancel,
  onSubmit,
}: Props) {
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const now = new Date();
    return minDate && minDate > now ? minDate : now;
  });
  const [selectedMasterId, setSelectedMasterId] = useState<string>('');
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');
  const [showPicker, setShowPicker] = useState(false);
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  useEffect(() => {
    if (visible) {
      const now = new Date();
      const initial = minDate && minDate > now ? minDate : now;
      setSelectedDate(initial);
      setSelectedMasterId(defaultMasterId ?? '');
      setPickerMode('date');
      setShowPicker(false);
    }
  }, [visible, minDate, defaultMasterId]);

  const handlePickerChange = useCallback(
    (_event: DateTimePickerEvent, date?: Date) => {
      if (Platform.OS === 'android') {
        setShowPicker(false);
      }
      if (date) {
        setSelectedDate(date);
        if (pickerMode === 'date') {
          setPickerMode('time');
          if (Platform.OS === 'android') {
            setShowPicker(true);
          }
        } else {
          setPickerMode('date');
        }
      } else if (Platform.OS === 'android') {
        setPickerMode('date');
      }
    },
    [pickerMode],
  );

  const handleSubmit = useCallback(() => {
    if (!selectedMasterId) {
      return;
    }
    onSubmit(formatUtcInstant(selectedDate), selectedMasterId);
  }, [selectedDate, selectedMasterId, onSubmit]);

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onCancel} contentContainerStyle={styles.modal}>
        <Text variant="titleMedium" style={styles.title}>
          {title}
        </Text>

        <Divider style={styles.divider} />

        {loading ? (
          <View style={styles.loadingContainer}>
            <QuantumLoader size={30} color={colors.textSubtle} />
            <Text style={styles.loadingText}>Загрузка данных…</Text>
          </View>
        ) : (
          <ScrollView style={styles.scrollArea}>
            <Text variant="labelMedium" style={styles.sectionLabel}>
              Дата и время
            </Text>
            <Button
              mode="outlined"
              icon="calendar"
              onPress={() => {
                setPickerMode('date');
                setShowPicker(true);
              }}
              style={styles.dateButton}>
              {selectedDate.toLocaleString('ru')}
            </Button>

            {showPicker && (
              <DateTimePicker
                value={selectedDate}
                mode={pickerMode}
                minimumDate={minDate ?? undefined}
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={handlePickerChange}
              />
            )}

            <Divider style={styles.divider} />

            <Text variant="labelMedium" style={styles.sectionLabel}>
              Мастер
            </Text>
            {masters.length === 0 ? (
              <Text style={styles.noMasters}>Нет доступных мастеров</Text>
            ) : (
              <RadioButton.Group
                onValueChange={(value) => setSelectedMasterId(value)}
                value={selectedMasterId}>
                {masters.map((m) => (
                  <RadioButton.Item key={m.id} label={m.name} value={m.id} />
                ))}
              </RadioButton.Group>
            )}
          </ScrollView>
        )}

        <Divider style={styles.divider} />

        <View style={styles.buttons}>
          <Button mode="text" onPress={onCancel} disabled={loading}>
            Отмена
          </Button>
          <Button
            mode="contained"
            buttonColor="#4CAF50"
            onPress={handleSubmit}
            disabled={loading || !selectedMasterId}>
            Запустить
          </Button>
        </View>
      </Modal>
    </Portal>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  modal: {
    backgroundColor: c.surface,
    margin: 20,
    padding: 20,
    borderRadius: 12,
    maxHeight: '80%',
  },
  title: {fontWeight: '600', marginBottom: 8},
  divider: {marginVertical: 12},
  loadingContainer: {alignItems: 'center', paddingVertical: 24},
  loadingText: {marginTop: 12, color: c.muted},
  scrollArea: {maxHeight: 320},
  sectionLabel: {fontWeight: '600', marginBottom: 8, color: c.muted},
  dateButton: {marginBottom: 12},
  noMasters: {color: c.muted, fontStyle: 'italic', paddingVertical: 8},
  buttons: {flexDirection: 'row', justifyContent: 'flex-end', gap: 8},
});