import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { CollectBossTokens } from '@/constants/theme';
import {
  getTransactionReview, getTransactionWorkflow, saveTransactionWorkflow, submitTransactionWorkflow,
  type TransactionNature, type TransactionWorkflow, type TransactionWorkflowData,
} from '@/lib/transaction-intake';

const colors = { navy: CollectBossTokens.color.navy, blue: CollectBossTokens.color.primary, text: CollectBossTokens.color.foreground, muted: CollectBossTokens.color.mutedForeground, border: CollectBossTokens.color.border, surface: CollectBossTokens.color.surface, inverse: CollectBossTokens.color.inverseForeground, inverseMuted: CollectBossTokens.color.inverseMutedForeground };
const routes: [TransactionNature, string, string][] = [
  ['loan_disbursement', 'Create Draft Record', 'Create or link the borrower and obligation. No overdue case is created by default.'],
  ['repayment', 'Record Payment', 'Link a pending payment to the existing obligation and case.'],
  ['partial_repayment', 'Record Partial Payment', 'Use the payment ledger; never overwrite the case balance.'],
  ['refund', 'Record Refund', 'Reverse the selected approved payment and preserve its link.'],
  ['deposit_or_other', 'Save Review Record', 'Keep evidence review-required until its relationship is known.'],
  ['collection_case', 'Create Collection Case', 'Requires an overdue outstanding obligation and explicit confirmation.'],
];
type Sheet = 'nature' | 'profile' | 'duplicates' | null;

function Button({ label, onPress, secondary, disabled }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }} onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary, pressed && styles.buttonPressed, disabled && styles.disabled]}><Text style={[styles.buttonText, secondary && styles.buttonSecondaryText, disabled && styles.disabledText]}>{label}</Text></Pressable>;
}
function Choice({ selected, title, detail, onPress }: { selected: boolean; title: string; detail?: string; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}><Text style={styles.choiceTitle}>{title}</Text>{detail ? <Text style={styles.muted}>{detail}</Text> : null}</Pressable>;
}
function labelOf(nature?: TransactionNature | null) { return routes.find(([value]) => value === nature)?.[1] ?? 'Choose transaction nature'; }

