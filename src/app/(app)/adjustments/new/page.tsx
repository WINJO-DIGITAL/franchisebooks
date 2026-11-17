import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdjustmentWizard } from "@/components/adjustments/wizards";
import { EmptyState, PageHeader } from "@/components/ui/bits";
import { LinkButton } from "@/components/ui/button";
import { getContext } from "@/lib/context";
import { loadWizardOptions } from "@/lib/data/wizard";

export const metadata: Metadata = { title: "Add a pay adjustment" };

export default async function Page({ searchParams }: { searchParams: Promise<{ driver?: string; date?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  if (!ctx.canWrite) redirect("/adjustments");
  const options = await loadWizardOptions(ctx);
  return (
    <div className="max-w-2xl">
      <p className="mb-3 text-sm"><Link href="/adjustments" className="text-accent hover:underline">← Adjustments</Link></p>
      <PageHeader title="Add a pay adjustment" description="Add to or take off a driver's pay for a particular day. Takes about a minute." />
      {options.franchises.length === 0 || options.drivers.length === 0 ? (
        <EmptyState title="Add a franchise and a driver first" action={<LinkButton href={options.franchises.length === 0 ? "/settings" : "/drivers/new"}>{options.franchises.length === 0 ? "Go to Settings" : "Add a driver"}</LinkButton>} />
      ) : (
        <AdjustmentWizard franchises={options.franchises} drivers={options.drivers} today={ctx.today} defaults={{ franchiseId: ctx.franchiseId, driverId: params.driver ?? null, date: params.date ?? null }} />
      )}
    </div>
  );
}
