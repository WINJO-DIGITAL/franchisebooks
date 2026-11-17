"use client";

import { useState } from "react";
import { addAssignment, createDriver, endAssignment, linkUnregisteredDriver, updateDriver } from "@/lib/actions/drivers";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ChoiceCard, Field, Input, Select, Textarea } from "@/components/ui/form";

interface Option {
  id: string;
  label: string;
}

export function NewDriverForm({ franchises, defaultFranchiseId, today }: { franchises: Option[]; defaultFranchiseId: string | null; today: string }) {
  return (
    <ActionForm action={createDriver} className="space-y-5">
      {(state) => (
        <>
          <Field label="Driver's name" hint="As it appears on DPD reports, if you know it." error={state.fieldErrors?.displayName}>
            <Input name="displayName" autoComplete="off" required />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Which franchise do they work on?" error={state.fieldErrors?.franchiseId}>
              <Select name="franchiseId" defaultValue={defaultFranchiseId ?? (franchises.length === 1 ? franchises[0]!.id : "")}>
                <option value="">Decide later</option>
                {franchises.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </Select>
            </Field>
            <Field label="Start date" error={state.fieldErrors?.startDate}>
              <Input name="startDate" type="date" defaultValue={today} max={today} />
            </Field>
          </div>
          <details className="rounded-lg border border-line bg-surface px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-ink-soft">More details (optional)</summary>
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <Field label="DPD driver reference" hint="Helps match reports automatically." error={state.fieldErrors?.dpdDriverRef}>
                <Input name="dpdDriverRef" autoComplete="off" />
              </Field>
              <Field label="Route">
                <Input name="route" autoComplete="off" />
              </Field>
              <Field label="Vehicle registration" hint="Used to attribute fuel to this driver.">
                <Input name="vehicleRegistration" autoComplete="off" autoCapitalize="characters" />
              </Field>
              <Field label="Phone">
                <Input name="phone" type="tel" autoComplete="off" />
              </Field>
              <Field label="Email" error={state.fieldErrors?.email}>
                <Input name="email" type="email" autoComplete="off" />
              </Field>
            </div>
          </details>
          <SubmitButton>Add driver</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export interface DriverDetails {
  id: string;
  displayName: string;
  dpdDriverRef: string | null;
  phone: string | null;
  email: string | null;
  startDate: string | null;
  leavingDate: string | null;
  isActive: boolean;
  notes: string | null;
}

export function EditDriverForm({ driver }: { driver: DriverDetails }) {
  return (
    <ActionForm action={updateDriver} className="space-y-5">
      {(state) => (
        <>
          <input type="hidden" name="id" value={driver.id} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Name" hint="Changing the name does not affect past records." error={state.fieldErrors?.displayName}>
              <Input name="displayName" defaultValue={driver.displayName} required />
            </Field>
            <Field label="DPD driver reference" error={state.fieldErrors?.dpdDriverRef}>
              <Input name="dpdDriverRef" defaultValue={driver.dpdDriverRef ?? ""} />
            </Field>
            <Field label="Phone">
              <Input name="phone" type="tel" defaultValue={driver.phone ?? ""} />
            </Field>
            <Field label="Email" error={state.fieldErrors?.email}>
              <Input name="email" type="email" defaultValue={driver.email ?? ""} />
            </Field>
            <Field label="Start date" error={state.fieldErrors?.startDate}>
              <Input name="startDate" type="date" defaultValue={driver.startDate ?? ""} />
            </Field>
            <Field label="Leaving date" hint="Leave blank while they still work for you." error={state.fieldErrors?.leavingDate}>
              <Input name="leavingDate" type="date" defaultValue={driver.leavingDate ?? ""} />
            </Field>
            <Field label="Status">
              <Select name="isActive" defaultValue={String(driver.isActive)}>
                <option value="true">Active</option>
                <option value="false">Inactive (left or not working)</option>
              </Select>
            </Field>
          </div>
          <Field label="Notes">
            <Textarea name="notes" defaultValue={driver.notes ?? ""} />
          </Field>
          <SubmitButton>Save details</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function AddAssignmentForm({ driverId, franchises, today }: { driverId: string; franchises: Option[]; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Add assignment</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Assign to a franchise">
        <ActionForm action={addAssignment} className="space-y-4" onSuccess={() => setOpen(false)}>
          {(state) => (
            <>
              <input type="hidden" name="driverId" value={driverId} />
              <Field label="Franchise" error={state.fieldErrors?.franchiseId}>
                <Select name="franchiseId" defaultValue={franchises.length === 1 ? franchises[0]!.id : ""} required>
                  <option value="" disabled>Choose…</option>
                  {franchises.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </Select>
              </Field>
              <Field label="From" error={state.fieldErrors?.startDate}>
                <Input name="startDate" type="date" defaultValue={today} required />
              </Field>
              <Field label="Route (optional)">
                <Input name="route" />
              </Field>
              <Field label="Vehicle registration (optional)" hint="Fuel bought for this vehicle is attributed to the driver.">
                <Input name="vehicleRegistration" autoCapitalize="characters" />
              </Field>
              <SubmitButton>Save assignment</SubmitButton>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}

export function EndAssignmentForm({ id, driverId, today }: { id: string; driverId: string; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="quiet" size="sm" onClick={() => setOpen(true)}>End</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="End this assignment">
        <ActionForm action={endAssignment} className="space-y-4" onSuccess={() => setOpen(false)}>
          {(state) => (
            <>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="driverId" value={driverId} />
              <Field label="Last day on this assignment" error={state.fieldErrors?.endDate}>
                <Input name="endDate" type="date" defaultValue={today} required />
              </Field>
              <p className="text-sm text-muted">Everything already recorded stays exactly as it is.</p>
              <SubmitButton>End assignment</SubmitButton>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}

export function LinkDriverForm({ franchiseId, driverKey, sourceName, drivers }: { franchiseId: string; driverKey: string; sourceName: string; drivers: Option[] }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"new" | "existing">("new");
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Sort this out</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Who is “${sourceName}”?`}>
        <ActionForm action={linkUnregisteredDriver} className="space-y-4" onSuccess={() => setOpen(false)}>
          {(state) => (
            <>
              <input type="hidden" name="franchiseId" value={franchiseId} />
              <input type="hidden" name="driverKey" value={driverKey} />
              <input type="hidden" name="sourceName" value={sourceName} />
              <ChoiceCard name="mode" value="new" checked={mode === "new"} onChange={() => setMode("new")} title="A new driver" description={`Add “${sourceName}” to your drivers.`} />
              <ChoiceCard name="mode" value="existing" checked={mode === "existing"} onChange={() => setMode("existing")} title="A driver I already have" description="The report spells the name differently." />
              {mode === "existing" ? (
                <Field label="Which driver?" error={state.fieldErrors?.driverId}>
                  <Select name="driverId" defaultValue="" required>
                    <option value="" disabled>Choose…</option>
                    {drivers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </Select>
                </Field>
              ) : null}
              <p className="text-sm text-muted">The DPD figures themselves are not changed — they are simply linked to the right person.</p>
              <SubmitButton>Confirm</SubmitButton>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
