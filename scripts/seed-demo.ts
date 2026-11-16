/**
 * Adds synthetic demo data so every screen has something to show.
 *
 *   npm run seed:demo
 *
 * LOCAL AND PREVIEW ONLY. It refuses to run against production (see
 * scripts/lib/guard.ts). Everything it adds is invented. Because financial
 * records in this system can never be deleted, the way to start again is
 * `npm run db:reset` on a local database.
 */

import { randomBytes } from "node:crypto";
import { addDays, londonToday, weekdayOf } from "../src/lib/dates";
import { anonClient, serviceClient } from "./lib/client";
import { DEMO_DRIVERS, DEMO_EXPENSES, DEMO_FRANCHISES, fakeSha256, generateEarnings, generateFuel, PAY_PER_PARCEL, PAY_PER_STOP } from "./lib/demo-data";
import { loadEnvFiles } from "./lib/env";
import { checkDemoSeedAllowed, DEMO_ACCOUNT_NAME, DEMO_EMAIL } from "./lib/guard";

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

async function main() {
  loadEnvFiles();
  const { client: db, url } = serviceClient();

  const guard = checkDemoSeedAllowed({ supabaseUrl: url, env: process.env });
  if (!guard.allowed) fail(guard.reason);
  console.log(`Target: ${guard.target} — ${guard.reason}`);

  // On anything that is not a local database, refuse if any real-looking business is already there.
  if (guard.target !== "local") {
    const { data: accounts, error } = await db.from("accounts").select("name");
    if (error) fail(`Could not check the database first: ${error.message}`);
    if ((accounts ?? []).some((a) => a.name !== DEMO_ACCOUNT_NAME)) {
      fail("This database already contains a business that is not the demo business. Demo data was not added.");
    }
  }

  // 1. The demo sign-in.
  const password = process.env.DEMO_PASSWORD?.trim() || randomBytes(12).toString("base64url");
  const generated = !process.env.DEMO_PASSWORD?.trim();
  const { data: existingUsers, error: listError } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) fail(`Could not look up users: ${listError.message}`);
  const existing = existingUsers.users.find((u) => u.email === DEMO_EMAIL);
  if (existing) {
    const { data: profile } = await db.from("user_profiles").select("account_id").eq("id", existing.id).maybeSingle();
    if (profile) {
      console.log("\nDemo data is already in place. Nothing was added.");
      console.log("To start again on a local database run: npm run db:reset && npm run seed:demo\n");
      return;
    }
  }
  const userId =
    existing?.id ??
    (await (async () => {
      const { data, error } = await db.auth.admin.createUser({ email: DEMO_EMAIL, password, email_confirm: true, user_metadata: { demo: true } });
      if (error || !data.user) fail(`Could not create the demo user: ${error?.message ?? "unknown error"}`);
      return data.user.id;
    })());
  if (existing) await db.auth.admin.updateUserById(userId, { password });

  // 2. The business, created the same way the onboarding screen does it.
  const owner = anonClient();
  const signIn = await owner.auth.signInWithPassword({ email: DEMO_EMAIL, password });
  if (signIn.error) fail(`Could not sign in as the demo user: ${signIn.error.message}`);
  const boot = await owner.rpc("bootstrap_account", { p_business_name: DEMO_ACCOUNT_NAME, p_full_name: "Demo Owner" });
  if (boot.error || !boot.data) fail(`Could not create the demo business: ${boot.error?.message ?? "no id returned"}`);
  const accountId = boot.data as string;

  // 3. Franchises, drivers and assignments.
  const dates: string[] = [];
  const today = londonToday();
  for (let i = 30; i >= 1; i--) dates.push(addDays(today, -i));
  const isWeekday = (d: string) => weekdayOf(d) >= 1 && weekdayOf(d) <= 5;
  const start = dates[0]!;

  const { data: franchises, error: fErr } = await db
    .from("franchises")
    .insert(DEMO_FRANCHISES.map((f) => ({ account_id: accountId, fd_number: f.fd, name: f.name, depot: f.depot })))
    .select("id, fd_number");
  if (fErr || !franchises) fail(`Could not add franchises: ${fErr?.message}`);
  const franchiseId = (index: number) => franchises.find((f) => f.fd_number === DEMO_FRANCHISES[index]!.fd)!.id;

  const { data: drivers, error: dErr } = await db
    .from("drivers")
    .insert(DEMO_DRIVERS.map((d) => ({ account_id: accountId, display_name: d.name, dpd_driver_ref: d.ref, start_date: start, created_by: userId })))
    .select("id, dpd_driver_ref");
  if (dErr || !drivers) fail(`Could not add drivers: ${dErr?.message}`);
  const driverId = (ref: string) => drivers.find((d) => d.dpd_driver_ref === ref)!.id;

  await db.from("driver_aliases").insert(DEMO_DRIVERS.map((d) => ({ account_id: accountId, driver_id: driverId(d.ref), alias_normalised: d.name.toLowerCase(), alias_display: d.name })));
  const { error: aErr } = await db.from("driver_assignments").insert(
    DEMO_DRIVERS.map((d) => ({ account_id: accountId, driver_id: driverId(d.ref), franchise_id: franchiseId(d.franchise), route: d.route, vehicle_registration: d.reg, start_date: start, created_by: userId })),
  );
  if (aErr) fail(`Could not add driver assignments: ${aErr.message}`);

  // 4. One synthetic source document per franchise, then the earnings rows.
  const fileIds: string[] = [];
  for (let i = 0; i < DEMO_FRANCHISES.length; i++) {
    const { data: file, error } = await db
      .from("imported_files")
      .insert({
        account_id: accountId,
        franchise_id: franchiseId(i),
        source: "manual_upload",
        original_filename: `demo-earnings-${DEMO_FRANCHISES[i]!.fd}.csv`,
        mime_type: "text/csv",
        byte_size: 0,
        sha256: fakeSha256(`earnings-${i}`),
        document_type: "earnings_report",
        report_date_from: start,
        report_date_to: dates[dates.length - 1]!,
        status: "imported",
        parser: "demo-seed",
        parse_confidence: 1,
        status_message: "Synthetic demo data.",
        uploaded_by: userId,
        processed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !file) fail(`Could not record the demo document: ${error?.message}`);
    fileIds.push(file.id);
  }

  const earnings = generateEarnings(dates, isWeekday);
  const { error: eErr } = await db.from("daily_earnings").insert(
    earnings.map((e) => ({
      account_id: accountId,
      franchise_id: franchiseId(e.driver.franchise),
      driver_id: driverId(e.driver.ref),
      source_driver_name: e.driver.name,
      source_driver_ref: e.driver.ref,
      driver_key: e.driver.ref,
      report_date: e.date,
      route: e.driver.route,
      parcels: e.parcels,
      stops: e.stops,
      pay_per_parcel: PAY_PER_PARCEL,
      pay_per_stop: PAY_PER_STOP,
      gross_earnings: e.gross,
      deductions: e.deductions,
      additional_payments: e.additional,
      net_earnings: e.net,
      imported_file_id: fileIds[e.driver.franchise]!,
      source: "manual_upload" as const,
      extraction_confidence: 1,
    })),
  );
  if (eErr) fail(`Could not add earnings: ${eErr.message}`);

  // 5. Fuel (most allocated to a driver) and a few expenses (left unallocated to show the review path).
  const fuel = generateFuel(dates, isWeekday);
  const { data: fuelRows, error: fuelErr } = await db
    .from("fuel_transactions")
    .insert(
      fuel.map((f) => ({
        account_id: accountId,
        franchise_id: franchiseId(f.franchise),
        transaction_date: f.date,
        description: "Demo fuel",
        supplier: "Demo Fuels",
        vehicle_registration: f.reg,
        litres: f.litres,
        price_per_litre: f.pricePerLitre,
        total_cost: f.total,
        transaction_ref: f.ref,
        source: "manual_upload" as const,
        dedupe_key: f.ref,
        created_by: userId,
      })),
    )
    .select("id, vehicle_registration");
  if (fuelErr || !fuelRows) fail(`Could not add fuel: ${fuelErr?.message}`);
  const byReg = new Map(DEMO_DRIVERS.map((d) => [d.reg, d]));
  const { error: allocErr } = await db.from("expense_allocations").insert(
    fuelRows.map((row) => ({
      account_id: accountId,
      fuel_transaction_id: row.id,
      scope: "driver" as const,
      driver_id: driverId(byReg.get(row.vehicle_registration ?? "")!.ref),
      method: "auto_vehicle" as const,
    })),
  );
  if (allocErr) fail(`Could not allocate fuel: ${allocErr.message}`);

  const { data: categories } = await db.from("expense_categories").select("id, name").eq("account_id", accountId);
  const { error: xErr } = await db.from("expenses").insert(
    DEMO_EXPENSES.map((x, i) => ({
      account_id: accountId,
      franchise_id: franchiseId(x.franchise),
      category_id: categories!.find((c) => c.name === x.category)!.id,
      expense_date: addDays(today, -x.offset),
      description: x.description,
      supplier: "Demo Supplier",
      amount: x.amount,
      source: "manual_entry" as const,
      dedupe_key: `demo-expense-${i}`,
      created_by: userId,
    })),
  );
  if (xErr) fail(`Could not add expenses: ${xErr.message}`);

  console.log(`\n✓ Demo business "${DEMO_ACCOUNT_NAME}" added: 2 franchises, ${DEMO_DRIVERS.length} drivers, ${earnings.length} earnings rows, ${fuel.length} fuel transactions, ${DEMO_EXPENSES.length} expenses.`);
  console.log(`\n  Sign in with:  ${DEMO_EMAIL}`);
  console.log(generated ? `  Password:      ${password}   (made up just now; shown once)\n` : "  Password:      the DEMO_PASSWORD you set\n");
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
