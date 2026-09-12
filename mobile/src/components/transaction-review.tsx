import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { CollectBossTokens } from '@/constants/theme';
import {
  getTransactionReview, saveTransactionReview, type ReviewTextCandidate, type TransactionReviewData,
  type TransactionReviewInput,
} from '@/lib/transaction-intake';

const colors = {
  navy: CollectBossTokens.color.navy, blue: CollectBossTokens.color.primary,
  card: CollectBossTokens.color.surface, text: CollectBossTokens.color.foreground,
  muted: CollectBossTokens.color.mutedForeground, border: CollectBossTokens.color.border,
  amber: CollectBossTokens.color.warning, red: CollectBossTokens.color.failed,
  inverse: CollectBossTokens.color.inverseForeground, inverseMuted: CollectBossTokens.color.inverseMutedForeground,
  selectedSurface: CollectBossTokens.color.selectedSurface,
};

const kinds = [
  'online_bank_transfer_receipt', 'transaction_screenshot', 'bank_in_cash_deposit_receipt',
  'payment_receipt', 'bank_statement', 'invoice', 'credit_note', 'receipt', 'contract', 'other',
] as const;
const natures = [
  ['loan_disbursement', 'Loan disbursement', 'Money was lent or advanced.'],
  ['repayment', 'Repayment', 'Full repayment was received.'],
  ['partial_repayment', 'Partial repayment', 'Part of the outstanding amount was received.'],
  ['refund', 'Refund', 'Money was returned.'],
  ['deposit', 'Deposit', 'Cash or cheque was deposited; relationship is not yet determined.'],
  ['fee_adjustment', 'Fee or adjustment', 'A non-principal financial movement.'],
  ['other', 'Other', 'Describe the transaction meaning in a note.'],
] as const;
type Nature = (typeof natures)[number][0];

function Button({ label, onPress, secondary, disabled }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary, pressed && styles.buttonPressed, disabled && styles.disabled]}><Text style={[styles.buttonText, secondary && styles.buttonSecondaryText, disabled && styles.disabledText]}>{label}</Text></Pressable>;
}

function Choice({ selected, label, onPress, accessibilityLabel }: { selected: boolean; label: string; onPress: () => void; accessibilityLabel?: string }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}><Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text></Pressable>;
}

function Citation({ candidate }: { candidate: { confidence: number; evidence: { page: number | null; snippet: string; boundingBox?: { x: number; y: number; width: number; height: number } } } }) {
  const box = candidate.evidence.boundingBox;
  return <View style={styles.citation} accessibilityLabel={`Evidence citation${candidate.evidence.page ? ` page ${candidate.evidence.page}` : ''}`}><Text style={styles.citationLabel}>Evidence {candidate.evidence.page ? `· page ${candidate.evidence.page}` : '· image'} · {Math.round(candidate.confidence * 100)}%</Text><Text style={styles.citationText} numberOfLines={3}>{candidate.evidence.snippet}</Text>{box ? <Text style={styles.citationMeta}>Box {Math.round(box.x)}, {Math.round(box.y)}, {Math.round(box.width)} × {Math.round(box.height)}</Text> : null}</View>;
}

function candidateChoice(candidate: ReviewTextCandidate | undefined) {
  return candidate ? { mode: 'candidate' as const, candidateId: candidate.candidateId } : null;
}

function parseMinor(value: string) {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/u.exec(value.trim());
  if (!match) return undefined;
  const minor = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0');
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : undefined;
}

function candidateDateInterpretation(value: string | undefined) {
  if (!value) return '';
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value.trim()) ? value.trim() : '';
}

function minorToInput(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return '';
  const minor = BigInt(value); const whole = minor / 100n; const fraction = (minor % 100n).toString().padStart(2, '0');
  return `${whole}.${fraction}`;
}

function reviewCorrections(row: Record<string, unknown>) {
  const decisions = row.fieldDecisions && typeof row.fieldDecisions === 'object' ? row.fieldDecisions as Record<string, unknown> : {};
  return Object.entries(decisions).flatMap(([field, raw]) => {
    if (!raw || typeof raw !== 'object') return [];
    const decision = raw as Record<string, unknown>;
    const original = decision.original_value;
    const confirmed = decision.confirmed_value;
    if (original === null || original === undefined || String(original) === String(confirmed)) return [];
    return [`${field.replace(/_/g, ' ')}: ${String(original)} → ${String(confirmed)}${decision.reason ? ` (${String(decision.reason)})` : ''}`];
  });
}

