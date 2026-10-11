import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {View, StyleSheet, ScrollView, Alert, Linking, TouchableOpacity, ToastAndroid} from 'react-native';
import {Text, Button, Chip, Divider, FAB} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import BackButton from '../../components/BackButton';
import CaptchaModal from '../../components/CaptchaModal';
import VisitScheduleModal from '../../components/VisitScheduleModal';
import {CollectionItem, CollectionMeta} from '../../types/customer-service';
import {useActiveAccount} from '../../hooks/useActiveAccount';
import {useSecureScreen} from '../../hooks/useSecureScreen';
import {useAcceptApplication, canAccept} from '../../hooks/useAcceptApplication';
import {useApplicationActions} from '../../hooks/useApplicationActions';
import type {ElmaAccount} from '../../types/account';
import {fileGetLink, fileDownloadLink, fetchPicassoEntityStatus} from '../../services/elma-api';
import type {PicassoSignStatus} from '../../services/elma-api';
import {loadCollection} from '../../services/customer-service';
import {getExtraFields, buildAddress, displayFieldValue} from '../../utils/collection-fields';
import {buildApplicationMessage} from '../../utils/application-message';
import {getFieldCollectionMap, resolveRefNames} from '../../services/app-metadata';
import {parsePhoneDisplay, parsePhoneTel, parseApplicantName} from '../../utils/card-fields';
import {copyToClipboard} from '../../native/KeepAlive';
import {isSafeExternalUrl} from '../../utils/url';
import {useAppTheme} from '../../theme';

type Props = {
  item: CollectionItem;
  collection: CollectionMeta;
  onBack: () => void;
};

type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

interface Attachment {
  id?: string;
  hash?: string;
  name: string;
}

/** Tolerant extraction of file attachments from raw data */
function getAttachments(raw: Record<string, unknown>): Attachment[] {
  const filesRaw = raw.files || raw.file;
  if (!Array.isArray(filesRaw)) {
    return [];
  }
  return (filesRaw as Record<string, unknown>[])
    .filter((f) => f && typeof f === 'object')
    .map((f) => ({
      id: (f.id as string) || (f.Id as string) || undefined,
      hash: (f.hash as string) || (f.Hash as string) || undefined,
      name: (f.name as string) || (f.Name as string) || (f.fileName as string) || 'Файл',
    }));
}

/** Форматировать ISO-дату в читаемый вид */
function formatDate(iso: string): string {
  if (!iso) { return ''; }
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) { return iso; }
    return d.toLocaleDateString('ru', {day: 'numeric', month: 'long', year: 'numeric'});
  } catch {
    return iso;
  }
}

/** Форматировать дату+время */
function formatDateTime(iso: string): string {
  if (!iso) { return ''; }
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) { return iso; }
    return d.toLocaleDateString('ru', {day: 'numeric', month: 'long', year: 'numeric'}) +
      ' ' + d.toLocaleTimeString('ru', {hour: '2-digit', minute: '2-digit'});
  } catch {
    return iso;
  }
}

