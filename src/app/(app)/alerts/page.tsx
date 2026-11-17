import type { Metadata } from "next";
import Link from "next/link";
import { AlertStatusForm } from "@/components/alerts/status-form";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui/bits";
import { cn } from "@/components/ui/cn";
import { franchiseLabel, getContext } from "@/lib/context";
import { formatUkDateLong, formatUkDateTime } from "@/lib/dates";
import { ANOMALY_STATUS, SEVERITY } from "@/lib/labels";

export const metadata: Metadata = { title: "Alerts" };

const VIEWS = [
  { key: "open", label: "Needs attention", statuses: ["open", "investigating"] },
  { key: "done", label: "Dealt with", statuses: ["resolved", "expected", "ignored"] },
] as const;

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const view = VIEWS.find((v) => v.key === params.view) ?? VIEWS[0];

  let query = ctx.supabase
    .from("anomalies")
    .select("id, anomaly_type, severity, subject_date, title, what_happened, actual_value, expected_value, why_flagged, suggested_action, status, status_note, status_changed_at, auto_resolved, franchise_id, driver_id, detected_at")
    .in("status", [...view.statuses])
    .order("subject_date", { ascending: false })
    .order("detected_at", { ascending: false })
    .limit(100);
  if (ctx.franchiseId) query = query.eq("franchise_id", ctx.franchiseId);
  const { data: alerts } = await query;
  const { data: driverRows } = await ctx.supabase.from("drivers").select("id, display_name");
  const driverName = new Map((driverRows ?? []).map((d) => [d.id, d.display_name]));
  const franchiseName = new Map(ctx.franchises.map((f) => [f.id, franchiseLabel(f)]));
  const order = { urgent: 0, attention: 1, info: 2 } as Record<string, number>;
  const list = [...(alerts ?? [])].sort((a, b) => (view.key === "open" ? (order[a.severity] ?? 1) - (order[b.severity] ?? 1) : 0) || b.subject_date.localeCompare(a.subject_date));

  return (
    <>
      <PageHeader title="Alerts" description="Things the system thinks you may want to look at. An alert never changes any figure — it only asks you to check." />
      <nav aria-label="View" className="mb-5 flex gap-1.5">
        {VIEWS.map((v) => (
          <Link key={v.key} href={`/alerts?view=${v.key}`} aria-current={view.key === v.key ? "page" : undefined}
            className={cn("rounded-full px-3.5 py-1.5 text-sm font-medium", view.key === v.key ? "bg-ink text-white" : "border border-line-strong bg-surface text-ink-soft hover:bg-sunken")}>
            {v.label}
          </Link>
        ))}
      </nav>

      {list.length === 0 ? (
        <EmptyState title={view.key === "open" ? "Nothing needs your attention" : "No alerts have been dealt with yet"}>
          {view.key === "open" ? "When something looks unusual — a missing report, an odd figure, a possible duplicate — it will appear here with an explanation." : null}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {list.map((alert) => (
            <li key={alert.id} id={alert.id} className="scroll-mt-20">
              <Panel>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={SEVERITY[alert.severity]?.tone ?? "warn"}>{SEVERITY[alert.severity]?.label ?? alert.severity}</Badge>
                  <Badge tone={ANOMALY_STATUS[alert.status]?.tone ?? "neutral"}>{ANOMALY_STATUS[alert.status]?.label ?? alert.status}</Badge>
                  <span className="text-sm text-muted">{formatUkDateLong(alert.subject_date)}</span>
                </div>
                <h2 className="mt-2 text-lg font-semibold leading-snug">{alert.title}</h2>
                <p className="mt-1 text-sm text-muted">
                  {alert.franchise_id ? franchiseName.get(alert.franchise_id) : "All franchises"}
                  {alert.driver_id ? <> · <Link href={`/drivers/${alert.driver_id}`} className="text-accent hover:underline">{driverName.get(alert.driver_id) ?? "Driver"}</Link></> : null}
                </p>

                <dl className="mt-4 grid gap-x-8 gap-y-3 text-[0.9375rem] sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted">What happened</dt>
                    <dd className="mt-0.5">{alert.what_happened}</dd>
                  </div>
                  {alert.actual_value ? (
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted">Actual figure</dt>
                      <dd className="num mt-0.5 text-lg font-semibold">{alert.actual_value}</dd>
                    </div>
                  ) : null}
                  {alert.expected_value ? (
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted">Normal comparison</dt>
                      <dd className="num mt-0.5">{alert.expected_value}</dd>
                    </div>
                  ) : null}
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted">Why it was flagged</dt>
                    <dd className="mt-0.5">{alert.why_flagged}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted">What you might do</dt>
                    <dd className="mt-0.5">{alert.suggested_action}</dd>
                  </div>
                </dl>
                {alert.status_note || alert.status_changed_at ? (
                  <p className="mt-3 text-sm text-muted">
                    {alert.auto_resolved ? "Closed automatically" : "Updated"} {formatUkDateTime(alert.status_changed_at)}{alert.status_note ? ` — ${alert.status_note}` : ""}
                  </p>
                ) : null}
                {ctx.canWrite ? <AlertStatusForm id={alert.id} current={alert.status} /> : null}
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
