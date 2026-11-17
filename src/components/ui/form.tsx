import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

const control =
  "block w-full rounded-lg border border-line-strong bg-surface px-3 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:bg-sunken";

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  // The hint and the error sit outside the <label> so they do not become part of the
  // field's accessible name ("New password", not "New password Use at least 10 characters.").
  return (
    <div className={cn("block", className)}>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
        {children}
      </label>
      {hint && !error ? <span className="mt-1.5 block text-sm text-muted">{hint}</span> : null}
      {error ? <span className="mt-1.5 block text-sm text-bad" role="alert">{error}</span> : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-11", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(control, "h-11 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%228%22 viewBox=%220 0 12 8%22><path d=%22M1 1.5l5 5 5-5%22 fill=%22none%22 stroke=%22%2366707c%22 stroke-width=%221.6%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/></svg>')] bg-[length:12px_8px] bg-[right_0.875rem_center] bg-no-repeat pr-9", className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24 py-2.5", className)} {...props} />;
}

/** Large tappable radio option used in guided flows. */
export function ChoiceCard({ title, description, className, ...props }: ComponentProps<"input"> & { title: string; description?: string }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border border-line-strong bg-surface p-4 has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40", className)}>
      <input type="radio" className="mt-1 size-4 accent-[var(--color-accent)]" {...props} />
      <span>
        <span className="block font-medium text-ink">{title}</span>
        {description ? <span className="mt-0.5 block text-sm text-muted">{description}</span> : null}
      </span>
    </label>
  );
}
