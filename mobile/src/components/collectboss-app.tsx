import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  cents,
  isInStatementPeriod,
  loadOwnerData,
  money,
  shortDate,
  statementDates,
  statementPeriodLabels,
  type CollectionCase,
  type OwnerData,
  type StatementPeriod,
} from '@/lib/collectboss';
import { useAuth } from '@/providers/auth-provider';

type Screen = 'dashboard' | 'cases' | 'payments' | 'reports' | 'more' | 'plans' | 'statements';

const colors = {
  navy: '#102A43',
  blue: '#1479D1',
  paleBlue: '#EAF4FF',
  canvas: '#F6F8FB',
  card: '#FFFFFF',
  text: '#14213D',
  muted: '#5E6C84',
  border: '#D9E2EC',
  green: '#137A4B',
  amber: '#A66000',
  red: '#B42318',
};

function ScreenShell({ children, refreshing, onRefresh }: { children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.blue} /> : undefined}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

function Brand() {
  return (
    <View style={styles.brandRow}>
      <View style={styles.brandMark}><Text style={styles.brandMarkText}>CB</Text></View>
      <Text style={styles.brandText}>CollectBoss</Text>
    </View>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function Metric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'green' | 'amber' }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, tone === 'green' && { color: colors.green }, tone === 'amber' && { color: colors.amber }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Status({ children }: { children: string }) {
  const lower = children.toLowerCase();
  const style = lower.includes('approved') || lower.includes('active') || lower.includes('paid') ? styles.statusGood : lower.includes('pending') ? styles.statusWarn : styles.statusNeutral;
  return <Text style={[styles.status, style]} numberOfLines={1}>{children.replace(/_/g, ' ')}</Text>;
}

function Empty({ title, message }: { title: string; message: string }) {
  return <Card style={styles.empty}><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyCopy}>{message}</Text></Card>;
}

function CaseRow({ item }: { item: CollectionCase }) {
  return (
    <Card style={styles.listCard}>
      <View style={styles.rowBetween}>
        <View style={styles.grow}><Text style={styles.itemTitle} numberOfLines={1}>{item.debtor_name}</Text><Text style={styles.itemMeta} numberOfLines={1}>{item.id}{item.invoice_no ? ` · ${item.invoice_no}` : ''}</Text></View>
        <Status>{item.status}</Status>
      </View>
      <View style={styles.rowBetween}><Text style={styles.itemMeta}>Due {shortDate(item.due_date)}</Text><Text style={styles.amount}>{money(item.balance)}</Text></View>
    </Card>
  );
}

function SignInScreen() {
  const { configured, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) { setError('Enter your email address and password.'); return; }
    setBusy(true);
    try { await signIn(email, password); } catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Sign-in failed. Please try again.'); } finally { setBusy(false); }
  };
  return (
    <ScreenShell>
      <View style={styles.loginTop}><Brand /><Text style={styles.loginTitle}>Your collections, in your pocket.</Text><Text style={styles.loginCopy}>Sign in to view live cases, payments, plans, reports, and collection activity.</Text></View>
      {!configured ? <Card><Text style={styles.errorTitle}>Supabase is not configured</Text><Text style={styles.errorCopy}>This app deliberately has no demo data. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to the mobile app’s local .env file, then restart Expo.</Text></Card> : <Card>
        <Text style={styles.sectionTitle}>Sign in</Text>
        <Text style={styles.inputLabel}>Email</Text><TextInput value={email} onChangeText={setEmail} inputMode="email" autoCapitalize="none" autoCorrect={false} placeholder="you@business.com" placeholderTextColor="#7B8794" style={styles.input} />
        <Text style={styles.inputLabel}>Password</Text><TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="Your password" placeholderTextColor="#7B8794" style={styles.input} />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <Pressable onPress={() => void submit()} disabled={busy} style={[styles.primaryButton, busy && styles.disabled]}><Text style={styles.primaryButtonText}>{busy ? 'Signing in…' : 'Sign in securely'}</Text></Pressable>
      </Card>}
    </ScreenShell>
  );
}

