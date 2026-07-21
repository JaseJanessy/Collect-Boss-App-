/** External composer links. Opening either link is a handoff, not delivery. */
export function buildWhatsAppLink(phone: string | null, message: string): string {
  if (!phone) return "";
  const cleaned = phone.replace(/\D/g, "");
  const intl = cleaned.startsWith("60") ? cleaned : `60${cleaned.replace(/^0/, "")}`;
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
}

export function buildEmailLink(email: string | null, subject: string, message: string): string {
  if (!email) return "";
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
}
