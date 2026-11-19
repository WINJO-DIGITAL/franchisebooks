import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideReviewItem, importDocument } from "@/lib/ingest/pipeline";
import { loadPeriodData } from "@/lib/data/period";
import { summarisePeriod } from "@/lib/finance/calc";
import { adminClient } from "../helpers/app";
import { createTestAccount, pool, sql, type TestAccount } from "../helpers/db";
import { earningsFigures, earningsPdf, expensesXlsx, fuelCsv, fuelTotal, SYNTHETIC_DRIVERS } from "../fixtures/synthetic";

const db = adminClient();
let t: TestAccount;
const p = (n: number) => Math.round(n * 100);

beforeAll(async () => {
  t = await createTestAccount("Pipeline Test Couriers");
  // Give Alex a vehicle so fuel can be attributed by registration.
  await sql("update public.driver_assignments set vehicle_registration = 'AB12CDE' where driver_id = $1", [t.driverIds[0]]);
});
afterAll(() => pool.end());

const upload = (filename: string, bytes: Buffer, extra: Record<string, unknown> = {}) =>
  importDocument(db, { accountId: t.accountId, source: "manual_upload", filename, bytes: new Uint8Array(bytes), uploadedBy: t.ownerId, ...extra });

describe("earnings PDF end to end", () => {
  let pdf: Buffer;

  it("imports a synthetic DPD-style statement, matching franchise and drivers", async () => {
    pdf = await earningsPdf({ fdNumber: t.fdNumber, date: "2026-11-14" });
    const outcome = await upload("daily-earnings-2026-11-14.pdf", pdf);
    expect(outcome.status).toBe("imported");
    expect(outcome.inserted).toBe(4);
    expect(outcome.message).toContain("4 driver records imported");
    expect(outcome.message).toContain("14/11/2026");
    expect(outcome.message).not.toContain("not matched");

    const rows = await sql<{ source_driver_name: string; driver_id: string | null; gross_earnings: string; original_earnings: string; franchise_id: string; source: string }>(
      "select source_driver_name, driver_id, gross_earnings, original_earnings, franchise_id, source from public.daily_earnings where account_id = $1 order by source_driver_name", [t.accountId],
    );
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      const source = SYNTHETIC_DRIVERS.find((d) => d.driver === row.source_driver_name)!;
      const f = earningsFigures(source);
      expect(p(Number(row.gross_earnings))).toBe(p(f.gross));
      expect(p(Number(row.original_earnings))).toBe(p(f.net));
      expect(row.franchise_id).toBe(t.franchiseId);
      expect(row.source).toBe("manual_upload");
    }
    // Registered drivers are matched; a name nobody has registered is added as a new driver, linked to the franchise.
    expect(rows.find((r) => r.source_driver_name === "Alex Example")!.driver_id).toBe(t.driverIds[0]);
    const casey = rows.find((r) => r.source_driver_name === "Casey Testcase")!.driver_id;
    expect(casey).not.toBeNull();
    expect(t.driverIds).not.toContain(casey);
    const [assignment] = await sql<{ franchise_id: string; start_date: string }>("select franchise_id, start_date::text from public.driver_assignments where driver_id = $1", [casey]);
    expect(assignment).toMatchObject({ franchise_id: t.franchiseId, start_date: "2026-11-14" });
  });

  it("keeps the original document and records where each figure came from", async () => {
    const [file] = await sql<{ id: string; storage_path: string; sha256: string; status: string; document_type: string; parse_confidence: string; uploaded_by: string }>(
      "select id, storage_path, sha256, status, document_type, parse_confidence, uploaded_by from public.imported_files where account_id = $1 and original_filename like 'daily-earnings%'", [t.accountId],
    );
    expect(file).toMatchObject({ status: "imported", document_type: "earnings_report", uploaded_by: t.ownerId });
    expect(Number(file!.parse_confidence)).toBe(1);
    const download = await db.storage.from("source-documents").download(file!.storage_path);
    expect(download.error).toBeNull();
    expect(Buffer.from(await download.data!.arrayBuffer()).equals(pdf)).toBe(true);
    const [{ count }] = await sql<{ count: string }>("select count(*)::text from public.daily_earnings where imported_file_id = $1", [file!.id]) as [{ count: string }];
    expect(count).toBe("4");
  });

  it("refuses to import the same file twice", async () => {
    const outcome = await upload("renamed-copy.pdf", pdf);
    expect(outcome.status).toBe("duplicate");
    expect(outcome.message).toContain("already been imported");
    const [{ count }] = await sql<{ count: string }>("select count(*)::text from public.daily_earnings where account_id = $1", [t.accountId]) as [{ count: string }];
    expect(count).toBe("4");
  });

  it("applies the same rules to a file arriving from another source", async () => {
    // A different file (different bytes) with identical figures from "Dropbox": nothing new is stored.
    const again = await earningsPdf({ fdNumber: t.fdNumber, date: "2026-11-14", totals: false });
    const outcome = await importDocument(db, { accountId: t.accountId, source: "dropbox", filename: "from-dropbox.pdf", bytes: new Uint8Array(again), sourceRef: "/DPD/from-dropbox.pdf" });
    expect(outcome).toMatchObject({ status: "imported", inserted: 0, unchanged: 4, conflicts: 0 });
  });

  it("flags a conflicting document for review instead of overwriting", async () => {
    const changed = SYNTHETIC_DRIVERS.map((d) => (d.driver === "Alex Example" ? { ...d, stops: d.stops + 10 } : d));
    const outcome = await importDocument(db, {
      accountId: t.accountId, source: "dropbox", filename: "revised.pdf", bytes: new Uint8Array(await earningsPdf({ fdNumber: t.fdNumber, date: "2026-11-14", rows: changed })),
    });
    expect(outcome).toMatchObject({ status: "needs_review", inserted: 0, unchanged: 3, conflicts: 1 });
    expect(outcome.message).toContain("disagree");
    const [alex] = await sql<{ stops: number }>("select stops from public.daily_earnings where account_id = $1 and source_driver_name = 'Alex Example' and is_current", [t.accountId]);
    expect(alex!.stops).toBe(108);
    // The disagreement waits for a person as a review item. It is not an alert: the only alert is the invoice cross-check.
    const review = await sql("select kind from public.review_items where account_id = $1 and kind = 'source_conflict' and status = 'open'", [t.accountId]);
    expect(review).toHaveLength(1);
    const alerts = await sql("select anomaly_type from public.anomalies where account_id = $1 and anomaly_type = 'source_conflict'", [t.accountId]);
    expect(alerts).toHaveLength(0);
  });

  it("adds the names on a report as drivers instead of raising unregistered-driver alerts", async () => {
    const alerts = await sql<{ title: string }>("select title from public.anomalies where account_id = $1 and anomaly_type = 'unregistered_driver'", [t.accountId]);
    expect(alerts).toEqual([]);
    const added = await sql<{ display_name: string }>("select display_name from public.drivers where account_id = $1 and display_name in ('Casey Testcase', 'Devon Placeholder') order by display_name", [t.accountId]);
    expect(added.map((d) => d.display_name)).toEqual(["Casey Testcase", "Devon Placeholder"]);
  });
});

