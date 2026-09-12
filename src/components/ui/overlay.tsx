"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function ModalSurface({ open, onOpenChange, title, description, children, footer, variant = "dialog" }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  variant?: "dialog" | "drawer";
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();
  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => { event.preventDefault(); onOpenChange(false); }}
      onClose={() => onOpenChange(false)}
      className={cn("m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-[var(--shadow-overlay)] backdrop:bg-slate-950/60", variant === "drawer" && "mb-0 mr-0 h-dvh max-h-dvh max-w-md rounded-none sm:rounded-l-2xl")}
    >
      <header className="sticky top-0 flex items-start gap-3 border-b border-slate-200 bg-white p-5">
        <div className="min-w-0 flex-1"><h2 id={titleId} className="text-lg font-bold">{title}</h2>{description ? <p id={descriptionId} className="mt-1 text-sm text-slate-600">{description}</p> : null}</div>
        <Button variant="ghost" size="icon" aria-label={`Close ${title}`} onClick={() => onOpenChange(false)}><X /></Button>
      </header>
      <div className="p-5">{children}</div>
      {footer ? <footer className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white p-4">{footer}</footer> : null}
    </dialog>
  );
}

function Dialog(props: Omit<React.ComponentProps<typeof ModalSurface>, "variant">) { return <ModalSurface {...props} variant="dialog" />; }
function Drawer(props: Omit<React.ComponentProps<typeof ModalSurface>, "variant">) { return <ModalSurface {...props} variant="drawer" />; }

export { Dialog, Drawer };
