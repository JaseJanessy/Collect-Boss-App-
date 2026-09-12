import * as React from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

function ToastRegion({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div aria-label="Notifications" className={cn("pointer-events-none fixed inset-x-4 top-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:w-96", className)}>{children}</div>;
}

function Toast({ title, description, tone = "info" }: { title: string; description?: string; tone?: "info" | "success" | "error" }) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "error" ? AlertCircle : Info;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("pointer-events-auto flex w-full gap-3 rounded-xl border bg-white p-4 text-slate-900 shadow-lg", tone === "success" && "border-emerald-300", tone === "error" && "border-red-300", tone === "info" && "border-blue-300")}>
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" /><div><p className="text-sm font-bold">{title}</p>{description ? <p className="mt-1 text-xs text-slate-600">{description}</p> : null}</div>
    </div>
  );
}

export { Toast, ToastRegion };
