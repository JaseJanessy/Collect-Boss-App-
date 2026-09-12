export const MOBILE_DRAFT_LIMIT = 20;
export const MOBILE_DRAFT_MAX_TEXT = 1_800;

export type MobileDraftKind = 'promise' | 'dispute_update' | 'note' | 'evidence';
export type MobileDraftState = 'pending' | 'sending' | 'failed';

export type MobileAttachment = {
  uri: string;
  name: string;
  mimeType: string;
  size: number | null;
};

export type MobileDraft = {
  id: string;
  userId: string;
  caseId: string;
  kind: MobileDraftKind;
  payload: Record<string, string>;
  attachment?: MobileAttachment;
  state: MobileDraftState;
  attempts: number;
  createdAt: string;
  lastError?: string;
};

export type MobileRoute = {
  screen: 'dashboard' | 'cases' | 'payments' | 'action-centre' | 'reports' | 'notifications';
  caseId?: string;
  actionId?: string;
};

const casePath = /^\/cases\/([^/?#]+)/;

export function parseMobileRoute(input: unknown): MobileRoute | null {
  if (!input || typeof input !== 'object') return null;
  const data = input as Record<string, unknown>;
  const caseId = typeof data.caseId === 'string' && data.caseId.trim() ? data.caseId.trim() : undefined;
  const actionId = typeof data.actionId === 'string' && data.actionId.trim() ? data.actionId.trim() : undefined;
  const actionUrl = typeof data.actionUrl === 'string' ? data.actionUrl : '';
  const matchedCase = actionUrl.match(casePath)?.[1];

  if (caseId || matchedCase) return { screen: 'cases', caseId: caseId ?? decodeURIComponent(matchedCase!) };
  if (actionId || actionUrl.startsWith('/actions') || actionUrl.startsWith('/operations')) {
    return { screen: 'action-centre', actionId };
  }
  if (actionUrl.startsWith('/payments')) return { screen: 'payments' };
  if (actionUrl.startsWith('/reports') || actionUrl.startsWith('/statements')) return { screen: 'reports' };
  if (actionUrl.startsWith('/notifications')) return { screen: 'notifications' };
  return null;
}

export function canApproveOnMobile(action: { type: string; priority: string | null }): boolean {
  const type = action.type.toLowerCase();
  if (['settlement', 'write_off', 'legal', 'compliance', 'payment', 'dispute', 'hardship'].some((term) => type.includes(term))) {
    return false;
  }
  return (action.priority === 'low' || action.priority === 'medium')
    && (type.includes('approval') || type === 'follow_up.due' || type === 'evidence.requested');
}

export function validateDraft(draft: MobileDraft): string | null {
  if (!draft.id || !draft.userId || !draft.caseId) return 'Draft is missing its owner or case reference.';
  const textSize = Object.values(draft.payload).join('').length;
  if (textSize > MOBILE_DRAFT_MAX_TEXT) return 'Draft text is too long for protected on-device storage.';
  if (draft.kind === 'evidence' && !draft.attachment) return 'Choose a file before saving this draft.';
  return null;
}

export function mergeDrafts(existing: MobileDraft[], next: MobileDraft): MobileDraft[] {
  const withoutDuplicate = existing.filter((draft) => draft.id !== next.id);
  return [next, ...withoutDuplicate]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MOBILE_DRAFT_LIMIT);
}

export function isSessionExpiry(message: string): boolean {
  return /jwt|refresh[_ ]token|session.*expired|not authenticated|must be signed in/i.test(message);
}

export function currencyToMinor(value: string, currency = 'MYR'): string {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(trimmed)) throw new Error('Enter a valid positive amount.');
  const decimals = currency === 'CLF' ? 4 : ['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'].includes(currency)
    ? 0
    : ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'].includes(currency) ? 3 : 2;
  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) throw new Error(`${currency} supports ${decimals} decimal places.`);
  return (BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
}
