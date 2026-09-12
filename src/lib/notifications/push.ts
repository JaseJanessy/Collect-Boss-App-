import 'server-only';

import type { AppSupabaseClient } from '@/lib/supabase/client';

const PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

type Device = { id: string; business_id: string; user_id: string; expo_push_token: string };
type Notification = {
  id: string; business_id: string; user_id: string | null; case_id: string | null;
  entity_id: string | null; title: string; message: string; severity: string; action_url: string | null;
};
type Delivery = { id: string; notification_id: string; device_id: string; ticket_id: string | null; attempts: number };
type ExpoResult = { status: 'ok' | 'error'; id?: string; message?: string; details?: { error?: string } };

function priority(severity: string) {
  return severity === 'critical' || severity === 'high' ? 'high' : 'normal';
}

function lastDay() {
  return new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
}

function receiptCutoff() {
  return new Date(Date.now() - 15 * 60 * 1_000).toISOString();
}

export async function dispatchMobilePushNotifications(service: AppSupabaseClient) {
  const { data: notificationRows, error: notificationError } = await service.from('notifications')
    .select('id,business_id,user_id,case_id,entity_id,title,message,severity,action_url')
    .is('archived_at', null).eq('push_enabled', true).not('action_url', 'is', null).gte('created_at', lastDay())
    .order('created_at').limit(100);
  if (notificationError) throw new Error('Unable to load notifications for mobile delivery.');
  const notifications = (notificationRows ?? []) as Notification[];
  if (!notifications.length) return { queued: 0, accepted: 0, failed: 0 };

  const businessIds = [...new Set(notifications.map((item) => item.business_id))];
  const notificationIds = notifications.map((item) => item.id);
  const [{ data: deviceRows, error: deviceError }, { data: deliveryRows, error: deliveryError }] = await Promise.all([
    service.from('mobile_push_devices').select('id,business_id,user_id,expo_push_token')
      .in('business_id', businessIds).eq('enabled', true),
    service.from('mobile_push_deliveries').select('id,notification_id,device_id,ticket_id,attempts')
      .in('notification_id', notificationIds),
  ]);
  if (deviceError || deliveryError) throw new Error('Unable to load mobile push registrations.');
  const devices = (deviceRows ?? []) as Device[];
  const deliveries = (deliveryRows ?? []) as Delivery[];
  const deliveryKey = new Set(deliveries.map((item) => `${item.notification_id}:${item.device_id}`));

  const queued = notifications.flatMap((notification) => devices
    .filter((device) => device.business_id === notification.business_id
      && (!notification.user_id || notification.user_id === device.user_id)
      && !deliveryKey.has(`${notification.id}:${device.id}`))
    .map((device) => ({ notification, device }))
  ).slice(0, 100);
  if (!queued.length) return { queued: 0, accepted: 0, failed: 0 };

  const { data: insertedRows, error: insertError } = await service.from('mobile_push_deliveries').insert(
    queued.map(({ notification, device }) => ({ notification_id: notification.id, device_id: device.id })),
  ).select('id,notification_id,device_id,ticket_id,attempts');
  if (insertError) throw new Error('Unable to reserve mobile push deliveries.');
  const inserted = (insertedRows ?? []) as Delivery[];
  const insertedMap = new Map(inserted.map((item) => [`${item.notification_id}:${item.device_id}`, item]));

  const response = await fetch(PUSH_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(queued.map(({ notification, device }) => ({
      to: device.expo_push_token,
      title: notification.title,
      body: notification.message,
      channelId: 'urgent-work',
      priority: priority(notification.severity),
      data: {
        notificationId: notification.id,
        caseId: notification.case_id,
        actionId: notification.entity_id,
        actionUrl: notification.action_url,
      },
    }))),
  });
  const payload = await response.json().catch(() => null) as { data?: ExpoResult[] } | null;
  if (!response.ok || !Array.isArray(payload?.data)) {
    await Promise.all(inserted.map((delivery) => service.from('mobile_push_deliveries').update({
      status: 'retryable_error', attempts: delivery.attempts + 1,
      last_error: `Expo push request failed with HTTP ${response.status}.`, updated_at: new Date().toISOString(),
    }).eq('id', delivery.id)));
    throw new Error('Expo rejected the mobile push batch.');
  }

  let accepted = 0;
  let failed = 0;
  await Promise.all(payload.data.map(async (ticket, index) => {
    const queuedItem = queued[index];
    const delivery = insertedMap.get(`${queuedItem.notification.id}:${queuedItem.device.id}`);
    if (!delivery) return;
    const now = new Date().toISOString();
    if (ticket.status === 'ok' && ticket.id) {
      accepted += 1;
      await service.from('mobile_push_deliveries').update({
        status: 'ticket_ok', ticket_id: ticket.id, attempts: 1, sent_at: now, last_error: null, updated_at: now,
      }).eq('id', delivery.id);
      return;
    }
    failed += 1;
    const unregistered = ticket.details?.error === 'DeviceNotRegistered';
    await service.from('mobile_push_deliveries').update({
      status: unregistered ? 'failed' : 'retryable_error', attempts: 1,
      last_error: (ticket.message ?? ticket.details?.error ?? 'Expo rejected the push ticket.').slice(0, 500), updated_at: now,
    }).eq('id', delivery.id);
    if (unregistered) await service.from('mobile_push_devices').update({ enabled: false, disabled_at: now, updated_at: now }).eq('id', queuedItem.device.id);
  }));
  return { queued: queued.length, accepted, failed };
}

export async function checkMobilePushReceipts(service: AppSupabaseClient) {
  const { data: rows, error } = await service.from('mobile_push_deliveries')
    .select('id,notification_id,device_id,ticket_id,attempts').eq('status', 'ticket_ok')
    .is('receipt_checked_at', null).lte('sent_at', receiptCutoff()).gte('sent_at', lastDay()).limit(1_000);
  if (error) throw new Error('Unable to load pending mobile push receipts.');
  const deliveries = ((rows ?? []) as Delivery[]).filter((item) => item.ticket_id);
  if (!deliveries.length) return { checked: 0, delivered: 0, failed: 0 };
  const response = await fetch(RECEIPTS_URL, {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: deliveries.map((item) => item.ticket_id) }),
  });
  const payload = await response.json().catch(() => null) as { data?: Record<string, ExpoResult> } | null;
  if (!response.ok || !payload?.data) throw new Error('Expo push receipts are temporarily unavailable.');
  let delivered = 0;
  let failed = 0;
  const now = new Date().toISOString();
  await Promise.all(deliveries.map(async (delivery) => {
    const receipt = payload.data?.[delivery.ticket_id!];
    if (!receipt) return;
    const unregistered = receipt.details?.error === 'DeviceNotRegistered';
    const ok = receipt.status === 'ok';
    if (ok) delivered += 1; else failed += 1;
    await service.from('mobile_push_deliveries').update({
      status: ok ? 'delivered' : 'failed', receipt_checked_at: now,
      last_error: ok ? null : (receipt.message ?? receipt.details?.error ?? 'Push delivery failed.').slice(0, 500), updated_at: now,
    }).eq('id', delivery.id);
    if (unregistered) await service.from('mobile_push_devices').update({ enabled: false, disabled_at: now, updated_at: now }).eq('id', delivery.device_id);
  }));
  return { checked: deliveries.length, delivered, failed };
}
