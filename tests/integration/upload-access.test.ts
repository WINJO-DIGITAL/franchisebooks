import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importDocument } from "@/lib/ingest/pipeline";
import { adminClient } from "../helpers/app";
import { addMember, createTestAccount, pool, sql, type TestAccount } from "../helpers/db";
import { earningsPdf, fuelCsv } from "../fixtures/synthetic";

// A manager who covers only North uploads files. Anything for South must be refused, with nothing stored.
const db = adminClient();
let t: TestAccount;
let southId: string;
let southFd: string;
let managerId: string;

beforeAll(async () => {
  t = await createTestAccount("Upload Access Couriers");
  southFd = `${t.fdNumber}S`;
  const [south] = await sql<{ id: string }>("insert into public.franchises (account_id, fd_number, name) values ($1, $2, 'Synthetic South') returning id", [t.accountId, southFd]);
  southId = south!.id;
  const [sam] = await sql<{ id: string }>("insert into public.drivers (account_id, display_name) values ($1, 'Sam Southern') returning id", [t.accountId]);
  await sql("insert into public.driver_assignments (account_id, driver_id, franchise_id, start_date, vehicle_registration) values ($1, $2, $3, '2026-01-01', 'SO26UTH')", [t.accountId, sam!.id, southId]);
  managerId = await addMember(t.accountId, "manager", [t.franchiseId]);
});
afterAll(() => pool.end());

const asNorthManager = (filename: string, bytes: Buffer, extra: Record<string, unknown> = {}) =>
  importDocument(db, {
    accountId: t.accountId, source: "manual_upload", filename, bytes: new Uint8Array(bytes), uploadedBy: managerId,
    allowedFranchiseIds: [t.franchiseId], ...extra,
  });

describe("uploads by a manager limited to some franchises", () => {
  it("refuses an earnings report for a franchise they do not cover, storing nothing", async () => {
    const pdf = await earningsPdf({ fdNumber: southFd, date: "2026-11-10" });
    const outcome = await asNorthManager("south-earnings.pdf", pdf);
    expect(outcome.status).toBe("failed");
    expect(outcome.inserted).toBe(0);
    expect(outcome.message).toBe(`“south-earnings.pdf” is for ${southFd}, which your login doesn't cover. Ask the owner to upload it. Nothing was imported.`);
    expect(await sql("select id from public.daily_earnings where account_id = $1", [t.accountId])).toHaveLength(0);
    expect(await sql("select id from public.review_items where imported_file_id = $1", [outcome.fileId])).toHaveLength(0);
    expect(await sql("select id from public.drivers where account_id = $1 and display_name <> all(array['Alex Example','Blake Sample','Sam Southern'])", [t.accountId])).toHaveLength(0);
    const [file] = await sql<{ status: string; storage_path: string }>("select status, storage_path from public.imported_files where id = $1", [outcome.fileId]);
    expect(file!.status).toBe("failed");
    const { data: kept } = await db.storage.from("source-documents").download(file!.storage_path);
    expect(kept).toBeNull();
  });

  it("still lets the owner import that same file afterwards", async () => {
    const pdf = await earningsPdf({ fdNumber: southFd, date: "2026-11-10" });
    const outcome = await importDocument(db, { accountId: t.accountId, source: "manual_upload", filename: "south-earnings.pdf", bytes: new Uint8Array(pdf), uploadedBy: t.ownerId });
    expect(outcome).toMatchObject({ status: "imported", inserted: 4 });
    expect(await sql("select id from public.daily_earnings where account_id = $1 and franchise_id = $2", [t.accountId, southId])).toHaveLength(4);
  });

  it("imports a report for a franchise they do cover as before", async () => {
    const outcome = await asNorthManager("north-earnings.pdf", await earningsPdf({ fdNumber: t.fdNumber, date: "2026-11-11" }));
    expect(outcome).toMatchObject({ status: "imported", inserted: 4 });
  });

  it("refuses a fuel file naming no franchise when a row belongs to a franchise they do not cover", async () => {
    const csv = fuelCsv([{ date: "2026-11-12", registration: "SO26 UTH", site: "Synthetic Services", litres: 40, pricePerLitre: 1.5, reference: "TX-SOUTH-1" }]);
    const outcome = await asNorthManager("fuel-no-fd.csv", csv);
    expect(outcome.status).toBe("failed");
    expect(outcome.message).toContain(`is for ${southFd}, which your login doesn't cover`);
    expect(await sql("select id from public.fuel_transactions where account_id = $1", [t.accountId])).toHaveLength(0);
  });

  it("imports that fuel file when they choose their own franchise at upload", async () => {
    const csv = fuelCsv([{ date: "2026-11-13", registration: "AB99 XYZ", site: "Synthetic Services", litres: 40, pricePerLitre: 1.5, reference: "TX-NORTH-1" }]);
    const outcome = await asNorthManager("fuel-north.csv", csv, { franchiseHintId: t.franchiseId });
    expect(outcome).toMatchObject({ status: "imported", inserted: 1 });
  });
});
