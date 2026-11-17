import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, asAnon, asUser, createAuthUser, createTestAccount, earningsRow, ingestEarnings, pool, sql, type TestAccount } from "../helpers/db";

let a: TestAccount;
let b: TestAccount;

beforeAll(async () => {
  a = await createTestAccount("Business A");
  b = await createTestAccount("Business B");
  await ingestEarnings(a.fileId, [earningsRow(a)]);
  await ingestEarnings(b.fileId, [earningsRow(b)]);
});
afterAll(() => pool.end());

const TABLES = [
  "accounts", "user_profiles", "franchises", "drivers", "driver_aliases", "driver_assignments", "daily_earnings",
  "earnings_adjustments", "driver_cover_records", "fuel_transactions", "expenses", "expense_categories", "expense_allocations",
  "imported_files", "import_jobs", "sync_logs", "anomalies", "monthly_reports", "audit_logs", "integration_connections",
  "integration_folders", "review_items", "revenue_entries", "app_settings", "user_franchise_access",
];

describe("authentication", () => {
  it("gives anonymous visitors no access to any table", async () => {
    for (const table of TABLES) {
      await expect(asAnon((run) => run(`select * from public.${table} limit 1`)), table).rejects.toThrow(/permission denied/);
    }
  });

  it("does not let anonymous visitors call any function", async () => {
    await expect(asAnon((run) => run("select public.bootstrap_account('x', 'y')"))).rejects.toThrow(/permission denied/);
    await expect(asAnon((run) => run("select public.ingest_earnings($1, '[]'::jsonb)", [a.fileId]))).rejects.toThrow(/permission denied/);
  });

  it("shows nothing to a signed-in user who has no business yet", async () => {
    const stranger = await createAuthUser("stranger");
    for (const table of TABLES) {
      const rows = await asUser(stranger, (run) => run(`select * from public.${table} limit 5`));
      expect(rows, table).toEqual([]);
    }
  });

  it("enables and forces row level security on every table", async () => {
    const rows = await sql<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(TABLES.length);
    for (const r of rows) expect(r.relrowsecurity && r.relforcerowsecurity, r.relname).toBe(true);
  });

  it("keeps stored integration secrets out of reach of signed-in users", async () => {
    await expect(asUser(a.ownerId, (run) => run("select * from app_private.integration_secrets"))).rejects.toThrow(/permission denied/);
    await expect(asUser(a.ownerId, (run) => run("select public.read_integration_secret($1)", [a.accountId]))).rejects.toThrow(/permission denied/);
  });
});

describe("isolation between businesses", () => {
  it("only ever returns the user's own business", async () => {
    for (const table of ["franchises", "drivers", "daily_earnings", "driver_assignments", "imported_files", "expense_categories"]) {
      const rows = await asUser(a.ownerId, (run) => run<{ account_id: string }>(`select account_id from public.${table}`));
      expect(rows.length, table).toBeGreaterThan(0);
      expect(rows.every((r) => r.account_id === a.accountId), table).toBe(true);
    }
  });

  it("cannot read another business's rows even by id", async () => {
    const rows = await asUser(a.ownerId, (run) => run("select id from public.franchises where id = $1", [b.franchiseId]));
    expect(rows).toEqual([]);
  });

  it("cannot write into another business", async () => {
    await expect(asUser(a.ownerId, (run) =>
      run("insert into public.drivers (account_id, display_name) values ($1, 'Intruder')", [b.accountId]),
    )).rejects.toThrow(/row-level security/);
    await expect(asUser(a.ownerId, (run) =>
      run("select public.create_pay_adjustment($1, $2, '2026-11-14', 'additional_payment', 50, 'Not mine')", [b.franchiseId, b.driverIds[0]]),
    )).rejects.toThrow();
    const updated = await asUser(a.ownerId, (run) => run("update public.drivers set display_name = 'Hacked' where id = $1 returning id", [b.driverIds[0]]));
    expect(updated).toEqual([]);
  });

  it("cannot move its own rows into another business", async () => {
    await expect(asUser(a.ownerId, (run) =>
      run("update public.drivers set account_id = $1 where id = $2", [b.accountId, a.driverIds[0]]),
    )).rejects.toThrow();
  });

  it("cannot record cover or allocate costs in another business", async () => {
    await expect(asUser(a.ownerId, (run) =>
      run("select public.record_driver_cover($1, '2026-11-14', $2, $3, null, null, 'none', 0, 0, 'original')", [b.franchiseId, b.driverIds[0], b.driverIds[1]]),
    )).rejects.toThrow(/permission/);
  });
});