function Dashboard({ data, onOpen }: { data: OwnerData; onOpen: (screen: Screen) => void }) {
  const outstanding = data.cases.reduce((sum, item) => sum + cents(item.balance), 0);
  const paid = data.cases.reduce((sum, item) => sum + cents(item.amount_paid), 0);
  const activePlans = data.plans.filter((item) => item.status === 'active').length;
  return <><View style={styles.pageHeader}><Text style={styles.kicker}>LIVE OVERVIEW</Text><Text style={styles.pageTitle}>Good to see you{data.business ? ',' : ''}</Text><Text style={styles.pageSub}>{data.business?.business_name ?? 'Set up your CollectBoss business to begin.'}</Text></View>
    <Card style={styles.primaryCard}><Text style={styles.primaryLabel}>Outstanding balance</Text><Text style={styles.primaryValue}>{money(outstanding / 100)}</Text><Text style={styles.primaryCaption}>Across {data.cases.length} live case{data.cases.length === 1 ? '' : 's'}</Text></Card>
    <View style={styles.metricGrid}><Metric label="Recovered" value={money(paid / 100)} tone="green" /><Metric label="Active plans" value={String(activePlans)} tone="amber" /></View>
    <Text style={styles.sectionTitle}>Quick access</Text><View style={styles.actionGrid}>
      <Action label="Cases" caption="Open collection cases" onPress={() => onOpen('cases')} /><Action label="Payments" caption="Review activity" onPress={() => onOpen('payments')} />
      <Action label="Reports" caption="Live portfolio health" onPress={() => onOpen('reports')} /><Action label="Statements" caption="Collection activity" onPress={() => onOpen('statements')} />
    </View>
    <View style={styles.rowBetween}><Text style={styles.sectionTitle}>Recent cases</Text><Pressable onPress={() => onOpen('cases')}><Text style={styles.link}>View all</Text></Pressable></View>
    {data.cases.slice(0, 3).map((item) => <CaseRow key={item.id} item={item} />)}
    {!data.cases.length ? <Empty title="No cases yet" message="New cases created in CollectBoss will appear here." /> : null}
  </>;
}

function Action({ label, caption, onPress }: { label: string; caption: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.action}><Text style={styles.actionTitle}>{label}</Text><Text style={styles.actionCaption}>{caption}</Text></Pressable>;
}

