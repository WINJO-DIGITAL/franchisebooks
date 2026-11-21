"use client";

import { useState } from "react";
import { generateReport } from "@/lib/actions/sync";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Select } from "@/components/ui/form";

interface Option {
  id: string;
  label: string;
}

/**
 * Makes the report and opens it straight away: the PDF, or the CSV for the Sliding Scale Discrepancy. The page navigates in the
 * same tab, because a new window opened after a wait is blocked on iPhone.
 */
export function GenerateReportForm({
  periods, months, franchises, defaultReport, defaultFranchiseId, allowAll, showDiscrepancy,
}: { showDiscrepancy: boolean; periods: Option[]; months: Option[]; franchises: Option[]; defaultReport: string; defaultFranchiseId: string | null; allowAll: boolean }) {
  const [type, setType] = useState("period");
  const [openAs, setOpenAs] = useState<"pdf" | "csv">("pdf");
  const isDiscrepancy = type === "discrepancy";
  return (
    <ActionForm
      action={generateReport}
      className="grid gap-4 sm:grid-cols-2 sm:items-end"
      onSuccess={(state) => {
        const id = (state.data as { id?: string } | undefined)?.id;
        if (!id) return;
        const asCsv = isDiscrepancy && openAs === "csv";
        // A CSV is downloaded to the phone's Files; a PDF opens in the browser's viewer.
        window.location.assign(asCsv ? `/api/reports/${id}?format=csv` : `/api/reports/${id}?view=1`);
      }}
    >
      {(state) => (
        <>
          <Field label="Which report?" error={state.fieldErrors?.type}>
            <Select name="type" value={type} onChange={(e) => setType(e.target.value)}>
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
          {isDiscrepancy ? (
            <Field label="Open it as">
              <Select name="openAs" value={openAs} onChange={(e) => setOpenAs(e.target.value as "pdf" | "csv")}>
                <option value="pdf">PDF</option>
                <option value="csv">CSV</option>
              </Select>
            </Field>
          ) : null}
          <SubmitButton pendingLabel="Generating…">Generate Report</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
