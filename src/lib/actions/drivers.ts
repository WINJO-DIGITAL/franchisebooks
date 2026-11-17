"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { normaliseName } from "@/lib/ingest/match";
import { dbFailure, fail, ok, parseForm, type ActionState } from "./helpers";
import { moneyAmount, isoDate, optionalIsoDate, optionalText, optionalUuid, registration, uuid } from "./schemas";
import { toDb } from "@/lib/money";

const driverFields = {
  displayName: z.string().min(2, "Enter the driver's name.").max(120),
  dpdDriverRef: optionalText(60),
  phone: optionalText(40),
  email: z.union([z.literal(""), z.email("That email address does not look right.")]).optional().transform((v) => (v ? v : null)),
  startDate: optionalIsoDate,
  notes: optionalText(2000),
};

const createSchema = z.object({
  ...driverFields,
  franchiseId: optionalUuid,
  route: optionalText(60),
  vehicleRegistration: registration,
});

export async function createDriver(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to add drivers.");
  const parsed = parseForm(createSchema, formData);
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;

  const { data: driver, error } = await ctx.supabase
    .from("drivers")
    .insert({
      account_id: ctx.accountId, display_name: d.displayName, dpd_driver_ref: d.dpdDriverRef, phone: d.phone, email: d.email,
      start_date: d.startDate, notes: d.notes, created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) {
    return error.code === "23505" ? fail("Another driver already has that DPD driver reference.", error.message, { dpdDriverRef: "Already used by another driver." }) : dbFailure(error);
  }
  await ctx.supabase.from("driver_aliases").insert({
    account_id: ctx.accountId, driver_id: driver.id, alias_normalised: normaliseName(d.displayName).replace(/,/g, ""), alias_display: d.displayName,
  });
  if (d.franchiseId) {
    const { error: assignError } = await ctx.supabase.from("driver_assignments").insert({
      account_id: ctx.accountId, driver_id: driver.id, franchise_id: d.franchiseId, route: d.route, vehicle_registration: d.vehicleRegistration,
      start_date: d.startDate ?? ctx.today, created_by: ctx.userId,
    });
    if (assignError) return dbFailure(assignError, "The driver was added, but could not be assigned to the franchise.");
  }
  revalidatePath("/drivers");
  redirect(`/drivers/${driver.id}`);
}

const updateSchema = z.object({
  id: uuid,
  ...driverFields,
  leavingDate: optionalIsoDate,
  isActive: z.enum(["true", "false"]),
});

export async function updateDriver(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to change drivers.");
  const parsed = parseForm(updateSchema, formData);
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;
  if (d.leavingDate && d.startDate && d.leavingDate < d.startDate) {
    return fail("Please check the highlighted answers.", null, { leavingDate: "The leaving date cannot be before the start date." });
  }
  const { data: before } = await ctx.supabase.from("drivers").select("display_name").eq("id", d.id).maybeSingle();
  const { error, data } = await ctx.supabase
    .from("drivers")
    .update({
      display_name: d.displayName, dpd_driver_ref: d.dpdDriverRef, phone: d.phone, email: d.email, start_date: d.startDate,
      leaving_date: d.leavingDate, is_active: d.isActive === "true", notes: d.notes,
    })
    .eq("id", d.id)
    .select("id");
  if (error) return error.code === "23505" ? fail("Another driver already has that DPD driver reference.", error.message) : dbFailure(error);
  if (!data?.length) return fail("That driver could not be found.");
  // A changed name is added as an alias; the old one is kept so earlier reports still match.
  if (before && before.display_name !== d.displayName) {
    await ctx.supabase.from("driver_aliases").upsert(
      { account_id: ctx.accountId, driver_id: d.id, alias_normalised: normaliseName(d.displayName).replace(/,/g, ""), alias_display: d.displayName },
      { onConflict: "account_id,driver_id,alias_normalised", ignoreDuplicates: true },
    );
  }
  revalidatePath("/drivers");
  revalidatePath(`/drivers/${d.id}`);
  return ok("Driver details saved. Past records are unchanged.");
}

const assignmentSchema = z.object({
  driverId: uuid,
  franchiseId: uuid,
  startDate: isoDate,
  route: optionalText(60),
  vehicleRegistration: registration,
});

export async function addAssignment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to change assignments.");
  const parsed = parseForm(assignmentSchema, formData);
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;
  const { error } = await ctx.supabase.from("driver_assignments").insert({
    account_id: ctx.accountId, driver_id: d.driverId, franchise_id: d.franchiseId, start_date: d.startDate, route: d.route,
    vehicle_registration: d.vehicleRegistration, created_by: ctx.userId,
  });
  if (error) return dbFailure(error);
  revalidatePath(`/drivers/${d.driverId}`);
  return ok("Assignment added.");
}

