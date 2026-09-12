import { pocketCssVariables } from "@/lib/brand/pocket-theme";

export default function PocketLoading() {
  return (
    <div className="pocket-root min-h-[100dvh] p-6" role="status" aria-label="Loading CollectBoss Pocket" data-pocket-theme style={pocketCssVariables}>
      <div className="mx-auto max-w-6xl animate-pulse motion-reduce:animate-none">
        <div className="h-7 w-44 rounded-lg bg-[var(--pocket-selected-surface)]" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-36 rounded-3xl bg-white" />)}
        </div>
      </div>
      <span className="sr-only">Loading Pocket</span>
    </div>
  );
}
