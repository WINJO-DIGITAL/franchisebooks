import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestAccount, pool, sql, type TestAccount } from "../helpers/db";

let a: TestAccount;
let other: TestAccount;

beforeAll(async () => {
  a = await createTestAccount("Dates Ltd");
  other = await createTestAccount("Other Dates Ltd");
});
afterAll(() => pool.end());

function insertDate(values: Record<string, unknown>) {
  const keys = Object.keys(values);
  const columns = ["account_id", ...keys].join(", ");
  const placeholders = ["$1", ...keys.map((_, i) => `$${i + 2}`)].join(", ");
  return asUser(a.ownerId, (run) =>
    run(`insert into public.compliance_dates (${columns}) values (${placeholders})`, [a.accountId, ...keys.map((k) => values[k])]),
  );
}

describe("compliance dates", () => {
  it("stores a driver's licence date against the driver", async () => {
    await insertDate({ subject_type: "driver", driver_id: a.driverIds[0], kind: "driver_licence", expires_on: "2027-03-01" });
    const [row] = await sql<{ subject_type: string; driver_id: string; vehicle_registration: string | null }>(
      "select subject_type, driver_id, vehicle_registration from public.compliance_dates where account_id = $1 and kind = 'driver_licence'",
      [a.accountId],
    );
    expect(row).toEqual({ subject_type: "driver", driver_id: a.driverIds[0], vehicle_registration: null });
  });

  it("stores a van's MOT date against the registration", async () => {
    await insertDate({ subject_type: "vehicle", vehicle_registration: "AB12CDE", kind: "mot", expires_on: "2026-12-10" });
    const rows = await sql("select kind from public.compliance_dates where account_id = $1 and vehicle_registration = 'AB12CDE'", [a.accountId]);
    expect(rows).toEqual([{ kind: "mot" }]);
  });

  it("refuses a driver date on a van, and a van date on a driver", async () => {
    await expect(insertDate({ subject_type: "vehicle", vehicle_registration: "ZZ99ZZZ", kind: "driver_licence", expires_on: "2027-01-01" })).rejects.toThrow(/compliance_dates_check/);
    await expect(insertDate({ subject_type: "driver", driver_id: a.driverIds[0], kind: "mot", expires_on: "2027-01-01" })).rejects.toThrow(/compliance_dates_check/);
  });

  it("refuses a registration with spaces or lower case, and a date with no subject", async () => {
    await expect(insertDate({ subject_type: "vehicle", vehicle_registration: "ab12 cde", kind: "mot", expires_on: "2027-01-01" })).rejects.toThrow(/compliance_dates_vehicle_registration_check/);
    await expect(insertDate({ subject_type: "vehicle", kind: "mot", expires_on: "2027-01-01" })).rejects.toThrow();
  });

  it("does not show one business another business's dates", async () => {
    const seen = await asUser(other.ownerId, (run) => run("select id from public.compliance_dates where account_id = $1", [a.accountId]));
    expect(seen).toEqual([]);
  });

  it("removes a driver's dates when the driver is deleted", async () => {
    const [d] = await sql<{ id: string }>("insert into public.drivers (account_id, display_name) values ($1, 'Short Stay') returning id", [a.accountId]);
    await insertDate({ subject_type: "driver", driver_id: d!.id, kind: "dbs", expires_on: "2027-02-02" });
    await sql("delete from public.drivers where id = $1", [d!.id]);
    const left = await sql("select id from public.compliance_dates where driver_id = $1", [d!.id]);
    expect(left).toEqual([]);
  });
});
