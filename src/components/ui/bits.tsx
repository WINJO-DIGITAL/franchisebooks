import type { ReactNode } from "react";
import { cn } from "./cn";

export type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "accent";

const toneClass: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-soft",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info",
  accent: "bg-accent-soft text-accent",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", toneClass[tone], className)}>{children}</span>;
}

/** `inline` keeps the actions on the title's row, top right, even on a phone (for a single compact control such as an Add menu). */
export function PageHeader({ title, description, actions, inline = false }: { title: string; description?: ReactNode; actions?: ReactNode; inline?: boolean }) {
  return (
    <header className={cn("mb-6 flex gap-4 sm:mb-8", inline ? "items-start justify-between" : "flex-col sm:flex-row sm:items-end sm:justify-between")}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[1.75rem]">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-[0.9375rem] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className={cn("no-print flex flex-wrap gap-2", inline && "shrink-0")}>{actions}</div> : null}
    </header>
  );
}

export function Section({ title, description, actions, children, className, id }: { title?: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("mb-8", className)}>
      {title ? (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="no-print flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Panel({ children, className, flush }: { children: ReactNode; className?: string; flush?: boolean }) {
  return <div className={cn("rounded-[var(--radius-card)] border border-line bg-surface", !flush && "p-4 sm:p-5", className)}>{children}</div>;
}

/** Horizontal scroll container so wide tables never break the mobile layout. */
export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <Panel flush className="overflow-hidden">
      <div className="overflow-x-auto">{children}</div>
    </Panel>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Panel className="py-10 text-center">
      <p className="font-medium text-ink">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </Panel>
  );
}

const noticeTone: Record<Exclude<Tone, "neutral" | "accent">, string> = {
  good: "border-good/30 bg-good-soft text-good",
  warn: "border-warn/30 bg-warn-soft text-warn",
  bad: "border-bad/30 bg-bad-soft text-bad",
  info: "border-info/30 bg-info-soft text-info",
};

/** A plain-English status message, with optional expandable technical detail. */
export function Notice({ tone = "info", title, children, detail, className }: { tone?: "good" | "warn" | "bad" | "info"; title?: string; children?: ReactNode; detail?: string | null; className?: string }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cn("rounded-lg border px-4 py-3 text-[0.9375rem]", noticeTone[tone], className)}>
      {title ? <p className="font-medium">{title}</p> : null}
      {children ? <div className={cn(title && "mt-0.5", "text-ink-soft")}>{children}</div> : null}
      {detail ? (
        <details className="mt-2 text-sm text-ink-soft">
          <summary className="cursor-pointer select-none text-muted">Technical details</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-surface/70 p-2 font-mono text-xs">{detail}</pre>
        </details>
      ) : null}
    </div>
  );
}

/** A labelled figure. `status` adds the estimated / confirmed label the finance rules require. */
export function Stat({ label, value, sub, size = "md", tone, status }: { label: string; value: ReactNode; sub?: ReactNode; size?: "md" | "lg"; tone?: "good" | "bad"; status?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-2 text-sm text-muted">
        <span>{label}</span>
        {status}
      </p>
      <p className={cn("num mt-1 font-semibold tracking-tight", size === "lg" ? "text-[2rem] leading-none sm:text-[2.5rem]" : "text-2xl leading-tight", tone === "good" && "text-good", tone === "bad" && "text-bad")}>{value}</p>
      {sub ? <p className="mt-1 text-sm text-muted">{sub}</p> : null}
    </div>
  );
}

export function DefinitionList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
      {items.map(([term, value]) => (
        <div key={term} className="flex justify-between gap-4 border-b border-line pb-2 sm:block sm:border-0 sm:pb-0">
          <dt className="text-sm text-muted">{term}</dt>
          <dd className="text-[0.9375rem] text-ink sm:mt-0.5">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
