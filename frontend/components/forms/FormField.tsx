// frontend/components/forms/FormField.tsx
"use client";
import * as React from "react";
import { cn } from "../../lib/utils";

type FormFieldProps = {
  label: string;
  htmlFor: string;
  helpText?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
};

export default function FormField({
  label,
  htmlFor,
  helpText,
  error,
  className,
  children,
}: FormFieldProps) {
  const describedBy = error
    ? `${htmlFor}-error`
    : helpText
    ? `${htmlFor}-help`
    : undefined;

  return (
    <div className={cn("space-y-2", className)}>
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-foreground"
      >
        {label}
      </label>

      <div aria-describedby={describedBy}>{children}</div>

      {helpText && !error && (
        <p id={`${htmlFor}-help`} className="text-xs text-muted">
          {helpText}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} className="text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}
