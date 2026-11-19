import "server-only";
import { billingAudience, type Role } from "@/lib/access";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Works out, through the user's own session, whether they are a driver, a member of someone else's business, or a payer. */
export async function subscribeAudience(supabase: Supabase, userId: string): Promise<"driver" | "member" | "payer"> {
  const [{ data: profile }, { data: driver }] = await Promise.all([
    supabase.from("user_profiles").select("role").eq("id", userId).maybeSingle(),
    supabase.from("driver_accounts").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);
  return billingAudience({ isDriver: driver != null && profile == null, role: profile ? (profile.role as Role) : null });
}
