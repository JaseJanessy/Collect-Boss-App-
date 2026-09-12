"use client";

import Link from "next/link";
import { Archive, Bell, Check, CheckCheck, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  archiveNotification,
  loadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications/client";
import type { NotificationRow, NotificationSeverity } from "@/lib/supabase/types";
import { useRegion } from "@/contexts/region-context";
import { formatDateTime } from "@/lib/international/formatting";

const severityStyle: Record<NotificationSeverity, string> = {
  critical: "border-red-200 bg-red-50 text-red-700",
  high: "border-orange-200 bg-orange-50 text-orange-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  informational: "border-blue-200 bg-blue-50 text-blue-700",
  positive: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const severityLabel: Record<NotificationSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  informational: "Informational",
  positive: "Positive",
};

export function NotificationsPage({ dashboard = false }: { dashboard?: boolean }) {
  const { configuration } = useRegion();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const payload = await loadNotifications(100);
      setItems(payload.notifications);
      setUnreadCount(payload.unreadCount);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load notifications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    loadNotifications(100)
      .then((payload) => {
        if (!active) return;
        setItems(payload.notifications);
        setUnreadCount(payload.unreadCount);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Unable to load notifications.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  const markRead = async (item: NotificationRow) => {
    if (item.read_at) return;
    const now = new Date().toISOString();
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, read_at: now } : entry));
    setUnreadCount((count) => Math.max(0, count - 1));
    await markNotificationRead(item.id).catch(() => void refresh());
  };

  const markAll = async () => {
    const now = new Date().toISOString();
    setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? now })));
    setUnreadCount(0);
    await markAllNotificationsRead().catch(() => void refresh());
  };

  const archive = async (item: NotificationRow) => {
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    if (!item.read_at) setUnreadCount((count) => Math.max(0, count - 1));
    await archiveNotification(item.id).catch(() => void refresh());
  };

  return (
    <div className={cn("flex flex-col pb-8", !dashboard && "bg-gray-50")}>
      <div className={cn(
        "flex items-start justify-between gap-4",
        dashboard ? "mb-5" : "border-b border-gray-100 bg-white px-4 py-4",
      )}>
        <div>
          <h1 className={cn("font-bold text-[#0D1B3D]", dashboard ? "text-xl" : "text-lg")}>Notifications</h1>
          <p className="mt-0.5 text-xs text-gray-500">{unreadCount} unread notification{unreadCount === 1 ? "" : "s"}</p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={() => void markAll()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-[#007A52] hover:bg-emerald-100"
          >
            <CheckCheck className="h-4 w-4" />
            Mark all read
          </button>
        )}
      </div>

      <div className={cn("flex flex-col gap-3", dashboard ? "" : "px-4 pt-4")}>
        {loading && <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center text-sm text-gray-500">Loading notifications…</div>}
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error} <button onClick={() => void refresh()} className="font-bold underline">Try again</button>
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center">
            <Bell className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-3 text-sm font-bold text-gray-700">You&apos;re all caught up</p>
            <p className="mt-1 text-xs text-gray-500">New recovery and payment updates will appear here.</p>
          </div>
        )}

        {items.map((item) => (
          <article
            key={item.id}
            className={cn(
              "rounded-2xl border bg-white p-4 shadow-sm",
              item.read_at ? "border-gray-100" : "border-emerald-200 ring-1 ring-emerald-100",
            )}
          >
            <div className="flex items-start gap-3">
              <span className={cn("mt-0.5 rounded-full border px-2 py-1 text-[10px] font-bold", severityStyle[item.severity])}>
                {severityLabel[item.severity]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold text-gray-900">{item.title}</h2>
                    <p className="mt-1 text-xs leading-relaxed text-gray-600">{item.message}</p>
                    <p className="mt-2 text-[10px] text-gray-400">{formatDateTime(item.created_at, configuration.settings)}</p>
                  </div>
                  {!item.read_at && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[#009966]" aria-label="Unread" />}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {item.action_url && (
                    <Link
                      href={item.action_url}
                      onClick={() => void markRead(item)}
                      className="flex items-center gap-1.5 rounded-lg bg-[#009966] px-3 py-2 text-xs font-bold text-white hover:bg-[#007A52]"
                    >
                      Open
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  )}
                  {!item.read_at && (
                    <button onClick={() => void markRead(item)} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50">
                      <Check className="h-3.5 w-3.5" />
                      Mark read
                    </button>
                  )}
                  <button onClick={() => void archive(item)} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-500 hover:bg-gray-50">
                    <Archive className="h-3.5 w-3.5" />
                    Archive
                  </button>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
