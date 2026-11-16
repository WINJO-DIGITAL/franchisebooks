/**
 * Database test helpers. These talk to the LOCAL Supabase Postgres directly
 * so tests can act as different roles (signed-in user, anonymous, service).
 */

import { randomUUID } from "node:crypto";
import pg from "pg";

const url = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!/127\.0\.0\.1|localhost/.test(url)) {
  throw new Error("Database tests only run against a local database. Refusing to use " + url.replace(/:[^:@/]+@/, ":***@"));
}

export const pool = new pg.Pool({ connectionString: url, max: 4 });

/** Runs SQL as the database owner (bypasses RLS) — for arranging test data only. */
export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

type Run = <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]) => Promise<T[]>;

async function withRole<T>(role: "authenticated" | "anon" | "service_role", userId: string | null, fn: (run: Run) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(userId ? { sub: userId, role } : { role })]);
    await client.query(`set local role ${role}`);
    const run: Run = async (text, params = []) => (await client.query(text, params)).rows;
    const value = await fn(run);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Runs queries exactly as a signed-in user would through the Data API (RLS enforced). */
export const asUser = <T>(userId: string, fn: (run: Run) => Promise<T>) => withRole("authenticated", userId, fn);
export const asAnon = <T>(fn: (run: Run) => Promise<T>) => withRole("anon", null, fn);
export const asService = <T>(fn: (run: Run) => Promise<T>) => withRole("service_role", null, fn);

export async function createAuthUser(label = "user"): Promise<string> {
  const id = randomUUID();
  await sql(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now(), '{}', '{}')`,
    [id, `${label}-${id.slice(0, 8)}@example.test`],
  );
  return id;
}

export interface TestAccount {
  accountId: string;
  ownerId: string;
  franchiseId: string;
  fdNumber: string;
  driverIds: [string, string];
  fileId: string;
}

let counter = 0;

/** A fresh, isolated business with one franchise and two drivers (all synthetic). */
export async function createTestAccount(name = "Synthetic Couriers"): Promise<TestAccount> {
  const ownerId = await createAuthUser("owner");
  const [{ id: accountId }] = await asUser(ownerId, (run) => run<{ id: string }>("select public.bootstrap_account($1, $2) as id", [name, "Test Owner"])) as [{ id: string }];
  const fdNumber = `FD-T${Date.now().toString(36).toUpperCase()}${++counter}`;
  const [{ id: franchiseId }] = await sql<{ id: string }>(
    "insert into public.franchises (account_id, fd_number, name) values ($1, $2, 'Synthetic North') returning id", [accountId, fdNumber],
  ) as [{ id: string }];
  const drivers = await sql<{ id: string }>(
    `insert into public.drivers (account_id, display_name, dpd_driver_ref) values ($1, 'Alex Example', $2), ($1, 'Blake Sample', $3) returning id`,
    [accountId, `T${counter}A`, `T${counter}B`],
  );
  for (const d of drivers) {
    await sql("insert into public.driver_assignments (account_id, driver_id, franchise_id, start_date) values ($1, $2, $3, '2026-01-01')", [accountId, d.id, franchiseId]);
  }
  const fileId = await createFile(accountId, franchiseId);
  return { accountId, ownerId, franchiseId, fdNumber, driverIds: [drivers[0]!.id, drivers[1]!.id], fileId };
}

export async function createFile(accountId: string, franchiseId: string | null, source = "manual_upload"): Promise<string> {
  const [row] = await sql<{ id: string }>(
    `insert into public.imported_files (account_id, franchise_id, source, original_filename, byte_size, sha256)
     values ($1, $2, $3, 'synthetic.pdf', 1, encode(sha256(gen_random_uuid()::text::bytea), 'hex')) returning id`,
    [accountId, franchiseId, source],
  );
  return row!.id;
}

export async function addMember(accountId: string, role: "manager" | "viewer", franchiseIds: string[] | "all"): Promise<string> {
  const userId = await createAuthUser(role);
  await sql("insert into public.user_profiles (id, account_id, full_name, role, all_franchises) values ($1, $2, $3, $4, $5)", [
    userId, accountId, `Test ${role}`, role, franchiseIds === "all",
  ]);
  if (franchiseIds !== "all") {
    for (const f of franchiseIds) await sql("insert into public.user_franchise_access (user_id, franchise_id) values ($1, $2)", [userId, f]);
  }
  return userId;
}

export function earningsRow(account: TestAccount, overrides: Record<string, unknown> = {}) {
  return {
    franchise_id: account.franchiseId, driver_id: account.driverIds[0], source_driver_name: "Alex Example", source_driver_ref: "",
    driver_key: "name:alex example", report_date: "2026-11-14", route: "", parcels: "140", stops: "100", pay_per_parcel: "0.4500",
    pay_per_stop: "0.8500", gross_earnings: "148.00", deductions: "0.00", additional_payments: "0.00", net_earnings: "148.00",
    confidence: "1", ...overrides,
  };
}

export async function ingestEarnings(fileId: string, rows: unknown[]): Promise<{ inserted: number; unchanged: number; conflicts: number }> {
  const [row] = await asService((run) => run<{ result: { inserted: number; unchanged: number; conflicts: number } }>(
    "select public.ingest_earnings($1, $2::jsonb) as result", [fileId, JSON.stringify(rows)],
  ));
  return row!.result;
}