export function TransactionReview({ intakeId, online, onPreview, onRetryExtraction, onReady }: {
  intakeId: string; online: boolean; onPreview: () => void; onRetryExtraction: () => Promise<void>; onReady: () => void;
}) {
  const [data, setData] = useState<TransactionReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'confirm' | 'retry' | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'success' | 'pending'; text: string } | null>(null);
  const [editAll, setEditAll] = useState(false);
  const [natureOpen, setNatureOpen] = useState(false);
  const [documentKind, setDocumentKind] = useState('');
  const [documentKindReason, setDocumentKindReason] = useState('');
  const [movement, setMovement] = useState<boolean | null>(null);
  const [amountCandidateId, setAmountCandidateId] = useState('');
  const [manualAmount, setManualAmount] = useState('');
  const [manualAmountReason, setManualAmountReason] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [currency, setCurrency] = useState('');
  const [currencyConfirmed, setCurrencyConfirmed] = useState(false);
  const [dateCandidateId, setDateCandidateId] = useState('');
  const [interpretedDateTime, setInterpretedDateTime] = useState('');
  const [dateConfirmed, setDateConfirmed] = useState(false);
  const [reference, setReference] = useState('');
  const [bank, setBank] = useState('');
  const [sender, setSender] = useState('');
  const [recipient, setRecipient] = useState('');
  const [fieldCorrectionReason, setFieldCorrectionReason] = useState('');
  const [status, setStatus] = useState<TransactionReviewInput['transactionStatus']>(null);
  const [nature, setNature] = useState<Nature | null>(null);
  const [natureNote, setNatureNote] = useState('');
  const [notes, setNotes] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const next = await getTransactionReview(intakeId);
      setData(next);
      const saved = next.latestReview;
      setDocumentKind((current) => current || (typeof saved?.documentKind === 'string' ? saved.documentKind : next.workspace.proposedDocumentKind) || '');
      setDocumentKindReason((current) => current || (typeof (saved?.fieldDecisions as Record<string, unknown> | undefined)?.document_kind === 'object' ? String(((saved?.fieldDecisions as Record<string, Record<string, unknown>>).document_kind.reason) ?? '') : ''));
      if (typeof saved?.representsFinancialMovement === 'boolean') setMovement((current) => current ?? saved.representsFinancialMovement as boolean);
      setAmountCandidateId((current) => current || (typeof saved?.chosenAmountCandidateId === 'string' ? saved.chosenAmountCandidateId : ''));
      if (!saved?.chosenAmountCandidateId && saved?.amountMinor !== null && saved?.amountMinor !== undefined) { setManualMode(true); setManualAmount((current) => current || minorToInput(saved.amountMinor)); }
      setManualAmountReason((current) => current || (typeof saved?.manualAmountReason === 'string' ? saved.manualAmountReason : ''));
      setCurrency((current) => current || (typeof saved?.currency === 'string' ? saved.currency : ''));
      if (saved?.currencyConfirmed === true) setCurrencyConfirmed(true);
      const firstDate = next.workspace.dateCandidates[0];
      const savedDecisions = saved?.fieldDecisions && typeof saved.fieldDecisions === 'object' ? saved.fieldDecisions as Record<string, Record<string, unknown>> : {};
      setDateCandidateId((current) => current || (typeof savedDecisions.date?.candidate_id === 'string' ? savedDecisions.date.candidate_id : firstDate?.candidateId) || '');
      setInterpretedDateTime((current) => current || (typeof saved?.transactionDatetime === 'string' ? saved.transactionDatetime : candidateDateInterpretation(firstDate?.value)));
      if (saved?.dateInterpretationConfirmed === true) setDateConfirmed(true);
      setReference((current) => current || (typeof saved?.reference === 'string' ? saved.reference : next.workspace.referenceCandidates[0]?.value) || '');
      setBank((current) => current || (typeof saved?.bank === 'string' ? saved.bank : next.workspace.bankCandidates[0]?.value) || '');
      setSender((current) => current || (typeof saved?.sender === 'string' ? saved.sender : next.workspace.senderCandidates[0]?.value) || '');
      setRecipient((current) => current || (typeof saved?.recipient === 'string' ? saved.recipient : next.workspace.recipientCandidates[0]?.value) || '');
      const savedCorrection = Object.values(savedDecisions).find((decision) => decision && typeof decision === 'object' && decision.source === 'manual' && typeof decision.reason === 'string');
      const savedCorrectionReason = savedCorrection && typeof savedCorrection.reason === 'string' ? savedCorrection.reason : '';
      if (savedCorrectionReason) setFieldCorrectionReason((current) => current || savedCorrectionReason);
      setStatus((current) => current || (typeof saved?.transactionStatus === 'string' ? saved.transactionStatus as TransactionReviewInput['transactionStatus'] : next.workspace.statusCandidates[0]?.value.toLowerCase() === 'completed' || next.workspace.statusCandidates[0]?.value.toLowerCase() === 'approved' ? 'successful' : null));
      setNature((current) => current || (typeof saved?.transactionNature === 'string' ? saved.transactionNature as Nature : null));
      setNatureNote((current) => current || (typeof saved?.transactionNatureNote === 'string' ? saved.transactionNatureNote : ''));
      setNotes((current) => current || (typeof saved?.notes === 'string' ? saved.notes : ''));
    } catch (error) { setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Unable to load the review workspace.' }); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [intakeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const workspace = data?.workspace;
  const selectedAmount = workspace?.amountCandidates.find((candidate) => candidate.candidateId === amountCandidateId);
  const suggestedAmount = selectedAmount ?? workspace?.amountCandidates.find((candidate) => candidate.recommended);
  const selectedDate = workspace?.dateCandidates.find((candidate) => candidate.candidateId === dateCandidateId);
  const reviewTasks = useMemo(() => {
    const tasks: string[] = [];
    if (!documentKind || workspace?.requiresDocumentKindReview) tasks.push('Confirm document kind');
    if (movement === null) tasks.push('Confirm whether money moved');
    if (movement && !amountCandidateId && !manualAmount) tasks.push('Choose the transaction amount');
    if (movement && (!currency || !currencyConfirmed)) tasks.push('Confirm currency');
    if (movement && (!interpretedDateTime || !dateConfirmed)) tasks.push('Confirm date and timezone');
    if (movement && !nature) tasks.push('Choose transaction nature');
    return tasks;
  }, [amountCandidateId, currency, currencyConfirmed, dateConfirmed, documentKind, interpretedDateTime, manualAmount, movement, nature, workspace?.requiresDocumentKindReview]);

  const buildInput = (): TransactionReviewInput => ({
    documentKind: documentKind || null,
    documentKindReason: documentKindReason || null,
    representsFinancialMovement: movement,
    amount: manualMode
      ? { mode: 'manual', amountMinor: parseMinor(manualAmount), recognizedValue: manualAmount, reason: manualAmountReason }
      : amountCandidateId ? { mode: 'candidate', candidateId: amountCandidateId } : null,
    currency: currency.trim().toUpperCase() || null,
    currencyConfirmed,
    date: dateCandidateId
      ? { mode: 'candidate', candidateId: dateCandidateId, interpretedDateTime, timezone: data?.business.timezone, confirmed: dateConfirmed }
      : interpretedDateTime ? { mode: 'manual', interpretedDateTime, timezone: data?.business.timezone, confirmed: dateConfirmed, reason: 'No extracted date was correct.' } : null,
    reference: workspace?.referenceCandidates.find((candidate) => candidate.value === reference)
      ? candidateChoice(workspace.referenceCandidates.find((candidate) => candidate.value === reference))
      : reference ? { mode: 'manual', value: reference, reason: fieldCorrectionReason || undefined } : null,
    bank: workspace?.bankCandidates.find((candidate) => candidate.value === bank)
      ? candidateChoice(workspace.bankCandidates.find((candidate) => candidate.value === bank))
      : bank ? { mode: 'manual', value: bank, reason: fieldCorrectionReason || undefined } : null,
    sender: workspace?.senderCandidates.find((candidate) => candidate.value === sender)
      ? candidateChoice(workspace.senderCandidates.find((candidate) => candidate.value === sender))
      : sender ? { mode: 'manual', value: sender, reason: fieldCorrectionReason || undefined } : null,
    recipient: workspace?.recipientCandidates.find((candidate) => candidate.value === recipient)
      ? candidateChoice(workspace.recipientCandidates.find((candidate) => candidate.value === recipient))
      : recipient ? { mode: 'manual', value: recipient, reason: fieldCorrectionReason || undefined } : null,
    transactionStatus: status,
    transactionNature: nature,
    transactionNatureNote: natureNote || null,
    notes: notes || null,
  });

  const save = async (action: 'save_draft' | 'confirm') => {
    if (!online) { setMessage({ tone: 'error', text: 'Reconnect before saving this secure review.' }); return; }
    setBusy(action === 'confirm' ? 'confirm' : 'save'); setMessage(null);
    try {
      const result = await saveTransactionReview({ intakeId, action, review: buildInput(), idempotencyKey: Crypto.randomUUID() });
      if (result.readyToSubmit) {
        setMessage({ tone: 'success', text: 'Human review confirmed. This draft is ready to submit; no financial record was created.' });
        onReady();
      } else {
        setMessage({ tone: 'pending', text: 'Review draft saved with its current validation tasks.' });
      }
      await load();
    } catch (error) { setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Unable to save this review.' }); }
    finally { setBusy(null); }
  };

  const retry = async () => {
    setBusy('retry'); setMessage(null);
    try { await onRetryExtraction(); await load(); setMessage({ tone: 'pending', text: 'Extraction retry queued. Review will refresh when it completes.' }); }
    catch (error) { setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Unable to retry extraction.' }); }
    finally { setBusy(null); }
  };

  if (loading && !data) return <View style={styles.card}><Text style={styles.muted}>Loading human review workspace…</Text></View>;
  if (!workspace) return <View style={styles.card}><Text style={styles.errorText}>The review workspace is unavailable.</Text><Button label="Retry" onPress={() => void load()} /></View>;
  return <>
    <View style={styles.summaryCard} accessibilityLabel="AI extracted transaction summary">
      <View style={styles.row}><Text style={styles.aiLabel}>AI extracted · not bank verified</Text><Text style={styles.confidence}>{Math.round((workspace.classificationConfidence ?? 0) * 100)}%</Text></View>
      <Text style={styles.summaryAmount}>{suggestedAmount?.recognizedValue ?? 'Amount needs review'}</Text>
      <Text style={styles.summaryMeta}>{bank || 'Bank not found'} · {selectedDate?.value || workspace.dateCandidates[0]?.value || 'Date not found'}</Text>
      <Text style={styles.summaryMeta}>Reference {reference || 'not found'}</Text>
      <Text style={styles.summaryRoute}>{sender || 'Sender not found'} → {recipient || 'Recipient not found'}</Text>
      {suggestedAmount && !selectedAmount ? <Text style={styles.suggestion}>Recommended candidate only — tap it below to confirm.</Text> : null}
    </View>

    {reviewTasks.length ? <View style={styles.taskCard} accessibilityRole="alert"><Text style={styles.taskTitle}>Review needed</Text>{reviewTasks.map((task) => <Text key={task} style={styles.taskText}>• {task}</Text>)}</View> : null}

    <View style={styles.card}><Text style={styles.title}>Document meaning</Text><Text style={styles.label}>Document kind</Text><View style={styles.wrap}>{kinds.map((kind) => <Choice key={kind} selected={documentKind === kind} label={kind.replace(/_/g, ' ')} onPress={() => { setDocumentKind(kind); if (kind !== workspace.proposedDocumentKind) setDocumentKindReason('Corrected after comparing the original evidence.'); }} />)}</View>
      {workspace.requiresDocumentKindReview ? <Text style={styles.warning}>Low-confidence type: compare it with the immutable original.</Text> : null}
      <Text style={styles.label}>Does this document represent a financial movement?</Text><View accessibilityRole="radiogroup" style={styles.wrap}><Choice selected={movement === true} label="Yes, money moved" onPress={() => setMovement(true)} /><Choice selected={movement === false} label="No" onPress={() => { setMovement(false); setNature(null); }} /></View>
    </View>

    {movement ? <View style={styles.card}><Text style={styles.title}>Transaction amount</Text>{workspace.amountCandidates.map((candidate) => <Pressable key={candidate.candidateId} accessibilityRole="radio" accessibilityState={{ selected: amountCandidateId === candidate.candidateId }} onPress={() => { setManualMode(false); setAmountCandidateId(candidate.candidateId); setCurrency(candidate.currency); setCurrencyConfirmed(false); }} style={[styles.candidate, amountCandidateId === candidate.candidateId && styles.candidateSelected]}><View style={styles.row}><Text style={styles.candidateValue}>{candidate.recognizedValue}</Text>{candidate.recommended ? <Text style={styles.recommended}>Recommended</Text> : null}</View><Text style={styles.candidateLabel}>{candidate.label.replace(/_/g, ' ')} · {Math.round(candidate.confidence * 100)}% confidence</Text><Citation candidate={candidate} /></Pressable>)}
      <Button label="Enter Manually" secondary onPress={() => { setManualMode(true); setAmountCandidateId(''); }} />
      {manualMode ? <><Text style={styles.label}>Amount in major units</Text><TextInput accessibilityLabel="Manual transaction amount" inputMode="decimal" value={manualAmount} onChangeText={setManualAmount} placeholder="3500.00" style={styles.input} /><Text style={styles.label}>Reason required</Text><TextInput accessibilityLabel="Manual amount reason" value={manualAmountReason} onChangeText={setManualAmountReason} placeholder="Why no candidate is correct" style={styles.input} /></> : null}
      <Text style={styles.label}>Currency</Text><TextInput accessibilityLabel="Transaction currency" autoCapitalize="characters" maxLength={3} value={currency} onChangeText={(value) => { setCurrency(value.toUpperCase()); setCurrencyConfirmed(false); }} placeholder="MYR" style={styles.input} /><Choice selected={currencyConfirmed} label={currencyConfirmed ? `Currency confirmed: ${currency}` : `Confirm ${currency || 'currency'}`} onPress={() => setCurrencyConfirmed(Boolean(currency))} />
    </View> : null}

    {movement ? <View style={styles.card}><Text style={styles.title}>Date and transaction nature</Text><Text style={styles.label}>Extracted date</Text><View style={styles.wrap}>{workspace.dateCandidates.map((candidate) => <Choice key={candidate.candidateId} selected={dateCandidateId === candidate.candidateId} label={`${candidate.value} · ${Math.round(candidate.confidence * 100)}%`} onPress={() => { setDateCandidateId(candidate.candidateId); setInterpretedDateTime(candidateDateInterpretation(candidate.value)); setDateConfirmed(false); }} />)}</View>{selectedDate ? <Citation candidate={selectedDate} /> : null}<Text style={styles.label}>Interpreted date/time with offset</Text><TextInput accessibilityLabel="Interpreted transaction date and time" value={interpretedDateTime} onChangeText={(value) => { setInterpretedDateTime(value); setDateConfirmed(false); }} placeholder="2026-08-02T14:30:00+08:00" style={styles.input} /><Text style={styles.muted}>Timezone: {data?.business.timezone}. Ambiguous day/month dates are never accepted without this confirmation.</Text><Choice selected={dateConfirmed} label={dateConfirmed ? 'Date interpretation confirmed' : 'Confirm displayed date interpretation'} onPress={() => setDateConfirmed(Boolean(interpretedDateTime))} />
      <Text style={styles.label}>Transaction nature</Text><Button label={nature ? natures.find((item) => item[0] === nature)?.[1] ?? nature : 'Choose transaction nature'} onPress={() => setNatureOpen(true)} />{nature === 'other' ? <TextInput accessibilityLabel="Other transaction nature note" value={natureNote} onChangeText={setNatureNote} placeholder="Describe what happened" style={styles.input} /> : null}
    </View> : null}

    <View style={styles.card}><View style={styles.row}><Text style={styles.title}>Other fields</Text><Pressable accessibilityRole="button" onPress={() => setEditAll((value) => !value)}><Text style={styles.link}>{editAll ? 'Hide' : 'Edit'}</Text></Pressable></View>{editAll ? <><Text style={styles.label}>Reference (original is preserved)</Text><TextInput accessibilityLabel="Transaction reference" value={reference} onChangeText={setReference} style={styles.input} /><Text style={styles.label}>Bank</Text><TextInput accessibilityLabel="Bank" value={bank} onChangeText={setBank} style={styles.input} /><Text style={styles.label}>Sender</Text><TextInput accessibilityLabel="Sender" value={sender} onChangeText={setSender} style={styles.input} /><Text style={styles.label}>Recipient</Text><TextInput accessibilityLabel="Recipient" value={recipient} onChangeText={setRecipient} style={styles.input} /><Text style={styles.label}>Correction reason (required when changing an extracted value)</Text><TextInput accessibilityLabel="Other field correction reason" value={fieldCorrectionReason} onChangeText={setFieldCorrectionReason} placeholder="Why the extracted value is incorrect" style={styles.input} /><Text style={styles.label}>Visible status</Text><View style={styles.wrap}>{(['successful', 'pending', 'failed', 'unknown'] as const).map((value) => <Choice key={value} selected={status === value} label={value} onPress={() => setStatus(value)} />)}</View><Text style={styles.label}>Review notes</Text><TextInput accessibilityLabel="Review notes" multiline value={notes} onChangeText={setNotes} style={[styles.input, styles.textArea]} /></> : <Text style={styles.muted}>Reference, bank, sender, recipient, visible status, and notes are available through Edit.</Text>}</View>

    <View style={styles.card}><Text style={styles.title}>Evidence and versions</Text><View style={styles.actions}><Button label="View immutable original" secondary onPress={onPreview} /><Button label="Retry Extraction" secondary disabled={busy !== null} onPress={() => void retry()} /></View><Text style={styles.muted}>{data?.evidenceVersions.length ?? 0} evidence version(s) · {data?.extractionVersions.length ?? 0} extraction version(s) · {data?.reviewVersions.length ?? 0} prior review version(s)</Text>{data?.extractionVersions.slice(0, 3).map((version, index) => {
      const result = version.structuredResult as { amount_candidates?: unknown[] } | null;
      return <Text key={version.id} style={styles.version}>Extraction {version.extractionVersion ?? data.extractionVersions.length - index} / document {version.documentVersion ?? '?'}: {version.documentKind?.replace(/_/g, ' ') ?? 'unknown'} · {result?.amount_candidates?.length ?? 0} amount candidate(s) · {version.parserVersion} · {version.status}</Text>;
    })}{data?.reviewVersions.slice(0, 3).map((version) => <View key={String(version.id)} style={styles.history}><Text style={styles.version}>Review {String(version.version)} · {String(version.reviewStatus)} · {String(version.reviewedAt)}</Text>{reviewCorrections(version).map((correction) => <Text key={correction} style={styles.correction}>{correction}</Text>)}</View>)}</View>

    {message ? <View accessibilityRole="alert" style={[styles.message, message.tone === 'error' ? styles.messageError : message.tone === 'success' ? styles.messageSuccess : styles.messagePending]}><Text style={styles.messageText}>{message.text}</Text></View> : null}
    <View style={styles.actions}><Button label={busy === 'save' ? 'Saving…' : 'Save Draft'} secondary disabled={busy !== null} onPress={() => void save('save_draft')} /><Button label={busy === 'confirm' ? 'Confirming…' : 'Continue'} disabled={busy !== null || !online} onPress={() => void save('confirm')} /></View>
    <Text style={styles.disclaimer}>AI assists; you confirm. Continuing records an auditable review only. It does not create a payment, loan, balance, debtor profile, or case.</Text>

    <Modal visible={natureOpen} transparent animationType="slide" onRequestClose={() => setNatureOpen(false)}><View style={styles.modalBackdrop}><View style={styles.sheet} accessibilityViewIsModal><View style={styles.row}><Text style={styles.title}>Transaction nature</Text><Pressable accessibilityRole="button" onPress={() => setNatureOpen(false)}><Text style={styles.link}>Close</Text></Pressable></View><ScrollView>{natures.map(([value, label, description]) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: nature === value }} onPress={() => { setNature(value); setNatureOpen(false); }} style={[styles.nature, nature === value && styles.candidateSelected]}><Text style={styles.candidateValue}>{label}</Text><Text style={styles.muted}>{description}</Text></Pressable>)}</ScrollView></View></View></Modal>
  </>;
}

