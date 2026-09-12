import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('mobile companion integration contracts', () => {
  it('keeps production build configuration strict and native identifiers stable', () => {
    const config = read('mobile/app.config.js');
    const app = JSON.parse(read('mobile/app.json')) as { expo: { ios: { bundleIdentifier: string }; android: { package: string }; plugins: unknown[] } };
    expect(config).toContain('Production build blocked');
    expect(config).toContain('EXPO_PUBLIC_API_BASE_URL');
    expect(config).toContain('EXPO_PUBLIC_EAS_PROJECT_ID');
    expect(app.expo.ios.bundleIdentifier).toBe('com.collectboss.mobile');
    expect(app.expo.android.package).toBe('com.collectboss.mobile');
    expect(JSON.stringify(app.expo.plugins)).toContain('expo-notifications');
    expect(JSON.stringify(app.expo.plugins)).toContain('expo-secure-store');
  });

  it('uses bearer permission validation and private evidence storage for mobile uploads', () => {
    const route = read('src/app/api/mobile/cases/[caseId]/evidence/route.ts');
    const access = read('src/lib/auth/mobile-access.ts');
    expect(access).toContain("startsWith('Bearer ')");
    expect(access).toContain("has_business_permission");
    expect(route).toContain("requireMobilePermission(request, 'case.manage')");
    expect(route).toContain('validateEvidenceUpload');
    expect(route).toContain('content_sha256');
    expect(route).toContain("action: 'evidence.uploaded'");
  });

  it('persists only user-scoped push tokens and service-only delivery receipts', () => {
    const migration = read('supabase/migrations/20260830_mobile_companion_foundation.sql');
    expect(migration).toContain('user_id=auth.uid()');
    expect(migration).toContain("revoke all on public.mobile_push_deliveries from authenticated");
    expect(migration).toContain('unique(notification_id,device_id)');
    expect(migration).toContain('Rollback');
  });

  it('dispatches notification records with deep-link data and checks Expo receipts', () => {
    const sender = read('src/lib/notifications/push.ts');
    expect(sender).toContain('https://exp.host/--/api/v2/push/send');
    expect(sender).toContain('https://exp.host/--/api/v2/push/getReceipts');
    expect(sender).toContain('DeviceNotRegistered');
    expect(sender).toContain('actionUrl: notification.action_url');
    expect(sender).toContain('.slice(0, 100)');
  });

  it('does not subscribe to native notification responses on web', () => {
    const notifications = read('mobile/src/lib/push-notifications.ts');
    const webNotifications = read('mobile/src/lib/push-notifications.web.ts');
    expect(notifications).toContain("if (Platform.OS === 'web') return () => undefined;");
    expect(notifications.indexOf("if (Platform.OS === 'web') return () => undefined;"))
      .toBeLessThan(notifications.indexOf('Notifications.addNotificationResponseReceivedListener'));
    expect(webNotifications).not.toContain('expo-notifications');
    expect(webNotifications).toContain('return () => undefined;');
  });
});
