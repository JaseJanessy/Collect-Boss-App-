import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useNetworkState } from 'expo-network';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet,
  Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TransactionReview } from '@/components/transaction-review';
import { TransactionRouting } from '@/components/transaction-routing';
import { CollectBossAuthScreen } from '@/components/auth-screen';
import { CollectBossWordmark } from '@/components/brand-wordmark';
import { CollectBossTokens } from '@/constants/theme';
import { loadDrafts, removeDraft, saveDraft } from '@/lib/draft-store';
import {
  cents, loadCaseDisputes, loadOwnerData, markNotificationRead, money, shortDate,
  type CollectionCase, type MobileDispute, type MobileNotification, type OwnerData,
} from '@/lib/collectboss';
import { completeLowRiskAction, submitDraft, type DraftProgress } from '@/lib/mobile-workflows';
import { registerForPushNotifications, subscribeToNotificationRoutes } from '@/lib/push-notifications';
import {
  cancelTransactionIntake, createTransactionIntake, getTransactionExtraction, listTransactionEvidence, listTransactionIntakes,
  MOBILE_IMAGE_LIMITS, MOBILE_PDF_LIMITS,
  removeTransactionEvidence, retryTransactionExtraction, startTransactionPdfUpload, transactionEvidencePreviewUrl,
  validateSelectedTransactionImage, validateSelectedTransactionPdf, type SelectedTransactionEvidence,
  type SelectedTransactionImage, type TransactionEvidence,
  type TransactionExtraction, type TransactionIntake, type TransactionUploadProgress,
} from '@/lib/transaction-intake';
import {
  canApproveOnMobile, isSessionExpiry, type MobileAttachment, type MobileDraft, type MobileDraftKind,
  type MobileRoute,
} from '@/lib/workflow-core';
import { useAuth } from '@/providers/auth-provider';
import { navigationItemIsVisible, primaryNavigation, type PrimaryNavigationItem } from '../../../shared/navigation';

type PrimaryScreen = PrimaryNavigationItem['id'];
type Screen = PrimaryScreen | 'more' | 'plans' | 'notifications' | 'case-detail' | 'transaction-intake';
type CaseFilter = 'all' | 'priority' | 'overdue' | 'recent';

const colors = {
  navy: CollectBossTokens.color.navy, primary: CollectBossTokens.color.primary,
  canvas: CollectBossTokens.color.canvas, card: CollectBossTokens.color.surface,
  text: CollectBossTokens.color.foreground, muted: CollectBossTokens.color.mutedForeground,
  border: CollectBossTokens.color.border, green: CollectBossTokens.color.verified,
  amber: CollectBossTokens.color.warning, red: CollectBossTokens.color.failed,
  inverse: CollectBossTokens.color.inverseForeground,
  inverseMuted: CollectBossTokens.color.inverseMutedForeground,
  selectedSurface: CollectBossTokens.color.selectedSurface,
  neutralSurface: CollectBossTokens.color.neutralSurface,
  successSurface: CollectBossTokens.color.successSurface,
  successBorder: CollectBossTokens.color.successBorder,
  warningSurface: CollectBossTokens.color.warningSurface,
  warningBorder: CollectBossTokens.color.warningBorder,
  dangerSurface: CollectBossTokens.color.dangerSurface,
  dangerBorder: CollectBossTokens.color.dangerBorder,
  disabledSurface: CollectBossTokens.color.disabledSurface,
  disabledBorder: CollectBossTokens.color.disabledBorder,
};

const emptyData: OwnerData = {
  business: null, permissions: [], cases: [], payments: [], plans: [], actions: [], notifications: [],
};

function ScreenShell({ children, refreshing, onRefresh }: { children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  return <SafeAreaView style={styles.safe} edges={['top']}><ScrollView
    keyboardShouldPersistTaps="handled"
    contentContainerStyle={styles.content}
    refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}
  >{children}</ScrollView></SafeAreaView>;
}

function Brand() {
  return <CollectBossWordmark />;
}

function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function PageHeader({ title, subtitle, onBack }: { title: string; subtitle: string; onBack?: () => void }) {
  return <View style={styles.pageHeader}>{onBack ? <Pressable accessibilityRole="button" onPress={onBack} style={styles.backButton}><Text style={styles.link}>‹ Back</Text></Pressable> : null}<Text style={styles.pageTitle}>{title}</Text><Text style={styles.pageSub}>{subtitle}</Text></View>;
}

function Status({ children }: { children: string }) {
  const lower = children.toLowerCase();
  const tone = lower.includes('paid') || lower.includes('approved') || lower.includes('complete') ? styles.statusGood
    : lower.includes('high') || lower.includes('critical') || lower.includes('failed') || lower.includes('overdue') ? styles.statusRisk
      : lower.includes('pending') || lower.includes('medium') ? styles.statusWarn : styles.statusNeutral;
  return <Text accessibilityLabel={`Status: ${children.replace(/_/g, ' ')}`} style={[styles.status, tone]} numberOfLines={1}>● {children.replace(/_/g, ' ')}</Text>;
}

function Empty({ title, message }: { title: string; message: string }) {
  return <Card style={styles.empty}><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyCopy}>{message}</Text></Card>;
}

function Feedback({ tone, children }: { tone: 'success' | 'pending' | 'error'; children: React.ReactNode }) {
  return <View accessibilityRole="alert" style={[styles.feedback, tone === 'success' ? styles.feedbackGood : tone === 'error' ? styles.feedbackError : styles.feedbackPending]}><Text style={styles.feedbackText}>{children}</Text></View>;
}

function PrimaryButton({ label, onPress, disabled, tone = 'primary' }: { label: string; onPress: () => void; disabled?: boolean; tone?: 'primary' | 'secondary' }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }} onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.primaryButton, tone === 'secondary' && styles.secondaryButton, pressed && (tone === 'secondary' ? styles.secondaryButtonPressed : styles.primaryButtonPressed), disabled && styles.disabled]}><Text style={[styles.primaryButtonText, tone === 'secondary' && styles.secondaryButtonText, disabled && styles.disabledText]}>{label}</Text></Pressable>;
}

function SignInScreen() {
  return <CollectBossAuthScreen />;
}

