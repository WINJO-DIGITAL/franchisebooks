"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentPlan } from "@/lib/billing/plan";
import { getContext } from "@/lib/context";
import { formatUkDate } from "@/lib/dates";
import { ADJUSTMENT_TYPES } from "@/lib/labels";
import { formatGBP, toDb } from "@/lib/money";
import { dbFailure, fail, ok, parseForm, type ActionState } from "./helpers";
import { isoDate, moneyAmount, optionalText, uuid } from "./schemas";

const adjustmentSchema = z.object({
  franchiseId: uuid,
  driverId: uuid,
  earningsDate: isoDate,
  type: z.enum(ADJUSTMENT_TYPES.map((t) => t.value) as [string, ...string[]]),
  direction: z.enum(["add", "deduct"]).optional(),
  amount: moneyAmount,
  reason: z.string().min(3, "Say briefly why, so it is clear later.").max(500),
  confirmed: z.literal("yes", "Please confirm the adjustment before saving."),
});

export async function createAdjustment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to adjust pay.");
  const parsed = parseForm(adjustmentSchema, formData);
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;
  const type = ADJUSTMENT_TYPES.find((t) => t.value === d.type)!;
  if (type.sign === 0 && !d.direction) return fail("Please check the highlighted answers.", null, { direction: "Say whether this adds to or takes off the driver's pay." });
  if (d.amount === 0 && d.type !== "withheld_payment") {
    return fail("Please check the highlighted answers.", null, { amount: "Enter an amount greater than zero. (Only a withheld payment can be recorded as £0.)" });
  }
  if (d.earningsDate > ctx.today) return fail("Please check the highlighted answers.", null, { earningsDate: "The date cannot be in the future." });
  const sign = type.sign !== 0 ? type.sign : d.direction === "deduct" ? -1 : 1;
  const signed = d.amount === 0 ? 0 : sign * d.amount;

  const { error } = await ctx.supabase.rpc("create_pay_adjustment", {
    p_franchise_id: d.franchiseId, p_driver_id: d.driverId, p_earnings_date: d.earningsDate, p_type: d.type,
    p_amount: toDb(signed) as unknown as number, p_reason: d.reason,
  });
  if (error) return dbFailure(error, "The adjustment could not be saved. Nothing was changed.");
  revalidatePath("/", "layout");
  return ok(`Adjustment saved: ${formatGBP(signed, { signed: true })} for ${formatUkDate(d.earningsDate)}. The original DPD figure is unchanged.`);
}

export async function reverseAdjustment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to adjust pay.");
  const parsed = parseForm(z.object({ id: uuid, reason: z.string().min(3, "Say briefly why it is being reversed.").max(500) }), formData);
  if ("error" in parsed) return parsed.error;
  const { error } = await ctx.supabase.rpc("reverse_pay_adjustment", { p_adjustment_id: parsed.data.id, p_reason: parsed.data.reason });
  if (error) return dbFailure(error, "The adjustment could not be reversed. Nothing was changed.");
  revalidatePath("/", "layout");
  return ok("Reversed with a correcting entry. Both entries stay on record.");
}

const coverSchema = z.object({
  franchiseId: uuid,
  coverDate: isoDate,
  originalDriverId: uuid,
  coveringDriverId: uuid,
  route: optionalText(60),
  notes: optionalText(1000),
  allocation: z.enum(["none", "all_to_cover", "custom"]),
  amountToCovering: z.string().optional(),
  amountFromOriginal: z.string().optional(),
  expenseAttribution: z.enum(["original", "covering", "franchise"]),
  confirmed: z.literal("yes", "Please confirm before saving."),
});

export async function recordCover(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to record driver cover.");
  if ((await currentPlan(ctx.supabase)) !== "max") return fail("Driver cover is part of the Max plan.");
  const parsed = parseForm(coverSchema, formData);
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;
  if (d.originalDriverId === d.coveringDriverId) return fail("Please check the highlighted answers.", null, { coveringDriverId: "Choose a different driver from the one being covered." });
  if (d.coverDate > ctx.today) return fail("Please check the highlighted answers.", null, { coverDate: "The date cannot be in the future." });

  let toCovering = 0;
  let fromOriginal = 0;
  if (d.allocation === "custom") {
    const a = moneyAmount.safeParse(d.amountToCovering || "0");
    const b = moneyAmount.safeParse(d.amountFromOriginal || "0");
    if (!a.success) return fail("Please check the highlighted answers.", null, { amountToCovering: "Enter an amount in pounds and pence." });
    if (!b.success) return fail("Please check the highlighted answers.", null, { amountFromOriginal: "Enter an amount in pounds and pence." });
    toCovering = a.data;
    fromOriginal = b.data;
    if (toCovering === 0 && fromOriginal === 0) return fail("Please check the highlighted answers.", null, { amountToCovering: "Enter at least one amount, or choose “Just record the cover”." });
  }

  const { error } = await ctx.supabase.rpc("record_driver_cover", {
    p_franchise_id: d.franchiseId, p_cover_date: d.coverDate, p_original_driver_id: d.originalDriverId, p_covering_driver_id: d.coveringDriverId,
    p_route: d.route as string, p_notes: d.notes as string, p_earnings_allocation: d.allocation,
    p_amount_to_covering: toDb(toCovering) as unknown as number, p_amount_from_original: toDb(fromOriginal) as unknown as number,
    p_expense_attribution: d.expenseAttribution,
  });
  if (error) return dbFailure(error, "The cover could not be recorded. Nothing was changed.");
  revalidatePath("/", "layout");
  return ok(`Cover recorded for ${formatUkDate(d.coverDate)}. The original DPD figures are unchanged.`);
}

export async function cancelCover(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to change driver cover.");
  if ((await currentPlan(ctx.supabase)) !== "max") return fail("Driver cover is part of the Max plan.");
  const parsed = parseForm(z.object({ id: uuid, reason: z.string().min(3, "Say briefly why it is being cancelled.").max(500) }), formData);
  if ("error" in parsed) return parsed.error;
  const { error } = await ctx.supabase.rpc("cancel_driver_cover", { p_cover_id: parsed.data.id, p_reason: parsed.data.reason });
  if (error) return dbFailure(error, "The cover record could not be cancelled. Nothing was changed.");
  revalidatePath("/", "layout");
  return ok("Cover cancelled. Its pay adjustments were reversed with correcting entries.");
}
