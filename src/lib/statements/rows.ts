import { getContext } from "@/lib/context";
import { type DpdPeriod } from "@/lib/finance/periods";
import { planDriverStatements } from "@/lib/statements/generate";
import { createAdminClient } from "@/lib/supabase/admin";
import { fromDb, sumPence, type Pence } from "@/lib/money";

export interface StatementRow {
  driverId: string;
  franchiseId: string;
  name: string;
  id: string | null;
  number: string | null;
  title: string | null;
  total: number | null;
  emailedAt: string | null;
  reason: string | null;
}

/** Each driver who worked in the period, with their stored statement or why there is none. */
export async function loadStatementRows(ctx: Awaited<ReturnType<typeof getContext>>, period: DpdPeriod): Promise<{ rows: StatementRow[]; manyFranchises: boolean }> {
  const targets = ctx.franchiseId ? ctx.franchises.filter((f) => f.id === ctx.franchiseId) : ctx.franchises.filter((f) => f.isActive);
  const { data: stored } = await ctx.supabase.from("driver_statements").select("id, driver_id, franchise_id, statement_no, title, totals, emailed_at").eq("period_start", period.start);
  const admin = createAdminClient();
  const rows: StatementRow[] = [];
  for (const f of targets) {
    const plans = await planDriverStatements(admin, { accountId: ctx.accountId, franchiseId: f.id, period });
    for (const plan of plans) {
      const file = (stored ?? []).find((s) => s.franchise_id === f.id && s.driver_id === plan.driver.id);
      const payable = (file?.totals as { totalPayable?: number } | null)?.totalPayable;
      rows.push({
        driverId: plan.driver.id, franchiseId: f.id, name: plan.driver.name,
        id: file?.id ?? null, number: file?.statement_no ?? null, title: file?.title ?? null,
        total: payable != null ? fromDb(payable) : plan.build.ok ? plan.build.content.totalPayable : null,
        emailedAt: file?.emailed_at ?? null,
        reason: plan.build.ok ? null : plan.build.reason,
      });
    }
  }
  return { rows, manyFranchises: targets.length > 1 };
}

export interface WagesLine {
  driverId: string;
  dr: string | null;
  name: string;
  franchises: number;
  /** Amount to pay, all franchises added together. Null when any statement for this driver is incomplete. */
  total: Pence | null;
}

/**
 * One line per driver for the period: the same person's statements for each FD number added together, so it is
 * paid once. The DR number tells people apart who share a name.
 */
export function wagesToPay(rows: StatementRow[], dr: Map<string, string | null>): { lines: WagesLine[]; total: Pence; complete: boolean } {
  const byDriver = new Map<string, StatementRow[]>();
  for (const r of rows) byDriver.set(r.driverId, [...(byDriver.get(r.driverId) ?? []), r]);
  const lines: WagesLine[] = [...byDriver.entries()].map(([driverId, rs]) => {
    const complete = rs.every((r) => r.total != null);
    return {
      driverId,
      dr: dr.get(driverId) ?? null,
      name: rs[0]!.name,
      franchises: rs.length,
      total: complete ? sumPence(rs.map((r) => r.total ?? 0)) : null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  const complete = lines.every((l) => l.total != null);
  const total = sumPence(lines.map((l) => l.total ?? 0));
  return { lines, total, complete };
}