const styles = StyleSheet.create({
  summaryCard: { padding: 18, gap: 8, borderRadius: 18, backgroundColor: colors.navy },
  aiLabel: { color: colors.inverseMuted, fontWeight: '700', fontSize: 12, textTransform: 'uppercase' }, confidence: { color: colors.inverse, fontWeight: '700' },
  summaryAmount: { color: colors.inverse, fontSize: 31, fontWeight: '700' }, summaryMeta: { color: colors.inverseMuted, lineHeight: 20 }, summaryRoute: { color: colors.inverse, fontWeight: '600' }, suggestion: { color: CollectBossTokens.color.warningBorder, fontSize: 12, fontWeight: '600' },
  card: { padding: 16, gap: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.card },
  taskCard: { padding: 14, gap: 5, borderWidth: 1, borderColor: CollectBossTokens.color.warningBorder, borderRadius: 14, backgroundColor: CollectBossTokens.color.warningSurface }, taskTitle: { color: colors.navy, fontWeight: '700' }, taskText: { color: colors.text, lineHeight: 20 },
  title: { color: colors.navy, fontSize: 18, fontWeight: '700' }, label: { color: colors.text, fontSize: 13, fontWeight: '600', marginTop: 3 }, muted: { color: colors.muted, fontSize: 13, lineHeight: 19 }, warning: { color: colors.amber, fontSize: 13, fontWeight: '600' }, errorText: { color: colors.red, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  choice: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 999, backgroundColor: colors.card }, choiceSelected: { borderColor: colors.blue, backgroundColor: colors.blue }, choiceText: { color: colors.text, fontSize: 12, fontWeight: '600', textTransform: 'capitalize' }, choiceTextSelected: { color: colors.inverse },
  candidate: { padding: 13, gap: 7, borderWidth: 1, borderColor: colors.border, borderRadius: 13, backgroundColor: colors.card }, candidateSelected: { borderColor: colors.blue, borderWidth: 2, backgroundColor: colors.selectedSurface }, candidateValue: { color: colors.navy, fontSize: 16, fontWeight: '700' }, candidateLabel: { color: colors.muted, fontSize: 12, textTransform: 'capitalize' }, recommended: { color: colors.blue, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  citation: { padding: 10, gap: 3, borderRadius: 10, backgroundColor: CollectBossTokens.color.surfaceMuted }, citationLabel: { color: colors.blue, fontSize: 11, fontWeight: '700' }, citationText: { color: colors.text, fontSize: 12, lineHeight: 17 }, citationMeta: { color: colors.muted, fontSize: 10 },
  input: { minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, color: colors.text, backgroundColor: colors.card }, textArea: { minHeight: 90, paddingTop: 12, textAlignVertical: 'top' },
  button: { flexGrow: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.blue }, buttonPressed: { backgroundColor: CollectBossTokens.color.primaryPressed }, buttonSecondary: { borderWidth: 1, borderColor: colors.blue, backgroundColor: colors.card }, buttonText: { color: colors.inverse, fontWeight: '700' }, buttonSecondaryText: { color: colors.blue }, disabled: { borderColor: CollectBossTokens.color.disabledBorder, backgroundColor: CollectBossTokens.color.disabledSurface, opacity: 1 }, disabledText: { color: CollectBossTokens.color.disabledText }, link: { color: colors.blue, fontWeight: '700', padding: 8 },
  message: { padding: 12, borderWidth: 1, borderRadius: 12 }, messageError: { borderColor: CollectBossTokens.color.dangerBorder, backgroundColor: CollectBossTokens.color.dangerSurface }, messageSuccess: { borderColor: CollectBossTokens.color.successBorder, backgroundColor: CollectBossTokens.color.successSurface }, messagePending: { borderColor: CollectBossTokens.color.warningBorder, backgroundColor: CollectBossTokens.color.warningSurface }, messageText: { color: colors.text, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  history: { paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, version: { color: colors.text, fontSize: 12, lineHeight: 18 }, correction: { color: colors.amber, fontSize: 11, lineHeight: 17 }, disclaimer: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: CollectBossTokens.color.surfaceOverlay }, sheet: { maxHeight: '82%', padding: 18, paddingBottom: 30, gap: 10, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: colors.card }, nature: { padding: 14, gap: 4, marginBottom: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 13 },
});
