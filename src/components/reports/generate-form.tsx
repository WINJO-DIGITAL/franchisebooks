"use client";

import { useRouter } from "next/navigation";
import { generateReport } from "@/lib/actions/sync";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Select } from "@/components/ui/form";

interface Option {
  id: string;
  label: string;
}

export function GenerateReportForm({ months, franchises, defaultMonth, defaultFranchiseId }: { months: Option[]; franchises: Option[]; defaultMonth: string; defaultFranchiseId: string | null }) {
  const router = useRouter();
  return (
    <ActionForm action={generateReport} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSuccess={() => router.refresh()}>
      {(state) => (
        <>
          <Field label="Month" error={state.fieldErrors?.month}>
            <Select name="month" defaultValue={defaultMonth}>{months.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select>
          </Field>
          <Field label="Which franchise?">
            <Select name="franchiseId" defaultValue={defaultFranchiseId ?? ""}>
              <option value="">All franchises (consolidated)</option>
              {franchises.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </Select>
          </Field>
          <SubmitButton pendingLabel="Generating…">Generate report</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
