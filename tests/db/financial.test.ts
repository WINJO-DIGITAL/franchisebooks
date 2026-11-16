import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createFile, createTestAccount, earningsRow, ingestEarnings, pool, sql, type TestAccount } from "../helpers/db";

let t: TestAccount;
beforeAll(async () => {
  t = await createTestAccount();
});
afterAll(() => pool.end());

const adjust = (type: string, amount: number, reason = "Agreed with driver", date = "2026-11-14", driver = 0) =>
  asUser(t.ownerId, (run) =>
    run<{ id: string; amount: string; created_by: string }>(
      "select * from public.create_pay_adjustment($1, $2, $3, $4, $5, $6)", [t.franchiseId, t.driverIds[driver], date, type, amount, reason],
    ),
  ).then((rows) => rows[0]!);

describe("pay adjustments", () => {
  it("records who made it, when, for which date and why", async () => {
    const row = await adjust("additional_payment", 50, "Covered an extra route");
    const [stored] = await sql("select * from public.earnings_adjustments where id = $1", [row.id]);
    expect(stored).toMatchObject({
      amount: "50.00", adjustment_type: "additional_payment", reason: "Covered an extra route", created_by: t.ownerId,
      driver_id: t.driverIds[0], franchise_id: t.franchiseId,
    });
    expect((stored!.earnings_date as Date).getFullYear()).toBe(2026);
    expect(stored!.created_at).toBeInstanceOf(Date);
    expect(stored!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("requires a reason", async () => {
    await expect(adjust("additional_payment", 50, " ")).rejects.toThrow(/check constraint/);
  });

  it("makes the sign follow the type", async () => {
    await expect(adjust("additional_payment", -10)).rejects.toThrow(/check constraint/);
    await expect(adjust("deduction", 25)).rejects.toThrow(/check constraint/);
    await expect(adjust("cover_payment", -5)).rejects.toThrow();
    expect((await adjust("deduction", -25)).amount).toBe("-25.00");
    expect((await adjust("earnings_correction", -3.5)).amount).toBe("-3.50");
    expect((await adjust("other", 3.5)).amount).toBe("3.50");
  });

  it("allows a zero-value entry to record that a payment was withheld", async () => {
    expect((await adjust("withheld_payment", 0, "Bonus withheld: vehicle returned damaged")).amount).toBe("0.00");
  });

  it("cannot be edited or deleted by anyone, including the service role and the database owner", async () => {
    const row = await adjust("additional_payment", 12);
    await expect(asUser(t.ownerId, (run) => run("update public.earnings_adjustments set amount = 99 where id = $1", [row.id]))).rejects.toThrow(/permission denied/);
    await expect(asUser(t.ownerId, (run) => run("delete from public.earnings_adjustments where id = $1", [row.id]))).rejects.toThrow(/permission denied/);
    await expect(asService((run) => run("update public.earnings_adjustments set amount = 99 where id = $1", [row.id]))).rejects.toThrow(/append-only/);
    await expect(asService((run) => run("delete from public.earnings_adjustments where id = $1", [row.id]))).rejects.toThrow(/append-only/);
    await expect(sql("update public.earnings_adjustments set reason = 'changed' where id = $1", [row.id])).rejects.toThrow(/append-only/);
  });

  it("is reversed by a new equal-and-opposite entry, once only", async () => {
    const row = await adjust("additional_payment", 40, "One-off bonus", "2026-11-10");
    const [reversal] = await asUser(t.ownerId, (run) =>
      run<{ id: string; amount: string; reverses_adjustment_id: string }>("select * from public.reverse_pay_adjustment($1, 'Entered in error')", [row.id]),
    );
    expect(reversal).toMatchObject({ amount: "-40.00", reverses_adjustment_id: row.id });
    const [{ total }] = await sql<{ total: string }>(
      "select sum(amount)::text as total from public.earnings_adjustments where id in ($1, $2)", [row.id, reversal!.id],
    ) as [{ total: string }];
    expect(total).toBe("0.00");
    const [original] = await sql("select amount, reason from public.earnings_adjustments where id = $1", [row.id]);
    expect(original).toMatchObject({ amount: "40.00", reason: "One-off bonus" });

    await expect(asUser(t.ownerId, (run) => run("select public.reverse_pay_adjustment($1, 'Again')", [row.id]))).rejects.toThrow(/already been reversed/);
    await expect(asUser(t.ownerId, (run) => run("select public.reverse_pay_adjustment($1, 'Reverse the reversal')", [reversal!.id]))).rejects.toThrow(/itself a reversal/);
  });

  it("stores exact decimal amounts", async () => {
    const amounts = [0.1, 0.2, 19.99, 33.33, 0.01];
    for (const amount of amounts) await adjust("additional_payment", amount, "Decimal check", "2026-10-01");
    const [{ total }] = await sql<{ total: string }>(
      "select sum(amount)::text as total from public.earnings_adjustments where account_id = $1 and earnings_date = '2026-10-01'", [t.accountId],
    ) as [{ total: string }];
    expect(total).toBe("53.63");
  });
});

describe("imported DPD earnings", () => {
  let x: TestAccount;
  beforeAll(async () => {
    x = await createTestAccount();
  });

  it("is idempotent: importing the same rows again changes nothing", async () => {
    const rows = [earningsRow(x), earningsRow(x, { driver_id: x.driverIds[1], driver_key: "name:blake sample", source_driver_name: "Blake Sample", gross_earnings: "120.00", net_earnings: "120.00" })];
    expect(await ingestEarnings(x.fileId, rows)).toEqual({ inserted: 2, unchanged: 0, conflicts: 0 });
    const second = await createFile(x.accountId, x.franchiseId, "dropbox");
    expect(await ingestEarnings(second, rows)).toEqual({ inserted: 0, unchanged: 2, conflicts: 0 });
    const [{ count }] = await sql<{ count: string }>("select count(*)::text from public.daily_earnings where account_id = $1", [x.accountId]) as [{ count: string }];
    expect(count).toBe("2");
  });

  it("derives original earnings from the net DPD supplied, or from gross − deductions + additional", async () => {
    const file = await createFile(x.accountId, x.franchiseId);
    await ingestEarnings(file, [
      earningsRow(x, { report_date: "2026-11-15", gross_earnings: "150.00", deductions: "12.50", additional_payments: "5.00", net_earnings: "" }),
      earningsRow(x, { report_date: "2026-11-16", gross_earnings: "150.00", deductions: "12.50", additional_payments: "5.00", net_earnings: "141.00" }),
    ]);
    const rows = await sql<{ report_date: Date; original_earnings: string }>(
      "select report_date, original_earnings from public.daily_earnings where imported_file_id = $1 order by report_date", [file],
    );
    expect(rows.map((r) => r.original_earnings)).toEqual(["142.50", "141.00"]);
  });

  it("never overwrites when a second source disagrees: the difference goes for review", async () => {
    const dropboxFile = await createFile(x.accountId, x.franchiseId, "dropbox");
    const result = await ingestEarnings(dropboxFile, [earningsRow(x, { gross_earnings: "158.00", net_earnings: "158.00" })]);
    expect(result).toEqual({ inserted: 0, unchanged: 0, conflicts: 1 });
    const [stored] = await sql("select gross_earnings, imported_file_id from public.daily_earnings where franchise_id = $1 and driver_key = 'name:alex example' and report_date = '2026-11-14' and is_current", [x.franchiseId]);
    expect(stored).toMatchObject({ gross_earnings: "148.00", imported_file_id: x.fileId });
    const reviews = await sql("select kind, status, title, detail from public.review_items where account_id = $1", [x.accountId]);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ kind: "source_conflict", status: "open" });
    expect(reviews[0]!.detail).toContain("£148.00");
    expect(reviews[0]!.detail).toContain("£158.00");

    // Re-importing the same disagreeing document does not raise the conflict twice.
    await ingestEarnings(dropboxFile, [earningsRow(x, { gross_earnings: "158.00", net_earnings: "158.00" })]);
    const [{ count }] = await sql<{ count: string }>("select count(*)::text from public.review_items where account_id = $1", [x.accountId]) as [{ count: string }];
    expect(count).toBe("1");
  });

  it("keeps the replaced figures when the owner accepts the newer document", async () => {
    const [review] = await sql<{ id: string }>("select id from public.review_items where account_id = $1 and status = 'open'", [x.accountId]);
    await asUser(x.ownerId, (run) => run("select public.resolve_earnings_conflict($1, 'use_incoming', 'Dropbox copy is the corrected statement')", [review!.id]));
    const rows = await sql<{ gross_earnings: string; is_current: boolean; superseded_reason: string | null; superseded_by: string | null }>(
      "select gross_earnings, is_current, superseded_reason, superseded_by from public.daily_earnings where franchise_id = $1 and driver_key = 'name:alex example' and report_date = '2026-11-14' order by created_at", [x.franchiseId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ gross_earnings: "148.00", is_current: false, superseded_reason: "Dropbox copy is the corrected statement" });
    expect(rows[0]!.superseded_by).not.toBeNull();
    expect(rows[1]).toMatchObject({ gross_earnings: "158.00", is_current: true });
    const [item] = await sql("select status, resolved_by from public.review_items where id = $1", [review!.id]);
    expect(item).toMatchObject({ status: "accepted", resolved_by: x.ownerId });
    await expect(asUser(x.ownerId, (run) => run("select public.resolve_earnings_conflict($1, 'keep_existing', null)", [review!.id]))).rejects.toThrow(/already been dealt with/);
  });

  it("cannot have its figures edited or be deleted — by anyone", async () => {
    const [row] = await sql<{ id: string }>("select id from public.daily_earnings where account_id = $1 and is_current limit 1", [x.accountId]);
    await expect(asUser(x.ownerId, (run) => run("update public.daily_earnings set gross_earnings = 1 where id = $1", [row!.id]))).rejects.toThrow(/permission denied/);
    await expect(asService((run) => run("update public.daily_earnings set gross_earnings = 1 where id = $1", [row!.id]))).rejects.toThrow(/read-only/);
    await expect(asService((run) => run("update public.daily_earnings set stops = 1 where id = $1", [row!.id]))).rejects.toThrow(/read-only/);
    await expect(asService((run) => run("delete from public.daily_earnings where id = $1", [row!.id]))).rejects.toThrow(/cannot be deleted/);
  });

  it("links unregistered report rows to a driver without touching the figures", async () => {
    const file = await createFile(x.accountId, x.franchiseId);
    await ingestEarnings(file, [earningsRow(x, { driver_id: "", driver_key: "name:new person", source_driver_name: "New Person", report_date: "2026-11-12" }),
      earningsRow(x, { driver_id: "", driver_key: "name:new person", source_driver_name: "New Person", report_date: "2026-11-13" })]);
    const [driver] = await sql<{ id: string }>("insert into public.drivers (account_id, display_name) values ($1, 'Newly Registered') returning id", [x.accountId]);
    const [{ linked }] = await asUser(x.ownerId, (run) =>
      run<{ linked: number }>("select public.link_earnings_to_driver($1, 'name:new person', $2, 'New Person') as linked", [x.franchiseId, driver!.id]),
    ) as [{ linked: number }];
    expect(linked).toBe(2);
    const rows = await sql("select driver_id, gross_earnings from public.daily_earnings where imported_file_id = $1", [file]);
    expect(rows.every((r) => r.driver_id === driver!.id && r.gross_earnings === "148.00")).toBe(true);
    const aliases = await sql("select alias_normalised from public.driver_aliases where driver_id = $1", [driver!.id]);
    expect(aliases).toEqual([{ alias_normalised: "new person" }]);
  });
});

describe("driver cover", () => {
  let c: TestAccount;
  beforeAll(async () => {
    c = await createTestAccount();
    await ingestEarnings(c.fileId, [earningsRow(c, { gross_earnings: "148.00", net_earnings: "148.00" })]);
  });

  const cover = (allocation: string, toCovering: number, fromOriginal: number, date = "2026-11-14", attribution = "original") =>
    asUser(c.ownerId, (run) =>
      run<{ id: string; amount_to_covering: string; amount_from_original: string }>(
        "select * from public.record_driver_cover($1, $2, $3, $4, 'R01', 'Alex off sick', $5, $6, $7, $8)",
        [c.franchiseId, date, c.driverIds[0], c.driverIds[1], allocation, toCovering, fromOriginal, attribution],
      ),
    ).then((rows) => rows[0]!);

  it("does not assume the covering driver gets the earnings", async () => {
    const record = await cover("none", 0, 0, "2026-11-01");
    expect(record).toMatchObject({ amount_to_covering: "0.00", amount_from_original: "0.00" });
    const adjustments = await sql("select id from public.earnings_adjustments where cover_record_id = $1", [record.id]);
    expect(adjustments).toEqual([]);
  });

  it("stores the agreed allocation separately and leaves the DPD figures untouched", async () => {
    const record = await cover("custom", 90, 60, "2026-11-13", "covering");
    const adjustments = await sql<{ driver_id: string; amount: string; adjustment_type: string; reason: string }>(
      "select driver_id, amount, adjustment_type, reason from public.earnings_adjustments where cover_record_id = $1 order by amount", [record.id],
    );
    expect(adjustments).toHaveLength(2);
    expect(adjustments[0]).toMatchObject({ driver_id: c.driverIds[0], amount: "-60.00", adjustment_type: "deduction" });
    expect(adjustments[1]).toMatchObject({ driver_id: c.driverIds[1], amount: "90.00", adjustment_type: "cover_payment" });
    expect(adjustments[1]!.reason).toContain("Blake Sample covered Alex Example");
    const [dpd] = await sql("select gross_earnings, driver_id from public.daily_earnings where franchise_id = $1 and report_date = '2026-11-14'", [c.franchiseId]);
    expect(dpd).toMatchObject({ gross_earnings: "148.00", driver_id: c.driverIds[0] });
  });

  it("can move the whole day's imported earnings to the covering driver", async () => {
    const record = await cover("all_to_cover", 0, 0, "2026-11-14");
    expect(record).toMatchObject({ amount_to_covering: "148.00", amount_from_original: "148.00" });
    const [{ net }] = await sql<{ net: string }>("select sum(amount)::text as net from public.earnings_adjustments where cover_record_id = $1", [record.id]) as [{ net: string }];
    expect(net).toBe("0.00");
  });

  it("explains when there are no imported earnings to move", async () => {
    await expect(cover("all_to_cover", 0, 0, "2026-11-20")).rejects.toThrow(/no imported DPD earnings/);
  });

  it("rejects a driver covering themselves and duplicate records", async () => {
    await expect(asUser(c.ownerId, (run) =>
      run("select public.record_driver_cover($1, '2026-11-02', $2, $2, null, null, 'none', 0, 0, 'original')", [c.franchiseId, c.driverIds[0]]),
    )).rejects.toThrow();
    await expect(cover("none", 0, 0, "2026-11-01")).rejects.toThrow(/already been recorded/);
  });

  it("is cancelled by reversing its adjustments, not by deleting anything", async () => {
    const record = await cover("custom", 70, 70, "2026-11-05");
    await asUser(c.ownerId, (run) => run("select public.cancel_driver_cover($1, 'Recorded against the wrong day')", [record.id]));
    const rows = await sql<{ amount: string; reverses_adjustment_id: string | null }>(
      "select amount, reverses_adjustment_id from public.earnings_adjustments where cover_record_id = $1", [record.id],
    );
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.reverses_adjustment_id).length).toBe(2);
    expect(rows.reduce((a, r) => a + Number(r.amount) * 100, 0)).toBe(0);
    const [stored] = await sql("select status, cancel_reason, cancelled_by from public.driver_cover_records where id = $1", [record.id]);
    expect(stored).toMatchObject({ status: "cancelled", cancel_reason: "Recorded against the wrong day", cancelled_by: c.ownerId });
    await expect(asUser(c.ownerId, (run) => run("select public.cancel_driver_cover($1, 'Twice')", [record.id]))).rejects.toThrow(/already cancelled/);
    await expect(asService((run) => run("delete from public.driver_cover_records where id = $1", [record.id]))).rejects.toThrow(/cannot be deleted/);
  });

  it("does not allow a cover adjustment to be reversed on its own", async () => {
    const record = await cover("custom", 10, 0, "2026-11-06");
    const [adj] = await sql<{ id: string }>("select id from public.earnings_adjustments where cover_record_id = $1", [record.id]);
    await expect(asUser(c.ownerId, (run) => run("select public.reverse_pay_adjustment($1, 'Try')", [adj!.id]))).rejects.toThrow(/Cancel the cover record/);
  });
});

