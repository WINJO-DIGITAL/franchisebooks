import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireBillingAccess } from "@/lib/billing/gate";
import { isDriverLogin } from "@/lib/driver/context";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your business" };

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { data: profile } = await supabase.from("user_profiles").select("id").eq("id", data.user.id).maybeSingle();
  if (profile) redirect("/");
  // A driver login is never set up as a business.
  if (await isDriverLogin(data.user.id)) redirect("/my");
  // A new customer pays first; set-up comes after.
  await requireBillingAccess(supabase);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Set up your business</h1>
      <p className="mt-1 text-sm text-muted">A few details, then we read your DPD account and build your dashboard. You can change all of this later in Settings.</p>
      <OnboardingForm />
    </>
  );
}
