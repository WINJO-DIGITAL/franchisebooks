"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { parseScaleRows, type ScaleRateInput } from "@/lib/finance/sliding-scale";
import { dbFailure, fail, ok, parseForm, type ActionState } from "./helpers";
import { uuid } from "./schemas";

const MAX_ROWS = 500;

function toInsert(accountId: string, userId: string, r: ScaleRateInput) {
  return {
    account_id: accountId, vehicle_type: r.vehicleType, vehicle_size: r.vehicleSize, fuel_type: r.fuelType,
    stops_from: r.stopsFrom, stops_to: r.stopsTo, miles_from: r.milesFrom, miles_to: r.milesTo, rate: Number(r.rate), created_by: userId,
  };
}

/** Adds one band. The same reading rules as a pasted row, so a typed band and a pasted band always agree. */
export async function addScaleRate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to change the sliding scale.");
  const parsed = parseForm(
    z.object({
      vehicleType: z.string().min(1, "Enter the vehicle type.").max(80),
      vehicleSize: z.string().max(80).optional(),
      fuelType: z.enum(["diesel", "electric", "other"]),
      stopsFrom: z.string().min(1, "Enter the first stop number of the band."),
      stopsTo: z.string().optional(),
      milesFrom: z.string().optional(),
      milesTo: z.string().optional(),
      rate: z.string().min(1, "Enter the rate per stop."),
    }),
    formData,
  );
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;
  // Tabs keep a name that contains a comma in one piece.
  const line = [d.vehicleType, d.vehicleSize ?? "", d.fuelType, d.stopsFrom, d.stopsTo ?? "", d.milesFrom ?? "", d.milesTo ?? "", d.rate].join("\t");
  const result = parseScaleRows(line);
  if (result.errors.length > 0) return fail("That band could not be saved.", result.errors.join("\n"));
  if (result.rows.length !== 1) return fail("Check the numbers: stops and miles must be whole numbers, and the rate an amount in pounds.");
  const { error } = await ctx.supabase.from("sliding_scale_rates").insert(toInsert(ctx.accountId, ctx.userId, result.rows[0]!));
  if (error) return dbFailure(error);
  revalidatePath("/sliding-scale");
  return ok("Band saved.");
}

/** Adds many bands pasted from a spreadsheet or typed one per line. All or nothing. */
export async function importScaleRates(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to change the sliding scale.");
  const text = String(formData.get("rates") ?? "");
  if (text.trim() === "") return fail("Paste at least one row.", null, { rates: "Paste the rows here." });
  const result = parseScaleRows(text);
  if (result.errors.length > 0) {
    return fail(`Nothing was saved. ${result.errors.length} line${result.errors.length === 1 ? " needs" : "s need"} fixing.`, result.errors.slice(0, 12).join("\n"), { rates: "Fix the lines listed below, then try again." });
  }
  if (result.rows.length === 0) return fail("No rows were found.", null, { rates: "Paste at least one row." });
  if (result.rows.length > MAX_ROWS) return fail(`Please paste ${MAX_ROWS} rows or fewer at a time.`);
  const { error } = await ctx.supabase.from("sliding_scale_rates").insert(result.rows.map((r) => toInsert(ctx.accountId, ctx.userId, r)));
  if (error) return dbFailure(error);
  revalidatePath("/sliding-scale");
  return ok(`${result.rows.length} band${result.rows.length === 1 ? "" : "s"} saved.`);
}

export async function removeScaleRate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to change the sliding scale.");
  const parsed = parseForm(z.object({ id: uuid }), formData);
  if ("error" in parsed) return parsed.error;
  const { error } = await ctx.supabase.from("sliding_scale_rates").delete().eq("id", parsed.data.id).eq("account_id", ctx.accountId);
  if (error) return dbFailure(error);
  revalidatePath("/sliding-scale");
  return ok("Band removed.");
}
