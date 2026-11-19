/**
 * Loads SYNTHETIC demonstration data into a LOCAL database so the app can be
 * explored before real data is connected. Every name, number and figure is
 * invented. Refuses to run against anything but localhost.
 *
 *   npm run seed:demo
 *
 * Signs in as demo@example.test / demo-password-123.
 */
import { createClient } from "@supabase/supabase-js";
import { addDays, londonToday, weekdayOf } from "@/lib/dates";
import { runAnomalyScan } from "@/lib/anomalies/run";
import { importDocument } from "@/lib/ingest/pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { arg, loadLocalEnv } from "./lib/env";
import { checkDemoSeedAllowed } from "./lib/guard";

loadLocalEnv();
const allowed = checkDemoSeedAllowed({ supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", env: process.env });
if (!allowed.allowed) {
  console.error(`\n✗ ${allowed.reason}\n`);
  process.exit(1);
}

const EMAIL = "demo@example.test";
const PASSWORD = "demo-password-123";
const DRIVERS = [
  { name: "Alex Example", ref: "D001", base: 112 },
  { name: "Blake Sample", ref: "D002", base: 98 },
  { name: "Casey Testcase", ref: "D003", base: 124 },
  { name: "Jordan Lookalike", ref: "D004", base: 90 },
];

function pseudo(seed: number): () => number {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
}

async function main() {
  const admin = createAdminClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true }).catch(() => undefined);
  const user = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const login = await user.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (login.error) throw new Error(login.error.message);
  const { data: profile } = await user.from("user_profiles").select("account_id").maybeSingle();
  if (profile) {
    console.log("Demo data already exists. To start again run: npm run db:reset");
    return;
  }
  const { data: accountId, error } = await user.rpc("bootstrap_account", { p_business_name: "Demo Couriers (synthetic)", p_full_name: "Demo Owner" });
  if (error) throw new Error(error.message);
  const account = accountId as string;

  const { data: franchise } = await user.from("franchises").insert({ account_id: account, fd_number: "FD-DEMO-1", name: "Synthetic North" }).select("id").single();
  const franchiseId = franchise!.id;
  const driverIds: string[] = [];
  for (const [i, d] of DRIVERS.entries()) {
    if (i === DRIVERS.length - 1) {
      // Two drivers share the last name and neither is linked to the franchise, so DPD's report lines for that name cannot be
      // matched to one of them. (Names nobody has registered are added automatically; a name that fits two people is left
      // for the owner to sort out.) This lets the "unmatched name" flow be tried.
      for (let twin = 0; twin < 2; twin++) await user.from("drivers").insert({ account_id: account, display_name: d.name, start_date: "2026-01-05" });
      continue;
    }
    const { data: row } = await user.from("drivers").insert({ account_id: account, display_name: d.name, dpd_driver_ref: d.ref, start_date: "2026-01-05" }).select("id").single();
    driverIds.push(row!.id);
    await user.from("driver_assignments").insert({ account_id: account, driver_id: row!.id, franchise_id: franchiseId, start_date: "2026-01-05", route: `R0${i + 1}`, vehicle_registration: ["AB12CDE", "XY21ZZZ", "LM70QRS"][i] });
  }

  const today = londonToday();
  const rnd = pseudo(42);
  const days = Number(arg("days", "35"));
  let imported = 0;
  for (let offset = days; offset >= 1; offset--) {
    const date = addDays(today, -offset);
    if (weekdayOf(date) === 0) continue;
    const [y, m, d] = date.split("-");
    const lines = ["Date,Driver ID,Driver,Route,Parcels,Stops,Pay per parcel,Pay per stop,Gross,Deductions,Additional,Net"];
    let gross = 0;
    let parcels = 0;
    let stops = 0;
    for (const [i, driver] of DRIVERS.entries()) {
      // Driver 2 has a quiet day about a week ago, to show an explainable alert.
      const quiet = i === 1 && offset === 7;
      if (i === 2 && offset === 3) continue; // a missing report line
      const s = Math.round(driver.base * (quiet ? 0.5 : 0.9 + rnd() * 0.2));
      const p = Math.round(s * (1.2 + rnd() * 0.2));
      const g = Math.round((p * 45 + s * 85) ) / 100;
      const ded = i === 0 && offset % 11 === 0 ? 12.5 : 0;
      lines.push([`${d}/${m}/${y}`, driver.ref, driver.name, `R0${i + 1}`, p, s, "0.45", "0.85", g.toFixed(2), ded.toFixed(2), "0.00", (g - ded).toFixed(2)].join(","));
      gross += g - ded;
      parcels += p;
      stops += s;
    }
    lines.push(`Total,,,,${parcels},${stops},,,,,,${gross.toFixed(2)}`.replace(/,,,,,,,,,,,/, ",,,,,,,,,,,"));
    await importDocument(admin, { accountId: account, source: "manual_upload", filename: `demo-earnings-${date}.csv`, bytes: new Uint8Array(Buffer.from(lines.join("\n"))), franchiseHintId: franchiseId });
    imported++;
  }
  // Fuel and a couple of expenses.
  const fuel = ["Date,Time,Card,Registration,Site,Product,Litres,PPL,Total,Reference"];
  for (let w = 5; w >= 0; w--) {
    for (const [i, reg] of ["AB12 CDE", "XY21 ZZZ", "LM70 QRS"].entries()) {
      const date = addDays(today, -(w * 7 + 2 + i));
      const [y, m, d] = date.split("-");
      const litres = 48 + Math.round(rnd() * 12);
      fuel.push(`${d}/${m}/${y},07:${10 + i}0,****${1000 + i},${reg},Synthetic Services,Diesel,${litres}.00,1.459,${(litres * 1.459).toFixed(2)},DEMO-F-${w}-${i}`);
    }
  }
  await importDocument(admin, { accountId: account, source: "manual_upload", filename: "demo-fuel.csv", bytes: new Uint8Array(Buffer.from(fuel.join("\n"))), franchiseHintId: franchiseId });
  const monthStart = `${today.slice(0, 7)}-01`;
  await user.from("revenue_entries").insert({ account_id: account, franchise_id: franchiseId, period_start: monthStart, period_end: today.slice(0, 7) + "-" + String(new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0"), amount: "9500.00", status: "estimated", description: "Synthetic estimate", created_by: login.data.user.id });
  await user.rpc("create_pay_adjustment", { p_franchise_id: franchiseId, p_driver_id: driverIds[0]!, p_earnings_date: addDays(today, -4), p_type: "additional_payment", p_amount: 50 as unknown as number, p_reason: "Covered an extra route (demo)" });
  // One synthetic DPD invoice whose stop-pay line is far below the daily payments we hold, so the cross-check (the app's only alert)
  // has something to show. All figures invented.
  const periodStart = addDays(today, -28);
  const periodEnd = addDays(today, -1);
  await admin.from("dpd_invoices").insert({
    account_id: account, franchise_id: franchiseId, invoice_no: "FI-DEMO-1", invoice_date: periodEnd, due_date: periodEnd, period_start: periodStart, period_end: periodEnd,
    net_total: 1000, vat_total: 200, invoice_total: 1200, reconciled: true, problems: [],
    lines: [{ description: "Successful collection and delivery stops Monday - Friday", quantity: 400, rate: "Various", amount: 100000, vatCode: "S" }] as never,
  });
  await runAnomalyScan(admin, account, { from: addDays(today, -35), to: today });
  console.log(`Demo data loaded: ${imported} days of synthetic earnings, fuel, one adjustment and an estimated revenue figure.\nSign in with ${EMAIL} / ${PASSWORD}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
