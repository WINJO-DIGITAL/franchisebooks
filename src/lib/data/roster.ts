import type { SupabaseClient } from "@supabase/supabase-js";
import type { RosterDriver, RosterFranchise } from "@/lib/ingest/match";
import type { Database } from "@/lib/supabase/database.types";
import { fetchAll } from "./fetch-all";

type Db = SupabaseClient<Database>;

export interface Roster {
  drivers: RosterDriver[];
  franchises: (RosterFranchise & { name: string; isActive: boolean })[];
  categories: { id: string; name: string; kind: string }[];
}

/** Drivers (with aliases and assignments), franchises and expense categories for an account. */
export async function loadRoster(db: Db, accountId: string): Promise<Roster> {
  const [drivers, aliases, assignments, franchises, categories] = await Promise.all([
    fetchAll(() => db.from("drivers").select("id, display_name, dpd_driver_ref").eq("account_id", accountId).order("id")),
    fetchAll(() => db.from("driver_aliases").select("id, driver_id, alias_display").eq("account_id", accountId).order("id")),
    fetchAll(() => db.from("driver_assignments").select("id, driver_id, franchise_id, start_date, end_date, vehicle_registration").eq("account_id", accountId).order("id")),
    fetchAll(() => db.from("franchises").select("id, fd_number, name, is_active").eq("account_id", accountId).order("fd_number")),
    fetchAll(() => db.from("expense_categories").select("id, name, kind").eq("account_id", accountId).eq("is_active", true).order("sort_order")),
  ]);
  return {
    drivers: drivers.map((d) => ({
      id: d.id,
      displayName: d.display_name,
      dpdRef: d.dpd_driver_ref,
      aliases: aliases.filter((a) => a.driver_id === d.id).map((a) => a.alias_display),
      assignments: assignments
        .filter((a) => a.driver_id === d.id)
        .map((a) => ({ franchiseId: a.franchise_id, startDate: a.start_date, endDate: a.end_date, vehicleRegistration: a.vehicle_registration })),
    })),
    franchises: franchises.map((f) => ({ id: f.id, fdNumber: f.fd_number, name: f.name, isActive: f.is_active })),
    categories,
  };
}
