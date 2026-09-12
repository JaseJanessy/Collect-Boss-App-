import * as Linking from 'expo-linking';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CollectBossPocketWordmark } from '@/components/brand-wordmark';
import { PocketTokens } from '@/constants/theme';
import { useAuth } from '@/providers/auth-provider';
import {
  activePocketNavigation,
  pocketDestinationForPath,
  pocketDestinations,
  pocketPathFromUrl,
  pocketPrimaryNavigation,
} from '../../../../shared/pocket-navigation';
import type { WorkspaceContextResponse } from '../../../../shared/workspace-contracts';

type PocketPath = string;

export function PocketApp({ context }: { context: WorkspaceContextResponse }) {
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const [path, setPath] = useState<PocketPath>('/pocket');
  const active = activePocketNavigation(path);

  useEffect(() => {
    const open = (value: string | null) => {
      if (!value) return;
      const next = pocketPathFromUrl(value);
      if (next) setPath(next);
    };
    void Linking.getInitialURL().then(open);
    const subscription = Linking.addEventListener('url', ({ url }) => open(url));
    return () => subscription.remove();
  }, []);

  const content = useMemo(() => <PocketScreen path={path} navigate={setPath} />, [path]);
  const navigation = (
    <View accessibilityRole="tablist" accessibilityLabel="Pocket primary navigation" style={tablet ? styles.railNavigation : styles.bottomNavigation}>
      {pocketPrimaryNavigation.map((item) => {
        const selected = active?.id === item.id;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected }}
            onPress={() => setPath(item.href)}
            style={[tablet ? styles.railTab : styles.bottomTab, selected && styles.selectedTab, item.id === 'add' && !tablet && styles.addTab]}
          >
            <Text numberOfLines={1} style={[styles.tabText, selected && styles.selectedTabText]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <SafeAreaView style={styles.app} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.headerText}><CollectBossPocketWordmark compact/><Text numberOfLines={1} style={styles.businessName}>{context.workspace.name}</Text></View>
        <Text style={styles.plan}>{context.plan.slug}</Text>
      </View>
      {context.workspace.lifecycleState !== 'active' ? <View accessibilityRole="alert" style={styles.readOnly}><Text style={styles.readOnlyText}>This Pocket business is read-only. Your information remains available.</Text></View> : null}
      <View style={styles.body}>
        {tablet ? navigation : null}
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>{content}</ScrollView>
      </View>
      {!tablet ? navigation : null}
    </SafeAreaView>
  );
}

function PocketScreen({ path, navigate }: { path: string; navigate: (path: string) => void }) {
  const { signOut } = useAuth();
  if (path === '/pocket') {
    const actions = pocketDestinations.filter((item) => ['add-debt', 'record-payment', 'scan-receipt', 'who-owes-me'].includes(item.id));
    return <><PageTitle eyebrow="CollectBoss Pocket" title="Today" /><View style={styles.cardGrid}>{actions.map((item) => <ActionCard key={item.id} id={item.id} label={item.label} description={item.description} onPress={() => navigate(item.href)} />)}</View><Empty title="Nothing needs your attention" message="Due Today and Overdue stay together on your Pocket home." /></>;
  }
  if (path === '/pocket/customers') return <><PageTitle eyebrow="Customer Profiles" title="Customers" /><Empty title="No customers to show" message="Only customers from this authorised Pocket business will appear here." /></>;
  if (path === '/pocket/add') {
    const actions = pocketDestinations.filter((item) => item.owner === 'add');
    return <><PageTitle eyebrow="One thing at a time" title="Add" /><View style={styles.cardGrid}>{actions.map((item) => <ActionCard key={item.id} id={item.id} label={item.label} description={item.description} onPress={() => navigate(item.href)} />)}</View></>;
  }
  if (path === '/pocket/activity') return <><PageTitle eyebrow="Recent updates" title="Activity" /><Empty title="No activity yet" message="Payments, receipts, and reminders from this Pocket business will appear here." /></>;
  if (path === '/pocket/more') {
    const links = pocketDestinations.filter((item) => ['basic-reports', 'settings', 'receipts', 'reminders'].includes(item.id));
    return <><PageTitle eyebrow="Pocket tools" title="More" />{links.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => navigate(item.href)} style={styles.listItem}><Text style={styles.cardTitle}>{item.label}</Text><Text style={styles.chevron}>›</Text></Pressable>)}<Pressable accessibilityRole="button" accessibilityLabel="Sign out of CollectBoss Pocket" onPress={() => Alert.alert('Sign out?', 'You can sign in again to return to your business.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => void signOut() }])} style={styles.signOutButton}><Text style={styles.signOutText}>Sign out</Text></Pressable></>;
  }
  const destination = pocketDestinationForPath(path);
  if (destination) return <><PageTitle eyebrow="CollectBoss Pocket" title={destination.label} /><View style={styles.placeholder}><Text style={styles.copy}>{destination.description}</Text><Text style={styles.muted}>This destination uses the same authorised Pocket business and shared services as the web workspace.</Text><Pressable accessibilityRole="button" onPress={() => navigate('/pocket')} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Back to Home</Text></Pressable></View></>;
  return <><PageTitle eyebrow="CollectBoss Pocket" title="Page unavailable" /><Empty title="This page could not be opened" message="Return Home and choose an available Pocket destination." /></>;
}

function PageTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <View style={styles.pageTitle}><Text style={styles.eyebrow}>{eyebrow}</Text><Text accessibilityRole="header" style={styles.title}>{title}</Text></View>;
}

