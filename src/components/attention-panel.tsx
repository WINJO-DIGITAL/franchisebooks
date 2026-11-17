import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { Badge, Panel } from "@/components/ui/bits";
import { formatUkDate } from "@/lib/dates";
import { SEVERITY } from "@/lib/labels";

export interface AttentionAlert {
  id: string;
  title: string;
  severity: string;
  subject_date: string;
}

export interface AttentionPanelProps {
  /** Total number of things needing attention (also shown in the bell). */
  total: number;
  dpd?: { tone: string; headline: string } | null;
  flaggedFiles: number;
  reviewCount: number;
  reviewTitle?: string | null;
  /** The few most important alerts. Leave empty on the Alerts page, which lists every alert in full. */
  alerts?: AttentionAlert[];
  alertCount?: number;
}

const row = "flex items-center gap-3 px-4 py-3 hover:bg-sunken/50 sm:px-5";

/** The list of things that need a look. Shown on the Dashboard only when there is something; the all-clear lives on the Alerts page. */
export function AttentionPanel({ total, dpd, flaggedFiles, reviewCount, reviewTitle, alerts = [], alertCount = 0 }: AttentionPanelProps) {
  return (
    <Panel flush>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
        <AlertTriangle className="size-5 shrink-0 text-warn" aria-hidden />
        <h2 className="font-semibold">{total} {total === 1 ? "thing needs" : "things need"} your attention</h2>
      </div>
      <ul>
        {dpd ? (
          <li className="border-b border-line last:border-0">
            <Link href="/data" className={row}>
              <Badge tone={dpd.tone === "bad" ? "bad" : "warn"}>DPD</Badge>
              <span className="flex-1 text-[0.9375rem]">{dpd.headline}</span>
              <ChevronRight className="size-4 text-muted" aria-hidden />
            </Link>
          </li>
        ) : null}
        {flaggedFiles > 0 ? (
          <li className="border-b border-line last:border-0">
            <Link href="/data#attention" className={row}>
              <Badge tone="warn">Import</Badge>
              <span className="flex-1 text-[0.9375rem]">{flaggedFiles === 1 ? "1 imported file needs checking" : `${flaggedFiles} imported files need checking`}</span>
              <ChevronRight className="size-4 text-muted" aria-hidden />
            </Link>
          </li>
        ) : null}
        {reviewCount > 0 ? (
          <li className="border-b border-line last:border-0">
            <Link href="/data#attention" className={row}>
              <Badge tone="warn">Import</Badge>
              <span className="flex-1 text-[0.9375rem]">{reviewCount === 1 ? (reviewTitle ?? "1 report needs checking") : `${reviewCount} reports need checking`}</span>
              <ChevronRight className="size-4 text-muted" aria-hidden />
            </Link>
          </li>
        ) : null}
        {alerts.map((alert) => (
          <li key={alert.id} className="border-b border-line last:border-0">
            <Link href={`/alerts#${alert.id}`} className={row}>
              <Badge tone={SEVERITY[alert.severity]?.tone ?? "warn"}>{formatUkDate(alert.subject_date).slice(0, 5)}</Badge>
              <span className="flex-1 text-[0.9375rem]">{alert.title}</span>
              <ChevronRight className="size-4 text-muted" aria-hidden />
            </Link>
          </li>
        ))}
        {alertCount > alerts.length ? (
          <li>
            <Link href="/alerts" className="block px-4 py-3 text-sm font-medium text-accent hover:bg-sunken/50 sm:px-5">See all {alertCount} alerts</Link>
          </li>
        ) : null}
      </ul>
    </Panel>
  );
}

/** Shown on the Alerts page when nothing at all needs attention. */
export function AllClear() {
  return (
    <Panel className="flex items-center gap-3">
      <CheckCircle2 className="size-6 shrink-0 text-good" aria-hidden />
      <div>
        <p className="font-medium">Everything is up to date.</p>
        <p className="text-sm text-muted">Nothing needs your attention right now.</p>
      </div>
    </Panel>
  );
}
