"use server";

import { redirect } from "next/navigation";
import { BillingNotConfigured, createCheckoutUrl, createPortalUrl } from "@/lib/billing/stripe";
import { subscribeAudience } from "@/lib/billing/audience";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionState } from "./helpers";

const MEMBER_MESSAGE = "Your business's subscription is paid by its owner, so there is nothing for you to pay. Please ask the owner to check their billing.";
const NOT_CONFIGURED = "Payments are not switched on yet. Please try again shortly.";

/** Sends the signed-in person to Stripe to pay for the monthly plan. */
export async function startCheckout(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const audience = await subscribeAudience(supabase, data.user.id);
  if (audience === "driver") redirect("/my");
  if (audience === "member") return fail(MEMBER_MESSAGE);
  let url: string;
  try {
    url = await createCheckoutUrl(createAdminClient(), { id: data.user.id, email: data.user.email ?? "" });
  } catch (error) {
    if (error instanceof BillingNotConfigured) return fail(NOT_CONFIGURED);
    return fail("We could not open the payment page. Please try again.", error instanceof Error ? error.message : null);
  }
  redirect(url);
}

/** Opens Stripe's page for changing the card or cancelling. Only the person who pays has a subscription to manage. */
export async function openBillingPortal(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { data: billing } = await supabase.from("user_billing").select("stripe_customer_id").eq("user_id", data.user.id).maybeSingle();
  if (!billing?.stripe_customer_id) return fail("There is no paid subscription to manage on this login.");
  let url: string;
  try {
    url = await createPortalUrl(billing.stripe_customer_id, `${env.appUrl()}/settings`);
  } catch (error) {
    if (error instanceof BillingNotConfigured) return fail(NOT_CONFIGURED);
    return fail("We could not open the billing page. Please try again.", error instanceof Error ? error.message : null);
  }
  redirect(url);
}