describe("fuel, expenses and attribution", () => {
  let f: TestAccount;
  const fuelRow = (o: Record<string, unknown> = {}) => ({
    franchise_id: f.franchiseId, transaction_date: "2026-11-12", transaction_time: "06:41", description: "Diesel", supplier: "Synthetic Services",
    vehicle_registration: "AB12CDE", source_driver_name: "", card_reference: "****1234", litres: "52.31", price_per_litre: "1.4590",
    total_cost: "76.32", transaction_ref: "TX-1", dedupe_key: "fuel|ref|tx-1|2026-11-12|1", driver_id: "", allocation_method: "", allocation_note: "", ...o,
  });
  const ingestFuel = (rows: unknown[]) =>
    asService((run) => run<{ r: { inserted: number; unchanged: number } }>("select public.ingest_fuel($1, $2::jsonb) as r", [f.fileId, JSON.stringify(rows)])).then((x) => x[0]!.r);

  beforeAll(async () => {
    f = await createTestAccount();
  });

  it("prevents duplicate transactions on repeated imports", async () => {
    expect(await ingestFuel([fuelRow(), fuelRow({ dedupe_key: "fuel|ref|tx-2|2026-11-12|1", transaction_ref: "TX-2", total_cost: "80.00" })])).toMatchObject({ inserted: 2, unchanged: 0 });
    expect(await ingestFuel([fuelRow(), fuelRow({ dedupe_key: "fuel|ref|tx-2|2026-11-12|1", transaction_ref: "TX-2", total_cost: "80.00" })])).toMatchObject({ inserted: 0, unchanged: 2 });
    const [{ count }] = await sql<{ count: string }>("select count(*)::text from public.fuel_transactions where account_id = $1", [f.accountId]) as [{ count: string }];
    expect(count).toBe("2");
  });

  it("leaves a cost unallocated unless it was matched reliably", async () => {
    const rows = await sql("select a.id from public.expense_allocations a where a.account_id = $1", [f.accountId]);
    expect(rows).toEqual([]);
    await ingestFuel([fuelRow({ dedupe_key: "fuel|ref|tx-3|2026-11-12|1", transaction_ref: "TX-3", driver_id: f.driverIds[0], allocation_method: "auto_vehicle", allocation_note: "Vehicle match" })]);
    const auto = await sql("select scope, driver_id, method from public.expense_allocations where account_id = $1", [f.accountId]);
    expect(auto).toEqual([{ scope: "driver", driver_id: f.driverIds[0], method: "auto_vehicle" }]);
  });

  it("lets the owner assign and reassign, keeping the history", async () => {
    const [tx] = await sql<{ id: string }>("select id from public.fuel_transactions where account_id = $1 and transaction_ref = 'TX-1'", [f.accountId]);
    const set = (scope: string, driver: string | null) =>
      asUser(f.ownerId, (run) => run("select public.set_cost_allocation('fuel', $1, $2, $3, 'Owner decision')", [tx!.id, scope, driver]));
    await set("driver", f.driverIds[0]);
    await set("driver", f.driverIds[1]);
    await set("franchise", null);
    const history = await sql<{ scope: string; driver_id: string | null; is_current: boolean; method: string }>(
      "select scope, driver_id, is_current, method from public.expense_allocations where fuel_transaction_id = $1 order by created_at, id", [tx!.id],
    );
    expect(history).toHaveLength(3);
    expect(history.filter((h) => h.is_current)).toEqual([{ scope: "franchise", driver_id: null, is_current: true, method: "manual" }]);
    await set("unallocated", null);
    const current = await sql("select id from public.expense_allocations where fuel_transaction_id = $1 and is_current", [tx!.id]);
    expect(current).toEqual([]);
  });

  it("lets the owner add an expense by hand, void it, but never change its amount or delete it", async () => {
    const [category] = await sql<{ id: string }>("select id from public.expense_categories where account_id = $1 and name = 'Tyres'", [f.accountId]);
    const [expense] = await asUser(f.ownerId, (run) =>
      run<{ id: string }>(
        `insert into public.expenses (account_id, franchise_id, category_id, expense_date, description, amount, source, dedupe_key, created_by)
         values ($1, $2, $3, '2026-11-03', 'Two front tyres', 186.40, 'manual_entry', gen_random_uuid()::text, $4) returning id`,
        [f.accountId, f.franchiseId, category!.id, f.ownerId],
      ),
    );
    await expect(asUser(f.ownerId, (run) => run("update public.expenses set amount = 1 where id = $1", [expense!.id]))).rejects.toThrow(/permission denied/);
    await expect(asService((run) => run("update public.expenses set amount = 1 where id = $1", [expense!.id]))).rejects.toThrow(/cannot be changed/);
    await expect(asService((run) => run("delete from public.expenses where id = $1", [expense!.id]))).rejects.toThrow(/cannot be deleted/);
    const voided = await asUser(f.ownerId, (run) =>
      run("update public.expenses set is_void = true, void_reason = 'Entered twice', voided_by = $2, voided_at = now() where id = $1 returning id", [expense!.id, f.ownerId]),
    );
    expect(voided).toHaveLength(1);
    await expect(asService((run) => run("update public.expenses set is_void = false where id = $1", [expense!.id]))).rejects.toThrow(/cannot be restored/);
  });

  it("does not let a user insert an expense pretending it was imported", async () => {
    const [category] = await sql<{ id: string }>("select id from public.expense_categories where account_id = $1 and name = 'Parking'", [f.accountId]);
    await expect(asUser(f.ownerId, (run) =>
      run(`insert into public.expenses (account_id, franchise_id, category_id, expense_date, amount, source, dedupe_key, created_by)
           values ($1, $2, $3, '2026-11-03', 5, 'dpd_portal', 'x', $4)`, [f.accountId, f.franchiseId, category!.id, f.ownerId]),
    )).rejects.toThrow(/row-level security/);
  });
});

