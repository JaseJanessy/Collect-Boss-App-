import { DashboardShell } from "@/components/shells/dashboard-shell";
import { MobileShell } from "@/components/shells/mobile-shell";

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-slate-200/70 motion-reduce:animate-none ${className}`} />;
}

function PageSkeleton({ dashboard = false }: { dashboard?: boolean }) {
  return (
    <div role="status" aria-live="polite" aria-label="Loading" className={dashboard ? "mx-auto flex max-w-7xl flex-col gap-4 pb-10" : "flex flex-col gap-4 px-4 pb-8 pt-5"}>
      <span className="sr-only">Loading…</span>
      <SkeletonBlock className="h-4 w-24" />
      <SkeletonBlock className="h-7 w-56" />
      <div className={dashboard ? "grid grid-cols-4 gap-3" : "grid grid-cols-2 gap-3"}>
        {Array.from({ length: dashboard ? 4 : 2 }, (_, index) => <SkeletonBlock key={index} className="h-20" />)}
      </div>
      {Array.from({ length: 4 }, (_, index) => <SkeletonBlock key={index} className="h-16" />)}
    </div>
  );
}

/** Route-level loading UI that keeps navigation visible while a section loads. */
export function SectionLoading() {
  return (
    <>
      <MobileShell>
        <PageSkeleton />
      </MobileShell>
      <DashboardShell>
        <PageSkeleton dashboard />
      </DashboardShell>
    </>
  );
}
