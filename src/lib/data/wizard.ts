import type { AppContext } from "@/lib/context";
import { franchiseLabel } from "@/lib/context";
import { fetchAll } from "./fetch-all";

/** Drivers and franchises in the shape the guided forms need. */
export async function loadWizardOptions(ctx: AppContext) {
  const [drivers, assignments] = await Promise.all([
    fetchAll(() => ctx.supabase.from("drivers").select("id, display_name, is_active").order("display_name").order("id")),
    fetchAll(() => ctx.supabase.from("driver_assignments").select("id, driver_id, franchise_id, start_date, end_date").order("id")),
  ]);
  return {
    franchises: ctx.franchises.filter((f) => f.isActive).map((f) => ({ id: f.id, label: franchiseLabel(f) })),
    drivers: drivers.map((d) => ({
      id: d.id,
      name: d.display_name,
      isActive: d.is_active,
      franchiseIds: [...new Set(assignments.filter((a) => a.driver_id === d.id && (!a.end_date || a.end_date >= ctx.today)).map((a) => a.franchise_id))],
    })),
  };
}