describe("revenue", () => {
  it("must sit inside one calendar month and is voided rather than deleted", async () => {
    const insert = (start: string, end: string) =>
      asUser(t.ownerId, (run) =>
        run<{ id: string }>(
          "insert into public.revenue_entries (account_id, franchise_id, period_start, period_end, amount, status, created_by) values ($1, $2, $3, $4, 12500.00, 'confirmed', $5) returning id",
          [t.accountId, t.franchiseId, start, end, t.ownerId],
        ),
      );
    await expect(insert("2026-11-15", "2026-12-15")).rejects.toThrow(/check constraint/);
    const [row] = await insert("2026-11-01", "2026-11-30");
    await expect(asService((run) => run("delete from public.revenue_entries where id = $1", [row!.id]))).rejects.toThrow(/cannot be deleted/);
    await expect(asService((run) => run("update public.revenue_entries set amount = 1 where id = $1", [row!.id]))).rejects.toThrow(/cannot be changed/);
  });
});

describe("job queue", () => {
  const enqueue = (type: string, date: string | null, franchise: string | null = t.franchiseId) =>
    asService((run) => run<{ id: string; status: string }>("select * from public.enqueue_job($1, $2, $3, $4, 'schedule', '{}'::jsonb, null)", [t.accountId, type, franchise, date])).then((r) => r[0]!);

  it("never queues overlapping jobs for the same franchise and report date", async () => {
    const first = await enqueue("dpd_sync", "2026-11-14");
    const second = await enqueue("dpd_sync", "2026-11-14");
    expect(second.id).toBe(first.id);
    const otherDate = await enqueue("dpd_sync", "2026-11-15");
    expect(otherDate.id).not.toBe(first.id);
    await expect(sql(
      "insert into public.import_jobs (account_id, job_type, franchise_id, report_date, status) values ($1, 'dpd_sync', $2, '2026-11-14', 'running')", [t.accountId, t.franchiseId],
    )).rejects.toThrow(/duplicate key/);
  });

  it("hands each job to exactly one worker", async () => {
    const claims = await Promise.all(
      ["w1", "w2", "w3", "w4"].map((w) => asService((run) => run<{ id: string }>("select * from public.claim_next_job($1, array['dpd_sync'])", [w]))),
    );
    const mine = await sql<{ id: string }>("select id from public.import_jobs where account_id = $1", [t.accountId]);
    const claimedIds = claims.flat().map((j) => j.id).filter((id) => mine.some((m) => m.id === id));
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
    const running = await sql<{ attempts: number; locked_by: string }>("select attempts, locked_by from public.import_jobs where account_id = $1 and status = 'running'", [t.accountId]);
    expect(running.length).toBe(claimedIds.length);
    expect(running.every((j) => j.attempts === 1 && j.locked_by)).toBe(true);
  });

  it("allows the same job again once the previous run has finished", async () => {
    await sql("update public.import_jobs set status = 'succeeded', finished_at = now() where account_id = $1", [t.accountId]);
    const again = await enqueue("dpd_sync", "2026-11-14");
    expect(again.status).toBe("queued");
  });

  it("returns crashed jobs to the queue and gives up after the attempt limit", async () => {
    await sql("update public.import_jobs set status = 'succeeded' where account_id = $1", [t.accountId]);
    const a = await enqueue("dropbox_sync", null, null);
    const b = await enqueue("anomaly_scan", null, null);
    await sql("update public.import_jobs set status = 'running', locked_at = now() - interval '2 hours', attempts = 1 where id = $1", [a.id]);
    await sql("update public.import_jobs set status = 'running', locked_at = now() - interval '2 hours', attempts = 3 where id = $1", [b.id]);
    await asService((run) => run("select public.release_stale_jobs(interval '30 minutes')"));
    const rows = await sql<{ id: string; status: string }>("select id, status from public.import_jobs where id in ($1, $2)", [a.id, b.id]);
    expect(rows.find((r) => r.id === a.id)!.status).toBe("queued");
    expect(rows.find((r) => r.id === b.id)!.status).toBe("failed");
  });
});

