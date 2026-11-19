"use client";

import { useState } from "react";
import { addScaleRate, importScaleRates, removeScaleRate } from "@/lib/actions/sliding-scale";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";

export function AddScaleRateButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Add a Band</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Add a Sliding Scale Band">
        <ActionForm action={addScaleRate} className="space-y-4" resetOnSuccess onSuccess={() => setOpen(false)}>
          {(state) => (
            <>
              <Field label="Vehicle type" hint="For example Van." error={state.fieldErrors?.vehicleType}>
                <Input name="vehicleType" required />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Size (optional)" hint="For example Large.">
                  <Input name="vehicleSize" />
                </Field>
                <Field label="Fuel">
                  <Select name="fuelType" defaultValue="diesel">
                    <option value="diesel">Diesel</option>
                    <option value="electric">Electric</option>
                    <option value="other">Other</option>
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Stops from" error={state.fieldErrors?.stopsFrom}>
                  <Input name="stopsFrom" inputMode="numeric" required />
                </Field>
                <Field label="Stops to" hint="Blank = and above.">
                  <Input name="stopsTo" inputMode="numeric" />
                </Field>
                <Field label="Miles from (optional)">
                  <Input name="milesFrom" inputMode="numeric" />
                </Field>
                <Field label="Miles to (optional)">
                  <Input name="milesTo" inputMode="numeric" />
                </Field>
              </div>
              <Field label="Rate per stop (£)" hint="For example 2.27." error={state.fieldErrors?.rate}>
                <Input name="rate" inputMode="decimal" required />
              </Field>
              <SubmitButton>Save Band</SubmitButton>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}

export function PasteScaleRatesButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Paste Many</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Paste Sliding Scale Rows">
        <ActionForm action={importScaleRates} className="space-y-4" resetOnSuccess onSuccess={() => setOpen(false)}>
          {(state) => (
            <>
              <p className="text-sm text-muted">One band per line, copied from a spreadsheet or typed with commas: vehicle, size, fuel, stops from, stops to, miles from, miles to, rate. Leave a &ldquo;to&rdquo; blank for &ldquo;and above&rdquo;. If any line has a problem, nothing is saved.</p>
              <Field label="Rows" error={state.fieldErrors?.rates}>
                <Textarea name="rates" className="min-h-40 font-mono text-xs" spellCheck={false} placeholder={"Van, Large, Diesel, 0, 79, 0, 99, 2.15\nVan, Large, Diesel, 80, , , , 2.30"} required />
              </Field>
              <SubmitButton>Save Rows</SubmitButton>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}

export function RemoveScaleRateButton({ id }: { id: string }) {
  return (
    <ActionForm action={removeScaleRate}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="quiet" size="sm" pendingLabel="…">Remove</SubmitButton>
    </ActionForm>
  );
}
