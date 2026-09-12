"use client";

import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  loadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATIONS_CHANGED_EVENT,
} from "@/lib/notifications/client";
import type { NotificationRow, NotificationSeverity } from "@/lib/supabase/types";
import { useRegion } from "@/contexts/region-context";
import { formatDateTime } from "@/lib/international/formatting";

const severityDot: Record<NotificationSeverity, string> = {
  critical: "bg-red-600",
  high: "bg-orange-500",
  medium: "bg-amber-400",
  informational: "bg-blue-500",
  positive: "bg-emerald-500",
};

export function NotificationBell({ mobile = false }: { mobile?: boolean }) {
  const { configuration } = useRegion();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const payload = await loadNotifications(5);
      setItems(payload.notifications);
      setUnreadCount(payload.unreadCount);
    } catch {
      // The bell stays unobtrusive when the session is not ready.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    loadNotifications(5)
      .then((payload) => {
        if (!active) return;
        setItems(payload.notifications);
        setUnreadCount(payload.unreadCount);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onFocus);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onFocus);
    };
  }, [refresh]);

  const markRead = (item: NotificationRow) => {
    if (item.read_at) return;
    const now = new Date().toISOString();
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, read_at: now } : entry));
    setUnreadCount((count) => Math.max(0, count - 1));
    void markNotificationRead(item.id).catch(() => void refresh());
  };

  const markAll = async () => {
    const now = new Date().toISOString();
    setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? now })));
    setUnreadCount(0);
    await markAllNotificationsRead().catch(() => void refresh());
  };

  return (
    <details className="group relative">
      <summary
        aria-label={unreadCount ? `View notifications, ${unreadCount} unread` : "View notifications"}
        className={cn(
          "relative flex cursor-pointer list-none items-center justify-center transition-colors marker:content-none [&::-webkit-details-marker]:hidden",
          mobile ? "h-11 w-11 rounded-full hover:bg-slate-100" : "h-11 w-11 rounded-lg hover:bg-slate-100",
        )}
      >
        <Bell aria-hidden="true" className="h-5 w-5 text-[var(--cb-text-secondary)]" />
        {!loading && unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-4 text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </summary>

      <div className={cn(
        "absolute z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-gray-200 bg-white text-left shadow-xl",
        mobile ? "right-0" : "right-0",
      )}>
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <div>
            <p className="text-sm font-bold text-[#0D1B3D]">Notifications</p>
            <p className="text-[11px] text-gray-500">{unreadCount} unread</p>
          </div>
          {unreadCount > 0 && (
            <button onClick={() => void markAll()} className="flex items-center gap-1 text-[11px] font-semibold text-[#007A52] hover:text-[#009966]">
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {!loading && items.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-gray-500">You&apos;re all caught up.</p>
          )}
          {items.map((item) => (
            <Link
              key={item.id}
              href={item.action_url ?? "/notifications"}
              onClick={() => markRead(item)}
              className={cn(
                "flex gap-3 border-b border-gray-50 px-4 py-3 transition-colors hover:bg-gray-50",
                !item.read_at && "bg-emerald-50/40",
              )}
            >
              <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", severityDot[item.severity])} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold text-gray-900">{item.title}</span>
                <span className="mt-0.5 line-clamp-2 block text-[11px] leading-relaxed text-gray-600">{item.message}</span>
                <span className="mt-1 block text-[10px] text-gray-400">{formatDateTime(item.created_at, configuration.settings)}</span>
              </span>
            </Link>
          ))}
        </div>
        <Link href="/notifications" className="block px-4 py-3 text-center text-xs font-bold text-[#007A52] hover:bg-gray-50">
          View all notifications
        </Link>
      </div>
    </details>
  );
}
