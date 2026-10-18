import React, {useMemo} from 'react';
import {View, StyleSheet} from 'react-native';
import {Text} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useAppTheme} from '../theme';
import {buildApplicationTimeline, TimelineStep} from '../utils/application-timeline';

type Props = {
  raw: Record<string, unknown>;
};

const ZONE_HEIGHT = 56;
const CIRCLE_SIZE = 22;
const STEP_HEIGHT = ZONE_HEIGHT * 2 + CIRCLE_SIZE;

function formatStepDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return iso;
    }
    return `${d.toLocaleDateString('ru')} ${d.toLocaleTimeString('ru', {hour: '2-digit', minute: '2-digit'})}`;
  } catch {
    return iso;
  }
}

export function ApplicationTimeline({raw}: Props) {
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const steps = useMemo(() => buildApplicationTimeline(raw), [raw]);

  return (
    <View style={styles.container}>
      {steps.map((step: TimelineStep, index: number) => {
        const labelAbove = index % 2 === 1;
        const label = (
          <View style={styles.labelBlock}>
            <Text style={styles.title} numberOfLines={3}>
              {step.title}
            </Text>
            {step.dateIso ? (
              <Text style={styles.date} numberOfLines={2}>
                {formatStepDate(step.dateIso)}
              </Text>
            ) : null}
          </View>
        );

        return (
          <View key={step.key} style={styles.stepWrap}>
            {index > 0 ? (
              <View
                style={[
                  styles.line,
                  steps[index - 1].done ? styles.lineDone : styles.linePending,
                ]}
              />
            ) : null}
            <View style={styles.zoneTop}>{labelAbove ? label : null}</View>
            <View
              style={[
                styles.circle,
                step.done ? styles.circleDone : styles.circlePending,
              ]}
            >
              {step.done ? <Icon name="check" size={13} color="#FFFFFF" /> : null}
            </View>
            <View style={styles.zoneBottom}>{labelAbove ? null : label}</View>
          </View>
        );
      })}
    </View>
  );
}

const createStyles = (c: ReturnType<typeof useAppTheme>['colors']) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: c.surface,
      borderRadius: 12,
      paddingHorizontal: 6,
      paddingVertical: 10,
      marginVertical: 8,
      overflow: 'hidden',
    },
    stepWrap: {
      flex: 1,
      height: STEP_HEIGHT,
      alignItems: 'center',
      position: 'relative',
    },
    line: {
      position: 'absolute',
      left: '-50%',
      right: '50%',
      top: ZONE_HEIGHT + CIRCLE_SIZE / 2 - 1,
      height: 2,
      zIndex: 0,
    },
    lineDone: {backgroundColor: c.primary},
    linePending: {backgroundColor: c.textTertiary},
    zoneTop: {
      height: ZONE_HEIGHT,
      alignSelf: 'stretch',
      justifyContent: 'flex-end',
      alignItems: 'center',
      paddingBottom: 4,
    },
    zoneBottom: {
      height: ZONE_HEIGHT,
      alignSelf: 'stretch',
      justifyContent: 'flex-start',
      alignItems: 'center',
      paddingTop: 4,
    },
    circle: {
      width: CIRCLE_SIZE,
      height: CIRCLE_SIZE,
      borderRadius: CIRCLE_SIZE / 2,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1,
    },
    circleDone: {backgroundColor: c.primary},
    circlePending: {backgroundColor: c.surface, borderWidth: 2, borderColor: c.textTertiary},
    labelBlock: {alignSelf: 'stretch', alignItems: 'center', paddingHorizontal: 1},
    title: {fontSize: 10, lineHeight: 12, color: c.textPrimary, textAlign: 'center'},
    date: {fontSize: 9, lineHeight: 11, color: c.textTertiary, textAlign: 'center', marginTop: 1},
  });

export default ApplicationTimeline;
