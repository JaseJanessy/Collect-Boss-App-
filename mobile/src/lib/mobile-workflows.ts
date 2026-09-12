import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';

import { removeDraft, saveDraft } from '@/lib/draft-store';
import { requireSupabase } from '@/lib/supabase';
import { currencyToMinor, type MobileDraft } from '@/lib/workflow-core';

type MobileConfig = { apiBaseUrl?: string };
const config = Constants.expoConfig?.extra as MobileConfig | undefined;
const apiBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || config?.apiBaseUrl?.trim() || '').replace(/\/$/, '');

export type DraftProgress = { sent: number; total: number; ratio: number | null };

export function mobileApiConfigured() {
  return Boolean(apiBaseUrl && /^https?:\/\//.test(apiBaseUrl));
}

export async function submitDraft(
  draft: MobileDraft,
  onProgress?: (progress: DraftProgress) => void,
): Promise<void> {
  const client = requireSupabase();
  const sending = { ...draft, state: 'sending' as const, attempts: draft.attempts + 1, lastError: undefined };
  await saveDraft(sending);
  try {
    if (draft.kind === 'promise') {
      const { error } = await client.rpc('payment_promise_create', {
        p_case_id: draft.caseId,
        p_amount_minor: currencyToMinor(draft.payload.amount, draft.payload.currency),
        p_promise_date: draft.payload.promiseDate,
        p_source: 'in_person',
        p_note: draft.payload.note || null,
        p_idempotency_key: draft.id,
      });
      if (error) throw error;
    } else if (draft.kind === 'dispute_update') {
      const { error } = await client.rpc('dispute_transition', {
        p_dispute_id: draft.payload.disputeId,
        p_to_status: draft.payload.status,
        p_response: draft.payload.response || null,
        p_resolution_amount_minor: draft.payload.resolutionAmount
          ? currencyToMinor(draft.payload.resolutionAmount, draft.payload.currency)
          : null,
      });
      if (error) throw error;
    } else if (draft.kind === 'note') {
      const { error } = await client.rpc('communication_activity_create', {
        p_case_id: draft.caseId,
        p_channel: 'other',
        p_direction: 'outbound',
        p_status: 'completed',
        p_metadata: { kind: 'internal_note', note: draft.payload.note, source: 'mobile' },
        p_idempotency_key: draft.id,
      });
      if (error) throw error;
    } else {
      if (!draft.attachment) throw new Error('The selected attachment is no longer available. Choose it again.');
      if (!mobileApiConfigured()) throw new Error('EXPO_PUBLIC_API_BASE_URL is required for secure mobile uploads.');
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError || !sessionData.session?.access_token) throw new Error('Your session expired. Sign in and retry the draft.');
      const task = FileSystem.createUploadTask(
        `${apiBaseUrl}/api/mobile/cases/${encodeURIComponent(draft.caseId)}/evidence`,
        draft.attachment.uri,
        {
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: 'file',
          mimeType: draft.attachment.mimeType,
          httpMethod: 'POST',
          headers: { Authorization: `Bearer ${sessionData.session.access_token}`, 'X-Idempotency-Key': draft.id },
          parameters: {
            evidenceType: draft.payload.evidenceType || 'other',
            description: draft.payload.description || '',
            isInternal: 'true',
          },
        },
        ({ totalBytesSent, totalBytesExpectedToSend }) => onProgress?.({
          sent: totalBytesSent,
          total: totalBytesExpectedToSend,
          ratio: totalBytesExpectedToSend > 0 ? totalBytesSent / totalBytesExpectedToSend : null,
        }),
      );
      const result = await task.uploadAsync();
      if (!result) throw new Error('The upload was interrupted. Retry when the connection is stable.');
      if (result.status < 200 || result.status >= 300) {
        let message = 'Upload failed. The draft is still saved.';
        try { message = (JSON.parse(result.body) as { error?: string }).error ?? message; } catch { /* structured fallback */ }
        throw new Error(message);
      }
    }
    await removeDraft(draft.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Submission failed. The draft is still saved.';
    await saveDraft({ ...sending, state: 'failed', lastError: message });
    throw new Error(message);
  }
}

export async function completeLowRiskAction(actionId: string) {
  const { error } = await requireSupabase().rpc('action_centre_transition', {
    p_action_id: actionId,
    p_transition: 'completed',
    p_snoozed_until: null,
  });
  if (error) throw error;
}
