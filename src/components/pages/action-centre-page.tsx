import { ActionCentrePanel } from "@/components/action-centre/action-centre-panel";

export function ActionCentrePage({ dashboard = false }: { dashboard?: boolean }) {
  return (
    <div className={dashboard ? "cb-analytics-light mx-auto max-w-5xl pb-8 text-slate-900" : "cb-light-surface bg-gray-50 px-4 py-4 pb-8"}>
      <ActionCentrePanel allowHistory />
    </div>
  );
}
