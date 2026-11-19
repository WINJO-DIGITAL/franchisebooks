import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importDocument } from "@/lib/ingest/pipeline";
import { adminClient } from "../helpers/app";
import { createTestAccount, pool, sql, type TestAccount } from "../helpers/db";

const db = adminClient();
let t: TestAccount;
beforeAll(async () => {
  t = await createTestAccount("Charges VAT");
}, 60_000);
afterAll(() => pool.end());

const csv = (rows: string[]) =>
  Buffer.from([`Franchise: ${t.fdNumber},Report date: 09/11/2026`, "Category,Description,Spacer,Amount,Spacer 2,VAT,Date", ...rows, ""].join("\n"));
const upload = (name: string, bytes: Buffer) =>
  importDocument(db, { accountId: t.accountId, source: "dpd_portal", filename: name, bytes: new Uint8Array(bytes), uploadedBy: t.ownerId });
const stored = () => sql<{ description: string; amount: string; vat_amount: string | null }>(
  "select description, amount::text, vat_amount::text from public.expenses where account_id = $1 order by description", [t.accountId]);

describe("the VAT the portal states on a charge", () => {
  it("is stored beside the amount, which stays before VAT", async () => {
    const out = await upload(`charges_${t.fdNumber}_2026-11-09.csv`, csv(["Fixed costs,Management Fee,,£11.47,,2.29,09/11/2026", "Fixed costs,Admin Fee,,£5.00,,,09/11/2026"]));
    expect(out.inserted).toBe(2);
    expect(await stored()).toEqual([
      { description: "Admin Fee", amount: "5.00", vat_amount: null },
      { description: "Management Fee", amount: "11.47", vat_amount: "2.29" },
    ]);
  });

  it("is not added twice when the same charges are read again, even in a differently-built file", async () => {
    const again = await upload(`charges_${t.fdNumber}_2026-11-09_b.csv`, csv(["Fixed costs,Management Fee,,£11.47,,2.29,09/11/2026", "Fixed costs,Admin Fee,,£5.00,,,09/11/2026", ""]));
    expect(again.inserted).toBe(0);
    expect(await stored()).toHaveLength(2);
  });

  it("only adds the genuinely new charge when one appears", async () => {
    const more = await upload(`charges_${t.fdNumber}_2026-11-09_c.csv`, csv([
      "Fixed costs,Management Fee,,£11.47,,2.29,09/11/2026", "Fixed costs,Admin Fee,,£5.00,,,09/11/2026", "Variable costs,Temporary Van Hire,,£79.02,,15.80,09/11/2026",
    ]));
    expect(more.inserted).toBe(1);
    expect((await stored()).map((r) => r.description)).toEqual(["Admin Fee", "Management Fee", "Temporary Van Hire"]);
  });

  it("is filled in on a charge stored before the VAT was kept, without changing its amount or adding a copy", async () => {
    await sql("update public.expenses set vat_amount = null where account_id = $1 and description = 'Management Fee'", [t.accountId]);
    const filled = await upload(`charges_${t.fdNumber}_2026-11-09_d.csv`, csv([
      "Fixed costs,Management Fee,,£11.47,,2.29,09/11/2026", "Fixed costs,Admin Fee,,£5.00,,,09/11/2026", "Variable costs,Temporary Van Hire,,£79.02,,15.80,09/11/2026", "",
    ]));
    expect(filled.inserted).toBe(0);
    const rows = await stored();
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.description === "Management Fee")).toMatchObject({ amount: "11.47", vat_amount: "2.29" });
  });

  it("stores £15.00 before VAT and £3.00 VAT for a charge written as “£18.00 (incl. £3.00 VAT)”", async () => {
    const out = await upload(`charges_${t.fdNumber}_2026-11-09_e.csv`, csv([
      "Fixed costs,Management Fee,,£11.47,,2.29,09/11/2026", "Fixed costs,Admin Fee,,£5.00,,,09/11/2026", "Variable costs,Temporary Van Hire,,£79.02,,15.80,09/11/2026",
      "Variable costs,Vehicle Wash,,£18.00 (incl. £3.00 VAT),,,09/11/2026",
    ]));
    expect(out.inserted).toBe(1);
    expect((await stored()).find((r) => r.description === "Vehicle Wash")).toMatchObject({ amount: "15.00", vat_amount: "3.00" });
  });
});
