import { buildWhatsAppLink } from "@/lib/reminders/handoff-links";
import type { CommunicationChannel, CommunicationStatus } from "@/lib/supabase/types";

export interface CommunicationChannelAdapter {
  readonly channel: CommunicationChannel;
  readonly initialStatus: CommunicationStatus;
  buildLaunchUrl(recipient: string, message?: string): string;
}

export const callHandoffAdapter: CommunicationChannelAdapter = {
  channel: "call",
  initialStatus: "initiated",
  buildLaunchUrl(recipient) {
    const normalized = recipient.replace(/[^\d+]/g, "");
    return normalized ? `tel:${normalized}` : "";
  },
};

export const whatsappHandoffAdapter: CommunicationChannelAdapter = {
  channel: "whatsapp",
  initialStatus: "initiated",
  buildLaunchUrl(recipient, message = "") {
    return buildWhatsAppLink(recipient, message);
  },
};

const whatsappStatuses = new Set<CommunicationStatus>([
  "initiated", "sent", "delivered", "read", "replied", "failed",
]);

/**
 * Provider-neutral boundary for a future official WhatsApp Business Platform
 * webhook adapter. Personal WhatsApp handoffs do not call this automatically.
 */
export function normalizeWhatsAppProviderStatus(value: string): CommunicationStatus | null {
  const normalized = value.trim().toLowerCase() as CommunicationStatus;
  return whatsappStatuses.has(normalized) ? normalized : null;
}