export function TransactionRouting({ intakeId, online, onComplete }: { intakeId: string; online: boolean; onComplete: () => void }) {
  const [loaded, setLoaded] = useState<TransactionWorkflow | null>(null);
  const [draft, setDraft] = useState<TransactionWorkflowData | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [newName, setNewName] = useState(''); const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState(''); const [newRegistration, setNewRegistration] = useState('');

  const load = async () => {
    setBusy(true); setMessage(null);
    try {
      const [workflow, review] = await Promise.all([getTransactionWorkflow(intakeId), getTransactionReview(intakeId)]);
      setLoaded(workflow);
      if (workflow.workflow) setDraft({ ...workflow.workflow.data, expectedVersion: workflow.workflow.version });
      else {
        const value = review.latestReview as Record<string, unknown> | null;
        const reviewNature = String(value?.transactionNature ?? '');
        setDraft({ step: 'transaction_nature', expectedVersion: 1,
          transactionNature: ['loan_disbursement', 'repayment', 'partial_repayment', 'refund'].includes(reviewNature) ? reviewNature as TransactionNature : reviewNature ? 'deposit_or_other' : null,
          amountMinor: typeof value?.amountMinor === 'number' ? value.amountMinor : Number(value?.amountMinor ?? 0) || null,
          currency: typeof value?.currency === 'string' ? value.currency : review.business.defaultCurrency,
          transactionDate: typeof value?.transactionDatetime === 'string' ? value.transactionDatetime.slice(0, 10) : null,
          reference: typeof value?.reference === 'string' ? value.reference : null, bank: typeof value?.bank === 'string' ? value.bank : null,
          sender: typeof value?.sender === 'string' ? value.sender : null, recipient: typeof value?.recipient === 'string' ? value.recipient : null,
          profileDecision: null, createCollectionCase: false, paymentMethod: 'bank_transfer', duplicateReview: null,
        });
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to load profile matching.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, [intakeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (step: TransactionWorkflowData['step'], patch: Partial<TransactionWorkflowData> = {}) => {
    if (!draft || !online) { setMessage('Reconnect before saving this secure draft.'); return null; }
    setBusy(true); setMessage(null);
    try {
      const next = { ...draft, ...patch, step };
      const result = await saveTransactionWorkflow(intakeId, next, Crypto.randomUUID());
      const saved = { ...result.workflow.data, expectedVersion: result.workflow.version };
      setDraft(saved); setMessage('Draft saved. You can resume it after signing in again.');
      const refreshed = await getTransactionWorkflow(intakeId); setLoaded(refreshed);
      return saved;
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save this workflow.'); return null; }
    finally { setBusy(false); }
  };

  const createNew = async () => {
    if (!newName.trim()) { setMessage('Enter the customer or borrower name.'); return; }
    const next = await save('profile_match', { profileDecision: { kind: 'new', profile: { debtorType: newRegistration ? 'business' : 'individual', name: newName.trim(), email: newEmail.trim() || null, phone: newPhone.trim() || null, registrationNo: newRegistration.trim() || null } } });
    if (next) setSheet(null);
  };
  const selectExisting = async (customerId: string) => { const next = await save('profile_match', { profileDecision: { kind: 'existing', customerId } }); if (next) setSheet(null); };
  const acknowledgeDuplicates = async () => {
    if (!loaded) return;
    const next = await save('duplicate_review', { duplicateReview: { acknowledged: true, candidateKeys: loaded.duplicateMatches.map((item) => item.candidateKey), decision: 'continue_separate' } });
    if (next) setSheet(null);
  };
  const submit = async () => {
    if (!draft || !online) return;
    setBusy(true); setMessage(null);
    try {
      await saveTransactionWorkflow(intakeId, { ...draft, step: 'review_create' }, Crypto.randomUUID());
      const result = await submitTransactionWorkflow(intakeId, Crypto.randomUUID());
      setLoaded((current) => current ? { ...current, outcome: result.outcome } : current); setDraft({ ...draft, step: 'success' }); onComplete();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to create the confirmed records.'); }
    finally { setBusy(false); }
  };

  if (!draft) return <View style={styles.card}><Text style={styles.muted}>{busy ? 'Loading final workflowâ€¦' : message ?? 'Workflow unavailable.'}</Text></View>;
  if (draft.step === 'success' || loaded?.outcome) {
    const outcome = loaded?.outcome;
    return <View style={styles.success}><Text style={styles.successTitle}>Created successfully</Text><Text style={styles.successText}>{outcome ? labelOf(outcome.route) : labelOf(draft.transactionNature)}</Text>
      {outcome?.customer_id ? <Text style={styles.successText}>Profile: {outcome.customer_id}</Text> : null}
      {outcome?.obligation_id ? <Text style={styles.successText}>Obligation: {outcome.obligation_id}</Text> : null}
      {outcome?.payment_id ? <Text style={styles.successText}>Payment: {outcome.payment_id}</Text> : null}
      {outcome?.case_id ? <Text style={styles.successText}>Case: {outcome.case_id}</Text> : null}
      <Text style={styles.muted}>The original evidence and confirmed extraction history remain linked.</Text></View>;
  }

  const records = loaded?.relatedRecords;
  const needObligation = draft.transactionNature === 'repayment' || draft.transactionNature === 'partial_repayment';
  const needRefund = draft.transactionNature === 'refund';
  const needDue = draft.transactionNature === 'loan_disbursement' || draft.transactionNature === 'collection_case';
  const hasExactDuplicate = loaded?.duplicateMatches.some((match) => match.confidence === 'exact') ?? false;
  const primary = labelOf(draft.transactionNature);
  return <View style={styles.stack}>
    <View style={styles.card}><Text style={styles.eyebrow}>1 Â· AI result confirmed</Text><Text style={styles.amount}>{draft.currency} {((draft.amountMinor ?? 0) / 100).toFixed(2)}</Text><Text style={styles.muted}>{draft.transactionDate ?? 'Date missing'} Â· {draft.reference ?? 'Reference missing'}</Text><Text style={styles.muted}>{draft.sender ?? 'Sender unknown'} â†’ {draft.recipient ?? 'Recipient unknown'}</Text><Button label="Save Draft" secondary disabled={busy} onPress={() => void save('ai_result')} /></View>
    <View style={styles.card}><Text style={styles.eyebrow}>2 Â· Transaction nature</Text><Text style={styles.title}>{labelOf(draft.transactionNature)}</Text><Button label="Choose transaction nature" secondary onPress={() => setSheet('nature')} /><Button label="Save Draft" secondary disabled={busy} onPress={() => void save('transaction_nature')} /></View>
    <View style={styles.card}><Text style={styles.eyebrow}>3 Â· Possible debtor match</Text><Text style={styles.title}>{draft.profileDecision?.kind === 'existing' ? 'Use Existing Profile' : draft.profileDecision?.kind === 'new' ? `Create ${draft.profileDecision.profile.name}` : 'Choice required'}</Text>{loaded?.profileMatches.slice(0, 3).map((match) => <Text key={match.customerId} style={styles.muted}>{Math.round(match.confidence * 100)}% Â· {match.reasons.join(', ')}</Text>)}<Button label="Choose profile" secondary onPress={() => setSheet('profile')} /><Button label="Save Draft" secondary disabled={busy} onPress={() => void save('profile_match')} /></View>
    <View style={styles.card}><Text style={styles.eyebrow}>4 Â· Required details</Text>
      {needDue ? <><Text style={styles.label}>Due date</Text><TextInput accessibilityLabel="Obligation due date" value={draft.dueDate ?? ''} onChangeText={(dueDate) => setDraft({ ...draft, dueDate })} placeholder="YYYY-MM-DD" style={styles.input} /><Text style={styles.label}>Reference</Text><TextInput accessibilityLabel="Obligation reference" value={draft.reference ?? ''} onChangeText={(reference) => setDraft({ ...draft, reference })} style={styles.input} /></> : null}
      {records?.accounts.map((item) => <Choice key={item.id} selected={draft.accountId === item.id} title={item.display_name} detail={`${item.currency} account`} onPress={() => setDraft({ ...draft, accountId: item.id })} />)}
      {needObligation ? records?.obligations.map((item) => <Choice key={item.id} selected={draft.obligationId === item.id} title={item.reference} detail={`${item.currency} ${(item.outstanding_minor / 100).toFixed(2)} outstanding`} onPress={() => setDraft({ ...draft, obligationId: item.id })} />) : null}
      {needObligation ? records?.cases.map((item) => <Choice key={item.id} selected={draft.caseId === item.id} title={item.id} detail={item.invoice_no ?? 'Collection case'} onPress={() => setDraft({ ...draft, caseId: item.id })} />) : null}
      {needRefund ? records?.payments.filter((item) => item.review_status === 'approved').map((item) => <Choice key={item.id} selected={draft.originalPaymentId === item.id} title={`${item.currency} ${(item.amount_minor / 100).toFixed(2)}`} detail={item.reference_no ?? item.case_id} onPress={() => setDraft({ ...draft, originalPaymentId: item.id })} />) : null}
      {draft.transactionNature === 'collection_case' ? <Choice selected={draft.createCollectionCase} title="I confirm this overdue obligation should become a collection case" onPress={() => setDraft({ ...draft, createCollectionCase: !draft.createCollectionCase })} /> : null}
      <Button label="Save Draft" secondary disabled={busy} onPress={() => void save('required_details')} />
    </View>
    {loaded?.duplicateMatches.length ? <View style={styles.warning}><Text style={styles.title}>5 Â· {hasExactDuplicate ? 'Exact duplicate blocked' : 'Duplicate review required'}</Text><Text style={styles.muted}>{hasExactDuplicate ? 'This evidence exactly matches an existing transaction and cannot be posted again.' : `${loaded.duplicateMatches.length} possible duplicate${loaded.duplicateMatches.length === 1 ? '' : 's'} found. Nothing will be merged or deleted.`}</Text><Button label="Review duplicates" onPress={() => setSheet('duplicates')} /></View> : null}
    <View style={styles.card}><Text style={styles.eyebrow}>6 Â· Review & create</Text><Text style={styles.title}>{primary}</Text><Text style={styles.muted}>Borrower/profile confirmed Â· {draft.currency} {((draft.amountMinor ?? 0) / 100).toFixed(2)} Â· evidence linked{draft.dueDate ? ` Â· due ${draft.dueDate}` : ''}</Text>{message ? <Text accessibilityRole="alert" style={styles.error}>{message}</Text> : null}<Button label="Save Draft" secondary disabled={busy} onPress={() => void save('review_create')} /><Button label={busy ? 'Workingâ€¦' : primary} disabled={busy || !online || hasExactDuplicate || !draft.transactionNature || !draft.profileDecision || Boolean(loaded?.duplicateMatches.length && !draft.duplicateReview?.acknowledged)} onPress={() => void submit()} /></View>

    <Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={() => setSheet(null)}><View style={styles.backdrop}><View style={styles.sheet}><View style={styles.row}><Text style={styles.title}>{sheet === 'nature' ? 'Transaction nature' : sheet === 'profile' ? 'Possible Debtor Match' : 'Duplicate Review'}</Text><Pressable onPress={() => setSheet(null)}><Text style={styles.link}>Close</Text></Pressable></View><ScrollView keyboardShouldPersistTaps="handled">
      {sheet === 'nature' ? routes.map(([value, title, detail]) => <Choice key={value} selected={draft.transactionNature === value} title={title} detail={detail} onPress={() => { setDraft({ ...draft, transactionNature: value }); setSheet(null); }} />) : null}
      {sheet === 'profile' ? <View style={styles.stack}>{loaded?.profileMatches.map((match) => <Choice key={match.customerId} selected={draft.profileDecision?.kind === 'existing' && draft.profileDecision.customerId === match.customerId} title={`Use Existing Profile Â· ${Math.round(match.confidence * 100)}%`} detail={match.reasons.join(', ')} onPress={() => void selectExisting(match.customerId)} />)}<Text style={styles.label}>Or create a new profile explicitly</Text><TextInput value={newName} onChangeText={setNewName} placeholder="Customer or borrower name" style={styles.input} /><TextInput value={newRegistration} onChangeText={setNewRegistration} placeholder="Registration number (optional)" style={styles.input} /><TextInput value={newEmail} onChangeText={setNewEmail} placeholder="Email (optional)" autoCapitalize="none" style={styles.input} /><TextInput value={newPhone} onChangeText={setNewPhone} placeholder="Phone (optional)" style={styles.input} /><Button label="Create New Profile" disabled={busy} onPress={() => void createNew()} /></View> : null}
      {sheet === 'duplicates' ? <View style={styles.stack}>{loaded?.duplicateMatches.map((match) => <View key={match.candidateKey} style={styles.choice}><Text style={styles.choiceTitle}>{match.confidence} match Â· {match.candidateKey}</Text><Text style={styles.muted}>{match.reasons.join(', ')}</Text></View>)}<Text style={styles.muted}>{hasExactDuplicate ? 'Exact matches are blocked from posting. Replace the evidence or investigate the existing transaction.' : 'Review only: CollectBoss will not merge, delete, approve, or post these records automatically.'}</Text>{hasExactDuplicate ? null : <Button label="Continue as separate record" onPress={() => void acknowledgeDuplicates()} />}</View> : null}
    </ScrollView></View></View></Modal>
  </View>;
}

const styles = StyleSheet.create({
  stack: { gap: 12 }, card: { padding: 16, gap: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface },
  eyebrow: { color: colors.blue, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }, title: { color: colors.navy, fontSize: 18, fontWeight: '700' }, amount: { color: colors.navy, fontSize: 28, fontWeight: '700' }, muted: { color: colors.muted, fontSize: 13, lineHeight: 19 }, label: { color: colors.text, fontSize: 13, fontWeight: '600' },
  input: { minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, color: colors.text, backgroundColor: colors.surface },
  button: { minHeight: 50, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.blue }, buttonPressed: { backgroundColor: CollectBossTokens.color.primaryPressed }, buttonSecondary: { borderWidth: 1, borderColor: colors.blue, backgroundColor: colors.surface }, buttonText: { color: colors.inverse, fontWeight: '700' }, buttonSecondaryText: { color: colors.blue }, disabled: { borderColor: CollectBossTokens.color.disabledBorder, backgroundColor: CollectBossTokens.color.disabledSurface, opacity: 1 }, disabledText: { color: CollectBossTokens.color.disabledText },
  choice: { padding: 13, gap: 4, marginBottom: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 13, backgroundColor: colors.surface }, choiceSelected: { borderColor: colors.blue, borderWidth: 2, backgroundColor: CollectBossTokens.color.selectedSurface }, choiceTitle: { color: colors.navy, fontWeight: '700' },
  warning: { padding: 16, gap: 10, borderWidth: 1, borderColor: CollectBossTokens.color.warningBorder, borderRadius: 16, backgroundColor: CollectBossTokens.color.warningSurface }, error: { color: CollectBossTokens.color.failed, fontWeight: '600' },
  success: { padding: 20, gap: 8, borderRadius: 18, backgroundColor: colors.navy }, successTitle: { color: colors.inverse, fontSize: 24, fontWeight: '700' }, successText: { color: colors.inverseMuted, fontWeight: '600' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: CollectBossTokens.color.surfaceOverlay }, sheet: { maxHeight: '84%', padding: 18, paddingBottom: 30, gap: 12, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: colors.surface }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, link: { color: colors.blue, fontWeight: '700', padding: 8 },
});
