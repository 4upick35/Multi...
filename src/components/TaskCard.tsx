import React, {useMemo} from 'react';
import {useAppTheme} from '../theme';
import {View, StyleSheet, TouchableOpacity} from 'react-native';
import {Text, Chip} from 'react-native-paper';
import {ElmaTask} from '../types/task';
import {getStatusLabel, getStatusColor} from '../services/task-service';

type Props = {
  task: ElmaTask;
  accountColor: string;
  accountName: string;
  onPress: () => void;
};
type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

export default function TaskCard({task, accountColor, accountName, onPress}: Props) {
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const statusLabel = getStatusLabel(task.rawState || task.status);
  const statusColor = getStatusColor(task.rawState || task.status);
  const priorityLabel = task.priorityLabel || task.priority;
  const priorityColor = task.priorityColor || '#9E9E9E';

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.header}>
        <Chip
          compact
          style={[styles.accountChip, {backgroundColor: accountColor + '20'}]}
          textStyle={{color: accountColor, fontSize: 11}}>
          {accountName}
        </Chip>
        {task.isOverdue && (
          <Chip compact style={styles.overdueChip} textStyle={{color: colors.onBackground, fontSize: 11}}>
            ПРОСРОЧЕНО
          </Chip>
        )}
      </View>
      <Text variant="titleMedium" style={styles.subject} numberOfLines={2}>
        {task.subject}
      </Text>
      <View style={styles.footer}>
        <Chip compact style={[styles.statusChip, {backgroundColor: statusColor + '20'}]} textStyle={{fontSize: 11, color: statusColor}}>
          {statusLabel}
        </Chip>
        <Chip compact style={[styles.priorityChip, {backgroundColor: priorityColor + '20'}]} textStyle={{fontSize: 11, color: priorityColor}}>
          {priorityLabel}
        </Chip>
      </View>
    </TouchableOpacity>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: c.surface,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 6,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  header: {flexDirection: 'row', gap: 8, marginBottom: 8},
  accountChip: {},
  overdueChip: {backgroundColor: c.error},
  subject: {fontWeight: '600', marginBottom: 8},
  footer: {flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap'},
  statusChip: {},
  priorityChip: {},
});