function CaseRow({ item, onOpen }: { item: CollectionCase; onOpen: (item: CollectionCase) => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open case ${item.id} for ${item.debtor_name}`} onPress={() => onOpen(item)} style={styles.pressableCard}><View style={styles.rowBetween}><View style={styles.grow}><Text style={styles.itemTitle} numberOfLines={1}>{item.debtor_name}</Text><Text style={styles.itemMeta} numberOfLines={1}>{item.id}{item.invoice_no ? ` · ${item.invoice_no}` : ''}</Text></View><Status>{item.status}</Status></View><View style={styles.rowBetween}><Text style={styles.itemMeta}>Due {shortDate(item.due_date)}</Text><Text style={styles.amount}>{money(item.balance, item.currency)}</Text></View></Pressable>;
}

function Dashboard({ data, drafts, onOpen, onCase }: { data: OwnerData; drafts: MobileDraft[]; onOpen: (screen: Screen) => void; onCase: (item: CollectionCase) => void }) {
  const outstanding = data.cases.reduce((sum, item) => sum + cents(item.balance), 0);
  const priorities = data.actions.filter((item) => item.priority === 'critical' || item.priority === 'high').length;
  return <><PageHeader title="Today" subtitle={data.business?.business_name ?? 'Complete business setup on the web to begin.'} /><Card style={styles.hero}><Text style={styles.heroLabel}>Outstanding balance</Text><Text style={styles.heroValue}>{money(outstanding / 100)}</Text><Text style={styles.heroCopy}>{priorities} priority action{priorities === 1 ? '' : 's'} · {drafts.length} pending draft{drafts.length === 1 ? '' : 's'}</Text></Card><Text style={styles.sectionTitle}>Fast actions</Text><View style={styles.actionGrid}>{data.permissions.includes('document_intake.create') ? <QuickAction label="Scan transaction" caption="Upload a transaction PDF" onPress={() => onOpen('transaction-intake')} /> : null}<QuickAction label="Search cases" caption="Find debtor or invoice" onPress={() => onOpen('cases')} /><QuickAction label="Priority review" caption="Work urgent actions" onPress={() => onOpen('action-centre')} /><QuickAction label="Pending drafts" caption="Retry saved work" onPress={() => onOpen('more')} /></View><View style={styles.rowBetween}><Text style={styles.sectionTitle}>Recent cases</Text><Pressable onPress={() => onOpen('cases')}><Text style={styles.link}>View all</Text></Pressable></View>{data.cases.slice(0, 4).map((item) => <CaseRow key={item.id} item={item} onOpen={onCase} />)}{!data.cases.length ? <Empty title="No cases" message="Cases created in the authorised business will appear here." /> : null}</>;
}

function QuickAction({ label, caption, onPress }: { label: string; caption: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.quickAction}><Text style={styles.itemTitle}>{label}</Text><Text style={styles.itemMeta}>{caption}</Text></Pressable>;
}

function CasesScreen({ data, onOpen, onTransactionIntake }: { data: OwnerData; onOpen: (item: CollectionCase) => void; onTransactionIntake: () => void }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CaseFilter>('all');
  const priorityCases = useMemo(() => new Set(data.actions.filter((item) => item.priority === 'critical' || item.priority === 'high').flatMap((item) => item.case_id ? [item.case_id] : [])), [data.actions]);
  const list = data.cases.filter((item, index) => {
    const matches = `${item.debtor_name} ${item.debtor_company ?? ''} ${item.id} ${item.invoice_no ?? ''}`.toLowerCase().includes(search.trim().toLowerCase());
    if (!matches) return false;
    if (filter === 'priority') return priorityCases.has(item.id) || item.days_overdue >= 30;
    if (filter === 'overdue') return item.days_overdue > 0;
    if (filter === 'recent') return index < 10;
    return true;
  });
  return <><PageHeader title="Cases" subtitle="Search and act without downloading a complete case dataset." />{data.permissions.includes('document_intake.create') ? <PrimaryButton label="New case from transaction PDF" onPress={onTransactionIntake} /> : null}<TextInput accessibilityLabel="Search cases" value={search} onChangeText={setSearch} placeholder="Debtor, case or invoice" placeholderTextColor={colors.muted} style={styles.input} /><View style={styles.chips}>{(['all', 'priority', 'overdue', 'recent'] as CaseFilter[]).map((item) => <Pressable key={item} onPress={() => setFilter(item)} style={[styles.chip, filter === item && styles.chipActive]}><Text style={[styles.chipText, filter === item && styles.chipTextActive]}>{item}</Text></Pressable>)}</View>{list.map((item) => <CaseRow key={item.id} item={item} onOpen={onOpen} />)}{!list.length ? <Empty title="No matching cases" message="Try another search or filter." /> : null}</>;
}

function Workflows({ item, userId, online, permissions, onDraftsChanged, onSubmitted }: { item: CollectionCase; userId: string; online: boolean; permissions: string[]; onDraftsChanged: () => Promise<void>; onSubmitted: () => Promise<void> }) {
  const [kind, setKind] = useState<MobileDraftKind>('promise');
  const [amount, setAmount] = useState('');
  const [promiseDate, setPromiseDate] = useState(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [attachment, setAttachment] = useState<MobileAttachment | undefined>();
  const [evidenceType, setEvidenceType] = useState<'payment_proof' | 'other'>('payment_proof');
  const [disputes, setDisputes] = useState<MobileDispute[]>([]);
  const [selectedDispute, setSelectedDispute] = useState('');
  const [disputeStatus, setDisputeStatus] = useState('under_review');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<DraftProgress | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'pending' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    void loadCaseDisputes(item.id).then((rows) => { if (active) { setDisputes(rows); setSelectedDispute(rows.find((row) => !['resolved', 'withdrawn', 'accepted', 'rejected'].includes(row.status))?.id ?? ''); } }).catch((error: unknown) => { if (active) setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Unable to load disputes.' }); });
    return () => { active = false; };
  }, [item.id]);

  const chooseCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { setFeedback({ tone: 'error', text: 'Camera permission is required to capture a document.' }); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (!result.canceled) {
      const asset = result.assets[0];
      setAttachment({ uri: asset.uri, name: asset.fileName ?? `capture-${Date.now()}.jpg`, mimeType: asset.mimeType ?? 'image/jpeg', size: asset.fileSize ?? null });
    }
  };
  const chooseFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/png', 'image/jpeg'], copyToCacheDirectory: true });
    if (!result.canceled) {
      const asset = result.assets[0];
      setAttachment({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'application/octet-stream', size: asset.size ?? null });
    }
  };

  const createDraft = (): MobileDraft => ({
    id: Crypto.randomUUID(), userId, caseId: item.id, kind,
    payload: kind === 'promise' ? { amount, promiseDate, note, currency: item.currency }
      : kind === 'note' ? { note }
        : kind === 'dispute_update' ? { disputeId: selectedDispute, status: disputeStatus, response: note, currency: item.currency }
          : { evidenceType, description: note },
    attachment: kind === 'evidence' ? attachment : undefined,
    state: 'pending', attempts: 0, createdAt: new Date().toISOString(),
  });

  const validate = () => {
    if (kind === 'promise' && (!amount.trim() || !/^\d+(?:\.\d{1,3})?$/.test(amount) || !/^\d{4}-\d{2}-\d{2}$/.test(promiseDate))) return 'Enter a valid amount and YYYY-MM-DD promise date.';
    if (kind === 'note' && !note.trim()) return 'Enter a note.';
    if (kind === 'dispute_update' && !selectedDispute) return 'Choose an active dispute.';
    if (kind === 'dispute_update' && disputeStatus === 'information_requested' && !note.trim()) return 'Explain what information is required.';
    if (kind === 'evidence' && !attachment) return 'Capture or choose a file first.';
    if (attachment?.size && attachment.size > 10 * 1024 * 1024) return 'Files must be 10 MB or smaller.';
    return null;
  };
  const save = async (sendNow: boolean) => {
    const invalid = validate(); if (invalid) { setFeedback({ tone: 'error', text: invalid }); return; }
    const draft = createDraft(); setBusy(true); setFeedback(null); setProgress(null);
    try {
      await saveDraft(draft); await onDraftsChanged();
      if (!sendNow || !online) {
        setFeedback({ tone: 'pending', text: online ? 'Draft saved securely on this device.' : 'Offline: draft saved securely and ready to retry.' });
      } else {
        await submitDraft(draft, setProgress); await onDraftsChanged(); await onSubmitted();
        setFeedback({ tone: 'success', text: kind === 'evidence' ? 'Upload completed and attached to the case.' : 'Update submitted successfully.' });
        setAmount(''); setNote(''); setAttachment(undefined);
      }
    } catch (error) { setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Submission failed. The draft remains saved.' }); await onDraftsChanged(); }
    finally { setBusy(false); }
  };

  const options: { id: MobileDraftKind; label: string; permission: string }[] = [
    { id: 'promise', label: 'Promise', permission: 'promise.manage' }, { id: 'note', label: 'Note', permission: 'note.manage' },
    { id: 'dispute_update', label: 'Dispute', permission: 'dispute.resolve' }, { id: 'evidence', label: 'Upload', permission: 'case.manage' },
  ];
  const allowedOptions = options.filter((option) => permissions.includes(option.permission));
  if (!allowedOptions.length) return <Card><Feedback tone="pending">Your role has read-only mobile access for this case.</Feedback></Card>;
  return <Card><Text style={styles.sectionTitle}>Case action</Text><View style={styles.chips}>{allowedOptions.map((option) => <Pressable key={option.id} onPress={() => { setKind(option.id); setFeedback(null); }} style={[styles.chip, kind === option.id && styles.chipActive]}><Text style={[styles.chipText, kind === option.id && styles.chipTextActive]}>{option.label}</Text></Pressable>)}</View>
    {kind === 'promise' ? <><Text style={styles.inputLabel}>Promised amount ({item.currency})</Text><TextInput accessibilityLabel="Promised amount" value={amount} onChangeText={setAmount} inputMode="decimal" style={styles.input} /><Text style={styles.inputLabel}>Promise date</Text><TextInput accessibilityLabel="Promise date" value={promiseDate} onChangeText={setPromiseDate} placeholder="YYYY-MM-DD" style={styles.input} /></> : null}
    {kind === 'dispute_update' ? <>{disputes.length ? <><Text style={styles.inputLabel}>Active dispute</Text><View style={styles.chips}>{disputes.filter((row) => !['resolved', 'withdrawn', 'accepted', 'rejected'].includes(row.status)).map((row) => <Pressable key={row.id} onPress={() => setSelectedDispute(row.id)} style={[styles.chip, selectedDispute === row.id && styles.chipActive]}><Text style={[styles.chipText, selectedDispute === row.id && styles.chipTextActive]} numberOfLines={1}>{row.reason}</Text></Pressable>)}</View><Text style={styles.inputLabel}>Update</Text><View style={styles.chips}>{['under_review', 'information_requested'].map((status) => <Pressable key={status} onPress={() => setDisputeStatus(status)} style={[styles.chip, disputeStatus === status && styles.chipActive]}><Text style={[styles.chipText, disputeStatus === status && styles.chipTextActive]}>{status.replace(/_/g, ' ')}</Text></Pressable>)}</View></> : <Feedback tone="pending">No active dispute is available for a mobile update.</Feedback>}</> : null}
    {kind === 'evidence' ? <><Text style={styles.inputLabel}>Attachment type</Text><View style={styles.chips}>{(['payment_proof', 'other'] as const).map((type) => <Pressable key={type} onPress={() => setEvidenceType(type)} style={[styles.chip, evidenceType === type && styles.chipActive]}><Text style={[styles.chipText, evidenceType === type && styles.chipTextActive]}>{type === 'payment_proof' ? 'Payment proof' : 'Document'}</Text></Pressable>)}</View><View style={styles.buttonRow}><PrimaryButton label="Camera" tone="secondary" onPress={() => void chooseCamera()} /><PrimaryButton label="Choose file" tone="secondary" onPress={() => void chooseFile()} /></View>{attachment ? <Feedback tone="pending">Selected: {attachment.name}{attachment.size ? ` · ${Math.ceil(attachment.size / 1024)} KB` : ''}</Feedback> : null}</> : null}
    {kind !== 'evidence' || attachment ? <><Text style={styles.inputLabel}>{kind === 'note' ? 'Internal note' : kind === 'dispute_update' ? 'Response / context' : 'Optional note'}</Text><TextInput accessibilityLabel="Workflow note" value={note} onChangeText={setNote} multiline maxLength={1_600} style={[styles.input, styles.textArea]} /></> : null}
    {progress ? <Feedback tone="pending">Uploading {progress.ratio === null ? `${progress.sent} bytes` : `${Math.round(progress.ratio * 100)}%`}…</Feedback> : null}{feedback ? <Feedback tone={feedback.tone}>{feedback.text}</Feedback> : null}<View style={styles.buttonRow}><PrimaryButton label={busy ? 'Working…' : online ? 'Submit' : 'Save offline'} disabled={busy} onPress={() => void save(true)} /><PrimaryButton label="Save draft" tone="secondary" disabled={busy} onPress={() => void save(false)} /></View><Text style={styles.disclaimer}>Uploads attach evidence only. Transaction intake, OCR, amount confirmation, and profile matching remain outside this mobile foundation.</Text>
  </Card>;
}

function CaseDetail({ item, userId, online, permissions, drafts, onBack, onRefreshDrafts, onSubmitted }: { item: CollectionCase; userId: string; online: boolean; permissions: string[]; drafts: MobileDraft[]; onBack: () => void; onRefreshDrafts: () => Promise<void>; onSubmitted: () => Promise<void> }) {
  const pending = drafts.filter((draft) => draft.caseId === item.id).length;
  return <><PageHeader title={item.debtor_name} subtitle={`${item.id}${item.invoice_no ? ` · ${item.invoice_no}` : ''}`} onBack={onBack} /><Card><View style={styles.rowBetween}><Status>{item.status}</Status><Text style={styles.amount}>{money(item.balance, item.currency)}</Text></View><Text style={styles.itemMeta}>Due {shortDate(item.due_date)} · {item.days_overdue} days overdue</Text><Text style={styles.itemMeta}>{item.next_best_action ?? 'No next action recorded.'}</Text>{pending ? <Feedback tone="pending">{pending} protected draft{pending === 1 ? '' : 's'} pending for this case.</Feedback> : null}</Card><Workflows item={item} userId={userId} online={online} permissions={permissions} onDraftsChanged={onRefreshDrafts} onSubmitted={onSubmitted} /></>;
}

function pdfSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function candidateValue(value: string | { currency: string; minor_units: number }) {
  return typeof value === 'string' ? value : `${value.currency} ${(value.minor_units / 100).toFixed(2)}`;
}

function TransactionIntakeScreen({ online, onBack }: { online: boolean; onBack: () => void }) {
  const [saved, setSaved] = useState<TransactionIntake[]>([]);
  const [intake, setIntake] = useState<TransactionIntake | null>(null);
  const [evidence, setEvidence] = useState<TransactionEvidence | null>(null);
  const [extraction, setExtraction] = useState<TransactionExtraction | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [routingOpen, setRoutingOpen] = useState(false);
  const [selected, setSelected] = useState<SelectedTransactionEvidence | null>(null);
  const [imageSource, setImageSource] = useState<'screenshot' | 'bank_in_receipt'>('screenshot');
  const [progress, setProgress] = useState<TransactionUploadProgress | null>(null);
  const [busy, setBusy] = useState<'loading' | 'validating' | 'saving' | 'uploading' | 'removing' | 'cancelling' | null>('loading');
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'pending' | 'error'; text: string } | null>(null);
  const createKey = useRef(Crypto.randomUUID());
  const uploadKey = useRef(Crypto.randomUUID());
  const intakeRef = useRef<TransactionIntake | null>(null);
  const actionGate = useRef(false);
  const activeUploadCancel = useRef<null | (() => Promise<void>)>(null);
  const uploadWasCancelled = useRef(false);

  const refreshSaved = useCallback(async () => {
    try { setSaved(await listTransactionIntakes()); }
    catch (error) { setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Unable to load saved evidence drafts.' }); }
    finally { setBusy((value) => value === 'loading' ? null : value); }
  }, []);
  useEffect(() => { void refreshSaved(); }, [refreshSaved]);

  const openSaved = async (next: TransactionIntake) => {
    if (actionGate.current) return;
    actionGate.current = true; setBusy('loading'); setFeedback(null); setSelected(null); setProgress(null);
    try {
      const [files, currentExtraction] = await Promise.all([listTransactionEvidence(next.id), getTransactionExtraction(next.id)]);
      intakeRef.current = next; setIntake(next); setEvidence(files.find((file) => file.isCurrent) ?? null); setExtraction(currentExtraction);
      setReviewOpen(next.status === 'needs_review'); setRoutingOpen(next.status === 'ready_to_submit');
    } catch (error) { setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Unable to open this evidence draft.' }); }
    finally { actionGate.current = false; setBusy(null); }
  };

  useEffect(() => {
    if (!intake?.id || !evidence?.id) return;
    const shouldPoll = !extraction || extraction.evidenceId !== evidence.id || ['queued', 'processing'].includes(extraction.status);
    if (!shouldPoll) return;
    let active = true;
    const refresh = async () => {
      try { const next = await getTransactionExtraction(intake.id); if (active) setExtraction(next); }
      catch { /* Keep the last safe status; the normal refresh/retry path remains available. */ }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 4_000);
    return () => { active = false; clearInterval(timer); };
  }, [evidence?.id, extraction, intake?.id]);

  const choosePdf = async () => {
    if (actionGate.current) return;
    setFeedback(null);
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: false });
    if (result.canceled) return;
    actionGate.current = true; setBusy('validating'); setProgress(null);
    try {
      const asset = result.assets[0];
      setSelected(await validateSelectedTransactionPdf({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType, size: asset.size }));
      uploadKey.current = Crypto.randomUUID();
      setFeedback({ tone: 'pending', text: 'PDF validated on this device. Upload it to complete server validation.' });
    } catch (error) {
      setSelected(null);
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'This PDF appears to be corrupted or unreadable.' });
    } finally { actionGate.current = false; setBusy(null); }
  };

  const explainDeniedPermission = (label: string, canAskAgain: boolean) => {
    const message = `${label} access is needed only when you choose evidence. CollectBoss does not save captures to your public gallery.`;
    if (canAskAgain) { setFeedback({ tone: 'error', text: message }); return; }
    Alert.alert(`${label} access is off`, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open settings', onPress: () => void Linking.openSettings() },
    ]);
  };

  const chooseImage = async (camera: boolean) => {
    if (actionGate.current) return;
    setFeedback(null);
    const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { explainDeniedPermission(camera ? 'Camera' : 'Photo library', permission.canAskAgain); return; }
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: true })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: true, allowsMultipleSelection: false });
    if (result.canceled) return;
    actionGate.current = true; setBusy('validating'); setProgress(null);
    try {
      const asset = result.assets[0];
      const source = camera ? 'bank_in_receipt' : imageSource;
      const next = await validateSelectedTransactionImage({
        uri: asset.uri, name: asset.fileName ?? `${source}-${Date.now()}.${asset.mimeType === 'image/png' ? 'png' : 'jpg'}`,
        mimeType: asset.mimeType, size: asset.fileSize, width: asset.width, height: asset.height, evidenceSource: source,
      });
      setImageSource(source); setSelected(next); uploadKey.current = Crypto.randomUUID();
      setFeedback({ tone: 'pending', text: 'Image validated on this device. Review readability before uploading.' });
    } catch (error) {
      setSelected(null); setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'The selected image could not be read.' });
    } finally { actionGate.current = false; setBusy(null); }
  };

  const updateImagePreview = async (rotationDegrees: 0 | 90 | 180 | 270, cropInsetPercent: 0 | 5) => {
    if (!selected || selected.evidenceSource === 'pdf' || actionGate.current) return;
    actionGate.current = true; setBusy('validating'); setFeedback(null);
    try {
      const original = selected as SelectedTransactionImage;
      const rotatedWidth = rotationDegrees === 90 || rotationDegrees === 270 ? original.height : original.width;
      const rotatedHeight = rotationDegrees === 90 || rotationDegrees === 270 ? original.width : original.height;
      const insetX = Math.floor(rotatedWidth * cropInsetPercent / 100); const insetY = Math.floor(rotatedHeight * cropInsetPercent / 100);
      const actions: ImageManipulator.Action[] = rotationDegrees ? [{ rotate: rotationDegrees }] : [];
      if (cropInsetPercent) actions.push({ crop: { originX: insetX, originY: insetY, width: rotatedWidth - (2 * insetX), height: rotatedHeight - (2 * insetY) } });
      const preview = await ImageManipulator.manipulateAsync(original.uri, actions, { compress: 0.86, format: ImageManipulator.SaveFormat.JPEG });
      setSelected({ ...original, previewUri: preview.uri, rotationDegrees, cropInsetPercent });
      uploadKey.current = Crypto.randomUUID();
      setFeedback({ tone: 'pending', text: 'Preview updated. The original image remains unchanged.' });
    } catch { setFeedback({ tone: 'error', text: 'Unable to update the preview. Replace or retake the image.' }); }
    finally { actionGate.current = false; setBusy(null); }
  };

  const ensureDraft = async () => {
    if (intake) return intake;
    const created = await createTransactionIntake(createKey.current);
    intakeRef.current = created; setIntake(created);
    return created;
  };

  const saveOnly = async () => {
    if (actionGate.current) return;
    if (!online) { setFeedback({ tone: 'error', text: 'Reconnect to save this secure server draft.' }); return; }
    actionGate.current = true; setBusy('saving'); setFeedback(null);
    try {
      await ensureDraft(); await refreshSaved();
      setFeedback({ tone: 'success', text: 'Draft saved. It will be available after restart or sign-in.' });
    } catch (error) { setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'The upload could not be completed. Please try again.' }); }
    finally { actionGate.current = false; setBusy(null); }
  };

  const upload = async () => {
    if (actionGate.current || !selected) return;
    if (!online) { setFeedback({ tone: 'error', text: 'Reconnect before uploading this evidence.' }); return; }
    actionGate.current = true; uploadWasCancelled.current = false; setBusy('uploading'); setFeedback(null); setProgress({ sent: 0, total: selected.size, ratio: 0 });
    try {
      const draft = await ensureDraft();
      const started = await startTransactionPdfUpload({
        intakeId: draft.id, selected, idempotencyKey: uploadKey.current,
        replacesEvidenceId: evidence?.id, onProgress: setProgress,
      });
      activeUploadCancel.current = () => started.task.cancelAsync();
      if (uploadWasCancelled.current) await started.task.cancelAsync();
      const uploaded = await started.promise;
      const uploadedIntake = { ...draft, status: 'uploaded', version: draft.version + 1, updatedAt: new Date().toISOString() };
      intakeRef.current = uploadedIntake; setEvidence(uploaded); setIntake(uploadedIntake);
      setExtraction(null); setReviewOpen(false); setRoutingOpen(false); setSelected(null); setProgress(null); await refreshSaved();
      setFeedback({
        tone: uploaded.duplicateWarning || uploaded.qualityWarnings.length ? 'pending' : 'success',
        text: uploaded.duplicateWarning ? 'This file may already have been uploaded. Review it before continuing.'
          : uploaded.qualityWarnings.length ? 'Image uploaded, but readability needs review. Retake or replace it if key details are unclear.'
            : 'Evidence uploaded securely. Your document draft is ready to continue.',
      });
    } catch (error) {
      if (!uploadWasCancelled.current) setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'The upload could not be completed. Please try again.' });
    } finally { activeUploadCancel.current = null; actionGate.current = false; setBusy(null); }
  };

  const remove = async () => {
    if (selected) { setSelected(null); setProgress(null); setFeedback(null); uploadKey.current = Crypto.randomUUID(); return; }
    if (!intake || !evidence || actionGate.current) return;
    actionGate.current = true; setBusy('removing'); setFeedback(null);
    try {
      const result = await removeTransactionEvidence(intake.id, evidence.id, Crypto.randomUUID());
      intakeRef.current = result.intake; setIntake(result.intake); setEvidence(null); setExtraction(null); setReviewOpen(false); setRoutingOpen(false); uploadKey.current = Crypto.randomUUID(); await refreshSaved();
      setFeedback({ tone: 'pending', text: 'Evidence removed from this draft. The original remains retained in the audit record.' });
    } catch (error) { setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Unable to remove this evidence.' }); }
    finally { actionGate.current = false; setBusy(null); }
  };

  const cancel = () => Alert.alert('Cancel evidence draft?', 'The draft will be closed. Uploaded originals remain retained for audit and security.', [
    { text: 'Keep draft', style: 'cancel' },
    { text: 'Cancel draft', style: 'destructive', onPress: () => void (async () => {
      if (busy === 'uploading') {
        uploadWasCancelled.current = true;
      }
      if (activeUploadCancel.current) {
        await activeUploadCancel.current().catch(() => undefined);
      }
      const activeIntake = intakeRef.current;
      if (!activeIntake) { onBack(); return; }
      setBusy('cancelling');
      try { await cancelTransactionIntake(activeIntake.id, Crypto.randomUUID()); intakeRef.current = null; setIntake(null); setEvidence(null); setExtraction(null); setReviewOpen(false); setRoutingOpen(false); setSelected(null); await refreshSaved(); onBack(); }
      catch (error) { setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Unable to cancel this PDF draft.' }); setBusy(null); }
    })() },
  ]);

  const preview = async () => {
    if (!intake || !evidence) return;
    try { await WebBrowser.openBrowserAsync(await transactionEvidencePreviewUrl(intake.id, evidence.id)); }
    catch (error) { setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'The secure preview is not available yet.' }); }
  };

  const retryExtraction = async () => {
    if (!intake || actionGate.current) return;
    actionGate.current = true; setFeedback(null);
    try {
      const queued = await retryTransactionExtraction(intake.id, Crypto.randomUUID());
      setExtraction(queued);
      setFeedback({ tone: 'pending', text: 'Text extraction was queued again. The original evidence remains unchanged.' });
    } catch (error) { setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Unable to retry text extraction.' }); }
    finally { actionGate.current = false; }
  };

  const currentName = selected?.name ?? evidence?.originalFilename;
  const currentBytes = selected?.size ?? evidence?.bytes;
  const currentPages = selected?.evidenceSource === 'pdf' ? selected.pageCount : evidence?.pageCount;
  const selectedImage = selected?.evidenceSource !== 'pdf' ? selected as SelectedTransactionImage : null;
  const extractionFinished = Boolean(extraction && ['completed', 'needs_review', 'failed'].includes(extraction.status));
  const canContinue = Boolean(evidence?.isCurrent && extractionFinished && !busy);
  const percent = progress?.ratio === null || progress?.ratio === undefined ? null : Math.min(100, Math.round(progress.ratio * 100));

  return <><PageHeader title="Upload transaction evidence" subtitle="Add a PDF, screenshot, or receipt photo. CollectBoss extracts review candidates without creating or changing financial records." onBack={onBack} />
    <Card><Text style={styles.sectionTitle}>Add evidence</Text>
      {!currentName ? <><View style={styles.buttonRow}><PrimaryButton label="Upload PDF" disabled={Boolean(busy)} onPress={() => void choosePdf()} /><PrimaryButton label="Choose Screenshot/Image" tone="secondary" disabled={Boolean(busy)} onPress={() => void chooseImage(false)} /><PrimaryButton label="Take Photo" tone="secondary" disabled={Boolean(busy)} onPress={() => void chooseImage(true)} /></View><View style={styles.chips}>{(['screenshot', 'bank_in_receipt'] as const).map((source) => <Pressable key={source} onPress={() => setImageSource(source)} style={[styles.chip, imageSource === source && styles.chipActive]}><Text style={[styles.chipText, imageSource === source && styles.chipTextActive]}>{source === 'screenshot' ? 'Screenshot' : 'Bank-in receipt'}</Text></Pressable>)}</View></> : null}
      <Text style={styles.itemMeta}>PDF: up to {Math.round(MOBILE_PDF_LIMITS.maxBytes / (1024 * 1024))} MB / {MOBILE_PDF_LIMITS.maxPages} pages. Images: PNG, JPEG, or HEIC up to {Math.round(MOBILE_IMAGE_LIMITS.maxBytes / (1024 * 1024))} MB.</Text>
      {selectedImage ? <Image accessibilityLabel="Evidence image preview" source={{ uri: selectedImage.previewUri }} resizeMode="contain" style={styles.intakeImagePreview} /> : null}
      {currentName ? <View style={styles.fileSummary} accessibilityLabel={`Selected evidence ${currentName}`}><View style={styles.rowBetween}><View style={styles.grow}><Text style={styles.itemTitle} numberOfLines={1}>{currentName}</Text><Text style={styles.itemMeta}>{currentBytes ? pdfSize(currentBytes) : 'Size unavailable'}{currentPages ? ` · ${currentPages} page${currentPages === 1 ? '' : 's'}` : selectedImage ? ` · ${selectedImage.width}×${selectedImage.height}` : ''}</Text></View>{evidence ? <Status>{evidence.scanStatus}</Status> : <Status>validated</Status>}</View>{selected ? <Text style={styles.itemMeta}>SHA-256 calculated · {selected.sha256.slice(0, 12)}… · original unchanged</Text> : <Text style={styles.itemMeta}>Version {evidence?.version} · original retained privately{evidence?.hasSafePreview ? ' · separate safe preview' : ''}</Text>}</View> : null}
      {selectedImage ? <><Text style={styles.itemMeta}>Place the full receipt inside the frame. Keep the amount, date, and reference visible. Avoid glare and shadows; use a flat surface and retake blurred photos.</Text><View style={styles.buttonRow}><PrimaryButton label="Rotate" tone="secondary" disabled={Boolean(busy)} onPress={() => void updateImagePreview(((selectedImage.rotationDegrees + 90) % 360) as 0 | 90 | 180 | 270, selectedImage.cropInsetPercent)} /><PrimaryButton label={selectedImage.cropInsetPercent ? 'Undo crop' : 'Crop'} tone="secondary" disabled={Boolean(busy)} onPress={() => void updateImagePreview(selectedImage.rotationDegrees, selectedImage.cropInsetPercent ? 0 : 5)} /><PrimaryButton label="Retake" tone="secondary" disabled={Boolean(busy)} onPress={() => void chooseImage(true)} /><PrimaryButton label="Replace" tone="secondary" disabled={Boolean(busy)} onPress={() => void chooseImage(false)} /></View></> : null}
      {evidence?.qualityWarnings.map((warning) => <Feedback key={warning} tone="pending">Readability warning: {warning.replace(/_/g, ' ')}. Review the preview and retake if needed.</Feedback>)}
      {evidence ? <View style={styles.fileSummary}><View style={styles.rowBetween}><View style={styles.grow}><Text style={styles.itemTitle}>Text extraction</Text><Text style={styles.itemMeta}>{extraction?.extractionMethod === 'pdf_text_layer' ? 'Native PDF text layer' : extraction?.extractionMethod === 'ocr' ? 'OCR from a derived image' : 'Waiting for secure processing'}</Text></View><Status>{extraction?.status ?? evidence.processingStatus}</Status></View>{extraction?.documentKind ? <Text style={styles.itemMeta}>Suggested type: {extraction.documentKind.replace(/_/g, ' ')}{extraction.classificationConfidence !== null ? ` · ${Math.round(extraction.classificationConfidence * 100)}% confidence` : ''}</Text> : null}{extraction?.warnings?.length ? <Text style={styles.itemMeta}>Review flags: {extraction.warnings.map((warning) => warning.replace(/_/g, ' ').toLowerCase()).join(', ')}</Text> : null}{extraction?.candidates?.length ? <View><Text style={styles.itemTitle}>Extracted candidates — review only</Text>{extraction.candidates.slice(0, 12).map((candidate) => <View key={candidate.id} style={styles.fileSummary}><Text style={styles.itemMeta}>{candidate.fieldType.replace(/_/g, ' ')} · {Math.round(candidate.confidence * 100)}% · page {candidate.source.page ?? 'image'}</Text><Text style={styles.itemMeta}>Original: {candidate.originalText}</Text><Text style={styles.itemTitle}>Normalised: {candidateValue(candidate.normalizedValue)}</Text>{candidate.validationFlags.length ? <Text style={styles.itemMeta}>Flags: {candidate.validationFlags.join(', ').replace(/_/g, ' ').toLowerCase()}</Text> : null}</View>)}</View> : null}{extraction?.status === 'failed' ? <PrimaryButton label="Retry extraction" tone="secondary" disabled={Boolean(busy)} onPress={() => void retryExtraction()} /> : null}</View> : null}
      {progress ? <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent ?? undefined }}><View style={styles.progressTrack}><View style={[styles.progressValue, { width: `${percent ?? 35}%` }]} /></View><Text style={styles.itemMeta}>{percent === null ? `Uploading ${progress.sent} bytes…` : `Uploading ${percent}%…`}</Text></View> : null}
      {feedback ? <Feedback tone={feedback.tone}>{feedback.text}</Feedback> : null}
      <View style={styles.buttonRow}>{selected ? <PrimaryButton label={busy === 'uploading' ? 'Uploading…' : feedback?.tone === 'error' ? 'Retry upload' : evidence ? 'Upload replacement' : 'Upload evidence'} disabled={Boolean(busy)} onPress={() => void upload()} /> : null}{currentName ? <PrimaryButton label={selected ? 'Remove selection' : 'Remove evidence'} tone="secondary" disabled={Boolean(busy)} onPress={() => void remove()} /> : null}{evidence && !selected ? <PrimaryButton label="Replace" tone="secondary" disabled={Boolean(busy)} onPress={() => evidence.evidenceSource === 'pdf' ? void choosePdf() : void chooseImage(false)} /> : null}</View>
      <View style={styles.buttonRow}><PrimaryButton label={busy === 'saving' ? 'Saving…' : 'Save Draft'} tone="secondary" disabled={Boolean(busy)} onPress={() => void saveOnly()} /><PrimaryButton label="Continue" disabled={!canContinue} onPress={() => { setReviewOpen(true); setFeedback(null); }} /></View>
      <View style={styles.buttonRow}>{evidence ? <PrimaryButton label="Preview" tone="secondary" disabled={Boolean(busy)} onPress={() => void preview()} /> : null}<PrimaryButton label={busy === 'uploading' ? 'Cancel upload' : 'Cancel draft'} tone="secondary" disabled={busy === 'cancelling'} onPress={cancel} /></View>
    </Card>
    {reviewOpen && intake && evidence && extractionFinished ? <TransactionReview
      intakeId={intake.id}
      online={online}
      onPreview={() => void preview()}
      onRetryExtraction={async () => { await retryExtraction(); }}
      onReady={() => {
        const ready = { ...intake, status: 'ready_to_submit', version: intake.version + 1, updatedAt: new Date().toISOString() };
        intakeRef.current = ready; setIntake(ready); setReviewOpen(false); setRoutingOpen(true);
      }}
    /> : null}
    {routingOpen && intake && evidence ? <TransactionRouting intakeId={intake.id} online={online} onComplete={() => { void refreshSaved(); }} /> : null}
    {!intake && saved.length ? <><Text style={styles.sectionTitle}>Saved evidence drafts</Text>{saved.slice(0, 5).map((draft) => <Pressable key={draft.id} accessibilityRole="button" accessibilityLabel={`Resume evidence draft ${draft.id}`} onPress={() => void openSaved(draft)} style={styles.pressableCard}><View style={styles.rowBetween}><View style={styles.grow}><Text style={styles.itemTitle}>Transaction evidence draft</Text><Text style={styles.itemMeta}>{draft.id} · updated {shortDate(draft.updatedAt)}</Text></View><Status>{draft.status}</Status></View></Pressable>)}</> : null}
    <Text style={styles.disclaimer}>Extraction produces suggestions and confidence for human review only. It does not choose an official amount or verify authenticity. No case or payment has been created.</Text>
  </>;
}

function ActionCentreScreen({ data, onCase, onRefresh }: { data: OwnerData; onCase: (caseId: string) => void; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const approve = async (id: string) => { setBusy(id); setFeedback(null); try { await completeLowRiskAction(id); await onRefresh(); setFeedback('Low-risk action completed.'); } catch (error) { setFeedback(error instanceof Error ? error.message : 'Unable to complete action.'); } finally { setBusy(null); } };
  return <><PageHeader title="Priority review" subtitle="Only low-risk action completion is available on mobile." />{feedback ? <Feedback tone={feedback === 'Low-risk action completed.' ? 'success' : 'error'}>{feedback}</Feedback> : null}{data.actions.map((item) => <Card key={item.id}><View style={styles.rowBetween}><View style={styles.grow}><Text style={styles.itemTitle}>{item.title}</Text><Text style={styles.itemMeta}>{item.description}</Text></View><Status>{item.priority ?? item.status}</Status></View><Text style={styles.itemMeta}>{item.due_at ? `Due ${shortDate(item.due_at)}` : `Added ${shortDate(item.created_at)}`}</Text><View style={styles.buttonRow}>{item.case_id ? <PrimaryButton label="Open case" tone="secondary" onPress={() => onCase(item.case_id!)} /> : null}{canApproveOnMobile(item) ? <PrimaryButton label={busy === item.id ? 'Completing…' : 'Approve / complete'} disabled={busy === item.id} onPress={() => void approve(item.id)} /> : null}</View></Card>)}{!data.actions.length ? <Empty title="All caught up" message="New prioritised work will appear here." /> : null}<Text style={styles.disclaimer}>Settlements, write-offs, legal steps, compliance decisions, and other high-risk actions must use the web approval workflow.</Text></>;
}

function NotificationsScreen({ notifications, onOpen }: { notifications: MobileNotification[]; onOpen: (route: MobileRoute) => void }) {
  const open = async (item: MobileNotification) => {
    try { if (!item.read_at) await markNotificationRead(item.id); } catch { /* Navigation remains useful if read-state update fails. */ }
    onOpen({ screen: item.case_id ? 'cases' : item.action_url?.startsWith('/payments') ? 'payments' : 'action-centre', caseId: item.case_id ?? undefined, actionId: item.entity_id ?? undefined });
  };
  return <><PageHeader title="Notifications" subtitle="Assignments, promises, disputes, payment reviews, and approval requests." />{notifications.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => void open(item)} style={[styles.pressableCard, !item.read_at && styles.unread]}><View style={styles.rowBetween}><Text style={styles.itemTitle}>{item.title}</Text><Status>{item.severity}</Status></View><Text style={styles.itemMeta}>{item.message}</Text><Text style={styles.itemMeta}>{shortDate(item.created_at)} · {item.read_at ? 'Read' : 'Unread'}</Text></Pressable>)}{!notifications.length ? <Empty title="No notifications" message="Actionable updates will appear here." /> : null}</>;
}

function PaymentsScreen({ data, onCase }: { data: OwnerData; onCase: (caseId: string) => void }) {
  const names = new Map(data.cases.map((item) => [item.id, item.debtor_name]));
  return <><PageHeader title="Payment review" subtitle="Live submission and review status. Detailed transaction intake is excluded." />{data.payments.map((item) => <Pressable key={item.id} onPress={() => onCase(item.case_id)} style={styles.pressableCard}><View style={styles.rowBetween}><View style={styles.grow}><Text style={styles.itemTitle}>{names.get(item.case_id) ?? item.case_id}</Text><Text style={styles.itemMeta}>{shortDate(item.created_at)} · {item.payment_method}</Text></View><Status>{item.review_status}</Status></View><Text style={styles.amount}>{money(item.amount)}</Text></Pressable>)}{!data.payments.length ? <Empty title="No payment activity" message="Submitted payment activity will appear here." /> : null}</>;
}

function ReportsScreen({ data }: { data: OwnerData }) {
  const due = data.cases.reduce((sum, item) => sum + cents(item.amount_owed), 0);
  const paid = data.cases.reduce((sum, item) => sum + cents(item.amount_paid), 0);
  return <><PageHeader title="Portfolio pulse" subtitle="A compact live summary for urgent field work." /><View style={styles.metricGrid}><Card style={styles.metric}><Text style={styles.itemMeta}>Total due</Text><Text style={styles.metricValue}>{money(due / 100)}</Text></Card><Card style={styles.metric}><Text style={styles.itemMeta}>Recovered</Text><Text style={styles.metricValue}>{money(paid / 100)}</Text></Card></View><Card><Text style={styles.itemTitle}>Current states</Text><Text style={styles.itemMeta}>{data.cases.length} active records</Text><Text style={styles.itemMeta}>{data.cases.filter((item) => item.days_overdue > 0).length} overdue</Text><Text style={styles.itemMeta}>{data.actions.length} pending actions</Text></Card></>;
}

function DraftCentre({ drafts, online, onChanged, onSubmitted }: { drafts: MobileDraft[]; online: boolean; onChanged: () => Promise<void>; onSubmitted: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const retry = async (draft: MobileDraft) => { if (!online) { setFeedback('Reconnect before retrying. The draft remains saved.'); return; } setBusy(draft.id); setFeedback(null); try { await submitDraft(draft); await onChanged(); await onSubmitted(); setFeedback('Draft submitted successfully.'); } catch (error) { setFeedback(error instanceof Error ? error.message : 'Retry failed.'); await onChanged(); } finally { setBusy(null); } };
  const discard = (draft: MobileDraft) => Alert.alert('Discard draft?', 'This removes the protected draft from this device.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => void removeDraft(draft.id).then(onChanged) }]);
  return <><Text style={styles.sectionTitle}>Pending drafts</Text>{feedback ? <Feedback tone={feedback.includes('successfully') ? 'success' : 'error'}>{feedback}</Feedback> : null}{drafts.map((draft) => <Card key={draft.id}><View style={styles.rowBetween}><View style={styles.grow}><Text style={styles.itemTitle}>{draft.kind.replace(/_/g, ' ')}</Text><Text style={styles.itemMeta}>{draft.caseId} · saved {shortDate(draft.createdAt)}</Text></View><Status>{draft.state}</Status></View>{draft.lastError ? <Feedback tone="error">{draft.lastError}</Feedback> : null}<View style={styles.buttonRow}><PrimaryButton label={busy === draft.id ? 'Retrying…' : 'Retry'} disabled={busy === draft.id || !online} onPress={() => void retry(draft)} /><PrimaryButton label="Discard" tone="secondary" onPress={() => discard(draft)} /></View></Card>)}{!drafts.length ? <Empty title="No pending drafts" message="Offline-safe case updates will appear here until submitted or discarded." /> : null}</>;
}

function MoreScreen({ data, drafts, online, userId, onOpen, onDraftsChanged, onRefresh, onSignOut }: { data: OwnerData; drafts: MobileDraft[]; online: boolean; userId: string; onOpen: (screen: Screen) => void; onDraftsChanged: () => Promise<void>; onRefresh: () => Promise<void>; onSignOut: () => void }) {
  const [pushState, setPushState] = useState<string | null>(null);
  const enablePush = async () => { if (!data.business) return; setPushState('Enabling notifications…'); try { await registerForPushNotifications(data.business.id, userId); setPushState('Push notifications enabled on this device.'); } catch (error) { setPushState(error instanceof Error ? error.message : 'Unable to enable push notifications.'); } };
  return <><PageHeader title="More" subtitle={data.business?.business_name ?? 'CollectBoss account'} /><QuickAction label="Notifications" caption={`${data.notifications.filter((item) => !item.read_at).length} unread`} onPress={() => onOpen('notifications')} /><PrimaryButton label="Enable push notifications" onPress={() => void enablePush()} />{pushState ? <Feedback tone={pushState.includes('enabled') ? 'success' : pushState.includes('Enabling') ? 'pending' : 'error'}>{pushState}</Feedback> : null}<DraftCentre drafts={drafts} online={online} onChanged={onDraftsChanged} onSubmitted={onRefresh} /><PrimaryButton label="Sign out" tone="secondary" onPress={onSignOut} /></>;
}

export function CollectBossApp() {
  const { session, initializing, signOut } = useAuth();
  const network = useNetworkState();
  const online = network.isConnected !== false && network.isInternetReachable !== false;
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [selectedCase, setSelectedCase] = useState<CollectionCase | null>(null);
  const [data, setData] = useState<OwnerData | null>(null);
  const [drafts, setDrafts] = useState<MobileDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRoute, setPendingRoute] = useState<MobileRoute | null>(null);

  const refreshDrafts = useCallback(async () => { if (session?.user.id) setDrafts(await loadDrafts(session.user.id)); else setDrafts([]); }, [session?.user.id]);
  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true); setError(null);
    try { setData(await loadOwnerData()); }
    catch (next) { const message = next instanceof Error ? next.message : 'Could not load live CollectBoss data.'; setError(message); if (isSessionExpiry(message)) void signOut(); }
    finally { setLoading(false); }
  }, [session, signOut]);
  useEffect(() => { void refresh(); void refreshDrafts(); }, [refresh, refreshDrafts]);

  const openCase = useCallback((item: CollectionCase) => { setSelectedCase(item); setScreen('case-detail'); }, []);
  const openCaseId = useCallback((caseId: string) => {
    const found = data?.cases.find((item) => item.id === caseId);
    if (found) openCase(found); else { setError('That notification record is not available in your authorised business.'); setScreen('cases'); }
  }, [data?.cases, openCase]);
  const openRoute = useCallback((route: MobileRoute) => {
    if (route.caseId && !data) { setPendingRoute(route); return; }
    if (route.caseId) openCaseId(route.caseId); else setScreen(route.screen);
  }, [data, openCaseId]);
  useEffect(() => {
    if (data && pendingRoute) { setPendingRoute(null); openRoute(pendingRoute); }
  }, [data, openRoute, pendingRoute]);
  useEffect(() => subscribeToNotificationRoutes(openRoute), [openRoute]);

  if (initializing) return <SafeAreaView style={styles.loadingScreen}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.itemMeta}>Recovering secure session…</Text></SafeAreaView>;
  if (!session) return <SignInScreen />;
  const current = data ?? emptyData;
  const render = () => {
    if (loading && !data) return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.itemMeta}>Loading authorised business data…</Text></View>;
    if (error && !data) return <View style={styles.center}><Feedback tone="error">{error}</Feedback><PrimaryButton label="Retry" onPress={() => void refresh()} /></View>;
    if (screen === 'transaction-intake') return <TransactionIntakeScreen online={online} onBack={() => setScreen('cases')} />;
    if (screen === 'case-detail' && selectedCase) return <CaseDetail item={selectedCase} userId={session.user.id} online={online} permissions={current.permissions} drafts={drafts} onBack={() => setScreen('cases')} onRefreshDrafts={refreshDrafts} onSubmitted={refresh} />;
    if (screen === 'cases') return <CasesScreen data={current} onOpen={openCase} onTransactionIntake={() => setScreen('transaction-intake')} />;
    if (screen === 'payments') return <PaymentsScreen data={current} onCase={openCaseId} />;
    if (screen === 'action-centre') return <ActionCentreScreen data={current} onCase={openCaseId} onRefresh={refresh} />;
    if (screen === 'notifications') return <NotificationsScreen notifications={current.notifications} onOpen={openRoute} />;
    if (screen === 'reports') return <ReportsScreen data={current} />;
    if (screen === 'more') return <MoreScreen data={current} drafts={drafts} online={online} userId={session.user.id} onOpen={setScreen} onDraftsChanged={refreshDrafts} onRefresh={refresh} onSignOut={() => Alert.alert('Sign out?', 'Protected drafts remain tied to this user on this device.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => void signOut() }])} />;
    return <Dashboard data={current} drafts={drafts} onOpen={setScreen} onCase={openCase} />;
  };
  const visiblePrimary = primaryNavigation.filter((item) => navigationItemIsVisible(item, current.permissions));
  const mobileTabs = [
    ...visiblePrimary.filter((item) => ['dashboard', 'cases', 'payments', 'reports'].includes(item.id)).map((item) => ({ id: item.id as Screen, label: item.id === 'dashboard' ? 'Home' : item.label })),
    { id: 'more' as Screen, label: 'More' },
  ];
  return <SafeAreaView style={styles.app} edges={['bottom']}><View style={styles.utilityHeader}><Brand /><Pressable accessibilityRole="button" onPress={() => setScreen('notifications')}><Text style={styles.link}>Alerts{current.notifications.filter((item) => !item.read_at).length ? ` (${current.notifications.filter((item) => !item.read_at).length})` : ''}</Text></Pressable></View>{!online ? <View style={styles.offlineBanner}><Text style={styles.offlineText}>Offline · server PDF uploads require a connection</Text></View> : null}<ScreenShell refreshing={loading} onRefresh={() => void refresh()}>{error && data ? <Feedback tone="error">{error}</Feedback> : null}{render()}</ScreenShell><View accessibilityRole="tablist" style={styles.tabBar}>{mobileTabs.map((item) => <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: screen === item.id }} onPress={() => setScreen(item.id)} style={styles.tab}><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={[styles.tabText, screen === item.id && styles.tabTextActive]}>{item.label}</Text></Pressable>)}</View></SafeAreaView>;
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.canvas }, safe: { flex: 1, backgroundColor: colors.canvas },
  content: { width: '100%', maxWidth: 900, alignSelf: 'center', padding: 18, paddingBottom: 30, gap: 12 },
  utilityHeader: { minHeight: 56, paddingHorizontal: 18, paddingTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pageHeader: { gap: 5, paddingVertical: 4 }, backButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }, pageTitle: { color: colors.navy, fontSize: 28, lineHeight: 34, fontWeight: '700' }, pageSub: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  card: { padding: 16, gap: 10, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.card }, pressableCard: { minHeight: 80, padding: 16, gap: 10, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.card }, unread: { borderLeftWidth: 4, borderLeftColor: colors.primary },
  hero: { backgroundColor: colors.navy, borderColor: colors.navy }, heroLabel: { color: colors.inverseMuted, fontWeight: '600' }, heroValue: { color: colors.inverse, fontSize: 31, fontWeight: '700' }, heroCopy: { color: colors.inverseMuted },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, quickAction: { flexGrow: 1, flexBasis: 150, minHeight: 82, justifyContent: 'center', gap: 5, padding: 14, borderRadius: 14, backgroundColor: colors.selectedSurface },
  sectionTitle: { color: colors.navy, fontSize: 18, fontWeight: '700', marginTop: 5 }, itemTitle: { color: colors.text, fontSize: 16, fontWeight: '600' }, itemMeta: { color: colors.muted, fontSize: 13, lineHeight: 19 }, amount: { color: colors.navy, fontSize: 16, fontWeight: '700' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, grow: { flex: 1, minWidth: 0 },
  status: { maxWidth: 120, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, fontSize: 11, fontWeight: '700', textTransform: 'capitalize' }, statusGood: { color: colors.green, backgroundColor: colors.successSurface }, statusRisk: { color: colors.red, backgroundColor: colors.dangerSurface }, statusWarn: { color: colors.amber, backgroundColor: colors.warningSurface }, statusNeutral: { color: CollectBossTokens.color.closed, backgroundColor: colors.neutralSurface },
  inputLabel: { color: colors.text, fontSize: 13, fontWeight: '600', marginTop: 3 }, input: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.text, paddingHorizontal: 13, fontSize: 16 }, textArea: { minHeight: 96, paddingTop: 12, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }, chipActive: { borderColor: colors.primary, backgroundColor: colors.primary }, chipText: { color: colors.text, fontSize: 13, fontWeight: '600', textTransform: 'capitalize' }, chipTextActive: { color: colors.inverse },
  primaryButton: { flexGrow: 1, minHeight: 50, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.primary }, primaryButtonPressed: { backgroundColor: CollectBossTokens.color.primaryPressed }, primaryButtonText: { color: colors.inverse, fontSize: 15, fontWeight: '700' }, secondaryButton: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary }, secondaryButtonPressed: { backgroundColor: colors.selectedSurface }, secondaryButtonText: { color: colors.primary }, disabled: { borderColor: colors.disabledBorder, backgroundColor: colors.disabledSurface, opacity: 1 }, disabledText: { color: CollectBossTokens.color.disabledText }, buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  feedback: { padding: 12, borderRadius: 12, borderWidth: 1 }, feedbackGood: { backgroundColor: colors.successSurface, borderColor: colors.successBorder }, feedbackPending: { backgroundColor: colors.warningSurface, borderColor: colors.warningBorder }, feedbackError: { backgroundColor: colors.dangerSurface, borderColor: colors.dangerBorder }, feedbackText: { color: colors.text, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  fileSummary: { gap: 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.canvas }, progressTrack: { height: 8, overflow: 'hidden', borderRadius: 999, backgroundColor: colors.border }, progressValue: { height: 8, borderRadius: 999, backgroundColor: colors.primary },
  intakeImagePreview: { width: '100%', minHeight: 220, maxHeight: 420, borderRadius: 12, backgroundColor: colors.neutralSurface },
  empty: { alignItems: 'center', paddingVertical: 28 }, emptyTitle: { color: colors.navy, fontSize: 17, fontWeight: '700' }, emptyCopy: { color: colors.muted, textAlign: 'center', lineHeight: 20 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, metric: { flexGrow: 1, flexBasis: 145 }, metricValue: { color: colors.navy, fontSize: 21, fontWeight: '700' },
  disclaimer: { color: colors.muted, fontSize: 12, lineHeight: 18 }, link: { color: colors.primary, fontSize: 14, fontWeight: '700' }, offlineBanner: { paddingHorizontal: 18, paddingVertical: 8, backgroundColor: colors.warningSurface }, offlineText: { color: colors.amber, fontSize: 12, textAlign: 'center', fontWeight: '600' },
  tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.card, paddingTop: 7, paddingBottom: 10 }, tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 }, tabText: { color: colors.muted, fontSize: 11, fontWeight: '600' }, tabTextActive: { color: colors.primary, fontWeight: '700' },
  loadingScreen: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, backgroundColor: colors.canvas }, center: { flex: 1, minHeight: 420, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 28 }, loginTop: { gap: 12, paddingTop: 30, paddingBottom: 12 }, loginTitle: { color: colors.navy, fontSize: 30, lineHeight: 37, fontWeight: '700' },
});
