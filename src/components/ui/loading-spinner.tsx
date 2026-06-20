import { cn } from "@/lib/utils";

export function LoadingSpinner({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center justify-center py-12", className)}>
      <div className="flex flex-col items-center gap-3">
        <span className="text-lg font-black text-[#0D1B3D]">
          Collect<span className="text-[#009966]">Boss</span>
        </span>
        <div className="w-5 h-5 border-2 border-[#009966] border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  );
}

export function InlineSpinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin",
        className
      )}
    />
  );
}
