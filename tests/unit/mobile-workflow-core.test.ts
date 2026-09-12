import { describe, expect, it } from 'vitest';

import {
  canApproveOnMobile, currencyToMinor, isSessionExpiry, mergeDrafts, parseMobileRoute,
  validateDraft, type MobileDraft,
} from '../../mobile/src/lib/workflow-core';

function draft(overrides: Partial<MobileDraft> = {}): MobileDraft {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    userId: 'user-1',
    caseId: 'CASE-1',
    kind: 'note',
    payload: { note: 'Visited customer site.' },
    state: 'pending',
    attempts: 0,
    createdAt: '2026-08-09T00:00:00.000Z',
    ...overrides,
  };
}

describe('mobile workflow foundation', () => {
  it('deep-links only recognised case and action destinations', () => {
    expect(parseMobileRoute({ actionUrl: '/cases/CASE-22' })).toEqual({ screen: 'cases', caseId: 'CASE-22' });
    expect(parseMobileRoute({ caseId: 'CASE-9', actionId: 'ACTION-1' })).toEqual({ screen: 'cases', caseId: 'CASE-9' });
    expect(parseMobileRoute({ actionUrl: '//attacker.example/cases/CASE-1' })).toBeNull();
    expect(parseMobileRoute({ actionUrl: '/actions', actionId: 'ACTION-1' })).toEqual({ screen: 'action-centre', actionId: 'ACTION-1' });
  });

  it('allows only low/medium risk completion types on mobile', () => {
    expect(canApproveOnMobile({ type: 'approval.low_risk', priority: 'low' })).toBe(true);
    expect(canApproveOnMobile({ type: 'approval.legal_handoff', priority: 'high' })).toBe(false);
    expect(canApproveOnMobile({ type: 'write_off.approval', priority: 'critical' })).toBe(false);
    expect(canApproveOnMobile({ type: 'settlement.approval', priority: 'low' })).toBe(false);
  });

  it('converts currency without floating-point rounding', () => {
    expect(currencyToMinor('19.99', 'MYR')).toBe('1999');
    expect(currencyToMinor('100', 'JPY')).toBe('100');
    expect(currencyToMinor('1.234', 'KWD')).toBe('1234');
    expect(currencyToMinor('1.2345', 'CLF')).toBe('12345');
    expect(() => currencyToMinor('1.001', 'MYR')).toThrow(/decimal places/);
  });

  it('deduplicates drafts by id and caps protected persistence', () => {
    const initial = Array.from({ length: 20 }, (_, index) => draft({ id: `draft-${index}`, createdAt: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z` }));
    const merged = mergeDrafts(initial, draft({ id: 'draft-10', payload: { note: 'updated' }, createdAt: '2026-09-01T00:00:00.000Z' }));
    expect(merged).toHaveLength(20);
    expect(merged.filter((item) => item.id === 'draft-10')).toHaveLength(1);
    expect(merged[0].payload.note).toBe('updated');
  });

  it('rejects oversized or ownerless drafts and recognises expired sessions', () => {
    expect(validateDraft(draft({ userId: '' }))).toMatch(/owner/);
    expect(validateDraft(draft({ payload: { note: 'x'.repeat(1_801) } }))).toMatch(/too long/);
    expect(isSessionExpiry('JWT expired')).toBe(true);
    expect(isSessionExpiry('network request failed')).toBe(false);
  });
});
