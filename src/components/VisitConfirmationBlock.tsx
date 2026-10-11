import React, {useMemo} from 'react';
import {View, StyleSheet} from 'react-native';
import {Text, Button, Checkbox, TextInput} from 'react-native-paper';
import {useAppTheme} from '../theme';
import type {ElmaAccount} from '../types/account';
import {useVisitConfirmation} from '../hooks/useVisitConfirmation';
import {isVisitConfirmed} from '../services/elma-api';

type Props = {
  account: ElmaAccount;
  taskUuid: string;
  instanceId: string;
  instance: Record<string, unknown>;
  onConfirmed: () => void;
};

export function VisitConfirmationBlock({account, taskUuid, instanceId, instance, onConfirmed}: Props) {
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const {
    step,
    code,
    generatedCode,
    cooldownLeft,
    withoutConfirmation,
    reason,
    error,
    setCode,
    setWithoutConfirmation,
    setReason,
    sendCode,
    confirm,
  } = useVisitConfirmation(account, taskUuid, instanceId, instance, onConfirmed);

  const stepConfirmed = step === 'confirmed';
  const isError = step === 'error';
  const isSent = step === 'sent';
  const isConfirming = step === 'confirming' || step === 'sending';
  const canSend = step === 'idle' || step === 'sent';
  const canConfirm = !isConfirming && (step === 'sent' || step === 'idle');

  const isConfirmed = stepConfirmed || isVisitConfirmed(instance);

  return (
    <View style={styles.container}>
      <Text variant="titleSmall" style={styles.sectionTitle}>
        Подтверждение визита
      </Text>

      {isConfirmed ? (
        <View style={styles.confirmedCard}>
          <Text style={styles.confirmedText}>Верифицирован</Text>
        </View>
      ) : null}

      {!isConfirmed && isSent && generatedCode ? (
        <Text style={styles.generatedCodeText}>
          Сгенерированный код: {generatedCode}
        </Text>
      ) : null}

      {!isConfirmed && isSent && cooldownLeft > 0 ? (
        <Text style={styles.cooldownText}>
          Код отправлен клиенту. Повторная отправка будет доступна через {cooldownLeft} сек.
        </Text>
      ) : null}

      <Button
        mode="contained"
        onPress={sendCode}
        disabled={!canSend || isConfirmed}
        style={styles.sendButton}
        loading={step === 'sending'}
      >
        Отправить код клиенту
      </Button>

      {!isConfirmed ? (
        <>
          {isError && error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : null}

          <TextInput
            label="Введите код из СМС"
            value={code}
            onChangeText={setCode}
            mode="outlined"
            keyboardType="numeric"
            maxLength={4}
            style={styles.codeInput}
            editable={!isConfirming}
          />

          <View style={styles.checkboxRow}>
            <Checkbox
              status={withoutConfirmation ? 'checked' : 'unchecked'}
              onPress={() => setWithoutConfirmation(!withoutConfirmation)}
            />
            <Text style={styles.checkboxLabel}>Без подтверждения визита</Text>
          </View>

          {withoutConfirmation ? (
            <TextInput
              label="Причина отсутствия подтверждения"
              value={reason}
              onChangeText={setReason}
              mode="outlined"
              multiline
              numberOfLines={2}
              style={styles.input}
              editable={!isConfirming}
            />
          ) : null}

          <Button
            mode="contained"
            onPress={confirm}
            disabled={!canConfirm}
            style={styles.confirmButton}
            loading={step === 'confirming'}
          >
            Подтвердить визит
          </Button>
        </>
      ) : null}
    </View>
  );
}

const createStyles = (c: ReturnType<typeof useAppTheme>['colors']) => StyleSheet.create({
  container: {
    backgroundColor: c.surface,
    borderRadius: 12,
    padding: 16,
    marginVertical: 8,
    marginHorizontal: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  sectionTitle: {fontWeight: '600', marginBottom: 12, color: c.textPrimary},
  generatedCodeText: {fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginBottom: 8, color: c.primary},
  cooldownText: {fontSize: 12, color: c.muted, textAlign: 'center', marginBottom: 12},
  sendButton: {marginBottom: 12, borderRadius: 8},
  codeInput: {marginBottom: 12},
  checkboxRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12},
  checkboxLabel: {fontSize: 14, color: c.textPrimary},
  input: {marginBottom: 12},
  errorText: {color: c.error, fontSize: 13, marginBottom: 12},
  confirmButton: {borderRadius: 8},
  confirmedCard: {
    backgroundColor: c.successLight15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.success,
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  confirmedText: {fontSize: 16, fontWeight: 'bold', color: c.success, textAlign: 'center'},
});
