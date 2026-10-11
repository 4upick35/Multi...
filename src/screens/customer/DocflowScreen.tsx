import React, {useEffect, useState, useCallback, useMemo} from 'react';
import {View, StyleSheet, FlatList, RefreshControl} from 'react-native';
import {Text, Chip, Divider} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import BackButton from '../../components/BackButton';
import {useAppTheme} from '../../theme';
import {fetchDocflowSearch} from '../../services/elma-api';
import type {DocflowItem} from '../../services/elma-api';
import type {ElmaAccount} from '../../types/account';
import {useActiveAccount} from '../../hooks/useActiveAccount';
import {useRefresh} from '../../hooks/useRefresh';

type Props = {onBack: () => void};
type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

function DocflowCard({item, styles}: {item: DocflowItem; styles: ReturnType<typeof createStyles>}) {
  const {colors} = useAppTheme();
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Icon name="file-document-outline" size={20} color={colors.primary} />
        <Text style={styles.cardName} numberOfLines={2}>{item.name || '(без названия)'}</Text>
      </View>
      {item.type ? (
        <View style={styles.cardMeta}>
          <Text style={styles.metaLabel}>Тип:</Text>
          <Text style={styles.metaValue}>{item.type}</Text>
        </View>
      ) : null}
      {item.status ? (
        <View style={styles.cardMeta}>
          <Text style={styles.metaLabel}>Статус:</Text>
          <Chip compact style={styles.statusChip} textStyle={{fontSize: 11}}>{item.status}</Chip>
        </View>
      ) : null}
      {item.createdAt ? (
        <View style={styles.cardMeta}>
          <Text style={styles.metaLabel}>Дата:</Text>
          <Text style={styles.metaValue}>{new Date(item.createdAt).toLocaleDateString('ru')}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function DocflowScreen({onBack}: Props) {
  const {account: activeAccount} = useActiveAccount();
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [approvalItems, setApprovalItems] = useState<DocflowItem[]>([]);
  const [approvalTotal, setApprovalTotal] = useState(0);
  const [informItems, setInformItems] = useState<DocflowItem[]>([]);
  const [informTotal, setInformTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async (acc?: ElmaAccount) => {
    const account = acc || activeAccount;
    if (!account) {
      setLoading(false);
      return;
    }
    const result = await fetchDocflowSearch(account);
    if (result.docflow) {
      setApprovalItems(result.docflow.approval.lists || []);
      setApprovalTotal(result.docflow.approval.total);
      setInformItems(result.docflow.inform.lists || []);
      setInformTotal(result.docflow.inform.total);
    }
    setLoading(false);
  }, [activeAccount]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const {refreshing, onRefresh} = useRefresh(async () => {
    await loadData();
  });

  const isEmpty = approvalItems.length === 0 && informItems.length === 0;

  return (
    <View style={styles.container}>
      <BackButton onBack={onBack} />
      <Text variant="titleLarge" style={styles.header}>Согласования</Text>

      {loading ? (
        <View style={styles.center}>
          <Text style={styles.hint}>Загрузка…</Text>
        </View>
      ) : isEmpty ? (
        <View style={styles.center}>
          <Icon name="check-circle-outline" size={48} color={colors.textTertiary} />
          <Text style={styles.hint}>Нет данных</Text>
        </View>
      ) : (
        <FlatList
          data={[
            {type: 'section', title: `На согласовании (${approvalTotal})`, items: approvalItems},
            {type: 'section', title: `На ознакомление (${informTotal})`, items: informItems},
          ].filter(s => s.items.length > 0)}
          keyExtractor={item => item.title}
          renderItem={({item: section}) => (
            <View>
              <Text variant="titleSmall" style={styles.sectionTitle}>{section.title}</Text>
              {section.items.map((doc: DocflowItem) => (
                <DocflowCard key={doc.id} item={doc} styles={styles} />
              ))}
              <Divider style={styles.divider} />
            </View>
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
          }
        />
      )}
    </View>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.background},
  center: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  header: {fontWeight: 'bold', paddingHorizontal: 16, paddingBottom: 8},
  hint: {fontSize: 14, color: c.textTertiary, marginTop: 8},
  list: {paddingHorizontal: 12, paddingBottom: 40},
  sectionTitle: {fontWeight: '600', marginTop: 8, marginBottom: 4, paddingHorizontal: 4, color: c.textSubtle},
  card: {
    backgroundColor: c.surface,
    borderRadius: 10,
    padding: 12,
    marginVertical: 4,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  cardHeader: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6},
  cardName: {flex: 1, fontSize: 14, fontWeight: '500', color: c.textPrimary},
  cardMeta: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4},
  metaLabel: {fontSize: 12, color: c.textSecondary},
  metaValue: {fontSize: 12, color: c.textSubtle},
  statusChip: {height: 22, backgroundColor: c.chipDefault},
  divider: {marginVertical: 8},
});
