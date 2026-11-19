"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { formatGBP, toDb } from "@/lib/money";
import { dbFailure, fail, ok, parseForm, type ActionState } from "./helpers";
import { isoDate, moneyAmount, optionalText, optionalUuid, registration, uuid } from "./schemas";

const expenseSchema = z.object({
  franchiseId: optionalUuid,
  categoryId: uuid,
  expenseDate: isoDate,
  amount: moneyAmount,
  description: z.string().min(2, "Say briefly what it was for.").max(300),
  supplier: optionalText(120),
  vehicleRegistration: registration,
  assignTo: z.enum(["unallocated", "franchise", "driver"]),
  driverId: optionalUuid,
});

export async function addExpense(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to add expenses.");
  const parsed = parseForm(expenseSchema, formData);
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;
  if (d.amount === 0) return fail("Please check the highlighted answers.", null, { amount: "Enter an amount greater than zero." });
  if (d.assignTo === "driver" && !d.driverId) return fail("Please check the highlighted answers.", null, { driverId: "Choose the driver." });
  if (d.expenseDate > ctx.today) return fail("Please check the highlighted answers.", null, { expenseDate: "The date cannot be in the future." });

  const { data: expense, error } = await ctx.supabase
    .from("expenses")
    .insert({
      account_id: ctx.accountId, franchise_id: d.franchiseId, category_id: d.categoryId, expense_date: d.expenseDate,
      description: d.description, supplier: d.supplier, vehicle_registration: d.vehicleRegistration,
      amount: toDb(d.amount) as unknown as number, source: "manual_entry", dedupe_key: `manual|${randomUUID()}`, created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) return dbFailure(error, "The expense could not be saved. Nothing was changed.");

  if (d.assignTo !== "unallocated") {
    const { error: allocError } = await ctx.supabase.rpc("set_cost_allocation", {
      p_kind: "expense", p_cost_id: expense.id, p_scope: d.assignTo, p_driver_id: (d.assignTo === "driver" ? d.driverId : null) as string, p_note: "Set when the expense was entered",
    });
    if (allocError) return dbFailure(allocError, "The expense was saved but could not be assigned. You can assign it from the list.");
  }
  revalidatePath("/", "layout");
  return ok(`Expense of ${formatGBP(d.amount)} saved.`);
}

const assignSchema = z.object({
  kind: z.enum(["fuel", "expense"]),
  id: uuid,
  assignTo: z.enum(["unallocated", "franchise", "driver"]),
  driverId: optionalUuid,
  note: optionalText(300),
});

export async function assignCost(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to assign costs.");
  const parsed = parseForm(assignSchema, formData);
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;
  if (d.assignTo === "driver" && !d.driverId) return fail("Please check the highlighted answers.", null, { driverId: "Choose the driver." });
  const { error } = await ctx.supabase.rpc("set_cost_allocation", {
    p_kind: d.kind, p_cost_id: d.id, p_scope: d.assignTo, p_driver_id: (d.assignTo === "driver" ? d.driverId : null) as string, p_note: d.note as string,
  });
  if (error) return dbFailure(error, "The cost could not be assigned. Nothing was changed.");
  revalidatePath("/", "layout");
  return ok(d.assignTo === "unallocated" ? "Moved back to unallocated." : d.assignTo === "driver" ? "Assigned to the driver." : "Counted as a business cost.");
}

export async function setCostFranchise(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to change costs.");
  const parsed = parseForm(z.object({ kind: z.enum(["fuel", "expense"]), id: uuid, franchiseId: uuid }), formData);
  if ("error" in parsed) return parsed.error;
  const table = parsed.data.kind === "fuel" ? "fuel_transactions" : "expenses";
  const { error, data } = await ctx.supabase.from(table).update({ franchise_id: parsed.data.franchiseId }).eq("id", parsed.data.id).select("id");
  if (error) return dbFailure(error);
  if (!data?.length) return fail("That cost could not be found.");
  revalidatePath("/", "layout");
  return ok("Franchise set.");
}

export async function voidCost(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to remove costs.");
  const parsed = parseForm(z.object({ kind: z.enum(["fuel", "expense"]), id: uuid, reason: z.string().min(3, "Say briefly why.").max(300) }), formData);
  if ("error" in parsed) return parsed.error;
  const table = parsed.data.kind === "fuel" ? "fuel_transactions" : "expenses";
  const { error, data } = await ctx.supabase
    .from(table)
    .update({ is_void: true, void_reason: parsed.data.reason, voided_by: ctx.userId, voided_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .select("id");
  if (error) return dbFailure(error);
  if (!data?.length) return fail("That cost could not be found.");
  revalidatePath("/", "layout");
  return ok("Removed from all totals. The record is kept, marked as void.");
}

export async function addCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to add categories.");
  const parsed = parseForm(z.object({ name: z.string().min(2, "Enter a name.").max(60), kind: z.enum(["vehicle", "other", "fuel"]).default("other") }), formData);
  if ("error" in parsed) return parsed.error;
  const { error } = await ctx.supabase.from("expense_categories").insert({ account_id: ctx.accountId, name: parsed.data.name, kind: parsed.data.kind });
  if (error) return error.code === "23505" ? fail("There is already a category with that name.") : dbFailure(error);
  revalidatePath("/settings");
  revalidatePath("/expenses");
  return ok(`Category “${parsed.data.name}” added.`);
}

export async function setCategoryActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to change categories.");
  const parsed = parseForm(z.object({ id: uuid, active: z.enum(["true", "false"]) }), formData);
  if ("error" in parsed) return parsed.error;
  const { error } = await ctx.supabase.from("expense_categories").update({ is_active: parsed.data.active === "true" }).eq("id", parsed.data.id);
  if (error) return dbFailure(error);
  revalidatePath("/settings");
  return ok(parsed.data.active === "true" ? "Category shown again." : "Category hidden from new expenses. Existing expenses keep it.");
}