describe("audit log", () => {
  it("records pay adjustments, driver changes and cost allocations with the person who made them", async () => {
    const z = await createTestAccount();
    await asUser(z.ownerId, (run) => run("select public.create_pay_adjustment($1, $2, '2026-11-14', 'additional_payment', 50, 'Audit check')", [z.franchiseId, z.driverIds[0]]));
    await asUser(z.ownerId, (run) => run("update public.drivers set display_name = 'Alex Renamed', leaving_date = '2026-12-01' where id = $1", [z.driverIds[0]]));
    const logs = await sql<{ action: string; entity_table: string; actor_id: string | null; actor_type: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>(
      "select action, entity_table, actor_id, actor_type, before, after from public.audit_logs where account_id = $1 order by id", [z.accountId],
    );
    const adjustment = logs.find((l) => l.entity_table === "earnings_adjustments");
    expect(adjustment).toMatchObject({ action: "insert", actor_id: z.ownerId, actor_type: "user" });
    expect(adjustment!.after).toMatchObject({ reason: "Audit check" });
    const rename = logs.find((l) => l.entity_table === "drivers" && l.action === "update");
    expect(rename).toMatchObject({ actor_id: z.ownerId });
    expect(rename!.before).toMatchObject({ display_name: "Alex Example" });
    expect(rename!.after).toMatchObject({ display_name: "Alex Renamed" });
    expect(logs.some((l) => l.entity_table === "app_settings")).toBe(true);
  });

  it("is itself append-only", async () => {
    await expect(sql("delete from public.audit_logs where account_id = $1", [t.accountId])).rejects.toThrow(/append-only/);
    await expect(sql("update public.audit_logs set action = 'x' where account_id = $1", [t.accountId])).rejects.toThrow(/append-only/);
  });

  it("keeps history intact when a driver leaves or is renamed", async () => {
    const z = await createTestAccount();
    await ingestEarnings(z.fileId, [earningsRow(z)]);
    await asUser(z.ownerId, (run) => run("update public.drivers set display_name = 'Alexandra Example', is_active = false, leaving_date = '2026-11-30' where id = $1", [z.driverIds[0]]));
    const rows = await sql("select source_driver_name, driver_id from public.daily_earnings where account_id = $1", [z.accountId]);
    expect(rows).toEqual([{ source_driver_name: "Alex Example", driver_id: z.driverIds[0] }]);
    await expect(sql("delete from public.drivers where id = $1", [z.driverIds[0]])).rejects.toThrow(/violates foreign key|restrict/i);
  });
});
