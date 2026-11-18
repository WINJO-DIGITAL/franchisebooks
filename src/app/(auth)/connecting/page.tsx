import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ConnectingProgress } from "@/components/onboarding/connecting-progress";
import { getContext } from "@/lib/context";

export const metadata: Metadata = { title: "Connecting to DPD" };

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600 * 1000).toISOString();

export default async function ConnectingPage() {
  const ctx = await getContext();
  // Only meaningful straight after set-up. With no recent read to follow, go to the dashboard instead of waiting forever.
  const since = hoursAgo(6);
  const { count } = await ctx.supabase.from("import_jobs").select("id", { count: "exact", head: true }).eq("account_id", ctx.accountId).eq("job_type", "dpd_sync").gte("created_at", since);
  if ((count ?? 0) === 0) redirect("/");
  return <ConnectingProgress />;
}
