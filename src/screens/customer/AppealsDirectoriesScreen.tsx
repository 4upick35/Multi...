import React, {useEffect, useState, useCallback, useMemo} from 'react';
import {View, StyleSheet, FlatList, RefreshControl} from 'react-native';
import {Text, Chip} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import BackButton from '../../components/BackButton';
import {useAppTheme} from '../../theme';
import {fetchAppealsDirectories} from '../../services/elma-api';
import type {AppealsDirectoryItem} from '../../services/elma-api';
import type {ElmaAccount} from '../../types/account';
import {useActiveAccount} from '../../hooks/useActiveAccount';
import {useRefresh} from '../../hooks/useRefresh';

type Props = {onBack: () => void};
type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

interface TreeNode extends AppealsDirectoryItem {
  children: TreeNode[];
}

function buildTree(items: AppealsDirectoryItem[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  for (const item of items) {
    map.set(item.id, {...item, children: []});
  }
  for (const item of items) {
    const node = map.get(item.id)!;
    if (item.parent === '00000000-0000-0000-0000-000000000000' || !map.has(item.parent)) {
      roots.push(node);
    } else {
      map.get(item.parent)!.children.push(node);
    }
  }
  roots.sort((a, b) => a.sort - b.sort);
  return roots;
}

function TreeNodeItem({node, depth, styles}: {node: TreeNode; depth: number; styles: ReturnType<typeof createStyles>}) {
  const {colors} = useAppTheme();
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  return (
    <View>
      <View style={[styles.treeRow, {paddingLeft: 16 + depth * 20}]}>
        {hasChildren ? (
          <Icon
            name={expanded ? 'chevron-down' : 'chevron-right'}
            size={20}
            color={colors.textSecondary}
            onPress={() => setExpanded(!expanded)}
          />
        ) : (
          <View style={{width: 20}} />
        )}
        <Icon name="folder-outline" size={18} color={colors.primary} />
        <Text style={styles.treeLabel} numberOfLines={2}>{node.name}</Text>
        {hasChildren && (
          <Chip compact style={styles.countChip} textStyle={{fontSize: 10}}>
            {node.children.length}
          </Chip>
        )}
      </View>
      {expanded && hasChildren && node.children.map(child => (
        <TreeNodeItem key={child.id} node={child} depth={depth + 1} styles={styles} />
      ))}
    </View>
  );
}

export default function AppealsDirectoriesScreen({onBack}: Props) {
  const {account: activeAccount} = useActiveAccount();
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [directories, setDirectories] = useState<AppealsDirectoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async (acc?: ElmaAccount) => {
    const account = acc || activeAccount;
    if (!account) {
      return;
    }
    const result = await fetchAppealsDirectories(account);
    setDirectories(result.directories);
    setLoading(false);
  }, [activeAccount]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const {refreshing, onRefresh} = useRefresh(async () => {
    await loadData();
  });

  const tree = buildTree(directories);

  return (
    <View style={styles.container}>
      <BackButton onBack={onBack} />
      <Text variant="titleLarge" style={styles.header}>Категории обращений</Text>
      {loading ? (
        <View style={styles.center}>
          <Text style={styles.hint}>Загрузка…</Text>
        </View>
      ) : tree.length === 0 ? (
        <View style={styles.center}>
          <Icon name="folder-open-outline" size={48} color={colors.textTertiary} />
          <Text style={styles.hint}>Нет данных</Text>
        </View>
      ) : (
        <FlatList
          data={tree}
          keyExtractor={item => item.id}
          renderItem={({item}) => <TreeNodeItem node={item} depth={0} styles={styles} />}
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
  treeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.separator,
  },
  treeLabel: {flex: 1, fontSize: 14, color: c.textPrimary},
  countChip: {height: 22, backgroundColor: c.primaryLight15},
});
