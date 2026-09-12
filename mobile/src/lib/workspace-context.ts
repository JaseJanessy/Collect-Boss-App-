import Constants from 'expo-constants';

import type { WorkspaceContextResponse } from '../../../shared/workspace-contracts';

type MobileConfig = { apiBaseUrl?: string };
const config = Constants.expoConfig?.extra as MobileConfig | undefined;
const apiBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || config?.apiBaseUrl?.trim() || '').replace(/\/$/, '');

export class WorkspaceContextError extends Error {
  constructor(message: string, readonly code: string | null, readonly status: number) {
    super(message);
    this.name = 'WorkspaceContextError';
  }
}

function isWorkspaceContext(value: unknown): value is WorkspaceContextResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WorkspaceContextResponse>;
  return Boolean(
    candidate.workspace
    && typeof candidate.workspace.name === 'string'
    && (candidate.workspace.productType === 'main' || candidate.workspace.productType === 'pocket')
    && ['active', 'grace_read_only', 'suspended'].includes(candidate.workspace.lifecycleState ?? '')
    && candidate.plan
    && typeof candidate.plan.slug === 'string',
  );
}

export async function loadWorkspaceContext(accessToken: string): Promise<WorkspaceContextResponse> {
  if (!apiBaseUrl || !/^https?:\/\//u.test(apiBaseUrl)) {
    throw new Error('The secure CollectBoss workspace service is not configured.');
  }
  const response = await fetch(`${apiBaseUrl}/api/workspace/context`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => null) as ({ error?: string; code?: string } & Partial<WorkspaceContextResponse>) | null;
  if (!response.ok) throw new WorkspaceContextError(payload?.error ?? 'Your authorised business could not be verified.', payload?.code ?? null, response.status);
  if (!isWorkspaceContext(payload)) throw new Error('The workspace service returned an invalid response.');
  return payload;
}
