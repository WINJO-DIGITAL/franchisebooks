import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/** Marks a figure or screen as an illustration. Every preview on the sales page carries one. */
export function ExampleTag({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded border border-line-strong bg-paper px-1.5 py-0.5 text-[0.6875rem] font-medium uppercase tracking-wider text-muted", className)}>
      Example Data
    </span>
  );
}

/** One line of a ledger: the label, a dotted leader, and the figure. Use inside a <dl>. */
export function Leader({ label, value, strong = false, className }: { label: ReactNode; value: ReactNode; strong?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-baseline gap-2", className)}>
      <dt className={cn("min-w-0", strong ? "font-semibold text-ink" : "text-ink-soft")}>{label}</dt>
      <span aria-hidden className="mb-[0.3em] min-w-3 flex-1 self-end border-b border-dotted border-line-strong" />
      <dd className={cn("num shrink-0 text-right", strong ? "font-semibold text-ink" : "font-medium text-ink")}>{value}</dd>
    </div>
  );
}

/** A screen from the app, drawn as an illustration. Always labelled as example data. */
export function Frame({ title, subtitle, children, className, caption = "Illustration with example figures. Not customer data." }: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  caption?: string;
}) {
  return (
    <figure className={cn("overflow-hidden rounded-lg border border-line-strong bg-surface shadow-[0_1px_0_rgb(63_28_8/0.04),0_28px_56px_-28px_rgb(63_28_8/0.32)]", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line bg-sunken/70 px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{title}</p>
          {subtitle ? <p className="truncate text-xs text-muted">{subtitle}</p> : null}
        </div>
        <ExampleTag />
      </div>
      {children}
      <figcaption className="border-t border-line bg-paper/60 px-4 py-2 text-xs text-muted">{caption}</figcaption>
    </figure>
  );
}
