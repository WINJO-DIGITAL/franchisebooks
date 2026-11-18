import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireBillingAccess } from "@/lib/billing/gate";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your business" };

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { data: profile } = await supabase.from("user_profiles").select("id").eq("id", data.user.id).maybeSingle();
  if (profile) redirect("/");
  // A new customer pays first; set-up comes after.
  await requireBillingAccess(supabase);
  return (
    <>
      <h1 className="text-xl font-semibold">Set up your business</h1>
      <p className="mt-1 text-sm text-muted">Three quick questions and you are ready to go. You can change all of this later in Settings.</p>
      <OnboardingForm />
    </>
  );
}
