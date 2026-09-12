import type { NotificationRow } from "@/lib/supabase/types";
import { requestJson } from "@/lib/data/http-service";

export const NOTIFICATIONS_CHANGED_EVENT = "collectboss:notifications-changed";

export interface NotificationsPayload {
  notifications: NotificationRow[];
  unreadCount: number;
}

export async function loadNotifications(limit = 20): Promise<NotificationsPayload> {
  return requestJson<NotificationsPayload>(
    `/api/notifications?limit=${limit}`,
    { cache: "no-store" },
    "Notification request failed.",
  );
}

export async function markNotificationRead(notificationId: string) {
  await requestJson<{ notification: NotificationRow }>(`/api/notifications/${encodeURIComponent(notificationId)}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "mark_read" }),
  }, "Notification request failed.");
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}

export async function archiveNotification(notificationId: string) {
  await requestJson<{ notification: NotificationRow }>(`/api/notifications/${encodeURIComponent(notificationId)}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "archive" }),
  }, "Notification request failed.");
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}

export async function markAllNotificationsRead() {
  await requestJson<{ updated: number; unreadCount: number }>("/api/notifications", {
    method: "POST",
    body: JSON.stringify({ action: "mark_all_read" }),
  }, "Notification request failed.");
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}
