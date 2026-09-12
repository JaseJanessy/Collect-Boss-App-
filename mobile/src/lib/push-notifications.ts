import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { requireSupabase } from '@/lib/supabase';
import { parseMobileRoute, type MobileRoute } from '@/lib/workflow-core';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications(businessId: string, userId: string) {
  if (Platform.OS === 'web') throw new Error('Push notifications are available in the Android and iOS apps.');
  if (!Device.isDevice) throw new Error('Use a physical device to enable remote push notifications.');
  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Notification permission was not granted. You can enable it later in device settings.');
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('urgent-work', {
      name: 'Urgent collection work',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
    });
  }
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error('An EAS project ID is required before production push tokens can be registered.');
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  const { error } = await requireSupabase().from('mobile_push_devices').upsert({
    business_id: businessId,
    user_id: userId,
    expo_push_token: token.data,
    platform: Platform.OS,
    enabled: true,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'expo_push_token' });
  if (error) throw error;
  return token.data;
}

export function subscribeToNotificationRoutes(onRoute: (route: MobileRoute) => void) {
  if (Platform.OS === 'web') return () => undefined;

  const open = (data: unknown) => {
    const route = parseMobileRoute(data);
    if (route) onRoute(route);
  };
  const response = Notifications.addNotificationResponseReceivedListener((event) => open(event.notification.request.content.data));
  void Notifications.getLastNotificationResponseAsync().then((event) => {
    if (event) open(event.notification.request.content.data);
  });
  return () => response.remove();
}
