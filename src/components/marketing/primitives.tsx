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

/** A band of the page: a small folio label in the margin, and the content beside it. */
export function Band({ id, folio, label, tone = "paper", children }: { id: string; folio: string; label: string; tone?: "paper" | "surface" | "sunken"; children: ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(
        "scroll-mt-20",
        tone === "surface" && "border-y border-line bg-surface",
        tone === "sunken" && "border-y border-line bg-sunken/70",
      )}
    >
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 sm:py-20 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-14 lg:py-24">
        <p className="flex items-baseline gap-3 self-start border-t border-ink/70 pt-3 text-xs font-medium uppercase tracking-[0.14em] text-ink-soft lg:sticky lg:top-24">
          <span className="num text-accent">{folio}</span>
          {label}
        </p>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}

export function BandHeading({ id, children, intro }: { id: string; children: ReactNode; intro?: ReactNode }) {
  return (
    <div className="max-w-3xl">
      <h2 id={`${id}-title`} className="text-balance text-[1.875rem] font-semibold leading-[1.12] tracking-[-0.02em] sm:text-4xl">{children}</h2>
      {intro ? <p className="mt-4 max-w-2xl text-pretty text-[1.0625rem] leading-relaxed text-ink-soft sm:text-lg">{intro}</p> : null}
    </div>
  );
}
