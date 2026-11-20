import "server-only";
import { londonToday } from "@/lib/dates";
import { dayRateFromRow, readDayRateRows } from "@/lib/data/day-rates";
import { loadAdjustments, loadEarnings, loadWorkedBefore } from "@/lib/data/period";
import { periodLabel, type DpdPeriod } from "@/lib/finance/periods";
import { lookBackDays } from "@/lib/finance/wages";
import { fromDb, toDb } from "@/lib/money";
import type { AdminClient } from "@/lib/supabase/admin";
import type { JsonObject } from "@/lib/supabase/json";
import { buildStatementContent, type StatementBuild, type StatementDriver } from "./build";
import { statementNumber } from "./numbering";
import { renderDriverStatementPdf } from "./pdf";

export interface PlannedStatement {
  driver: StatementDriver;
  /** The driver's number in the business, or null if they have not had a statement yet. */
  driverNo: number | null;
  build: StatementBuild;
}

export interface StatementRunResult {
  made: { driverId: string; name: string; number: string; id: string }[];
  skipped: { driverId: string; name: string; reason: string }[];
}

/**
 * Works out the statement for every driver who worked at a franchise in a period, without saving anything. Drivers who
 * cannot have one (no pay rate) come back with the reason. Used by the Reports page to show what is missing, and by
 * generateDriverStatements to make them.
 */
export async function planDriverStatements(db: AdminClient, input: { accountId: string; franchiseId: string; period: DpdPeriod }): Promise<PlannedStatement[]> {
  const filter = { accountId: input.accountId, franchiseId: input.franchiseId, from: input.period.start, to: input.period.end };
  const [earnings, adjustments, franchise, account] = await Promise.all([
    loadEarnings(db, filter),
    loadAdjustments(db, filter),
    db.from("franchises").select("name, fd_number").eq("id", input.franchiseId).eq("account_id", input.accountId).single(),
    db.from("accounts").select("name").eq("id", input.accountId).single(),
  ]);
  if (franchise.error) throw new Error(`Could not read the franchise: ${franchise.error.message}`);
  const driverIds = [...new Set([...earnings.map((e) => e.driverId), ...adjustments.map((a) => a.driverId)].filter((id): id is string => !!id))];
  if (driverIds.length === 0) return [];
  const [{ data: drivers }, rateRows] = await Promise.all([
    db.from("drivers").select("id, display_name, vat_number, self_billing_agreement, statement_no").eq("account_id", input.accountId).in("id", driverIds),
    readDayRateRows((columns) => db.from("driver_day_rates").select(columns).eq("account_id", input.accountId).in("driver_id", driverIds)),
  ]);
  const dayRates = rateRows.map((r) => dayRateFromRow(r));
  // A run of days in a row can begin in the last period, so read the days just before this one when a rate needs it.
  const workedBefore = await loadWorkedBefore(db, { accountId: input.accountId, from: input.period.start, days: lookBackDays(dayRates), driverIds });
  const issuedOn = londonToday();
  return (drivers ?? [])
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "en-GB"))
    .map((d) => {
      const driver: StatementDriver = { id: d.id, name: d.display_name, vatNumber: d.vat_number, selfBillingAgreement: d.self_billing_agreement };
      return {
        driver,
        driverNo: d.statement_no,
        build: buildStatementContent({
          number: statementNumber(franchise.data.fd_number, input.period, d.statement_no ?? 0),
          period: input.period,
          businessName: account.data?.name ?? "",
          franchise: { name: franchise.data.name, fdNumber: franchise.data.fd_number },
          driver,
          earnings: earnings.filter((e) => e.driverId === d.id),
          adjustments: adjustments.filter((a) => a.driverId === d.id),
          dayRates,
          workedBefore: workedBefore.get(d.id) ?? [],
          issuedOn,
        }),
      };
    });
}

/** The driver's number in the business (D001, D002 ...), given the first time they have a statement and kept for good. */
export async function driverStatementNo(db: AdminClient, accountId: string, driverId: string): Promise<number> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: driver } = await db.from("drivers").select("statement_no").eq("id", driverId).eq("account_id", accountId).single();
    if (driver?.statement_no) return driver.statement_no;
    const { data: top } = await db.from("drivers").select("statement_no").eq("account_id", accountId).not("statement_no", "is", null)
      .order("statement_no", { ascending: false }).limit(1).maybeSingle();
    const next = (top?.statement_no ?? 0) + 1;
    // Only fills an empty number, and the unique index stops two drivers getting the same one: on a clash, try again.
    const { error } = await db.from("drivers").update({ statement_no: next }).eq("id", driverId).eq("account_id", accountId).is("statement_no", null);
    if (error && error.code !== "23505") throw new Error(`Could not number the driver's statements: ${error.message}`);
  }
  throw new Error("Could not number the driver's statements. Please try again.");
}

/**
 * Makes (or makes again) the statement PDF for every driver who worked at a franchise in a DPD pay period and has a pay
 * rate. A statement made again keeps its number and replaces the file. Drivers without a pay rate are skipped, with why.
 */
export async function generateDriverStatements(
  db: AdminClient,
  input: { accountId: string; franchiseId: string; period: DpdPeriod; trigger: "auto" | "manual"; userId?: string | null; driverId?: string },
): Promise<StatementRunResult> {
  const result: StatementRunResult = { made: [], skipped: [] };
  const planned = (await planDriverStatements(db, input)).filter((p) => !input.driverId || p.driver.id === input.driverId);
  for (const plan of planned) {
    if (!plan.build.ok) {
      result.skipped.push({ driverId: plan.driver.id, name: plan.driver.name, reason: plan.build.reason });
      continue;
    }
    const driverNo = plan.driverNo ?? (await driverStatementNo(db, input.accountId, plan.driver.id));
    const content = { ...plan.build.content, number: statementNumber(plan.build.content.franchise.fdNumber, input.period, driverNo) };
    const pdf = await renderDriverStatementPdf(content);
    const storagePath = `${input.accountId}/statements/${input.period.start}/${content.number}.pdf`;
    const upload = await db.storage.from("reports").upload(storagePath, pdf, { contentType: "application/pdf", upsert: true });
    if (upload.error) throw new Error(`Could not store the statement: ${upload.error.message}`);
    const totals = {
      driverName: content.driver.name,
      days: content.rows.length,
      dayPay: toDb(content.dayPay),
      adjustments: toDb(content.adjustmentsNet),
      total: toDb(content.total),
      vat: content.vat ? toDb(content.vat.amount) : null,
      totalPayable: toDb(content.totalPayable),
    };
    const { data, error } = await db.from("driver_statements").upsert({
      account_id: input.accountId, franchise_id: input.franchiseId, driver_id: plan.driver.id,
      period_start: input.period.start, period_end: input.period.end, statement_no: content.number, title: content.title,
      storage_path: storagePath, totals: totals as JsonObject, trigger: input.trigger, generated_by: input.userId ?? null,
      generated_at: new Date().toISOString(),
    }, { onConflict: "account_id,statement_no" }).select("id").single();
    if (error) throw new Error(`Could not record the statement: ${error.message}`);
    result.made.push({ driverId: plan.driver.id, name: plan.driver.name, number: content.number, id: data.id });
  }
  return result;
}

/** Plain summary of a statement run, for the job message. */
export function statementRunSummary(result: StatementRunResult, period: DpdPeriod): string {
  const made = `${result.made.length} driver statement${result.made.length === 1 ? "" : "s"} made for ${periodLabel(period)}`;
  if (result.skipped.length === 0) return `${made}.`;
  return `${made}; ${result.skipped.length} not made: ${result.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}`;
}