describe("roles and franchise-level access", () => {
  let secondFranchise: string;
  let otherDriver: string;
  let limitedManager: string;
  let viewer: string;

  beforeAll(async () => {
    [{ id: secondFranchise }] = await sql<{ id: string }>(
      "insert into public.franchises (account_id, fd_number, name) values ($1, $2, 'Synthetic South') returning id", [a.accountId, `${a.fdNumber}-S`],
    ) as [{ id: string }];
    [{ id: otherDriver }] = await sql<{ id: string }>(
      "insert into public.drivers (account_id, display_name) values ($1, 'Southern Driver') returning id", [a.accountId],
    ) as [{ id: string }];
    await sql("insert into public.driver_assignments (account_id, driver_id, franchise_id, start_date) values ($1, $2, $3, '2026-01-01')", [a.accountId, otherDriver, secondFranchise]);
    const file = await sql<{ id: string }>(
      `insert into public.imported_files (account_id, franchise_id, source, original_filename, byte_size, sha256)
       values ($1, $2, 'manual_upload', 's.pdf', 1, encode(sha256(gen_random_uuid()::text::bytea), 'hex')) returning id`, [a.accountId, secondFranchise],
    );
    await ingestEarnings(file[0]!.id, [earningsRow(a, { franchise_id: secondFranchise, driver_id: otherDriver, driver_key: "name:southern driver", source_driver_name: "Southern Driver" })]);
    limitedManager = await addMember(a.accountId, "manager", [a.franchiseId]);
    viewer = await addMember(a.accountId, "viewer", "all");
  });

  it("a manager limited to one franchise sees only that franchise's data", async () => {
    const franchises = await asUser(limitedManager, (run) => run<{ id: string }>("select id from public.franchises"));
    expect(franchises.map((f) => f.id)).toEqual([a.franchiseId]);
    const earnings = await asUser(limitedManager, (run) => run<{ franchise_id: string }>("select franchise_id from public.daily_earnings"));
    expect(earnings.length).toBeGreaterThan(0);
    expect(earnings.every((e) => e.franchise_id === a.franchiseId)).toBe(true);
    const drivers = await asUser(limitedManager, (run) => run<{ id: string }>("select id from public.drivers"));
    expect(drivers.map((d) => d.id).sort()).toEqual([...a.driverIds].sort());
  });

  it("a limited manager cannot adjust pay in a franchise they cannot see", async () => {
    await expect(asUser(limitedManager, (run) =>
      run("select public.create_pay_adjustment($1, $2, '2026-11-14', 'additional_payment', 50, 'No access')", [secondFranchise, otherDriver]),
    )).rejects.toThrow();
    const ok = await asUser(limitedManager, (run) =>
      run("select (public.create_pay_adjustment($1, $2, '2026-11-14', 'additional_payment', 50, 'Allowed franchise')).id", [a.franchiseId, a.driverIds[0]]),
    );
    expect(ok).toHaveLength(1);
  });

  it("a viewer can read but cannot change anything", async () => {
    const rows = await asUser(viewer, (run) => run("select id from public.daily_earnings"));
    expect(rows.length).toBeGreaterThan(0);
    await expect(asUser(viewer, (run) =>
      run("select public.create_pay_adjustment($1, $2, '2026-11-14', 'additional_payment', 50, 'Viewer attempt')", [a.franchiseId, a.driverIds[0]]),
    )).rejects.toThrow(/row-level security/);
    await expect(asUser(viewer, (run) => run("insert into public.drivers (account_id, display_name) values ($1, 'Nope')", [a.accountId]))).rejects.toThrow(/row-level security/);
    const updated = await asUser(viewer, (run) => run("update public.drivers set display_name = 'Nope' where account_id = $1 returning id", [a.accountId]));
    expect(updated).toEqual([]);
    expect(await asUser(viewer, (run) => run("select id from public.audit_logs"))).toEqual([]);
  });

  it("only an owner can add franchises or change settings", async () => {
    const manager = await addMember(a.accountId, "manager", "all");
    await expect(asUser(manager, (run) => run("insert into public.franchises (account_id, fd_number) values ($1, 'FD-NOPE')", [a.accountId]))).rejects.toThrow(/row-level security/);
    const changed = await asUser(manager, (run) => run("update public.app_settings set sync_enabled = false where account_id = $1 returning account_id", [a.accountId]));
    expect(changed).toEqual([]);
    const ownerChanged = await asUser(a.ownerId, (run) => run("update public.app_settings set sync_time_local = '21:00' where account_id = $1 returning account_id", [a.accountId]));
    expect(ownerChanged).toHaveLength(1);
  });

  it("an owner can add a franchise and read it straight back", async () => {
    const rows = await asUser(a.ownerId, (run) =>
      run<{ id: string }>("insert into public.franchises (account_id, fd_number, name) values ($1, $2, 'Readback') returning id", [a.accountId, `${a.fdNumber}-RB`]),
    );
    expect(rows).toHaveLength(1);
  });

  it("nobody can change their own role", async () => {
    await expect(asUser(viewer, (run) => run("update public.user_profiles set role = 'owner' where id = $1", [viewer]))).rejects.toThrow(/permission denied/);
  });
});

describe("account setup", () => {
  it("creates the default expense categories and settings once", async () => {
    const categories = await sql<{ name: string }>("select name from public.expense_categories where account_id = $1 order by sort_order", [a.accountId]);
    expect(categories.map((c) => c.name)).toEqual([
      "Fuel", "Vehicle maintenance", "Repairs", "Tyres", "Insurance", "Vehicle hire", "Parking", "Equipment", "Other operating expenses",
    ]);
    await expect(asUser(a.ownerId, (run) => run("select public.bootstrap_account('Again', 'Owner')"))).rejects.toThrow(/already belongs/);
  });

  it("lets the owner add extra categories but not duplicates", async () => {
    await asUser(a.ownerId, (run) => run("insert into public.expense_categories (account_id, name) values ($1, 'Uniform')", [a.accountId]));
    await expect(asUser(a.ownerId, (run) => run("insert into public.expense_categories (account_id, name) values ($1, 'uniform')", [a.accountId]))).rejects.toThrow(/duplicate/);
  });
});
