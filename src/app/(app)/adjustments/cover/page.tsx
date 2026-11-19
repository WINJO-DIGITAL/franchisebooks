import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CoverWizard } from "@/components/adjustments/wizards";
import { EmptyState, PageHeader } from "@/components/ui/bits";
import { LinkButton } from "@/components/ui/button";
import { getContext } from "@/lib/context";
import { loadWizardOptions } from "@/lib/data/wizard";

export const metadata: Metadata = { title: "Record Driver Cover" };

export default async function Page({ searchParams }: { searchParams: Promise<{ original?: string; date?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  if (!ctx.canWrite) redirect("/adjustments");
  const options = await loadWizardOptions(ctx);
  return (
    <div className="max-w-2xl">
      <p className="mb-3 text-sm"><Link href="/adjustments" className="text-accent hover:underline">← Adjustments</Link></p>
      <PageHeader title="Record Driver Cover" description="Record that one driver covered another's work, and how pay should be handled." />
      {options.franchises.length === 0 || options.drivers.length === 0 ? (
        <EmptyState title="Add a Franchise and a Driver First" action={<LinkButton href={options.franchises.length === 0 ? "/settings" : "/drivers/new"}>{options.franchises.length === 0 ? "Go to Settings" : "Add a driver"}</LinkButton>} />
      ) : (
        <CoverWizard franchises={options.franchises} drivers={options.drivers} today={ctx.today} defaults={{ franchiseId: ctx.franchiseId, originalDriverId: params.original ?? null, date: params.date ?? null }} />
      )}
    </div>
  );
}
