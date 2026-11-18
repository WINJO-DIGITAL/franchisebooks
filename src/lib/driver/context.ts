import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Who a signed-in DRIVER is. The driver's identity comes only from their own sign-in (their row in driver_accounts, which
 * the database lets them read), never from anything in the address or the form. Everything the driver's pages show is
 * fetched for exactly this account and driver.
 */
export const getDriverContext = cache(async () => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: link } = await supabase.from("driver_accounts").select("account_id, driver_id, email").eq("user_id", auth.user.id).maybeSingle();
  if (!link) {
    // Not a driver. A business user belongs on the dashboard; anyone else is still setting up.
    const { data: profile } = await supabase.from("user_profiles").select("id").eq("id", auth.user.id).maybeSingle();
    redirect(profile ? "/" : "/onboarding");
  }
  return { userId: auth.user.id, email: link.email, accountId: link.account_id, driverId: link.driver_id };
});

export type DriverContext = Awaited<ReturnType<typeof getDriverContext>>;

/** True when this signed-in user is a driver (so business pages must send them to their own page instead). */
export async function isDriverLogin(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("driver_accounts").select("user_id").eq("user_id", userId).maybeSingle();
  return data != null;
}
