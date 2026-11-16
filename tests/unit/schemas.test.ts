import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isoDate, moneyAmount, optionalIsoDate, optionalText, optionalUuid, registration, uuid } from "@/lib/actions/schemas";
import { dbFailure, fail, ok, parseForm } from "@/lib/actions/helpers";

const VALID_UUID = "3f2b8c1e-6a4d-4e7b-9c0a-1d2e3f4a5b6c";

describe("moneyAmount", () => {
  it.each([["50", 5000], ["£50.00", 5000], ["1,250.50", 125050], ["0", 0], ["0.07", 7]])("reads %s as %i pence", (input, pence) => {
    expect(moneyAmount.parse(input)).toBe(pence);
  });

  it.each(["", "abc", "-5", "1e3", "100001"])("rejects %j with a plain-English message", (input) => {
    const result = moneyAmount.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]!.message).toMatch(/amount|pounds/i);
  });
});

describe("dates, ids and text", () => {
  it("accepts real ISO dates only", () => {
    expect(isoDate.safeParse("2026-11-14").success).toBe(true);
    expect(isoDate.safeParse("2026-02-30").success).toBe(false);
    expect(isoDate.safeParse("14/11/2026").success).toBe(false);
    expect(isoDate.safeParse("").success).toBe(false);
  });

  it("treats a blank optional date as null", () => {
    expect(optionalIsoDate.parse("")).toBeNull();
    expect(optionalIsoDate.parse(undefined)).toBeNull();
    expect(optionalIsoDate.parse("2026-11-14")).toBe("2026-11-14");
    expect(optionalIsoDate.safeParse("nope").success).toBe(false);
  });

  it("validates UUIDs", () => {
    expect(uuid.safeParse(VALID_UUID).success).toBe(true);
    expect(uuid.safeParse("not-a-uuid").success).toBe(false);
    expect(optionalUuid.parse("")).toBeNull();
    expect(optionalUuid.parse(undefined)).toBeNull();
    expect(optionalUuid.parse(VALID_UUID)).toBe(VALID_UUID);
    expect(optionalUuid.safeParse("nope").success).toBe(false);
  });

  it("limits optional text and turns blanks into null", () => {
    const text = optionalText(5);
    expect(text.parse("")).toBeNull();
    expect(text.parse("hello")).toBe("hello");
    const tooLong = text.safeParse("hello!");
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) expect(tooLong.error.issues[0]!.message).toBe("Keep this under 5 characters.");
  });

  it("normalises vehicle registrations", () => {
    expect(registration.parse("ab12 cde")).toBe("AB12CDE");
    expect(registration.parse("")).toBeNull();
    expect(registration.parse("  -- ")).toBeNull();
    expect(registration.parse(undefined)).toBeNull();
  });
});

describe("parseForm", () => {
  const schema = z.object({ name: z.string().min(2, "Enter a name."), amount: moneyAmount });

  function form(entries: Record<string, string>): FormData {
    const data = new FormData();
    for (const [k, v] of Object.entries(entries)) data.set(k, v);
    return data;
  }

  it("returns parsed data and trims whitespace", () => {
    const result = parseForm(schema, form({ name: "  Sam  ", amount: " £12.50 " }));
    expect(result).toEqual({ data: { name: "Sam", amount: 1250 } });
  });

  it("returns one message per field and a plain heading", () => {
    const result = parseForm(schema, form({ name: "S", amount: "" }));
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.ok).toBe(false);
      expect(result.error.message).toBe("Please check the highlighted answers.");
      expect(result.error.fieldErrors).toEqual({ name: "Enter a name.", amount: "Enter an amount." });
    }
  });

  it("ignores uploaded files rather than treating them as text", () => {
    const data = form({ name: "Sam", amount: "1" });
    data.set("attachment", new File(["x"], "x.txt"));
    expect("data" in parseForm(schema, data)).toBe(true);
  });
});

describe("action results", () => {
  it("builds ok and fail states", () => {
    expect(ok("Saved.")).toEqual({ ok: true, message: "Saved.", data: undefined });
    expect(fail("Nope", "detail")).toMatchObject({ ok: false, message: "Nope", detail: "detail" });
    expect(fail("Nope").detail).toBeNull();
  });

  it("maps database errors to plain English and keeps the technical detail", () => {
    expect(dbFailure({ code: "42501", message: "permission denied" }).message).toBe("You do not have permission to do that.");
    expect(dbFailure({ code: "23505", message: "duplicate key" }).message).toMatch(/already exists/);
    expect(dbFailure({ code: "23503", message: "fk" }).message).toMatch(/no longer exists|still in use/);
    expect(dbFailure({ code: "23514", message: "check" }).message).toMatch(/not allowed/);
    expect(dbFailure({ message: "new row violates row-level security policy" }).message).toBe("You do not have permission to do that.");
    // Our own database functions raise owner-facing text with P0001.
    expect(dbFailure({ code: "P0001", message: "That month is locked." }).message).toBe("That month is locked.");
    const unknown = dbFailure({ code: "XX000", message: "boom" });
    expect(unknown.message).toBe("That could not be saved. Nothing was changed.");
    expect(unknown.detail).toContain("boom");
  });
});
