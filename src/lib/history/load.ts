import "server-only";
import type { AppContext } from "@/lib/context";
import { fetchAll } from "@/lib/data/fetch-all";
import { loadEarnings, type EarningDetail } from "@/lib/data/period";
import { buildCoverage, type Coverage } from "./coverage";
import type { InsightDay } from "./insights";
import { historyPeriods, historyWindow, type HistoryPeriod, type HistoryWindow } from "./window";

export interface InsightsData {
  window: HistoryWindow;
  /** Newest first. */
  periods: HistoryPeriod[];
  franchiseIds: string[];
  earnings: EarningDetail[];
  days: InsightDay[];
  coverage: Coverage;
}

/** DPD payments and read records over the Max history window, for the franchises in view. */
export async function loadInsights(ctx: AppContext): Promise<InsightsData> {
  const window = historyWindow(ctx.today);
  const periods = historyPeriods(ctx.today);
  const from = periods[periods.length - 1]!.start;
  const franchiseIds = (ctx.franchise ? [ctx.franchise] : ctx.franchises.filter((f) => f.isActive)).map((f) => f.id);

  const [earnings, jobs] = await Promise.all([
    loadEarnings(ctx.supabase, { accountId: ctx.accountId, from, to: ctx.today, franchiseId: ctx.franchiseId, hiddenFranchiseIds: ctx.hiddenFranchiseIds }),
    fetchAll(() =>
      ctx.supabase.from("import_jobs").select("id, franchise_id, report_date, status, result")
        .eq("account_id", ctx.accountId).eq("job_type", "dpd_sync").gte("report_date", from).order("id"),
    ),
  ]);
  // A period with payments in it has been read, however they arrived (a DPD read, or a document imported before reads were
  // recorded), so those count too.
  const coverage = buildCoverage([
    ...jobs.map((j) => ({ franchiseId: j.franchise_id, reportDate: j.report_date, status: j.status, result: j.result })),
    ...earnings.map((e) => ({ franchiseId: e.franchiseId, reportDate: e.date, status: "succeeded", result: null })),
  ]);
  const days: InsightDay[] = earnings.map((e) => ({
    franchiseId: e.franchiseId, driverId: e.driverId, driverKey: e.driverKey, date: e.date, stops: e.stops, parcels: e.parcels, gross: e.gross,
  }));
  return { window, periods, franchiseIds, earnings, days, coverage };
}
