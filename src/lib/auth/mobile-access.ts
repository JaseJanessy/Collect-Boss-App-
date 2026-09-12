import 'server-only';

import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

import type { TenantPermission } from '@/lib/auth/permissions';
import type { TenantRole } from '@/lib/auth/permissions';
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured, type AppSupabaseClient } from '@/lib/supabase/client';
import { getServiceClient } from '@/lib/supabase/service-client';

export async function requireMobilePermission(request: NextRequest, permission: TenantPermission) {
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) return { error: 'A mobile bearer token is required.', status: 401 } as const;
  if (!isSupabaseConfigured) return { error: 'Mobile authentication is unavailable.', status: 503 } as const;

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  }) as AppSupabaseClient;
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) return { error: 'The mobile session is invalid or expired.', status: 401 } as const;
  const { data: businessId, error: businessError } = await client.rpc('my_business_id');
  if (businessError) return { error: 'Workspace membership service is unavailable.', status: 503 } as const;
  if (!businessId) return { error: 'A business membership is required.', status: 403 } as const;
  const { data: allowed, error: permissionError } = await client.rpc('has_business_permission', {
    p_business_id: businessId,
    p_permission: permission,
  });
  if (permissionError) return { error: 'Workspace permissions are unavailable.', status: 503 } as const;
  if (!allowed) return { error: 'You do not have permission to perform this action.', status: 403 } as const;
  const service = await getServiceClient();
  if (!service) return { error: 'Mobile upload service is unavailable.', status: 503 } as const;
  const { data: business, error: roleError } = await service.from('businesses')
    .select('owner_id').eq('id', businessId).maybeSingle();
  if (roleError || !business) return { error: 'A business membership is required.', status: 403 } as const;
  let role: TenantRole = 'owner';
  if (business.owner_id !== userData.user.id) {
    const { data: membership, error: membershipError } = await service.from('business_memberships')
      .select('role').eq('business_id', businessId).eq('user_id', userData.user.id).eq('status', 'active').maybeSingle();
    if (membershipError || !membership) return { error: 'A business membership is required.', status: 403 } as const;
    role = membership.role as TenantRole;
  }
  return { client, service, user: userData.user, businessId: businessId as string, role } as const;
}
