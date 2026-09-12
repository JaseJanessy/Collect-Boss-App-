import { AlertTriangle, Clock3, ServerCrash } from "lucide-react";
import type { PublicAccessState } from "@/lib/public-access/types";
import { CollectBossWordmark } from "@/components/brand/wordmark";

export function PublicAccessStatusPage({ state, action }: { state: Exclude<PublicAccessState, "valid">; action: "payment" | "acknowledgement" }) {
  const content = state === "invalid"
    ? { title: `Invalid ${action} link`, message: "This link cannot be used. Please check the link or contact the creditor.", icon: <AlertTriangle className="h-12 w-12 text-amber-500" /> }
    : state === "expired" || state === "used"
      ? { title: `${action === "payment" ? "Payment" : "Acknowledgement"} link expired`, message: "This link is no longer active. Please ask the creditor for a new link.", icon: <Clock3 className="h-12 w-12 text-amber-500" /> }
      : { title: "Service temporarily unavailable", message: "Please try again shortly. No payment or acknowledgement has been recorded.", icon: <ServerCrash className="h-12 w-12 text-red-500" /> };

  return (
    <main className="min-h-screen bg-[#F2F4F7] px-4 py-8">
      <section className="mx-auto max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
        <CollectBossWordmark />
        <div className="mt-10 flex justify-center">{content.icon}</div>
        <h1 className="mt-4 text-xl font-black text-[#0D1B3D]">{content.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-500">{content.message}</p>
      </section>
    </main>
  );
}