describe("a day with nothing in it", () => {
  it("is recorded as read, not held as an unrecognised document, when a daily report has headings and no rows", async () => {
    const headings = "Date,Driver ID,Driver,Route,Parcels,Stops,Pay per parcel,Pay per stop,Gross,Deductions,Additional,Net\n";
    const outcome = await upload(`payments_${t.fdNumber}_2026-11-28.csv`, Buffer.from(headings));
    expect(outcome.status).toBe("imported");
    expect(outcome.inserted).toBe(0);
    expect(outcome.message).toContain("nothing reported for this day");
    const open = await sql("select id from public.review_items where account_id = $1 and status = 'open' and kind = 'unknown_document'", [t.accountId]);
    expect(open).toEqual([]);
    const [file] = await sql<{ status: string }>("select status from public.imported_files where account_id = $1 and original_filename like 'payments_%'", [t.accountId]);
    expect(file!.status).toBe("imported");
  });
});

describe("documents that cannot be trusted", () => {
  it("holds a low-confidence document in the review queue and stores nothing", async () => {
    const outcome = await upload("corrupt.pdf", await earningsPdf({ fdNumber: t.fdNumber, date: "2026-11-16", corruptTotalBy: 25 }));
    expect(outcome.status).toBe("needs_review");
    expect(outcome.inserted).toBe(0);
    const rows = await sql("select id from public.daily_earnings where account_id = $1 and report_date = '2026-11-16'", [t.accountId]);
    expect(rows).toEqual([]);
    const [item] = await sql<{ id: string; kind: string; status: string }>(
      "select id, kind, status from public.review_items where account_id = $1 and kind = 'low_confidence'", [t.accountId],
    );
    expect(item).toMatchObject({ kind: "low_confidence", status: "open" });
  });

  it("imports the held rows only when the owner approves them", async () => {
    const [item] = await sql<{ id: string }>("select id from public.review_items where account_id = $1 and kind = 'low_confidence' and status = 'open'", [t.accountId]);
    const result = await decideReviewItem(db, { accountId: t.accountId, reviewItemId: item!.id, userId: t.ownerId, decision: "accept" });
    expect(result.message).toContain("4 records imported");
    const rows = await sql("select id from public.daily_earnings where account_id = $1 and report_date = '2026-11-16'", [t.accountId]);
    expect(rows).toHaveLength(4);
    const [after] = await sql("select status, resolved_by from public.review_items where id = $1", [item!.id]);
    expect(after).toMatchObject({ status: "accepted", resolved_by: t.ownerId });
    await expect(decideReviewItem(db, { accountId: t.accountId, reviewItemId: item!.id, userId: t.ownerId, decision: "accept" })).rejects.toThrow(/already been dealt with/);
  });

  it("stores nothing when the owner rejects a held document", async () => {
    await upload("corrupt-2.pdf", await earningsPdf({ fdNumber: t.fdNumber, date: "2026-11-17", corruptTotalBy: 5 }));
    const [item] = await sql<{ id: string; imported_file_id: string }>("select id, imported_file_id from public.review_items where account_id = $1 and kind = 'low_confidence' and status = 'open'", [t.accountId]);
    await decideReviewItem(db, { accountId: t.accountId, reviewItemId: item!.id, userId: t.ownerId, decision: "reject", note: "Bad scan" });
    expect(await sql("select id from public.daily_earnings where account_id = $1 and report_date = '2026-11-17'", [t.accountId])).toEqual([]);
    const [file] = await sql("select status from public.imported_files where id = $1", [item!.imported_file_id]);
    expect(file).toMatchObject({ status: "ignored" });
  });

  it("asks which franchise when the document names none", async () => {
    const outcome = await upload("no-fd.pdf", await earningsPdf({ fdNumber: "UNKNOWN-FD", date: "2026-11-18" }));
    expect(outcome.status).toBe("needs_review");
    expect(outcome.message).toContain("could not be matched to a franchise");
    const [item] = await sql<{ id: string }>("select id from public.review_items where account_id = $1 and kind = 'unmatched_franchise'", [t.accountId]);
    await decideReviewItem(db, { accountId: t.accountId, reviewItemId: item!.id, userId: t.ownerId, decision: "accept", franchiseId: t.franchiseId });
    expect(await sql("select id from public.daily_earnings where account_id = $1 and report_date = '2026-11-18'", [t.accountId])).toHaveLength(4);
  });

  it("uses the franchise chosen at upload when the document names none", async () => {
    const outcome = await upload("no-fd-hint.pdf", await earningsPdf({ fdNumber: "UNKNOWN-FD", date: "2026-11-19" }), { franchiseHintId: t.franchiseId });
    expect(outcome).toMatchObject({ status: "imported", inserted: 4 });
  });

  it("explains an unreadable file in plain English and keeps a record of it", async () => {
    const outcome = await upload("holiday-photo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    expect(outcome.status).toBe("needs_review");
    expect(outcome.message).toContain("was not recognised");
    expect(outcome.message).toContain("Nothing was imported");
    const logs = await sql<{ message: string; level: string }>("select message, level from public.sync_logs where account_id = $1 and event = 'file_needs_review' order by created_at desc limit 1", [t.accountId]);
    expect(logs[0]!.level).toBe("warning");
  });
});

describe("fuel and expenses end to end", () => {
  const fuelRows = [
    { date: "2026-11-12", time: "06:41", card: "****1234", registration: "AB12 CDE", site: "Synthetic Services", litres: 52.31, pricePerLitre: 1.459, reference: "TX-0001" },
    { date: "2026-11-13", time: "18:05", card: "****5678", registration: "ZZ99ZZZ", site: "Sample Fuel Stop", litres: 61.7, pricePerLitre: 1.479, reference: "TX-0002" },
  ];

  it("imports fuel, attributing only what can be matched reliably", async () => {
    const outcome = await upload("fuel-week-46.csv", fuelCsv(fuelRows, { fdNumber: t.fdNumber, totals: true }));
    expect(outcome).toMatchObject({ status: "imported", inserted: 2 });
    expect(outcome.message).toContain("1 could not be matched to a driver");
    const rows = await sql<{ vehicle_registration: string; total_cost: string; driver_id: string | null; method: string | null }>(
      `select f.vehicle_registration, f.total_cost, a.driver_id, a.method from public.fuel_transactions f
       left join public.expense_allocations a on a.fuel_transaction_id = f.id and a.is_current where f.account_id = $1 order by f.transaction_date`, [t.accountId],
    );
    expect(rows[0]).toMatchObject({ vehicle_registration: "AB12CDE", driver_id: t.driverIds[0], method: "auto_vehicle" });
    expect(p(Number(rows[0]!.total_cost))).toBe(p(fuelTotal(fuelRows[0]!)));
    expect(rows[1]).toMatchObject({ vehicle_registration: "ZZ99ZZZ", driver_id: null, method: null });
  });

  it("does not duplicate transactions when an overlapping report is imported", async () => {
    const overlapping = [...fuelRows, { date: "2026-11-14", time: "07:10", card: "****1234", registration: "AB12 CDE", site: "Synthetic Services", litres: 40, pricePerLitre: 1.5, reference: "TX-0003" }];
    const outcome = await upload("fuel-week-46-extended.csv", fuelCsv(overlapping, { fdNumber: t.fdNumber }));
    expect(outcome).toMatchObject({ status: "imported", inserted: 1, unchanged: 2 });
    const [{ count }] = await sql<{ count: string }>("select count(*)::text from public.fuel_transactions where account_id = $1", [t.accountId]) as [{ count: string }];
    expect(count).toBe("3");
  });

  it("imports an expenses spreadsheet with categories", async () => {
    const outcome = await upload("expenses-nov.xlsx", await expensesXlsx([
      { date: "2026-11-03", description: "Two front tyres", supplier: "Synthetic Tyres Ltd", category: "Tyres", amount: 186.4, reference: "INV-77", registration: "AB12 CDE" },
      { date: "2026-11-09", description: "Annual service and MOT", supplier: "Sample Garage", amount: 240 },
    ], { fdNumber: t.fdNumber }));
    expect(outcome).toMatchObject({ status: "imported", inserted: 2 });
    const rows = await sql<{ description: string; category: string; amount: string }>(
      "select e.description, c.name as category, e.amount from public.expenses e join public.expense_categories c on c.id = e.category_id where e.account_id = $1 order by e.expense_date", [t.accountId],
    );
    expect(rows).toEqual([
      { description: "Two front tyres", category: "Tyres", amount: "186.40" },
      { description: "Annual service and MOT", category: "Vehicle maintenance", amount: "240.00" },
    ]);
  });
});

describe("reconciliation against the database", () => {
  it("the finance engine's totals equal the sums held in the database", async () => {
    const data = await loadPeriodData(db, { accountId: t.accountId, from: "2026-11-01", to: "2026-11-30" });
    const summary = summarisePeriod(data);
    const [dbTotals] = await sql<{ earnings: string; fuel: string; expenses: string }>(
      `select
         (select coalesce(sum(original_earnings), 0)::text from public.daily_earnings where account_id = $1 and is_current and report_date between '2026-11-01' and '2026-11-30') as earnings,
         (select coalesce(sum(total_cost), 0)::text from public.fuel_transactions where account_id = $1 and not is_void) as fuel,
         (select coalesce(sum(amount), 0)::text from public.expenses where account_id = $1 and not is_void) as expenses`, [t.accountId],
    );
    expect(summary.combined.driverOriginalEarnings).toBe(p(Number(dbTotals!.earnings)));
    expect(summary.combined.fuel).toBe(p(Number(dbTotals!.fuel)));
    expect(summary.combined.otherExpenses).toBe(p(Number(dbTotals!.expenses)));
    expect(summary.combined.operatingProfit).toBeNull(); // no revenue entered → no invented profit
  });
});
