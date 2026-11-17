import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NewDriverForm } from "@/components/drivers/forms";
import { PageHeader, Panel } from "@/components/ui/bits";
import { franchiseLabel, getContext } from "@/lib/context";

export const metadata: Metadata = { title: "Add driver" };

export default async function NewDriverPage() {
  const ctx = await getContext();
  if (!ctx.canWrite) redirect("/drivers");
  return (
    <div className="max-w-2xl">
      <PageHeader title="Add a driver" description="Only the name is needed. Everything else can be added later." />
      <Panel>
        <NewDriverForm franchises={ctx.franchises.filter((f) => f.isActive).map((f) => ({ id: f.id, label: franchiseLabel(f) }))} defaultFranchiseId={ctx.franchiseId} today={ctx.today} />
      </Panel>
    </div>
  );
}
