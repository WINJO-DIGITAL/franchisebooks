"use client";

import { useRouter } from "next/navigation";
import { generateReport } from "@/lib/actions/sync";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Select } from "@/components/ui/form";

interface Option {
  id: string;
  label: string;
}

export function GenerateReportForm({
  periods, months, franchises, defaultReport, defaultFranchiseId, allowAll, showDiscrepancy,
}: { showDiscrepancy: boolean; periods: Option[]; months: Option[]; franchises: Option[]; defaultReport: string; defaultFranchiseId: string | null; allowAll: boolean }) {
  const router = useRouter();
  return (
    <ActionForm action={generateReport} className="grid gap-4 sm:grid-cols-2 sm:items-end" onSuccess={() => router.refresh()}>
      {(state) => (
        <>
          <Field label="Which report?" error={state.fieldErrors?.type}>
            <Select name="type" defaultValue="period">
              <option value="period">Period Report</option>
              <option value="driver_pay">Driver Pay Report</option>
              <option value="profit_loss">Profit and Loss</option>
              {showDiscrepancy ? <option value="discrepancy">Sliding Scale Discrepancy</option> : null}
            </Select>
          </Field>
          <Field label="What period?" error={state.fieldErrors?.report}>
            <Select name="report" defaultValue={defaultReport}>
              <optgroup label="DPD four-week periods">
                {periods.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </optgroup>
              <optgroup label="Calendar months">
                {months.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </optgroup>
            </Select>
          </Field>
          <Field label="Which franchise?">
            <Select name="franchiseId" defaultValue={defaultFranchiseId ?? (allowAll ? "" : franchises[0]?.id ?? "")}>
              {allowAll ? <option value="">All franchises (consolidated)</option> : null}
              {franchises.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </Select>
          </Field>
          <SubmitButton pendingLabel="Generating…">Generate Report</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