const actionSymbol: Record<string,string> = { 'add-debt': '+', 'record-payment': 'RM', 'scan-receipt': '▣', 'who-owes-me': '◎' };

function ActionCard({ id, label, description, onPress }: { id: string; label: string; description: string; onPress: () => void }) {
  const accent = actionAccent[id] ?? actionAccent['add-debt']!;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label}. ${description}`} onPress={onPress} style={({pressed})=>[styles.actionCard,{borderColor:accent.color},pressed&&styles.actionCardPressed]}><View style={[styles.actionIcon,{backgroundColor:accent.surface}]}><Text style={[styles.actionIconText,{color:accent.color}]}>{actionSymbol[id]??'+'}</Text></View><Text style={styles.cardTitle}>{label}</Text><Text style={styles.muted}>{description}</Text></Pressable>;
}

function Empty({ title, message }: { title: string; message: string }) {
  return <View style={styles.empty}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.muted}>{message}</Text></View>;
}

const colors = PocketTokens.color;
const actionAccent: Record<string,{color:string;surface:string}> = {
  'add-debt': { color: colors.addDebt, surface: colors.addDebtSurface },
  'record-payment': { color: colors.recordPayment, surface: colors.recordPaymentSurface },
  'scan-receipt': { color: colors.scanReceipt, surface: colors.scanReceiptSurface },
  'who-owes-me': { color: colors.whoOwesMe, surface: colors.whoOwesMeSurface },
};
const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.canvas },
  header: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, backgroundColor: colors.surface },
  headerText: { flex: 1, minWidth: 0, gap: 4 }, businessName: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  plan: { color: colors.primary, fontSize: 11, fontWeight: '700', backgroundColor: colors.selectedSurface, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  readOnly: { paddingHorizontal: 18, paddingVertical: 10, backgroundColor: '#FFF3D6' }, readOnlyText: { color: '#8A4B08', fontSize: 12, lineHeight: 18, textAlign: 'center', fontWeight: '600' },
  body: { flex: 1, flexDirection: 'row' }, content: { width: '100%', maxWidth: 1040, alignSelf: 'center', padding: 20, paddingBottom: 40, gap: 18 },
  railNavigation: { width: 164, padding: 14, gap: 8, backgroundColor: colors.brandNavy }, railTab: { minHeight: PocketTokens.targetSize, justifyContent: 'center', borderRadius: 14, paddingHorizontal: 14 },
  bottomNavigation: { minHeight: 72, flexDirection: 'row', alignItems: 'stretch', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, backgroundColor: colors.surface }, bottomTab: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }, addTab: { marginTop: -8, marginHorizontal: 3, minHeight: 60, borderRadius: 18, backgroundColor: colors.primary },
  selectedTab: { backgroundColor: colors.brandGreen }, tabText: { color: colors.muted, fontSize: 11, fontWeight: '600' }, selectedTabText: { color: colors.brandNavy, fontWeight: '700' },
  pageTitle: { gap: 5 }, eyebrow: { color: colors.primary, fontSize: 13, fontWeight: '700' }, title: { color: colors.ink, fontSize: 30, lineHeight: 36, fontWeight: '700' },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, actionCard: { flexGrow: 1, flexBasis: 190, minHeight: 150, justifyContent: 'center', gap: 8, padding: 18, borderRadius: 22, borderWidth: 1, borderBottomWidth: 3, borderBottomColor: colors.line, backgroundColor: colors.surface }, actionCardPressed: { transform: [{translateY: 2}], borderBottomWidth: 1 }, actionIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 16 }, actionIconText: { fontSize: 20, fontWeight: '700' },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' }, copy: { color: colors.ink, fontSize: 15, lineHeight: 22 }, muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  empty: { alignItems: 'center', gap: 8, padding: 30, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, backgroundColor: colors.surface },
  listItem: { minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, backgroundColor: colors.surface }, chevron: { color: colors.primary, fontSize: 24, fontWeight: '600' },
  placeholder: { gap: 13, padding: 22, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, backgroundColor: colors.surface }, secondaryButton: { minHeight: PocketTokens.targetSize, alignSelf: 'flex-start', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.primary, paddingHorizontal: 18 }, secondaryButtonText: { color: colors.primary, fontWeight: '700' },
  signOutButton: { minHeight: PocketTokens.targetSize, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: colors.surface, paddingHorizontal: 18 }, signOutText: { color: colors.overdue, fontWeight: '700' },
});
