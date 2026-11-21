"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DRIVER_KINDS, VEHICLE_KINDS } from "@/lib/compliance/dates";
import { getContext } from "@/lib/context";
import { dbFailure, fail, ok, parseForm, type ActionState } from "./helpers";
import { isoDate, optionalText, uuid } from "./schemas";

const dateSchema = z.object({
  subjectType: z.enum(["driver", "vehicle"]),
  driverId: z.string().optional(),
  vehicleRegistration: z.string().optional(),
  kind: z.string(),
  label: optionalText(120),
  expiresOn: isoDate,
  notes: optionalText(1000),
});

/** Which kinds go with which subject: a driver's licence cannot be on a van, and a van's MOT cannot be on a driver. */
function kindFits(subjectType: string, kind: string): boolean {
  return subjectType === "driver" ? (DRIVER_KINDS as readonly string[]).includes(kind) : (VEHICLE_KINDS as readonly string[]).includes(kind);
}

export async function addComplianceDate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to add dates.");
  const parsed = parseForm(dateSchema, formData);
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;
  if (!kindFits(d.subjectType, d.kind)) return fail("Please check the highlighted answers.", null, { kind: "Choose a date type that fits who or what it is for." });
  if (d.kind.endsWith("_other") || d.kind === "vehicle_other") {
    if (!d.label) return fail("Please check the highlighted answers.", null, { label: "Say what this date is for." });
  }
  let driverId: string | null = null;
  let registration: string | null = null;
  if (d.subjectType === "driver") {
    const checked = uuid.safeParse(d.driverId);
    if (!checked.success) return fail("Please check the highlighted answers.", null, { driverId: "Choose a driver." });
    const { data: driver } = await ctx.supabase.from("drivers").select("id").eq("id", checked.data).eq("account_id", ctx.accountId).maybeSingle();
    if (!driver) return fail("Driver not found.");
    driverId = driver.id;
  } else {
    registration = (d.vehicleRegistration ?? "").toUpperCase().replace(/\s+/g, "");
    if (!/^[A-Z0-9]{2,10}$/.test(registration)) return fail("Please check the highlighted answers.", null, { vehicleRegistration: "Enter the vehicle registration, for example AB12CDE." });
  }
  const { error } = await ctx.supabase.from("compliance_dates").insert({
    account_id: ctx.accountId, subject_type: d.subjectType, driver_id: driverId, vehicle_registration: registration,
    kind: d.kind, label: d.label ?? null, expires_on: d.expiresOn, notes: d.notes ?? null, created_by: ctx.userId,
  });
  if (error) return dbFailure(error, "The date could not be saved. Nothing was changed.");
  revalidatePath("/drivers");
  revalidatePath("/", "layout");
  return ok("Date saved.");
}

export async function changeComplianceDate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to change dates.");
  const parsed = parseForm(z.object({ id: uuid, expiresOn: isoDate }), formData);
  if ("error" in parsed) return parsed.error;
  const { error } = await ctx.supabase.from("compliance_dates").update({ expires_on: parsed.data.expiresOn, updated_at: new Date().toISOString() }).eq("id", parsed.data.id);
  if (error) return dbFailure(error, "The date could not be changed. Nothing was changed.");
  revalidatePath("/drivers");
  revalidatePath("/", "layout");
  return ok("Date changed.");
}

export async function removeComplianceDate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to remove dates.");
  const parsed = parseForm(z.object({ id: uuid }), formData);
  if ("error" in parsed) return parsed.error;
  const { error } = await ctx.supabase.from("compliance_dates").delete().eq("id", parsed.data.id);
  if (error) return dbFailure(error, "The date could not be removed. Nothing was changed.");
  revalidatePath("/drivers");
  revalidatePath("/", "layout");
  return ok("Date removed.");
}
