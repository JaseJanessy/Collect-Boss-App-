import { CollectBossWordmark } from "@/components/brand/wordmark";

export default function GlobalLoading() {
  return (
    <div className="min-h-screen bg-[#F2F4F7] flex flex-col items-center justify-center gap-4">
      <CollectBossWordmark className="text-2xl" />
      <div aria-label="Loading" role="status" className="size-6 animate-spin rounded-full border-2 border-[var(--cb-action-primary)] border-t-transparent motion-reduce:animate-none" />
    </div>
  );
}
