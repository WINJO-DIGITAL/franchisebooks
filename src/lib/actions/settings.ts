"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DEFAULT_ANOMALY_CONFIG, type AnomalyConfig } from "@/lib/anomalies/detect";
import { getContext } from "@/lib/context";
import { isYearMonth, monthRange, parseTimeToMinutes } from "@/lib/dates";
import { formatGBP, toDb } from "@/lib/money";
import { revenueDescription } from "@/lib/finance/credit-notes";
import { dbFailure, fail, ok, parseForm, type ActionState } from "./helpers";
import { isoDate, moneyAmount, optionalText, uuid } from "./schemas";

const fdNumber = z.string().min(1, "Enter the FD number.").max(40).transform((v) => v.toUpperCase());

export async function addFranchise(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can add franchises.");
  const parsed = parseForm(z.object({ fdNumber, name: optionalText(120), depot: optionalText(120) }), formData);
  if ("error" in parsed) return parsed.error;
  const { error } = await ctx.supabase.from("franchises").insert({
    account_id: ctx.accountId, fd_number: parsed.data.fdNumber, name: parsed.data.name ?? "", depot: parsed.data.depot,
  });
  if (error) return error.code === "23505" ? fail("That FD number has already been added.", null, { fdNumber: "Already added." }) : dbFailure(error);
  revalidatePath("/", "layout");
  return ok(`Franchise ${parsed.data.fdNumber} added.`);
}

export async function updateFranchise(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can change franchises.");
  const parsed = parseForm(z.object({ id: uuid, fdNumber, name: optionalText(120), depot: optionalText(120), isActive: z.enum(["true", "false"]), vehicleType: optionalText(80), vehicleSize: optionalText(80), vehicleFuel: z.enum(["", "diesel", "electric", "other"]).optional() }), formData);
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;
  const { error, data } = await ctx.supabase
    .from("franchises").update({ fd_number: d.fdNumber, name: d.name ?? "", depot: d.depot, is_active: d.isActive === "true", vehicle_type: d.vehicleType, vehicle_size: d.vehicleSize, vehicle_fuel: d.vehicleType ? (d.vehicleFuel || "diesel") : null }).eq("id", d.id).select("id");
  if (error) return error.code === "23505" ? fail("Another franchise already has that FD number.") : dbFailure(error);
  if (!data?.length) return fail("That franchise could not be found.");
  revalidatePath("/", "layout");
  return ok("Franchise saved.");
}

const revenueSchema = z.object({
  franchiseId: uuid,
  period: z.enum(["month", "day"]),
  month: z.string().optional(),
  day: z.string().optional(),
  amount: moneyAmount,
  status: z.enum(["confirmed", "estimated"]),
  kind: z.enum(["payment", "credit_note"]).default("payment"),
  description: optionalText(300),
});

export async function addRevenue(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can enter revenue.");
  const parsed = parseForm(revenueSchema, formData);
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;
  let start: string;
  let end: string;
  if (d.period === "month") {
    if (!isYearMonth(d.month)) return fail("Please check the highlighted answers.", null, { month: "Choose a month." });
    ({ start, end } = monthRange(d.month));
  } else {
    const day = isoDate.safeParse(d.day);
    if (!day.success) return fail("Please check the highlighted answers.", null, { day: "Choose a date." });
    start = end = day.data;
  }
  const { error } = await ctx.supabase.from("revenue_entries").insert({
    account_id: ctx.accountId, franchise_id: d.franchiseId, period_start: start, period_end: end,
    amount: toDb(d.amount) as unknown as number, status: d.status, description: revenueDescription(d.kind, d.description), created_by: ctx.userId,
  });
  if (error) return dbFailure(error, "The revenue could not be saved. Nothing was changed.");
  revalidatePath("/", "layout");
  return ok(d.kind === "credit_note" ? `Credit note of ${formatGBP(d.amount)} saved as ${d.status}. It counts as money in.` : `Revenue of ${formatGBP(d.amount)} saved as ${d.status}.`);
}

export async function voidRevenue(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can change revenue.");
  const parsed = parseForm(z.object({ id: uuid, reason: z.string().min(3, "Say briefly why.").max(300) }), formData);
  if ("error" in parsed) return parsed.error;
  const { error, data } = await ctx.supabase
    .from("revenue_entries")
    .update({ is_void: true, void_reason: parsed.data.reason, voided_by: ctx.userId, voided_at: new Date().toISOString() })
    .eq("id", parsed.data.id).select("id");
  if (error) return dbFailure(error);
  if (!data?.length) return fail("That entry could not be found.");
  revalidatePath("/", "layout");
  return ok("Revenue entry removed from all totals. The record is kept, marked as void.");
}

export async function updateSchedule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can change the schedule.");
  const parsed = parseForm(
    z.object({
      syncTime: z.string().refine((v) => parseTimeToMinutes(v) != null, "Enter a time, for example 20:30."),
      syncEnabled: z.enum(["true", "false"]),
      autoReports: z.enum(["true", "false"]),
      revenueBasis: z.enum(["none", "stops", "parcels", "earnings"]),
    }),
    formData,
  );
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;
  const { error } = await ctx.supabase.from("app_settings").update({
    sync_time_local: d.syncTime, sync_enabled: d.syncEnabled === "true", auto_monthly_reports: d.autoReports === "true",
    revenue_allocation_basis: d.revenueBasis, updated_by: ctx.userId,
  }).eq("account_id", ctx.accountId);
  if (error) return dbFailure(error);
  revalidatePath("/", "layout");
  return ok("Settings saved.");
}

const THRESHOLD_FIELDS: { key: keyof AnomalyConfig; money?: boolean }[] = [
  { key: "earningsChangePct" }, { key: "stopsChangePct" }, { key: "parcelsChangePct" }, { key: "fuelWeeklyChangePct" },
  { key: "baselineDays" }, { key: "expenseHighMultiple" },
];

export async function updateAlertSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can change alert settings.");
  const config: Partial<AnomalyConfig> = {};
  const fieldErrors: Record<string, string> = {};
  for (const { key } of THRESHOLD_FIELDS) {
    const raw = String(formData.get(key) ?? "").trim();
    if (raw === "") continue;
    const value = Number(raw);
    const max = key === "baselineDays" ? 60 : key === "expenseHighMultiple" ? 20 : 500;
    if (!Number.isFinite(value) || value <= 0 || value > max) fieldErrors[key] = `Enter a number between 1 and ${max}.`;
    else if (value !== DEFAULT_ANOMALY_CONFIG[key]) config[key] = value;
  }
  if (Object.keys(fieldErrors).length) return fail("Please check the highlighted answers.", null, fieldErrors);
  const { error } = await ctx.supabase.from("app_settings").update({ anomaly_config: config, updated_by: ctx.userId }).eq("account_id", ctx.accountId);
  if (error) return dbFailure(error);
  revalidatePath("/settings");
  return ok("Alert settings saved. They apply from the next check.");
}

export async function updateBusinessName(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can change the business name.");
  const parsed = parseForm(z.object({ name: z.string().min(2, "Enter your business name.").max(120) }), formData);
  if ("error" in parsed) return parsed.error;
  const { error } = await ctx.supabase.from("accounts").update({ name: parsed.data.name }).eq("id", ctx.accountId);
  if (error) return dbFailure(error);
  revalidatePath("/", "layout");
  return ok("Business name saved.");
}