export default function CollectionDetailScreen({item, collection, onBack}: Props) {
  useSecureScreen();
  const attachments = getAttachments(item.raw);

  const {account: activeAccount, accounts} = useActiveAccount();
  const itemAccount = item.accountId ? (accounts.find(a => a.id === item.accountId) ?? null) : null;
  const currentAccount = item.accountId ? itemAccount : activeAccount;
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Резолв имён ссылочных полей (UUID → имена)
  const [resolvedRefs, setResolvedRefs] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!currentAccount) {
      return;
    }
    let cancelled = false;
    getFieldCollectionMap(currentAccount).then(fieldMap => {
      if (cancelled || fieldMap.size === 0) {
        return;
      }
      return resolveRefNames(currentAccount, item.raw, fieldMap);
    }).then(refNames => {
      if (!cancelled && refNames && refNames.size > 0) {
        setResolvedRefs(refNames);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentAccount, item.raw]);

  const extraFields = getExtraFields(item.raw, resolvedRefs, collection.key);

  const isApplications = collection.key === 'applications';
  const showAcceptBtn = isApplications && currentAccount != null && canAccept(item.raw);
  const showScheduleVisitBtn = isApplications && currentAccount != null && item.raw.show_set_date_of_visit === true;

  const acceptFlow = useAcceptApplication(
    useCallback((acc: ElmaAccount) => {
      loadCollection(acc, collection.key);
    }, [collection.key]),
  );

  const actions = useApplicationActions(
    currentAccount ?? null,
    useCallback(() => {
      if (currentAccount) {
        loadCollection(currentAccount, collection.key);
      }
    }, [currentAccount, collection.key]),
  );

  // #23: Picasso sign status
  const [signStatus, setSignStatus] = useState<PicassoSignStatus | null>(null);
  const hasFiles = attachments.length > 0;
  const signsCount = signStatus?.signsCount ?? 0;
  const signAttr = signStatus?.signStatuses?.attributes;

  useEffect(() => {
    if (!currentAccount || !hasFiles) {
      return;
    }
    const collNs = String(item.raw.__collectionNamespace || 'customer_service');
    const collCode = String(item.raw.__collectionCode || collection.key);
    fetchPicassoEntityStatus(currentAccount, collNs, collCode, item.id).then(result => {
      if (result.status && (result.status.signsCount > 0 || result.status.signStatuses)) {
        setSignStatus(result.status);
      }
    });
  }, [currentAccount, item.id, hasFiles, collection.key, item.raw]);

  const handleOpenFile = useCallback(
    async (att: Attachment) => {
      if (!currentAccount) {
        Alert.alert('Ошибка', 'Нет активного аккаунта');
        return;
      }
      try {
        let url: string | null = null;
        if (att.id) {
          const result = await fileGetLink(currentAccount, att.id);
          url = result.url;
        } else if (att.hash) {
          const result = await fileDownloadLink(currentAccount, att.hash);
          url = result.url;
        }
        if (url) {
          if (isSafeExternalUrl(url)) {
            Linking.openURL(url).catch(() => {
              Alert.alert('Ошибка', 'Не удалось открыть ссылку');
            });
          } else {
            Alert.alert('Ссылка заблокирована', 'Разрешены только ссылки https, tel и mailto.');
          }
        } else {
          Alert.alert('Ошибка', 'Не удалось получить ссылку на файл');
        }
      } catch {
        Alert.alert('Ошибка', 'Не удалось загрузить ссылку на файл');
      }
    },
    [currentAccount],
  );

  return (
    <View style={styles.container}>
    <ScrollView contentContainerStyle={styles.content}>
      <BackButton onBack={onBack} />

      {currentAccount && (
        <CaptchaModal
          visible={acceptFlow.captchaVisible}
          siteKey={acceptFlow.captchaSiteKey}
          baseUrl={currentAccount.baseUrl}
          onSuccess={acceptFlow.onCaptchaSuccess}
          onExpired={acceptFlow.onCaptchaExpired}
          onError={acceptFlow.onCaptchaError}
          onCancel={acceptFlow.onCaptchaCancel}
        />
      )}

      {currentAccount && (
        <VisitScheduleModal
          visible={actions.actionState === 'readyToSchedule' || actions.actionState === 'sending'}
          applicationId={item.id}
          loading={actions.actionState === 'sending'}
          masters={actions.masters}
          minDate={actions.minDate}
          onCancel={actions.cancelSchedule}
          onSubmit={(visitDateIso, masterId) => {
            actions.submitVisit(item.id, visitDateIso, masterId).then((ok) => {
              if (ok) {
                onBack();
              }
            });
          }}
        />
      )}

      <View style={styles.headerRow}>
        <Icon name={collection.icon} size={22} color={colors.primary} />
        <Text variant="titleMedium" style={styles.headerTitle}>
          {collection.label}
        </Text>
      </View>

      <Text variant="headlineSmall" style={styles.name}>
        {item.name || '(без названия)'}
      </Text>

      {item.status ? (
        <View style={styles.fieldRow}>
          <Text style={styles.label}>Статус:</Text>
          <Chip compact style={item.statusColor ? {backgroundColor: item.statusColor + '20'} : undefined} textStyle={item.statusColor ? {color: item.statusColor} : undefined}>{item.status}</Chip>
        </View>
      ) : null}

      {item.createdAt ? (
        <View style={styles.fieldRow}>
          <Text style={styles.label}>Создано:</Text>
          <Text>{formatDate(item.createdAt)}</Text>
        </View>
      ) : null}

      {isApplications && (() => {
        const raw = item.raw;
        const address = buildAddress(raw);
        const phone = parsePhoneDisplay(raw.client_phone_number);
        const phoneTel = parsePhoneTel(raw.client_phone_number);
        const applicant = parseApplicantName(raw.client_applicant) || displayFieldValue(raw.client_applicant, resolvedRefs, 'client_applicant');
        const technic = displayFieldValue(raw.technic, resolvedRefs, 'technic');
        const requirement = displayFieldValue(raw.customers_requirement_ref, resolvedRefs, 'customers_requirement_ref');
        const visitDt = String(raw.datetime_of_session || '').trim();

        const openAddress = () => {
          if (!address) { return; }
          const encoded = encodeURIComponent(address);
          const url = `geo:0,0?q=${encoded}`;
          Linking.canOpenURL(url).then(supported => {
            if (supported) {
              if (isSafeExternalUrl(url)) {
                Linking.openURL(url);
              } else {
                Alert.alert('Ссылка заблокирована', 'Разрешены только ссылки https, tel и mailto.');
              }
            } else {
              const fallbackUrl = `https://yandex.ru/maps/?text=${encoded}`;
              if (isSafeExternalUrl(fallbackUrl)) {
                Linking.openURL(fallbackUrl);
              } else {
                Alert.alert('Ссылка заблокирована', 'Разрешены только ссылки https, tel и mailto.');
              }
            }
          }).catch(() => {
            const fallbackUrl = `https://yandex.ru/maps/?text=${encoded}`;
            if (isSafeExternalUrl(fallbackUrl)) {
              Linking.openURL(fallbackUrl);
            } else {
              Alert.alert('Ссылка заблокирована', 'Разрешены только ссылки https, tel и mailto.');
            }
          });
        };

        const openPhone = () => {
          if (!phoneTel) { return; }
          const url = `tel:${phoneTel}`;
          if (isSafeExternalUrl(url)) {
            Linking.openURL(url).catch(() => {
              Alert.alert('Ошибка', 'Не удалось открыть номер');
            });
          } else {
            Alert.alert('Ссылка заблокирована', 'Разрешены только ссылки https, tel и mailto.');
          }
        };

        const hasFields = address || phone || applicant || technic || requirement || visitDt;
        if (!hasFields) { return null; }

        return (
          <>
            <Divider style={styles.divider} />
            {applicant ? (
              <View style={styles.fieldRow}>
                <Text style={styles.label}>Заявитель:</Text>
                <Text style={styles.fieldValue}>{applicant}</Text>
              </View>
            ) : null}
            {phone ? (
              <TouchableOpacity style={styles.fieldRow} onPress={openPhone}>
                <Text style={styles.label}>Телефон:</Text>
                <Text style={[styles.fieldValue, styles.linkText]}>{phone}</Text>
              </TouchableOpacity>
            ) : null}
            {address ? (
              <TouchableOpacity style={styles.fieldRow} onPress={openAddress}>
                <Text style={styles.label}>Адрес:</Text>
                <Text style={[styles.fieldValue, styles.linkText]}>{address}</Text>
              </TouchableOpacity>
            ) : null}
            {technic ? (
              <View style={styles.fieldRow}>
                <Text style={styles.label}>Техника:</Text>
                <Text style={styles.fieldValue}>{technic}</Text>
              </View>
            ) : null}
            {requirement ? (
              <View style={styles.fieldRow}>
                <Text style={styles.label}>Требование:</Text>
                <Text style={styles.fieldValue}>{requirement}</Text>
              </View>
            ) : null}
            {visitDt ? (
              <View style={styles.fieldRow}>
                <Text style={styles.label}>Визит:</Text>
                <Text style={styles.fieldValue}>{formatDateTime(visitDt)}</Text>
              </View>
            ) : null}
          </>
        );
      })()}

      {showAcceptBtn && (
        <View style={styles.acceptRow}>
          <Button
            mode="contained"
            buttonColor={colors.success}
            onPress={() => {
              if (currentAccount) {
                acceptFlow.accept(item.id, currentAccount);
              }
            }}
            disabled={acceptFlow.flowState !== 'idle' && acceptFlow.flowState !== 'done' && acceptFlow.flowState !== 'error'}
            loading={acceptFlow.flowState === 'gettingTemplate' || acceptFlow.flowState === 'gettingKeys' || acceptFlow.flowState === 'verifying' || acceptFlow.flowState === 'running'}
            style={styles.acceptButton}>
            Принять заявку
          </Button>
        </View>
      )}

      {showScheduleVisitBtn && (
        <View style={styles.acceptRow}>
          <Button
            mode="contained"
            buttonColor={colors.success}
            onPress={() => actions.scheduleVisit(item.id)}
            disabled={actions.actionState !== 'idle' && actions.actionState !== 'done' && actions.actionState !== 'error' && actions.actionState !== 'readyToSchedule'}
            loading={actions.actionState === 'loadingForm'}
            style={styles.acceptButton}>
            Назначить визит
          </Button>
        </View>
      )}

      {isApplications && currentAccount != null && (
        <View style={styles.acceptRow}>
          <Button
            mode="contained"
            buttonColor={colors.primary30}
            onPress={() => {
              actions.createDocumentPackage(item.id).then((ok) => {
                if (ok) {
                  onBack();
                }
              });
            }}
            disabled={actions.actionState !== 'idle' && actions.actionState !== 'done' && actions.actionState !== 'error'}
            loading={actions.actionState === 'sending'}
            style={styles.acceptButton}>
            Сформировать пакет документов
          </Button>
        </View>
      )}

      {extraFields.length > 0 && (
        <>
          <Divider style={styles.divider} />
          <Text variant="titleSmall" style={styles.extraTitle}>
            Дополнительные поля
          </Text>
          {extraFields.map((f) => (
            <View key={f.label} style={styles.fieldRow}>
              <Text style={styles.label}>{f.label}:</Text>
              <Text style={styles.fieldValue} numberOfLines={3}>
                {f.value}
              </Text>
            </View>
          ))}
        </>
      )}

      {attachments.length > 0 && (
        <>
          <Divider style={styles.divider} />
          <Text variant="titleSmall" style={styles.extraTitle}>
            Вложения
          </Text>
          {attachments.map((att, idx) => (
            <View key={`${att.name}-${idx}`} style={styles.attachmentRow}>
              <Icon name="file-document" size={18} color={colors.textSecondary} />
              <Text style={styles.attachmentName} numberOfLines={1}>
                {att.name}
              </Text>
              <Button mode="text" compact onPress={() => handleOpenFile(att)}>
                Открыть
              </Button>
            </View>
          ))}
        </>
      )}

      {/* #23: Статус подписи документа */}
      {signStatus && signsCount > 0 && (
        <>
          <Divider style={styles.divider} />
          <View style={styles.signRow}>
            <Icon name="signature" size={18} color="#6200EE" />
            <Text style={styles.signLabel}>Подписей:</Text>
            <Chip compact style={{backgroundColor: colors.primaryLight15}} textStyle={{color: colors.primary, fontSize: 11}}>
              {signsCount}
            </Chip>
            {signAttr && signAttr !== 'unknown' ? (
              <Chip compact style={{backgroundColor: colors.successLight15}} textStyle={{color: colors.success, fontSize: 11}}>
                {signAttr}
              </Chip>
            ) : null}
          </View>
        </>
      )}
    </ScrollView>
    {isApplications && (
      <FAB
        icon="content-copy"
        style={styles.copyFab}
        onPress={() => {
          const msg = buildApplicationMessage(item.raw, resolvedRefs);
          copyToClipboard(msg);
          ToastAndroid.show('Скопировано', ToastAndroid.SHORT);
        }}
      />
    )}
    </View>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.surface},
  content: {paddingHorizontal: 16, paddingTop: 4, paddingBottom: 120},
  headerRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12},
  headerTitle: {fontWeight: '600'},
  name: {fontWeight: 'bold', marginBottom: 16},
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
  },
  label: {fontWeight: '600', minWidth: 90, color: c.textSubtle},
  fieldValue: {flex: 1, color: c.textSubtle},
  linkText: {color: c.primary, textDecorationLine: 'underline'},
  divider: {marginVertical: 16},
  extraTitle: {fontWeight: '600', marginBottom: 8, color: c.textSecondary},
  attachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  attachmentName: {flex: 1, color: c.textSubtle},
  signRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8},
  signLabel: {fontSize: 13, fontWeight: '600', color: c.textSubtle},
  acceptRow: {marginVertical: 12},
  acceptButton: {borderRadius: 8},
  copyFab: {position: 'absolute', right: 16, bottom: 16, zIndex: 10},
});
