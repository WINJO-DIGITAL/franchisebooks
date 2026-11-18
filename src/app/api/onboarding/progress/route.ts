import { NextResponse } from "next/server";
import { summariseFirstSync } from "@/lib/onboarding/progress";
import { createClient } from "@/lib/supabase/server";

/** How far a new customer's first DPD read has got. Reads through the person's own session, so access rules apply. */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: profile } = await supabase.from("user_profiles").select("account_id").eq("id", auth.user.id).maybeSingle();
  if (!profile) return NextResponse.json({ error: "No business set up yet." }, { status: 404 });

  const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const [{ data: jobs }, { count }] = await Promise.all([
    supabase.from("import_jobs").select("status, franchise_id, error_message").eq("account_id", profile.account_id).eq("job_type", "dpd_sync").gte("created_at", since).order("created_at", { ascending: false }),
    supabase.from("franchises").select("id", { count: "exact", head: true }).eq("account_id", profile.account_id).eq("is_active", true),
  ]);
  const progress = summariseFirstSync((jobs ?? []).map((j) => ({ status: j.status, franchiseId: j.franchise_id, errorMessage: j.error_message })), count ?? 0);
  return NextResponse.json(progress, { headers: { "cache-control": "no-store" } });
}
