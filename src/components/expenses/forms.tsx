"use client";

import { useState } from "react";
import { addExpense, assignCost } from "@/lib/actions/expenses";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ChoiceCard, Field, Input, Select } from "@/components/ui/form";

interface Option {
  id: string;
  label: string;
}

export function AddExpenseButton({ franchises, categories, drivers, today, defaultFranchiseId, startOpen }: {
  franchises: Option[]; categories: Option[]; drivers: Option[]; today: string; defaultFranchiseId: string | null; startOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(startOpen));
  const [assignTo, setAssignTo] = useState<"unallocated" | "franchise" | "driver">("franchise");
  return (
    <>
      <Button onClick={() => setOpen(true)}>Add Expense</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Add an Expense" wide>
        <ActionForm action={addExpense} className="space-y-4" resetOnSuccess onSuccess={() => setOpen(false)}>
          {(state) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="What was it for?" error={state.fieldErrors?.description} className="sm:col-span-2">
                  <Input name="description" required maxLength={300} placeholder="For example: two front tyres" />
                </Field>
                <Field label="How much?" error={state.fieldErrors?.amount}>
                  <div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">£</span>
                    <Input name="amount" inputMode="decimal" className="num pl-7" required placeholder="0.00" autoComplete="off" /></div>
                </Field>
                <Field label="When?" error={state.fieldErrors?.expenseDate}>
                  <Input name="expenseDate" type="date" defaultValue={today} max={today} required />
                </Field>
                <Field label="Category" error={state.fieldErrors?.categoryId}>
                  <Select name="categoryId" defaultValue="" required>
                    <option value="" disabled>Choose…</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </Select>
                </Field>
                <Field label="Franchise" error={state.fieldErrors?.franchiseId}>
                  <Select name="franchiseId" defaultValue={defaultFranchiseId ?? (franchises.length === 1 ? franchises[0]!.id : "")}>
                    <option value="">Not sure yet</option>
                    {franchises.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </Select>
                </Field>
                <Field label="Supplier (optional)">
                  <Input name="supplier" maxLength={120} />
                </Field>
                <Field label="Vehicle registration (optional)">
                  <Input name="vehicleRegistration" autoCapitalize="characters" maxLength={12} />
                </Field>
              </div>
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium">Who Does This Cost Belong To?</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  <ChoiceCard name="assignTo" value="franchise" checked={assignTo === "franchise"} onChange={() => setAssignTo("franchise")} title="The Franchise" />
                  <ChoiceCard name="assignTo" value="driver" checked={assignTo === "driver"} onChange={() => setAssignTo("driver")} title="A Driver" />
                  <ChoiceCard name="assignTo" value="unallocated" checked={assignTo === "unallocated"} onChange={() => setAssignTo("unallocated")} title="Decide Later" />
                </div>
              </fieldset>
              {assignTo === "driver" ? (
                <Field label="Which driver?" error={state.fieldErrors?.driverId}>
                  <Select name="driverId" defaultValue="" required>
                    <option value="" disabled>Choose…</option>
                    {drivers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </Select>
                </Field>
              ) : null}
              <SubmitButton>Save Expense</SubmitButton>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}

export function AssignCostButton({ kind, id, drivers, current, summary }: { kind: "fuel" | "expense"; id: string; drivers: Option[]; current: "unallocated" | "franchise" | "driver"; summary: string }) {
  const [open, setOpen] = useState(false);
  const [assignTo, setAssignTo] = useState<"unallocated" | "franchise" | "driver">(current === "unallocated" ? "driver" : current);
  return (
    <>
      <Button variant={current === "unallocated" ? "secondary" : "quiet"} size="sm" onClick={() => setOpen(true)}>{current === "unallocated" ? "Assign" : "Change"}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Who Does This Cost Belong To?">
        <ActionForm action={assignCost} className="space-y-4" onSuccess={() => setOpen(false)}>
          {(state) => (
            <>
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="id" value={id} />
              <p className="text-[0.9375rem] text-ink-soft">{summary}</p>
              <ChoiceCard name="assignTo" value="driver" checked={assignTo === "driver"} onChange={() => setAssignTo("driver")} title="A Driver" />
              {assignTo === "driver" ? (
                <Field label="Which driver?" error={state.fieldErrors?.driverId}>
                  <Select name="driverId" defaultValue="" required>
                    <option value="" disabled>Choose…</option>
                    {drivers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </Select>
                </Field>
              ) : null}
              <ChoiceCard name="assignTo" value="franchise" checked={assignTo === "franchise"} onChange={() => setAssignTo("franchise")} title="The Franchise in General" description="A business cost that is nobody's in particular." />
              <ChoiceCard name="assignTo" value="unallocated" checked={assignTo === "unallocated"} onChange={() => setAssignTo("unallocated")} title="Not Decided Yet" description="Keep it in the unallocated list." />
              <Field label="Note (optional)">
                <Input name="note" maxLength={300} />
              </Field>
              <SubmitButton>Save</SubmitButton>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
