"use client";

import { inviteDriverLogin, removeDriverLogin } from "@/lib/actions/driver-access";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";

export function InviteDriverForm({ driverId }: { driverId: string }) {
  return (
    <ActionForm action={inviteDriverLogin} className="flex max-w-lg flex-wrap items-end gap-3" resetOnSuccess>
      {(state) => (
        <>
          <input type="hidden" name="driverId" value={driverId} />
          <div className="min-w-[14rem] flex-1">
            <Field label="Driver's email address" error={state.fieldErrors?.email}>
              <Input name="email" type="email" autoComplete="off" required />
            </Field>
          </div>
          <SubmitButton pendingLabel="Sending…">Send invitation</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function RemoveDriverLoginForm({ driverId }: { driverId: string }) {
  return (
    <ActionForm action={removeDriverLogin}>
      <input type="hidden" name="driverId" value={driverId} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Removing…">Remove access</SubmitButton>
    </ActionForm>
  );
}
