import type { Metadata } from "next";
import { PeriodChart } from "@/components/insights/period-chart";
import { InsightsTabs, ScopeBadge, UpgradeToMax } from "@/components/insights/shell";
import { PageHeader, Panel, Section, Stat, TableWrap } from "@/components/ui/bits";
import { currentPlan } from "@/lib/billing/plan";
import { franchiseLabel, getContext } from "@/lib/context";
import { formatUkDate } from "@/lib/dates";
import { periodLabel } from "@/lib/finance/periods";
import { lastYear, summarisePeriods, type PeriodSummary } from "@/lib/history/insights";
import { loadInsights } from "@/lib/history/load";
import { taxYearLabel } from "@/lib/history/window";
import { formatGBP, percentChange } from "@/lib/money";

export const metadata: Metadata = { title: "Insights" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortLabel = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(2, 4)}`;

function change(now: PeriodSummary, before: PeriodSummary | null): number | null {
  if (!now.figures || !before?.figures) return null;
  return percentChange(before.figures.income, now.figures.income);
}

export default async function InsightsPage() {
  const ctx = await getContext();
  const scope = ctx.franchise ? franchiseLabel(ctx.franchise) : "All franchises";
  const plan = await currentPlan(ctx.supabase);

  if (plan !== "max") {
    return (
      <>
        <PageHeader title="Insights" description="Your DPD figures over the current and previous tax year." />
        <InsightsTabs active="/insights" />
        <UpgradeToMax isOwner={ctx.isOwner} />
      </>
    );
  }

  const data = await loadInsights(ctx);
  const summaries = summarisePeriods(data.days, data.periods, data.coverage, data.franchiseIds);
  const oldestFirst = [...summaries].reverse();
  // The latest period that has finished and been read, for the figures at the top.
  const latest = summaries.find((s) => !s.period.current && s.figures) ?? null;
  const latestLastYear = latest ? lastYear(summaries, latest.period) : null;
  const unread = summaries.filter((s) => !s.figures && s.status !== "not_listed").length;

  return (
    <>
      <PageHeader
        title="Insights"
        description={`${scope} · DPD figures from ${formatUkDate(data.window.start)} (tax years ${taxYearLabel(data.window.start)} and ${taxYearLabel(data.window.end)}) to today.`}
      />
      <InsightsTabs active="/insights" />

      {unread > 0 ? (
        <p className="mb-4 rounded-lg border border-line bg-sunken px-4 py-3 text-sm text-ink-soft">
          {unread} period{unread === 1 ? " has" : "s have"} not been read from DPD yet. Max reads a few past periods each night, newest first, so the history fills in over the next few nights.
        </p>
      ) : null}

      {latest?.figures ? (
        <Section title={`Last Finished Period: ${periodLabel(latest.period)}`}>
          <Panel>
            <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
              <Stat size="lg" label="DPD income" value={formatGBP(latest.figures.income)} sub={latestLastYear?.figures ? `${formatGBP(latestLastYear.figures.income)} the same period last year` : "No figures for the same period last year"} />
              <Stat label="Change on last year" value={(() => { const c = change(latest, latestLastYear); return c == null ? "—" : `${c > 0 ? "+" : ""}${c}%`; })()} />
              <Stat label="Income per stop" value={formatGBP(latest.figures.perStop)} sub={`${latest.figures.stops.toLocaleString("en-GB")} stops`} />
              <Stat label="Income per parcel" value={formatGBP(latest.figures.perParcel)} sub={`${latest.figures.parcels.toLocaleString("en-GB")} parcels`} />
            </div>
          </Panel>
        </Section>
      ) : null}

      <Section title="DPD Income by Period" description="What DPD paid in each finished four-week period; the one in progress is in the table below. A grey dot marks a period that has not been read yet, which is not the same as nothing being paid.">
        <Panel>
          <PeriodChart
            title="DPD Income by Four-Week Period"
            highlightKey={latest?.period.start}
            bars={oldestFirst.filter((s) => !s.period.current).map((s) => ({
              key: s.period.start,
              label: shortLabel(s.period.start),
              value: s.figures?.income ?? null,
              description: `${periodLabel(s.period)}: ${s.figures ? formatGBP(s.figures.income) : "not read yet"}`,
            }))}
          />
        </Panel>
      </Section>

      <Section title="Every Period" description="Newest first. Income per stop and per parcel are DPD's income divided by its own stop and parcel counts.">
        <TableWrap>
          <table className="ledger">
            <thead>
              <tr>
                <th>Period</th><th>Tax Year</th><th>Status</th><th className="r">Days Paid</th><th className="r">Stops</th><th className="r hidden sm:table-cell">Parcels</th>
                <th className="r">DPD Income</th><th className="r hidden md:table-cell">Per Stop</th><th className="r hidden md:table-cell">Per Parcel</th>
                <th className="r hidden sm:table-cell">Same Period Last Year</th><th className="r hidden sm:table-cell">Change</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((s) => {
                const before = lastYear(summaries, s.period);
                const c = change(s, before);
                return (
                  <tr key={s.period.start}>
                    <td className="num whitespace-nowrap">
                      {periodLabel(s.period)}
                      {s.period.current ? <span className="block text-xs text-muted">In progress</span> : null}
                      {s.period.startsBeforeWindow ? <span className="block text-xs text-muted">Starts before 6 April</span> : null}
                    </td>
                    <td className="num whitespace-nowrap">{taxYearLabel(s.period.start < data.window.start ? data.window.start : s.period.start)}</td>
                    <td><ScopeBadge status={s.status} /></td>
                    <td className="r num">{s.figures ? s.figures.daysWithPayments : "—"}</td>
                    <td className="r num">{s.figures ? s.figures.stops.toLocaleString("en-GB") : "—"}</td>
                    <td className="r num hidden sm:table-cell">{s.figures ? s.figures.parcels.toLocaleString("en-GB") : "—"}</td>
                    <td className="r num font-medium">{s.figures ? formatGBP(s.figures.income) : "—"}</td>
                    <td className="r num hidden md:table-cell">{s.figures ? formatGBP(s.figures.perStop) : "—"}</td>
                    <td className="r num hidden md:table-cell">{s.figures ? formatGBP(s.figures.perParcel) : "—"}</td>
                    <td className="r num hidden sm:table-cell">{before?.figures ? formatGBP(before.figures.income) : "—"}</td>
                    <td className="r num hidden sm:table-cell">{c == null ? "—" : `${c > 0 ? "+" : ""}${c}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Section>
    </>
  );
}
