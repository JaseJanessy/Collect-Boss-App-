import * as React from "react";
import { cn } from "@/lib/utils";

type FieldShellProps = {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
};

function FieldShell({ label, htmlFor, hint, error, required, children, className }: FieldShellProps) {
  const helpId = `${htmlFor}-help`;
  const errorId = `${htmlFor}-error`;
  return (
    <div data-slot="field" className={cn("min-w-0", className)}>
      <label htmlFor={htmlFor} className="cb-field-label">
        {label}{required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {error ? <p id={errorId} className="cb-field-error">{error}</p> : hint ? <p id={helpId} className="cb-field-help">{hint}</p> : null}
    </div>
  );
}

type InputFieldProps = Omit<React.ComponentProps<"input">, "id"> & Omit<FieldShellProps, "children" | "htmlFor"> & { id: string };

function InputField({ id, label, hint, error, required, className, ...props }: InputFieldProps) {
  return (
    <FieldShell label={label} htmlFor={id} hint={hint} error={error} required={required}>
      <input
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-help` : undefined}
        className={cn("cb-field", className)}
        {...props}
      />
    </FieldShell>
  );
}

type SelectFieldProps = Omit<React.ComponentProps<"select">, "id"> & Omit<FieldShellProps, "children" | "htmlFor"> & { id: string; children: React.ReactNode };

function SelectField({ id, label, hint, error, required, children, className, ...props }: SelectFieldProps) {
  return (
    <FieldShell label={label} htmlFor={id} hint={hint} error={error} required={required}>
      <select id={id} required={required} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : hint ? `${id}-help` : undefined} className={cn("cb-field", className)} {...props}>
        {children}
      </select>
    </FieldShell>
  );
}

type TextareaFieldProps = Omit<React.ComponentProps<"textarea">, "id"> & Omit<FieldShellProps, "children" | "htmlFor"> & { id: string };

function TextareaField({ id, label, hint, error, required, className, ...props }: TextareaFieldProps) {
  return (
    <FieldShell label={label} htmlFor={id} hint={hint} error={error} required={required}>
      <textarea id={id} required={required} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : hint ? `${id}-help` : undefined} className={cn("cb-field min-h-24 resize-y", className)} {...props} />
    </FieldShell>
  );
}

export { FieldShell, InputField, SelectField, TextareaField };