export async function endAssignment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to change assignments.");
  const parsed = parseForm(z.object({ id: uuid, driverId: uuid, endDate: isoDate }), formData);
  if ("error" in parsed) return parsed.error;
  const { error, data } = await ctx.supabase.from("driver_assignments").update({ end_date: parsed.data.endDate }).eq("id", parsed.data.id).select("id");
  if (error) return error.code === "23514" ? fail("The end date cannot be before the start date.", error.message) : dbFailure(error);
  if (!data?.length) return fail("That assignment could not be found.");
  revalidatePath(`/drivers/${parsed.data.driverId}`);
  return ok("Assignment ended. Past records are unchanged.");
}

const linkSchema = z.object({
  franchiseId: uuid,
  driverKey: z.string().min(1),
  sourceName: z.string().min(1),
  mode: z.enum(["existing", "new"]),
  driverId: optionalUuid,
});

/** Deals with a name on a DPD report that matched no driver: link it to an existing driver or register a new one. */
export async function linkUnregisteredDriver(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to do that.");
  const parsed = parseForm(linkSchema, formData);
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;

  let driverId = d.driverId;
  if (d.mode === "new") {
    const ref = d.driverKey.startsWith("ref:") ? d.driverKey.slice(4).toUpperCase() : null;
    const { data: created, error } = await ctx.supabase
      .from("drivers")
      .insert({ account_id: ctx.accountId, display_name: d.sourceName, dpd_driver_ref: ref, created_by: ctx.userId })
      .select("id")
      .single();
    if (error) return dbFailure(error);
    driverId = created.id;
    const { data: firstRow } = await ctx.supabase
      .from("daily_earnings").select("report_date").eq("franchise_id", d.franchiseId).eq("driver_key", d.driverKey).order("report_date").limit(1).maybeSingle();
    await ctx.supabase.from("driver_assignments").insert({
      account_id: ctx.accountId, driver_id: driverId, franchise_id: d.franchiseId, start_date: firstRow?.report_date ?? ctx.today, created_by: ctx.userId,
    });
  }
  if (!driverId) return fail("Choose which driver this is.", null, { driverId: "Choose a driver." });

  const { data: linked, error } = await ctx.supabase.rpc("link_earnings_to_driver", {
    p_franchise_id: d.franchiseId, p_driver_key: d.driverKey, p_driver_id: driverId, p_alias: d.sourceName,
  });
  if (error) return dbFailure(error);
  // The alert about this name no longer applies.
  await ctx.supabase.from("anomalies").update({
    status: "resolved", status_note: "Linked to a registered driver.", status_changed_by: ctx.userId, status_changed_at: new Date().toISOString(),
  }).eq("anomaly_type", "unregistered_driver").eq("franchise_id", d.franchiseId).contains("metric", { driverKey: d.driverKey }).in("status", ["open", "investigating"]);

  revalidatePath("/", "layout");
  return ok(`Done. ${linked ?? 0} report ${linked === 1 ? "day is" : "days are"} now linked to this driver, and future reports will match automatically.`);
}

/**
 * Sets the day rate a driver is paid from a date. Append-only: changing the rate
 * adds a new row, so wages already worked are never altered.
 */
const dayRateSchema = z.object({
  driverId: uuid,
  dayRate: moneyAmount,
  effectiveFrom: isoDate,
  note: optionalText(500),
});

export async function setDayRate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to change day rates.");
  const parsed = parseForm(dayRateSchema, formData);
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;
  if (d.effectiveFrom > ctx.today) return fail("A day rate cannot start in the future.", null, { effectiveFrom: "Choose today or an earlier date." });

  const { error } = await ctx.supabase.from("driver_day_rates").insert({
    account_id: ctx.accountId,
    driver_id: d.driverId,
    day_rate: Number(toDb(d.dayRate)),
    effective_from: d.effectiveFrom,
    note: d.note,
    created_by: ctx.userId,
  });
  if (error) {
    return error.code === "23505"
      ? fail("A day rate already starts on that date. Choose a different date.", error.message, { effectiveFrom: "A rate already starts on this date." })
      : dbFailure(error);
  }
  revalidatePath(`/drivers/${d.driverId}`);
  return ok("Day rate saved. Earlier wages are unchanged.");
}
