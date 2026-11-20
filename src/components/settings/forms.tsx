"use client";

import { useState } from "react";
import { addCategory, setCategoryActive, } from "@/lib/actions/expenses";
import { saveDpdLoginAction } from "@/lib/actions/dpd-login";
import { addDpdLoginAction, refreshDpdLoginAction, removeDpdLoginAction } from "@/lib/actions/dpd-logins";
import { addFranchise, addRevenue, updateAlertSettings, updateBusinessName, updateFranchise, updateSchedule, voidRevenue } from "@/lib/actions/settings";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ReasonDialog } from "@/components/ui/reason-dialog";

interface Option {
  id: string;
  label: string;
}

export function DpdLoginForm({ saved }: { saved: boolean }) {
  return (
    <ActionForm action={saveDpdLoginAction} className="grid gap-4 sm:max-w-md">
      {(state) => (
        <>
          <p className="text-sm text-muted">
            {saved ? "A login is saved. Enter it again to replace it. The password is never shown back." : "No login saved yet. The nightly sync cannot sign in to DPD until you save one."}
          </p>
          <Field label="DPD portal username" error={state.fieldErrors?.username}>
            <Input name="username" autoComplete="off" required />
          </Field>
          <Field label="DPD portal password" error={state.fieldErrors?.password}>
            <Input name="password" type="password" autoComplete="new-password" required />
          </Field>
          <SubmitButton>Save DPD Login</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export const BusinessNameForm = ({ name }: { name: string }) => (
  <ActionForm action={updateBusinessName} className="flex flex-wrap items-end gap-3">
    {(state) => (<>
      <Field label="Business name" error={state.fieldErrors?.name} className="min-w-64 flex-1"><Input name="name" defaultValue={name} required /></Field>
      <SubmitButton>Save</SubmitButton>
    </>)}
  </ActionForm>
);

export function AddFranchiseForm() {
  return (
    <ActionForm action={addFranchise} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" resetOnSuccess>
      {(state) => (<>
        <Field label="FD number" hint="Exactly as it appears on DPD documents." error={state.fieldErrors?.fdNumber}><Input name="fdNumber" autoCapitalize="characters" required /></Field>
        <Field label="Name (optional)"><Input name="name" placeholder="Depot or area" /></Field>
        <SubmitButton>Add Franchise</SubmitButton>
      </>)}
    </ActionForm>
  );
}

export function EditFranchiseButton({ franchise, scales }: { franchise: { id: string; fdNumber: string; name: string; depot: string | null; isActive: boolean; vehicleType: string | null; vehicleSize: string | null; vehicleFuel: string | null; slidingScaleKey: string | null }; scales: { key: string; name: string; effective: string }[] | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="quiet" size="sm" onClick={() => setOpen(true)}>Edit</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Edit ${franchise.fdNumber}`}>
        <ActionForm action={updateFranchise} className="space-y-4" onSuccess={() => setOpen(false)}>
          {(state) => (<>
            <input type="hidden" name="id" value={franchise.id} />
            <Field label="FD number" hint="Changing it does not affect past records." error={state.fieldErrors?.fdNumber}><Input name="fdNumber" defaultValue={franchise.fdNumber} required /></Field>
            <Field label="Name"><Input name="name" defaultValue={franchise.name} /></Field>
            <Field label="Depot"><Input name="depot" defaultValue={franchise.depot ?? ""} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Vehicle" hint="As the sliding scale names it, e.g. Van."><Input name="vehicleType" defaultValue={franchise.vehicleType ?? ""} /></Field>
              <Field label="Size"><Input name="vehicleSize" defaultValue={franchise.vehicleSize ?? ""} /></Field>
              <Field label="Fuel"><Select name="vehicleFuel" defaultValue={franchise.vehicleFuel ?? "diesel"}><option value="diesel">Diesel</option><option value="electric">Electric</option><option value="other">Other</option></Select></Field>
            </div>
            {scales ? (
              <Field label="Sliding scale" hint="Pick the scale DPD lists for this vehicle. The date after each name is when DPD says it takes effect." error={state.fieldErrors?.slidingScaleKey}>
                <Select name="slidingScaleKey" defaultValue={franchise.slidingScaleKey ?? ""}>
                  <option value="">Not chosen yet</option>
                  {scales.map((sc) => <option key={sc.key} value={sc.key}>{sc.name} · {sc.effective}</option>)}
                </Select>
              </Field>
            ) : null}
            <Field label="Status"><Select name="isActive" defaultValue={String(franchise.isActive)}><option value="true">Active</option><option value="false">Inactive (no longer operating)</option></Select></Field>
            <SubmitButton>Save</SubmitButton>
          </>)}
        </ActionForm>
      </Dialog>
    </>
  );
}

export function ScheduleForm({ syncTime, syncEnabled, autoReports }: { syncTime: string; syncEnabled: boolean; autoReports: boolean }) {
  return (
    <ActionForm action={updateSchedule} className="space-y-4">
      {(state) => (<>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Evening sync time (UK time)" hint="DPD reports are fetched after this time each evening. It follows GMT/BST automatically." error={state.fieldErrors?.syncTime}>
            <Input name="syncTime" type="time" defaultValue={syncTime.slice(0, 5)} required />
          </Field>
          <Field label="Automatic DPD sync"><Select name="syncEnabled" defaultValue={String(syncEnabled)}><option value="true">On</option><option value="false">Off</option></Select></Field>
          <Field label="Monthly reports"><Select name="autoReports" defaultValue={String(autoReports)}><option value="true">Create automatically after month end</option><option value="false">Only when I ask</option></Select></Field>
        </div>
        <SubmitButton>Save</SubmitButton>
      </>)}
    </ActionForm>
  );
}

export function AlertSettingsForm({ values, defaults }: { values: Record<string, number>; defaults: Record<string, number> }) {
  const fields: { key: string; label: string; unit: string }[] = [
    { key: "earningsChangePct", label: "Earnings Change Worth Flagging", unit: "% from the driver's normal" },
    { key: "stopsChangePct", label: "Stops Change Worth Flagging", unit: "%" },
    { key: "parcelsChangePct", label: "Parcels Change Worth Flagging", unit: "%" },
    { key: "fuelWeeklyChangePct", label: "Weekly fuel spend increase worth flagging", unit: "%" },
    { key: "baselineDays", label: "Working days that count as “normal”", unit: "days" },
    { key: "expenseHighMultiple", label: "Expense flagged when it is this many times the usual", unit: "×" },
  ];
  return (
    <ActionForm action={updateAlertSettings} className="space-y-4">
      {(state) => (<>
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => (
            <Field key={f.key} label={f.label} hint={`${f.unit} · usual setting: ${defaults[f.key]}`} error={state.fieldErrors?.[f.key]}>
              <Input name={f.key} inputMode="decimal" defaultValue={values[f.key] ?? defaults[f.key]} />
            </Field>
          ))}
        </div>
        <SubmitButton>Save Alert Settings</SubmitButton>
      </>)}
    </ActionForm>
  );
}

export function AddRevenueButton({ franchises, currentMonth, today }: { franchises: Option[]; currentMonth: string; today: string }) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<"month" | "day">("month");
  const [kind, setKind] = useState<"payment" | "credit_note">("payment");
  return (
    <>
      <Button onClick={() => setOpen(true)}>Add Revenue</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Add Franchise Revenue">
        <ActionForm action={addRevenue} className="space-y-4" resetOnSuccess onSuccess={() => setOpen(false)}>
          {(state) => (<>
            <Field label="Franchise" error={state.fieldErrors?.franchiseId}><Select name="franchiseId" defaultValue={franchises.length === 1 ? franchises[0]!.id : ""} required><option value="" disabled>Choose…</option>{franchises.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select></Field>
            <Field label="What is this?" hint="A credit note from DPD, whether money back or against a charge, is money in for you."><Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as "payment" | "credit_note")}><option value="payment">A payment from DPD</option><option value="credit_note">A credit note from DPD</option></Select></Field>
            <Field label="Covers"><Select name="period" value={period} onChange={(e) => setPeriod(e.target.value as "month" | "day")}><option value="month">A whole month</option><option value="day">One day</option></Select></Field>
            {period === "month" ? <Field label="Month" error={state.fieldErrors?.month}><Input name="month" type="month" defaultValue={currentMonth} max={currentMonth} required /></Field>
              : <Field label="Day" error={state.fieldErrors?.day}><Input name="day" type="date" defaultValue={today} max={today} required /></Field>}
            <Field label="Amount received from DPD" error={state.fieldErrors?.amount}><div className="relative max-w-xs"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">£</span><Input name="amount" inputMode="decimal" className="num pl-7" required placeholder="0.00" /></div></Field>
            <Field label="Note (optional)"><Input name="description" maxLength={300} /></Field>
            <SubmitButton>Save Revenue</SubmitButton>
          </>)}
        </ActionForm>
      </Dialog>
    </>
  );
}

export const VoidRevenueButton = ({ id }: { id: string }) => (
  <ReasonDialog action={voidRevenue} fields={{ id }} trigger="Remove" title="Remove This Revenue Entry" submitLabel="Remove" reasonLabel="Why?" explanation="It stops counting in every total. The record is kept, marked as void." />
);

export const AddCategoryForm = () => (
  <ActionForm action={addCategory} className="flex flex-wrap items-end gap-3" resetOnSuccess>
    {(state) => (<>
      <Field label="New expense category" error={state.fieldErrors?.name} className="min-w-56 flex-1"><Input name="name" maxLength={60} required placeholder="For example: Uniforms" /></Field>
      <Field label="Counts as"><Select name="kind" defaultValue="other"><option value="other">Other operating expense</option><option value="vehicle">Vehicle cost</option></Select></Field>
      <SubmitButton>Add Category</SubmitButton>
    </>)}
  </ActionForm>
);

export function CategoryToggle({ id, active }: { id: string; active: boolean }) {
  return (
    <ActionForm action={setCategoryActive}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={String(!active)} />
      <SubmitButton variant="quiet" size="sm" pendingLabel="…">{active ? "Hide" : "Show"}</SubmitButton>
    </ActionForm>
  );
}

export function AddDpdLoginForm() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Add a DPD Login</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Add a DPD Login">
        <ActionForm action={addDpdLoginAction} className="space-y-4" resetOnSuccess onSuccess={() => setOpen(false)}>
          {(state) => (
            <>
              <p className="text-sm text-muted">Add one for each DPD login that sees your franchises. Each one is read every night, and its franchises are found for you.</p>
              <Field label="Name for this login (optional)" hint="For example Depot A. If you leave it blank, the username is used." error={state.fieldErrors?.label}>
                <Input name="label" />
              </Field>
              <Field label="DPD portal username" error={state.fieldErrors?.username}>
                <Input name="username" autoComplete="off" required />
              </Field>
              <Field label="DPD portal password" error={state.fieldErrors?.password}>
                <Input name="password" type="password" autoComplete="new-password" required />
              </Field>
              <Field label="FD numbers this login can see (optional)" hint="Leave this blank and we will find them from DPD. Or list them, separated by commas or one on each line." error={state.fieldErrors?.fdNumbers}>
                <Textarea name="fdNumbers" className="min-h-20 font-mono text-sm" spellCheck={false} />
              </Field>
              <SubmitButton>Add Login</SubmitButton>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}

export function RefreshDpdLoginButton({ id }: { id: string }) {
  return (
    <ActionForm action={refreshDpdLoginAction}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Checking…">Check &amp; Refresh</SubmitButton>
    </ActionForm>
  );
}

export function RemoveDpdLoginButton({ id }: { id: string }) {
  return (
    <ActionForm action={removeDpdLoginAction}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="quiet" size="sm" pendingLabel="…">Remove</SubmitButton>
    </ActionForm>
  );
}
