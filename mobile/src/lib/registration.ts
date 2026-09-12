import Constants from 'expo-constants';

import { MAIN_RULES_VERSION, type RegistrationDetails, type RegistrationProduct } from '../../../shared/registration-contracts';

type MobileConfig = { apiBaseUrl?: string };
const config = Constants.expoConfig?.extra as MobileConfig | undefined;
const apiBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || config?.apiBaseUrl?.trim() || '').replace(/\/$/u, '');

export function registrationEmailRedirectUrl(): string | undefined {
  return apiBaseUrl && /^https?:\/\//u.test(apiBaseUrl) ? `${apiBaseUrl}/auth/callback?next=%2Fchoose-product` : undefined;
}

export function registrationLegalUrl(path: "/terms" | "/privacy" | "/legal-disclaimer" | "/pdpa-consent"): string | null {
  return apiBaseUrl && /^https?:\/\//u.test(apiBaseUrl) ? `${apiBaseUrl}${path}` : null;
}

async function registrationRequest(
  accessToken: string,
  body?: RegistrationDetails & { mainRulesAccepted: boolean },
): Promise<RegistrationProduct> {
  if (!apiBaseUrl || !/^https?:\/\//u.test(apiBaseUrl)) {
    throw new Error('The secure CollectBoss workspace service is not configured.');
  }

  const response = await fetch(`${apiBaseUrl}/api/workspace/provision`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify({ ...body, mainRulesVersion: MAIN_RULES_VERSION }) : undefined,
  });
  const payload = await response.json().catch(() => null) as { error?: string; workspace?: { product?: RegistrationProduct } } | null;
  if (!response.ok) throw new Error(payload?.error ?? 'Unable to prepare your CollectBoss workspace.');
  if (payload?.workspace?.product !== 'main' && payload?.workspace?.product !== 'pocket') {
    throw new Error('The CollectBoss workspace service returned an invalid product.');
  }
  return payload.workspace.product;
}

export async function provisionRegistration(accessToken: string): Promise<void> {
  await registrationRequest(accessToken);
}

export async function completeRegistration(
  accessToken: string,
  details: RegistrationDetails,
  mainRulesAccepted: boolean,
): Promise<RegistrationProduct> {
  return registrationRequest(accessToken, { ...details, mainRulesAccepted });
}
