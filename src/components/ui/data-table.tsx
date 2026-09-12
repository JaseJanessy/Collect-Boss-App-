import * as React from "react";
import { cn } from "@/lib/utils";

function DataTableContainer({ className, label, children }: React.ComponentProps<"div"> & { label?: string }) {
  return (
    <div data-slot="data-table-container" role="region" aria-label={label} tabIndex={0} className={cn("cb-table-wrap focus-visible:ring-3 focus-visible:ring-ring/50", className)}>
      {children}
    </div>
  );
}

function DataTable({ className, ...props }: React.ComponentProps<"table">) {
  return <table data-slot="data-table" className={cn("cb-table", className)} {...props} />;
}

export { DataTable, DataTableContainer };