function CasesScreen({ data }: { data: OwnerData }) {
  const [search, setSearch] = useState('');
  const list = data.cases.filter((item) => `${item.debtor_name} ${item.id} ${item.invoice_no ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return <><PageHeader title="Cases" subtitle="Live collection cases in your business." /><TextInput value={search} onChangeText={setSearch} placeholder="Search debtor, case or invoice" placeholderTextColor="#7B8794" style={styles.input} />{list.map((item) => <CaseRow key={item.id} item={item} />)}{!list.length ? <Empty title="No matching cases" message={search ? 'Try a different case reference or debtor name.' : 'Cases will appear here when they are created.'} /> : null}</>;
}

function PaymentsScreen({ data }: { data: OwnerData }) {
  const names = useMemo(() => new Map(data.cases.map((item) => [item.id, item.debtor_name])), [data.cases]);
  return <><PageHeader title="Payments" subtitle="Submitted and reviewed payment activity." />{data.payments.map((item) => <Card key={item.id} style={styles.listCard}><View style={styles.rowBetween}><View style={styles.grow}><Text style={styles.itemTitle} numberOfLines={1}>{names.get(item.case_id) ?? item.case_id}</Text><Text style={styles.itemMeta} numberOfLines={1}>{item.case_id}{item.reference_no ? ` · ${item.reference_no}` : ''}</Text></View><Status>{item.review_status}</Status></View><View style={styles.rowBetween}><Text style={styles.itemMeta}>{shortDate(item.created_at)} · {item.payment_method}</Text><Text style={styles.amount}>{money(item.amount)}</Text></View></Card>)}{!data.payments.length ? <Empty title="No payment activity" message="Payment submissions will appear here when available." /> : null}</>;
}

function PlansScreen({ data }: { data: OwnerData }) {
  const names = useMemo(() => new Map(data.cases.map((item) => [item.id, item.debtor_name])), [data.cases]);
  return <><PageHeader title="Payment plans" subtitle="Active and historical arrangements." />{data.plans.map((item) => <Card key={item.id} style={styles.listCard}><View style={styles.rowBetween}><View style={styles.grow}><Text style={styles.itemTitle} numberOfLines={1}>{names.get(item.case_id) ?? item.case_id}</Text><Text style={styles.itemMeta}>{item.case_id} · Starts {shortDate(item.start_date)}</Text></View><Status>{item.status}</Status></View><View style={styles.rowBetween}><Text style={styles.itemMeta}>{item.installment_count} instalments × {money(item.installment_amount)}</Text><Text style={styles.amount}>{money(item.total_amount)}</Text></View></Card>)}{!data.plans.length ? <Empty title="No payment plans" message="Plans created for your cases will appear here." /> : null}</>;
}

function ReportsScreen({ data }: { data: OwnerData }) {
  const due = data.cases.reduce((sum, item) => sum + cents(item.amount_owed), 0);
  const paid = data.cases.reduce((sum, item) => sum + cents(item.amount_paid), 0);
  const outstanding = data.cases.reduce((sum, item) => sum + cents(item.balance), 0);
  const approved = data.payments.filter((item) => item.review_status === 'approved').reduce((sum, item) => sum + cents(item.amount), 0);
  return <><PageHeader title="Reports" subtitle="A real-time view of your collection portfolio." /><View style={styles.reportGrid}><Metric label="Total due" value={money(due / 100)} /><Metric label="Current outstanding" value={money(outstanding / 100)} tone="amber" /><Metric label="Amount recorded paid" value={money(paid / 100)} tone="green" /><Metric label="Approved payment activity" value={money(approved / 100)} tone="green" /></View><Card><Text style={styles.sectionTitle}>Portfolio health</Text><Text style={styles.reportLine}>{data.cases.length} total cases</Text><Text style={styles.reportLine}>{data.cases.filter((item) => item.status === 'paid').length} paid cases</Text><Text style={styles.reportLine}>{data.cases.filter((item) => item.days_overdue > 0).length} overdue cases</Text></Card></>;
}

function StatementsScreen({ data }: { data: OwnerData }) {
  const [period, setPeriod] = useState<StatementPeriod>('3m');
  const { start, end } = statementDates(period);
  const paid = data.payments.filter((item) => item.review_status === 'approved' && isInStatementPeriod(item.reviewed_at ?? item.created_at, period));
  const caseIds = new Set(paid.map((item) => item.case_id));
  const activityCases = data.cases.filter((item) => isInStatementPeriod(item.created_at, period) || caseIds.has(item.id));
  const totalDue = activityCases.reduce((sum, item) => sum + cents(item.amount_owed), 0);
  const totalOutstanding = activityCases.reduce((sum, item) => sum + cents(item.balance), 0);
  const totalPaid = paid.reduce((sum, item) => sum + cents(item.amount), 0);
  const names = new Map(data.cases.map((item) => [item.id, item.debtor_name]));
  return <><PageHeader title="Statements" subtitle="Live collection activity from your CollectBoss records." />
    <Text style={styles.inputLabel}>Statement period</Text><View style={styles.periods}>{(Object.keys(statementPeriodLabels) as StatementPeriod[]).map((key) => <Pressable key={key} onPress={() => setPeriod(key)} style={[styles.period, period === key && styles.periodSelected]}><Text style={[styles.periodText, period === key && styles.periodTextSelected]}>{key === '12m' ? '1 Year' : key.toUpperCase()}</Text></Pressable>)}</View>
    <Card><Text style={styles.itemTitle}>{statementPeriodLabels[period]}</Text><Text style={styles.itemMeta}>{shortDate(start.toISOString())} – {shortDate(end.toISOString())}</Text></Card>
    <View style={styles.reportGrid}><Metric label="Cases in activity" value={String(activityCases.length)} /><Metric label="Amount due" value={money(totalDue / 100)} /><Metric label="Approved payments" value={money(totalPaid / 100)} tone="green" /><Metric label="Current outstanding" value={money(totalOutstanding / 100)} tone="amber" /></View>
    <Text style={styles.sectionTitle}>Payment activity</Text>{paid.map((item) => <Card key={item.id} style={styles.listCard}><View style={styles.rowBetween}><View style={styles.grow}><Text style={styles.itemTitle} numberOfLines={1}>{names.get(item.case_id) ?? item.case_id}</Text><Text style={styles.itemMeta}>{item.case_id}{item.reference_no ? ` · ${item.reference_no}` : ''}</Text></View><Text style={styles.amount}>{money(item.amount)}</Text></View><Text style={styles.itemMeta}>{shortDate(item.reviewed_at ?? item.created_at)} · {item.payment_method} · Approved</Text></Card>)}{!paid.length ? <Empty title="No statement activity" message="No approved payment activity was found for the selected period." /> : null}
    <Text style={styles.disclaimer}>Collection Activity Statement: values reflect live approved payment records and current case balances. Verify records against official payment documentation where required.</Text>
  </>;
}

function MoreScreen({ data, onOpen, onSignOut }: { data: OwnerData; onOpen: (screen: Screen) => void; onSignOut: () => void }) {
  return <><PageHeader title="More" subtitle={data.business?.business_name ?? 'CollectBoss account'} /><Action label="Payment plans" caption="View customer repayment arrangements" onPress={() => onOpen('plans')} /><Action label="Statements" caption="View collection activity by period" onPress={() => onOpen('statements')} /><Pressable onPress={onSignOut} style={styles.signOut}><Text style={styles.signOutText}>Sign out</Text></Pressable></>;
}

function PageHeader({ title, subtitle }: { title: string; subtitle: string }) { return <View style={styles.pageHeader}><Text style={styles.pageTitle}>{title}</Text><Text style={styles.pageSub}>{subtitle}</Text></View>; }

export function CollectBossApp() {
  const { session, initializing, signOut } = useAuth();
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [data, setData] = useState<OwnerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true); setError(null);
    try { setData(await loadOwnerData(session.user.id)); }
    catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Could not load your live CollectBoss data.';
      setError(message);
      if (/jwt|session.*expired|not authenticated/i.test(message)) void signOut();
    } finally { setLoading(false); }
  }, [session, signOut]);
  useEffect(() => { void refresh(); }, [refresh]);
  if (initializing) return <SafeAreaView style={styles.loadingScreen}><ActivityIndicator size="large" color={colors.blue} /><Text style={styles.loadingText}>Opening CollectBoss…</Text></SafeAreaView>;
  if (!session) return <SignInScreen />;
  const render = () => {
    if (loading && !data) return <View style={styles.center}><ActivityIndicator size="large" color={colors.blue} /><Text style={styles.loadingText}>Loading live business data…</Text></View>;
    if (error && !data) return <View style={styles.center}><Text style={styles.errorTitle}>Unable to load your account</Text><Text style={styles.errorCopy}>{error}</Text><Pressable onPress={() => void refresh()} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Retry</Text></Pressable></View>;
    const current = data ?? { business: null, cases: [], payments: [], plans: [] };
    switch (screen) {
      case 'cases': return <CasesScreen data={current} />;
      case 'payments': return <PaymentsScreen data={current} />;
      case 'reports': return <ReportsScreen data={current} />;
      case 'plans': return <PlansScreen data={current} />;
      case 'statements': return <StatementsScreen data={current} />;
      case 'more': return <MoreScreen data={current} onOpen={setScreen} onSignOut={() => Alert.alert('Sign out?', 'You will need to sign in again to access your data.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => void signOut() }])} />;
      default: return <Dashboard data={current} onOpen={setScreen} />;
    }
  };
  return <SafeAreaView style={styles.app} edges={['bottom']}><ScreenShell refreshing={loading} onRefresh={() => void refresh()}>{error ? <Card style={styles.inlineError}><Text style={styles.errorCopy}>{error}</Text><Pressable onPress={() => void refresh()}><Text style={styles.link}>Retry</Text></Pressable></Card> : null}{render()}</ScreenShell><View style={styles.tabBar}>{([['dashboard', 'Home'], ['cases', 'Cases'], ['payments', 'Payments'], ['reports', 'Reports'], ['more', 'More']] as const).map(([key, label]) => <Pressable key={key} onPress={() => setScreen(key)} style={styles.tab}><Text style={[styles.tabText, screen === key && styles.tabTextActive]}>{label}</Text></Pressable>)}</View></SafeAreaView>;
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.canvas }, safe: { flex: 1, backgroundColor: colors.canvas }, content: { padding: 20, paddingBottom: 28, gap: 12, width: '100%', maxWidth: 900, alignSelf: 'center' }, loadingScreen: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, backgroundColor: colors.canvas }, center: { flex: 1, minHeight: 420, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 12 }, loadingText: { color: colors.muted, fontSize: 15 }, brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, brandMark: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.blue }, brandMarkText: { color: '#fff', fontSize: 13, fontWeight: '800' }, brandText: { color: colors.navy, fontSize: 20, fontWeight: '800' }, loginTop: { gap: 12, paddingTop: 32, paddingBottom: 14 }, loginTitle: { color: colors.navy, fontSize: 30, lineHeight: 37, fontWeight: '800' }, loginCopy: { color: colors.muted, fontSize: 16, lineHeight: 23 }, pageHeader: { paddingTop: 5, paddingBottom: 7, gap: 4 }, kicker: { color: colors.blue, fontSize: 12, fontWeight: '800', letterSpacing: 1 }, pageTitle: { color: colors.navy, fontSize: 28, lineHeight: 35, fontWeight: '800' }, pageSub: { color: colors.muted, fontSize: 15, lineHeight: 21 }, card: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 16, gap: 10 }, primaryCard: { backgroundColor: colors.navy, borderColor: colors.navy }, primaryLabel: { color: '#D9EAFB', fontSize: 14, fontWeight: '700' }, primaryValue: { color: '#fff', fontSize: 31, fontWeight: '800' }, primaryCaption: { color: '#BED7F2', fontSize: 14 }, metricGrid: { flexDirection: 'row', gap: 12 }, reportGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, metric: { flexGrow: 1, flexBasis: 145, minWidth: 0, backgroundColor: colors.card, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, gap: 6 }, metricLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' }, metricValue: { color: colors.navy, fontSize: 20, fontWeight: '800' }, sectionTitle: { color: colors.navy, fontSize: 18, fontWeight: '800', marginTop: 8 }, actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, action: { flexGrow: 1, flexBasis: 150, minHeight: 82, justifyContent: 'center', gap: 5, backgroundColor: colors.paleBlue, borderRadius: 14, padding: 14 }, actionTitle: { color: colors.navy, fontSize: 16, fontWeight: '800' }, actionCaption: { color: colors.muted, fontSize: 12, lineHeight: 17 }, rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, grow: { flex: 1, minWidth: 0 }, listCard: { gap: 9 }, itemTitle: { color: colors.text, fontSize: 16, fontWeight: '800' }, itemMeta: { color: colors.muted, fontSize: 13, lineHeight: 18 }, amount: { color: colors.navy, fontSize: 16, fontWeight: '800', flexShrink: 0 }, status: { maxWidth: 105, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, fontSize: 11, fontWeight: '800', textTransform: 'capitalize' }, statusGood: { color: colors.green, backgroundColor: '#DCFCE7' }, statusWarn: { color: colors.amber, backgroundColor: '#FFF3D6' }, statusNeutral: { color: '#36506C', backgroundColor: '#EAF0F6' }, inputLabel: { color: colors.text, fontSize: 13, fontWeight: '800', marginTop: 4 }, input: { minHeight: 50, borderRadius: 12, borderColor: colors.border, borderWidth: 1, backgroundColor: '#fff', color: colors.text, paddingHorizontal: 13, fontSize: 16 }, primaryButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.blue, borderRadius: 12, paddingHorizontal: 16, marginTop: 8 }, primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' }, disabled: { opacity: 0.65 }, errorText: { color: colors.red, fontSize: 13, lineHeight: 18 }, errorTitle: { color: colors.red, fontSize: 18, fontWeight: '800' }, errorCopy: { color: colors.muted, fontSize: 14, lineHeight: 20 }, inlineError: { backgroundColor: '#FFF7F5', borderColor: '#FDA29B', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, link: { color: colors.blue, fontWeight: '800', fontSize: 14 }, empty: { alignItems: 'center', paddingVertical: 28 }, emptyTitle: { color: colors.navy, fontSize: 17, fontWeight: '800' }, emptyCopy: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' }, periods: { flexDirection: 'row', gap: 8 }, period: { flex: 1, minHeight: 42, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: '#fff', paddingHorizontal: 5 }, periodSelected: { backgroundColor: colors.blue, borderColor: colors.blue }, periodText: { color: colors.text, fontSize: 12, fontWeight: '800' }, periodTextSelected: { color: '#fff' }, reportLine: { color: colors.muted, fontSize: 15, lineHeight: 25 }, disclaimer: { color: colors.muted, fontSize: 12, lineHeight: 18, paddingTop: 6 }, signOut: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#FDA29B', backgroundColor: '#FFF7F5', marginTop: 12 }, signOutText: { color: colors.red, fontSize: 16, fontWeight: '800' }, tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: '#fff', paddingTop: 8, paddingBottom: 10 }, tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 }, tabText: { color: colors.muted, fontSize: 11, fontWeight: '700' }, tabTextActive: { color: colors.blue, fontWeight: '900' },
});
