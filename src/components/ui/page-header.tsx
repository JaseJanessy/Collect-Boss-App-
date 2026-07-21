"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  back?: boolean;
  onBack?: () => void;
  right?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  back,
  onBack,
  right,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-100 px-4 py-3",
        className
      )}
    >
        <div className="flex items-start gap-2">
        {back && (
          <button
            onClick={onBack}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-gray-900 break-words">{title}</h1>
          {subtitle && (
            <p className="text-xs text-gray-400 break-words">{subtitle}</p>
          )}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
    </div>
  );
}
