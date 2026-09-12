import type { MobileRoute } from '@/lib/workflow-core';

export async function registerForPushNotifications(businessId: string, userId: string) {
  void businessId;
  void userId;
  throw new Error('Push notifications are available in the Android and iOS apps.');
}

export function subscribeToNotificationRoutes(onRoute: (route: MobileRoute) => void) {
  void onRoute;
  return () => undefined;
}
